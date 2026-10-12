/**
 * Mention semua anggota grup.
 *   .tagall Pesan pengantar
 */
import { bareNumber } from '../lib/functions.js';

const handler = async (m, { conn, text, participants, config }) => {
  const mention = participants.map((item) => item.id || item.jid).filter(Boolean);
  if (!mention.length) return m.reply('Gagal membaca daftar anggota.');

  const pesan = text || 'Mohon perhatiannya semua 🙏';
  const body = [
    `*「 TAG ALL 」*`,
    `👥 ${mention.length} anggota`,
    '',
    pesan,
    '',
    ...mention.map((jid, index) => `${index + 1}. @${bareNumber(jid)}`),
  ].join('\n');

  return conn.sendMessage(m.chat, { text: body, mentions: mention }, { quoted: m });
};

handler.help = ['tagall', 'hidetag'];
handler.tags = ['group'];
handler.command = /^(tagall|hidetag|everyone)$/i;
handler.group = true;
handler.admin = true;
handler.limit = false;

export default handler;
