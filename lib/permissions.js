/**
 * Permission & ekonomi ringan (limit, exp/level, warn, premium, admin grup).
 */
import { bareNumber, cleanJid, randomInt } from './functions.js';

export const LEVEL_MULTIPLIER = 100;

export function sameJid(a, b) {
  return cleanJid(a) === cleanJid(b) || bareNumber(a) === bareNumber(b);
}

export function inList(jid, list = []) {
  const numbers = list.map((item) => bareNumber(item)).filter(Boolean);
  return numbers.includes(bareNumber(jid));
}

export function isOwner(jid, config) {
  return inList(jid, config?.bot?.owners || []);
}

export function isMods(jid, config) {
  return inList(jid, config?.bot?.mods || []);
}

export function isPremiumUser(user, jid, config) {
  if (inList(jid, config?.bot?.premiumJids || [])) return true;
  if (!user?.premium) return false;
  if (!user.premiumUntil) return true;
  return user.premiumUntil > Date.now();
}

export function isBanned(user) {
  return Boolean(user?.banned);
}

/** Hitung level dari exp: level = floor(sqrt(exp / 100)) */
export function levelFromExp(exp = 0) {
  return Math.floor(Math.sqrt(Math.max(0, Number(exp) || 0) / LEVEL_MULTIPLIER));
}

/** Exp minimum untuk mencapai sebuah level. */
export function expForLevel(level = 0) {
  return LEVEL_MULTIPLIER * Math.max(0, Number(level) || 0) ** 2;
}

/** Progress menuju level berikutnya (0-100). */
export function levelProgress(exp = 0) {
  const level = levelFromExp(exp);
  const current = expForLevel(level);
  const next = expForLevel(level + 1);
  const span = Math.max(1, next - current);
  return { level, current, next, percent: Math.min(100, Math.round(((exp - current) / span) * 100)) };
}

export function addExp(db, jid, amount = 5) {
  const user = db.user(jid);
  user.exp = (user.exp || 0) + amount;
  const level = levelFromExp(user.exp);
  const levelUp = level > (user.level || 0);
  user.level = level;
  db.touch();
  return { user, levelUp, level, exp: user.exp };
}

/** Kuota dasar limit harian (premium/free), tanpa bonus owner. */
export function limitBase(user, config) {
  const base = isPremiumUser(user, user.jid, config) ? config?.limits?.premium : config?.limits?.free;
  return Math.max(0, Number(base ?? 20));
}

/**
 * Kuota total user: kuota dasar (premium/free) + bonus permanen.
 *
 * Satu-satunya sumber angka `limit/quota` yang tampil di `.profile`,
 * katalog `.buylimit`, dan sukses pembelian. Dulu rumus ini diulang tiga kali
 * di plugin — dan versi plugin memakai `config.limits.premium` tanpa optional
 * chaining, jadi config tanpa blok `limits` bikin crash.
 */
export function limitQuota(user, config) {
  return limitBase(user, config) + Math.max(0, Number(user?.limitBonus) || 0);
}

/** Reset limit harian bila sudah lewat interval. Bonus dari owner selalu dipertahankan. */
export function refreshLimit(db, user, config) {
  const interval = config?.limits?.resetIntervalMs ?? 86400000;
  const bonus = Math.max(0, Number(user.limitBonus) || 0);
  const max = limitBase(user, config) + bonus;
  const last = user.lastLimitReset || 0;
  if (!last || Date.now() - last >= interval) {
    user.limit = max;
    user.lastLimitReset = Date.now();
    db.touch();
  } else if (user.limit === undefined || user.limit === null) {
    user.limit = max;
  }
  return user.limit;
}

/**
 * Tambah/kurangi jatah limit user (dipakai owner).
 * Bonus disimpan terpisah supaya tidak hilang saat reset harian.
 *
 * Kuota harian di-refresh lebih dulu (kalau jadwal resetnya sudah lewat) supaya
 * angka yang dilaporkan ke owner sama persis dengan yang nanti dilihat user di
 * `.profile` — dulu nilai sisa hari sebelumnya bisa membuat keduanya berbeda.
 *
 * @returns {{bonus: number, limit: number, quota: number}}
 */
