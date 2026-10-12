/**
 * Permission & ekonomi ringan (limit, exp/level, warn, premium, admin grup).
 */
import { bareNumber, cleanJid } from './functions.js';

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

/** Reset limit harian bila sudah lewat interval. */
export function refreshLimit(db, user, config) {
  const interval = config?.limits?.resetIntervalMs ?? 86400000;
  const max = isPremiumUser(user, user.jid, config) ? config?.limits?.premium ?? 100 : config?.limits?.free ?? 20;
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
 * Cek & potong limit.
 * @returns {{ok: boolean, limit: number, cost: number}}
 */
export function consumeLimit(db, user, plugin, config) {
  const cost = typeof plugin?.limit === 'number' ? plugin.limit : plugin?.limit === true ? 1 : 0;
  const available = refreshLimit(db, user, config);
  if (cost <= 0) return { ok: true, limit: available, cost: 0 };
  if (available < cost) return { ok: false, limit: available, cost };
  user.limit = available - cost;
  db.touch();
  return { ok: true, limit: user.limit, cost };
}

export function addWarn(db, user, amount = 1) {
  user.warn = (user.warn || 0) + amount;
  db.touch();
  return user.warn;
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

export function isParticipantAdmin(metadata, jid) {
  const target = bareNumber(jid);
  const participants = metadata?.participants || [];
  const found = participants.find((item) => bareNumber(item.id || item.jid) === target);
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
  consumeLimit,
  addWarn,
  registerUser,
  createGroupCache,
  isParticipantAdmin,
  isGroupAdmin,
  isBotAdmin,
};
