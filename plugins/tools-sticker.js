/**
 * Ubah gambar/video menjadi stiker.
 *   .sticker              -> kirim/reply gambar atau video (video maks 10 detik)
 *   .sticker NamaPack     -> set nama pack
 *
 * Menerima sumber media dari:
 *   - pesan yang sedang dikirim (foto/video + caption .sticker)
 *   - pesan yang di-reply (termasuk foto yang dikirim sebagai dokumen)
 */
import fs from 'node:fs';
import { webpEncoder } from '../lib/media.js';
import { userError } from '../lib/errors.js';

/** Cari pesan yang benar-benar berisi media (reply diprioritaskan). */
function pickMediaSource(m) {
  const candidates = [m.quoted, m].filter(Boolean);
  return candidates.find((item) => item.msg?.mimetype) || null;
}

const handler = async (m, { conn, args, command, usedPrefix, config }) => {
  const source = pickMediaSource(m);

  if (!source) {
    throw userError(
      [
        '❌ *Tidak ada gambar/video* pada pesan ini.',
        '',
        'Cara pakai:',
        `• Kirim foto/video dengan caption *${usedPrefix}${command}*`,
        `• atau reply (geser) foto/video lalu kirim *${usedPrefix}${command}*`,
        '',
        `Durasi video maksimal ${config.media.maxStickerSeconds} detik.`,
      ].join('\n'),
    );
  }

  const content = source.msg || {};
  const mime = content.mimetype || '';
  const isImage = /image\/(jpe?g|png|webp|gif|bmp|tiff)/i.test(mime);
  const isVideo = /video\//i.test(mime);

  if (!isImage && !isVideo) {
    throw userError(
      `❌ Tipe media *${mime || 'tidak diketahui'}* belum didukung.\nKirim gambar atau video (maksimal ${config.media.maxStickerSeconds} detik).`,
    );
  }

  // Validasi durasi lebih dulu supaya pesannya lebih tepat daripada error encoder.
  const seconds = Number(content.seconds) || 0;
  if (isVideo && seconds > config.media.maxStickerSeconds) {
    throw userError(`❌ Video terlalu panjang (${Math.round(seconds)}s). Maksimal ${config.media.maxStickerSeconds} detik.`);
  }

  const encoder = webpEncoder();
  if (!encoder) {
    throw userError(
      [
        '❌ Server belum punya encoder WebP, jadi stiker tidak bisa dibuat.',
        '',
        'Pasang salah satu:',
        '• `apt install ffmpeg` (versi lengkap dengan libwebp)',
        '• `apt install webp` (menyediakan perintah cwebp)',
        '',
        'Cek cepat: `ffmpeg -encoders | grep webp`',
      ].join('\n'),
    );
  }
  if (isVideo && encoder !== 'ffmpeg') {
    throw userError('❌ Stiker dari video butuh ffmpeg dengan libwebp.\nPasang dengan: `apt install ffmpeg`.');
  }

  const packname = args.join(' ').trim() || config.bot.packname;
  await m.reply(config.messages.stickerWait);

  const buffer = await source.download();
  if (!buffer?.length) throw userError('❌ Gagal mengunduh media (file kosong). Coba kirim ulang fotonya.');

  const options = { packname, author: config.bot.author };

  if (isImage) {
    const file = await conn.sendImageAsSticker(m.chat, buffer, m, options);
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }

  const file = await conn.sendVideoAsSticker(m.chat, buffer, m, {
    ...options,
    seconds: config.media.maxStickerSeconds,
  });
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
};

handler.help = ['sticker', 'stiker', 's'];
handler.tags = ['tools'];
handler.command = /^(sticker|stiker|s|stick)$/i;
handler.limit = true;

export default handler;
