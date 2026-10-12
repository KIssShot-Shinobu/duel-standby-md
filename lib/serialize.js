/**
 * Serializer pesan: mengubah objek WAMessage milik Baileys menjadi `m`
 * yang nyaman dipakai plugin (gaya wabot-aq/RTXZY): m.text, m.reply(),
 * m.download(), m.quoted, m.mentionedJid, dan seterusnya.
 */
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { cleanJid, parseMention, streamToBuffer } from './functions.js';

const UNWRAP_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
];

const MEDIA_TYPES = {
  imageMessage: 'image',
  videoMessage: 'video',
  ptvMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
};

/** Tipe isi pesan yang tidak perlu diproses sebagai perintah. */
export const IGNORED_TYPES = new Set([
  'protocolMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pollUpdateMessage',
  'keepInChatMessage',
  'stickerPackMessage',
]);

const CONTENT_KEYS = [
  'conversation',
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'ptvMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage',
  'contactMessage',
  'contactsArrayMessage',
  'locationMessage',
  'liveLocationMessage',
  'buttonsResponseMessage',
  'listResponseMessage',
  'templateButtonReplyMessage',
];

/**
 * Apakah pesan ini punya konten yang berguna untuk diproses?
 * WhatsApp kadang mengirim `senderKeyDistributionMessage` / `protocolMessage`
 * bersamaan dengan teks asli, jadi kita cek seluruh isi pesan — bukan hanya
 * key pertamanya.
 */
export function hasMeaningfulContent(message) {
  const content = unwrapMessage(message);
  if (!content || typeof content !== 'object') return false;
  return CONTENT_KEYS.some((field) => {
    const value = content[field];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.length > 0;
    return true;
  });
}

/** Buka pembungkus pesan (ephemeral, view-once, document+caption, ...). */
export function unwrapMessage(message) {
  if (!message || typeof message !== 'object') return message;
  for (const key of UNWRAP_KEYS) {
    if (message[key]?.message) return unwrapMessage(message[key].message);
  }
  return message;
}

export function detectType(content) {
  const target = unwrapMessage(content);
  if (!target) return null;
  // Jangan hanya lihat key pertama: WhatsApp bisa menaruh
  // senderKeyDistributionMessage / messageContextInfo di depan media.
  for (const key of Object.keys(target)) {
    if (MEDIA_TYPES[key]) return MEDIA_TYPES[key];
  }
  return null;
}

/** Key pertama yang benar-benar berisi media (imageMessage, videoMessage, ...). */
export function firstMediaKey(content) {
  const target = unwrapMessage(content);
  if (!target) return null;
  return Object.keys(target).find((key) => MEDIA_TYPES[key]) || null;
}

/** Key pertama yang bermakna (media atau teks), bukan pesan sistem. */
export function firstMeaningfulKey(content) {
  const target = unwrapMessage(content);
  if (!target) return null;
  const keys = Object.keys(target);
  return keys.find((key) => MEDIA_TYPES[key]) || keys.find((key) => !IGNORED_TYPES.has(key)) || keys[0] || null;
}

export function extractText(message) {
  const content = unwrapMessage(message) || {};
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.ptvMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    ''
  );
}

export function extractMentions(message) {
  const content = unwrapMessage(message) || {};
  const contextInfo =
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    content.documentMessage?.contextInfo ||
    null;
  const mentioned = contextInfo?.mentionedJid || [];
  const text = extractText(message);
  return [...new Set([...mentioned.map(cleanJid), ...parseMention(text)])];
}

/** Download isi media dari sebuah message content. */
export async function downloadMedia(content, type) {
  const target = unwrapMessage(content);
  const key = type
    ? Object.keys(target || {}).find((field) => MEDIA_TYPES[field] === type)
    : firstMediaKey(target);
  const mediaType = type || (key ? MEDIA_TYPES[key] : null);
  if (!target || !key || !mediaType) throw new Error('Pesan ini tidak berisi media yang bisa diunduh');
  const stream = await downloadContentFromMessage(target[key], mediaType);
  return streamToBuffer(stream);
}

function buildQuoted(conn, raw, content) {
  const contextInfo = content?.contextInfo;
  const quoted = contextInfo?.quotedMessage;
  if (!quoted) return null;
  const selfId = conn?.user?.id;
  const participant = contextInfo.participant || contextInfo.participantAlt;
  return smsg(conn, {
    key: {
      remoteJid: raw.key?.remoteJid,
      fromMe: Boolean(selfId && participant && cleanJid(participant) === cleanJid(selfId)),
      id: contextInfo.stanzaId,
      participant,
    },
    message: quoted,
    messageTimestamp: contextInfo.quotedMessageTimestamp || raw.messageTimestamp,
    pushName: undefined,
  });
}

