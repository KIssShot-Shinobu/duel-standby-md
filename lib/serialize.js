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

/** Buka pembungkus pesan (ephemeral, view-once, document+caption, ...). */
export function unwrapMessage(message) {
  if (!message || typeof message !== 'object') return message;
  for (const key of UNWRAP_KEYS) {
    if (message[key]?.message) return unwrapMessage(message[key].message);
  }
  return message;
}

export function detectType(content) {
  if (!content) return null;
  return MEDIA_TYPES[Object.keys(content)[0]] || null;
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
  const mediaType = type || detectType(target);
  if (!mediaType) throw new Error('Pesan ini tidak berisi media yang bisa diunduh');
  const key = Object.keys(target).find((k) => MEDIA_TYPES[k] === mediaType) || `${mediaType}Message`;
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
  const participant = key.participant || key.participantAlt || null;
  // Prioritas: nomor telepon (PN) supaya konsisten walau WhatsApp mengirim LID.
  const senderRaw = fromMe
    ? conn?.user?.id || chat
    : key.participantAlt || participant || key.remoteJidAlt || chat;
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
    msg: content,
    mtype: Object.keys(content)[0] || 'unknown',
    text: extractText(raw.message),
    mentionedJid: extractMentions(raw.message),
    quoted: buildQuoted(conn, raw, content),
    msgTimestamp: Number(raw.messageTimestamp || 0),
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

export default { smsg, unwrapMessage, detectType, extractText, extractMentions, downloadMedia, nameOf };
