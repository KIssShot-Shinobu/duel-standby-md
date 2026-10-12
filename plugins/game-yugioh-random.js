/**
 * Kartu Yu-Gi-Oh! acak.
 *   .ygorandom
 */
import { getClient, formatCardCaption, formatCardText } from '../lib/ygoprodeck.js';
import { chunkText, fetchBuffer } from '../lib/functions.js';

const handler = async (m, { conn, config }) => {
  const ygo = getClient(config);

  let card;
  try {
    card = (await ygo.random()).data?.[0] || null;
  } catch (err) {
    return m.reply(`❌ Gagal mengambil kartu acak:\n${err.message}`);
  }
  if (!card) return m.reply('❌ Tidak ada kartu yang dikembalikan API.');

  const caption = `🎲 *KARTU ACAK*\n\n${formatCardCaption(card)}`;
  const imageUrl = card.card_images?.[0]?.image_url;
  let imageSent = false;

  if (imageUrl) {
    try {
      const buffer = await fetchBuffer(imageUrl, { timeout: 30000 });
      await conn.sendImage(m.chat, buffer, caption, m);
      imageSent = true;
    } catch {
      imageSent = false;
    }
  }

  if (!imageSent) await m.reply(caption);
  for (const chunk of chunkText(formatCardText(card), 3500)) {
    await m.reply(chunk);
  }

  return card.id;
};

handler.help = ['ygorandom', 'randomcard'];
handler.tags = ['game'];
handler.command = /^(ygorandom|randomcard|randomygo)$/i;
handler.limit = true;

export default handler;
