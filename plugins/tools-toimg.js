/**
 * Ubah stiker menjadi gambar (png).
 *   .toimg  -> reply stiker
 */
import { webpToPng } from '../lib/media.js';

const handler = async (m, { conn, usedPrefix, command }) => {
  const target = m.quoted && m.quoted.msg?.mimetype ? m.quoted : m;
  const mime = target.msg?.mimetype || '';

  if (!/webp/i.test(mime)) {
    throw `Reply sebuah stiker dengan caption *${usedPrefix}${command}*`;
  }

  const buffer = await target.download();
  const png = await webpToPng(buffer);
  return conn.sendImage(m.chat, png, '', m);
};

handler.help = ['toimg', 'toimage'];
handler.tags = ['tools'];
handler.command = /^(toimg|toimage|tofoto)$/i;
handler.limit = true;

export default handler;
