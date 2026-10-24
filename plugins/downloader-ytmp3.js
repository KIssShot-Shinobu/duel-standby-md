/**
 * Unduh audio YouTube (mp3) memakai yt-dlp — tanpa API key.
 *   .ytmp3 <link youtube | kata kunci>
 *
 * Cara kerja:
 *   1. yt-dlp mengambil stream audio asli (m4a/webm) ke stdout — tidak butuh
 *      post-processing ffmpeg saat mengunduh.
 *   2. Kalau ffmpeg tersedia, audio dikonversi ke mp3 di bot.
 *      Kalau tidak ada, file dikirim apa adanya (m4a) — tetap bisa diputar.
 */
import ytsearch from 'yt-search';
import { hasFfmpeg, hasYtDlp, toAudio, ytDlpDownload, ytDlpInfo, ytDlpInstallHint } from '../lib/media.js';
import { formatBytes, isUrl, isYoutubeUrl, safeFileName, shortClock } from '../lib/functions.js';
import { ok, err, joinLines, thinking, resultText } from '../lib/messages.js';

const AUDIO_MIME = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

/** Tebak jenis audio dari magic bytes. */
export function audioExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return 'm4a';
  if (buffer.subarray(0, 3).toString() === 'ID3') return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';
  if (buffer.subarray(4, 8).toString() === 'ftyp') return 'm4a';
  if (buffer.subarray(0, 4).toString() === 'OggS') return 'ogg';
  if (buffer.subarray(0, 4).toString() === 'RIFF') return 'wav';
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'webm';
  return 'm4a';
}

/** Terima link YouTube atau kata kunci; kembalikan { url, title, duration }. */
export async function resolveVideo(input, config) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Masukkan link YouTube atau kata kunci.');

  if (isUrl(value) && !isYoutubeUrl(value)) throw new Error('Hanya link YouTube yang didukung.');
  if (isUrl(value)) {
    if (hasYtDlp(config?.ytdlp?.path)) {
      const info = await ytDlpInfo(value, { customPath: config?.ytdlp?.path }).catch(() => null);
      if (info) return { url: value, title: info.title, duration: info.duration };
    }
    return { url: value, title: '' };
  }

  const { videos } = await ytsearch(value);
  if (!videos?.length) throw new Error(`Tidak ditemukan video untuk "${value}".`);
  const [video] = videos;
  return { url: video.url, title: video.title, duration: video.seconds };
}

const handler = async (m, { conn, text, config, usedPrefix, wait }) => {
  if (!text) return m.reply(err(`Contoh: ${usedPrefix}ytmp3 https://youtu.be/xxxx`, m));

  if (!hasYtDlp(config.ytdlp.path)) {
    return m.reply(ytDlpInstallHint(config));
  }

  const update = await wait(thinking());
  const video = await resolveVideo(text, config);

  const raw = await ytDlpDownload(video.url, {
    format: 'audio',
    maxDuration: config.ytdlp.maxDurationSeconds,
    customPath: config.ytdlp.path,
  });

  let buffer = raw;
  let ext = audioExtension(raw);
  let converted = false;

  if (ext !== 'mp3' && hasFfmpeg()) {
    try {
      buffer = await toAudio(raw);
      ext = 'mp3';
      converted = true;
    } catch {
      /* gagal konversi -> kirim format asli */
    }
  }

  if (buffer.length > config.media.maxUploadBytes) {
    throw new Error(`File terlalu besar (${formatBytes(buffer.length)}) buat dikirim WhatsApp.`);
  }

  await conn.sendAudio(m.chat, buffer, {
    ptt: false,
    mimetype: AUDIO_MIME[ext] || 'audio/mpeg',
    target: m,
  });

  const summary = resultText(video.title || 'Audio', {
    duration: video.duration ? shortClock(video.duration * 1000) : null,
    size: formatBytes(buffer.length),
    format: ext.toUpperCase() + (converted ? ` (dikonversi dari ${audioExtension(raw)})` : ''),
    note: !converted && ext !== 'mp3' ? 'ffmpeg gak ada, file dikirim apa adanya.' : null,
  });

  if (typeof update === 'function') await update(summary);
  else await m.reply(summary);
  return buffer.length;
};

handler.help = ['ytmp3', 'yta'];
handler.tags = ['downloader'];
handler.command = /^(ytmp3|yta|ytaudio)$/i;
handler.limit = true;

export default handler;