/**
 * @param {any} conn socket Baileys
 * @param {any} raw WAMessage
 * @returns {any|null} objek `m`
 */
export function smsg(conn, raw) {
  if (!raw?.message) return null;
  const key = raw.key || {};
  const content = unwrapMessage(raw.message);
  if (!content || !Object.keys(content).length) return null;

  const chat = cleanJid(key.remoteJid || '');
  const fromMe = Boolean(key.fromMe);
  const isGroup = chat.endsWith('@g.us');
  const participant = key.participant || null;

  // `m.msg` berisi konten DALAM (mis. imageMessage itu sendiri) supaya
  // `m.msg.mimetype` / `m.msg.caption` bekerja seperti di wabot-aq/RTXZY.
  // Kontainer penuh tetap tersedia lewat `m.content`.
  const contentKey = firstMeaningfulKey(content);
  const innerContent = contentKey && content[contentKey] !== undefined ? content[contentKey] : content;

  // WhatsApp sekarang mengirim identitas dalam dua bentuk: LID (id internal)
  // dan PN (nomor telepon). Kita utamakan PN supaya permission/owner tetap
  // bekerja; LID disimpan untuk pemetaan di database.
  const pnFromKey = key.participantPn || key.senderPn || null;
  const lidFromKey = key.participantLid || key.senderLid || null;
  const senderRaw = fromMe ? conn?.user?.id || chat : pnFromKey || participant || key.remoteJidAlt || chat;
  const sender = cleanJid(senderRaw);

  const m = {
    ...raw,
    key,
    id: key.id,
    chat,
    sender,
    senderAlt: participant ? cleanJid(participant) : sender,
    fromMe,
    isGroup,
    isPrivate: !isGroup,
    pushName: raw.pushName || '',
    isBaileys: true,
    msg: innerContent,
    /** Kontainer pesan penuh (imageMessage, messageContextInfo, mediaKey, dll.) */
    content,
    mtype: contentKey || 'unknown',
    text: extractText(raw.message),
    mentionedJid: extractMentions(raw.message),
    quoted: buildQuoted(conn, raw, content),
    msgTimestamp: Number(raw.messageTimestamp || 0),
    /** Nomor telepon (kalau ada) dan LID, untuk pemetaan identitas */
    senderPn: pnFromKey ? cleanJid(pnFromKey) : sender.endsWith('@s.whatsapp.net') ? sender : null,
    senderLid: lidFromKey ? cleanJid(lidFromKey) : sender.endsWith('@lid') ? sender : participant?.endsWith('@lid') ? cleanJid(participant) : null,
  };

  m.mentionedJid = [...new Set([...(m.mentionedJid || [])])];
  m.exp = 0;
  m.limit = false;
  /** Ambil ulang media yang menempel di pesan ini. */
  m.download = async () => downloadMedia(raw.message, detectType(content));

  /** Balas pesan. String -> teks, Buffer -> gambar, Object -> konten WA mentah. */
  m.reply = async (payload, chatTarget = m.chat, options = {}) => {
    if (payload === undefined || payload === null) return null;
    if (Buffer.isBuffer(payload)) {
      const { caption = '', ...rest } = options;
      return conn.sendMessage(chatTarget, { image: payload, caption, ...rest }, { quoted: m });
    }
    if (typeof payload === 'object') {
      return conn.sendMessage(chatTarget, payload, { quoted: m, ...options });
    }
    return conn.sendMessage(chatTarget, { text: String(payload), ...options }, { quoted: m });
  };

  /** Reaksi emoji. */
  m.react = async (emoji) =>
    conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } }).catch(() => null);

  /** Hapus pesan (butuh bot admin di grup). */
  m.delete = async () => conn.sendMessage(m.chat, { delete: m.key }).catch(() => null);

  /** Tandai sudah dibaca. */
  m.read = async () => conn.readMessages([m.key]).catch(() => null);

  m.mentionedJid.push(...(m.mentionedJid.includes(m.sender) ? [] : []));
  return m;
}

/** Ambil nama tampilan sebuah jid (dari store kontak/pushName). */
export function nameOf(conn, jid) {
  const clean = cleanJid(jid);
  return (
    conn?.contacts?.[clean]?.name ||
    conn?.contacts?.[clean]?.notify ||
    conn?.getName?.(clean) ||
    clean.split('@')[0]
  );
}

export default {
  smsg,
  unwrapMessage,
  detectType,
  firstMediaKey,
  firstMeaningfulKey,
  extractText,
  extractMentions,
  downloadMedia,
  nameOf,
  hasMeaningfulContent,
  IGNORED_TYPES,
};