export function adjustLimit(db, user, amount, config) {
  const delta = Math.trunc(Number(amount) || 0);
  const currentBonus = Math.max(0, Number(user.limitBonus) || 0);
  if (!delta) {
    return { bonus: currentBonus, limit: user.limit, quota: limitBase(user, config) + currentBonus };
  }

  const quota = refreshLimit(db, user, config);
  user.limitBonus = Math.max(0, currentBonus + delta);
  user.limit = Math.max(0, (Number(quota) || 0) + delta);
  db.touch();
  return { bonus: user.limitBonus, limit: user.limit, quota: limitBase(user, config) + user.limitBonus };
}

/**
 * Potong limit sebesar biaya tertentu.
 * @returns {{ok: boolean, limit: number, cost: number}}
 */
export function consumeLimitCost(db, user, cost, config) {
  const amount = Math.max(0, Number(cost) || 0);
  const available = refreshLimit(db, user, config);
  if (amount <= 0) return { ok: true, limit: available, cost: 0 };
  if (available < amount) return { ok: false, limit: available, cost: amount };
  user.limit = available - amount;
  db.touch();
  return { ok: true, limit: user.limit, cost: amount };
}

/**
 * Cek & potong limit berdasarkan plugin (`handler.limit`).
 * @returns {{ok: boolean, limit: number, cost: number}}
 */
export function consumeLimit(db, user, plugin, config) {
  const cost = typeof plugin?.limit === 'number' ? plugin.limit : plugin?.limit === true ? 1 : 0;
  return consumeLimitCost(db, user, cost, config);
}

export function addWarn(db, user, amount = 1) {
  user.warn = (user.warn || 0) + amount;
  db.touch();
  return user.warn;
}

/**
 * Hadiah tiap pesan chat: XP & saldo acak (default 1–9).
 *
 * Diatur lewat `config.rewards.chat`:
 *   enabled, expMin, expMax, saldoMin, saldoMax, cooldownMs, levelUpNotice
 *
 * @returns {{exp: number, saldo: number, level: number, levelUp: boolean, totalExp: number, totalSaldo: number}|null}
 */
export function rewardChatMessage(db, jid, config, { now = Date.now() } = {}) {
  const settings = config?.rewards?.chat || {};
  if (settings.enabled === false) return null;

  const user = db.user(jid);
  const cooldown = Math.max(0, Number(settings.cooldownMs) || 0);
  if (cooldown > 0 && user.lastChatReward && now - user.lastChatReward < cooldown) return null;

  const pick = (min, max) => {
    const low = Math.max(0, Math.floor(Number(min) ?? 1));
    const high = Math.max(low, Math.floor(Number(max) ?? 9));
    return randomInt(low, high);
  };

  const exp = pick(settings.expMin ?? 1, settings.expMax ?? 9);
  const saldo = pick(settings.saldoMin ?? 1, settings.saldoMax ?? 9);

  user.lastChatReward = now;
  user.saldo = (user.saldo || 0) + saldo;
  const { level, levelUp } = addExp(db, jid, exp);
  db.touch();

  return { exp, saldo, level, levelUp, totalExp: user.exp, totalSaldo: user.saldo };
}

export function registerUser(db, jid, { name = '', age = -1 } = {}) {
  const user = db.user(jid);
  user.name = name || user.name;
  user.age = Number.isFinite(Number(age)) && Number(age) >= 0 ? Number(age) : user.age;
  user.registered = true;
  db.touch();
  return user;
}

/** Cache metadata grup supaya tidak spam API WhatsApp. */
export function createGroupCache(ttlSeconds = 300) {
  const cache = new Map();
  return {
    async get(conn, chat, force = false) {
      const hit = cache.get(chat);
      if (!force && hit && Date.now() - hit.at < ttlSeconds * 1000) return hit.metadata;
      try {
        const metadata = await conn.groupMetadata(chat);
        cache.set(chat, { metadata, at: Date.now() });
        return metadata;
      } catch {
        return hit?.metadata || null;
      }
    },
    invalidate(chat) {
      if (chat) cache.delete(chat);
      else cache.clear();
    },
    size: () => cache.size,
  };
}

