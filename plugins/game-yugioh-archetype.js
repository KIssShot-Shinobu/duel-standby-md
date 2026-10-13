/**
 * Daftar kartu dalam sebuah archetype.
 *   .archetype Blue-Eyes
 *   .archetypes              -> daftar semua archetype yang tersedia
 */
import { getClient, formatCardLine, formatYgoError } from '../lib/ygoprodeck.js';
import { chunkText } from '../lib/functions.js';

const MAX_RESULTS = 20;

const handler = async (m, { text, config, usedPrefix, command }) => {
  const name = String(text || '').trim();
  const ygo = getClient(config);

  // Tanpa argumen -> daftar semua archetype
  if (!name) {
    let list;
    try {
      list = await ygo.archetypes();
    } catch (err) {
      return m.reply(formatYgoError(err));
    }
    const names = (list || []).map((item) => item.archetype_name || item.archetype).filter(Boolean);
    if (!names.length) return m.reply('❌ Daftar archetype kosong.');

    const body = [`🏷️ *DAFTAR ARCHETYPE* (${names.length})`, '', names.join(', ')].join('\n');
    for (const chunk of chunkText(body, 3500)) await m.reply(chunk);
    return names.length;
  }

  let payload;
  try {
    payload = await ygo.card({ archetype: name, num: String(MAX_RESULTS), sort: 'name' });
  } catch (err) {
    return m.reply(formatYgoError(err));
  }

  const cards = payload.data || [];
  const total = payload.meta?.total_rows ?? cards.length;
  if (!cards.length) return m.reply(`❌ Tidak ada kartu untuk archetype *${name}*.`);

  const monsters = cards.filter((card) => /Monster/.test(card.type || '')).length;
  const spells = cards.filter((card) => card.type === 'Spell Card').length;
  const traps = cards.filter((card) => card.type === 'Trap Card').length;

  const lines = [
    `🏷️ *ARCHETYPE ${name.toUpperCase()}*`,
    `📦 Total: *${total}* kartu`,
    `🐲 Monster: ${monsters} • ✨ Spell: ${spells} • 🕸️ Trap: ${traps}`,
    '',
    ...cards.map((card, index) => formatCardLine(card, index)),
    total > cards.length ? `\n_Menampilkan ${cards.length} dari ${total}. Pakai ${usedPrefix}ygosearch archetype="${name}" num=15 untuk melihat lainnya._` : '',
  ].filter(Boolean);

  for (const chunk of chunkText(lines.join('\n'), 3500)) await m.reply(chunk);
  return total;
};

handler.help = ['archetype', 'archetypes'];
handler.tags = ['game'];
handler.command = /^(archetype|archetypes)$/i;
handler.limit = true;

export default handler;
