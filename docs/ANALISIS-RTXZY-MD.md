# Analisis `BOTCAHX/RTXZY-MD` + Hasil Rebuild Bersih

**Tanggal analisis:** 12 Oktober 2026
**Repo:** <https://github.com/BOTCAHX/RTXZY-MD>
**Metode:** clone `--depth 1` lalu dibaca langsung (bukan hanya README); file upstream ada di `rtxzy-md-upstream/`.

---

## 1. Ringkasan eksekutif

| Pertanyaan | Jawaban singkat |
|---|---|
| Ini repo apa? | Bot WhatsApp **Multi-Device** berbasis Node.js ESM, turunan ekosistem `wabot-aq` → `ZukaBet` → recode BOTCAHX |
| Library WhatsApp? | **`zapo-js` v1.10.0** (bukan Baileys lagi) + `@zapo-js/store-sqlite` + `@zapo-js/mcp-server` |
| Ukuran | 830 file, **702 plugin**, ±6,75 MB |
| Runtime | **Node ≥ 22**, ffmpeg + imagemagick + webp, README menyatakan **tidak mendukung Termux** |
| Kualitas kode | Plugin & `lib/*` bisa dibaca, **tetapi `main.js` (286 KB) di-obfuscate** — inti koneksi tidak bisa diaudit |
| Ketergantungan | **±97% fitur butuh REST API berbayar** `api.botcahx.eu.org` (free = 15 request/hari) |
| Bisa dijalankan ulang? | Bisa, syarat: Node 22+, apikey API, dan menerima risiko ban WhatsApp |

---

## 2. Arsitektur upstream

| File / folder | Ukuran | Peran |
|---|---|---|
| `index.js` | 4,8 KB | Supervisor: health HTTP server, spawn `main.js` via IPC, auto-restart, hitung plugin |
| `main.js` | **286 KB** | Inti: koneksi WhatsApp, login, event, database driver, dll. **Di-obfuscate** (`javascript-obfuscator`) |
| `handler.js` | 76 KB / 1.449 baris | Dispatcher pesan + skema default user & chat (rpg, limit, warn, …) |
| `config.js` | 2 KB | `global.owner`, `global.btc` (apikey), prefix, watermark stiker |
| `lib/simple.js` | 89 KB / 2.155 baris | Wrapper pesan & media di atas `zapo-js` (`proto`, `WA_BROWSERS`, `isLidJid`, …) |
| `lib/*` | — | `exif`, `sticker`, `sticker-convert`, `converter`, `webp`, `webp2mp4`, `sqliteDB`, `mongoDB`, `lowdb/*`, `werewolf`, `tictactoe`, `ular_tangga`, `welcome`, `levelling`, `uploadFile/Image`, `cloudDBAdapter`, `print`, `cluster` |
| `lib/json/kbbi.json` | 279 KB | Data kamus untuk plugin KBBI |
| `plugins/*` | **702 file** | Prefix nama = kategori: `downloader-`, `tools-`, `rpg-`, `game-`, `sticker-`, `fun-`, `primbon-`, `stalker-`, `quotes-`, `cmd-`, `_` (event) |
| `src/` | ±5 MB | Aset: ratusan font (`.ttf/.otf`) + gambar aesthetic |
| `media/`, `script/node/check-version.js`, `run.js`, `speed.py`, `test.js` | — | Aset, pengecekan versi Node, launcher panel, skrip uji kecepatan, syntax checker |
| `Dockerfile`, `Procfile`, `heroku.yml`, `render.yaml`, `app.json`, `docker-compose.yml` | — | Deployment |

### Kontrak plugin (dikonfirmasi dari sumbernya)

```js
let handler = async (m, { conn, text, args, usedPrefix, command, isOwner, isAdmin, isBotAdmin, isPrems }) => { … }
handler.help    = ['sticker']
handler.tags    = ['sticker']
handler.command = /^(stiker|s|sticker)$/i
handler.limit   = true            // true | false | angka
handler.owner / admin / botAdmin / group / private / premium / register
handler.before  = async (m, ctx) => true   // hook sebelum command (dipakai _antilink, _afk, …)
export default handler
```

`handler.before` mengembalikan `true` untuk lanjut; `false`/falsy menghentikan pemrosesan.

### Argumen CLI resmi
`--qr`, `--self`, `--pconly`, `--gconly`, `--swonly`, `--restrict`, `--img`, `--autoread`, `--nyimak`, `--test`, `--prefix <p>`, `--db sqlite|json|mongodb|<url cloud>`.

---

## 3. Temuan penting (yang menentukan keputusan build ulang)

1. **Inti di-obfuscate.** `main.js` dibungkus `javascript-obfuscator` (identifiers `_0x…`, string array teracak). Konsekuensi: koneksi, pairing, penanganan event, dan logika database **tidak bisa dibaca, diaudit, atau dimodifikasi**. Fork pun tidak menyelesaikan masalah ini.
2. **Ketergantungan API pihak ketiga.** README menyatakan *"97% fitur menggunakan Rest API"*, wajib isi `global.btc` di `config.js`. Kalau API mati / kuota habis (free 15 req/hari), mayoritas plugin berhenti bekerja.
3. **Risiko akun.** Semua bot WhatsApp unofficial berisiko diban. Repo ini juga memuat plugin NSFW (`downloader-xnxx*`, `downloader-xvideos*`, dll.) yang memperbesar risiko pelanggaran ToS.
4. **Dependensi bermasalah/usang.** `axios ^0.27.2`, `mongoose ^6`, `jimp 0.16.13` (overrides), pin `node-fetch 2.6.9`, dan `javascript-obfuscator` ikut sebagai dependency runtime.
5. **Sesi & database SQLite.** Sesi di `sessions/state.sqlite`, database bot di `database/database.sqlite` (WAL, auto-migrasi dari `database.json`).
6. **Beban maintenance.** 702 plugin + dua file raksasa (286 KB + 89 KB) tanpa tipe/tes = perubahan kecil berisiko besar.
7. **Lisensi.** `package.json` menyebut MIT, tetapi base asalnya (`ZukaBet`/`wabot-aq`) berasal dari ekosistem yang umumnya GPL dan saling copy. Untuk proyek turunan, status lisensinya tidak bersih.

