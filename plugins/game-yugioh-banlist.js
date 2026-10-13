/**
 * Daftar banlist Yu-Gi-Oh!.
 *   .banlist          -> TCG
 *   .banlist ocg
 *   .banlist goat
 */
import { getClient, formatYgoError } from '../lib/ygoprodeck.js';
import { chunkText } from '../lib/functions.js';

const MAX_PER_GROUP = 25;
const LABEL = { tcg: 'TCG', ocg: 'OCG', goat: 'GOAT' };
/**
 * Status asli dari API: "Forbidden", "Limited", "Semi-Limited" (TCG).
 * "Banned" disertakan juga untuk format/format lain yang memakai istilah itu.
 */
const ICON = { Forbidden: '⛔', Banned: '⛔', Limited: '1️⃣', 'Semi-Limited': '2️⃣' };
const ORDER = { Forbidden: 0, Banned: 0, Limited: 1, 'Semi-Limited': 2 };

const handler = async (m, { text, config, usedPrefix, command }) => {
  const format = String(text || 'tcg').trim().toLowerCase();
  if (!['tcg', 'ocg', 'goat'].includes(format)) {
    return m.reply(`Format tersedia: tcg, ocg, goat.\nContoh: ${usedPrefix}${command} ocg`);
  }

  const ygo = getClient(config);
  let payload;
  try {
    payload = await ygo.card({ banlist: format, num: '500', sort: 'name' });
  } catch (err) {
    return m.reply(formatYgoError(err));
  }

  const cards = payload.data || [];
  if (!cards.length) return m.reply(`Tidak ada kartu pada banlist ${format.toUpperCase()}.`);

  const key = `ban_${format}`;
  const groups = new Map();
  for (const card of cards) {
    const status = card.banlist_info?.[key] || 'Lainnya';
    if (!groups.has(status)) groups.set(status, []);
    groups.get(status).push(card.name);
  }

  const statuses = [...groups.keys()];
  const sections = [...groups.entries()]
    .sort((a, b) => (ORDER[a[0]] ?? 99) - (ORDER[b[0]] ?? 99) || a[0].localeCompare(b[0]))
    .map(([status, names]) => {
      const shown = names.slice(0, MAX_PER_GROUP);
      const more = names.length > shown.length ? `\n   _…dan ${names.length - shown.length} lainnya_` : '';
      return `${ICON[status] || '•'} *${status}* (${names.length})\n${shown.map((name) => `   • ${name}`).join('\n')}${more}`;
    });

  const body = [
    `🚫 *BANLIST ${LABEL[format]}*`,
    `Total kartu terdaftar: *${cards.length}*`,
    `Status: ${statuses.map((status) => `${status} (${groups.get(status).length})`).join(' • ')}`,
    '',
    ...sections,
    '',
    `_Data: YGOPRODeck API. Cek format lain: ${usedPrefix}${command} ocg / goat_`,
  ].join('\n');

  for (const chunk of chunkText(body, 3500)) await m.reply(chunk);
  return cards.length;
};

handler.help = ['banlist'];
handler.tags = ['game'];
handler.command = /^(banlist|ygobanlist)$/i;
handler.limit = true;

export default handler;
