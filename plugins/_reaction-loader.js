/**
 * Tampilkan reaction loading (⏳) untuk command yang butuh waktu jaringan/proses.
 */
const SLOW = new Set([
  'ai-chat.js',
  'anime-quote.js',
  'downloader-tiktok.js',
  'downloader-ytmp3.js',
  'downloader-ytmp4.js',
  'downloader-ytsearch.js',
  'game-yugioh-archetype.js',
  'game-yugioh-art-select.js',
  'game-yugioh-art.js',
  'game-yugioh-banlist.js',
  'game-yugioh-effect.js',
  'game-yugioh-guess.js',
  'game-yugioh-image.js',
  'game-yugioh-random.js',
  'game-yugioh-search.js',
  'game-yugioh-set.js',
  'game-yugioh.js',
  'jikan-anime.js',
  'jikan-char.js',
  'jikan-manga.js',
  'jikan.js',
  'main-info.js',
  'nsfw-image.js',
  'reaction-gif.js',
  'sfw-image.js',
  'sticker-smeme.js',
  'tools-sticker.js',
  'tools-toimg.js',
  'tools-tomp3.js',
  'tools-tovn.js',
]);

const handler = {};
handler.before = async (m, ctx) => {
  const plugins = ctx?.plugins;
  const parsed = ctx?.parsed || (ctx?.command ? { command: ctx.command } : null);
  // Cari entry plugin yang cocok
  const entry = plugins?.find?.(parsed?.command || ctx?.command);
  if (!entry) return true;
  if (!SLOW.has(entry.name)) return true;
  if (m.isGroup === false && m.fromMe) return true;
  try { await m.react?.('⏳'); } catch {}
  return true;
};

export default handler;
