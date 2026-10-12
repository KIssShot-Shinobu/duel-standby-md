/**
 * Cari video YouTube (tanpa API key).
 *   .yts dj terbaru
 */
import ytsearch from 'yt-search';

const handler = async (m, { text, config }) => {
  if (!text) return m.reply(`Contoh: ${config.bot.prefix[0]}yts judul lagu`);

  const { videos } = await ytsearch(text);
  if (!videos?.length) return m.reply('❌ Tidak ada hasil.');

  const rows = videos.slice(0, 5).map((video, index) =>
    [
      `*${index + 1}. ${video.title}*`,
      `   ⏱️ ${video.timestamp} • 👁️ ${video.views.toLocaleString('id-ID')}`,
      `   👤 ${video.author?.name || '-'}`,
      `   🔗 ${video.url}`,
    ].join('\n'),
  );

  return m.reply(`🔎 *Hasil pencarian:* ${text}\n\n${rows.join('\n\n')}\n\n💡 Unduh: ${config.bot.prefix[0]}ytmp3 <link> atau ${config.bot.prefix[0]}ytmp4 <link>`);
};

handler.help = ['yts', 'ytsearch'];
handler.tags = ['downloader'];
handler.command = /^(yts|ytsearch|youtubesearch)$/i;
handler.limit = true;

export default handler;
