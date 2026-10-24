# Bugfix Audit Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perbaiki 5 bug hasil audit (sewa, mode, spam bukti bayar, SSRF, filter NSFW) tanpa mengubah arsitektur.

**Architecture:** Lima perubahan kecil di alur yang sudah ada. Tidak ada file baru, tidak ada dependency baru. Satu helper murni ditambahkan ke `lib/functions.js` agar bisa dites tanpa jaringan.

**Tech Stack:** Node.js >= 20.11 (ESM), `node:test` + `node:assert/strict`, Baileys, yt-dlp.

**Spec:** Tidak ada spec terpisah — scope disetujui di chat (5 fix, opsi "5 fix"). Sumber temuan: audit repo 2026-10-24.

## Global Constraints

- Node >= 20.11, ESM (`import`), tanpa dependency baru.
- Test memakai `node:test` + `node:assert/strict`, dijalankan `npm test` (`node --test`).
- Pesan ke user tetap Bahasa Indonesia, mengikuti gaya `m.reply` yang ada.
- Jangan refactor di luar 5 fix ini. Jangan ubah `activateRent`/`extendRent` (bug "renew menghitung dari now" = di luar scope).
- Setiap task diakhiri commit sendiri.

## Review Focus

- `.renew` pada sewa yang **sudah expired** harus tetap jadi `pending` (bukan `active`).
- `.renew` oleh bukan penyewa tetap ditolak (cek di `plugins/rent.js:143`).
- `settings.mode` berisi nilai rusak (bukan `self`/`public`) harus diabaikan, bot tetap `public`.
- Pesan bukti bayar dari user tanpa rental `pending` tidak boleh diteruskan ke owner.
- URL seperti `https://youtube.com.evil.com/x` dan `http://127.0.0.1` harus ditolak.
- PurrBot harus tetap tersedia untuk SFW (hanya default NSFW yang berubah).

---

### Task 1: `.renew` tidak lagi mengunci grup yang masih aktif

**Files:**
- Modify: `lib/rent.js:64-73` (`requestRent`)
- Test: `tests/rent.test.js`

**Interfaces:**
- Consumes: `getRental`, `emptyRental`, `setRental` (sudah ada di file yang sama).
- Produces: `requestRent(db, groupJid, { renter, renterName })` — perilaku baru: bila rental berstatus `active` dan `expiresAt` masih di masa depan, status dipertahankan `active` dan `renewalRequestedAt` diisi.

**Kenapa:** `plugins/rent.js:146` memanggil `Rent.requestRent` saat `.renew`. Fungsi itu menimpa `status = 'pending'` (`lib/rent.js:66`), sedangkan gating hanya meloloskan `active` (`lib/rent.js:181`), jadi grup yang masih berbayar langsung terkunci.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan di `tests/rent.test.js`:

```js
test('requestRent: renewal pada sewa aktif tidak mengunci grup', () => {
  const db = fakeDb({
    rentals: {
      '120363000000000001@g.us': {
        status: 'active',
        renter: '628111@s.whatsapp.net',
        renterName: 'Budi',
        startedAt: Date.now() - 5 * DAY,
        expiresAt: Date.now() + 10 * DAY,
        reminders: { '3': '2026-10-01' },
        history: [],
      },
    },
  });

  const rental = Rent.requestRent(db, '120363000000000001@g.us', { renter: '628111@s.whatsapp.net' });

  assert.equal(rental.status, 'active', 'grup yang masih aktif tidak boleh jadi pending');
  assert.ok(rental.renewalRequestedAt > 0, 'penanda permintaan perpanjangan harus diisi');
  assert.deepEqual(rental.reminders, { '3': '2026-10-01' }, 'reminder periode berjalan tidak boleh direset');
});

test('requestRent: sewa kadaluarsa tetap jadi pending', () => {
  const db = fakeDb({
    rentals: {
      '120363000000000002@g.us': {
        status: 'active',
        renter: '628222@s.whatsapp.net',
        expiresAt: Date.now() - DAY,
        history: [],
      },
    },
  });

  const rental = Rent.requestRent(db, '120363000000000002@g.us', { renter: '628222@s.whatsapp.net' });

  assert.equal(rental.status, 'pending');
  assert.equal(rental.renewalRequestedAt, undefined);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/rent.test.js`
