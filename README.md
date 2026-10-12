# 🜲 RTXZY-MD Clean

Bot **WhatsApp Multi-Device** yang ditulis ulang dari nol (clean-room) dengan arsitektur plugin bergaya **RTXZY-MD / wabot-aq**, tapi memakai library resmi komunitas **[@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)** dan kode yang **100% bisa dibaca** (tanpa obfuscate, tanpa API key wajib).

> Proyek ini **bukan salinan** repo `BOTCAHX/RTXZY-MD`. Kontrak plugin-nya sengaja dibuat kompatibel (`handler.command`, `handler.help`, `handler.tags`, `handler.limit`, `handler.owner`, `handler.admin`, `handler.before`, …) supaya plugin lama mudah diadaptasi — tapi seluruh kodenya ditulis ulang bersih dan berlisensi MIT.

---

## 📑 Daftar Isi

- [Fitur](#-fitur)
- [Analisis repo asal](docs/ANALISIS-RTXZY-MD.md) 📄 *(kenapa proyek ini ditulis ulang)*
- [Persyaratan](#-persyaratan)
- [Instalasi](#-instalasi)
- [Login WhatsApp (pairing code / QR)](#-login-whatsapp)
- [Menjalankan](#-menjalankan)
- [Argumen CLI](#-argumen-cli)
- [Konfigurasi .env](#-konfigurasi-env)
- [Daftar Command](#-daftar-command)
- [Downloader YouTube (yt-dlp)](#-downloader-youtube-yt-dlp)
- [Troubleshooting](#-troubleshooting)
- [Struktur Folder](#-struktur-folder)
- [Menulis Plugin Sendiri](#-menulis-plugin-sendiri)
- [Deployment](#-deployment)
- [Testing](#-testing)
- [Keamanan & Disclaimer](#-keamanan--disclaimer)
- [Roadmap](#-roadmap)
- [Lisensi](#-lisensi)

---

## ✨ Fitur

| Kategori | Isi |
|---|---|
| **Koneksi** | Baileys multi-device, login **pairing code** (default) atau **QR** (`--qr`), auto-reconnect dengan backoff, deteksi sesi logout |
| **Plugin engine** | Auto-load `plugins/*.js`, **hot reload** saat file diubah, index command (literal + regex), kategori otomatis, deteksi command dobel |
| **Permission** | Owner / mods / premium / admin grup / bot admin / grup-only / private-only / wajib daftar / banned / mute / expired |
| **Ekonomi** | Limit harian (auto reset), exp & level, saldo, bank, daily reward, leaderboard |
| **Database** | JSON dengan **penulisan atomik** (tmp → rename), debounce save, auto-backup file rusak, skema user & chat otomatis |
| **Media** | Stiker (gambar & video) + metadata EXIF, stiker → gambar, audio/video → mp3, → voice note — semua lewat **ffmpeg**, tanpa dependency native |
| **Downloader** | YouTube (yt-dlp, tanpa API key), pencarian YouTube (yt-search), TikTok tanpa watermark |
| **AI (opsional)** | Chat AI kompatibel OpenAI (OpenAI, Groq, OpenRouter, Ollama, …) dengan riwayat per chat |
| **Event** | Anti-link, anti-spam, AFK, welcome/goodbye + notifikasi admin grup |
| **Runtime** | Supervisor auto-restart (`index.js`), health server HTTP, autoclear `tmp/`, global shutdown rapi |
| **Ops** | Docker + docker-compose, Procfile (Heroku/Render), health check, log berwarna |

**Yang TIDAK butuh API key:** semua fitur inti (menu, grup, tools, stiker, RPG, event, YouTube via yt-dlp, TikTok). Hanya plugin AI yang butuh key (opsional).

---

## 🧰 Persyaratan

| Komponen | Keterangan |
|---|---|
| **Node.js** | **20.11+** (disarankan 22 LTS) |
| **ffmpeg** | Untuk stiker & konversi audio/video (`sticker`, `tovn`, `tomp3`, `toimg`) |
| **yt-dlp** | Opsional — untuk `ytmp3` / `ytmp4` |
| RAM | ±150–300 MB saat idle |

Tanpa ffmpeg bot tetap jalan; hanya command media yang akan menolak dengan pesan jelas.

---

## 🚀 Instalasi

### Windows / VPS / RDP

```bash
# 1. Pasang Node.js 20.11+ dan ffmpeg (tambahkan ffmpeg ke PATH)
# 2. Clone / salin folder proyek, lalu:
cd rtxzy-md-clean
npm install

# 3. Siapkan konfigurasi
copy .env.example .env      # Windows
cp .env.example .env        # Linux/macOS
# edit .env -> isi OWNER_NUMBER, PAIRING_NUMBER, dll.

# 4. Jalankan
npm start
```

### Linux / VPS (apt)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs ffmpeg
pip install -U yt-dlp        # opsional
npm install
npm start
```

### Docker

```bash
docker compose up -d --build
docker compose logs -f bot
```

> Data penting tersimpan di `sessions/`, `database/`, dan `tmp/` — ketiganya di-mount sebagai volume oleh `docker-compose.yml`.

---

## 🔐 Login WhatsApp

### Cara 1 — Pairing code (default, tanpa scan)

1. Isi `PAIRING_NUMBER` di `.env` dengan nomor WhatsApp bot (format `628xxxx`).
2. Jalankan:
   ```bash
   node index.js --pair 628xxxxxxxxxx
   ```
3. Terminal menampilkan kode 8 digit (mis. `ABCD-EFGH`).
4. Di HP: **WhatsApp → Perangkat Tertaut → Tautkan perangkat → Tautkan dengan nomor telepon** → masukkan kode.

### Cara 2 — QR code

```bash
node index.js --qr
```

Scan QR yang muncul di terminal dengan WhatsApp.

Sesi disimpan di `sessions/` (multi-file auth state). Setelah berhasil login, jalankan berikutnya cukup `npm start`.

> ⚠️ Kalau logout: hapus folder `sessions/` lalu pairing/scan ulang.

---

## ▶️ Menjalankan

```bash
npm start          # supervisor + bot + health server
npm run dev        # mode watch (langsung main.js)
npm run smoke      # cek instalasi tanpa menyambung ke WhatsApp
npm test           # jalankan tes
npm run check      # cek sintaks semua file .js
```

Health check:

```bash
curl http://127.0.0.1:5000/         # {"response":{...}}
curl http://127.0.0.1:5000/health    # ringkasan runtime
```

---

## ⚙️ Argumen CLI

| Argumen | Fungsi |
|---|---|
| `--qr` | Login dengan QR code (default: pairing code) |
| `--pair 628xx` | Minta pairing code untuk nomor tersebut |
| `--prefix .` | Set prefix (setiap karakter jadi prefix terpisah, mis. `.#!/`) |
| `--self` | Hanya owner & mods yang dilayani |
| `--pconly` | Hanya balas chat pribadi |
| `--gconly` | Hanya balas chat grup |
| `--swonly` | Hanya balas status |
| `--restrict` | Aktifkan plugin berisiko (disiapkan untuk kategori ini) |
| `--autoread` | Tandai semua pesan masuk sebagai sudah dibaca |
| `--nyimak` | Mode diam: hanya log, tidak membalas |
| `--test` | Mode pengembangan (keluar setelah health siap pada `--no-connect`) |
| `--no-connect` | Jalankan tanpa menyambung WhatsApp (uji instalasi) |
| `--no-health` | Matikan health server |
| `--no-reload` | Matikan hot reload plugin |
| `--db <file.json>` | Pakai file database lain (`--db json` = default) |
| `--port 5000` | Port health server (default: `PORT` env atau acak) |
| `--big-qr` | QR berukuran besar di terminal |
| `--debug` | Log debug |

Contoh gabungan:

```bash
node index.js --qr --prefix . --gconly --autoread --port 5000
```

---

## 🔧 Konfigurasi .env

Lihat [`.env.example`](.env.example). Yang paling penting:

```env
OWNER_NUMBER="628123456789"     # wajib
PAIRING_NUMBER="628123456789"   # untuk login pairing code
PREFIX=".#!/,"
BOT_NAME="RTXZY Clean"
STICKER_PACKNAME="RTXZY Clean"
API_BASE=""                     # opsional
AI_BASE="https://api.openai.com/v1"
AI_KEY=""                       # opsional, untuk plugin .ai
```

---

## 📜 Daftar Command

Prefix default: `.#!/,` (mis. `.menu`, `!ping`).

<details open>
<summary><b>main</b> — informasi & profil</summary>

| Command | Fungsi |
|---|---|
| `.menu [kategori]` | Daftar command per kategori |
| `.help <command>` | Detail sebuah command |
| `.ping` / `.speed` | Latensi & ringkasan runtime |
| `.info` | Info bot |
| `.profile` / `.profil` / `.me` | Profil user (level, exp, limit, saldo) |
| `.daftar Nama.20` | Registrasi user |
</details>

<details>
<summary><b>owner</b> — khusus owner</summary>

| Command | Fungsi |
|---|---|
| `.mode self\|public` | Ubah mode bot |
| `.broadcast <teks>` | Kirim pesan ke semua chat |
| `.restart` | Restart bot |
| `.premium add\|del <nomor> [hari]` | Kelola premium |
| `.ban <nomor> [alasan]` / `.unban <nomor>` | Blokir user |
| `.limit add\|del <nomor> <jumlah>` | Tambah/kurangi limit |
| `.resetlimit <nomor>` | Reset limit harian |
</details>

<details>
<summary><b>group</b> — butuh admin grup</summary>

| Command | Fungsi |
|---|---|
| `.add <nomor>` | Tambah anggota |
| `.kick <@user\|nomor>` | Keluarkan anggota |
| `.promote` / `.demote <@user>` | Naik/turun jabatan |
| `.link` / `.link reset` | Link undangan grup |
| `.setname <nama>` | Ubah nama grup |
| `.tagall [pesan]` | Mention semua anggota |
| `.open` / `.close` | Buka/tutup grup |
| `.antilink on\|off` | Anti-link per grup |
| `.antispam on\|off` | Anti-spam per grup |
| `.welcome on\|off` | Welcome/goodbye |
| `.detect on\|off` | Notifikasi perubahan info grup |
</details>

<details>
<summary><b>tools</b></summary>

| Command | Fungsi |
|---|---|
| `.sticker [namapack]` | Gambar/video → stiker |
| `.toimg` | Stiker → gambar (png) |
| `.tovn` | Audio/video → voice note |
| `.tomp3` | Audio/video → mp3 |
| `.qr <teks>` | Buat QR code |
| `.calc <ekspresi>` | Kalkulator aman (tanpa `eval`) |
</details>

<details>
<summary><b>downloader</b></summary>

| Command | Fungsi |
|---|---|
| `.yts <kata kunci>` | Cari video YouTube |
| `.ytmp3 <link\|kata kunci>` | Unduh audio (butuh yt-dlp) |
| `.ytmp4 <link\|kata kunci>` | Unduh video (butuh yt-dlp) |
| `.tiktok <link>` | Video TikTok tanpa watermark |
</details>

<details>
<summary><b>fun / ai / rpg / info</b></summary>

| Command | Fungsi |
|---|---|
| `.quote` | Quote random |
| `.ai <pertanyaan>` / `.resetai` | Chat AI (butuh `AI_KEY`) |
| `.daily` | Hadiah harian |
| `.bank` / `.nabung <n>` / `.tarik <n>` | Bank saldo |
| `.leaderboard [exp\|saldo\|level]` | Papan peringkat |
| `.afk [alasan]` | Status AFK |
| `.tqto` | Kredit |
</details>

---

## 🎬 Downloader YouTube (yt-dlp)

`.ytmp3` dan `.ytmp4` mengunduh langsung dari YouTube memakai **yt-dlp** — gratis, **tanpa API key**. Supaya jalan di panel/VPS, perhatikan 3 hal ini:

**1. yt-dlp harus bisa dipanggil**

```bash
yt-dlp --version          # kalau keluar versi, berarti siap
pip install -U yt-dlp     # kalau belum ada
```

Bot mencari binary di urutan ini: `YTDLP_PATH` (.env) → `/usr/local/bin/yt-dlp` → `/usr/bin/yt-dlp` → `/bin/yt-dlp` → `PATH` → folder proyek. Kalau `yt-dlp` ada tapi tetap tidak terdeteksi, isi path-nya:

```env
YTDLP_PATH=/usr/local/bin/yt-dlp
```

**2. Batas ukuran & kualitas**

| Env | Default | Fungsi |
|---|---|---|
| `YTDLP_MAX_DURATION` | `900` | Durasi maksimum video (detik) |
| `YTDLP_MAX_HEIGHT` | `720` | Tinggi maksimum video (progressive mp4) |
| `MAX_UPLOAD_BYTES` | `67108864` | Batas ukuran file yang dikirim ke WhatsApp (64 MB) |

**3. Kalau YouTube minta verifikasi "bukan bot"**

Beberapa IP server diblokir YouTube. Solusinya pakai cookies dari browser:

```env
YTDLP_COOKIES=/home/container/cookies.txt
```

Atau ubah client extractor-nya:

```env
YTDLP_ARGS=--extractor-args "youtube:player_client=android"
```

**Catatan teknis:**
- Audio diunduh sebagai stream asli (m4a/webm) lalu dikonversi ke **mp3 dengan ffmpeg**. Kalau ffmpeg tidak ada, file dikirim apa adanya (m4a) — tetap bisa diputar.
- Video: bot otomatis memilih strategi sesuai server — kalau **ffmpeg ada**, video & audio diunduh terpisah lalu digabung jadi mp4 (kualitas sampai `YTDLP_MAX_HEIGHT`); kalau **ffmpeg tidak ada**, bot hanya memakai format *progressive* (video+audio menyatu), yang sekarang jarang tersedia di YouTube, sehingga `.ytmp4` bisa gagal dengan pesan yang menjelaskan sebabnya.
- Unduhan memakai file sementara lalu dihapus otomatis (tidak menumpuk di `tmp/`).
- Kalau ada error, bot menampilkan pesan penyebabnya (video privat, dibatasi umur, durasi terlalu panjang, masalah jaringan) — bukan crash.
- Cek cepat di server: **`npm run check:ytdlp`** (uji metadata + unduh audio & video).

---

## 🩹 Troubleshooting

### Stiker tidak jadi / error

| Pesan / gejala | Penyebab & solusi |
|---|---|
| Bot bilang *"Kirim atau reply gambar/video"* padahal ada gambarnya | Sudah diperbaiki di v1.1 (dulu `m.msg` berisi kontainer pesan sehingga `m.msg.mimetype` kosong). Pastikan memakai ZIP terbaru. |
| *"Server belum punya encoder WebP"* | ffmpeg build minimal tanpa libwebp. Jalankan `ffmpeg -encoders \| grep webp`. Kalau kosong: `apt install ffmpeg` (lengkap) atau `apt install webp` (bot otomatis pakai `cwebp` untuk gambar). |
| Video ditolak | Batas durasi stiker video 10 detik (`MAX_STICKER_SECONDS`), dan stiker animasi wajib ffmpeg (bukan cwebp). |
| Stiker jadi tapi tanpa nama pack | `node-webpmux` gagal menyisipkan EXIF — biasanya karena file masukan bukan WebP valid. Coba kirim ulang gambarnya. |
| Mau cek cepat | `npm run check:sticker` (uji gambar→webp→EXIF, video→webp animasi, dan jalur plugin `.sticker`). |

Kirim/reply **foto, video (≤10 detik), atau stiker** lalu ketik `.sticker` — foto yang dikirim sebagai *dokumen* juga didukung.

---

## 🗂 Struktur Folder

```
rtxzy-md-clean/
├── index.js              # supervisor + health server
├── main.js               # penyambung WhatsApp + pemuat plugin
├── handler.js            # dispatcher pesan (before hook → gating → plugin)
├── config.js             # konfigurasi global (CLI > .env > default)
├── lib/
│   ├── api.js            # klien REST API opsional
│   ├── argv.js           # parser argumen CLI
│   ├── connection.js     # koneksi Baileys (pairing/QR/reconnect)
│   ├── database.js       # database JSON atomik
│   ├── env.js            # loader .env
│   ├── functions.js      # helper umum (format, jid, fetch, target)
│   ├── health.js         # HTTP health server + status file
│   ├── logger.js         # pino logger (dipakai Baileys)
│   ├── media.js          # ffmpeg: stiker, exif, convert, yt-dlp
│   ├── permissions.js    # owner/admin/premium/limit/level
│   ├── plugins.js        # plugin manager + hot reload
│   ├── print.js          # logger konsol berwarna
│   ├── serialize.js      # WAMessage -> objek `m`
│   └── simple.js         # helper conn (sendImageAsSticker, getName, ...)
├── plugins/              # 35+ plugin siap pakai
├── tests/                # tes node:test
├── scripts/check-syntax.js
├── sessions/             # kredensial WhatsApp (jangan di-commit!)
├── database/             # database.json
├── tmp/                  # file sementara media
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## 🧩 Menulis Plugin Sendiri

Buat file di `plugins/`, misal `plugins/tools-hello.js`:

```js
const handler = async (m, { conn, text, args, usedPrefix, command, config, db, user }) => {
  if (!text) return m.reply(`Contoh: ${usedPrefix}${command} NamaKamu`);
  return m.reply(`Halo ${text}! Level kamu ${user.level}.`);
};

handler.help = ['hello'];
handler.tags = ['tools'];
handler.command = /^(hello|halo)$/i;   // RegExp | string | string[]
handler.limit = true;                  // potong 1 limit
export default handler;
```

Simpan — plugin langsung dimuat ulang (hot reload) tanpa restart.

### Objek `m` (pesan)

| Properti | Keterangan |
|---|---|
| `m.chat`, `m.sender`, `m.isGroup`, `m.fromMe` | info chat & pengirim (sudah dinormalisasi, LID → nomor telepon bila tersedia) |
| `m.text`, `m.mtype`, `m.msg`, `m.pushName` | isi pesan |
| `m.mentionedJid` | daftar jid yang di-mention |
| `m.quoted` | pesan yang di-reply (punya `.sender`, `.text`, `.msg`, `.download()`) |
| `m.reply(teks\|buffer\|objek)` | balas pesan |
| `m.react('👍')`, `m.delete()`, `m.read()` | reaksi / hapus / tandai dibaca |
| `m.download()` | unduh media pada pesan itu |

### Context / `ctx` (argumen kedua)

| Field | Keterangan |
|---|---|
| `conn` | socket Baileys + helper (`sendImageAsSticker`, `sendImage`, `getName`, …) |
| `args`, `text`, `usedPrefix`, `command` | hasil parsing |
| `user`, `db`, `config`, `plugins` | data user, database, konfigurasi, plugin manager |
| `isOwner`, `isMods`, `isAdmin`, `isBotAdmin`, `isPremium` | hasil cek permission |
| `participants`, `groupMetadata` | data grup (kalau di grup) |
| `wait()` | kirim pesan tunggu; hasilnya fungsi untuk mengedit pesan itu |
| `Api`, `Func`, `runtime` | klien API, helper, status runtime |

### Flag plugin

```js
handler.limit    = true | false | 2   // biaya limit (angka = sebesar itu)
handler.owner    = true               // hanya owner
handler.mods     = true               // (cek sendiri lewat ctx.isMods)
handler.premium  = true               // hanya premium
handler.admin    = true               // hanya admin grup
handler.botAdmin = true               // bot harus admin
handler.group    = true               // hanya di grup
handler.private  = true               // hanya chat pribadi
handler.register = true               // wajib terdaftar
handler.prefix   = false              // bisa dipanggil tanpa prefix
```

### Hook event

```js
// dijalankan sebelum command apa pun; return false = hentikan pemrosesan
handler.before = async (m, ctx) => { /* ... */ return true; };

// dijalankan untuk setiap pesan (tanpa command)
handler.all = async (m, ctx) => { /* ... */ };

// event grup
handler.onGroupParticipants = async (conn, update, ctx) => {};
handler.onGroupsUpdate = async (conn, updates, ctx) => {};
handler.onCall = async (conn, calls, ctx) => {};
```

---

## ☁️ Deployment

### Pterodactyl Panel

1. Upload seluruh file (ZIP) ke `/home/container` atau ke dalam satu folder.
2. Set startup command: `node index.js` (atau `npm start`).
3. Jalankan `npm install` dari terminal panel.
4. Egg harus Node.js **20.11+**.

### Render / Heroku

File `Procfile` (`web: node index.js`) sudah disiapkan. Bot otomatis memakai `PORT` dari environment.

### PM2 (VPS)

```bash
npm i -g pm2
pm2 start index.js --name wa-bot
pm2 save && pm2 startup
```

---

## 🧪 Testing

```bash
npm run check     # node --check untuk semua file .js
npm test          # node:test (database, plugin, handler, health, media)
npm run smoke     # boot tanpa WhatsApp + cek plugin & tool
```

Tes mencakup: roundtrip database, deteksi command dobel, kontrak plugin, dispatch pesan end-to-end (dengan conn palsu), permission owner/limit, hook AFK, media ffmpeg (otomatis di-skip bila ffmpeg tidak ada), dan health server.

---

## 🔒 Keamanan & Disclaimer

- **Risiko ban.** Bot ini memakai WhatsApp Web secara tidak resmi (sama seperti semua library sejenis). Jangan pakai untuk spam/broadcast massal, dan sebaiknya pakai **nomor cadangan**, bukan nomor utama.
- **Jangan commit** folder `sessions/` — di dalamnya ada kredensial penuh akun WhatsApp kamu.
- Bot hanya merespons chat yang tidak di-mute; gunakan `--self` supaya hanya owner yang dilayani.
- Tidak ada `eval()` untuk kalkulator; API key hanya dibaca dari `.env`/environment.
- Plugin pihak ketiga yang kamu tambahkan bisa melakukan apa pun — review dulu sebelum dipakai.

---

## 🗺️ Roadmap

- [ ] Adapter database SQLite/PostgreSQL (antarmuka `read/write` sudah disiapkan)
- [ ] Kategori plugin `rpg` lebih lengkap (petualangan, marketplace)
- [ ] Kategori `game` (kuis, tebak-tebakan) + skor per grup
- [ ] Dukungan tombol/interactive message bila Baileys mendukung stabil
- [ ] Plugin `stalker`/`tools` berbasis API (opsional, butuh `API_BASE`)
- [ ] Migrasi impor file `database.json` dari base lain

---

## 📄 Lisensi

MIT — lihat [LICENSE](LICENSE).

Dibuat sebagai hasil **penulisan ulang bersih** dengan inspirasi arsitektur dari ekosistem `wabot-aq` / `RTXZY-MD` (proyek komunitas). Kredit library: [Baileys](https://github.com/WhiskeySockets/Baileys), [pino](https://getpino.io), [picocolors](https://github.com/alexeyraspopov/picocolors), [yt-search](https://github.com/talmobi/yt-search), [node-webpmux](https://github.com/ApeironTsukai/node-webpmux), [qrcode](https://github.com/soldair/node-qrcode).
