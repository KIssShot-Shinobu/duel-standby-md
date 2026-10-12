/**
 * Kirim gambar hasil unduhan ke WhatsApp dengan benar:
 *   - gambar biasa            -> pesan gambar (dengan caption)
 *   - GIF / WebP animasi      -> **GIF WhatsApp** (`video` + `gifPlayback`, butuh ffmpeg);
 *     kalau ffmpeg tidak ada  -> stiker WebP animasi (sharp) + caption terpisah
 *   - gagal semua             -> gambar statis (frame pertama) supaya user tetap dapat isi
 *
 * Kenapa tidak langsung kirim buffer GIF sebagai `image`? WhatsApp tidak
 * memutar `.gif` mentah pada pesan gambar — hasilnya diam. Animasi hanya jalan
 * kalau dikirim sebagai video ber-`gifPlayback` (mp4) atau sebagai stiker WebP.
 */
import { MAX_STICKER_BYTES, addExif, detectMediaKind, gifToMp4, hasFfmpeg, videoToWebp } from './media.js';

/**
 * @param {any} conn socket Baileys (punya sendMessage)
 * @param {string} chat
 * @param {{buffer: Buffer, caption?: string, quoted?: any, config?: any, seconds?: number}} options
 * @returns {Promise<'gif'|'sticker'|'image'>} mode yang akhirnya dipakai
 */
export async function sendImageResult(conn, chat, { buffer, caption = '', quoted = null, config = {}, seconds = 12 } = {}) {
  const options = quoted ? { quoted } : {};
  const detected = await detectMediaKind(buffer).catch(() => ({ kind: 'image' }));
  const animated = detected.kind === 'gif' || detected.kind === 'animated';

  if (animated) {
    // 1) Paling ideal: GIF WhatsApp (mp4 + gifPlayback).
    if (hasFfmpeg()) {
      try {
        const mp4 = await gifToMp4(buffer, { seconds });
        if (mp4?.length) {
          await conn.sendMessage(chat, { video: mp4, gifPlayback: true, mimetype: 'video/mp4', caption }, options);
          return 'gif';
        }
      } catch {
        /* lanjut ke fallback */
      }
    }

    // 2) Tanpa ffmpeg: stiker WebP animasi (sharp) — tetap bergerak di WhatsApp.
    try {
      const webp = await addExif(await videoToWebp(buffer, { seconds: Math.min(seconds, 8) }), {
        packname: config?.bot?.packname || '',
        author: config?.bot?.author || '',
      });
      if (webp?.length && webp.length <= MAX_STICKER_BYTES) {
        await conn.sendMessage(chat, { sticker: webp }, {});
        // Stiker tidak bisa ber-caption: kirim atribusi sebagai pesan terpisah.
        if (caption) await conn.sendMessage(chat, { text: caption }, options);
        return 'sticker';
      }
    } catch {
      /* lanjut ke gambar statis */
    }
  }

  await conn.sendMessage(chat, { image: buffer, caption }, options);
  return 'image';
}

export default { sendImageResult };
