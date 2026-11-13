# 🜲 Duel Standby-MD

Bot **WhatsApp Multi-Device** ditulis ulang dari nol (clean-room) dengan arsitektur plugin bergaya **RTXZY-MD**, memakai library resmi komunitas [**@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)** dan kode **100% bisa dibaca** (tanpa obfuscate, tanpa API key wajib).

> Proyek ini **bukan salinan** repo `BOTCAHX/RTXZY-MD`. Kontrak plugin kompatibel (`handler.command`, `handler.help`, `handler.tags`, `handler.limit`, `handler.owner`, `handler.admin`, `handler.before`, …) supaya plugin lama mudah diadaptasi — seluruh kodenya ditulis ulang bersih dan berlisensi MIT.

---

## 📋 Daftar Isi

- [Fitur](#-fitur)
- [Instalasi](#-instalasi)
- [Login WhatsApp](#-login-whatsapp)
- [Konfigurasi `.env`](#-konfigurasi-env)
- [Daftar Command](#-daftar-command)
- [Downloader & Yu-Gi-Oh](#-downloader--yu-gi-oh)
- [Pengaturan Menu & Limit](#-pengaturan-menu--limit)
- [Kategori NSFW (18+)](#-kategori-nsfw-18-aktif-opsional)
- [Struktur Folder](#-struktur-folder)
- [Menulis Plugin](#-menulis-plugin)
- [Deployment](#-deployment)
- [Testing](#-testing)
- [Keamanan & Disclaimer](#-keamanan--disclaimer)
- [Roadmap](#-roadmap)
- [Lisensi & Asal Usul](#-lisensi--asal-usul)

---

## ✨ Fitur

| Kategori | Isi |
|---|---|
| **Koneksi** | Baileys multi-device, login pairing code atau QR, auto-reconnect dengan backoff |
| **Plugin engine** | Auto-load `plugins/*.js`, hot reload, index command (literal + regex), deteksi dobel |
| **Permission** | Owner / mods / premium / admin grup / banned / mute / expired |
| **Ekonomi** | Limit harian, exp & level, saldo, leaderboard, hadiah tiap pesan |
| **Media** | Stiker (gambar & GIF via sharp), stiker → gambar, audio → mp3 / voice note |
| **Downloader** | YouTube (yt-dlp), TikTok tanpa watermark |
| **AI (opsional)** | Kompatibel OpenAI (Groq, OpenRouter, Ollama, …) dengan riwayat per chat |
| **Event** | Anti-link, anti-spam, AFK, welcome/goodbye |

**Yang tidak butuh API key:** semua fitur inti. Hanya plugin AI yang butuh key (opsional).

<details>
<summary><b>Detail teknis fitur</b> — klik untuk lihat selengkapnya</summary>

- **Database:** JSON dengan penulisan atomik (tmp → rename), debounce save, auto-backup file rusak.
- **Stiker animasi:** GIF di-encode lewat `sharp` → tetap animasi walau ffmpeg tidak ada. WhatsApp batas 1 MB; bot menurun kualitas bertahap hingga muat.
- **AI:** model dapat diganti lewat `.env` (`AI_MODEL`). Owner punya persona + memori terpisah.
- **Backup:** bot bisa mengirim `database.json` + `owner-ai.json` ke Telegram secara berkala (`.backup`).

</details>

---

## 🚀 Instalasi

```bash
# 1. Pasang Node.js 20.11+ dan ffmpeg
# 2. Clone / salin folder, lalu:
cd duel-standby-md
npm install

# 3. Siapkan konfigurasi
cp .env.example .env        # Linux/macOS
copy .env.example .env      # Windows
# edit .env -> isi OWNER_NUMBER, dll.

# 4. Jalankan
npm start
```

**Linux (apt):**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs ffmpeg
pip install -U yt-dlp   # opsional, untuk .ytmp3/.ytmp4
npm install
npm start
```

**Docker:** `docker compose up -d --build`

Data penting tersimpan di `sessions/`, `database/`, dan `tmp/` (mount sebagai volume).

---

## 🔐 Login WhatsApp

| Cara | Perintah | Keterangan |
|---|---|---|
| **Pairing code** (default) | `node index.js --pair 628xxxx` | Kode 8 digit, pasang lewat HP: WhatsApp → Perangkat Tertaut → Tautkan dengan nomor telepon |
| **QR code** | `node index.js --qr` | Scan QR di terminal |

Sesi disimpan di `sessions/`. Setelah login, jalankan `npm start` tanpa flag.

> ⚠️ Kalau logout: hapus folder `sessions/` lalu pairing/scan ulang.

---

## 🔧 Konfigurasi `.env`

Lihat [`.env.example`](.env.example). Yang paling penting:

```env
OWNER_NUMBER="628123456789"
PAIRING_NUMBER="628123456789"
PREFIX=".#!/,"
BOT_NAME="Duel Standby"
AI_BASE="https://api.groq.com/openai/v1"
AI_KEY=""
AI_MODEL="openai/gpt-oss-120b"
```

Argumen CLI lebih diprioritaskan dari `.env`, lalu default. Lihat `npm start -- --help` untuk daftar lengkap flag (`--qr`, `--self`, `--gconly`, `--pconly`, `--nyimak`, `--port`, dll).

---

## 📜 Daftar Command

Prefix default: `.#!/,` (mis. `.menu`, `!ping`).

<details>
<summary><b>main</b> — informasi & profil</summary>

| Command | Fungsi |
|---|---|
| `.menu` / `.menu all` | Ringkasan atau daftar lengkap semua kategori |
| `.help <command>` | Detail satu command |
| `.ping` / `.speed` | Latensi & ringkasan runtime |
| `.info` | Info bot |
| `.profile` / `.me` | Profil sendiri |
| `.daftar Nama.20` | Registrasi user |

</details>

<details>
<summary><b>owner</b> — khusus owner</summary>

| Command | Fungsi |
|---|---|
| `.mode self\|public` | Ubah mode bot |
| `.broadcast <teks>` | Kirim ke semua chat |
| `.restart` | Restart bot |
| `.premium add\|del <nomor> [hari]` | Kelola premium |
| `.ban <nomor>` / `.unban <nomor>` | Blokir user |
| `.limit add\|del <nomor> <jumlah>` | Kelola limit |
| `.category <kategori> show\|hide\|on\|off` | Pengaturan menu kategori |
| `.cmdset <command> show\|hide\|on\|off` | Pengaturan menu command |
| `.backup` / `.backupdb` | Kirim backup database ke Telegram |

</details>

<details>
<summary><b>group</b> — butuh admin grup</summary>

| Command | Fungsi |
|---|---|
| `.add <nomor>` | Tambah anggota |
| `.kick <@user>` | Keluarkan anggota |
| `.promote` / `.demote` | Naik/turun jabatan |
| `.antilink on\|off` | Anti-link |
| `.antispam on\|off` | Anti-spam |
| `.welcome on\|off` | Welcome/goodbye |

</details>

<details>
<summary><b>tools</b></summary>

| Command | Fungsi |
|---|---|
| `.sticker [namapack]` | Gambar/video/GIF → stiker |
| `.smeme atas\|bawah` | Stiker meme (render lokal ffmpeg) |
| `.toimg` | Stiker → gambar |
| `.tomp3` / `.tovn` | Audio → mp3 / voice note |
| `.qr <teks>` | Buat QR code |
| `.calc <ekspresi>` | Kalkulator aman |

</details>

<details>
<summary><b>downloader</b></summary>

| Command | Fungsi |
|---|---|
| `.yts <kata kunci>` | Cari YouTube |
| `.ytmp3 <link>` | Unduh audio YouTube (butuh yt-dlp) |
| `.ytmp4 <link>` | Unduh video YouTube (butuh yt-dlp) |
| `.tiktok <link>` | Video TikTok tanpa watermark |
| `.ig <link>` | Unduh foto/post Instagram |
| `.x / .tw / .twitter <link>` | Semua video dari tweet |

</details>

<details>
<summary><b>game — Yu-Gi-Oh!</b></summary>

| Command | Fungsi |
|---|---|
| `.ygo <nama>` | Info kartu + efek lengkap |
| `.card <nama>` | Hanya gambar kartu |
| `.tebakygo` | Game tebak kartu (pilihan ganda / teks) |
| `.tebakgambar` | Game tebak kartu (gambar saja) |
| `.yugoscore` | Papan skor terbaik |

</details>

<details>
<summary><b>fun / ai / rpg / info</b></summary>

| Command | Fungsi |
|---|---|
| `.ai <pertanyaan>` | Chat AI (butuh `AI_KEY`) |
| `.resetai` | Hapus riwayat AI |
| `.daily` | Hadiah harian |
| `.bank` / `.nabung` / `.tarik` | Bank saldo |
| `.leaderboard` | Papan peringkat |
| `.afk [alasan]` | Status AFK |

</details>

<details>
<summary><b>image / nsfw</b> — gambar anime</summary>

| Command | Fungsi |
|---|---|
| `.sfw [kategori]` | Gambar anime aman |
| `.nsfw on\|off` | Nyalakan/matikan 18+ di grup ini |
| `.nsfw [tag]` | Gambar 18+ (opt-in per grup) |

</details>

---

## 🎬 Downloader & Yu-Gi-Oh!

`.ytmp3` dan `.ytmp4` butuh **yt-dlp**. Kalau YouTube memblokir IP server, gunakan cookies:

```env
YTDLP_COOKIES=/path/cookies.txt
YTDLP_MAX_HEIGHT=720
```

Yu-Gi-Oh! pakai [YGOPRODeck API v7](https://ygoprodeck.com/api-guide/) — gratis, tanpa API key. Gambar kartu di-cache di `database/cache/cards/`.

---

## ⚙️ Pengaturan Menu & Limit (Owner)

Owner bisa menyembunyikan atau mematikan kategori/command dari `.menu`:

| Perintah | Fungsi |
|---|---|
| `.menuset` | Ringkasan semua kategori |
| `.category <kategori> show\|hide` | Tampilkan / sembunyikan kategori |
| `.category <kategori> on\|off` | Aktifkan / matikan kategori |
| `.cmdset <command> show\|hide` | Tampilkan / sembunyikan command |
| `.limitset` | Ringkasan pengaturan limit |
| `.limitcmd <command> default\|gratis\|<angka>` | Biaya limit satu command |

**Bedanya `hide` dan `off`:** `hide` = tidak muncul di menu tapi masih bisa dipakai; `off` = muncul di menu tapi diblokir.

Pengaturan disimpan di `database/database.json` dan bertahan setelah restart.

---

## 🔞 Kategori NSFW (18+) — Aktif Opsional

Kategori `nsfw` **disembunyikan dari menu default** dan **mati** (`enabled: false`) sampai owner mengaktifkannya.

| Command | Fungsi |
|---|---|
| `.category nsfw show` | Tampilkan kategori NSFW di menu |
| `.category nsfw on` | Aktifkan seluruh kategori NSFW |
| `.nsfw on` / `.nsfw off` | Nyalakan/matikan 18+ **di grup ini** (admin grup) |

**Dua lapis kontrol:**
1. **Master switch (owner):** `.category nsfw on` / `off` — aktifkan/matikan total.
2. **Per grup (admin):** `.nsfw on` — tiap grup harus menyetujui sendiri.

> ⚠️ Konten 18+ hanya untuk dewasa. Pengiriman gambar eksplisit lewat WhatsApp bisa membuat nomor di-ban. Gunakan nomor cadangan, bukan nomor utama.

---

## 🗂 Struktur Folder

```
index.js      supervisor + health server
main.js       koneksi Baileys + pemuat plugin
handler.js    dispatcher pesan (before hook → gating → plugin)
config.js     konfigurasi (CLI > .env > default)
lib/          api, argv, connection, database, env, functions, health,
              logger, media, permissions, plugins, print, serialize, simple
plugins/      35+ plugin, auto-load + hot reload
tests/        node:test
scripts/      check-syntax, list-commands, cek tool eksternal/API
database/     penyimpanan JSON atomik (data user runtime)
sessions/     kredensial WhatsApp — JANGAN di-commit
tmp/          file sementara (autoclear)
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
handler.command = /^(hello|halo)$/i;
handler.limit = true;
export default handler;
```

Plugin langsung dimuat ulang (hot reload) tanpa restart.

---

## ☁️ Deployment

| Platform | Cara |
|---|---|
| **Pterodactyl** | Upload ZIP, startup: `node index.js`, lalu `npm install` |
| **Render / Heroku** | `Procfile` sudah ada (`web: node index.js`) |
| **PM2 (VPS)** | `pm2 start index.js --name wa-bot` |

Egg / container harus Node.js **20.11+**.

---

## 🧪 Testing

```bash
npm run check   # cek sintaks semua file .js
npm test        # jalankan semua tes (node:test)
npm run smoke   # boot tanpa WhatsApp + cek plugin & tool
```

---

## 🔒 Keamanan & Disclaimer

- **Risiko bot WhatsApp non-resmi:** gunakan nomor cadangan, bukan nomor utama.
- **Jangan commit** folder `sessions/` — berisi kredensial penuh akun WhatsApp.
- Tidak ada `eval()` untuk kalkulator; API key hanya dibaca dari `.env`.
- Plugin pihak ketiga yang kamu tambahkan bisa melakukan apa pun — review dulu sebelum dipakai.

---

## 🗺️ Roadmap

- [ ] Adapter database SQLite/PostgreSQL
- [ ] Kategori `rpg` lebih lengkap (petualangan, marketplace)
- [ ] Dukungan tombol/interactive message (Baileys)
- [ ] Plugin `stalker`/`tools` berbasis API (opsional)

---

## 📄 Lisensi & Asal Usul

**MIT** — lihat [LICENSE](LICENSE).

**Asal usul:** proyek ini ditulis ulang dari nol (clean-room) dengan inspirasi arsitektur plugin dari ekosistem **`wabot-aq` / `RTXZY-MD`** (proyek komunitas), tetapi **bukan salinan** repo tersebut. Semua kode ditulis ulang bersih.

Kredit library utama:
- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Multi-Device
- [pino](https://getpino.io) — logger
- [picocolors](https://github.com/alexeyraspopov/picocolors) — warna terminal
- [yt-search](https://github.com/talmobi/yt-search) — pencarian YouTube
- [node-webpmux](https://github.com/ApeironTsukai/node-webpmux) — EXIF stiker
- [qrcode](https://github.com/soldair/node-qrcode) — QR code login
