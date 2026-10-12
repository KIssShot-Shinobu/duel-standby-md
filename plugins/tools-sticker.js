/**
 * Ubah gambar/video menjadi stiker.
 *   .sticker              -> reply/kirim gambar atau video (maks 10 detik)
 *   .sticker NamaPack     -> set nama pack
 */
import fs from 'node:fs';

const handler = async (m, { conn, args, command, usedPrefix, config }) => {
  const target = m.quoted && m.quoted.msg?.mimetype ? m.quoted : m;
  const content = target.msg || {};
  const mime = content.mimetype || '';

  if (!mime) {
    throw `Kirim atau reply gambar/video dengan caption *${usedPrefix}${command}*\nDurasi video maksimal ${config.media.maxStickerSeconds} detik.`;
  }

  const packname = args.join(' ').trim() || config.bot.packname;
  await m.reply(config.messages.stickerWait);

  if (/image\/(jpe?g|png|webp|gif)/i.test(mime)) {
    const buffer = await target.download();
    const file = await conn.sendImageAsSticker(m.chat, buffer, m, { packname, author: config.bot.author });
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }

  if (/video/i.test(mime)) {
    const seconds = Number(content.seconds) || 0;
    if (seconds > config.media.maxStickerSeconds) {
      throw `Video terlalu panjang (${seconds}s). Maksimal ${config.media.maxStickerSeconds} detik.`;
    }
    const buffer = await target.download();
    const file = await conn.sendVideoAsSticker(m.chat, buffer, m, {
      packname,
      author: config.bot.author,
      seconds: config.media.maxStickerSeconds,
    });
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }

  throw `Tipe media *${mime}* belum didukung. Kirim gambar atau video.`;
};

handler.help = ['sticker', 'stiker', 's'];
handler.tags = ['tools'];
handler.command = /^(sticker|stiker|s|stick)$/i;
handler.limit = true;

export default handler;