/**
 * Apakah `jid` (beserta identitas alternatifnya) admin di grup ini?
 *
 * WhatsApp bisa mengirim identitas dalam bentuk LID **dan** nomor telepon, dan
 * daftar peserta grup pun bisa memakai salah satunya. Jadi pencocokan dilakukan
 * lewat semua kolom identitas peserta (`id`, `jid`, `lid`, `phoneNumber`, ...)
 * dan semua bentuk jid pengirim — dulu perbandingan hanya `bareNumber(id)`
 * sehingga admin grup ber-LID tidak dikenali saat pengirimnya terbaca sebagai
 * nomor telepon (dan sebaliknya).
 */
/**
 * Nomor telepon peserta grup yang	LID-nya sudah diketahui.
 *
 * Di grup, WA sering mengirim `key.participant` = LID saja tanpa `participantPn`
 * maupun `participantAlt`, sehingga pesan itu sendiri tidak membawa nomor
 * telepon. Daftar peserta grup tetap punya keduanya (`{ lid, phoneNumber }`),
 * jadi di situ sumber pasangan LID <-> nomor yang bisa dipakai.
 * @returns {string|null} JID nomor telepon, atau null bila tidak ditemukan
 */
export function findParticipantPhone(metadata, lid) {
  const target = cleanJid(String(lid || ''));
  if (!target) return null;
  const participants = metadata?.participants || [];
  const found = participants.find((item) => {
    const identities = [item?.id, item?.jid, item?.lid, item?.idAlt, item?.participantAlt]
      .filter(Boolean)
      .map((value) => cleanJid(String(value)));
    return identities.includes(target);
  });
  if (!found) return null;
  const raw = [found.phoneNumber, found.pn, found.id, found.jid, found.idAlt, found.participantAlt].find(
    (value) => value && cleanJid(String(value)).endsWith('@s.whatsapp.net'),
  );
  return raw ? cleanJid(String(raw)) : null;
}

export function isParticipantAdmin(metadata, jid, alternatives = []) {
  const targets = new Set(
    [jid, ...(Array.isArray(alternatives) ? alternatives : [alternatives])]
      .flat()
      .filter(Boolean)
      .map((value) => cleanJid(String(value))),
  );
  const numbers = new Set([...targets].map((value) => bareNumber(value)).filter(Boolean));
  if (!targets.size && !numbers.size) return false;

  const participants = metadata?.participants || [];
  const found = participants.find((item) => {
    const identities = [item?.id, item?.jid, item?.lid, item?.phoneNumber, item?.pn, item?.idAlt, item?.participantAlt]
      .filter(Boolean)
      .map((value) => cleanJid(String(value)));
    return identities.some((value) => targets.has(value) || (numbers.size > 0 && numbers.has(bareNumber(value))));
  });
  if (!found) return false;

  const admin = found.admin || found.type;
  return admin === 'admin' || admin === 'superadmin' || admin === true;
}

export async function isGroupAdmin(conn, chat, jid, cache) {
  const metadata = cache ? await cache.get(conn, chat) : await conn.groupMetadata(chat).catch(() => null);
  return isParticipantAdmin(metadata, jid);
}

export async function isBotAdmin(conn, chat, cache) {
  const botJid = conn?.user?.id;
  if (!botJid) return false;
  const metadata = cache ? await cache.get(conn, chat) : await conn.groupMetadata(chat).catch(() => null);
  return isParticipantAdmin(metadata, botJid);
}

export default {
  isOwner,
  isMods,
  isPremiumUser,
  isBanned,
  levelFromExp,
  expForLevel,
  levelProgress,
  addExp,
  refreshLimit,
  limitBase,
  limitQuota,
  adjustLimit,
  consumeLimit,
  consumeLimitCost,
  addWarn,
  rewardChatMessage,
  registerUser,
  createGroupCache,
  isParticipantAdmin,
  findParticipantPhone,
  isGroupAdmin,
  isBotAdmin,
};
