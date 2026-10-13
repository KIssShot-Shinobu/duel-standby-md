/**
 * Tampilkan NAMA dan EFEK kartu Yu-Gi-Oh! saja — tanpa gambar, statistik, harga, atau info set.
 *
 *   .effect Dark Magician
 *   .ef 46986414
 *   .e blue-eyes white dragon
 *
 * Output:
 *   🃏 *Dark Magician*
 *
 *   The ultimate wizard in terms of attack and defense...
 */
import { getClient, cardTitle, formatYgoError } from '../lib/ygoprodeck.js';

const handler = async (m, { conn, text, config, usedPrefix, command }) => {
  const query = String(text || '').trim();

  if (!query) {
    return m.reply(
      [
        `*「 EFEK KARTU YU-GI-OH! 」*`,
        '',
        `Contoh: ${usedPrefix}${command} Dark Magician`,
        `Cari passcode: ${usedPrefix}${command} 46986414`,
        '',
        'Data dari YGOPRODeck API (gratis, tanpa API key).',
      ].join('\n'),
    );
  }

  const ygo = getClient(config);
  let card = null;

  try {
    if (/^\d{6,9}$/.test(query)) {
      card = (await ygo.cardById(query)).data?.[0] || null;
    } else {
      try {
        card = (await ygo.cardByName(query)).data?.[0] || null;
      } catch {
        card = null; // nama tidak persis -> lanjut fuzzy
      }
    }

    if (!card) {
      const fuzzy = await ygo.fuzzyCards(query, { num: 10, sort: 'name' });
      const cards = fuzzy.data || [];
      if (!cards.length) return m.reply(`❌ Kartu *${query}* tidak ditemukan di database.`);

      if (cards.length > 1) {
        return m.reply(
          [
            `🔎 Ditemukan *${cards.length}* kartu yang mirip dengan "${query}":`,
            '',
            ...cards.map((item, index) => `${index + 1}. ${item.name}`),
            '',
            `Ketik nama yang lebih lengkap, atau cari passcode-nya lalu: ${usedPrefix}${command} <passcode>`,
          ].join('\n'),
        );
      }
      card = cards[0];
    }
  } catch (err) {
    return m.reply(formatYgoError(err));
  }

  const output = `🃏 *${cardTitle(card)}*\n\n${card.desc || 'Tidak ada deskripsi.'}`;
  await m.reply(output);

  return card.id;
};

handler.help = ['effect', 'ef', 'e'];
handler.tags = ['game'];
handler.command = /^(effect|ef|e)$/i;
handler.limit = true;

export default handler;