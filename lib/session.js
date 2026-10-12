/**
 * Utilitas sesi WhatsApp (folder `sessions/`).
 *
 * Kenapa perlu: `creds.registered` di Baileys 6.7 hanya di-set true saat login
 * lewat PAIRING CODE, tidak saat login lewat QR. Kalau bot hanya mengandalkan
 * flag itu, sesi hasil QR dianggap "belum login" -> bot meminta pairing code
 * padahal sudah tersambung, dan WhatsApp mematikan sesi tersebut (401 logout).
 */
import fs from 'node:fs';
import path from 'node:path';

export function credsPath(dir) {
  return path.join(dir, 'creds.json');
}

/** Baca creds.json; null kalau tidak ada / rusak. */
export function readCreds(dir) {
  try {
    const raw = fs.readFileSync(credsPath(dir), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Sesi dianggap sudah login kalau ada identitas (me.id) atau sudah terdaftar. */
export function hasUsableSession(dir) {
  const creds = readCreds(dir);
  if (!creds) return false;
  return Boolean(creds.registered) || Boolean(creds.me?.id) || Boolean(creds.me?.lid);
}

/**
 * Bolehkah bot meminta pairing code?
 * Pairing code HANYA untuk sesi yang benar-benar masih kosong. Meminta pairing
 * code saat sesi sudah login membuat WhatsApp mematikan perangkat tersebut
 * (koneksi ditutup 503 lalu 401 logout).
 *
 * @param {{pair?: string, qr?: boolean, sessionDir: string}} options
 * @returns {{allowed: boolean, reason: string}}
 */
export function shouldRequestPairing({ pair = '', qr = false, sessionDir = '' } = {}) {
  if (!pair) return { allowed: false, reason: 'no-pairing-number' };
  if (qr) return { allowed: false, reason: 'qr-mode' };
  if (hasUsableSession(sessionDir)) return { allowed: false, reason: 'session-exists' };
  return { allowed: true, reason: 'fresh-session' };
}

/** Ringkasan sesi untuk log. */
export function sessionInfo(dir) {
  const creds = readCreds(dir);
  return {
    dir,
    exists: fs.existsSync(dir),
    hasCreds: Boolean(creds),
    registered: Boolean(creds?.registered),
    me: creds?.me?.id || null,
    usable: hasUsableSession(dir),
  };
}

/**
 * Pindahkan folder sesi (dipakai saat logout) supaya bot bisa pairing ulang
 * tanpa kehilangan berkas lama.
 * @returns {string|null} path baru
 */
export function backupSessionDir(dir, { label = 'logged-out' } = {}) {
  if (!dir || !fs.existsSync(dir)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${dir}.${label}-${stamp}`;
  try {
    fs.renameSync(dir, target);
    return target;
  } catch {
    return null;
  }
}

export default { credsPath, readCreds, hasUsableSession, shouldRequestPairing, sessionInfo, backupSessionDir };
