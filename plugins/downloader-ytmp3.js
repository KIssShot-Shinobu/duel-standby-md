/**
 * Unduh audio YouTube (mp3) — butuh binary yt-dlp.
 *   .ytmp3 <link youtube | kata kunci>
 */
import ytsearch from 'yt-search';
import { hasYtDlp, ytDlpDownload } from '../lib/media.js';
import { isUrl, formatBytes, safeFileName } from '../lib/functions.js';

export async function resolveVideo(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Masukkan link YouTube atau kata kunci.');
  if (isUrl(value)) return { url: value, title: '' };
  const { videos } = await ytsearch(value);
  if (!videos?.length) throw new Error(`Tidak ditemukan video untuk "${value}".`);
  return { url: videos[0].url, title: videos[0].title, duration: videos[0].seconds };
}

const handler = async (m, { conn, text, config, usedPrefix }) => {
  if (!text) return m.reply(`Contoh: ${usedPrefix}ytmp3 https://youtu.be/xxxx`);
  if (!hasYtDlp(config.ytdlp.path)) {
    return m.reply(
      [
        '❌ *yt-dlp tidak ditemukan.*',
        '',
        'Plugin ini mengunduh audio langsung dari YouTube memakai yt-dlp (gratis, tanpa API key).',
        'Cara pasang:',
        '• Windows : winget install yt-dlp  (atau unduh yt-dlp.exe lalu taruh di PATH)',
        '• Termux  : pkg install python && pip install -U yt-dlp',
        '• VPS     : pip install -U yt-dlp  (atau apt install yt-dlp)',
        '',
        `Bisa juga set path manual di .env: YTDLP_PATH=/path/ke/yt-dlp`,
      ].join('\n'),
    );
  }

  const done = await m.reply(config.messages.wait);
  const video = await resolveVideo(text);
  const buffer = await ytDlpDownload(video.url, {
    format: 'audio',
    maxDuration: config.ytdlp.maxDurationSeconds,
    customPath: config.ytdlp.path,
  });

  const title = video.title || 'audio';
  await conn.sendAudio(m.chat, buffer, {
    ptt: false,
    mimetype: 'audio/mpeg',
    target: m,
    fileName: `${safeFileName(title)}.mp3`,
  });
  await conn.sendMessage(m.chat, { text: `🎵 *${title}*\n📦 ${formatBytes(buffer.length)}` }, { quoted: m });
  return buffer.length;
};

handler.help = ['ytmp3', 'yta'];
handler.tags = ['downloader'];
handler.command = /^(ytmp3|yta|ytaudio)$/i;
handler.limit = true;
handler.premium = false;

export default handler;
