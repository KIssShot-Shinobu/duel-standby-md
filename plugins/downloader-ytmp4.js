/**
 * Unduh video YouTube (mp4) memakai yt-dlp — tanpa API key.
 *   .ytmp4 <link youtube | kata kunci>
 *
 * Format yang dipakai adalah "progressive" (audio+video sudah menyatu) supaya
 * tidak butuh proses merge ffmpeg saat mengunduh, jadi tetap jalan di panel
 * yang ffmpeg-nya terbatas.
 */
import { hasFfmpeg, hasYtDlp, ytDlpDownload, ytDlpInstallHint } from '../lib/media.js';
import { formatBytes, shortClock } from '../lib/functions.js';
import { resolveVideo } from './downloader-ytmp3.js';

const handler = async (m, { conn, text, config, usedPrefix }) => {
  if (!text) return m.reply(`Contoh: ${usedPrefix}ytmp4 https://youtu.be/xxxx`);

  if (!hasYtDlp(config.ytdlp.path)) {
    return m.reply(ytDlpInstallHint(config));
  }

  const done = await m.reply(config.messages.wait);
  const video = await resolveVideo(text, config);

  let buffer;
  try {
    buffer = await ytDlpDownload(video.url, {
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
          'Video YouTube sekarang umumnya menyimpan video & audio terpisah, jadi butuh ffmpeg untuk menggabungkannya.',
          `Pasang ffmpeg di server, atau pakai *${config.bot.prefix[0]}ytmp3* untuk audio saja.`,
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
    [`🎬 *${video.title || 'video'}*`, video.duration ? `⏱️ ${shortClock(video.duration * 1000)}` : null, `📦 ${formatBytes(buffer.length)} • maks ${config.ytdlp.maxHeight}p`]
      .filter(Boolean)
      .join('\n'),
    m,
  );

  if (done) await done('✅ Video terkirim.');
  return buffer.length;
};

handler.help = ['ytmp4', 'ytv'];
handler.tags = ['downloader'];
handler.command = /^(ytmp4|ytv|ytvideo)$/i;
handler.limit = true;

export default handler;
