# Fitur Jadwal Sholat via DM — Design Spec

**Tanggal:** 2026-10-17
**Status:** Desain disetujui — menunggu rencana implementasi
**Branch:** `feature/jadwal-sholat`

---

## 1. Latar belakang

Bot belum punya pengingat waktu sholat. Yang diinginkan: user **mendaftar dengan memilih daerah**, lalu bot **mengirim DM saat tiap waktu sholat tiba**.

Repo sudah punya seluruh primitif yang dibutuhkan, jadi ini penambahan yang mengikuti pola yang ada, bukan pembongkaran arsitektur:

| Primitif | Lokasi | Dipakai untuk |
|---|---|---|
| Sweep berkala + kirim DM | `main.js:161–177` (sweep sewa) | Pengiriman notifikasi |
| Koleksi database terpisah | `db.data.rentals` / `renters` | Menyimpan langganan |
| Config berbasis `env()` | `config.js` (blok `rent`, `game`, …) | `config.sholat` |
| Konvensi plugin | `plugins/*.js`, `const handler = async (m, ctx)` | Perintah `.sholat` |
| Logika murni + jam disuntik | `lib/rent.js` (`{ now }`), `sweepRentals` | Diuji tanpa jaringan |

## 2. Tujuan & kriteria sukses

**Tujuan:** user bisa berlangganan jadwal sholat untuk satu daerah, dan menerima DM otomatis pada tiap waktu sholat.

**Kriteria sukses:**

1. `.sholat daftar <daerah>` menyimpan langganan user untuk daerah yang dipilih.
2. DM terkirim otomatis pada 5 waktu wajib (Subuh, Dzuhur, Ashar, Maghrib, Isya).
3. Tepat **sekali** per waktu per hari — tidak dobel, termasuk setelah bot restart.
4. Jam yang dikirim **benar untuk zona waktu daerah tersebut** (WIB/WITA/WIT).
5. `.sholat stop` menghentikan langganan.
6. Server offline / API mati **tidak** membuat bot crash dan **tidak** membanjiri user dengan notifikasi basi.

## 3. Keputusan yang sudah disepakati

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Sumber jam & model daerah | **API publik + daftar kota bawaan** |
| 2 | Isi notifikasi & pengaturan | **5 waktu wajib saja, tanpa pengaturan** |
| 3 | Siapa yang boleh langganan | **Gratis & bebas** (tanpa `.daftar`, tanpa biaya limit) |
| 4 | Pendekatan teknis | **A — sweep + cache harian** (meniru sweep sewa) |

Konsekuensi yang mengikat: tidak ada penyimpanan per-waktu, tidak ada pengecekan `register: true`, tidak ada biaya limit, dan pengiriman **selalu lewat DM** (bukan grup).

## 4. Fakta eksternal terverifikasi

Sumber: **MyQuran API v2** (`https://api.myquran.com/v2`) — gratis, **tanpa API key**. Diverifikasi langsung pada 2026-10-17.

**4.1 Daftar daerah**

```
GET /v2/sholat/kota/semua
→ { "status": true, "data": [ { "id": "1301", "lokasi": "KOTA JAKARTA" }, … ] }   (~340 entri)
```

- `id` = 4 digit; **2 digit pertama = kode provinsi** (`01xx` Aceh … `34xx` Papua Barat).
- `lokasi` = nama kota/kabupaten berhuruf besar, berawalan `KOTA ` atau `KAB. `.
- **Ada nama duplikat.** Contoh terverifikasi: `KOTA SOFIFI` muncul dua kali (id `3211` dan `3212`).

**4.2 Jadwal harian**

```
GET /v2/sholat/jadwal/{id}/{yyyy}/{mm}/{dd}
→ { "status": true, "data": { "id": 1301, "lokasi": "KOTA JAKARTA", "daerah": "DKI JAKARTA",
     "jadwal": { "tanggal": "Sabtu, 17/10/2026", "imsak": "04:05", "subuh": "04:15",
                 "terbit": "05:28", "dhuha": "05:55", "dzuhur": "11:42", "ashar": "14:48",
                 "maghrib": "17:49", "isya": "18:58", "date": "2026-10-17" } } }
```

