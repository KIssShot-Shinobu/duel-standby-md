/**
 * Logika murni fitur sewa bot per grup (rent).
 *
 * Data hidup di `db.data.rentals` (per grup) dan `db.data.renters`
 * (registry penyewa, TERPISAH dari `data.users`). Modul ini tidak menyentuh
 * Baileys untuk mengirim pesan — hanya men-scan data & mensiapkan rencana
 * (expired/reminder) supaya bisa diuji tanpa socket.
 */
import path from 'node:path';
import { cleanJid, bareNumber } from './functions.js';
import { userError } from './errors.js';

const DAY = 86400000;

/** Pengaturan rent yang dipakai logika (mengqabung config + override DB). */
export function rentSettings(db, config) {
  const r = config?.rent || {};
  return {
    enabled: r.enabled !== false,
    days: Math.max(1, Number(r.days) || 30),
    pricePerMonth: Math.max(0, Number(db?.data?.settings?.rentPrice ?? r.pricePerMonth) || 0),
    qrisPath: path.resolve(config?.root || process.cwd(), r.qrisFile || 'assets/qris.jpg'),
    helpNumber: r.helpNumber || '',
    reminderDays: Array.isArray(r.reminderDays) ? r.reminderDays : [3, 1],
    freePlugins: r.freePlugins || [],
    alwaysAllowed: r.alwaysAllowed || [],
    gatedMessage: r.gatedMessage || '🔒 Fitur ini butuh sewa aktif. Ketik `.rent` untuk menyewa.',
  };
}

export function getRental(db, groupJid) {
  return db?.data?.rentals?.[String(groupJid)] || null;
}

/**
 * Status sewa sebuah grup.
 * @returns {'active'|'pending'|'expired'|null} null = belum pernah minta sewa.
 */
export function rentalStatus(db, groupJid, { now = Date.now() } = {}) {
  const rental = getRental(db, groupJid);
  if (!rental) return null;
  if (rental.status === 'active' && Number(rental.expiresAt) <= now) return 'expired';
  return rental.status;
}

/** Sisa hari (dibulatkan ke atas). 0 kalau tidak aktif. */
export function remainingDays(db, groupJid, { now = Date.now() } = {}) {
  const rental = getRental(db, groupJid);
  if (!rental || rental.status !== 'active') return 0;
  const remain = Number(rental.expiresAt) - now;
  if (remain <= 0) return 0;
  return Math.ceil(remain / DAY);
}

/** Catat `renter` ke registry penyewa (terpisah dari data.users). */
function noteRenter(db, jid, { name = '', groupJid, since = Date.now() } = {}) {
  const key = cleanJid(jid);
  if (!key) return;
  const entry = (db.data.renters[key] = db.data.renters[key] || { since, name, groups: [] });
  if (!entry.groups.includes(String(groupJid))) entry.groups.push(String(groupJid));
  if (name) entry.name = name;
}

export function requestRent(db, groupJid, { renter, renterName = '' } = {}) {
  const rental = getRental(db, groupJid) || emptyRental();
  rental.status = 'pending';
  rental.renter = cleanJid(renter);
  rental.renterName = renterName;
  rental.reminders = {};
  rental.history.push({ at: Date.now(), action: 'request', by: cleanJid(renter) });
  setRental(db, groupJid, rental);
  return rental;
}

export function activateRent(db, groupJid, { renter = '', renterName = '', days = 30, by = '', now = Date.now() } = {}) {
  const rental = getRental(db, groupJid) || emptyRental();
  rental.status = 'active';
  rental.renter = cleanJid(renter) || rental.renter;
  rental.renterName = renterName || rental.renterName;
  rental.startedAt = now;
  rental.expiresAt = now + Math.max(1, Number(days) || 30) * DAY;
  rental.approvedBy = cleanJid(by);
  // Periode baru = reminder baru; tanpa reset, renewal tidak pernah dapat H-3/H-1 lagi.
  rental.reminders = {};
  rental.history.push({ at: now, action: 'activate', by: cleanJid(by), days: Math.max(1, Number(days) || 30) });
  setRental(db, groupJid, rental);
  noteRenter(db, rental.renter, { name: rental.renterName, groupJid, since: now });
  return rental;
}

