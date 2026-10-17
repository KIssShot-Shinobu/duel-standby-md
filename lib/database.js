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
  /** nama yang didaftarkan sendiri lewat `.main-info` */
  name: '',
  /**
   * nama WhatsApp (pushName) terakhir yang terlihat. WhatsApp tidak memberikan
   * daftar kontak (`syncFullHistory: false`) dan `groupMetadata` tidak memuat
   * nama, jadi pushName pada pesan masuk adalah SATU-SATUNYA sumber nama user —
   * handler menyimpannya di sini supaya tidak hilang saat bot restart.
   */
  pushName: '',
  registered: false,
  age: -1,
  premium: false,
  premiumUntil: 0,
  banned: false,
  bannedReason: '',
  limit: 0,
  /** tambahan limit permanen dari owner (tidak hilang saat reset harian) */
  limitBonus: 0,
  /** total limit yang dibeli pada jendela 24 jam terakhir */
  buyDayAmount: 0,
  /** waktu mulai jendela pembelian harian (0 = belum pernah beli) */
  buyDayKey: 0,
  /** total limit yang dibeli pada bulan kalender ini */
  buyMonthAmount: 0,
  buyMonthKey: '',
  /** kapan intro DM pertama (0 = belum dikirim) */
  dmIntroSentAt: 0,
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
  /** fitur 18+ hanya untuk chat ini (diatur admin grup / owner, default mati) */
  nsfw: false,
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
  /** Sewa bot per grup: kunci = JID grup (terpisah dari data.users) */
  rentals: {},
  /** Akun penyewa: kunci = JID user (terpisah dari data.users) */
  renters: {},
  /** Langganan jadwal sholat: kunci = JID user (terpisah dari data.users) */
  sholat: {},
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeDefaults(target, template) {
  for (const [key, value] of Object.entries(template)) {
    if (!(key in target)) target[key] = value;
  }
  return target;
}

/** Nilai yang dianggap "belum pernah diisi" pada record user. */
const isBlank = (value) => value === undefined || value === null || value === '' || value === 0 || value === false;

/** Digit dari jid apa pun, termasuk key rusak seperti `@271446714642565`. */
const digitsOf = (jid) => String(jid || '').replace(/[^0-9]/g, '');

/**
 * Gabungkan record LID + record nomor telepon untuk user yang sama.
 *
 * Record nomor telepon menang untuk field identitas/status, TAPI nilai yang
 * masih kosong tidak boleh menimpa data LID yang sudah terisi. Sebelumnya
 * urutannya `{...lid, ...pn}`, sehingga record nomor telepon yang baru dibuat
 * (premium=false, limit=0) menghapus premium/limit yang baru ditambahkan owner
 * lewat LID. Bonus limit dijumlahkan karena owner bisa menambahnya lewat LID
 * maupun nomor — penggabungan hanya terjadi sekali per pemetaan.
 */
