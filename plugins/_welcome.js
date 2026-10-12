/**
 * Welcome / goodbye / notifikasi admin grup.
 *   .welcome on|off   (lihat group-config.js)
 *
 * Event plugin: dipanggil handler.dispatchGroupParticipants saat ada
 * anggota masuk, keluar, diangkat, atau diturunkan.
 */
import { bareNumber } from '../lib/functions.js';

const handler = {};

handler.onGroupParticipants = async (conn, update, { chat, groupMetadata, config }) => {
  if (!chat.welcome) return;

  const subject = groupMetadata?.subject || 'grup ini';
  const desc = groupMetadata?.desc || '';
  const jids = update.participants || [];

  const labels = {
    add: '👋 *SELAMAT DATANG*',
    remove: '👋 *SAMPAI JUMPA*',
    promote: '⬆️ *JADI ADMIN*',
    demote: '⬇️ *TURUN JABATAN*',
    leave: '👋 *KELUAR*',
  };

  const title = labels[update.action] || `ℹ️ *${String(update.action).toUpperCase()}*`;
  const mentions = jids.filter(Boolean);
  const lines = mentions.map((jid) => `@${bareNumber(jid)}`);

  const body = [
    title,
    '',
    ...(lines.length ? lines : ['(tidak ada peserta)']),
    '',
    `📛 Grup: *${subject}*`,
    desc ? `📝 ${desc.slice(0, 200)}` : null,
    '',
    `_${config.bot.name}_`,
  ]
    .filter(Boolean)
    .join('\n');

  await conn.sendMessage(update.id, { text: body, mentions }, {}).catch(() => {});
};

export default handler;
