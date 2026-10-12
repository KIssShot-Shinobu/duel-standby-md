/**
 * Buat QR code dari teks/link.
 *   .qr https://example.com
 */
import QRCode from 'qrcode';

const handler = async (m, { conn, text, config }) => {
  const value = text || m.quoted?.text || '';
  if (!value) return m.reply(`Contoh: ${config.bot.prefix[0]}qr https://example.com`);
  if (value.length > 1200) return m.reply('Teks terlalu panjang untuk QR code.');

  const png = await QRCode.toBuffer(value, { type: 'png', width: 512, margin: 2 });
  return conn.sendImage(m.chat, png, `QR untuk: ${value}`, m);
};

handler.help = ['qr', 'qrcode'];
handler.tags = ['tools'];
handler.command = /^(qr|qrcode)$/i;
handler.limit = false;

export default handler;
