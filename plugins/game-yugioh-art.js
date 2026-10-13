/**
 * Tampilkan GAMBAR kartu Yu-Gi-Oh! saja — tanpa caption, tanpa teks, tanpa balasan.
 *
 *   .card Dark Magician
 *   .card 46986414
 *   .card dark magician 2      -> artwork alternatif ke-2 (kalau tersedia)
 *
 * Yang dikirim hanya pesan berisi gambar. Tidak ada pesan "tunggu", tidak ada
 * deskripsi/efek, tidak ada statistik, dan tidak di-quote ke pesanmu.
 */
import { downloadCardImage, getClient, formatYgoError } from '../lib/ygoprodeck.js';

/** Ambil angka artwork di akhir perintah: ".card dark magician 2" -> 2 */
function splitArtIndex(text = '') {
  const match = String(text).trim().match(/^(.*?)[\s,]+(\d{1,2})$/);
  if (!match) return { query: String(text).trim(), artIndex: null };
  return { query: match[1].trim(), artIndex: Number(match[2]) };
}

const handler = async (m, { conn, text, config, usedPrefix, command }) => {
  const raw = String(text || '').trim();
  if (!raw) return m.reply(`Format: ${usedPrefix}${command} <nama kartu | passcode>\nContoh: ${usedPrefix}${command} Dark Magician`);

  const { query, artIndex } = splitArtIndex(raw);
  const ygo = getClient(config);
  let card = null;

  try {
    if (/^\d{6,9}$/.test(query)) {
      card = (await ygo.cardById(query)).data?.[0] || null;
    } else {
      try {
        card = (await ygo.cardByName(query)).data?.[0] || null;
      } catch {
        card = null; // nama tidak persis -> coba fuzzy
      }
    }

    if (!card) {
      const fuzzy = (await ygo.fuzzyCards(query, { num: 10, sort: 'name' })).data || [];
      if (fuzzy.length === 1) card = fuzzy[0];
      else if (fuzzy.length > 1) {
        // teks polos saja (tanpa emoji/judul) supaya user bisa mempersempit
        return m.reply(fuzzy.map((item) => item.name).join('\n'));
      } else {
        return m.reply('Kartu tidak ditemukan.');
      }
    }
  } catch (err) {
    return m.reply(formatYgoError(err));
  }

  const buffer = await downloadCardImage(card, {
    cacheDir: config.ygoprodeck?.imageCacheDir ? `${config.root}/${config.ygoprodeck.imageCacheDir}` : '',
    maxCache: config.ygoprodeck?.imageCacheMax,
    variant: artIndex === null ? 'full' : Math.max(0, artIndex - 1),
  }).catch(() => null);

  if (!buffer) return m.reply('Gambar kartu tidak tersedia.');

  // Hanya gambar. Tanpa caption, tanpa text, tanpa quoted.
  await conn.sendMessage(m.chat, { image: buffer }, {});
  return card.id;
};

handler.help = ['card'];
handler.tags = ['game'];
handler.command = /^(card|cardart)$/i;
handler.limit = true;

export default handler;