- Yang dipakai: `subuh`, `dzuhur`, `ashar`, `maghrib`, `isya` (format `"HH:MM"`, waktu lokal kota).
- `imsak`, `terbit`, `dhuha` **tidak** dipakai.
- **API tidak menyediakan zona waktu.** `daerah` = nama provinsi, hanya muncul di respons jadwal (endpoint `/v2/sholat/kota/{id}` tidak memberikannya).

## 5. Non-tujuan (sengaja tidak dikerjakan)

- Pilihan per-waktu (mis. hanya Subuh & Maghrib).
- Pengingat sebelum adzan.
- Audio adzan / aset media apa pun.
- Broadcast ke grup (pengiriman hanya DM).
- Kalender hijriah, arah kiblat, jadwal imsakiyah Ramadan.
- Perintah owner untuk melihat statistik pelanggan.

## 6. Arsitektur

```
plugins/sholat.js       I/O pengguna: .sholat [daftar|jadwal|stop]
lib/sholat-runner.js    I/O: orkestrasi sweep (ambil jadwal -> kirim DM -> tandai)
lib/sholat-source.js    I/O jaringan: panggil MyQuran + cache (dapat di-stub saat test)
lib/sholat.js           LOGIKA MURNI + helper langganan (jam disuntik { now, times })
main.js                 setInterval -> panggil runner (meniru sweep sewa)
config.js               blok config.sholat (semua dapat di-override via env)
lib/database.js         koleksi baru db.data.sholat
tests/sholat.test.js    unit test logika murni
tests/sholat-runner.test.js  test orkestrasi: urutan "kirim dulu, tandai kemudian" (D4)
```

**Prinsip pemisahan:** `lib/sholat.js` tidak pernah memanggil jaringan. Ia menerima data jadwal sebagai argumen, sehingga bisa diuji sepenuhnya dengan jam palsu dan jadwal palsu. `lib/sholat-source.js` adalah satu-satunya modul yang menyentuh `fetch`. `lib/sholat-runner.js` yang menjembatani keduanya, persis seperti `sweepRentals` yang mengembalikan rencana lalu pemanggilnya yang mengirim. Runner dipisah dari `main.js` (yang tidak bisa diimpor test karena langsung menyambung ke WhatsApp) supaya jaminan D4 bisa diuji: DM yang gagal tidak ditandai terkirim dan dicoba lagi siklus berikutnya.

## 7. Model data

Koleksi baru `db.data.sholat` — objek berkunci JID user:

```js
db.data.sholat = {
  '628123456789@s.whatsapp.net': {
    jid: '628123456789@s.whatsapp.net',
    cityId: '2622',
    cityName: 'KOTA MAKASSAR',
    timezone: 'Asia/Makassar',
    enabled: true,
    createdAt: 1760000000000,
    updatedAt: 1760000000000,
    sent: { date: '2026-10-17', keys: ['subuh', 'dzuhur'] },
  },
}
```

Catatan bentuk:

- Kunci = hasil `db.resolveIdentity(sender)` supaya konsisten dengan penyelesaian LID→nomor telepon yang sudah ada (lihat `lib/database.js`).
- `sent` hanya menyimpan **tanggal berjalan** (`date` + `keys`), direset saat tanggal berganti → penyimpanan tidak membengkak.
- Satu user = satu langganan (ganti daerah = menimpa, bukan menambah).

**Perubahan `lib/database.js`:**

1. `DEFAULT_DATA()`: tambah `sholat: {}`.
2. Loop normalisasi di `load()`: tambah `'sholat'` ke daftar `['users', 'chats', 'rentals', 'renters', …]`.

## 8. Alur

### 8.1 Daftar

