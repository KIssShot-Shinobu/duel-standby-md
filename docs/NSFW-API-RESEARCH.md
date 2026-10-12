# Riset API Gratis untuk Fitur NSFW (anime / manga / ilustrasi)

> Disusun: **12 Oktober 2026** • Semua API di bawah diuji langsung dari mesin ini
> (hasil uji apa adanya dicatat di kolom **Status uji**).
> Kategori `nsfw` di bot ini sudah disiapkan (lihat `lib/menu-config.js`) dan
> masih kosong — dokumen ini yang mengisi pilihannya.

---

## 1. TL;DR — rekomendasi

| Peringkat | Provider | Alasan |
|---|---|---|
| 🥇 Utama | **Danbooru** (`rating:e`) | Tanpa key, JSON kaya (tags + artist + sumber), stok ilustrasi anime terbesar, NSFW tanpa perlu akun |
| 🥈 Cadangan | **yande.re** (+ Konachan) | API Moebooru tanpa key, `file_url`/`sample_url` siap kirim |
| 🥉 Variasi cepat | **PurrBot ImageAPI** | Tanpa key, endpoint NSFW siap pakai (GIF), MIT, ringan |
| 🍥 Manga/doujin | **nhentai API v2** | Publik (anon), metadata lengkap; API key opsional untuk limit lebih tinggi |
| 🔑 Perlu akun gratis | **Gelbooru**, **rule34.xxx** | Wajib `api_key` + `user_id` (gratis, daftar akun) |
| 🧸 SFW/suggestive | **Nekosia**, **nekos.best**, **Safebooru** | Bukan NSFW eksplisit, tapi bagus untuk kategori `anime` biasa |
| ❌ Hindari | **Pixiv**, **waifu.pics**, **waifu.im search**, **Sankaku** | Lihat §5 |

**Kesimpulan singkat soal Pixiv:** **jangan** dipakai. Pixiv tidak punya API publik
resmi untuk pihak ketiga, dan jalur tidak resminya (refresh token OAuth + bypass
Cloudflare) melanggar guideline mereka serta rawan mati sewaktu-waktu. Kalau butuh
karya Pixiv, pakai booru di atas — banyak yang meng-index Pixiv lengkap dengan
`source` + nama artist (contoh: `pixiv_id`, `source: https://www.pixiv.net/...`).

---

## 2. Tabel perbandingan

