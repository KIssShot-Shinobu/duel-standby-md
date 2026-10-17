/**
 * Konfigurasi global bot.
 * Prioritas: argumen CLI  >  environment (.env)  >  default.
 *
 * Dipakai plugin lewat context `config`, dan juga dicerminkan ke `global.*`
 * supaya plugin lama bergaya RTXZY-MD (global.prefix, global.packname, ...)
 * tetap jalan.
 */
import path from 'node:path';
import './lib/env.js';
import { env, envNumber, envList } from './lib/env.js';
import { parseArgv, flagEnabled } from './lib/argv.js';
import { DEFAULT_BLOCKED_TAGS } from './lib/image-source.js';
import { SHINOBU_PERSONA } from './lib/shinobu-persona.js';

const ROOT = path.resolve(import.meta.dirname);
const { flags, positionals } = parseArgv();

const DEFAULT_PREFIX = '.#!/,';
const prefixSource = flags.prefix !== undefined && flags.prefix !== true ? String(flags.prefix) : env('PREFIX', DEFAULT_PREFIX);

const toNumbers = (list) => list.map((item) => String(item).replace(/[^\d]/g, '')).filter(Boolean);
const toJids = (numbers) => numbers.map((number) => `${number}@s.whatsapp.net`);

const owners = toNumbers(envList('OWNER_NUMBER', ['628xxxxxxxxxx']));
const mods = toNumbers(envList('MODS_NUMBER', []));
const premiums = toNumbers(envList('PREMIUM_NUMBER', []));

