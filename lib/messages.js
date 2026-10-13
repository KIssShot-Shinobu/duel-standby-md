/**
 * Utilitas pesan yang terasa natural/bukan bot.
 * Tujuan: mengurangi karakter "kotak" (box-drawing), emoji berlebihan,
 * dan struktur kaku seperti "Field: Value".
 *
 * Catatan format: WhatsApp memakai **satu** asterisk untuk bold (`*teks*`),
 * bukan `**teks**` — `**` akan tampil sebagai bintang liar di chat.
 */

// ============================================================
// Variasi sapaan acak (biar gak terlalu monoton)
// ============================================================
const GREETINGS = [
  'Halo',
  'Hai',
  'Haloo',
  'Haii',
  'Halo juga',
  'Yoi',
];

const FAREWELLS = [
  'Sampai jumpa',
  'Dadah',
  'Bye',
  'Sampai ketemu lagi',
];

const ACKNOWLEDGMENTS = [
  'Oke',
  'Siap',
  'Mengerti',
  'Baik',
  'Oke deh',
  'Sip',
];

const THINKING = [
  'Sebentar ya...',
  'Tunggu sebentar...',
  'Lagi diproses...',
  'Proses dulu ya...',
];

const ERROR_PREFIXES = [
  'Ups',
  'Waduh',
  'Eh',
  'Maaf',
];

const SUCCESS_PREFIXES = [
  'Selesai',
  'Berhasil',
  'Oke',
  'Jadi',
];

// Helper: ambil random dari array
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Helper: format nama user (pushName atau nomor singkat)
export function userName(m, db) {
  if (m?.pushName) return m.pushName;
  const jid = m?.sender || '';
  // Kalau db tersedia, coba ambil nama terdaftar
  if (db && m?.sender) {
    const user = db.user(m.sender);
    if (user?.name) return user.name;
  }
  return jid.split('@')[0];
}

// Helper: format nomor jadi lebih ramah (628xxx -> 08xxx)
export function friendlyNumber(jid) {
  if (!jid) return '-';
  const num = jid.replace(/[^0-9]/g, '');
  if (num.startsWith('62')) return '0' + num.slice(2);
  return num;
}

// ============================================================
// Fungsi utama untuk berbagai jenis respons
// ============================================================

/** Sapaan pembuka */
export function greet(m) {
  return `${pick(GREETINGS)} ${userName(m)}! 👋`;
}

/** Penutup */
export function farewell(m) {
  return `${pick(FAREWELLS)} ${userName(m)}! 👋`;
}

/** Konfirmasi singkat */
export function ack() {
  return pick(ACKNOWLEDGMENTS);
}

/** Pesan "sedang diproses" */
export function thinking() {
  return pick(THINKING);
}

/** Error yang terasa human */
export function err(message, m) {
  const prefix = pick(ERROR_PREFIXES);
  return `${prefix}, ${message}`;
}

/** Sukses yang terasa human */
export function ok(message, m) {
  const prefix = pick(SUCCESS_PREFIXES);
  return `${prefix}: ${message}`;
}

/** Gabungkan baris-baris teks (alias joinLines untuk kejelasan). */
export function joinLines(lines) {
  const arr = Array.isArray(lines) ? lines : [lines];
  return arr.join('\n');
}

/** @deprecated Use joinLines instead. Kept for backward compatibility. */
export const info = joinLines;

/** Format daftar command jadi natural (bukan tabel kaku) */
export function commandList(title, commands, prefix) {
  if (!commands?.length) return `${title}\n\nBelum ada command di sini.`;
  
  const items = commands
    .map((cmd, i) => `${i + 1}. ${prefix}${cmd}`)
    .join('\n');
  
  return `${title}\n\n${items}\n\nKetik \`${prefix}help <command>\` buat detail.`;
}

/** Format profil user yang natural */
export function profileText(data, m) {
  const { name, age, registered, premium, level, exp, limit, quota, saldo, rank, totalUsers, totalCommands, banned, isSelf, limitBonus } = data;
  
  const lines = [
    isSelf ? `👤 *Profilmu, ${name || userName(m)}*` : `👤 *Profil ${name || userName(m)}*`,
    '',
    `📝 Status: ${registered ? 'Sudah daftar' : 'Belum daftar'} ${age > 0 ? `· Umur ${age}` : ''}`,
    premium ? `💎 Premium: Ya${data.until ? ` (sampai ${data.until})` : ''}` : '💎 Premium: Belum',
    `📊 Level ${level} (${exp} XP)`,
    `🎯 Limit: ${limit}/${quota}${limitBonus ? ` (+${limitBonus} bonus)` : ''}`,
    `💰 Saldo: ${saldo}`,
    rank > 0 ? `🏆 Rank #${rank} dari ${totalUsers} user` : null,
    `⚡ Total command: ${totalCommands}`,
    banned ? `🚫 Dibanned: ${banned.reason || 'tanpa alasan'}` : null,
  ].filter(Boolean);
  
  return lines.join('\n');
}

/** Format info bot yang natural */
export function botInfo(data, m) {
  const { name, version, ownerName, pluginCount, commandCount, userCount, chatCount, messageCount, prefix, mode, nodeVersion, ffmpeg, ytdlp, connected } = data;
  
  const lines = [
    `🤖 *${name}* v${version}`,
    '',
    `👑 Owner: ${ownerName}`,
    `📦 ${pluginCount} plugin · ${commandCount} command`,
    `👥 ${userCount} user · 💬 ${chatCount} chat · 📨 ${messageCount} pesan`,
    `🔑 Prefix: ${Array.isArray(prefix) ? prefix.join(' ') : prefix}`,
    `🎚️ Mode: ${mode}`,
    `🧠 Node.js ${nodeVersion}`,
    `🎞️ ffmpeg: ${ffmpeg ? 'ada' : 'gak ada'}`,
    `🎬 yt-dlp: ${ytdlp ? 'ada' : 'gak ada'}`,
    `🔗 Koneksi: ${connected ? 'nyambung' : 'putus'}`,
  ];
  
  return lines.join('\n');
}

/** Format hasil pencarian/download */
export function resultText(title, meta = {}) {
  const lines = [`🎵 *${title}*`];
  
  if (meta.duration) lines.push(`⏱️ ${meta.duration}`);
  if (meta.size) lines.push(`📦 ${meta.size}`);
  if (meta.format) lines.push(`📁 ${meta.format}`);
  if (meta.note) lines.push(`_${meta.note}_`);
  
  return lines.join('\n');
}

/** Pesan "gak ditemukan" */
export function notFound(what, query) {
  return `Gak ketemu ${what}${query ? ` untuk "${query}"` : ''}. Coba lagi deh.`;
}

/** Pesan "butuh izin" */
export function needPermission(what) {
  return `Command ini cuma bisa dipake ${what}.`;
}

/** Pesan "limit habis" */
export function limitExceeded(limit, resetAt) {
  return `Limit kamu udah habis (${limit}/hari). Reset ${resetAt ? `pada ${resetAt}` : 'besok'} ya.`;
}

/** Pesan error umum */
export function genericError(err, context = '') {
  const msg = err?.message || String(err);
  return `Error${context ? ` di ${context}` : ''}: ${msg}`;
}

export default {
  greet,
  farewell,
  ack,
  thinking,
  err,
  ok,
  info,
  commandList,
  profileText,
  botInfo,
  resultText,
  notFound,
  needPermission,
  limitExceeded,
  genericError,
  userName,
  friendlyNumber,
  joinLines,
};