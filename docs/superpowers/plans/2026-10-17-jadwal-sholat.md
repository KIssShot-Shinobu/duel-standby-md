# Fitur Jadwal Sholat via DM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User bisa berlangganan jadwal sholat untuk satu daerah lewat DM, lalu menerima DM otomatis pada 5 waktu wajib (Subuh, Dzuhur, Ashar, Maghrib, Isya).

**Architecture:** Meniru pola fitur rent. `lib/sholat.js` = logika **murni** (katalog daerah, zona waktu, langganan, waktu jatuh tempo, sweep) dengan jam disuntik `{ now }` sehingga bisa diuji tanpa jaringan. `lib/sholat-source.js` = **satu-satunya** modul yang memanggil jaringan (MyQuran API v2) + cache. `plugins/sholat.js` = perintah user. `main.js` = `setInterval` sweep yang mengirim DM. Langganan hidup di koleksi baru `db.data.sholat`.

**Tech Stack:** Node 20+, ESM, `fetch` bawaan + `AbortController`, `Intl.DateTimeFormat`, database JSON existing, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-17-jadwal-sholat-design.md` — plan ini mengimplementasikan spec tersebut. Baca keduanya sebelum mulai.

## Global Constraints

- **Sumber data:** `https://api.myquran.com/v2` (gratis, **tanpa API key**).
  - `GET /v2/sholat/kota/semua` → `{ status: true, data: [{ id, lokasi }] }` (`id` 4 digit, 2 digit pertama = kode provinsi).
  - `GET /v2/sholat/jadwal/{id}/{yyyy}/{mm}/{dd}` → `{ status: true, data: { id, lokasi, daerah, jadwal: { subuh, dzuhur, ashar, maghrib, isya, … } } }`.
