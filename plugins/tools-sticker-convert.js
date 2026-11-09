/**
 * Stiker (termasuk yang bergerak) -> GIF WhatsApp / video MP4.
 *
 *   .togif  (reply stiker)  -> dikirim sebagai GIF (looping, tanpa suara)
 *   .tomp4  (reply stiker)  -> dikirim sebagai video biasa
 *
 * WhatsApp tidak memutar berkas `.gif` mentah; "GIF" di chat = video mp4
 * dengan `gifPlayback: true`. Jadi keduanya memakai konversi yang sama
 * (`webpToMp4`), bedanya hanya cara pengiriman.
 */
import { detectMediaKind, ffmpegInstallHint, hasFfmpeg, webpToMp4 } from '../lib/media.js';
import { loadMedia, pickMediaSource } from '../lib/media-source.js';
import { formatBytes } from '../lib/functions.js';
import { userError } from '../lib/errors.js';

const usage = (usedPrefix, command) =>
  [
    '❌ *Tidak ada stiker* pada pesan ini.',
    '',
    'Cara pakai:',
    `• Reply (geser) stiker lalu kirim *${usedPrefix}${command}*`,
    `• atau kirim stiker dengan caption *${usedPrefix}${command}*`,
    '',
    'Stiker bergerak jadi GIF/video; stiker diam jadi video 1 frame.',
  ].join('\n');

const handler = async (m, { conn, command, usedPrefix, config }) => {
  const source = pickMediaSource(m, { args: [], text: m.text });

  if (!source || source.kind === 'url') throw userError(usage(usedPrefix, command));

  const buffer = await loadMedia(source);
  if (!buffer?.length) throw userError('❌ Gagal mengunduh stiker (berkas kosong). Coba kirim ulang.');

  const { kind, mime } = await detectMediaKind(buffer);
  if (kind !== 'sticker' && mime !== 'image/webp') {
    throw userError(
      `❌ Itu bukan stiker (${mime || kind}).\nReply stiker, bukan gambar/video — untuk gambar/video pakai *${usedPrefix}sticker*.`,
    );
  }

  if (!hasFfmpeg()) {
    throw userError(`❌ Konversi stiker butuh ffmpeg:\n${ffmpegInstallHint({ check: false })}`);
  }

  const mp4 = await webpToMp4(buffer);
  if (!mp4?.length) throw userError('❌ Gagal mengubah stiker jadi video. Coba lagi.');
  if (mp4.length > config.media.maxUploadBytes) {
    throw userError(`❌ Hasil terlalu besar (${formatBytes(mp4.length)}) untuk dikirim WhatsApp.`);
  }

  const asGif = /^togif$/i.test(command);
  await conn.sendMessage(
    m.chat,
    {
      video: mp4,
      mimetype: 'video/mp4',
      caption: `${asGif ? '🎞️ GIF' : '🎬 MP4'} dari stiker • ${formatBytes(mp4.length)}`,
      ...(asGif ? { gifPlayback: true } : {}),
    },
    { quoted: m },
  );
  return true;
};

handler.help = ['togif', 'tomp4'];
handler.tags = ['tools'];
handler.command = /^(togif|tomp4)$/i;
handler.limit = true;

export default handler;