Expected: FAIL pada tes pertama (`active` menjadi `pending`) dan tes kedua (`renewalRequestedAt` terisi).

- [ ] **Step 3: Implementasi di `lib/rent.js`**

Ganti isi `requestRent` menjadi:

```js
export function requestRent(db, groupJid, { renter, renterName = '' } = {}) {
  const rental = getRental(db, groupJid) || emptyRental();
  const stillActive = rental.status === 'active' && Number(rental.expiresAt) > Date.now();
  if (stillActive) {
    // Perpanjangan tidak boleh memutus akses yang sudah dibayar.
    rental.renewalRequestedAt = Date.now();
  } else {
    rental.status = 'pending';
    rental.reminders = {};
  }
  rental.renter = cleanJid(renter);
  rental.renterName = renterName;
  rental.history.push({ at: Date.now(), action: stillActive ? 'renew-request' : 'request', by: cleanJid(renter) });
  setRental(db, groupJid, rental);
  return rental;
}
```

- [ ] **Step 4: Jalankan tes**

Run: `node --test tests/rent.test.js`
Expected: PASS semua (termasuk tes lama `requestRent: status pending + renter tersimpan`).

- [ ] **Step 5: Commit**

```bash
git add lib/rent.js tests/rent.test.js
git commit -m "fix(rent): renewal tidak mengunci grup yang masih aktif"
```

---

### Task 2: `.mode self` bertahan setelah restart

**Files:**
- Modify: `lib/functions.js` (tambah export baru di dekat helper lain)
- Modify: `main.js:56-57` (setelah `initDatabase`)
- Test: `tests/functions.test.js`

**Interfaces:**
- Produces: `applyStoredSettings(config, data) -> 'self' | 'public'` — menyalin `data.settings.mode` ke `config.bot.mode` bila nilainya valid.
- Consumes di `main.js`: `config`, `db` (hasil `initDatabase`).

**Kenapa:** `plugins/owner-mode.js:18` menulis `db.data.settings.mode`, tapi `config.js:45` hanya membaca flag CLI. Setelah restart, bot kembali `public` tanpa pemberitahuan.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan di `tests/functions.test.js`:

```js
import { applyStoredSettings } from '../lib/functions.js';

test('applyStoredSettings: mode self dari database dipulihkan', () => {
  const config = { bot: { mode: 'public' } };
  assert.equal(applyStoredSettings(config, { settings: { mode: 'self' } }), 'self');
  assert.equal(config.bot.mode, 'self');
});

test('applyStoredSettings: nilai rusak diabaikan', () => {
  const config = { bot: { mode: 'public' } };
  assert.equal(applyStoredSettings(config, { settings: { mode: 'hacker' } }), 'public');
  assert.equal(applyStoredSettings(config, null), 'public');
});
```

