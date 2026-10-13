/**
 * Manga search & detail via Jikan API.
 *   .manga <query>          -> cari manga
 *   .mangainfo <id>         -> detail lengkap
 *   .mangachars <id>        -> karakter
 *   .mangarecs <id>         -> rekomendasi
 *   .mangareviews <id>      -> review user
 */
import * as Jikan from '../lib/jikan.js';
import * as Fmt from '../lib/jikan-format.js';
import { userError } from '../lib/errors.js';

const handler = async (m, { text, command, config }) => {
  const q = String(text || '').trim();

  try {
    if (/^manga$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}manga one piece`);
      const data = await Jikan.searchManga({ q, limit: 10 });
      return m.reply(Fmt.mangaSearch(data));
    }

    if (/^mangainfo$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}mangainfo 13`);
      const data = await Jikan.getMangaFull(q);
      return m.reply(Fmt.mangaDetail(data?.data));
    }

    if (/^mangachars$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}mangachars 13`);
      const data = await Jikan.getMangaCharacters(q);
      return m.reply(Fmt.mangaCharacters(data));
    }

    if (/^mangarecs$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}mangarecs 13`);
      const data = await Jikan.getMangaRecommendations(q);
      return m.reply(Fmt.animeRecommendations(data));
    }

    if (/^mangareviews$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}mangareviews 13`);
      const data = await Jikan.getMangaReviews(q);
      return m.reply(Fmt.animeReviews(data));
    }
  } catch (err) {
    throw userError(Fmt.errorMessage(err));
  }
};

handler.help = ['manga', 'mangainfo', 'mangachars', 'mangarecs', 'mangareviews'];
handler.tags = ['anime'];
handler.command = /^(manga|mangainfo|mangachars|mangarecs|mangareviews)$/i;
handler.limit = true;

export default handler;