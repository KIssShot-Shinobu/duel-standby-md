/**
 * Helper umum tanpa dependency eksternal.
 * Dipakai plugin lewat context `Func` dan internal lib/*.
 */
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const delay = sleep;

/**
 * Hapus berkas tanpa melempar error.
 *
 * Pola lama `if (fs.existsSync(f)) fs.unlinkSync(f)` punya dua masalah:
 *  - balapan TOCTOU antara existsSync dan unlinkSync;
 *  - unlinkSync tetap bisa gagal (EBUSY/EPERM di Windows bila berkas terkunci),
 *    dan karena pemanggilan ini terjadi SETELAH pesan terkirim, error-nya
 *    mengubah sukses menjadi pesan gagal yang membingungkan user.
 */
export function safeUnlink(file) {
  if (!file) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

export const isNumber = (value) => typeof value === 'number' && !Number.isNaN(value);

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pickRandom(list = []) {
  return list[Math.floor(Math.random() * list.length)];
}

export function ucfirst(text = '') {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Ubah nomor (628xx / 08xx), mention (@628xx), atau jid menjadi jid lengkap.
 * Mengembalikan '' kalau tidak ada nomor yang bisa dipakai.
 */
export function toJid(input, domain = 's.whatsapp.net') {
  if (!input) return '';
  const value = String(input).trim().replace(/^@/, ''); // mention WA: "@628xx" -> "628xx"
  if (value.includes('@')) return cleanJid(value);
  let number = value.replace(/[^\d]/g, '');
  if (number.startsWith('0')) number = `62${number.slice(1)}`;
  if (!number) return '';
  return `${number}@${domain}`;
}

/** Buang prefix '@' dan suffix device (628xx:12@s.whatsapp.net -> 628xx@s.whatsapp.net). */
export function cleanJid(jid = '') {
  const value = String(jid).trim().replace(/^@/, '');
  const at = value.lastIndexOf('@');
  if (at < 0) return value;
  const user = value.slice(0, at).split(':')[0];
  if (!user) return '';
  return `${user}${value.slice(at)}`;
}

export function bareNumber(jid = '') {
  return String(jid).split('@')[0].split(':')[0].replace(/[^\d]/g, '');
}

export function isUrl(text = '') {
  return /^https?:\/\/[^\s]+$/i.test(String(text).trim());
}

export function isJidGroup(jid = '') {
  return String(jid).endsWith('@g.us');
}

export function isJidUser(jid = '') {
  return /@(s\.whatsapp\.net|lid)$/.test(String(jid));
}

/** Argumen berupa nomor telepon (boleh diawali @ atau +). */
export const NUMBER_ARG = /^@?\+?\d{7,20}$/;

/**
 * Tentukan target user dari argumen, mention, atau pesan yang di-reply.
 * Dipakai command owner (`.premium`, `.limit`) dan `.profile`.
 *
 * `args` harus SUDAH tanpa kata kunci aksi (add/del) bila ada.
 * @returns {{jid: string, rest: string[]}} `rest` = argumen setelah target
 */
export function resolveUserTarget(m, args = [], { shorthand = true } = {}) {
  const raw = String(args[0] ?? '').trim();

  // nomor polos / mention / jid lengkap
  if (raw && NUMBER_ARG.test(raw)) return { jid: toJid(raw), rest: args.slice(1) };
  if (raw && raw.includes('@') && isJidUser(cleanJid(raw))) return { jid: cleanJid(raw), rest: args.slice(1) };

  // tanpa nomor: pakai mention atau pengirim pesan yang di-reply
  const source = (m?.mentionedJid || [])[0] || m?.quoted?.sender || '';
  if (source) {
    // ".premium add 30" / ".limit add 10" saat reply -> angka itu jadi parameter
    const rest = shorthand && /^\d{1,4}$/.test(raw) ? [raw, ...args.slice(1)] : args.slice(1);
    return { jid: cleanJid(source), rest };
  }
  return { jid: '', rest: [] };
}

export function parseMention(text = '') {
  return [...String(text).matchAll(/@(\d{5,20})/g)].map((match) => `${match[1]}@s.whatsapp.net`);
}

/**
 * Kumpulkan target (jid) dari mention, pesan yang di-quote, dan argumen angka.
 * Dipakai plugin grup (kick/promote/demote/...).
 */
export function getTargets(m, args = []) {
  const list = [...(m?.mentionedJid || [])];
  if (m?.quoted?.sender) list.push(m.quoted.sender);
  for (const arg of args || []) {
    if (/^\+?\d{7,20}$/.test(String(arg))) list.push(toJid(String(arg)));
  }
  const seen = new Set();
  const result = [];
  for (const jid of list) {
    const clean = cleanJid(jid);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

/** Format byte ala "12,3 MB". */
export function formatBytes(bytes, decimals = 2) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const result = value / 1024 ** index;
  return `${result.toFixed(index === 0 ? 0 : decimals).replace('.', ',')} ${units[index]}`;
}

/** 1 Hari 02:03:04 */
export function clockString(ms) {
  if (!isNumber(ms) || ms < 0) return '--';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms / 3600000) % 24;
  const minutes = Math.floor(ms / 60000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const clock = [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
  return days > 0 ? `${days} Hari ${clock}` : clock;
}

/** 02:03:04 (tanpa hari) */
export function shortClock(ms) {
  if (!isNumber(ms) || ms < 0) return '--';
  return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}

export function timestamp(date = new Date(), timeZone = 'Asia/Jakarta') {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(date instanceof Date ? date : new Date(date));
}

export function dateStamp(date = new Date(), timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date instanceof Date ? date : new Date(date));
  return parts; // YYYY-MM-DD
}

/** Format nomor telepon cantik: 628xx -> +62 8xx-xxxx-xxxx */
export async function formatPhone(number) {
  try {
    const { default: PhoneNumber } = await import('awesome-phonenumber');
    const phone = new PhoneNumber(String(number).startsWith('+') ? String(number) : `+${bareNumber(number)}`);
    return phone.isValid() ? phone.getNumber('international') : `+${bareNumber(number)}`;
  } catch {
    return `+${bareNumber(number)}`;
  }
}

/** Ubah stream (Baileys) menjadi Buffer. */
export async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  const chunks = [];
  const readable = stream instanceof Readable ? stream : Readable.from(stream);
  for await (const chunk of readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function fetchJson(url, options = {}) {
  const { timeout = 30000, ...rest } = options;
  const response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respons bukan JSON: ${text.slice(0, 200)}`);
  }
}

export async function fetchBuffer(url, options = {}) {
  const { timeout = 60000, ...rest } = options;
  const response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function fetchText(url, options = {}) {
  const { timeout = 30000, ...rest } = options;
  const response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.text();
}

/** Bagi teks panjang menjadi potongan <= maxLength (WhatsApp batas ±65k). */
export function chunkText(text, maxLength = 4000) {
  const value = String(text);
  if (value.length <= maxLength) return [value];
  const chunks = [];
  let rest = value;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf('\n', maxLength);
    if (cut < maxLength * 0.5) cut = maxLength;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function safeFileName(name = 'file') {
  return path.basename(String(name)).replace(/[^\w.\-() ]+/g, '_').slice(0, 120) || 'file';
}

/** Pulihkan pengaturan owner yang tersimpan di database saat startup. */
export function applyStoredSettings(config, data) {
  const mode = data?.settings?.mode;
  if (mode === 'self' || mode === 'public') config.bot.mode = mode;
  return config.bot.mode;
}

export const Func = {
  sleep,
  delay,
  isNumber,
  randomInt,
  pickRandom,
  ucfirst,
  toJid,
  cleanJid,
  bareNumber,
  isUrl,
  isJidGroup,
  isJidUser,
  parseMention,
  getTargets,
  formatBytes,
  clockString,
  shortClock,
  timestamp,
  dateStamp,
  formatPhone,
  streamToBuffer,
  fetchJson,
  fetchBuffer,
  fetchText,
  chunkText,
  safeFileName,
};

export default Func;
