/**
 * Character & People search via Jikan API.
 *   .char <query>           -> cari karakter
 *   .charinfo <id>          -> detail karakter
 *   .charanime <id>         -> anime yang diikuti karakter
 *   .charva <id>            -> voice actor karakter
 *   .va <query>             -> cari voice actor
 *   .vainfo <id>            -> detail VA
 *   .vaanime <id>           -> anime yang di-VA
 */
import * as Jikan from '../lib/jikan.js';
import * as Fmt from '../lib/jikan-format.js';
import { userError } from '../lib/errors.js';

const handler = async (m, { text, command, config }) => {
  const q = String(text || '').trim();

  try {
    if (/^char$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}char levi ackerman`);
      const data = await Jikan.searchCharacters({ q, limit: 10 });
      return m.reply(Fmt.characterSearch(data));
    }

    if (/^charinfo$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}charinfo 80`);
      const data = await Jikan.getCharacterFull(q);
      return m.reply(Fmt.characterDetail(data?.data));
    }

    if (/^charanime$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}charanime 80`);
      const data = await Jikan.getCharacterAnime(q);
      return m.reply(Fmt.characterAnime(data));
    }

    if (/^charva$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}charva 80`);
      const data = await Jikan.getCharacterVoices(q);
      return m.reply(Fmt.characterVoices(data));
    }

    if (/^va$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}va miyuki sawashiro`);
      const data = await Jikan.searchPeople({ q, limit: 10 });
      return m.reply(Fmt.personSearch(data));
    }

    if (/^vainfo$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}vainfo 11`);
      const data = await Jikan.getPersonFull(q);
      return m.reply(Fmt.personDetail(data?.data));
    }

    if (/^vaanime$/i.test(command)) {
      if (!q) return m.reply(`Contoh: ${config.bot.prefix[0]}vaanime 11`);
      const data = await Jikan.getPersonAnime(q);
      return m.reply(Fmt.characterAnime(data));
    }
  } catch (err) {
    throw userError(Fmt.errorMessage(err));
  }
};

handler.help = ['char', 'charinfo', 'charanime', 'charva', 'va', 'vainfo', 'vaanime'];
handler.tags = ['anime'];
handler.command = /^(char|charinfo|charanime|charva|va|vainfo|vaanime)$/i;
handler.limit = true;

export default handler;