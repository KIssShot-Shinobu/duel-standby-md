/**
 * Yu-Gi-Oh! card lookup (YGOPRODeck API — gratis tanpa API key).
 *   .ygo Dark Magician        -> nama persis, kalau tidak ada baru fuzzy
 *   .ygo 46986414             -> cari lewat passcode (8 digit)
 *
 * Mengirim foto kartu + caption statistik, lalu teks efek lengkap.
 */
import { getClient, formatCardCaption, formatCardLine, formatCardText } from '../lib/ygoprodeck.js';
import { chunkText, fetchBuffer } from '../lib/functions.js';

const handler = async (m, { conn, text, config, usedPrefix, command }) => {
  const query = String(text || '').trim();

  if (!query) {
    return m.reply(
      [
        `*「 Yu-Gi-Oh! 」*`,
        '',
        `Contoh: ${usedPrefix}${command} Dark Magician`,
        `Cari passcode: ${usedPrefix}${command} 46986414`,
        `Pencarian lanjutan: ${usedPrefix}ygosearch atk>2500 type=xyz`,
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
            ...cards.map((item, index) => formatCardLine(item, index)),
            '',
            `Ketik nama yang lebih lengkap, atau cari passcode-nya lalu: ${usedPrefix}${command} <passcode>`,
          ].join('\n'),
        );
      }
      card = cards[0];
    }
  } catch (err) {
    return m.reply(`❌ Gagal mengambil data dari YGOPRODeck:\n${err.message}`);
  }

  const caption = formatCardCaption(card);
  const imageUrl = card.card_images?.[0]?.image_url;
  let imageSent = false;

  if (imageUrl) {
    try {
      const buffer = await fetchBuffer(imageUrl, { timeout: 30000 });
      await conn.sendImage(m.chat, buffer, caption, m);
      imageSent = true;
    } catch {
      imageSent = false; // kalau gambar gagal, caption dikirim sebagai teks
    }
  }

  if (!imageSent) await m.reply(caption);

  const detail = formatCardText(card);
  for (const chunk of chunkText(detail, 3500)) {
    await m.reply(chunk);
  }

  return card.id;
};

handler.help = ['ygo', 'yugioh', 'kartu'];
handler.tags = ['game'];
handler.command = /^(ygo|yugioh|kartu)$/i;
handler.limit = true;

export default handler;
