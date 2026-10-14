/**
 * Intro otomatis untuk chat DM.
 *
 * Saat seseorang mulai ngobrol (DM) ke bot, kirim sekali saja panduan
 * penggunaan bot + informasi sewa. Penanda disimpan per user (dmIntroSentAt)
 * supaya tidak spam tiap pesan.
 */
import * as Rent from '../lib/rent.js';

const handler = {};

handler.before = async (m, ctx = {}) => {
  const { conn, db, config } = ctx || {};
  if (!m || m.isGroup || m.fromMe) return true;
  if (!conn || !db || !config) return true;

  const user = ctx.user || db.user(m.sender);
  if (!user) return true;
  if (user.dmIntroSentAt) return true;

  const name = config?.bot?.name || 'Duel Standby';
  const version = config?.version || '';
  const p = config?.bot?.prefix?.[0] || '.';

  const lines = [
    `👋 *Halo${m.pushName ? ` ${m.pushName}` : ''}!*`,
    `Selamat datang di *${name}*${version ? ` v${version}` : ''}.`,
    '',
    '📖 *Cara penggunaan bot:*',
    `• Ketik ${p}menu untuk lihat semua fitur`,
    `• Ketik ${p}help <command> untuk detail command`,
    '• Kirim foto/video/GIF dengan caption, atau reply pesan milik bot',
    '',
  ];

  const rentEnabled = config?.rent?.enabled !== false;
  if (rentEnabled) {
    const s = Rent.rentSettings(db, config);
    const price = s.pricePerMonth ? `Rp${s.pricePerMonth.toLocaleString('id-ID')}` : null;
    lines.push(
      '🎫 *Penyewaan bot:*',
      price ? `• Harga: ${price} / ${s.days} hari` : `• Durasi sewa: ${s.days} hari`,
      `• DM bot: ${p}rent <nama grup | link | id>`,
      s.helpNumber ? `• Butuh bantuan: https://wa.me/${s.helpNumber}` : null,
      '',
    );
  }

  lines.push(`👉 ${name}`, '', '_Balas pesan ini dengan perintah bot, atau ketik .menu untuk mulai._');

  try {
    await conn.sendMessage(m.chat, { text: lines.filter(Boolean).join('\n') }, {});
    user.dmIntroSentAt = Date.now();
    db.touch();
  } catch {
    /* intro gagal kirim — coba lagi lain waktu */
  }
  return true;
};

export default handler;