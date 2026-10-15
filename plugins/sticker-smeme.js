/**
 * Stiker meme (teks atas/bawah di atas gambar).
 *
 *   .smeme teks atas|teks bawah      -> kirim gambar + caption ini
 *   .smeme teks atas|teks bawah      -> atau reply gambar/GIF milik siapa pun
 *   .smeme teks atas                 -> hanya teks atas
 *   .smeme |teks bawah               -> hanya teks bawah
 *
 * Di project asli (RTXZY-MD) fitur ini mengunggah gambarmu ke API pihak ketiga
 * lalu menyuruh memegen.link merender meme-nya. Di sini dirender LOKAL dengan
 * ffmpeg drawtext: tidak ada gambar yang dikirim ke layanan lain.
 */
import { drawMemeText, hasDrawtext, resolveFont, webpEncoder } from '../lib/media.js';
import { loadMedia, pickMediaSource } from '../lib/media-source.js';
import { safeUnlink } from '../lib/functions.js';
import { userError } from '../lib/errors.js';

const handler = async (m, { conn, text, command, usedPrefix, config }) => {
  const raw = String(text || '').trim();
  if (!raw) {
    throw userError(
      [
        '❌ Teks meme belum diisi.',
        '',
        `Format: *${usedPrefix}${command} teks atas|teks bawah*`,
        `Contoh: ${usedPrefix}${command} GAME OVER|aku menyerah`,
        '',
        'Kirim gambar dengan caption itu, atau reply gambar/GIF lalu kirim perintahnya.',
      ].join('\n'),
    );
  }

  const [top = '', bottom = ''] = raw.split('|');
  // Sumber gambar: pesan yang di-reply, atau gambar yang dikirim bersama perintah.
  const source = pickMediaSource(m, { args: [], text: '' });

  if (!source) {
    throw userError(
      [
        '❌ *Tidak ada gambar* untuk dijadikan meme.',
        '',
        `Cara pakai: kirim foto/GIF dengan caption *${usedPrefix}${command} atas|bawah*`,
        `atau reply (geser) foto/GIF milik siapa pun lalu kirim *${usedPrefix}${command} atas|bawah*`,
      ].join('\n'),
    );
  }

  if (!webpEncoder()) {
    throw userError('❌ Server belum punya encoder WebP (pasang `apt install ffmpeg`).');
  }
  if (!hasDrawtext()) {
    throw userError('❌ ffmpeg di server tidak punya filter *drawtext*, jadi teks meme tidak bisa digambar.\nPasang ffmpeg lengkap: `apt install ffmpeg`.');
  }
  if (!resolveFont(config.media?.fontPath || '')) {
    throw userError(
      [
        '❌ Berkas font tidak ditemukan, teks tidak bisa digambar.',
        '',
        'Pasang font di server: `apt install fonts-dejavu-core`',
        'atau set lokasi font di `.env`:',
        '```',
        'FFMPEG_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '```',
      ].join('\n'),
    );
  }

  await m.reply(config.messages.stickerWait);

  const buffer = await loadMedia(source);
  if (!buffer?.length) throw userError(`❌ Gagal mengunduh ${source.label} (berkas kosong).`);

  const png = await drawMemeText(buffer, {
    top: top.trim(),
    bottom: bottom.trim(),
    fontPath: config.media?.fontPath || '',
    size: 512,
  });

  const file = await conn.sendImageAsSticker(m.chat, png, m, {
    packname: config.bot.packname,
    author: config.bot.author,
  });
  safeUnlink(file);
  return true;
};

handler.help = ['smeme', 'stikermeme'];
handler.tags = ['tools'];
handler.command = /^(s(tic?ker)?me(me)?|memesticker|stikermeme)$/i;
handler.limit = true;

export default handler;
