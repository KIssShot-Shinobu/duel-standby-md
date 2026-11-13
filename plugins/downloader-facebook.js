/**
 * Unduh video Facebook (mp4) memakai yt-dlp — tanpa API key.
 *   .fb <link facebook | fb.watch | fb.com | facebook.com>
 *
 * yt-dlp mendukung banyak format Facebook: video publik, reel, watch, dll.
 * Format yang dipakai adalah "progressive" (audio+video sudah menyatu) supaya
 * tidak butuh proses merge ffmpeg saat mengunduh, jadi tetap jalan di panel
 * yang ffmpeg-nya terbatas.
 */
import { hasFfmpeg, hasYtDlp, ytDlpDownload, ytDlpInstallHint } from '../lib/media.js';
import { formatBytes, shortClock } from '../lib/functions.js';

const FB_URL_REGEX = /(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com|mbasic\.facebook\.com)\/[^\s]+/i;

const handler = async (m, { conn, text, config, usedPrefix, wait }) => {
  if (!text) return m.reply(`Contoh: ${usedPrefix}fb https://www.facebook.com/watch?v=xxxx`);

  const url = text.trim().split(/\s+/)[0];
  if (!FB_URL_REGEX.test(url)) return m.reply('Link itu bukan Facebook. Gunakan link facebook.com, fb.watch, atau fb.com');

  if (!hasYtDlp(config.ytdlp.path)) {
    return m.reply(ytDlpInstallHint(config));
  }

  // wait() mengirim pesan tunggu dan mengembalikan fungsi untuk mengeditnya.
  const update = await wait();

  let buffer;
  try {
    buffer = await ytDlpDownload(url, {
      format: 'video',
      height: config.ytdlp.maxHeight,
      maxDuration: config.ytdlp.maxDurationSeconds,
      customPath: config.ytdlp.path,
    });
  } catch (err) {
    if (!hasFfmpeg()) {
      throw new Error(
        [
          err.message,
          '',
          '⚠️ *ffmpeg tidak terdeteksi di server.*',
          'Video Facebook modern biasanya menyimpan video & audio terpisah, jadi butuh ffmpeg untuk menggabungkannya.',
          `Pasang ffmpeg di server, atau turunkan kualitas lewat env \`YTDLP_MAX_HEIGHT\` (sekarang ${config.ytdlp.maxHeight}p).`,
        ].join('\n'),
      );
    }
    throw err;
  }

  if (buffer.length > config.media.maxUploadBytes) {
    throw new Error(
      `File terlalu besar (${formatBytes(buffer.length)}) untuk dikirim WhatsApp.\n💡 Turunkan kualitas lewat env \`YTDLP_MAX_HEIGHT\` (sekarang ${config.ytdlp.maxHeight}p).`,
    );
  }

  await conn.sendVideo(
    m.chat,
    buffer,
    [
      `📘 *Facebook Video*`,
      `📦 ${formatBytes(buffer.length)} • maks ${config.ytdlp.maxHeight}p`,
    ]
      .filter(Boolean)
      .join('\n'),
    m,
  );

  if (typeof update === 'function') await update('✅ Video Facebook terkirim.');
  return buffer.length;
};

handler.help = ['fb', 'facebook', 'fbdl'];
handler.tags = ['downloader'];
handler.command = /^(fb|facebook|fbdl)$/i;
handler.limit = true;

export default handler;