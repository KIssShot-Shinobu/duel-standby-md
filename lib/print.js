/**
 * Printer log konsol yang enak dibaca (pengganti chalk/colors tanpa dependency berat).
 *
 * Semua baris memakai format yang sama supaya kolomnya lurus:
 *
 *   HH:mm:ss TAG  isi pesan
 *
 *   - TAG selalu 4 karakter: INFO / OK   / WARN / ERR  / DBG
 *   - `kv()` / `rows()` untuk baris data berlabel (labelnya dipadukan)
 *   - `printMessage()` / `printCommand()` untuk aktivitas chat, JID dipendekkan
 *     supaya tidak ada `628xxx@s.whatsapp.net` panjang di layar.
 */
import pc from 'picocolors';

export const color = pc;

/** Lebar kolom label untuk `kv()`/`rows()`. */
export const LABEL_WIDTH = 11;

export const TAGS = {
  info: { text: 'INFO', paint: pc.blue },
  success: { text: 'OK  ', paint: pc.green },
  warn: { text: 'WARN', paint: pc.yellow },
  error: { text: 'ERR ', paint: pc.red },
  debug: { text: 'DBG ', paint: pc.magenta },
};

const pad = (value, width) => String(value ?? '').padEnd(width);

/** Benar kalau LOG_LEVEL minta detail (JID penuh, dsb). */
const verbose = () => /debug|trace/i.test(process.env.LOG_LEVEL || '');

/** Jam:menit:detik 24 jam — tidak bergantung locale (hindari "21.29.32"). */
export function time(timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

const write = (stream, tag, message, args) => {
  const meta = TAGS[tag] || TAGS.info;
  const line = `${pc.gray(time())} ${meta.paint(meta.text)} ${message}`;
  if (args.length) stream(line, ...args);
  else stream(line);
};

export function info(message, ...args) {
  write(console.log, 'info', message, args);
}

export function success(message, ...args) {
  write(console.log, 'success', message, args);
}

export function warn(message, ...args) {
  write(console.log, 'warn', message, args);
}

export function error(message, ...args) {
  write(console.error, 'error', message, args);
}

export function debug(message, ...args) {
  if (!verbose()) return;
  write(console.log, 'debug', message, args);
}

/** Baris data: `label` dipadukan supaya nilainya sejajar. */
export function kv(label, value, { tag = 'info', width = LABEL_WIDTH } = {}) {
  const meta = TAGS[tag] || TAGS.info;
  console.log(`${pc.gray(time())} ${meta.paint(meta.text)} ${pc.gray(pad(label, width))} ${value}`);
}

/** Sekumpulan baris data; lebar label otomatis mengikuti yang terpanjang. */
export function rows(list = [], { tag = 'info', width = LABEL_WIDTH } = {}) {
  const widest = Math.max(width, ...list.map(([label]) => String(label).length));
  for (const [label, value] of list) kv(label, value, { tag, width: widest });
}

/** Judul tanpa kotak — tidak ada lagi border yang miring karena lebar emoji. */
export function banner(name, version = '', subtitle = '') {
  const rule = pc.cyan('─'.repeat(52));
  console.log(rule);
  console.log(`${pc.bold(pc.white(name))}${version ? `  ${pc.gray(version)}` : ''}`);
  if (subtitle) console.log(pc.gray(subtitle));
  console.log(rule);
}

/** `6281234567890@s.whatsapp.net` -> `6281234567890` (JID penuh saat mode debug). */
export function shortJid(jid = '') {
  const value = String(jid);
  if (verbose()) return value;
  return value.split('@')[0].split(':')[0] || value;
}

/**
 * Label chat ringkas: nama grup kalau ada, kalau tidak `grup 12036...`;
 * japri tetap ditampilkan sebagai nomor.
 */
export function chatLabel(chat = '', isGroup = false, name = '') {
  const value = String(chat);
  if (verbose()) return value;
  if (isGroup) {
    const label = String(name || '').replace(/\s+/g, ' ').trim();
    return label ? `grup ${label}` : `grup ${value.split('@')[0]}`;
  }
  return shortJid(value);
}

/** Cetak ringkasan pesan masuk. */
export function printMessage({ chat, sender, pushName, mtype = 'text', text = '', isGroup = false, groupName = '', timeZone }) {
  const kind = isGroup ? pc.magenta('GRUP') : pc.cyan('PRIB');
  const who = pushName ? `${pushName} (${shortJid(sender)})` : shortJid(sender);
  const body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const line = [pc.gray(time(timeZone)), kind];
  if (isGroup) line.push(pc.bold(chatLabel(chat, true, groupName)), pc.gray('←'));
  line.push(who, pc.gray(`[${mtype}]`), body);
  console.log(line.join(' '));
}

/** Cetak pemakaian perintah. */
export function printCommand({ command, sender, chat, isGroup = false, groupName = '', timeZone }) {
  const kind = isGroup ? pc.magenta('GRUP') : pc.cyan('PRIB');
  const line = [pc.gray(time(timeZone)), kind];
  if (isGroup) line.push(pc.bold(chatLabel(chat, true, groupName)));
  line.push(pc.gray('»'), pc.yellow(`.${command}`), pc.gray('oleh'), shortJid(sender));
  console.log(line.join(' '));
}

/** Ringkasan isi pesan keluar (text/caption/tipe media) untuk log terminal. */
export function outgoingPreview(content = {}) {
  const text =
    content.text ||
    content.caption ||
    content.conversation ||
    '';
  if (text) return String(text).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (content.image) return '[gambar]';
  if (content.video) return content.gifPlayback ? '[gif]' : '[video]';
  if (content.audio) return content.ptt ? '[vn]' : '[audio]';
  if (content.sticker) return '[stiker]';
  if (content.document) return '[dokumen]';
  if (content.react) return `[react ${content.react.text || ''}]`;
  if (content.delete) return '[hapus pesan]';
  if (content.location) return '[lokasi]';
  if (content.contactsArray || content.contact) return '[kontak]';
  if (content.poll) return '[polling]';
  return '[pesan]';
}

/** Cetak pesan KELUAR dari bot (balasan). */
export function printOutgoing({ chat, content = {}, isGroup = false, groupName = '', timeZone }) {
  const kind = isGroup ? pc.magenta('GRUP') : pc.cyan('PRIB');
  const target = isGroup ? pc.bold(chatLabel(chat, true, groupName)) : shortJid(chat);
  const mtype = content.sticker ? 'stiker' : content.image ? 'gambar' : content.video ? 'video' : content.audio ? 'audio' : 'teks';
  const line = [
    pc.gray(time(timeZone)),
    pc.green('BOT '),
    kind,
    target,
    pc.gray('→'),
    pc.gray(`[${mtype}]`),
    outgoingPreview(content),
  ];
  console.log(line.join(' '));
}

export default {
  color,
  banner,
  info,
  success,
  warn,
  error,
  debug,
  kv,
  rows,
  time,
  shortJid,
  chatLabel,
  printMessage,
  printCommand,
  printOutgoing,
  outgoingPreview,
};
