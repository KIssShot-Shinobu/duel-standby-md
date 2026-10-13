/**
 * Anime search & detail via Jikan API.
 *   .anime <query>          -> cari anime
 *   .animeinfo <id>         -> detail lengkap
 *   .eps <id> [page]        -> daftar episode
 *   .themes <id>            -> tema lagu (OP/ED)
 *   .streaming <id>         -> tautan streaming legal
 *   .recs <id>              -> rekomendasi
 *   .reviews <id>           -> review user
 *   .chars <id>             -> karakter + VA
 *   .staff <id>             -> staff produksi
 *   .relations <id>         -> sequel/prequel/spin-off
 */
import * as Jikan from '../lib/jikan.js';
import * as Fmt from '../lib/jikan-format.js';
import { userError } from '../lib/errors.js';

const handler = async (m, { text, args, command, config }) => {
  const q = String(text || '').trim();

  try {
    // ── .anime <query> ──────────────────────────────────────────────────────
    if (/^anime$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}anime spy x family`);
      const data = await Jikan.searchAnime({ q, limit: 10 });
      return m.reply(Fmt.animeSearch(data));
    }

    // ── .animeinfo <id> ─────────────────────────────────────────────────────
    if (/^animeinfo$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}animeinfo 5114`);
      const data = await Jikan.getAnimeFull(q);
      return m.reply(Fmt.animeDetail(data?.data));
    }

    // ── .eps <id> [page] ────────────────────────────────────────────────────
    if (/^eps$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}eps 5114`);
      const [id, page] = q.split(/\s+/);
      const data = await Jikan.getAnimeEpisodes(id, Number(page) || 1);
      return m.reply(Fmt.animeEpisodes(data));
    }

    // ── .themes <id> ────────────────────────────────────────────────────────
    if (/^themes$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}themes 5114`);
      const data = await Jikan.getAnimeThemes(q);
      return m.reply(Fmt.animeThemes(data?.data));
    }

    // ── .streaming <id> ─────────────────────────────────────────────────────
    if (/^streaming$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}streaming 5114`);
      const data = await Jikan.getAnimeStreaming(q);
      return m.reply(Fmt.animeStreaming(data));
    }

    // ── .recs <id> ──────────────────────────────────────────────────────────
    if (/^recs$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}recs 5114`);
      const data = await Jikan.getAnimeRecommendations(q);
      return m.reply(Fmt.animeRecommendations(data));
    }

    // ── .reviews <id> ───────────────────────────────────────────────────────
    if (/^reviews$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}reviews 5114`);
      const data = await Jikan.getAnimeReviews(q);
      return m.reply(Fmt.animeReviews(data));
    }

    // ── .chars <id> ─────────────────────────────────────────────────────────
    if (/^chars$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}chars 5114`);
      const data = await Jikan.getAnimeCharacters(q);
      return m.reply(Fmt.animeCharacters(data));
    }

    // ── .staff <id> ─────────────────────────────────────────────────────────
    if (/^staff$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}staff 5114`);
      const data = await Jikan.getAnimeStaff(q);
      return m.reply(Fmt.animeStaff(data));
    }

    // ── .relations <id> ─────────────────────────────────────────────────────
    if (/^relations$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}relations 5114`);
      const data = await Jikan.getAnimeRelations(q);
      return m.reply(Fmt.animeRelations(data));
    }
  } catch (err) {
    throw userError(Fmt.errorMessage(err));
  }
};

handler.help = ['anime', 'animeinfo', 'eps', 'themes', 'streaming', 'recs', 'reviews', 'chars', 'staff', 'relations'];
handler.tags = ['anime'];
handler.command = /^(anime|animeinfo|eps|themes|streaming|recs|reviews|chars|staff|relations)$/i;
handler.limit = true;

export default handler;