```
user: .sholat daftar makassar
  → resolveIdentity(sender)              // lib/database.js
  → resolveCity(cachedCities, 'makassar') // lib/sholat.js (murni)
       ├─ 0 cocok  → balas "daerah tidak ditemukan"
       ├─ >1 cocok → balas daftar kandidat + id, minta user pakai id (TIDAK memilih diam-diam)
       └─ 1 cocok  → lanjut
  → fetchDayTimes(cityId, hariIni)        // lib/sholat-source.js (validasi + ambil provinsi)
  → timezoneForCity(cityId)               // dari 2 digit kode provinsi
  → simpan ke db.data.sholat + db.touch()
  → balas jadwal hari ini + konfirmasi
```

### 8.2 Sweep (tiap 60 detik)

```
main.js setInterval(SHOLAT_SWEEP_MS):
  if (!globalThis.conn) return                        // --no-connect aman
  if (sweepSedangJalan) return                        // cegah tumpang-tindih
  if (tidak ada pelanggan aktif) return               // keluar lebih awal
  → kumpulkan cityId unik dari pelanggan aktif
  → untuk tiap cityId: pastikan jadwal hari ini ter-cache (maks 1 panggilan API/kota/hari)
  → Sholat.sweep(db, config, { now, timesByCity })    // MURNI → { sends: [...] }
  → untuk tiap send: socket.sendMessage(jid, { text })
       sukses → Sholat.markSent(db, send)
       gagal  → log, JANGAN tandai terkirim (dicoba lagi siklus berikutnya)
```

### 8.3 Jadwal & berhenti

- `.sholat jadwal` → tampilkan jadwal hari ini untuk daerah yang dilanggan (dari cache; kalau kosong, ambil sekali).
- `.sholat stop` → hapus entri langganan user.

## 9. Zona waktu

Jam dari API adalah **waktu lokal kota**, sedangkan proses bot berjalan di `config.bot.timezone` (default `Asia/Jakarta`). Karena API tidak memberi zona waktu, dipakai peta statis **kode provinsi (2 digit pertama `id`) → zona waktu**. Indonesia tidak memakai DST.

Pemetaan jam dilakukan dengan `Intl.DateTimeFormat` (`timeZone`), **bukan** aritmetika offset manual, supaya tidak ada kesalahan tanda/jam.