export function extendRent(db, groupJid, { days = 30, by = '', now = Date.now() } = {}) {
  const rental = getRental(db, groupJid) || emptyRental();
  const base = Math.max(now, Number(rental.expiresAt) || now);
  rental.status = 'active';
  rental.startedAt = rental.startedAt || now;
  rental.expiresAt = base + Math.max(1, Number(days) || 30) * DAY;
  rental.reminders = {};
  rental.history.push({ at: now, action: 'extend', by: cleanJid(by), days: Math.max(1, Number(days) || 30) });
  setRental(db, groupJid, rental);
  noteRenter(db, rental.renter, { name: rental.renterName, groupJid, since: now });
  return rental;
}

export function rejectRent(db, groupJid, { by = '', reason = '' } = {}) {
  const rental = getRental(db, groupJid);
  if (!rental) return null;
  rental.status = 'unpaid';
  rental.expiresAt = 0;
  rental.reminders = {};
  rental.history.push({ at: Date.now(), action: 'reject', by: cleanJid(by), reason });
  setRental(db, groupJid, rental);
  return rental;
}

export function removeRental(db, groupJid) {
  if (db.data.rentals[String(groupJid)]) {
    delete db.data.rentals[String(groupJid)];
    db.touch();
  }
}

export function setPrice(db, nominal) {
  const value = Math.max(0, Math.trunc(Number(nominal) || 0));
  db.data.settings.rentPrice = value;
  db.touch();
  return value;
}

export function isFreePlugin(name, config) {
  const list = config?.rent?.freePlugins || [];
  return list.some((prefix) => String(name).startsWith(prefix));
}

export function isAlwaysAllowed(name, config) {
  const list = config?.rent?.alwaysAllowed || [];
  return list.some((prefix) => String(name).startsWith(prefix));
}

/** Benar kalau salah satu nomor owner jadi peserta grup (cocok semua field identitas). */
export function ownerInGroup(participants = [], config) {
  const owners = config?.bot?.owners || [];
  if (!owners.length) return false;
  return (participants || []).some((p) => {
    const identities = [p?.id, p?.jid, p?.lid, p?.phoneNumber, p?.pn, p?.idAlt, p?.participantAlt]
      .filter(Boolean)
      .map((value) => bareNumber(value));
    return identities.some((num) => owners.includes(num));
  });
}

/** Apakah command plugin ini dikunci untuk grup tanpa sewa aktif. Owner & moderator tidak dikunci. */
export function isGroupGated(db, groupJid, entryName, config, { participants = [], isOwner = false, isMods = false, now = Date.now() } = {}) {
  const s = rentSettings(db, config);
  if (!s.enabled) return false;
  if (isOwner || isMods) return false;
  if (isFreePlugin(entryName, config) || isAlwaysAllowed(entryName, config)) return false;
  if (ownerInGroup(participants, config)) return false;
  return rentalStatus(db, groupJid, { now }) !== 'active';
}

/** Penyewa yang punya minimal satu rental aktif -> berhak tanpa limit (global). */
export function isRenterActive(db, jid, { now = Date.now() } = {}) {
  const key = cleanJid(jid);
  if (!key) return false;
  return Object.values(db?.data?.rentals || {}).some(
    (rental) => rental.renter === key && rentalStatus(db, rental.jid || '', { now }) === 'active',
  );
}

/**
 * Pemindai berkala (dipanggil main.js).
 * @returns {{expired: string[], remind: Array<{jid: string, renterJid: string, remaining: number}>}}
 */
