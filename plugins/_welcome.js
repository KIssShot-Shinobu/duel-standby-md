/**
 * Welcome / goodbye / notifikasi admin grup.
 *   .welcome on|off   (lihat group-config.js)
 *
 * Event plugin: dipanggil handler.dispatchGroupParticipants saat ada
 * anggota masuk, keluar, diangkat, atau diturunkan.
 */
import { bareNumber } from '../lib/functions.js';
import { greet, farewell } from '../lib/messages.js';
import * as Rent from '../lib/rent.js';

const handler = {};

handler.onGroupParticipants = async (conn, update, { chat, groupMetadata, config, db }) => {
  if (!chat.welcome) return;

  const subject = groupMetadata?.subject || 'grup ini';
  const desc = groupMetadata?.desc || '';
  const jids = update.participants || [];

  const labels = {
    add: '👋 *Selamat datang!*',
    remove: '👋 *Sampai jumpa!*',
    promote: '⬆️ *Jadi admin!*',
    demote: '⬇️ *Turun jabatan.*',
    leave: '👋 *Keluar dari grup.*',
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
    update.action === 'add' ? buildFooter(config, db) : null,
  ]
    .filter(Boolean)
    .join('\n');

  await conn.sendMessage(update.id, { text: body, mentions }, {}).catch(() => {});
};

/** Footer welcome: penggunaan bot, info sewa, dan nama bot di paling bawah. */
function buildFooter(config, db) {
  const s = Rent.rentSettings(db || { data: {} }, config);
  const p = config?.bot?.prefix?.[0] || '.';
  const price = s.pricePerMonth ? `Rp${s.pricePerMonth.toLocaleString('id-ID')} / bulan` : null;

  return [
    '─'.repeat(26),
    '📖 *Penggunaan bot:*',
    `• Ketik ${p}menu untuk lihat semua fitur`,
    `• Yu-Gi-Oh & stiker: GRATIS selalu`,
    `• Fitur lain: butuh sewa aktif`,
    '',
    '🎫 *Penyewaan bot:*',
    price ? `• Harga: ${price} per ${s.days} hari` : null,
    `• DM: ${p}rent <nama grup | link | id>`,
    s.helpNumber ? `• Klik link: https://wa.me/${s.helpNumber}` : null,
    '',
    `👉 ${config?.bot?.name || 'Duel Standby'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export default handler;