- **Waktu yang dipakai:** `PRAYERS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya']`. `imsak`/`terbit`/`dhuha` **tidak** dipakai.
- **Gratis & bebas:** tanpa `handler.register` / `register: true`, tanpa biaya limit → `handler.limit = false`.
- **Pengiriman hanya DM.** Perintah boleh dipakai di DM maupun grup, tetapi langganan selalu melekat pada pengirim.
- **`graceMinutes` default 30**, **`sweepIntervalMs` default 60000**.
- **Zona waktu:** peta **34 kode provinsi → WIB/WITA/WIT**. Dilarang menebak: kode tak dikenal → `null` → pelanggan **dilewati + dicatat** (jangan dikirim dengan jam yang mungkin salah 1–2 jam).
- **Kunci `db.data.sholat`** = `db.resolveIdentity(m.sender)` — sama seperti `db.user()` (`lib/database.js:229`). `handler.js:122–131` hanya menyelesaikan bentuk `@lid`; bentuk **"LID yang dipaksakan jadi nomor"** (`271446714642565@s.whatsapp.net`) hanya ditangani `resolveIdentity` lewat `lidMap`. Tanpa ini langganan tersimpan di record hantu: sweep tetap mengirim DM, tapi `.sholat stop` tidak menemukan langganannya (spec §7 & risiko #4).
- **Tanggal** selalu format `'YYYY-MM-DD'`; **waktu** selalu `'HH:MM'` (24 jam, tanpa detik).
- **Non-tujuan:** tanpa audio adzan, tanpa pilihan per-waktu, tanpa pengingat sebelum adzan, tanpa kalender hijriah, tanpa broadcast ke grup.
- **Tag plugin:** `['islami']` (label menu jatuh ke `tag.toUpperCase()` di `plugins/main-menu.js:30` — tidak perlu mengubah `lib/menu-config.js`).

## Review Focus

Lima hal yang diimplikasikan spec tetapi tidak otomatis terjaga oleh test tiap task. Masing-masing dipasangkan ke test di task pemiliknya:

1. **Daerah terlalu umum** (mis. `.sholat daftar kota`) → ratusan kandidat. Harus dibatasi (`maxCandidates`) + "dan N lainnya", bukan pesan raksasa — **dan tidak boleh diam-diam berhenti di satu daerah**. → Task 3 & Task 8.
2. **Zona waktu tak dikenal** (kode provinsi di luar peta) → pelanggan dilewati, tercatat di `skipped` **dan dilaporkan di log**, tidak crash, tidak dikirim dengan jam tebakan. → Task 6 & Task 9.
3. **Bot start setelah beberapa waktu sholat terlewat sekaligus** → hanya yang masih dalam 30 menit yang dikirim; sisanya dibuang. → Task 5.
4. **Field jadwal API tidak valid/kosong** (`'HH:MM'` rusak) → waktu itu dilewati, waktu lain tetap terkirim; respons yang tidak lengkap membuat kota itu dilewati siklus ini (bukan dikirim dengan jadwal separuh). → Task 5 & Task 7.
5. **Dua pelanggan di zona berbeda pada menit yang sama** → masing-masing memakai zona waktunya sendiri, bukan zona server. → Task 6 & Task 9.

---

### Task 1: Blok config `sholat` + `.env.example`

**Files:**
- Modify: `config.js` (setelah blok `rent`, ~baris 257)
- Modify: `.env.example`

**Interfaces:**
- Produces: `config.sholat = { enabled, apiBase, timeoutMs, sweepIntervalMs, graceMinutes, maxCandidates, prayers }` — dipakai Task 4 (`maxCandidates`), Task 5 (`graceMinutes`), Task 6 (`graceMinutes`, `prayers`), Task 7 (`apiBase`, `timeoutMs`), Task 8 (`maxCandidates`), Task 9 (`enabled`, `sweepIntervalMs`).

- [ ] **Step 1: Pastikan bloknya belum ada (gagal dulu)**

Run: `node -e "import('./config.js').then(m => console.log(m.config.sholat))"`
Expected: `undefined`

- [ ] **Step 2: Tambahkan blok `sholat` di `config.js`**

```js
/**
 * Jadwal sholat via DM.
 * Sumber: MyQuran API v2 (gratis, tanpa API key). Tiap user memilih satu
 * daerah; bot mengirim DM pada 5 waktu wajib.
 */
sholat: {
  enabled: env('SHOLAT_ENABLED', 'true') !== 'false',
  apiBase: env('SHOLAT_API_BASE', 'https://api.myquran.com/v2'),
  timeoutMs: envNumber('SHOLAT_TIMEOUT', 15000),
  /** seberapa sering sweep; 60 detik = presisi ±1 menit */
  sweepIntervalMs: envNumber('SHOLAT_SWEEP_MS', 60000),
  /** jendela kirim setelah waktu sholat lewat (menit) */
  graceMinutes: envNumber('SHOLAT_GRACE_MINUTES', 30),
  /** batas kandidat yang ditampilkan saat nama daerah ambigu */
  maxCandidates: envNumber('SHOLAT_MAX_CANDIDATES', 10),
  /** waktu yang dikirim, berurutan sesuai tampilan */
  prayers: envList('SHOLAT_PRAYERS', ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya']),
},
```

- [ ] **Step 3: Verifikasi**

Run: `node -e "import('./config.js').then(m => console.log(m.config.sholat))"`
Expected: objek tampil dengan `timeoutMs: 15000`, `graceMinutes: 30`, `sweepIntervalMs: 60000`, `prayers` berisi 5 waktu.

- [ ] **Step 4: Tambahkan variabel ke `.env.example`**

Tambahkan baris berikut (dengan komentar singkat, mengikuti gaya baris `RENT_*` di file yang sama): `SHOLAT_ENABLED`, `SHOLAT_API_BASE`, `SHOLAT_TIMEOUT`, `SHOLAT_SWEEP_MS`, `SHOLAT_GRACE_MINUTES`, `SHOLAT_MAX_CANDIDATES`, `SHOLAT_PRAYERS`.

- [ ] **Step 5: Commit**

```bash
git add config.js .env.example
git commit -m "feat(sholat): blok config sholat (API, sweep, toleransi, waktu)"
```

---

### Task 2: Koleksi `sholat` di database

**Files:**
- Modify: `lib/database.js` (`DEFAULT_DATA()` ~baris 68–93, loop normalisasi di `load()` ~baris 170)
- Test: `tests/database.test.js`

**Interfaces:**
- Produces: `db.data.sholat` — selalu objek setelah `load()`, analog `rentals`/`renters`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/database.test.js`, mengikuti pola test database yang sudah ada di file itu:

```js
test('koleksi sholat selalu objek & bertahan setelah reload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-sholat-'));
  const file = path.join(dir, 'db.json');

  const first = new Database(file, { logger: quiet });
  first.load();
  assert.equal(typeof first.data.sholat, 'object');
  first.data.sholat['628111@s.whatsapp.net'] = { jid: '628111@s.whatsapp.net', cityId: '1301' };
  await first.save(true);

  const second = new Database(file, { logger: quiet });
  second.load();
  assert.equal(second.data.sholat['628111@s.whatsapp.net'].cityId, '1301');

  // berkas rusak (sholat bukan objek) harus diperbaiki, bukan mempertahankan nilai salah
  fs.writeFileSync(file, JSON.stringify({ sholat: 'rusak' }), 'utf8');
  const third = new Database(file, { logger: quiet });
  third.load();
  assert.deepEqual(third.data.sholat, {});
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/database.test.js`
Expected: FAIL — `third.data.sholat` bukan `{}` (karena `sholat` belum dinormalisasi).

- [ ] **Step 3: Implementasi di `lib/database.js`**

Tambahkan `sholat: {}` ke `DEFAULT_DATA()` (di dekat `rentals`/`renters`), dan tambahkan `'sholat'` ke array loop normalisasi di `load()` sehingga menjadi:

```js
for (const key of ['users', 'chats', 'rentals', 'renters', 'sholat']) {
  if (!isPlainObject(this.data[key])) this.data[key] = {};
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node --test tests/database.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/database.js tests/database.test.js
git commit -m "feat(sholat): koleksi db.data.sholat"
```

---

### Task 3: `lib/sholat.js` — katalog daerah & zona waktu

**Files:**
- Create: `lib/sholat.js`
- Test: `tests/sholat.test.js`

**Interfaces:**
- Produces (dipakai Task 4–8):
  - `PRAYERS: string[]` → `['subuh','dzuhur','ashar','maghrib','isya']`
  - `PRAYER_LABEL: Record<string,string>` → `{ subuh: 'Subuh', dzuhur: 'Dzuhur', ashar: 'Ashar', maghrib: 'Maghrib', isya: 'Isya' }`
  - `TZ_LABEL: Record<string,string>` → `{ 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' }`
  - `PROVINCE_TZ: Record<string,string>` → 34 entri (lihat Step 3)
  - `timezoneForCity(cityId: string|number) -> string|null`
  - `normalizeCityName(name: string) -> string`
  - `resolveCity(cities: {id,name}[], input: string) -> { city: {id,name} } | { ambiguous: {id,name}[] } | null`

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/sholat.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { timezoneForCity, normalizeCityName, resolveCity } from '../lib/sholat.js';

const CITIES = [
  { id: '1301', name: 'KOTA JAKARTA' },
  { id: '2622', name: 'KOTA MAKASSAR' },
  { id: '1709', name: 'KOTA DENPASAR' },
  { id: '3329', name: 'KOTA JAYAPURA' },
  { id: '2013', name: 'KOTA PONTIANAK' },
  { id: '3211', name: 'KOTA SOFIFI' },
  { id: '3212', name: 'KOTA SOFIFI' },
  { id: '1201', name: 'KAB. BANDUNG' },
  { id: '1219', name: 'KOTA BANDUNG' },
];

test('timezoneForCity: WIB/WITA/WIT termasuk batas Kalimantan Barat', () => {
  assert.equal(timezoneForCity('1301'), 'Asia/Jakarta');
  assert.equal(timezoneForCity('2013'), 'Asia/Jakarta'); // Kalbar = WIB
  assert.equal(timezoneForCity('1709'), 'Asia/Makassar');
  assert.equal(timezoneForCity('3329'), 'Asia/Jayapura');
  assert.equal(timezoneForCity('9999'), null);
  assert.equal(timezoneForCity(''), null);
});

test('normalizeCityName membuang tanda baca dan merapikan spasi', () => {
  assert.equal(normalizeCityName('KAB. BANDUNG'), 'KAB BANDUNG');
  assert.equal(normalizeCityName('  kota   jakarta '), 'KOTA JAKARTA');
});

test('resolveCity: id, cocok kata utuh, ambiguitas, dan batas kata', () => {
  assert.deepEqual(resolveCity(CITIES, '1301'), { city: CITIES[0] });
  assert.deepEqual(resolveCity(CITIES, 'makassar'), { city: CITIES[1] });
  assert.equal(resolveCity(CITIES, 'sofifi').ambiguous.length, 2);
  assert.equal(resolveCity(CITIES, 'bandung').ambiguous.length, 2); // KAB + KOTA
  assert.equal(resolveCity(CITIES, 'arta'), null); // 'KOTA JAKARTA' TIDAK boleh cocok sebagian kata
  assert.equal(resolveCity(CITIES, 'ngawur'), null);
  assert.equal(resolveCity(CITIES, ''), null);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/sholat.test.js`
Expected: FAIL — modul `../lib/sholat.js` belum ada.

- [ ] **Step 3: Implementasi `lib/sholat.js`**

Header file: komentar singkat (mengikuti gaya `lib/rent.js`) yang menyatakan modul ini murni dan tidak menyentuh jaringan.

`PROVINCE_TZ` **persis** seperti spec bagian 9:

```js
export const PRAYERS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
export const PRAYER_LABEL = { subuh: 'Subuh', dzuhur: 'Dzuhur', ashar: 'Ashar', maghrib: 'Maghrib', isya: 'Isya' };
export const TZ_LABEL = { 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' };
export const PROVINCE_TZ = {
  '01': 'Asia/Jakarta', '02': 'Asia/Jakarta', '03': 'Asia/Jakarta', '04': 'Asia/Jakarta',
  '05': 'Asia/Jakarta', '06': 'Asia/Jakarta', '07': 'Asia/Jakarta', '08': 'Asia/Jakarta',
  '09': 'Asia/Jakarta', '10': 'Asia/Jakarta', '11': 'Asia/Jakarta', '12': 'Asia/Jakarta',
  '13': 'Asia/Jakarta', '14': 'Asia/Jakarta', '15': 'Asia/Jakarta', '16': 'Asia/Jakarta',
  '17': 'Asia/Makassar', '18': 'Asia/Makassar', '19': 'Asia/Makassar', '20': 'Asia/Jakarta',
  '21': 'Asia/Makassar', '22': 'Asia/Makassar', '23': 'Asia/Makassar', '24': 'Asia/Makassar',
  '25': 'Asia/Makassar', '26': 'Asia/Makassar', '27': 'Asia/Makassar', '28': 'Asia/Makassar',
  '29': 'Asia/Makassar', '30': 'Asia/Makassar',
  '31': 'Asia/Jayapura', '32': 'Asia/Jayapura', '33': 'Asia/Jayapura', '34': 'Asia/Jayapura',
};
```

Aturan yang harus dipenuhi (semua sudah dipatok test di Step 1):

- `timezoneForCity(cityId)`: ambil 2 digit pertama dari `String(cityId).padStart(4,'0')`; kembalikan `PROVINCE_TZ[prefix] ?? null`.
- `normalizeCityName(name)`: `String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()`.
- `resolveCity(cities, input)`: `id` sama persis lebih dulu; lalu langkah 3 **dan** 4 **digabung jadi satu daftar kandidat** (tidak bertingkat):
  3. nama berakhiran **kata utuh** input (atau sama persis): `name === input || name.endsWith(' ' + input)`,
  4. semua kata input muncul sebagai **kata utuh** di nama.
  Kandidat dari langkah 3 ditaruh lebih dulu (yang paling relevan tampil di atas). Satu kandidat → `{ city }`; lebih dari satu → `{ ambiguous }`; kosong → `null`. Input kosong → `null`.
  **Kenapa digabung, bukan bertingkat:** dengan bertingkat, `kota` berhenti di langkah 3 dan langsung mengembalikan `KAB. LIMA PULUH KOTA` (satu-satunya nama yang berakhiran "KOTA" di katalog sungguhan) — padahal 96 nama lain juga memuat "KOTA". Aturan produknya: yang ambigu tidak boleh ditebak. Verifikasi di katalog sungguhan: `kota` → 97 kandidat, `kab` → 422, `aceh` → 12, `padang`/`buton` → 4; sedangkan `makassar`, `jakarta`, `1301`, dan `kota bandung` tetap satu hasil.
  Pencocokan langkah 3 & 4 sengaja **kata utuh**, bukan substring: `arta` tidak boleh cocok ke `KOTA JAKARTA`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node --test tests/sholat.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sholat.js tests/sholat.test.js
git commit -m "feat(sholat): katalog daerah, zona waktu, resolusi ambigu"
```

---

### Task 4: `lib/sholat.js` — penyimpanan langganan

**Files:**
- Modify: `lib/sholat.js`
- Test: `tests/sholat.test.js`

**Interfaces:**
- Consumes: `timezoneForCity` (Task 3).
- Produces (dipakai Task 6, 8):
  - `subscribe(db, jid: string, city: {id,name}, { now = Date.now() } = {}) -> record|null` (`null` bila zona waktu kota tak dikenal)
  - `unsubscribe(db, jid: string) -> boolean`
  - `getSubscription(db, jid: string) -> record|null`
  - `listActiveSubscriptions(db) -> record[]` (hanya yang `enabled`)
  - Bentuk `record`: `{ jid, cityId, cityName, timezone, enabled, createdAt, updatedAt, sent: { date: '', keys: [] } }`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/sholat.test.js`:

```js
import { subscribe, unsubscribe, getSubscription, listActiveSubscriptions } from '../lib/sholat.js';

const JID = '628111@s.whatsapp.net';
const fakeDb = () => ({ data: { sholat: {} }, touched: 0, touch() { this.touched += 1; } });

test('subscribe menyimpan record lengkap & menolak kota tanpa zona waktu', () => {
  const db = fakeDb();
  const rec = subscribe(db, JID, CITIES[1], { now: 1000 });
  assert.equal(rec.cityId, '2622');
  assert.equal(rec.cityName, 'KOTA MAKASSAR');
  assert.equal(rec.timezone, 'Asia/Makassar');
  assert.equal(rec.enabled, true);
  assert.deepEqual(rec.sent, { date: '', keys: [] });
  assert.equal(db.touched, 1);

  assert.equal(subscribe(fakeDb(), JID, { id: '9999', name: 'NGACO' }, { now: 1 }), null);
});

test('subscribe ulang menimpa daerah tapi mempertahankan createdAt', () => {
  const db = fakeDb();
  subscribe(db, JID, CITIES[1], { now: 1000 });
  const again = subscribe(db, JID, CITIES[0], { now: 5000 });
  assert.equal(again.cityId, '1301');
  assert.equal(again.createdAt, 1000);
  assert.equal(again.updatedAt, 5000);
});

test('unsubscribe/getSubscription/listActiveSubscriptions', () => {
  const db = fakeDb();
  subscribe(db, JID, CITIES[0], { now: 1 });
  subscribe(db, '628222@s.whatsapp.net', CITIES[1], { now: 1 });
  db.data.sholat['628333@s.whatsapp.net'] = { jid: '628333@s.whatsapp.net', cityId: '1301', enabled: false };

  assert.equal(getSubscription(db, JID).cityId, '1301');
  assert.deepEqual(listActiveSubscriptions(db).map((s) => s.jid).sort(), [JID, '628222@s.whatsapp.net'].sort());

  assert.equal(unsubscribe(db, JID), true);
  assert.equal(unsubscribe(db, JID), false);
  assert.equal(getSubscription(db, JID), null);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/sholat.test.js`
Expected: FAIL — `subscribe` belum diekspor.

- [ ] **Step 3: Implementasi**

Tambahkan ke `lib/sholat.js`. Aturan yang dipatok test:

- `subscribe`: hitung `timezoneForCity(city.id)`; bila `null` → kembalikan `null` **tanpa** menulis apa pun (spec D2: jangan menebak). Bila ada, simpan record (kunci `jid`) dengan `createdAt` dari record lama bila sudah ada, `updatedAt = now`, `sent` direset, lalu `db.touch()`.
- `unsubscribe`: hapus kunci; `true` bila ada yang dihapus, `false` bila tidak; `db.touch()` hanya saat terhapus.
- `getSubscription`: `db.data.sholat?.[jid] ?? null`.
- `listActiveSubscriptions`: `Object.values(db.data.sholat || {}).filter((s) => s?.enabled)`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node --test tests/sholat.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sholat.js tests/sholat.test.js
git commit -m "feat(sholat): penyimpanan langganan user"
```

---

### Task 5: `lib/sholat.js` — waktu lokal & waktu jatuh tempo

**Files:**
- Modify: `lib/sholat.js`
- Test: `tests/sholat.test.js`

**Interfaces:**
- Produces (dipakai Task 6, 8):
  - `localParts(date: Date, timezone: string) -> { date: string, minutes: number }` — `date` = `'YYYY-MM-DD'` waktu lokal kota, `minutes` = menit sejak tengah malam lokal.
  - `duePrayers(sub, times: Record<string,string>, { now = Date.now(), graceMinutes = 30, prayers = PRAYERS } = {}) -> string[]`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/sholat.test.js`. **Perhatikan: ini menguji Review Focus 3 & 4.**

```js
import { localParts, duePrayers, PRAYERS } from '../lib/sholat.js';

const TIMES = { subuh: '04:15', dzuhur: '11:42', ashar: '14:48', maghrib: '17:49', isya: '18:58' };
/** instants UTC untuk jam WIB (UTC+7) pada 2026-10-17 */
const wib = (h, m) => Date.parse(`2026-10-17T${String(h - 7).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

test('localParts menghitung jam lokal tiap zona', () => {
  const at = Date.parse('2026-10-17T10:49:00Z');
  assert.deepEqual(localParts(new Date(at), 'Asia/Jakarta'), { date: '2026-10-17', minutes: 17 * 60 + 49 });
  assert.deepEqual(localParts(new Date(at), 'Asia/Makassar'), { date: '2026-10-17', minutes: 18 * 60 + 49 });
  assert.deepEqual(localParts(new Date(at), 'Asia/Jayapura'), { date: '2026-10-17', minutes: 19 * 60 + 49 });
});

test('duePrayers: sebelum waktu tidak muncul, dalam toleransi muncul, lewat toleransi dibuang', () => {
  const sub = { timezone: 'Asia/Jakarta', sent: { date: '2026-10-17', keys: [] } };
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(17, 45), graceMinutes: 30 }), []);
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(17, 49), graceMinutes: 30 }), ['maghrib']);
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(18, 19), graceMinutes: 30 }), ['maghrib']);
  // Review Focus 3: bot hidup setelah beberapa waktu lewat -> hanya yang masih dalam jendela
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(18, 20), graceMinutes: 30 }), []);
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(20, 30), graceMinutes: 30 }), []);
});

test('duePrayers: yang sudah terkirim hari ini tidak muncul lagi, dan tanggal baru mereset', () => {
  const times = TIMES;
  const sudah = { timezone: 'Asia/Jakarta', sent: { date: '2026-10-17', keys: ['maghrib'] } };
  assert.deepEqual(duePrayers(sudah, times, { now: wib(17, 49), graceMinutes: 30 }), []);
  const hariBaru = { timezone: 'Asia/Jakarta', sent: { date: '2026-10-16', keys: ['maghrib'] } };
  assert.deepEqual(duePrayers(hariBaru, times, { now: wib(17, 49), graceMinutes: 30 }), ['maghrib']);
});

test('duePrayers: waktu rusak/kosong dilewati tanpa merusak waktu lain', () => {
  // Review Focus 4
  const rusak = { ...TIMES, dzuhur: '', ashar: 'xx:yy', maghrib: undefined };
  const sub = { timezone: 'Asia/Jakarta', sent: { date: '2026-10-17', keys: [] } };
  assert.deepEqual(duePrayers(sub, rusak, { now: wib(17, 49), graceMinutes: 30 }), []);
  const jamPenuh = { ...rusak, isya: '17:49' };
  assert.deepEqual(duePrayers(sub, jamPenuh, { now: wib(17, 49), graceMinutes: 30 }), ['isya']);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/sholat.test.js`
Expected: FAIL — `localParts`/`duePrayers` belum ada.

- [ ] **Step 3: Implementasi**

- `localParts` memakai `Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })` lalu `formatToParts` untuk membaca komponennya. Jangan hitung offset manual.
- `duePrayers`: hitung `{ date, minutes }` sekali; `sent.keys` hanya berlaku bila `sub.sent?.date === date`, selain itu dianggap kosong. Sebuah waktu `t` dianggap jatuh tempo bila `t` cocok `/^\d{1,2}:\d{2}$/`, lalu `diff = minutes - target` memenuhi `diff >= 0 && diff <= graceMinutes` dan belum ada di `keys`. Kembalikan sesuai urutan `prayers`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node --test tests/sholat.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sholat.js tests/sholat.test.js
git commit -m "feat(sholat): waktu lokal kota & deteksi waktu jatuh tempo"
```

---

### Task 6: `lib/sholat.js` — `sweep`, `markSent`, pesan

**Files:**
- Modify: `lib/sholat.js`
- Test: `tests/sholat.test.js`

**Interfaces:**
- Consumes: `listActiveSubscriptions` (Task 4), `duePrayers`/`localParts` (Task 5), `timezoneForCity` (Task 3).
- Produces (dipakai Task 8, 9):
  - `sweep(db, config, { now = Date.now(), timesByCity = {} } = {}) -> { sends: Send[], skipped: { jid, reason }[] }` dengan `reason ∈ 'unknown-timezone' | 'no-times'`
  - `Send = { jid, cityId, cityName, timezone, prayer, time, date, text }`
  - `markSent(db, send) -> boolean`
  - `buildMessage(sub, prayer, time) -> string`
  - `formatTimes(sub, times) -> string`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/sholat.test.js`. **Menguji Review Focus 2 & 5.**

```js
import { sweep, markSent, buildMessage, formatTimes } from '../lib/sholat.js';

const CONFIG = { sholat: { graceMinutes: 30, prayers: PRAYERS } };
const JKT = '628111@s.whatsapp.net';
const MKS = '628222@s.whatsapp.net';

test('sweep: dua pelanggan beda zona memakai zona waktunya masing-masing', () => {
  // Review Focus 5 — pada instan yang sama, WIB 17:49 == WITA 18:49
  const db = fakeDb();
  subscribe(db, JKT, CITIES[0], { now: 0 }); // Jakarta
  subscribe(db, MKS, CITIES[1], { now: 0 }); // Makassar
  const now = Date.parse('2026-10-17T10:49:00Z');
  const plan = sweep(db, CONFIG, {
    now,
    timesByCity: {
      '1301': { subuh: '04:15', dzuhur: '11:42', ashar: '14:48', maghrib: '17:49', isya: '18:58' },
      '2622': { subuh: '04:52', dzuhur: '12:19', ashar: '15:25', maghrib: '18:49', isya: '19:58' },
    },
  });
  assert.equal(plan.sends.length, 2);
  const byJid = Object.fromEntries(plan.sends.map((s) => [s.jid, s]));
  assert.equal(byJid[JKT].prayer, 'maghrib');
  assert.equal(byJid[JKT].time, '17:49');
  assert.equal(byJid[JKT].timezone, 'Asia/Jakarta');
  assert.equal(byJid[MKS].time, '18:49');
  assert.equal(byJid[MKS].timezone, 'Asia/Makassar');
  assert.equal(byJid[JKT].date, '2026-10-17');
  assert.match(byJid[JKT].text, /MAGHRIB/);
  assert.deepEqual(plan.skipped, []);
});

test('sweep: pelanggan tanpa jadwal / zona waktu tak dikenal dilewati & dicatat', () => {
  // Review Focus 2
  const db = fakeDb();
  subscribe(db, JKT, CITIES[0], { now: 0 });
  db.data.sholat['628333@s.whatsapp.net'] = {
    jid: '628333@s.whatsapp.net', cityId: '9999', cityName: 'NGACO', timezone: '', enabled: true, sent: { date: '', keys: [] },
  };
  const plan = sweep(db, CONFIG, { now: Date.parse('2026-10-17T10:49:00Z'), timesByCity: {} });
  assert.deepEqual(plan.sends, []);
  assert.deepEqual(plan.skipped.map((s) => s.reason).sort(), ['no-times', 'unknown-timezone']);
});

test('markSent idempoten dan reset saat tanggal berganti', () => {
  const db = fakeDb();
  subscribe(db, JKT, CITIES[0], { now: 0 });
  const send = { jid: JKT, prayer: 'maghrib', date: '2026-10-17' };
  markSent(db, send);
  markSent(db, send);
  assert.deepEqual(getSubscription(db, JKT).sent, { date: '2026-10-17', keys: ['maghrib'] });
  markSent(db, { jid: JKT, prayer: 'subuh', date: '2026-10-18' });
  assert.deepEqual(getSubscription(db, JKT).sent, { date: '2026-10-18', keys: ['subuh'] });
});

test('buildMessage & formatTimes: teks persis seperti spec', () => {
  const sub = { cityName: 'KOTA JAKARTA', timezone: 'Asia/Jakarta' };
  assert.equal(buildMessage(sub, 'maghrib', '17:49'), '🕌 *WAKTU SHOLAT — MAGHRIB*\n🕐 17:49 WIB\n📍 KOTA JAKARTA');
  assert.equal(
    formatTimes(sub, TIMES),
    '🕌 *JADWAL SHOLAT — KOTA JAKARTA*\n📍 Zona waktu: WIB\n\n• Subuh: 04:15\n• Dzuhur: 11:42\n• Ashar: 14:48\n• Maghrib: 17:49\n• Isya: 18:58',
  );
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/sholat.test.js`
Expected: FAIL — `sweep` belum ada.

- [ ] **Step 3: Implementasi**

- `buildMessage(sub, prayer, time)` dan `formatTimes(sub, times)` menghasilkan **teks persis** seperti test di Step 1 (label dari `PRAYER_LABEL`, zona dari `TZ_LABEL[sub.timezone] ?? sub.timezone`; `formatTimes` melewati waktu yang tidak ada).
- `sweep`: untuk tiap `listActiveSubscriptions(db)`: `tz = sub.timezone || timezoneForCity(sub.cityId)`; bila kosong → `skipped.push({ jid, reason: 'unknown-timezone' })`; `times = timesByCity[sub.cityId]`; bila kosong → `skipped.push({ jid, reason: 'no-times' })`; selain itu untuk tiap `duePrayers({ ...sub, timezone: tz }, times, { now, graceMinutes: config.sholat.graceMinutes, prayers: config.sholat.prayers })` dorong `Send` lengkap (termasuk `date` dari `localParts`). **`sweep` tidak menandai apa pun** — penandaan dilakukan pemanggil setelah kirim sukses (spec D4).
- `markSent(db, send)`: reset `sent` bila `sent.date !== send.date`, dorong `prayer` bila belum ada, `db.touch()`, kembalikan `false` bila langganan tak ada.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node --test tests/sholat.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sholat.js tests/sholat.test.js
git commit -m "feat(sholat): sweep, penandaan terkirim, dan format pesan"
```

---

### Task 7: `lib/sholat-source.js` — API + cache

**Files:**
- Create: `lib/sholat-source.js`
- Test: `tests/sholat-source.test.js`

**Interfaces:**
- Consumes: `config.sholat.apiBase`, `config.sholat.timeoutMs` (Task 1); `PRAYERS` (Task 3).
- Produces (dipakai Task 8, 9):
  - `fetchCities(config, { json } = {}) -> Promise<{id,name}[]>`
  - `fetchDayTimes(config, cityId, dateStr, { json } = {}) -> Promise<{ cityId, date, times }>` (`times` adalah `Record<prayer, 'HH:MM'>`)
  - `clearCache() -> void`
  - `json` default `fetchJson` dari `lib/functions.js` — helper repo yang sudah menangani timeout (`AbortSignal.timeout`), cek `response.ok`, dan parsing JSON; disuntik test supaya tidak menyentuh jaringan.

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/sholat-source.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCities, fetchDayTimes, clearCache } from '../lib/sholat-source.js';

const CFG = { sholat: { apiBase: 'https://contoh.invalid/v2', timeoutMs: 1000 } };
/** Stub `fetchJson`: menerima url, mengembalikan payload siap pakai (bukan Response). */
const stub = (payload) => async () => payload;

test('fetchCities memetakan payload dan memakai cache', async () => {
  clearCache();
  let calls = 0;
  const json = async () => {
    calls += 1;
    return { status: true, data: [{ id: '1301', lokasi: 'KOTA JAKARTA' }] };
  };
  assert.deepEqual(await fetchCities(CFG, { json }), [{ id: '1301', name: 'KOTA JAKARTA' }]);
  assert.deepEqual(await fetchCities(CFG, { json }), [{ id: '1301', name: 'KOTA JAKARTA' }]);
  assert.equal(calls, 1, 'panggilan kedua harus dari cache');
});

test('fetchCities melempar saat status:false atau jaringan gagal', async () => {
  clearCache();
  await assert.rejects(() => fetchCities(CFG, { json: stub({ status: false, data: null }) }));
  await assert.rejects(() => fetchCities(CFG, { json: async () => { throw new Error('putus'); } }));
});

test('fetchDayTimes memetakan jadwal dan cache per kota per hari', async () => {
  clearCache();
  let calls = 0;
  const json = async (url, options) => {
    calls += 1;
    assert.match(String(url), /\/sholat\/jadwal\/1301\/2026\/10\/17$/);
    assert.equal(options.timeout, 1000, 'timeout dari config diteruskan ke fetchJson');
    return {
      status: true,
      data: { id: 1301, lokasi: 'KOTA JAKARTA', daerah: 'DKI JAKARTA', jadwal: {
        tanggal: 'Sabtu, 17/10/2026', imsak: '04:05', subuh: '04:15', terbit: '05:28', dhuha: '05:55',
        dzuhur: '11:42', ashar: '14:48', maghrib: '17:49', isya: '18:58', date: '2026-10-17',
      } },
    };
  };
  const hasil = await fetchDayTimes(CFG, '1301', '2026-10-17', { json });
  assert.deepEqual(hasil, { cityId: '1301', date: '2026-10-17', times: {
    subuh: '04:15', dzuhur: '11:42', ashar: '14:48', maghrib: '17:49', isya: '18:58',
  } });
  await fetchDayTimes(CFG, '1301', '2026-10-17', { json });
  assert.equal(calls, 1);
});

test('fetchDayTimes melempar bila field jadwal kurang', async () => {
  clearCache();
  const json = stub({ status: true, data: { jadwal: { subuh: '04:15', dzuhur: '11:42' } } });
  await assert.rejects(() => fetchDayTimes(CFG, '1301', '2026-10-17', { json }));
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/sholat-source.test.js`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi `lib/sholat-source.js`**

- Cache modul-level: `{ at, items }` untuk katalog (TTL 7 hari sebagai konstanta modul) dan `Map` `"${cityId}:${dateStr}"` untuk jadwal harian. `clearCache()` mengosongkan keduanya (dipakai test).
- Panggilan jaringan memakai `fetchJson(url, { timeout: config.sholat.timeoutMs })` dari `lib/functions.js` — timeout (`AbortSignal.timeout`), cek `response.ok`, dan parsing JSON sudah ditangani di sana. `lib/sholat-source.js` hanya menambahkan cek khas MyQuran: `payload.status === true`.
- `fetchCities` mengembalikan `data.map((d) => ({ id: String(d.id), name: String(d.lokasi) }))`.
- `fetchDayTimes` membangun URL `${config.sholat.apiBase}/sholat/jadwal/${cityId}/${y}/${m}/${d}` dari `dateStr`; ambil **hanya** kunci `PRAYERS`; bila ada yang hilang → `throw`.
- Jangan menyimpan hasil gagal ke cache.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node --test tests/sholat-source.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sholat-source.js tests/sholat-source.test.js
git commit -m "feat(sholat): klien MyQuran + cache katalog & jadwal harian"
```

---

### Task 8: `plugins/sholat.js` — perintah user

**Files:**
- Create: `plugins/sholat.js`
- Test: `tests/sholat-plugins.test.js`

**Interfaces:**
- Consumes: `db.data.sholat` (Task 2), `resolveCity`/`subscribe`/`unsubscribe`/`getSubscription`/`formatTimes` (Task 3–6), `fetchCities`/`fetchDayTimes` (Task 7), `config.sholat` (Task 1).
- Produces: plugin dengan `handler.command = /^(sholat|salat|shalat)$/i`, `handler.tags = ['islami']`, `handler.help = ['sholat']`, `handler.limit = false`, `export default handler`.
- Perilaku per sub-perintah: `daftar <daerah>` · `jadwal` · `stop` · tanpa argumen = bantuan + status langganan.

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/sholat-plugins.test.js`. Ikuti pola harness `tests/rent-plugins.test.js` (Database + PluginManager + `handleMessage` + `conn.sendMessage` palsu + helper `reply()`), **dengan tambahan**: `db.user(SENDER).dmIntroSentAt = Date.now()` (supaya intro DM tidak menempati balasan pertama) dan `config.sholat.apiBase` diarahkan ke server HTTP lokal seperti di bawah.

```js
import http from 'node:http';

/** Server tiruan MyQuran; kembalikan { base, close }. */
async function startFakeApi() {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/v2/sholat/kota/semua')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ status: true, data: [
        { id: '1301', lokasi: 'KOTA JAKARTA' },
        { id: '2622', lokasi: 'KOTA MAKASSAR' },
        { id: '3211', lokasi: 'KOTA SOFIFI' },
        { id: '3212', lokasi: 'KOTA SOFIFI' },
      ] }));
    }
    const m = url.match(/^\/v2\/sholat\/jadwal\/(\d+)\//);
    if (m) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ status: true, data: { id: Number(m[1]), lokasi: 'KOTA UJI', daerah: 'DKI JAKARTA', jadwal: {
        subuh: '04:15', dzuhur: '11:42', ashar: '14:48', maghrib: '17:49', isya: '18:58', date: '2026-10-17',
      } } }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}/v2`, close: () => new Promise((r) => server.close(r)) };
}
```

Test yang harus ada (setiap test memanggil `startFakeApi()` lalu `close()` di akhir):

1. `.sholat` → balasan memuat cara pakai (mis. cocok `/daftar/i`) dan, bila belum berlangganan, ajakan mendaftar.
2. `.sholat daftar makassar` → `db.data.sholat[SENDER].cityId === '2622'`; balasan memuat `MAKASSAR`.
3. `.sholat daftar sofifi` (dua kotak bernama sama) → balasan memuat **kedua** id `3211` dan `3212`; `db.data.sholat[SENDER]` tetap kosong.
4. `.sholat daftar 1301` → berlangganan `KOTA JAKARTA` walau namanya tidak disebut.
5. `.sholat daftar ngawur` → balasan ramah (mis. `/tidak (ditemukan|ketemu)/i`), tidak ada langganan.
6. `.sholat jadwal` → balasan memuat ke-5 waktu (`04:15`, `11:42`, `14:48`, `17:49`, `18:58`).
7. `.sholat stop` → langganan terhapus.
8. **Review Focus 1** — server menyajikan katalog berbentuk nyata (`KAB. LIMA PULUH KOTA` + 20 kota `KOTA UJI <n>`); `.sholat daftar kota` → **tidak** langsung berlangganan, balasan menyebut `maxCandidates` kandidat + `/dan \d+ lainnya/`, dan memberi saran menulis nama lebih lengkap. (Query `uji` tidak cukup: ia tidak berakhiran cocok, jadi tidak menangkap bug "berhenti di tingkat pertama".)
9. **Dipakai dari grup** — `.sholat daftar makassar` dikirim dari chat `@g.us` → langganan tetap tercatat untuk JID **pengirim** (`SENDER`), bukan JID grup (spec §12).
10. **Identitas LID** — pengirim `271446714642565@s.whatsapp.net` yang terpetakan di `lidMap` → langganan tersimpan di nomor telepon asli, dan `.sholat stop` dari nomor itu menemukannya (spec §7, risiko #4).
11. **API mati** — katalog gagal → balasan ramah; jadwal gagal saat `daftar` → **tidak** ada langganan setengah jalan.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/sholat-plugins.test.js`
Expected: FAIL — `plugins/sholat.js` belum ada.

- [ ] **Step 3: Implementasi `plugins/sholat.js`**

- Baca komponen pertama `args[0]?.toLowerCase()`; tanpa argumen → bantuan + status.
- `daftar`: `jid = db.resolveIdentity(m.sender)`; `cities = await fetchCities(config)`; `hasil = resolveCity(cities, text setelah 'daftar')`. `null` → pesan ramah. `ambiguous` → tampilkan maksimal `config.sholat.maxCandidates` baris `• NAMA (id)`, lalu `…dan N lainnya` (plus saran menulis nama lebih lengkap bila terpotong). `city` → cek `timezoneForCity` → `fetchDayTimes` (jadwal hari ini) → `subscribe(db, jid, city)` → balas `formatTimes(...)` + catatan bahwa pengingat dikirim ke DM.
- `jadwal`: `getSubscription`; bila kosong → ajakan daftar; selain itu `fetchDayTimes` untuk hari ini lalu `formatTimes`.
- `stop`: `unsubscribe(db, jid)`; balas sesuai hasil.
- Semua kegagalan jaringan ditangkap dan dijawab dengan pesan ramah (jangan melempar ke handler).
- Kunci langganan selalu `db.resolveIdentity(m.sender)`, bukan `m.sender` mentah (lihat catatan identitas di bagian atas rencana).
- `handler.tags = ['islami']`, `handler.limit = false` — patuhi konvensi `tests/plugins-conventions.test.js`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node --test tests/sholat-plugins.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/sholat.js tests/sholat-plugins.test.js
git commit -m "feat(sholat): plugin perintah .sholat daftar/jadwal/stop"
```

---

### Task 9: `main.js` — sweep + kirim DM

**Files:**
- Create: `lib/sholat-runner.js` (orkestrasi sweep — dipisah supaya urutan "kirim dulu, tandai kemudian" bisa diuji tanpa socket)
- Modify: `main.js` (menyusul blok sweep rent, ~baris 161–177: panggil runner dari `setInterval`)

**Interfaces:**
- Consumes: `sweep`/`markSent`/`listActiveSubscriptions`/`localParts`/`timezoneForCity` (Task 6), `fetchDayTimes` (Task 7), `config.sholat` (Task 1).
- Produces: `runSholatSweep(db, config, socket, { now, logger, fetchTimes }) -> Promise<{sends, skipped}>`.

> **Catatan penyimpangan dari rencana awal:** orkestrasi sweep tidak ditulis inline di `main.js`, tapi di `lib/sholat-runner.js`. Alasannya: `main.js` tidak bisa diimpor test (ia langsung menyambung ke WhatsApp), sehingga jaminan inti spec D4 — "tandai terkirim HANYA setelah DM benar-benar sukses" — tidak akan pernah teruji. Dengan dipisah, `tests/sholat-runner.test.js` bisa membuktikan DM yang gagal tidak ditandai dan dicoba lagi siklus berikutnya. `main.js` tinggal memanggilnya dari `setInterval`.

- [ ] **Step 1: Implementasi runner**

Buat `lib/sholat-runner.js`: ambil jadwal tiap kota yang dilanggan (sekali per kota per siklus; kota yang gagal dilewati tanpa menghentikan yang lain), panggil `sweep`, laporkan `skipped`, lalu kirim DM **dan baru menandai terkirim setelah `sendMessage` selesai tanpa error**. Kegagalan dilaporkan lewat `logger.warn` — tapi sekali saja per kunci (kota+tanggal, jid+alasan, jid+waktu+tanggal) supaya log tidak dibanjiri tiap menit.

Kemudian di `main.js`, tepat setelah blok sweep rent:

```js
// ── Sweep jadwal sholat: kirim DM saat waktu sholat tiba ────────────────
// Orkestrasinya ada di lib/sholat-runner.js (bisa diuji tanpa socket). Jadwal
// tiap kota di-cache per hari oleh lib/sholat-source.js, jadi satu kota hanya
// memanggil API sekali sehari walau sweep berjalan tiap menit.
if (config.sholat?.enabled !== false) {
  let sholatSweepRunning = false;

  setInterval(async () => {
    const socket = globalThis.conn;
    if (!socket || sholatSweepRunning) return;

    sholatSweepRunning = true;
    try {
      await runSholatSweep(db, config, socket, { logger });
    } catch (err) {
      logger.error(`[sholat] sweep: ${err.message}`);
    } finally {
      sholatSweepRunning = false;
    }
  }, config.sholat.sweepIntervalMs).unref?.();
}
```

Tambahkan import di bagian atas `main.js` bersama import lain:

```js
import { runSholatSweep } from './lib/sholat-runner.js';
```

- [ ] **Step 2: Verifikasi sintaks**

Run: `npm run check`
Expected: semua file lolos (jumlah file naik karena 5 file baru).

- [ ] **Step 3: Verifikasi smoke (mode tanpa koneksi)**

Run: `npm run smoke`
Expected: keluar dengan kode 0, tanpa error; tidak ada panggilan jaringan karena `globalThis.conn` kosong.

- [ ] **Step 4: Verifikasi seluruh test**

Run: `npm test`
Expected: seluruh test lulus (`fail 0`), termasuk `tests/sholat.test.js`, `tests/sholat-source.test.js`, `tests/sholat-plugins.test.js`, `tests/sholat-runner.test.js`, `tests/database.test.js`, dan `tests/plugins-conventions.test.js`.

- [ ] **Step 5: Commit**

```bash
git add main.js lib/sholat-runner.js tests/sholat-runner.test.js
git commit -m "feat(sholat): sweep berkala + kirim DM"
```