---

## 4. Keputusan: tulis ulang bersih (clean-room)

Dibangun **`rtxzy-md-clean/`** — bukan salinan kode, tetapi **kompatibel kontrak plugin** supaya plugin gaya RTXZY mudah diadaptasi.

### Pemetaan upstream → rebuild

| Aspek | RTXZY-MD (upstream) | `rtxzy-md-clean` (rebuild) |
|---|---|---|
| Library WA | `zapo-js` (ekosistem kecil) | **`@whiskeysockets/baileys` 6.7.24** (dist-tag *legacy*, sudah dipatch untuk advisory GHSA-qvv5-jq5g-4cgg) |
| Inti koneksi | `main.js` **obfuscated** | `lib/connection.js` + `lib/serialize.js` + `lib/simple.js`, semua terbaca |
| Supervisor | `index.js` + cluster | `index.js`: spawn + IPC + backoff + health server |
| Dispatcher | `handler.js` 1.449 baris + `main.js` raksasa | `handler.js` ±330 baris dengan alur eksplisit |
| Database | SQLite (`node:sqlite`/better-sqlite3), dukungan Mongo/cloud | JSON + **penulisan atomik** (tmp → rename), debounce, backup file rusak |
| Sesi | `sessions/state.sqlite` | `sessions/` multi-file auth state (tanpa dependency native) |
| Media | `sharp`/`jimp`/`wa-sticker-formatter` | **ffmpeg** + `node-webpmux` (tanpa native build) |
| API | wajib apikey untuk 97% fitur | inti **tanpa apikey**; API hanya untuk plugin opsional |
| Plugin | 702 (banyak bergantung API) | 35 plugin inti berkualitas + hot reload |
| Login | pairing code default, QR opsional | sama: pairing code default, `--qr` opsional |
| Node | ≥ 22 | ≥ 20.11 (diuji di Node 24) |
| Lisensi | MIT (base GPL campur) | **MIT** murni |

### Isi rebuild

- **Core:** `config.js`, `lib/{env,argv,functions,logger,print,database,permissions,plugins,serialize,simple,media,connection,health,api}.js`
- **Entrypoint:** `index.js` (supervisor + health), `main.js` (runtime), `handler.js` (dispatch)
- **Plugin (35):** main (menu/help, ping, info/profil/daftar), info (tqto), owner (mode, broadcast, restart, premium/ban/limit), group (add, kick, promote/demote, link, setname, tagall, open/close, config toggle), tools (sticker, toimg, tovn, tomp3, qr, calc), downloader (ytsearch, ytmp3, ytmp4, tiktok), fun (quote), ai (chat OpenAI-compatible), rpg (daily, bank, leaderboard), event (_antilink, _antispam, _afk, _welcome)
- **Ops:** Dockerfile, docker-compose, Procfile, health check, `.env.example`, README lengkap, LICENSE MIT
- **Test:** `tests/{functions,database,plugins,handler,health,media}.test.js` + `scripts/check-syntax.js`

---

## 5. Hasil verifikasi (dijalankan di mesin ini, Windows + Node v24.21.0)

| Pengecekan | Hasil |
|---|---|
| `npm install` | ✅ 191 paket, 18 detik |
| `npm run check` (syntax semua `.js`) | ✅ **60/60 file** lolos `node --check` |
| `npm test` | ✅ **29 lolos, 0 gagal, 3 di-skip** (tes media di-skip karena ffmpeg tidak terpasang) |
| `npm run smoke` (`main.js --no-connect --health --test`) | ✅ boot sukses, plugin termuat, health server aktif, exit code 0 |
| Health endpoint | ✅ `/`, `/health`, 404 diuji otomatis |

Catatan lingkungan: shell `pwsh` di mode sandbox gagal di mesin ini (`0xC0000142` STATUS_DLL_INIT_FAILED), sehingga seluruh perintah dijalankan di mode **full access** (dengan persetujuan). Ini murni masalah sandbox, bukan proyek.

---

## 6. Yang belum / langkah berikutnya

1. **Pairing ke akun WhatsApp nyata** — harus dilakukan pemilik nomor: `node index.js --pair 628xxxx` lalu masukkan kode di HP.
2. Pasang **ffmpeg** (agar stiker/audio aktif) dan **yt-dlp** (agar `ytmp3`/`ytmp4` aktif); keduanya tidak ada di mesin ini.
3. Menambah plugin: cukup taruh file di `plugins/` (hot reload otomatis). Lihat README bagian *Menulis Plugin Sendiri*.
4. Kalau perlu backend SQLite/Postgres: buat adapter dengan antarmuka `read()/write()` yang sama seperti `lib/database.js`.
5. Fitur kategori `game`, `stalker`, `primbon` (ada di upstream) belum diimplementasikan — sengaja, karena butuh data/API tambahan; bisa ditambah bertahap.

---

## 7. Cara menjalankan hasil rebuild

```bash
cd rtxzy-md-clean
npm install
cp .env.example .env          # isi OWNER_NUMBER & PAIRING_NUMBER
npm run smoke                 # cek instalasi tanpa WhatsApp
node index.js --pair 628xxxx  # login via pairing code
npm start                     # jalankan normal (supervisor + health server)
```
