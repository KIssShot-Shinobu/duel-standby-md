/**
 * Jikan API v4 - Seasonal / Schedule / Top / Random / MAL user.
 *
 * Rate limit Jikan: 60 req/menit, 3 req/detik.
 * Semua respons diformat natural dalam Bahasa Indonesia.
 *
 * Catatan pembagian plugin:
 *  - jikan-anime.js  -> anime, animeinfo, eps, themes, streaming, recs, reviews, chars, staff, relations
 *  - jikan-manga.js  -> manga, mangainfo, mangachars, mangarecs, mangareviews
 *  - jikan-char.js   -> char, charinfo, charanime, charva, va, vainfo, vaanime
 *  - jikan.js (ini)  -> seasonal, jadwal, topmal, random, maluser, animelist, mangalist, malfav, malstats
 *
 * Command di file ini sengaja tidak tumpang-tindih dengan plugin split di atas.
 * `.top` milik rpg-leaderboard.js (peringkat saldo/level), jadi ranking Jikan
 * memakai `.topmal` supaya tidak bentrok.
 *
 * Perintah:
 *   .seasonal [now|upcoming|YYYY season]   .jadwal
 *   .topmal anime|manga|chars|people [filter]
 *   .random anime|manga|char
 *   .maluser <user>        .malfav <user>       .malstats <user>
 *   .animelist <user> [status]
 *   .mangalist <user> [status]
 */
import * as Jikan from '../lib/jikan.js';
import * as Fmt from '../lib/jikan-format.js';
import { userError } from '../lib/errors.js';

const replyOrError = (m, p) =>
  p.catch((err) => m.reply(Fmt.errorMessage(err)));

const handler = async (m, { text, args, command, config }) => {
  const q = String(text || '').trim();
  const p = config.bot.prefix[0];
  const id = q.split(/\s+/)[0] || '';
  const extra = q.split(/\s+/).slice(1).join(' ');

  try {
    // ── SEASONAL & SCHEDULE ────────────────────────────────────────────────
    if (command === 'seasonal') {
      if (!q || q === 'now') {
        return replyOrError(m, Jikan.getSeasonNow().then((d) => m.reply(Fmt.seasonal(d))));
      }
      if (q === 'upcoming') {
        return replyOrError(m, Jikan.getSeasonUpcoming().then((d) => m.reply(Fmt.seasonal(d))));
      }
      // .seasonal 2025 winter
      const [year, season] = q.split(/\s+/);
      if (year && season) {
        return replyOrError(m, Jikan.getSeason(year, season).then((d) => m.reply(Fmt.seasonal(d))));
      }
      return m.reply(`Contoh: ${p}seasonal now | ${p}seasonal upcoming | ${p}seasonal 2025 winter`);
    }

    if (command === 'jadwal') {
      return replyOrError(m, Jikan.getSchedules().then((d) => m.reply(Fmt.schedule(d))));
    }

    // ── TOP (nama command .topmal, karena .top dipakai rpg-leaderboard) ────
    if (command === 'topmal') {
      const [cat, filter] = q.split(/\s+/);
      if (!cat) return m.reply(`Contoh: ${p}topmal anime | ${p}topmal manga | ${p}topmal chars | ${p}topmal people`);
      if (cat === 'anime') {
        return replyOrError(m, Jikan.getTopAnime({ filter: filter === 'bypopularity' || filter === 'byfavorites' ? filter : undefined, limit: 15 }).then((d) => m.reply(Fmt.topAnime(d))));
      }
      if (cat === 'manga') {
        return replyOrError(m, Jikan.getTopManga({ filter: filter === 'bypopularity' || filter === 'byfavorites' ? filter : undefined, limit: 15 }).then((d) => m.reply(Fmt.topManga(d))));
      }
      if (cat === 'chars') {
        return replyOrError(m, Jikan.getTopCharacters().then((d) => m.reply(Fmt.topCharacters(d))));
      }
      if (cat === 'people') {
        return replyOrError(m, Jikan.getTopPeople().then((d) => m.reply(Fmt.topPeople(d))));
      }
      return m.reply(`Kategori: anime, manga, chars, people`);
    }

    // ── RANDOM ──────────────────────────────────────────────────────────────
    if (command === 'random') {
      if (q === 'anime') return replyOrError(m, Jikan.getRandomAnime().then((d) => m.reply(Fmt.randomAnime(d))));
      if (q === 'manga') return replyOrError(m, Jikan.getRandomManga().then((d) => m.reply(Fmt.randomManga(d))));
      if (q === 'char') return replyOrError(m, Jikan.getRandomCharacter().then((d) => m.reply(Fmt.randomCharacter(d))));
      return m.reply(`Contoh: ${p}random anime | ${p}random manga | ${p}random char`);
    }

    // ── USER ────────────────────────────────────────────────────────────────
    if (command === 'maluser') {
      if (!q) return m.reply(`Contoh: ${p}maluser <username>`);
      return replyOrError(m, Jikan.getUserFull(q).then((d) => m.reply(Fmt.userProfile(d?.data))));
    }

    if (command === 'animelist') {
      if (!q) return m.reply(`Contoh: ${p}animelist <username> [watching|completed|onhold|dropped|plantowatch]`);
      return replyOrError(m, Jikan.getUserAnimeList(id, { status: extra || undefined, limit: 15 }).then((d) => m.reply(Fmt.userAnimeList(d))));
    }

    if (command === 'mangalist') {
      if (!q) return m.reply(`Contoh: ${p}mangalist <username> [reading|completed|onhold|dropped|plantoread]`);
      return replyOrError(m, Jikan.getUserMangaList(id, { status: extra || undefined, limit: 15 }).then((d) => m.reply(Fmt.userMangaList(d))));
    }

    if (command === 'malfav') {
      if (!q) return m.reply(`Contoh: ${p}malfav <username>`);
      return replyOrError(m, Jikan.getUserFavorites(q).then((d) => m.reply(Fmt.userFavorites(d?.data))));
    }

    if (command === 'malstats') {
      if (!q) return m.reply(`Contoh: ${p}malstats <username>`);
      return replyOrError(m, Jikan.getUserStatistics(q).then((d) => m.reply(Fmt.userStatistics(d?.data))));
    }
  } catch (err) {
    throw userError(Fmt.errorMessage(err));
  }
};

handler.help = ['seasonal', 'jadwal', 'topmal', 'random', 'maluser', 'animelist', 'mangalist', 'malfav', 'malstats'];
handler.tags = ['anime'];
handler.command = /^(seasonal|jadwal|topmal|random|maluser|animelist|mangalist|malfav|malstats)$/i;
handler.limit = true;

export default handler;
