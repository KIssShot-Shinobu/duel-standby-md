/**
 * Informasi card set / booster pack.
 *   .cardset Metal Raiders        -> daftar kartu dalam set
 *   .setcode SDY-046              -> info 1 kartu dari kode set
 *   .cardsets                     -> ringkasan semua set (jumlah + rilis terbaru)
 */
import { getClient, formatCardLine, formatYgoError } from '../lib/ygoprodeck.js';
import { chunkText } from '../lib/functions.js';

const MAX_RESULTS = 20;

const handler = async (m, { text, config, usedPrefix, command }) => {
  const query = String(text || '').trim();
  const ygo = getClient(config);

  // .setcode <KODE>
  if (/^setcode$/i.test(command)) {
    if (!query) return m.reply(`Contoh: ${usedPrefix}setcode SDY-046`);
    let info;
    try {
      info = await ygo.setInfo(query.toUpperCase());
    } catch (err) {
      return m.reply(formatYgoError(err));
    }
    const entry = Array.isArray(info) ? info[0] : info;
    if (!entry) return m.reply(`❌ Kode set *${query}* tidak ditemukan.`);

    return m.reply(
      [
        `🎴 *${entry.name}*`,
        '',
        `📦 Set    : ${entry.set_name}`,
        `🔖 Kode   : ${entry.set_code}`,
        `💎 Rarity : ${entry.set_rarity || '-'}`,
        `💰 Harga  : ${entry.set_price ? `$${entry.set_price}` : '-'}`,
      ].join('\n'),
    );
  }

  // .cardsets -> ringkasan semua set
  if (!query) {
    let sets;
    try {
      sets = await ygo.sets();
    } catch (err) {
      return m.reply(formatYgoError(err));
    }
    const list = Array.isArray(sets) ? sets : [];
    const newest = [...list]
      .filter((set) => set.tcg_date)
      .sort((a, b) => String(b.tcg_date).localeCompare(String(a.tcg_date)))
      .slice(0, 10);

    const body = [
      `📦 *DAFTAR CARD SET*`,
      `Total: *${list.length}* set`,
      '',
      '*10 rilis terbaru:*',
      ...newest.map((set, index) => `${index + 1}. ${set.set_name} (\`${set.set_code}\`) — ${set.tcg_date}`),
      '',
      `Cari kartu dalam set: ${usedPrefix}cardset <nama set>`,
    ].join('\n');

    for (const chunk of chunkText(body, 3500)) await m.reply(chunk);
    return list.length;
  }

  // .cardset <nama set>
  let payload;
  try {
    payload = await ygo.card({ cardset: query, num: String(MAX_RESULTS), sort: 'name' });
  } catch (err) {
    return m.reply(formatYgoError(err));
  }

  const cards = payload.data || [];
  const total = payload.meta?.total_rows ?? cards.length;
  if (!cards.length) return m.reply(`❌ Tidak ada kartu pada set *${query}*.`);

  const lines = [
    `📦 *SET ${query.toUpperCase()}*`,
    `🎴 Menampilkan ${cards.length} dari *${total}* kartu`,
    '',
    ...cards.map((card, index) => formatCardLine(card, index)),
  ];
  for (const chunk of chunkText(lines.join('\n'), 3500)) await m.reply(chunk);
  return total;
};

handler.help = ['cardset', 'setcode', 'cardsets'];
handler.tags = ['game'];
handler.command = /^(cardset|setcode|cardsets)$/i;
handler.limit = true;

export default handler;