export function sweepRentals(db, config, { now = Date.now() } = {}) {
  const s = rentSettings(db, config);
  const expired = [];
  const remind = [];
  let changed = false;

  for (const [jid, rental] of Object.entries(db?.data?.rentals || {})) {
    if (rental.status !== 'active') continue;

    if (Number(rental.expiresAt) <= now) {
      rental.status = 'expired';
      rental.reminders = {};
      expired.push(jid);
      changed = true;
      continue;
    }

    const remain = Math.ceil((Number(rental.expiresAt) - now) / DAY);
    for (const day of s.reminderDays) {
      const key = `d${day}`;
      if (remain <= day && remain > 0 && !rental.reminders?.[key]) {
        rental.reminders[key] = now;
        remind.push({ jid, renterJid: rental.renter, remaining: remain });
        changed = true;
      }
    }
  }

  if (changed) db.touch();
  return { expired, remind };
}

/**
 * Pisahkan input user menjadi jenis target grup.
 * @returns {{kind: 'link'|'id'|'name', value: string}|null}
 */
export function parseGroupInput(input = '') {
  const value = String(input).trim();
  if (!value) return null;
  const linkMatch = value.match(/chat\.whatsapp\.com\/([\w-]+)/i);
  if (linkMatch) return { kind: 'link', value: linkMatch[1] };
  // JID grup eksplisit (…@g.us) atau id numerik grup
  if (value.endsWith('@g.us')) return { kind: 'id', value };
  if (/^\d{10,25}(-\d+)?$/.test(value)) return { kind: 'id', value };
  return { kind: 'name', value };
}

/**
 * Resolusi input (link/id/nama) menjadi JID grup + subject.
 * Link: `conn.groupGetInviteInfo(code)`; nama: `conn.groupFetchAllParticipating()`.
 * @returns {Promise<{jid: string, subject?: string}|null>}
 */
export async function resolveGroupJid(conn, input) {
  const parsed = parseGroupInput(input);
  if (!parsed || !conn) return null;

  if (parsed.kind === 'link') {
    try {
      const info = await conn.groupGetInviteInfo?.(parsed.value);
      return info?.id ? { jid: String(info.id).replace(/[:\s].*/, ''), subject: info.subject } : null;
    } catch {
      return null;
    }
  }

  if (parsed.kind === 'id') {
    const jid = parsed.value.includes('@') ? parsed.value : `${parsed.value}@g.us`;
    return { jid, subject: undefined };
  }

  const groups = await conn.groupFetchAllParticipating?.().catch(() => ({}));
  const needle = parsed.value.toLowerCase();
  const matches = Object.values(groups || {}).filter((meta) => String(meta?.subject || '').toLowerCase().includes(needle));
  if (!matches.length) return null;
  // Nama bisa sama di beberapa grup (mis. dua grup "ROOM 45"). Memilih
  // kecocokan pertama diam-diam menyewakan grup yang salah — kalau ambigu,
  // minta owner memilih pakai id/link supaya tidak meleset.
  if (matches.length > 1) {
    const list = matches.map((g) => `• ${g.subject || g.id} (${g.id})`).join('\n');
    throw userError(
      `Nama itu cocok di ${matches.length} grup:\n${list}\n\nPakai id atau link grup yang benar, contoh: .rent add ${matches[0].id}`,
    );
  }
  const found = matches[0];
  return { jid: String(found.id).replace(/[:\s].*/, ''), subject: found.subject };
}

/** Record rental kosong. */
function emptyRental() {
  return {
    status: 'unpaid',
    renter: '',
    renterName: '',
    startedAt: 0,
    expiresAt: 0,
    approvedBy: '',
    lastProofAt: 0,
    reminders: {},
    history: [],
  };
}

/** Simpan record rental + tandai DB berubah. */
function setRental(db, groupJid, rental) {
  db.data.rentals[String(groupJid)] = rental;
  db.data.rentals[String(groupJid)].jid = String(groupJid);
  db.touch();
}

export default {
  rentSettings,
  getRental,
  rentalStatus,
  remainingDays,
  requestRent,
  activateRent,
  extendRent,
  rejectRent,
  removeRental,
  setPrice,
  isFreePlugin,
  isAlwaysAllowed,
  ownerInGroup,
  isGroupGated,
  isRenterActive,
  sweepRentals,
  parseGroupInput,
  resolveGroupJid,
};