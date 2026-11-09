/**
 * Stiker -> format lain.
 *
 *   .togif  (reply stiker)  -> GIF WhatsApp (looping, tanpa suara)
 *   .tomp4  (reply stiker)  -> video MP4
 *   .topng  (reply stiker)  -> gambar PNG
 *   .tojpg  (reply stiker)  -> gambar JPG (latar transparan jadi putih)
 *
 * WhatsApp tidak memutar berkas `.gif` mentah; "GIF" di chat = video mp4
 * dengan `gifPlayback: true`. Stiker bergerak hanya diambil frame pertamanya
 * untuk PNG/JPG.
 */
import { detectMediaKind, ffmpegInstallHint, hasFfmpeg, webpToJpeg, webpToMp4, webpToPng } from '../lib/media.js';
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
    'Perintah: .togif, .tomp4, .topng, .tojpg',
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

  const cmd = String(command || '').toLowerCase();
  const asVideo = cmd === 'togif' || cmd === 'tomp4';

  if (asVideo && !hasFfmpeg()) {
    throw userError(`❌ Konversi stiker ke video butuh ffmpeg:\n${ffmpegInstallHint({ check: false })}`);
  }

  let out;
  let payload;

  if (asVideo) {
    out = await webpToMp4(buffer);
    if (!out?.length) throw userError('❌ Gagal mengubah stiker jadi video. Coba lagi.');
    payload = {
      video: out,
      mimetype: 'video/mp4',
      caption: `${cmd === 'togif' ? '🎞️ GIF' : '🎬 MP4'} dari stiker • ${formatBytes(out.length)}`,
      ...(cmd === 'togif' ? { gifPlayback: true } : {}),
    };
  } else if (cmd === 'topng') {
    out = await webpToPng(buffer);
    if (!out?.length) throw userError('❌ Gagal mengubah stiker jadi PNG. Coba lagi.');
    payload = { image: out, mimetype: 'image/png', caption: `🖼️ PNG dari stiker • ${formatBytes(out.length)}` };
  } else {
    out = await webpToJpeg(buffer);
    if (!out?.length) throw userError('❌ Gagal mengubah stiker jadi JPG. Coba lagi.');
    payload = { image: out, mimetype: 'image/jpeg', caption: `🖼️ JPG dari stiker • ${formatBytes(out.length)}` };
  }

  if (out.length > config.media.maxUploadBytes) {
    throw userError(`❌ Hasil terlalu besar (${formatBytes(out.length)}) untuk dikirim WhatsApp.`);
  }

  await conn.sendMessage(m.chat, payload, { quoted: m });
  return true;
};

handler.help = ['togif', 'tomp4', 'topng', 'tojpg'];
handler.tags = ['tools'];
handler.command = /^(togif|tomp4|topng|tojpg)$/i;
handler.limit = true;

export default handler;