| API | Jenis konten | Auth | Limit (yang terdokumentasi) | NSFW? | Status uji 12/10/2026 |
|---|---|---|---|---|---|
| [Danbooru](https://danbooru.donmai.us/wiki_pages/help:api) | Ilustrasi anime/manga (booru) | Tanpa key (User-Agent wajib) | Baca global **10 req/detik**, disarankan ±1 req/detik | ✅ `rating:e` | ✅ 200, kirim `file_url`/`large_file_url` |
| [yande.re](https://yande.re/help/api) | Ilustrasi anime (booru) | Tanpa key | Sopan ±1 req/detik | ✅ `rating:e` terbukti ada | ✅ 200, ada `file_url`, `sample_url`, `rating` |
| [Konachan](https://konachan.com/help/api) (Moebooru) | Wallpaper/ilustrasi anime | Tanpa key | Sopan ±1 req/detik | ✅ di `.com` | ⚠️ `konachan.net` 200 (mirror SFW, NSFW kosong); `konachan.com` **403 Cloudflare** dari IP ini |
| [e621](https://e621.net/help/api) | Furry/anthro (booru) | User-Agent wajib; key untuk data privat | **Maks 2 req/detik** (keras) | ✅ `rating:e` | ✅ 200, skema `post.file.url` |
| [PurrBot ImageAPI](https://docs.purrbot.site/api/) | GIF/PNG anime | Tanpa key | Tidak ada limit ketat | ✅ `/img/nsfw/*` | ✅ 200 (`/v2/img/nsfw/neko/gif`) |
| [Gelbooru](https://gelbooru.com/index.php?page=wiki&s=view&id=18780) | Ilustrasi anime (booru) | **Wajib** `api_key` + `user_id` (gratis) | Default 100 post/req; throttle per akun | ✅ | ❌ 401 tanpa key (sesuai dokumen) |
| [rule34.xxx](https://api.rule34.xxx/) | Fanart/gambar 18+ | **Wajib** `api_key` + `user_id` (gratis) | Hingga 1000 post/req; limit bisa diubah | ✅ | ❌ "Missing authentication" tanpa key |
| [nhentai API v2](https://nhentai.net/api/v2/docs) | Doujin/manga 18+ | Publik; key opsional (`Authorization: Key ...`) | Anon: galeri 15/menit, detail 20/menit, search 10/menit | ✅ | ✅ 200 (OpenAPI) |
| [MangaDex](https://api.mangadex.org/docs/) | Manga (termasuk rating `erotica`/`pornographic`) | Publik (User-Agent wajib) | **±5 req/detik per IP**; `at-home` 40/menit | ⚠️ terbatas | ✅ 200 (dokumen) |
| [waifu.im](https://waifu.im/) | Ilustrasi anime | Tanpa key | — | ✅ tag `ero`,`hentai`,`ecchi`,`oppai`,`paizuri`,`oral`,`milf` | ⚠️ `/tags` ✅ 200; `/search` **403 Cloudflare** dari IP datacenter |
| [Nekosia](https://nekosia.cat/documentation) | Anime aesthetic (booru sendiri) | Tanpa key | Ada rate-limit (lihat dokumen) | ❌ hanya `safe`/`suggestive` | ✅ 200, metadata + atribusi artist |
| [nekos.best](https://docs.nekos.best/) | PNG/GIF anime | Tanpa key (User-Agent wajib) | Sopan; `amount` maks 20 | ❌ **SFW total** (60+ kategori, tidak ada NSFW) | ✅ 200 |
| [Safebooru](https://safebooru.org/) | Ilustrasi anime SFW | Tanpa key | Sopan | ❌ `rating: general/safe` | ✅ 200 |
| [Pixiv](https://www.pixiv.net/terms/?page=guideline) | Ilustrasi/manga | **Tidak ada API publik resmi** | — | — | ❌ lihat §5 |
| waifu.pics | PNG | — | — | dulu ✅ | ❌ **DNS `api.waifu.pics` tidak ditemukan** (API mati) |
| Sankaku Complex | Ilustrasi | Token/akun (berubah-ubah) | — | ✅ | ❌ tidak diuji — endpoint sering berubah ([issue gallery-dl](https://github.com/mikf/gallery-dl/issues/7155)) |

---

## 3. Detail provider yang direkomendasikan

### 3.1 Danbooru — andalan utama

```
GET https://danbooru.donmai.us/posts.json?limit=20&tags=rating%3Aexplicit+cat_ears
Header: User-Agent: NamaBot/1.0 (by user #12345)
```

- Field berguna: `file_url` (asli), `large_file_url` (720px), `preview_file_url`, `tag_string*`, `rating`, `source`, `md5`.
- `rating:e` = explicit, `rating:q` = questionable, `rating:s` = safe. Bisa juga `+`-gabung tag lain (`rating:e+1girl`).
- Limit baca global 10 req/detik, tapi dokumen mereka minta **±1 req/detik** untuk sesi panjang; bot yang rakus di-ban.
- **User-Agent wajib deskriptif** (cantumkan ID akun kalau punya). Jangan menyamar sebagai browser.
- Akun + API key hanya diperlukan untuk aksi tulis (vote/upload) — **tidak** untuk membaca.

### 3.2 yande.re / Konachan (Moebooru)

```
GET https://yande.re/post.json?limit=20&tags=rating%3Aexplicit
```

- Field: `file_url`, `sample_url`, `preview_url`, `rating` (`s`/`q`/`e`), `tags` (string spasi), `source`.
- Tanpa key. Konachan memakai skema sama (`/post.json`), hanya beda host:
  `konachan.net` = mirror SFW (uji `rating:explicit` → kosong), `konachan.com` = NSFW penuh (sering dijaga Cloudflare).

### 3.3 PurrBot ImageAPI — paling ringan

```
GET https://api.purrbot.site/v2/img/nsfw/neko/gif
→ { "link": "https://cdn.purrbot.site/nsfw/neko/gif/neko_001.gif", "error": false }
```

- Endpoint NSFW: `anal`, `blowjob`, `cum`, `fuck`, `neko/{img|gif}`, `pussylick`, `solo`, `solo_male`, `threesome_fff`, `threesome_ffm`, `threesome_mmf`, `yaoi`, `yuri`.
- Ada juga `/list/nsfw/{path}` untuk mengambil **banyak** link sekaligus (hemat request).
- Lisensi kode MIT, stok terbatas (aset kurasi sendiri), cocok untuk variasi cepat/fallback.

### 3.4 nhentai API v2 — untuk manga/doujin

```
GET https://nhentai.net/api/v2/galleries/random
GET https://nhentai.net/api/v2/search?query=tag%3A"big breasts"&page=1
Header: User-Agent: NamaBot/1.0 (contact)
Header (opsional): Authorization: Key <API_KEY>
```

- Anon: `random` 20/menit, detail galeri 20/menit, search **10/menit**, populer 8/menit (per IP).
- Key dibuat di `https://nhentai.net/user/settings#apikeys` (butuh proof-of-work + captcha); limit key 20–45/menit.
- Untuk bot: kirim **cover + judul + tag + link**, bukan seluruh halaman (hemat bandwidth, lebih aman).

### 3.5 e621 / e926

```
GET https://e621.net/posts.json?limit=10&tags=rating%3Ae
Header: User-Agent: NamaBot/1.0 (by username on e621)
```

- **Batas keras 2 req/detik**; lewat itu → `503`. Idealnya ≤1 req/detik.
- `e926.net` = mirror SFW dari database yang sama.
- Konten furry/anthro, bukan anime Jepang — masukkan sebagai kategori terpisah kalau mau.

### 3.6 Gelbooru & rule34.xxx — perlu daftar akun

| | Gelbooru | rule34.xxx |
|---|---|---|
| Ambil kredensial | akun → *Options* → API access credentials | `https://rule34.xxx/index.php?page=account&s=options` |
| Parameter | `&api_key=...&user_id=...` | `&api_key=...&user_id=...` |
| Endpoint | `/index.php?page=dapi&s=post&q=index&json=1&tags=...` | `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&tags=...` |
| Catatan ToS | throttle per akun | **dilarang pasang iklan/paywall** di aplikasi yang memakai API mereka; **hanya boleh 1 key** |

Keduanya gratis, tapi menambah ketergantungan: kalau key dicabut, fitur mati. Simpan di `.env`, jangan di kode.

### 3.7 MangaDex (manga legal-ish, ada rating dewasa terbatas)

- API publik, gratis, dokumen rapi: `https://api.mangadex.org/docs/`.
- **Wajib kredit MangaDex + grup scanlation**, **tidak boleh ada iklan/paywall**, dan **wajib proxy** gambar (hotlink dari domain mereka akan diberi gambar "salah" — `uploads.mangadex.org/agg.jpg`).
- Limit ±5 req/detik per IP; `GET /at-home/server/{id}` 40/menit.
- Filter rating: `contentRating[]=safe|suggestive|erotica|pornographic`.

### 3.8 Nekosia / nekos.best / Safebooru (sisi SFW)

- **Nekosia**: tanpa key, `/api/v1/images/{category}`, `rating=suggestive` opsional (eksplisit **tidak ada**). Wajib cantumkan nama artist di caption.
- **nekos.best**: 60+ kategori SFW (`neko`, `waifu`, `hug`, `pat`, …), `amount` 1–20, metadata `artist_name`/`source_url`. **Tidak ada NSFW.**
- **Safebooru**: booru SFW gaya Gelbooru, tanpa key — berguna untuk tag SFW yang sama dengan Danbooru.

---

## 4. Contoh respons nyata (hasil uji)

**Danbooru** (`tags=rating:explicit`, potongan field penting):
```json
[{ "id": 12367478, "rating": "e", "file_url": "https://cdn.donmai.us/original/...jpg",
   "large_file_url": "https://cdn.donmai.us/sample/...jpg", "tag_string_artist": "ame_(amechan17391739)",
   "tag_string_copyright": "girls_und_panzer", "source": "https://x.com/..." }]
```

**yande.re**: `{ "id": 1270275, "rating": "e", "file_url": "...", "sample_url": "...", "tags": "bra breasts ..." }`

**e621**: `{ "posts": [{ "id": 6774508, "rating": "e", "file": { "url": "..." }, "sample": { "url": "..." }, "tags": { "artist": ["..."], ... } }] }`

**PurrBot**: `{ "link": "https://cdn.purrbot.site/nsfw/neko/gif/neko_001.gif", "error": false }`

**Nekosia**: `{ "success": true, "count": 982, "image": { "original": { "url": "..." }, "compressed": { "url": "..." } }, "rating": "safe", "attribution": { "artist": { "username": "AutoINS", "profile": "https://www.pixiv.net/en/users/..." } } }`

### 4.1 Hasil probe otomatis (`npm run check:nsfw`)

Skrip `scripts/nsfw-api-check.mjs` menembak semua provider **dari IP tempat bot
berjalan** (penting: blokir Cloudflare beda-beda per IP/VPS). Hasil di mesin ini
12 Okt 2026:

```text
21:54:13 INFO Cek 15 provider (metadata saja, tanpa mengunduh gambar)
21:54:13 OK   Danbooru     NSFW • tanpa key         200 • 3 hasil
21:54:14 OK   yande.re     NSFW • tanpa key         200 • 3 hasil
21:54:15 OK   Konachan     SFW mirror (.net)        200 • 3 hasil
21:54:15 OK   e621         NSFW furry • 2 req/detik 200 • 3 hasil
21:54:16 OK   PurrBot      NSFW GIF • tanpa key     200 • 1 hasil
21:54:16 OK   waifu.im     NSFW • Cloudflare ketat  200 • 20 hasil
21:54:16 WARN waifu.im cari endpoint gambar (rawan blokir) gagal — 403 • diblok Cloudflare
21:54:17 OK   nhentai v2   manga/doujin • anon      200 • 1 hasil
21:54:17 OK   MangaDex     manga • rating pornographic 200 • 3 hasil
21:54:17 OK   Nekosia      SFW/suggestive saja      200 • 1 hasil
21:54:17 OK   nekos.best   SFW total                200 • 1 hasil
21:54:18 OK   Safebooru    SFW • tanpa key          200 • 3 hasil
21:54:18 INFO Gelbooru     NSFW • wajib key         dilewati — butuh env GELBOORU_API_KEY + GELBOORU_USER_ID
21:54:18 INFO rule34.xxx   NSFW • wajib key         dilewati — butuh env RULE34_API_KEY + RULE34_USER_ID
21:54:18 WARN waifu.pics   dicek: API mati?         gagal — DNS gagal (domain mati?)

21:54:18 OK   Jalan       11/15 provider
21:54:18 OK   Siap NSFW   Danbooru, yande.re, e621, PurrBot, nhentai v2, MangaDex
21:54:18 WARN Bermasalah  waifu.im cari, waifu.pics
```

Artinya: **6 provider siap NSFW tanpa akun** (Danbooru, yande.re, e621, PurrBot,
nhentai v2, MangaDex), 2 provider butuh key (Gelbooru, rule34.xxx), dan
**waifu.im hanya `/tags` yang lolos — endpoint gambarnya diblok Cloudflare**.

---

## 5. Kenapa Pixiv **tidak** dipakai

1. **Tidak ada API publik resmi.** API resmi hanya untuk aplikasi internal/partner. `pixivpy` mencatat: login password dihapus ([issue #158](https://github.com/upbit/pixivpy/issues/158)), dan **Public-API sudah di-deprecate Pixiv (2022)** — yang tersisa hanya App-API tidak resmi.
2. **Butuh refresh token per akun** lewat alur OAuth PKCE (mis. [get-pixivpy-token](https://github.com/eggplants/get-pixivpy-token) berbasis Selenium) → artinya bot harus "menitipkan" akun Pixiv seseorang. Kalau token mati, fitur mati.
3. **Cloudflare + guideline.** Pixiv memblokir trafik otomatis; [Guidelines pixiv](https://www.pixiv.net/terms/?page=guideline) melarang akses otomatis/ scraping tanpa izin. Risiko akun dibekukan.
4. **Alternatif sudah tersedia:** booru meng-index karya Pixiv lengkap dengan `source`/`pixiv_id` dan nama artist, legal untuk dibaca via API resmi mereka.

Kalau tetap ingin "nyaman Pixiv", opsi paling aman: **kirim link** (mis. hasil `source` dari booru) atau pakai endpoint oEmbed resmi untuk preview, bukan mengunduh karya langsung.

**waifu.im** (bagus tapi flaky): `/tags` berhasil, tapi `/search` diblok Cloudflare dari IP datacenter. Kalau dipakai, harus siap fallback + retry.

---

## 6. Rencana implementasi di bot ini

Struktur yang disarankan (mengikuti pola repo: `lib/` untuk logika, `plugins/` untuk command):

```
lib/nsfw-providers.js     # provider Danbooru/yande.re/PurrBot/Nekosia + normalisasi hasil
lib/nsfw-filter.js        # daftar tag terlarang + validasi query
plugins/nsfw-image.js     # .nsfw <tag> — ambil 1 gambar, kirim + caption sumber
plugins/nsfw-manga.js     # .nsfwmanga <query> — cover + judul + link (nhentai v2)
```

**Command usulan**

| Command | Fungsi | Limit |
|---|---|---|
| `.nsfw <tag>` | Gambar acak sesuai tag (default `rating:explicit`) | 1 limit |
| `.nsfw random` | Tanpa tag, acak | 1 limit |
| `.nsfwtags` | Daftar tag populer (cache dari Danbooru `/tags.json`) | gratis |
| `.nsfwmanga <judul>` | Cover + metadata doujin dari nhentai | 2 limit |
| `.nsfwset provider <nama>` | Owner: pilih provider default | — |

**Aturan teknis wajib**

1. **Gating berlapis**: `handler.tags = ['nsfw']` (kategori sudah `enabled: false` secara default) + owner harus `.category nsfw on` + opsi `.nsfwset mode japri` bila mau hanya di private chat.
2. **Filter tag terlarang** di dua tempat: (a) tolak query yang mengandung `loli`, `shota`, `child`, `toddler`, `infant`, `underage`, `lolicon`, `shotacon`, `cub`; (b) saring hasil berdasarkan array `tag_string*` (bukan hanya query).
3. **Unduh lalu kirim**, jangan hotlink. MangaDex secara eksplisit menyajikan gambar rusak untuk hotlink, dan booru lain bisa memblokir referer kosong. Simpan di `database/cache/nsfw/` (pola sama seperti cache kartu YGO), maksimum N berkas + TTL.
4. **Rate limit internal**: 1 request/detik per provider + antrean single-flight; cache daftar hasil per (provider, tag) selama 10–30 menit supaya grup rame tidak menembak API terus.
5. **Dedup**: simpan `md5`/`id` terakhir per chat, jangan kirim gambar yang sama dua kali berturut-turut.
6. **Atribusi**: caption menyertakan sumber + artist (Danbooru/yande.re/Nekosia menyediakannya; MangaDex wajib kredit; nhentai sertakan link galeri).
7. **Fallback berurutan**: Danbooru → yande.re → PurrBot → Nekosia(SFW). Kalau provider utama 403/429, otomatis pindah dan beri tahu singkat.
8. **Key di `.env`**: `GELBOORU_API_KEY`, `GELBOORU_USER_ID`, `RULE34_API_KEY`, `RULE34_USER_ID`, `NHENTAI_API_KEY` (opsional semua).
9. **User-Agent sopan** untuk semua request: `RTXZY-Clean/1.2.7 (bot WhatsApp; kontak owner)`.

**Uji cepat**: `npm run check:nsfw` (skrip baru di repo ini) — menembak semua provider dan melaporkan mana yang jalan/diblok **dari IP tempat bot berjalan**. Ini penting karena blokir Cloudflare berbeda-beda per IP/VPS.

---

## 7. Risiko hukum & kebijakan (baca sebelum menyalakan)

- 🇮🇩 **Indonesia**: UU No. 44/2008 tentang Pornografi melarang memproduksi, menyebarkan, dan menyiarkan konten pornografi; ada sanksi pidana. Bot yang mengirim gambar eksplisit ke banyak orang berisiko secara hukum **dan** bisa dilaporkan.
- 🚫 **Konten anak = garis merah mutlak.** Materi seksual yang melibatkan anak (termasuk gambar/ilustrasi) adalah kejahatan di semua yurisdiksi. Filter tag di §6 wajib, bukan opsional.
- 📱 **Risiko nomor WhatsApp di-ban**: WhatsApp melarang konten dewasa; pengiriman gambar eksplisit massal adalah pemicu umum ban nomor. Opsi paling aman: **mode japri + opt-in per user**, atau kirim **link** ke sumber (bukan gambar) di grup.
- 📢 **Opt-in, bukan opt-out**: biarkan `handler.tags = ['nsfw']` mati secara default (sudah begitu), dan minta konfirmasi 18+ per chat.
- 🧾 **Aturan provider**: rule34.xxx & MangaDex melarang iklan/paywall di aplikasi yang memakai API mereka; MangaDex mewajibkan kredit + proxy gambar; nhentai meminta User-Agent deskriptif.

---

## 8. Sumber

- Danbooru API — https://danbooru.donmai.us/wiki_pages/help:api
- yande.re/Konachan (Moebooru) — https://yande.re/help/api • https://konachan.com/help/api
- e621 API — https://e621.net/help/api
- PurrBot ImageAPI — https://docs.purrbot.site/api/ • https://github.com/purrbot-site/ImageAPI
- Gelbooru API — https://gelbooru.com/index.php?page=wiki&s=view&id=18780
- rule34.xxx API — https://api.rule34.xxx/
- nhentai API v2 — https://nhentai.net/api/v2/docs
- MangaDex API — https://api.mangadex.org/docs/ • https://api.mangadex.org/docs/2-limitations/
- waifu.im — https://waifu.im/ (tags: `/tags`)
- Nekosia — https://nekosia.cat/documentation
- nekos.best — https://docs.nekos.best/
- Safebooru — https://safebooru.org/
- Pixiv Guidelines — https://www.pixiv.net/terms/?page=guideline
- PixivPy (keterbatasan API tidak resmi) — https://github.com/upbit/pixivpy
- Sankaku API berubah-ubah — https://github.com/mikf/gallery-dl/issues/7155