export function mergeUserRecords(lidUser = {}, pnUser = {}) {
  const merged = { ...lidUser, ...pnUser };
  for (const [key, value] of Object.entries(lidUser)) {
    if (isBlank(pnUser[key]) && !isBlank(value)) merged[key] = value;
  }

  merged.limitBonus = Math.max(0, Number(lidUser.limitBonus) || 0) + Math.max(0, Number(pnUser.limitBonus) || 0);
  merged.limit = Math.max(Number(lidUser.limit) || 0, Number(pnUser.limit) || 0, merged.limitBonus);
  merged.lastLimitReset = Math.max(Number(lidUser.lastLimitReset) || 0, Number(pnUser.lastLimitReset) || 0);
  // Masa premium selalu yang TERPANJANG yang menang, bukan sekadar "yang
  // pertama tidak kosong". Kalau tidak, satu user yang kebagian dua record
  // hantu (mis. `.premium add` 2x dengan durasi berbeda) akan kehilangan masa
  // premium yang lebih panjang begitu record kedua dilebur.
  merged.premiumUntil = Math.max(Number(lidUser.premiumUntil) || 0, Number(pnUser.premiumUntil) || 0);
  for (const key of ['exp', 'saldo', 'bank', 'totalCommands']) {
    merged[key] = Math.max(Number(lidUser[key]) || 0, Number(pnUser[key]) || 0);
  }
  const created = [lidUser.createdAt, pnUser.createdAt].filter(Boolean);
  merged.createdAt = created.length ? Math.min(...created) : Date.now();
  return merged;
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
      for (const key of ['users', 'chats', 'rentals', 'renters', 'sholat']) {
        if (!isPlainObject(this.data[key])) this.data[key] = {};
      }
      if (!isPlainObject(this.data.lidMap)) this.data.lidMap = {};
      this.repairLidRecords();
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

  /**
   * Selesaikan identitas ke JID nomor telepon.
   *
   * Selain memetakan JID ber-`@lid`, ini juga menangkap "LID yang sudah berubah
   * jadi nomor", yaitu `271446714642565@s.whatsapp.net`. Pola itu nyata terjadi:
   * LID juga 14-15 digit sehingga lolos dari validasi nomor telepon
   * (`NUMBER_ARG`), lalu `toJid()` menempelkan suffix `@s.whatsapp.net` dan
   * membuat record hantu. `resolveLid()` tidak bisa menangkapnya karena jid-nya
   * sudah tidak berakhiran `@lid` — premium/limit owner lalu tersimpan di record
   * yang tidak pernah dipakai user tersebut.
   */
  resolveIdentity(jid) {
    const clean = cleanJid(jid);
    const digits = digitsOf(clean);
    if (!digits) return clean;
    const mapped = this.data.lidMap[clean] || this.data.lidMap[`${digits}@lid`];
    return mapped || clean;
  }

  /**
   * Semua key record user yang sebenarnya mewakili `digits` (LID), bukan nomor
   * teleponnya. Bentuknya diverse di data lapangan: `…@lid`,
   * `…@s.whatsapp.net` (LID yg dipaksakan jadi nomor), `…`, bahkan `@…` yang
   * bagian user-nya kosong. Semuanya harus digabung ke nomor telepon asli.
   */
  _lidUserKeys(digits, realPn) {
    if (!digits) return [];
    return Object.keys(this.data.users).filter((key) => key !== realPn && digitsOf(key) === digits);
  }

  /** Ambil (dan buat bila belum ada) data user. */
  user(jid) {
    // Identitas selalu diselesaikan lebih dulu supaya premium/limit/exp tidak
    // terbelah dua untuk satu orang — baik JID ber-LID maupun "LID yg dipaksakan
    // jadi nomor" seperti `271446714642565@s.whatsapp.net`.
    const key = this.resolveIdentity(jid) || String(jid || '');
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
    if (!key.endsWith('@lid') || !value) return false;

    let changed = false;
    if (this.data.lidMap[key] !== value) {
      this.data.lidMap[key] = value;
      changed = true;
    }

    // Pindahkan data user baik yang tercatat memakai LID (`…@lid`) maupun yang
    // memakai LID seolah-olah nomor telepon (`…@s.whatsapp.net`, `…`, `@…`).
    // Bentuk kedua pernah muncul di data sungguhan: premium/limit owner
    // tersimpan di sana sementara user-nya tetap free karena pesannya selalu
    // resolve ke nomor. Pembersihan jalan meski pemetaannya sudah diketahui.
    for (const from of this._lidUserKeys(digitsOf(key), value)) {
      this.data.users[value] = { ...mergeUserRecords(this.data.users[from], this.data.users[value]), jid: value };
      delete this.data.users[from];
      changed = true;
    }

    if (changed) this.touch();
    return changed;
  }

  /** Ubah jid LID menjadi nomor telepon bila pemetaannya sudah diketahui. */
  resolveLid(jid) {
    const key = cleanJid(jid);
    if (!key.endsWith('@lid')) return key;
    return this.data.lidMap[key] || key;
  }

  /**
   * Perbaikan data lama: lebur sisa record LID ke record nomor teleponnya.
   *
   * Versi sebelumnya bisa membuat dua record untuk satu orang (mis. premium/
   * limit yang ditambahkan owner lewat reply pesan LID tersimpan di record LID).
   * Dipanggil otomatis setiap `load()` supaya data seperti itu ikut rapi saat
   * bot di-restart — tanpa menghilangkan premium/limit/exp yang sudah ada.
   * @returns {number} jumlah record LID yang dilebur
   */
  repairLidRecords() {
    let repaired = 0;
    for (const [lid, pn] of Object.entries(this.data.lidMap || {})) {
      if (!cleanJid(lid).endsWith('@lid') || !pn) continue;
      // juga record yang memakai LID sebagai nomor telepon
      // (`271446714642565@s.whatsapp.net`, `271446714642565`, `@271446714642565`)
      // — pola inilah yang membuat premium owner terlihat "hilang" padahal
      // `.premium list` bilang sudah aktif.
      for (const from of this._lidUserKeys(digitsOf(lid), pn)) {
        this.data.users[pn] = { ...mergeUserRecords(this.data.users[from], this.data.users[pn]), jid: pn };
        delete this.data.users[from];
        repaired += 1;
      }
    }
    if (repaired) {
      this.logger?.warn?.(`[database] ${repaired} record LID dilebur ke record nomor telepon`);
      this.touch();
    }
    return repaired;
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
