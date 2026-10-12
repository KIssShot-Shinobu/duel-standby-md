/**
 * Unduh video TikTok tanpa watermark (endpoint publik tikwm.com).
 *
 * Catatan jujur: ini endpoint pihak ketiga gratis, bisa berubah/limit kapan saja.
 * Kalau gagal, bot akan menampilkan pesan error yang jelas (bukan crash).
 *
 *   .tiktok https://www.tiktok.com/@user/video/123
 */
import { fetchJson, formatBytes, isUrl } from '../lib/functions.js';

const ENDPOINT = 'https://www.tikwm.com/api/';

const handler = async (m, { conn, text, config, usedPrefix }) => {
  const url = text?.split(/\s+/)[0] || m.quoted?.text?.split(/\s+/)[0];
  if (!url || !isUrl(url)) return m.reply(`Contoh: ${usedPrefix}tiktok https://www.tiktok.com/@user/video/123`);
  if (!/tiktok\.com|douyin\.com|vt\.tiktok/i.test(url)) return m.reply('Link itu bukan TikTok.');

  await m.reply(config.messages.wait);
  const json = await fetchJson(`${ENDPOINT}?url=${encodeURIComponent(url)}&hd=1`, { timeout: 45000 });
  if (json?.code !== 0 || !json?.data) throw new Error(json?.msg || 'Gagal mengambil data TikTok');

  const data = json.data;
  const mediaUrl = data.hdplay || data.play;
  if (!mediaUrl) throw new Error('Tidak ada URL video pada respons.');

  const caption = [
    `🎵 *${data.title || 'TikTok'}*`,
    data.author?.nickname ? `👤 ${data.author.nickname}` : null,
    `⏱️ ${data.duration || 0}s • 👁️ ${data.play_count ?? '-'} • ❤️ ${data.digg_count ?? '-'}`,
    data.music_info?.title ? `🎧 ${data.music_info.title}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const buffer = Buffer.from(await (await fetch(mediaUrl)).arrayBuffer());
  await conn.sendVideo(m.chat, buffer, caption, m);
  return formatBytes(buffer.length);
};

handler.help = ['tiktok', 'tt'];
handler.tags = ['downloader'];
handler.command = /^(tiktok|tt|ttdl)$/i;
handler.limit = true;

export default handler;