```js
// lib/sholat.js (murni)
export const PRAYERS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
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

Provinsi (`daerah`) di balik kode tersebut, untuk keterbacaan: 01 Aceh · 02 Sumatera Utara · 03 Sumatera Barat · 04 Riau · 05 Kepulauan Riau · 06 Jambi · 07 Bengkulu · 08 Sumatera Selatan · 09 Kepulauan Bangka Belitung · 10 Lampung · 11 Banten · 12 Jawa Barat · 13 DKI Jakarta · 14 Jawa Tengah · 15 DI Yogyakarta · 16 Jawa Timur · 17 Bali · 18 Nusa Tenggara Barat · 19 Nusa Tenggara Timur · 20 Kalimantan Barat (WIB) · 21 Kalimantan Selatan · 22 Kalimantan Tengah · 23 Kalimantan Timur · 24 Kalimantan Utara · 25 Gorontalo · 26 Sulawesi Selatan · 27 Sulawesi Tenggara · 28 Sulawesi Tengah · 29 Sulawesi Utara · 30 Sulawesi Barat · 31 Maluku · 32 Maluku Utara · 33 Papua · 34 Papua Barat.

**Wajib diuji** dengan kota nyata: `1301` Jakarta → WIB, `1709` Denpasar → WITA, `3329` Jayapura → WIT, `2013` Pontianak → WIB (batas barat-tengah), `2622` Makassar → WITA.

Zona Indonesia memiliki batas yang mudah keliru (Kalimantan Barat = WIB, sedangkan Kalimantan lain = WITA), jadi peta ini bukan detail sepele.

## 10. Perilaku yang harus tepat

| Kode | Situasi | Perilaku |
|---|---|---|
| **D1** | Bot mati saat waktu sholat lalu hidup lagi | Kirim **hanya bila masih dalam `graceMinutes`** (default 30 menit). Lewat itu dilewati — mencegah rentetan notifikasi basi, sejalan dengan `config.bot.maxMessageAgeMs` |
| **D2** | Kode provinsi tak dikenal | **Lewati pelanggan + log peringatan.** Jangan menebak zona waktu: salah 1–2 jam lebih buruk daripada tidak mengirim |
| **D3** | Daftar di tengah hari | Hanya waktu yang **belum lewat** (atau masih dalam toleransi) yang dikirim hari itu; tidak mem-backfill |
| **D4** | Pengiriman gagal | Tidak ditandai terkirim → dicoba lagi siklus berikutnya sampai jendela toleransi habis. Tidak ada notifikasi yang hilang diam-diam |
| **D5** | Restart / duplikasi | `sent.keys` + tanggal mengunci idempotensi: satu waktu hanya dikirim sekali per hari |
| **D6** | Bot belum tersambung | Sweep keluar lebih awal bila `globalThis.conn` kosong |

## 11. Penanganan error

- **API mati/timeout** → log, lewati siklus ini, ulangi menit berikutnya. Tidak pernah crash. Timeout memakai `AbortController` seperti pola API lain di repo.
- **Katalog kota gagal diambil saat daftar** → balas pesan ramah, bukan error mentah.
- **Respons API tak terduga** (field hilang, `status: false`) → dianggap gagal; log.
- **DM gagal** → sesuai D4.
- **Sweep tumpang-tindih** → flag `running`.
- **Kota tak ditemukan saat daftar** → pesan ramah + petunjuk cara mencari.

## 12. Perintah & pesan

| Perintah | Fungsi |
|---|---|
| `.sholat` | Bantuan + status langganan user |
| `.sholat daftar <daerah>` | Berlangganan (daerah dicocokkan ke katalog; bisa juga pakai id) |
| `.sholat jadwal` | Jadwal hari ini untuk daerah yang dilanggan |
| `.sholat stop` | Berhenti berlangganan |

Dapat dipakai di DM maupun grup; **langganan selalu melekat pada pengirim**, dan DM-nya dikirim ke chat pribadi. Konfirmasi menyebutkan hal ini secara eksplisit.

**Format DM (contoh):**

```
🕌 *WAKTU SHOLAT — MAGHRIB*
🕐 17:49 WIB
📍 KOTA JAKARTA
```

**Format ambigu (contoh):**

```
Nama itu cocok di 2 daerah:
• KOTA SOFIFI (3211)
• KOTA SOFIFI (3212)

Pakai id yang benar, contoh: .sholat daftar 3211
```

(Pola ini sama dengan perbaikan ambiguitas pada fitur rent, `lib/rent.js#resolveGroupJid`.)

## 13. Konfigurasi

```js
// config.js
sholat: {
  enabled: env('SHOLAT_ENABLED', 'true') !== 'false',
  apiBase: env('SHOLAT_API_BASE', 'https://api.myquran.com/v2'),
  timeoutMs: envNumber('SHOLAT_TIMEOUT', 15000),
  /** seberapa sering sweep; 60 detik = presisi ±1 menit */
  sweepIntervalMs: envNumber('SHOLAT_SWEEP_MS', 60000),
  /** jendela kirim setelah waktu sholat lewat (menit) */
  graceMinutes: envNumber('SHOLAT_GRACE_MINUTES', 30),
  /** batas kandidat yang ditampilkan saat daerah ambigu */
  maxCandidates: envNumber('SHOLAT_MAX_CANDIDATES', 10),
  /** daftar waktu yang dikirim */
  prayers: envList('SHOLAT_PRAYERS', ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya']),
},
```

**Antarmuka `lib/sholat.js` (murni):**

- `resolveCity(cities, input)` → `{ city }` | `{ ambiguous: [...] }` | `null`
- `timezoneForCity(cityId)` → `'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura' | null`
- `subscribe(db, jid, city, { now })` / `unsubscribe(db, jid)` / `getSubscription(db, jid)`
- `duePrayers(sub, times, { now, graceMinutes })` → `string[]`
- `sweep(db, config, { now, timesByCity })` → `{ sends: [{ jid, cityId, cityName, timezone, prayer, time, text }], skipped: [...] }`
- `markSent(db, send)` → void
- `formatTimes(sub, times)` → string

