/**
 * Unduh video YouTube (mp4, maks 720p) — butuh binary yt-dlp.
 *   .ytmp4 <link youtube | kata kunci>
 */
import { hasYtDlp, ytDlpDownload } from '../lib/media.js';
import { formatBytes } from '../lib/functions.js';
import { resolveVideo } from './downloader-ytmp3.js';

const handler = async (m, { conn, text, config, usedPrefix }) => {
  if (!text) return m.reply(`Contoh: ${usedPrefix}ytmp4 https://youtu.be/xxxx`);
  if (!hasYtDlp(config.ytdlp.path)) {
    return m.reply('❌ *yt-dlp tidak ditemukan.* Pasang dulu (lihat README bagian "yt-dlp") atau set YTDLP_PATH di .env.');
  }

  await m.reply(config.messages.wait);
  const video = await resolveVideo(text);
  const buffer = await ytDlpDownload(video.url, {
    format: 'video',
    maxDuration: config.ytdlp.maxDurationSeconds,
    customPath: config.ytdlp.path,
  });

  await conn.sendVideo(m.chat, buffer, `🎬 ${video.title || 'video'}\n📦 ${formatBytes(buffer.length)}`, m);
  return buffer.length;
};

handler.help = ['ytmp4', 'ytv'];
handler.tags = ['downloader'];
handler.command = /^(ytmp4|ytv|ytvideo)$/i;
handler.limit = true;

export default handler;
