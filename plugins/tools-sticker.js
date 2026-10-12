/**
 * Ubah gambar / video / GIF menjadi stiker.
 *
 *   .sticker                        -> kirim gambar/video/GIF dengan caption .sticker
 *   .sticker (reply)                -> reply gambar/GIF/video milik siapa pun
 *   .sticker https://.../x.gif      -> dari tautan
 *   .sticker NamaPack               -> set nama pack
 *
 * Catatan penting:
 *  - GIF & WebP animasi => stiker ANIMASI (bukan statis).
 *  - Jenis media dideteksi dari ISI berkas (file-type), bukan dari mimetype
 *    pesan — banyak GIF dikirim WhatsApp sebagai dokumen tanpa mimetype jelas.
 *  - Video/GIF dipotong otomatis ke `maxStickerSeconds`.
 */
import fs from 'node:fs';
import { detectMediaKind, webpEncoder } from '../lib/media.js';
import { loadMedia, mediaMime, pickMediaSource } from '../lib/media-source.js';
import { userError } from '../lib/errors.js';

const IMAGE_MIME = /image\/(jpe?g|png|webp|gif|bmp|tiff)/i;
const VIDEO_MIME = /video\//i;

const handler = async (m, { conn, args, command, usedPrefix, config }) => {
  const source = pickMediaSource(m, { args, text: m.text });

  if (!source) {
    throw userError(
      [
        '❌ *Tidak ada gambar/video* pada pesan ini.',
        '',
        'Cara pakai:',
        `• Kirim foto/video/GIF dengan caption *${usedPrefix}${command}*`,
        `• atau reply (geser) foto/GIF/video milik siapa pun lalu kirim *${usedPrefix}${command}*`,
        `• atau kirim tautan: *${usedPrefix}${command} https://.../x.gif*`,
        '',
        `Durasi video/GIF maksimal ${config.media.maxStickerSeconds} detik.`,
      ].join('\n'),
    );
  }

  const content = source.kind === 'url' ? {} : source.node.msg || {};
  const messageMime = mediaMime(source) || '';

  const packname = args.filter((arg) => !/^https?:\/\//i.test(arg)).join(' ').trim() || config.bot.packname;
  const options = { packname, author: config.bot.author };
  const maxSeconds = config.media.maxStickerSeconds;

  await m.reply(config.messages.stickerWait);

  const buffer = await loadMedia(source);

  if (!buffer?.length) throw userError('❌ Gagal mengunduh media (berkas kosong). Coba kirim ulang.');

  // Deteksi dari ISI berkas: lebih akurat daripada mimetype pesan.
  const detected = await detectMediaKind(buffer);
  const mime = detected.mime || messageMime;
  const isGifLike = detected.kind === 'gif' || detected.kind === 'animated' || /gif/i.test(messageMime) || content.gifPlayback === true;
  const isVideo = detected.kind === 'video' || VIDEO_MIME.test(messageMime);
  const isImage = detected.kind === 'image' || detected.kind === 'sticker' || IMAGE_MIME.test(messageMime) || IMAGE_MIME.test(mime);

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

  // GIF/WebP animasi/video => stiker animasi (butuh ffmpeg).
  if (isGifLike || isVideo) {
    if (!isGifLike && encoder !== 'ffmpeg') {
      throw userError('❌ Stiker dari video butuh ffmpeg dengan libwebp.\nPasang dengan: `apt install ffmpeg`.');
    }
    if (encoder !== 'ffmpeg') {
      throw userError('❌ GIF/animasi butuh ffmpeg dengan libwebp.\nPasang dengan: `apt install ffmpeg`.');
    }

    // Video biasa: tolak kalau terlalu panjang. GIF dipotong otomatis.
    const seconds = Number(content.seconds) || 0;
    if (isVideo && !isGifLike && seconds > maxSeconds) {
      throw userError(`❌ Video terlalu panjang (${Math.round(seconds)}s). Maksimal ${maxSeconds} detik.`);
    }

    const file = await conn.sendVideoAsSticker(m.chat, buffer, m, { ...options, seconds: maxSeconds });
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  }

  if (!isImage) {
    throw userError(
      `❌ Tipe media *${mime || 'tidak diketahui'}* belum didukung.\nKirim gambar, GIF, atau video (maksimal ${maxSeconds} detik).`,
    );
  }

  const file = await conn.sendImageAsSticker(m.chat, buffer, m, options);
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
  return true;
};

handler.help = ['sticker', 'stiker', 's'];
handler.tags = ['tools'];
handler.command = /^(sticker|stiker|s|stick)$/i;
handler.limit = true;

export default handler;