**Antarmuka `lib/sholat-source.js` (I/O):**

- `fetchCities(config)` → `[{ id, name }]` (cache dalam memori; pakai cache lama bila pengambilan gagal)
- `fetchDayTimes(config, cityId, date)` → `{ cityId, date, times: { subuh, dzuhur, … } }` (cache memori per `${cityId}:${date}`)

## 14. Strategi test

Test dibagi empat berkas sesuai tanggung jawab.

**`tests/sholat.test.js`** — logika murni, gaya `tests/rent.test.js` (db palsu + jam disuntik, tanpa jaringan):

1. `resolveCity` — cocok persis, cocok sebagian, **ambigu (`KOTA SOFIFI`)**, nama daerah umum tidak boleh jadi satu pilihan, tak ditemukan, dan pencocokan via id.
2. `timezoneForCity` — Jakarta/WIB, Denpasar/WITA, Jayapura/WIT, Pontianak/WIB (batas), kode tak dikenal → `null`.
3. `duePrayers` — sebelum waktu (kosong), tepat/lewat dalam toleransi (muncul), lewat toleransi (kosong), sudah ada di `sent.keys` (kosong).
4. `sweep` — menghasilkan rencana kirim yang benar untuk beberapa pelanggan di zona berbeda.
5. Restart/duplikasi — pelanggan dengan `sent` terisi tidak dikirim ulang.
6. D1/D2/D3/D4 sebagai kasus eksplisit.
7. `formatTimes` — isi pesan sesuai contoh.
**`tests/sholat-source.test.js`** — parsing payload API dengan `fetch` yang di-stub; cache hit tidak memanggil ulang; error/timeout tidak melempar keluar; katalog lama tetap dipakai bila pengambilan gagal.

**`tests/sholat-runner.test.js`** — orkestrasi sweep dengan socket palsu: DM sukses ditandai terkirim, **DM gagal tidak ditandai** dan dicoba lagi siklus berikutnya (D4), pelanggan tanpa zona waktu dilewati + dilaporkan, dan kegagalan satu kota tidak menghentikan pelanggan lain.

**`tests/sholat-plugins.test.js`** — perintah `.sholat` end-to-end lewat `handleMessage`, dengan server HTTP lokal sebagai tiruan MyQuran (gaya `tests/rent-plugins.test.js`).

Verifikasi menyeluruh sebelum selesai: `npm test` dan `npm run check`.

## 15. File tersentuh

**Baru:** `lib/sholat.js` · `lib/sholat-source.js` · `lib/sholat-runner.js` · `plugins/sholat.js` · `tests/sholat.test.js` · `tests/sholat-source.test.js` · `tests/sholat-runner.test.js` · `tests/sholat-plugins.test.js` · dokumen ini
**Diubah:** `main.js` (+panggil sweep) · `config.js` (+blok `sholat`) · `lib/database.js` (+koleksi `sholat` + loop normalisasi) · `.env.example` (+variabel `SHOLAT_*`)

## 16. Risiko & catatan terbuka

1. **Ketergantungan API pihak ketiga.** MyQuran gratis dan tanpa key; bila layanan berhenti, fitur mati. Mitigasi: `SHOLAT_API_BASE` dapat dialihkan lewat env, dan kegagalan tidak pernah merobohkan bot.
2. **Akurasi metode perhitungan.** Jadwal mengikuti metode yang dipakai penyedia; bisa beda beberapa menit dengan sumber lain (Kemenag). Diterima — bukan line-of-business.
3. **Peta provinsi.** Bila MyQuran menambah/mengubah kode provinsi, D2 menjamin kegagalannya terlihat (dilewati + log) alih-alih salah jam.
4. **DM ke user ber-LID.** Bila `resolveIdentity` belum punya pemetaan, JID tersimpan masih `@lid`; pengiriman bisa gagal dan akan tercatat lewat D4. Perlu diamati saat uji nyata.
5. **Presisi ±1 menit** karena sweep berbasis interval, bukan alarm tepat waktu.
