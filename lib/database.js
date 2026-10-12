/**
 * Database bot: JSON + penulisan atomik (tmp -> rename) + debounce.
 *
 * Kenapa JSON dan bukan SQLite?
 *  - nol dependency native, jalan di panel/VPS/Termux/Windows tanpa build tools;
 *  - skema bebas diubah tanpa migrasi rumit;
 *  - cukup untuk beban bot chat (ribuan user).
 * Kalau nanti butuh SQLite, tinggal buat adapter baru dengan antarmuka yang sama
 * (read/write) — lihat README bagian "Ganti backend database".
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanJid } from './functions.js';

export const DEFAULT_USER = () => ({
  jid: '',
  name: '',
  registered: false,
  age: -1,
  premium: false,
  premiumUntil: 0,
  banned: false,
  bannedReason: '',
  limit: 0,
  lastLimitReset: 0,
  exp: 0,
  level: 0,
  role: 'user',
  saldo: 0,
  bank: 0,
  streak: 0,
  health: 100,
  energi: 100,
  warn: 0,
  afk: -1,
  afkReason: '',
  lastDaily: 0,
  lastChatReward: 0,
  totalCommands: 0,
  createdAt: 0,
});

export const DEFAULT_CHAT = () => ({
  welcome: true,
  detect: true,
  antiLink: false,
  antiSpam: true,
  antiBot: false,
  mute: false,
  expired: 0,
  commandCount: 0,
  updatedAt: 0,
});

export const DEFAULT_DATA = () => ({
  meta: {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  settings: {
    mode: 'public',
    prefix: null,
    self: false,
  },
  stats: {
    messages: 0,
    commands: 0,
    errors: 0,
    starts: 0,
  },
  users: {},
  chats: {},
  /** Pemetaan LID (id internal WhatsApp) -> nomor telepon */
  lidMap: {},
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeDefaults(target, template) {
  for (const [key, value] of Object.entries(template)) {
    if (!(key in target)) target[key] = value;
  }
  return target;
}

export class Database {
  /** @param {string} file @param {{saveInterval?: number, logger?: any}} options */
  constructor(file, { saveInterval = 10000, logger = console } = {}) {
    this.file = path.resolve(file);
    this.dir = path.dirname(this.file);
    this.saveInterval = saveInterval;
    this.logger = logger;
    this.data = DEFAULT_DATA();
    this.readonly = false;
    this._timer = null;
    this._dirty = false;
    this._closed = false;
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) {
        this.data = DEFAULT_DATA();
        this.readonly = false;
        return this;
      }
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      if (!isPlainObject(parsed)) throw new Error('isi database bukan object');
      this.data = { ...DEFAULT_DATA(), ...parsed };
      this.data.meta = mergeDefaults({ ...(parsed.meta || {}) }, DEFAULT_DATA().meta);
      this.data.settings = mergeDefaults({ ...(parsed.settings || {}) }, DEFAULT_DATA().settings);
      this.data.stats = mergeDefaults({ ...(parsed.stats || {}) }, DEFAULT_DATA().stats);
      for (const key of ['users', 'chats']) {
        if (!isPlainObject(this.data[key])) this.data[key] = {};
      }
      if (!isPlainObject(this.data.lidMap)) this.data.lidMap = {};
      this.readonly = false;
      return this;
    } catch (err) {
      // Jangan menimpa data yang rusak: simpan sebagai .corrupt lalu mulai bersih.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        if (fs.existsSync(this.file)) fs.copyFileSync(this.file, backup);
      } catch {
        /* ignore */
      }
      this.logger?.warn?.(`[database] gagal membaca ${this.file}: ${err.message}. Backup: ${backup}`);
      this.data = DEFAULT_DATA();
      this.readonly = false;
      return this;
    }
  }

  /** Ambil (dan buat bila belum ada) data user. */
  user(jid) {
    const key = String(jid || '');
    if (!this.data.users[key]) this.data.users[key] = { ...DEFAULT_USER(), jid: key, createdAt: Date.now() };
    const user = this.data.users[key];
    if (!user.jid) user.jid = key;
    return mergeDefaults(user, DEFAULT_USER());
  }

  /** Ambil (dan buat bila belum ada) data chat/grup. */
  chat(jid) {
    const key = String(jid || '');
    if (!this.data.chats[key]) this.data.chats[key] = { ...DEFAULT_CHAT(), updatedAt: Date.now() };
    return mergeDefaults(this.data.chats[key], DEFAULT_CHAT());
  }

  /** Bungkus perubahan data; otomatis dijadwalkan untuk disimpan. */
  transaction(mutator) {
    const result = mutator(this.data);
    this.touch();
    return result;
  }

  /**
   * Simpan pemetaan LID -> nomor telepon supaya user yang sama tidak
   * dianggap dua orang berbeda ketika WhatsApp memakai LID.
   */
  mapLid(lid, pn) {
    if (!lid || !pn) return false;
    const key = cleanJid(lid);
    const value = cleanJid(pn);
    if (!key.endsWith('@lid') || !value || this.data.lidMap[key] === value) return false;
    this.data.lidMap[key] = value;
    // Pindahkan data user bila sudah pernah tercatat memakai LID.
    if (this.data.users[key] && key !== value) {
      const merged = { ...this.data.users[key], ...(this.data.users[value] || {}), jid: value };
      this.data.users[value] = merged;
      delete this.data.users[key];
    }
    this.touch();
    return true;
  }

  /** Ubah jid LID menjadi nomor telepon bila pemetaannya sudah diketahui. */
  resolveLid(jid) {
    const key = cleanJid(jid);
    if (!key.endsWith('@lid')) return key;
    return this.data.lidMap[key] || key;
  }

  touch() {
    this.data.meta.updatedAt = Date.now();
    this.scheduleSave();
  }

  scheduleSave() {
    if (this._closed) return;
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.save().catch(() => {});
    }, this.saveInterval);
    this._timer.unref?.();
  }

  /** Tulis atomik: tulis ke file sementara lalu rename. */
  async save(force = false) {
    if (this.readonly) return false;
    if (!this._dirty && !force) return true;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const payload = JSON.stringify(this.data, null, 2);
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, payload, 'utf8');
      fs.renameSync(tmp, this.file);
      this._dirty = false;
      return true;
    } catch (err) {
      this.logger?.error?.(`[database] gagal menyimpan: ${err.message}`);
      return false;
    }
  }

  /** Simpan langsung secara sinkron (dipakai saat shutdown). */
  flushSync() {
    if (this.readonly) return false;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const payload = JSON.stringify(this.data, null, 2);
      const tmp = `${this.file}.${process.pid}.sync.tmp`;
      fs.writeFileSync(tmp, payload, 'utf8');
      fs.renameSync(tmp, this.file);
      this._dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this._closed = true;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.flushSync();
  }

  stats() {
    return {
      users: Object.keys(this.data.users).length,
      chats: Object.keys(this.data.chats).length,
      messages: this.data.stats.messages || 0,
      commands: this.data.stats.commands || 0,
      file: this.file,
    };
  }
}

export async function initDatabase(config, logger = console) {
  if (config?.database?.unsupportedBackend) {
    logger?.warn?.(
      `[database] backend "${config.database.unsupportedBackend}" belum didukung build ini — memakai JSON (${config.database.file})`,
    );
  }
  const db = new Database(config?.database?.file || 'database/database.json', {
    saveInterval: config?.database?.saveInterval ?? 10000,
    logger,
  });
  db.load();
  db.data.stats.starts = (db.data.stats.starts || 0) + 1;
  db.touch();
  await db.save(true);
  return db;
}

export default Database;
