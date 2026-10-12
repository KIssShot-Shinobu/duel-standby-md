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
- [Yu-Gi-Oh! (YGOPRODeck API)](#-yu-gi-oh-ygoprodeck-api)
  - [Game: Tebak Kartu](#-game-tebak-kartu-yu-gi-oh)
- [Pengaturan Menu (Owner)](#-pengaturan-menu-owner)
- [Pengaturan Limit (Owner)](#-pengaturan-limit-owner)
- [Hadiah Tiap Pesan (XP & Saldo)](#-hadiah-tiap-pesan-xp--saldo)
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
| **Ekonomi** | Limit harian (auto reset), exp & level, saldo, bank, daily reward, leaderboard, **hadiah tiap pesan (xp & saldo acak 1–9)** |
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
| `.limit add\|del <nomor> <jumlah>` | Tambah/kurangi limit (tersimpan sebagai bonus owner) |
| `.resetlimit <nomor>` | Reset limit harian user (bonus owner tetap) |
| `.menuset` | Ringkasan & pengaturan menu (lihat bagian di bawah) |
| `.category <kategori> show\|hide\|on\|off` | Tampilkan/sembunyikan atau aktifkan/matikan satu kategori |
| `.cmdset <command> show\|hide\|on\|off` | Tampilkan/sembunyikan atau aktifkan/matikan satu command |
| `.limitset` | Ringkasan pengaturan limit |
| `.limitcmd <command> default\|gratis\|pakai\|<angka>` | Atur biaya limit satu command |
| `.limitcat <kategori> default\|gratis\|pakai\|<angka>` | Atur biaya limit satu kategori |
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
| `.sticker [namapack]` | Gambar/video/GIF → stiker (GIF tetap animasi) |
| `.smeme atas\|bawah` | **Stiker meme**: teks di atas & bawah gambar (render lokal ffmpeg) |
| `.toimg` | Stiker → gambar (png) |
| `.tovn` | Audio/video → voice note |
| `.tomp3` | Audio/video → mp3 |
| `.qr <teks>` | Buat QR code |
| `.calc <ekspresi>` | Kalkulator aman (tanpa `eval`) |
</details>

### 🎨 Stiker & Meme

| Perintah | Fungsi |
|---|---|
| `.sticker` / `.s` | Gambar, video (≤10 dtk), **GIF**, atau reply media siapa pun → stiker. GIF/WebP animasi tetap **animasi** |
| `.s https://.../x.gif` | Stiker dari tautan |
| `.smeme teks atas\|teks bawah` | **Stiker meme** dari gambar/GIF/reply, gaya memegen |

**Tentang `.smeme`:** di project asli (RTXZY-MD) fitur ini **mengunggah gambarmu ke API pihak ketiga** (`file.botcahx.eu.org`) lalu meminta memegen.link merender meme-nya. Di sini dirender **lokal dengan ffmpeg `drawtext`** — tidak ada gambar yang dikirim ke layanan lain, dan tetap jalan walau internet mati.- Teks otomatis di-*wrap* (maks 3 baris) dan ukuran font menyesuaikan panjang teks.
- Butuh ffmpeg dengan `drawtext` + satu berkas font. Kalau font tidak ketemu: `apt install fonts-dejavu-core`, atau set `FFMPEG_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` di `.env`.
- Cek cepat di server: `ffmpeg -filters | grep drawtext`.

### 📏 Ukuran stiker animasi (GIF) & batas WhatsApp

WhatsApp **menolak stiker lebih dari 1 MB** — ini penyebab paling umum "stiker GIF gagal dikirim" (stiker diam biasanya kecil, stiker bergerak bisa jauh lebih besar).

Bot sekarang meng-encode ulang secara bertahap sampai muat (target ≤ 500 KB): turun kualitas → fps → resolusi → durasi. Hasil nyata pada GIF berisik (kasus terburuk):

| Sumber | Sebelum | Sesudah | Animasi |
|---|---|---|---|
| GIF 320×320, 2 dtk | 378 KB | **301 KB** | ✅ tetap animasi |
| GIF 320×320, 5 dtk | 1008 KB ❌ | **234 KB** | ✅ tetap animasi |
| GIF 512×512, 5 dtk | 884 KB | **192 KB** | ✅ tetap animasi |
| GIF 512×512, 10 dtk | 1786 KB ❌ | **≤ 500 KB** | ✅ tetap animasi |

Kalau sesuatu yang ekstrem masih melebihi 1 MB, bot otomatis mengirim **stiker statis (frame pertama)** supaya user tetap menerima stiker — dan alasannya dicatat di terminal (`[sticker] animasi ... melebihi batas WhatsApp`), bukan dikirim sebagai pesan error ke grup.

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
<summary><b>game</b> — Yu-Gi-Oh! (data YGOPRODeck)</summary>

| Command | Fungsi |
|---|---|
| `.ygo <nama\|passcode>` | Info kartu + foto + efek lengkap |
| `.card <nama\|passcode>` | **Hanya gambarnya** — tanpa caption, tanpa teks, tanpa quote |
| `.ygorandom` | Kartu acak |
| `.ygosearch <filter>` | Pencarian lanjutan (`atk>2500 type=xyz level<=4`) |
| `.archetype <nama>` / `.archetypes` | Kartu dalam archetype / daftar archetype |
| `.cardset <nama>` / `.setcode <kode>` / `.cardsets` | Info booster pack & kartu di dalamnya |
| `.banlist [tcg\|ocg\|goat]` | Daftar kartu Forbidden/Limited |
| `.tebakygo` | **Game tebak kartu** (lihat bagian di bawah) |
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

## 🎴 Yu-Gi-Oh! (YGOPRODeck API)

Fitur kartu Yu-Gi-Oh! memakai **[YGOPRODeck API v7](https://ygoprodeck.com/api-guide/)** — **gratis, tanpa API key**, jadi langsung bisa dipakai setelah `npm install`.

| Command | Contoh | Fungsi |
|---|---|---|
| `.ygo` | `.ygo Dark Magician` | Nama persis; kalau tidak ketemu otomatis fuzzy search (menampilkan pilihan) |
| `.card` | `.card Dark Magician` | **Kirim gambar kartunya saja** — tanpa caption/teks/quote |
| `.card` | `.card dark magician 2` | Artwork alternatif ke-2 (kalau kartu punya banyak art) |
| `.ygo <passcode>` | `.ygo 46986414` | Cari lewat passcode 8 digit |
| `.ygorandom` | | Kartu acak |
| `.ygosearch` | `.ygosearch atk>2500 level<=4 attribute=dark sort=atk` | Pencarian lanjutan |
| `.ygosearch` | `.ygosearch type=xyz race=dragon num=5` | Filter tipe/race |
| `.ygosearch` | `.ygosearch archetype="blue-eyes" banlist=tcg` | Filter archetype/banlist |
| `.archetype` | `.archetype Blue-Eyes` | Kartu dalam archetype + ringkasan tipe |
| `.archetypes` | | Daftar semua archetype (662+) |
| `.cardset` | `.cardset Metal Raiders` | Kartu dalam sebuah booster pack |
| `.setcode` | `.setcode SDY-046` | Info 1 kartu dari kode set |
| `.cardsets` | | Jumlah set + 10 rilis terbaru |
| `.banlist` | `.banlist tcg` / `ocg` / `goat` | Kartu Forbidden / Limited / Semi-Limited |

**Detail teknis:**
- Output `.ygo`: **foto kartu** + caption statistik (tipe, atribut, level/link, ATK/DEF, archetype, banlist, harga TCGplayer/Cardmarket) lalu **teks efek lengkap**.
- Output `.card`: **hanya gambar** (tanpa caption, tanpa pesan tambahan, tidak di-quote). Kalau nama yang diketik ambigu, bot membalas daftar nama polos supaya bisa dipersempit. Gambar disimpan di `database/cache/cards/` (maks `YGO_IMAGE_CACHE_MAX` berkas) sehingga pemanggilan berikutnya instan — sesuai permintaan YGOPRODeck agar gambar tidak di-hotlink terus-menerus.
- Rate limit API **20 request/detik**; bot memakai cache 2 hari di memori + berkas `database/ygoprodeck-cache.json` (API juga meminta data disimpan lokal). Hapus berkas itu kalau mau data segar.
- Gambar diunduh lalu dikirim sebagai lampiran WhatsApp (tidak hotlink ke server mereka).
- Filter `.ygosearch` yang didukung: `name`, `fname`, `id`, `type`, `atk`, `def`, `level`, `race`, `attribute`, `link`, `linkmarker`, `scale`, `cardset`, `archetype`, `banlist`, `sort`, `format`, `staple`, `misc`, `has_effect`, `startdate`, `enddate`, `num`, `offset`. Operator `>` `>=` `<` `<=` hanya untuk `atk`/`def`/`level`. Nilai berisi spasi pakai tanda kutip: `type="xyz monster"`.
- Alias tipe: `normal`, `effect`, `ritual`, `fusion`, `synchro`, `xyz`, `link`, `pendulum`, `spell`, `trap`.
- Env opsional: `YGO_BASE`, `YGO_TIMEOUT`, `YGO_CACHE_FILE`, `YGO_CACHE_MAX`.
- Cek cepat di server: **`npm run check:ygo`** (versi database, lookup, fuzzy, filter, random, archetype, set, banlist, unduh gambar).

---

### 🎮 Game: Tebak Kartu Yu-Gi-Oh!

Bot mengirim **art crop** kartu (`image_url_cropped`) — jadi **nama kartu tidak terlihat di gambar**. Pemain menebak nama kartunya.

| Command | Fungsi |
|---|---|
| `.tebakygo` | Mulai game (default **3 ronde**, mode **pilihan ganda A–D**) |
| `.tebakygo teks` | Mode tulis nama sendiri (ada 2 petunjuk otomatis) |
| `.tebakygo pilihan 5` | 5 ronde, pilihan ganda |
| `.nyerah` | Buka jawaban lalu lanjut ronde berikutnya |
| `.stoptebak` | Hentikan game (pembuat game / admin / owner) |
| `.yugoscore` | Papan skor 10 penebak terbaik |

**Aturan & hadiah**
- 🔁 **Jawaban salah tidak mengakhiri ronde.** Ronde hanya berakhir kalau ada yang menjawab benar atau waktu habis — jadi satu grup bisa menebak bergantian sampai ada yang kena.
- Pilihan ganda: **1 percobaan per pemain per ronde** (`YGO_QUIZ_CHOICE_ATTEMPTS`), supaya tidak bisa brute-force A–D dengan menebak semua huruf. Jawab `A`/`B`/`C`/`D` **atau** tulis namanya.
- Mode teks: **3 percobaan per pemain** (`YGO_QUIZ_ATTEMPTS`); petunjuk muncul di detik ke-20 (awalan + jumlah huruf) dan ke-40 (tipe/atribut/archetype).
- Pemain yang percobaannya habis diberi tahu **sekali**, lalu tebakannya diabaikan — ronde tetap jalan untuk pemain lain.
- Jawaban benar → **+500 saldo, +25 exp, +1 limit** (bisa diatur lewat env) dan dihitung di `.yugoscore`.
- Default 60 detik per ronde; waktu habis → jawaban dibuka otomatis dan lanjut ronde berikutnya.
- Jawaban toleran salah ketik (mis. `dark magican` tetap benar) dan passcode kartu juga diterima.
- Satu game per chat; hanya pembuat game/admin/owner yang bisa menghentikannya.

**Env pengaturan**

| Env | Default | Fungsi |
|---|---|---|
| `YGO_QUIZ_ROUNDS` | `3` | Jumlah ronde default |
| `YGO_QUIZ_MAX_ROUNDS` | `10` | Batas ronde |
| `YGO_QUIZ_MODE` | `pilihan` | Mode default (`pilihan`/`teks`) |
| `YGO_QUIZ_TIMEOUT` | `60000` | Durasi per ronde (ms) |
| `YGO_QUIZ_HINT_DELAY` | `20000` | Jeda petunjuk pertama (ms) |
| `YGO_QUIZ_ATTEMPTS` | `3` | Percobaan maksimum per pemain di mode teks |
| `YGO_QUIZ_CHOICE_ATTEMPTS` | `1` | Percobaan per pemain di mode pilihan ganda |
| `YGO_QUIZ_ROUND_DELAY` | `2500` | Jeda antar ronde (ms) |
| `YGO_QUIZ_REWARD` / `YGO_QUIZ_EXP` / `YGO_QUIZ_LIMIT` | `500` / `25` / `1` | Hadiah jawaban benar |

Cek cepat tanpa WhatsApp: **`npm run check:quiz`** (ambil kartu asli, tampilkan art crop & pilihan, lalu jawab otomatis).

---

## ⚙️ Pengaturan Menu (Owner)

Owner bisa mengatur **kategori & command mana yang tampil** di `.menu`, dan mana yang **boleh dipakai**:

| Perintah | Fungsi |
|---|---|
| `.menuset` | Ringkasan semua kategori + jumlah command yang disembunyikan/dimatikan |
| `.menuset list <kategori>` | Daftar command di kategori itu beserta statusnya |
| `.category <kategori> show\|hide` | Tampilkan / sembunyikan seluruh kategori dari menu |
| `.category <kategori> on\|off` | Aktifkan / matikan seluruh kategori (command diblokir) |
| `.cmdset <command> show\|hide` | Tampilkan / sembunyikan satu command dari menu |
| `.cmdset <command> on\|off` | Aktifkan / matikan satu command |

**Bedanya `hide` dan `off`:**

| Aksi | Muncul di `.menu` | Bisa dijalankan |
|---|---|---|
| `hide` | ❌ tidak | ✅ masih bisa (kalau tahu command-nya) |
| `off` | ✅ masih muncul | ❌ diblokir — user diberi pesan *"Fitur ini sedang dimatikan oleh owner."* |
| `hide` + `off` | ❌ tidak | ❌ diblokir |

Pengaturan disimpan di database (`settings.menu`) sehingga bertahan setelah restart, dan `.help <command>` menampilkan status command tersebut.

### 🔞 Kategori NSFW (sudah disiapkan, masih kosong)

Kategori `nsfw` sudah terdaftar sebagai placeholder dan muncul di `.menu` sebagai **NSFW (18+) (0) — belum ada command**, tetapi **belum aktif** (`enabled: false`).

- Mengaktifkan: `.category nsfw on` — lalu command NSFW bisa dipakai.
- Menyembunyikan dari menu: `.category nsfw hide`.
- **Menambah plugin NSFW nanti cukup**: buat file di `plugins/` dengan `handler.tags = ['nsfw']` — otomatis ikut aturan kategori ini (default tertutup sampai owner mengaktifkannya).

---

## 💳 Pengaturan Limit (Owner)

### Kelola premium & limit user

Target bisa ditulis dengan **tiga cara** — nomor, mention, atau cukup reply pesan user:

```
.premium add 628123456789 30      # 30 hari
.premium add 08123456789          # 08xx otomatis jadi 628xx
.premium add @628123456789 30     # pakai mention
.premium add 30                   # sambil reply pesan user -> 30 hari
.limit add 628123456789 10        # +10 limit
.limit add 10                     # sambil reply -> +10
.limit del 628123456789 5         # kurangi 5
.resetlimit 628123456789          # reset kuota harian (bonus owner tetap)
```

- `.premium add` langsung menaikkan kuota limit ke kuota premium, `.premium del` mengembalikannya ke kuota free.
- Tambahan limit dari owner disimpan sebagai **bonus** (`limitBonus`) sehingga **tidak hilang saat reset limit harian**.
- Kalau target tidak valid, bot hanya mengirim petunjuk format — tidak ada data user palsu yang dibuat.

> ⚠️ Kalau command owner menjawab *"Fitur ini khusus owner bot"*, artinya `OWNER_NUMBER` di `.env` belum diisi nomor owner (format `628xx`, pisahkan dengan koma bila lebih dari satu): `OWNER_NUMBER="628123456789"`.

### Atur fitur mana yang pakai limit

Setiap plugin punya biaya limit bawaan (`handler.limit`). Owner bisa menimpanya **tanpa mengedit kode**:

| Perintah | Fungsi |
|---|---|
| `.limitset` | Ringkasan: berapa command berlimit, mana yang dibuat gratis / diubah biayanya |
| `.limitcmd <command> default\|gratis\|pakai\|<angka>` | Atur biaya **satu command** |
| `.limitcat <kategori> default\|gratis\|pakai\|<angka>` | Atur biaya **seluruh kategori** |

Arti aksinya:

| Aksi | Efek |
|---|---|
| `default` | Ikut bawaan plugin (sekaligus menghapus aturan owner) |
| `gratis` / `free` | Tidak memotong limit sama sekali |
| `pakai` / `on` | Wajib memakai limit (minimal 1, walau pluginnya gratis) |
| `<angka>` | Biaya khusus, mis. `3` = memotong 3 limit |

**Prioritas:** pengaturan **command** > pengaturan **kategori** > bawaan plugin.

```
.limitcmd smeme gratis        # .smeme tidak lagi memotong limit
.limitcmd ytmp4 3             # .ytmp4 memotong 3 limit
.limitcat game gratis         # semua command kategori game gratis
.limitcat downloader pakai    # semua command downloader wajib pakai limit
.limitcmd smeme default       # kembalikan ke bawaan plugin
```

Pengaturan disimpan di `settings.limit` pada database (bertahan setelah restart), dan `.help <command>` menampilkan biaya efektifnya.

### 💾 Apakah pengaturan hilang kalau bot di-restart?

**Tidak.** Pengaturan menu (`settings.menu`) dan limit (`settings.limit`) tersimpan di **`database/database.json`**, bukan di memori, jadi langsung terbaca lagi setelah restart.

Tiga lapis pengaman yang sudah dipasang:

1. **Tulis langsung** — setiap kali owner memakai `.category`, `.cmdset`, `.limitcmd`, atau `.limitcat`, perubahan langsung ditulis ke disk (`db.save(true)`), tidak menunggu timer.
2. **Flush saat proses berhenti** — `process.on('exit')` memanggil `flushSync()` untuk membuang perubahan tertunda apa pun (termasuk dari fitur lain seperti saldo/exp/user).
3. **Auto-save berkala** — semua perubahan lain (pesan, limit harian, RPG) di-debounce 10 detik (`DB_SAVE_INTERVAL`), plus flush saat `SIGINT`/`SIGTERM`.

Sudah diuji: proses yang menerapkan 4 pengaturan lalu **dibunuh paksa (SIGKILL)** — saat dijalankan ulang, semuanya masih utuh.

> ⚠️ Yang perlu dijaga: folder **`database/`** harus persisten. Kalau panel mengganti container dari awal / kamu menghapus folder itu, pengaturan (dan data user) ikut hilang. Di Docker sudah otomatis jadi volume (`docker-compose.yml`); kalau pindah server, backup `database/` dan `sessions/`.

## 💬 Hadiah Tiap Pesan (XP & Saldo)

Setiap pesan dari user langsung mendapat **XP dan saldo acak 1–9** (keduanya diundi terpisah). **Tidak ada pesan apa pun yang dikirim ke chat** — perolehannya hanya dicatat di terminal:

```
[reward] 628111 +9 xp +8 saldo | total 9 xp, 8 saldo, level 0
[reward] 628111 +4 xp +5 saldo | total 13 xp, 13 saldo, level 0
[reward] 628111 +8 xp +2 saldo | total 21 xp, 15 saldo, level 0
```

User bisa cek sendiri kapan saja lewat `.profile` (exp, level, saldo) dan `.leaderboard`. Naik level (level = `floor(sqrt(exp/100))` → level 1 di 100 xp, level 2 di 400 xp) juga **tidak** diumumkan ke chat secara default; aktifkan dengan `CHAT_LEVELUP_NOTICE="true"` kalau mau.

- **Tidak** diberi untuk: pesan bot sendiri, chat yang di-*mute*, user yang diblokir, dan pesan yang dihentikan hook (mis. anti-spam/anti-link).

| Env | Default | Fungsi |
|---|---|---|
| `CHAT_REWARD` | `true` | Matikan dengan `"false"` |
| `CHAT_XP_MIN` / `CHAT_XP_MAX` | `1` / `9` | Rentang XP per pesan |
| `CHAT_SALDO_MIN` / `CHAT_SALDO_MAX` | `1` / `9` | Rentang saldo per pesan |
| `CHAT_REWARD_COOLDOWN` | `0` | Jeda minimum antar hadiah per user (ms). Naikkan (mis. `5000`) untuk mencegah farming |
| `CHAT_REWARD_LOG` | `true` | Catat perolehan di terminal (set `"false"` kalau terminal terlalu ramai) |
| `CHAT_LEVELUP_NOTICE` | `false` | `"true"` = kirim pesan naik level ke chat |

## 🩹 Troubleshooting

### Stiker tidak jadi / error

| Pesan / gejala | Penyebab & solusi |
|---|---|
| Bot bilang *"Kirim atau reply gambar/video"* padahal ada gambarnya | Sudah diperbaiki di v1.1 (dulu `m.msg` berisi kontainer pesan sehingga `m.msg.mimetype` kosong). Pastikan memakai ZIP terbaru. |
| *"Server belum punya encoder WebP"* | ffmpeg build minimal tanpa libwebp. Jalankan `ffmpeg -encoders \| grep webp`. Kalau kosong: `apt install ffmpeg` (lengkap) atau `apt install webp` (bot otomatis pakai `cwebp` untuk gambar). |
| Video ditolak | Batas durasi stiker video 10 detik (`MAX_STICKER_SECONDS`), dan stiker animasi wajib ffmpeg (bukan cwebp). |
| Stiker jadi tapi tanpa nama pack | `node-webpmux` gagal menyisipkan EXIF — biasanya karena file masukan bukan WebP valid. Coba kirim ulang gambarnya. |
| Mau cek cepat | `npm run check:sticker` (uji gambar→webp→EXIF, video→webp animasi, dan jalur plugin `.sticker`). |

### Koneksi: pairing code muncul padahal sudah login / tiba-tiba logout

| Gejala | Penyebab & solusi |
|---|---|
| Restart bot lalu muncul **pairing code** lagi, tak lama koneksi ditutup `503` dan `401 (sesi logout)` | Bug yang sudah diperbaiki: Baileys 6.7 hanya menandai `creds.registered = true` untuk login **pairing code**, tidak untuk **QR** — jadi bot mengira belum login dan meminta pairing code, yang membuat WhatsApp mematikan perangkat. Sekarang bot memeriksa `sessions/creds.json` (termasuk `me.id`) dan **tidak akan** minta pairing code kalau sesi sudah ada. |
| Sudah kena `401` | Sesi lama otomatis dipindahkan ke `sessions.logged-out-<waktu>` dan bot dijalankan ulang — pairing code/QR baru akan muncul. Kalau mau bersih total: hapus folder `sessions*` lalu `npm start`. |
| Ingin ganti nomor / login ulang | Hapus folder `sessions/` lalu jalankan `node index.js --pair 628xxx` (atau `--qr`). Pairing code hanya diminta kalau folder sesi **kosong**. |

### Koneksi & sesi

- Sesi disimpan di `sessions/`. **Jangan commit** folder ini.
- Kalau `sessions/` sudah berisi creds, `--pair`/`PAIRING_NUMBER` diabaikan (supaya sesi tidak dimatikan).
- Saat logout terdeteksi, folder sesi dipindahkan otomatis ke `sessions.logged-out-<waktu>` (tidak dihapus, jadi masih bisa diperiksa).

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

### Menangani error di plugin

Pesan yang salah dari sisi pengguna (mis. lupa kirim gambar) sebaiknya **ditampilkan apa adanya**, sedangkan error teknis (bug, jaringan, API mati) disamarkan:

```js
import { userError } from '../lib/errors.js';

// ✅ pesan ramah -> langsung dikirim ke pengguna
throw userError('❌ Kirim atau reply gambar dulu ya');
// atau gaya lama yang tetap didukung:
throw 'Kirim atau reply gambar dulu ya';

// ❌ hindari untuk pesan ke pengguna: dianggap error teknis
throw new Error('Kirim atau reply gambar dulu ya');
```

Error teknis dibalas dengan `global.eror` / `config.messages.error`; detail aslinya hanya muncul kalau bot dijalankan dengan `--debug`. Semua error (ramah maupun teknis) tetap dicatat di log.

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