(Sesuaikan import yang sudah ada di file itu; jangan menambah baris import ganda.)

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/functions.test.js`
Expected: FAIL — `applyStoredSettings` belum ada / bukan export.

- [ ] **Step 3: Implementasi**

Di `lib/functions.js`:

```js
/** Pulihkan pengaturan owner yang tersimpan di database saat startup. */
export function applyStoredSettings(config, data) {
  const mode = data?.settings?.mode;
  if (mode === 'self' || mode === 'public') config.bot.mode = mode;
  return config.bot.mode;
}
```

Di `main.js`, setelah `const db = await initDatabase(config, logger);`:

```js
applyStoredSettings(config, db.data);
```

Tambahkan `applyStoredSettings` ke import `./lib/functions.js` yang sudah ada di `main.js`.

- [ ] **Step 4: Jalankan tes**

Run: `node --test tests/functions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/functions.js main.js tests/functions.test.js
git commit -m "fix(mode): pulihkan settings.mode dari database saat startup"
```

---

### Task 3: Throttle bukti bayar ke owner

**Files:**
- Modify: `plugins/rent.js:297-321` (`handler.all`)
- Test: `tests/rent-plugins.test.js`

**Interfaces:**
- Consumes: field `lastProofAt` yang sudah ada (`lib/rent.js:270`).
- Produces: tidak ada API baru; `handler.all` mengabaikan bukti bila `Date.now() - lastProofAt < 10 menit`.

**Kenapa:** `lastProofAt` ditulis tapi tidak pernah dibaca. Siapa pun yang `.rent <grup>` bisa membanjiri DM owner tanpa batas.

- [ ] **Step 1: Tulis tes yang gagal**

Di `tests/rent-plugins.test.js`, pakai harness `setup()` yang sudah ada (mengembalikan `{ db, conn, config, sent }`). Tambahkan import `rentPlugin from '../plugins/rent.js';` di bagian import.

```js
test('bukti bayar di-throttle 10 menit', async () => {
  const t = await setup();
  const sender = '628333@s.whatsapp.net';
  Rent.requestRent(t.db, GROUP, { renter: sender, renterName: 'Siti' });

  const m = {
    isGroup: false, fromMe: false, sender, pushName: 'Siti',
    mtype: 'conversation', text: 'sudah transfer',
    download: async () => null,
  };
  const owners = t.config.bot.ownerJids.length;

  let before = t.sent.length;
  await rentPlugin.all(m, { db: t.db, conn: t.conn, config: t.config });
  assert.equal(t.sent.length - before, owners, 'bukti pertama diteruskan');

  before = t.sent.length;
  await rentPlugin.all(m, { db: t.db, conn: t.conn, config: t.config });
  assert.equal(t.sent.length - before, 0, 'bukti kedua dalam 10 menit tidak diteruskan');

  t.db.data.rentals[GROUP].lastProofAt = Date.now() - 11 * 60 * 1000;
  before = t.sent.length;
  await rentPlugin.all(m, { db: t.db, conn: t.conn, config: t.config });
  assert.equal(t.sent.length - before, owners, 'setelah 10 menit diteruskan lagi');
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/rent-plugins.test.js`
Expected: FAIL pada assert kedua (`sent.length` = jumlah owner, bukan 0).

- [ ] **Step 3: Implementasi**

Di `plugins/rent.js`, tambah konstanta di atas `handler.all` dan filter `pendings`:

```js
const PROOF_THROTTLE_MS = 10 * 60 * 1000;
```

Ubah filter menjadi:

```js
const now = Date.now();
const pendings = Object.entries(db.data.rentals || {}).filter(
  ([, r]) => r.status === 'pending' && r.renter === m.sender && now - (r.lastProofAt || 0) >= PROOF_THROTTLE_MS,
);
if (!pendings.length) return;
```

Lalu `for (const [, r] of pendings) r.lastProofAt = now;` (pakai `now`, bukan `Date.now()` lagi).

- [ ] **Step 4: Jalankan tes**

Run: `node --test tests/rent-plugins.test.js`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add plugins/rent.js tests/rent-plugins.test.js
git commit -m "fix(rent): throttle bukti bayar 10 menit per rental"
```

---

### Task 4: Tolak URL non-YouTube sebelum masuk yt-dlp (SSRF)

**Files:**
- Modify: `lib/functions.js` (helper baru `isYoutubeUrl`)
- Modify: `plugins/downloader-ytmp3.js:41-47` (`resolveVideo`) — dipakai juga oleh `downloader-ytmp4.js:22`
- Test: `tests/functions.test.js`

**Interfaces:**
- Produces: `isYoutubeUrl(text) -> boolean`; `resolveVideo` melempar `Error` bila `isUrl(value)` true tapi bukan host YouTube.
- Consumes: `isUrl` (sudah ada, `lib/functions.js:73`).

**Kenapa:** `isUrl` hanya mencocokkan `^https?://`, lalu URL diteruskan ke yt-dlp (`lib/media.js:1055`) — bisa dipakai mengambil `127.0.0.1` / `169.254.169.254`.

- [ ] **Step 1: Tulis tes yang gagal**

Di `tests/functions.test.js`:

```js
import { isYoutubeUrl } from '../lib/functions.js';

test('isYoutubeUrl: hanya host YouTube', () => {
  assert.equal(isYoutubeUrl('https://youtu.be/abc'), true);
  assert.equal(isYoutubeUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isYoutubeUrl('https://m.youtube.com/watch?v=abc'), true);
  assert.equal(isYoutubeUrl('https://youtube.com.evil.com/watch?v=abc'), false);
  assert.equal(isYoutubeUrl('http://127.0.0.1:8080/x'), false);
  assert.equal(isYoutubeUrl('http://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isYoutubeUrl('bukan url'), false);
});
```

Tambahkan juga di file tes yang sama (import `resolveVideo` dari plugin):

```js
test('resolveVideo: URL non-YouTube ditolak tanpa jaringan', async () => {
  await assert.rejects(() => resolveVideo('http://127.0.0.1:8080/x', {}), /YouTube/);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/functions.test.js`
Expected: FAIL — `isYoutubeUrl` belum ada.

- [ ] **Step 3: Implementasi**

Di `lib/functions.js`:

```js
/** Host YouTube saja — mencegah URL internal diteruskan ke yt-dlp. */
export function isYoutubeUrl(text = '') {
  try {
    const host = new URL(String(text).trim()).hostname.toLowerCase();
    return /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/.test(host);
  } catch {
    return false;
  }
}
```

Di `plugins/downloader-ytmp3.js`, dalam `resolveVideo`, sebelum blok `if (isUrl(value))`:

```js
if (isUrl(value) && !isYoutubeUrl(value)) throw new Error('Hanya link YouTube yang didukung.');
```

Tambahkan `isYoutubeUrl` ke import `../lib/functions.js` di file itu.

- [ ] **Step 4: Jalankan tes**

Run: `node --test tests/functions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/functions.js plugins/downloader-ytmp3.js tests/functions.test.js
git commit -m "fix(downloader): hanya terima URL YouTube (cegah SSRF)"
```

---

### Task 5: PurrBot keluar dari default provider NSFW

**Files:**
- Modify: `config.js:180` (`NSFW_PROVIDERS` default)
- Modify: `.env.example:80`
- Modify: `README.md:643` (tabel provider NSFW)
- Test: `tests/image-source.test.js`

**Interfaces:**
- Tidak ada API baru. `config.image.providers.sfw` tetap memuat `purrbot`.

**Kenapa:** provider `purrbot` hanya mengisi `tags: [category]` (`lib/image-source.js:288-293`), sehingga `findBlockedTags` di `lib/image-source.js:472` tidak pernah bisa menolak hasilnya. Booru tetap punya filter tag.

- [ ] **Step 1: Tulis tes yang gagal**

Di `tests/image-source.test.js`:

```js
import { config } from '../config.js';

test('purrbot tidak dipakai sebagai provider NSFW default', () => {
  assert.ok(!config.image.providers.nsfw.includes('purrbot'));
  assert.ok(config.image.providers.sfw.includes('purrbot'), 'SFW tetap memakai purrbot');
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test tests/image-source.test.js`
Expected: FAIL pada assert pertama.

- [ ] **Step 3: Implementasi**

`config.js:180`:

```js
nsfw: envList('NSFW_PROVIDERS', ['danbooru', 'yandere']),
```

`.env.example:80`:

```
NSFW_PROVIDERS="danbooru,yandere"
```

`README.md:643` — baris tabel berubah menjadi:

```
| NSFW | `danbooru` (explicit) → `yandere` (explicit) |
```

- [ ] **Step 4: Jalankan tes**

Run: `node --test tests/image-source.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config.js .env.example README.md tests/image-source.test.js
git commit -m "fix(nsfw): purrbot bukan provider NSFW default (tidak bisa difilter tag)"
```

---

### Task 6: Verifikasi menyeluruh

- [ ] **Step 1: Jalankan seluruh tes**

Run: `npm test`
Expected: semua lulus, tidak ada regresi di 48 file tes.

- [ ] **Step 2: Cek sintaks**

Run: `npm run check`
Expected: lulus tanpa error.

- [ ] **Step 3: Review diff**

Run: `git diff HEAD~5 --stat` lalu `git log --oneline -6`
Expected: tepat 5 commit fix, tidak ada file tak terkait.
