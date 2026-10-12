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
  version: '1.1.0',
  startedAt: Date.now(),

  bot: {
    name: env('BOT_NAME', 'RTXZY Clean'),
    ownerName: env('OWNER_NAME', 'Owner'),
    /** Setiap karakter menjadi prefix tersendiri, sama seperti RTXZY-MD */
    prefix: [...new Set(prefixSource.split(''))],
    owners,
    ownerJids: toJids(owners),
    mods,
    modsJids: toJids(mods),
    premiumJids: toJids(premiums),
    mode: flags.self ? 'self' : 'public',
    packname: env('STICKER_PACKNAME', 'RTXZY Clean'),
    author: env('STICKER_AUTHOR', 'Bot WhatsApp'),
    thumbnail: env('BOT_THUMBNAIL', ''),
    timezone: env('TIMEZONE', 'Asia/Jakarta'),
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

  health: {
    port: Number(flags.port ?? envNumber('PORT', 0)) || 0,
    host: '0.0.0.0',
    statusFile: path.resolve(ROOT, 'tmp', 'status.json'),
  },

  messages: {
    wait: env('MSG_WAIT', '_*Tunggu sedang di proses...*_'),
    error: env('MSG_ERROR', '_*Terjadi kesalahan pada server*_'),
    stickerWait: env('MSG_STICKER_WAIT', '*⫹⫺ Stiker sedang dibuat...*'),
    banned: env('MSG_BANNED', '_*Kamu diblokir dari bot ini*_'),
    limit: env('MSG_LIMIT', '_*Limit kamu habis, tunggu besok atau upgrade ke premium*_'),
    premium: env('MSG_PREMIUM', '_*Fitur ini khusus pengguna premium*_'),
    owner: env('MSG_OWNER', '_*Fitur ini khusus owner bot*_'),
    admin: env('MSG_ADMIN', '_*Fitur ini khusus admin grup*_'),
    botAdmin: env('MSG_BOT_ADMIN', '_*Jadikan bot admin grup dulu*_'),
    group: env('MSG_GROUP', '_*Fitur ini hanya bisa dipakai di dalam grup*_'),
    private: env('MSG_PRIVATE', '_*Fitur ini hanya bisa dipakai di chat pribadi*_'),
    register: env('MSG_REGISTER', '_*Kamu belum terdaftar. Ketik .daftar nama.umur dulu*_'),
    readonly: env('MSG_READONLY', '_*Bot sedang dalam mode self (hanya owner)*_'),
  },

  /** Argumen mentah, berguna untuk debug/plugin */
  argv: { flags, positionals },
};

export default config;