export const config = {
  root: ROOT,
  /** Metadata proses */
  version: '1.3.0',
  startedAt: Date.now(),

  bot: {
    name: env('BOT_NAME', 'Duel Standby'),
    ownerName: env('OWNER_NAME', 'Owner'),
    /** Setiap karakter menjadi prefix tersendiri, sama seperti RTXZY-MD */
    prefix: [...new Set(prefixSource.split(''))],
    owners,
    ownerJids: toJids(owners),
    mods,
    modsJids: toJids(mods),
    premiumJids: toJids(premiums),
    mode: flags.self ? 'self' : 'public',
    packname: env('STICKER_PACKNAME', 'Duel Standby'),
    author: env('STICKER_AUTHOR', 'Bot WhatsApp'),
    thumbnail: env('BOT_THUMBNAIL', ''),
    timezone: env('TIMEZONE', 'Asia/Jakarta'),
    /**
     * Pesan lebih tua dari ini (ms) diabaikan. Saat bot mati lalu nyambung
     * lagi, WhatsApp menyalurkan antrian pesan tertunda (bisa berjam-jam lalu).
     * Tanpa batas ini bot membalas seluruh backlog sekaligus dan membanjiri
     * grup. 0 = nonaktif (proses semua pesan apa pun umurnya).
     */
    maxMessageAgeMs: envNumber('MAX_MESSAGE_AGE_MS', 5 * 60 * 1000),
  },

  /** Flag runtime dari CLI */
  flags: {
    qr: flagEnabled(flags, 'qr', false),
    pair: flags.pair !== undefined && flags.pair !== true ? String(flags.pair).replace(/[^\d]/g, '') : env('PAIRING_NUMBER', ''),
    self: flagEnabled(flags, 'self', false),
    pcOnly: flagEnabled(flags, 'pconly', false),
    gcOnly: flagEnabled(flags, 'gconly', false),
    swOnly: flagEnabled(flags, 'swonly', false),
    restrict: flagEnabled(flags, 'restrict', false),
    autoread: flagEnabled(flags, 'autoread', false),
    nyimak: flagEnabled(flags, 'nyimak', false),
    test: flagEnabled(flags, 'test', false),
    debug: flagEnabled(flags, 'debug', false),
    bigQr: flagEnabled(flags, 'big-qr', false),
    autocleartmp: flagEnabled(flags, 'autocleartmp', true),
    noConnect: flagEnabled(flags, 'no-connect', false),
    health: flagEnabled(flags, 'health', true),
    reload: flagEnabled(flags, 'reload', !flagEnabled(flags, 'no-reload', false)),
    db: typeof flags.db === 'string' ? flags.db : env('DB_FILE', path.join('database', 'database.json')),
  },

  session: {
    dir: path.resolve(ROOT, typeof flags.session === 'string' ? flags.session : env('SESSION_DIR', 'sessions')),
    /** tunggu berapa ms sebelum minta pairing code */
    pairingDelay: envNumber('PAIRING_DELAY', 3000),
  },

  database: {
    file: path.resolve(
      ROOT,
      typeof flags.db === 'string' && flags.db !== 'json' && !flags.db.startsWith('mongodb')
        ? flags.db
        : env('DB_FILE', 'database/database.json'),
    ),
    saveInterval: envNumber('DB_SAVE_INTERVAL', 10000),
    /** true bila user meminta backend yang belum didukung (mis. MongoDB) */
    unsupportedBackend: typeof flags.db === 'string' && flags.db.startsWith('mongodb') ? flags.db : '',
  },

  media: {
    tmpDir: path.resolve(ROOT, env('TMP_DIR', 'tmp')),
    maxStickerSeconds: envNumber('MAX_STICKER_SECONDS', 10),
    maxUploadBytes: envNumber('MAX_UPLOAD_BYTES', 64 * 1024 * 1024),
    /** Font untuk fitur meme (.smeme) — kosong = deteksi otomatis */
    fontPath: env('FFMPEG_FONT', ''),
  },

  api: {
    base: env('API_BASE', ''),
    key: env('API_KEY', ''),
    timeout: envNumber('API_TIMEOUT', 60000),
  },

  ai: {
    base: env('AI_BASE', 'https://api.openai.com/v1'),
    key: env('AI_KEY', ''),
    model: env('AI_MODEL', 'gpt-4o-mini'),
    /** Perilaku khusus AI untuk OWNER (reply/tag bot -> jawab sebagai waifu) */
    ownerEnabled: env('AI_OWNER_ENABLED', 'true') !== 'false',
    /** Model khusus owner (kosong = pakai ai.model) */
    ownerModel: env('AI_OWNER_MODEL', ''),
    /** Panjang riwayat yang diingat untuk percakapan owner */
    ownerHistory: envNumber('AI_OWNER_HISTORY', 50),
    /** File penyimpanan memori owner (terpisah dari database utama) */
    ownerFile: env('AI_OWNER_FILE', path.join('database', 'owner-ai.json')),
    /** Sistem prompt persona owner (default = Oshino Shinobu) */
    ownerPersona: env('AI_OWNER_PERSONA', SHINOBU_PERSONA),
  },

  /** Yu-Gi-Oh! API (YGOPRODeck) â€” gratis, tanpa API key */
  ygoprodeck: {
    base: env('YGO_BASE', 'https://db.ygoprodeck.com/api/v7'),
    timeout: envNumber('YGO_TIMEOUT', 30000),
    cacheFile: env('YGO_CACHE_FILE', path.join('database', 'ygoprodeck-cache.json')),
    cacheMax: envNumber('YGO_CACHE_MAX', 400),
    /** Cache gambar kartu (API meminta gambar disimpan sendiri, bukan di-hotlink) */
    imageCacheDir: env('YGO_IMAGE_CACHE', path.join('database', 'cache', 'cards')),
    imageCacheMax: envNumber('YGO_IMAGE_CACHE_MAX', 300),
  },

  /** Game tebak kartu Yu-Gi-Oh! */
  game: {
    yugioh: {
      rounds: envNumber('YGO_QUIZ_ROUNDS', 3),
      maxRounds: envNumber('YGO_QUIZ_MAX_ROUNDS', 10),
      mode: env('YGO_QUIZ_MODE', 'pilihan'),
      timeoutMs: envNumber('YGO_QUIZ_TIMEOUT', 60000),
      hintDelayMs: envNumber('YGO_QUIZ_HINT_DELAY', 20000),
      maxAttempts: envNumber('YGO_QUIZ_ATTEMPTS', 3),
      choiceAttempts: envNumber('YGO_QUIZ_CHOICE_ATTEMPTS', 1),
      roundDelayMs: envNumber('YGO_QUIZ_ROUND_DELAY', 2500),
      rewardSaldo: envNumber('YGO_QUIZ_REWARD', 500),
      rewardExp: envNumber('YGO_QUIZ_EXP', 25),
      rewardLimit: envNumber('YGO_QUIZ_LIMIT', 1),
      /** Mode gambar-saja (.tebakgambar): jawaban harus persis, tanpa pilihan */
      imageRounds: envNumber('YGO_IMAGE_ROUNDS', 3),
      imageTimeoutMs: envNumber('YGO_IMAGE_TIMEOUT', 90000),
      imageAttempts: envNumber('YGO_IMAGE_ATTEMPTS', 5),
      /** Biaya limit untuk membeli petunjuk (.hint) */
      hintCost: envNumber('YGO_HINT_COST', 3),
      /** Maksimal berapa kali satu pemain membeli petunjuk per ronde */
      maxHints: envNumber('YGO_MAX_HINTS', 3),
    },
  },

  /**
   * Gambar anime: `.sfw` (aman) dan `.nsfw` (18+, kategori mati secara default).
   * Provider & urutan fallback diatur di sini; detail di lib/image-source.js.
   */
  images: {
    timeoutMs: envNumber('IMAGE_TIMEOUT', 20000),
    /** Batas ukuran berkas yang diunduh (byte) */
    maxBytes: envNumber('IMAGE_MAX_BYTES', 8 * 1024 * 1024),
    /** Berapa hasil yang diminta ke booru per panggilan (untuk diacak lokal) */
    limitPosts: envNumber('IMAGE_LIMIT_POSTS', 30),
    /** Berapa lama daftar hasil di-cache (ms) supaya API tidak dibombardir */
    listTtlMs: envNumber('IMAGE_LIST_TTL', 600000),
    cacheDir: env('IMAGE_CACHE_DIR', path.join('database', 'cache', 'images')),
    cacheMax: envNumber('IMAGE_CACHE_MAX', 200),
    /** Urutan provider (lihat lib/image-source.js): danbooru, yandere, purrbot, nekosbest, safebooru */
    providers: {
      nsfw: envList('NSFW_PROVIDERS', ['danbooru', 'yandere', 'purrbot']),
      sfw: envList('IMAGE_PROVIDERS', ['nekosbest', 'danbooru', 'yandere', 'safebooru', 'purrbot']),
    },
    /** Tag yang ditolak di input dan disaring dari hasil (konten anak = garis merah) */
    blockedTags: envList('IMAGE_BLOCKED_TAGS', DEFAULT_BLOCKED_TAGS),
  },

  ytdlp: {
    path: env('YTDLP_PATH', ''),
    maxDurationSeconds: envNumber('YTDLP_MAX_DURATION', 900),
    maxHeight: envNumber('YTDLP_MAX_HEIGHT', 720),
    cookies: env('YTDLP_COOKIES', ''),
    extraArgs: env('YTDLP_ARGS', ''),
  },

  limits: {
    free: envNumber('LIMIT_FREE', 20),
    premium: envNumber('LIMIT_PREMIUM', 100),
    resetIntervalMs: 24 * 60 * 60 * 1000,
    premiumDays: envNumber('PREMIUM_DAYS', 30),
  },

  /**
   * Jual limit ke user pakai saldo in-game (command `.buylimit`).
   *
   * Saldo didapat dari chat & kuis, jadi ini jadi penyeimbang ekonomi bot:
   * user yang aktif tidak akan kehabisan limit, tapi saldo yang dikumpulkan
   * tidak menumpuk tanpaopperan.
   *
   * Limit yang dibeli disimpan sebagai bonus permanen — tidak hilang saat reset
   * harian, dan langsung terpakai seperti limit biasa.
   */
  buyLimit: {
    enabled: env('BUY_LIMIT_ENABLED', 'true') !== 'false',
    /** saldo per 1 limit, untuk pembelian jumlah bebas */
    price: envNumber('BUY_LIMIT_PRICE', 250),
    /** paket: selalu lebih murah dari harga satuan */
    packages: [
      { limit: 10, price: 2000 },
      { limit: 30, price: 5000 },
      { limit: 60, price: 9000 },
    ],
    /** rentang pembelian jumlah bebas */
    min: envNumber('BUY_LIMIT_MIN', 1),
    max: envNumber('BUY_LIMIT_MAX', 60),
    /** batas total pembelian per siklus limit harian */
    dailyCap: envNumber('BUY_LIMIT_DAILY_CAP', 60),
    /** batas total pembelian per bulan kalender */
    monthlyCap: envNumber('BUY_LIMIT_MONTHLY_CAP', 300),
  },

  /**
   * Sewa bot per grup (fitur rent).
   * Grup tanpa sewa aktif terkunci kecuali plugin free (yugioh & stiker)
   * dan main-*. Harga bisa di-override per menit lewat `.rent price` (tersimpan
   * di db.settings.rentPrice).
   */
  rent: {
    enabled: env('RENT_ENABLED', 'true') !== 'false',
    /** durasi sewa 1 bulan = 30 hari */
    days: envNumber('RENT_DAYS', 30),
    /** harga sewa per bulan; 0 = owner set lewat `.rent price` */
    pricePerMonth: envNumber('RENT_PRICE', 0),
    /** gambar QRIS untuk pembayaran (relatif config.root, diganti owner) */
    qrisFile: env('RENT_QRIS', 'assets/qris.jpg'),
    /** nomor (tanpa +) untuk link DM bantuan sewa yang tampil di menu rent */
    helpNumber: env('RENT_HELP_NUMBER', '628970080509'),
    /** H-berapa sebelum expired bot mengingatkan penyewa (sekali per periode) */
    reminderDays: envList('RENT_REMINDER_DAYS', ['3', '1']).map((x) => Number(x)),
    /** plugin yang selalu free (prefix nama file plugin) */
    freePlugins: ['game-yugioh', 'tools-sticker', 'sticker-', 'tools-toimg'],
    /** plugin yang tidak pernah dikunci */
    alwaysAllowed: ['main-', 'owner-', 'rent.js', '_rent-guard'],
    /** pesan saat command terkunci karena grup tidak punya sewa aktif */
    gatedMessage: env('RENT_GATED_MSG', '🔒 Fitur ini butuh sewa aktif. Ketik `.rent` untuk menyewa.'),
    /** seberapa sering sweep cek expired/reminder */
    sweepIntervalMs: 6 * 60 * 60 * 1000,
  },

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

  /** Hadiah tiap pesan chat (XP & saldo acak) */
  rewards: {
    chat: {
      enabled: env('CHAT_REWARD', 'true') !== 'false',
      expMin: envNumber('CHAT_XP_MIN', 1),
      expMax: envNumber('CHAT_XP_MAX', 9),
      saldoMin: envNumber('CHAT_SALDO_MIN', 1),
      saldoMax: envNumber('CHAT_SALDO_MAX', 9),
      /** jeda minimum antar hadiah per user (ms). 0 = tiap pesan dapat hadiah */
      cooldownMs: envNumber('CHAT_REWARD_COOLDOWN', 0),
      /** catat perolehan xp/saldo di terminal saja (tidak ada pesan ke user) */
      log: env('CHAT_REWARD_LOG', 'true') !== 'false',
      /** kirim pesan ke chat saat user naik level (default: tidak, cukup di terminal) */
      levelUpNotice: env('CHAT_LEVELUP_NOTICE', 'false') === 'true',
    },
  },

  health: {
    port: Number(flags.port ?? envNumber('PORT', 0)) || 0,
    host: '0.0.0.0',
    statusFile: path.resolve(ROOT, 'tmp', 'status.json'),
  },

  messages: {
    wait: env('MSG_WAIT', 'Sebentar ya...'),
    error: env('MSG_ERROR', 'Ups, ada yang error di server.'),
    stickerWait: env('MSG_STICKER_WAIT', 'Stiker lagi dibuat...'),
    banned: env('MSG_BANNED', 'Kamu diblokir dari bot ini.'),
    limit: env('MSG_LIMIT', 'Limit kamu udah habis. Reset besok ya, atau upgrade ke premium.'),
    premium: env('MSG_PREMIUM', 'Fitur ini khusus pengguna premium.'),
    owner: env('MSG_OWNER', 'Fitur ini khusus owner bot.'),
    disabled: env('MSG_DISABLED', 'Fitur ini lagi dimatikan sama owner.'),
    admin: env('MSG_ADMIN', 'Fitur ini khusus admin grup.'),
    botAdmin: env('MSG_BOT_ADMIN', 'Jadiin bot admin grup dulu ya.'),
    group: env('MSG_GROUP', 'Fitur ini cuma bisa dipakai di grup.'),
    private: env('MSG_PRIVATE', 'Fitur ini cuma bisa dipakai di chat pribadi.'),
    register: env('MSG_REGISTER', 'Kamu belum daftar. Ketik .daftar nama.umur dulu.'),
    readonly: env('MSG_READONLY', 'Bot lagi mode self (hanya owner).'),
  },

  /** Argumen mentah, berguna untuk debug/plugin */
  argv: { flags, positionals },
};

export default config;
