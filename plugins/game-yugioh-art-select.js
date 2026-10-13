/**
 * Tampilkan GAMBAR kartu Yu-Gi-Oh! (cropped) — jika >1 artwork, tampilkan WhatsApp Buttons untuk pilih.
 *
 *   .art Dark Magician
 *   .artwork 46986414
 *   .art blue-eyes white dragon
 *   .artall Dark Magician     -> kirim SEMUA artwork berturut-turut
 *
 * Jika 1 artwork: kirim gambar cropped langsung.
 * Jika >1 artwork: kirim artwork #1 (cropped) + Buttons (Art 1, Art 2, Art 3...).
 * User klik button -> kirim artwork yang dipilih (cropped).
 *
 * Catatan: Buttons hanya bekerja pada WhatsApp Business API.
 * Untuk akun reguler, gunakan fallback text-based menu.
 */
import { downloadCardImage, getClient, cardTitle, formatYgoError } from '../lib/ygoprodeck.js';

// Cache sementara untuk menyimpan images saat user memilih via button
// Key: card_id, Value: { images: [], at: timestamp }
const artCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

function cleanCache() {
  const now = Date.now();
  for (const [key, val] of artCache.entries()) {
    if (now - val.at > CACHE_TTL) artCache.delete(key);
  }
}

// Handler untuk .artall - kirim semua artwork berturut-turut
async function allHandler(m, { conn, text, config, usedPrefix, command }) {
  const query = String(text || '').trim();
  if (!query) return m.reply(`Format: ${usedPrefix}${command} <nama kartu | passcode>\nContoh: ${usedPrefix}${command} Dark Magician`);

  const ygo = getClient(config);
  let card = null;

  try {
    if (/^\d{6,9}$/.test(query)) {
      card = (await ygo.cardById(query)).data?.[0] || null;
    } else {
      try {
        card = (await ygo.cardByName(query)).data?.[0] || null;
      } catch {
        card = null;
      }
    }

    if (!card) {
      const fuzzy = (await ygo.fuzzyCards(query, { num: 10, sort: 'name' })).data || [];
      if (fuzzy.length === 1) card = fuzzy[0];
      else if (fuzzy.length > 1) {
        return m.reply(fuzzy.map((item) => item.name).join('\n'));
      } else {
        return m.reply('Kartu tidak ditemukan.');
      }
    }
  } catch (err) {
    return m.reply(formatYgoError(err));
  }

  const images = card?.card_images || [];
  if (!images.length) return m.reply('Gambar kartu tidak tersedia.');

  // Kirim info awal
  await m.reply(`🃏 *${cardTitle(card)}*\nTotal ${images.length} artwork — mengirim berturut-turut...`);

  // Kirim semua artwork secara berurutan (cropped)
  for (let i = 0; i < images.length; i++) {
    const buffer = await downloadCardImage(card, {
      cacheDir: config.ygoprodeck?.imageCacheDir ? `${config.root}/${config.ygoprodeck.imageCacheDir}` : '',
      maxCache: config.ygoprodeck?.imageCacheMax,
      variant: i,
    }).catch(() => null);

    if (buffer) {
      await conn.sendMessage(m.chat, {
        image: buffer,
        caption: `Art ${i + 1} / ${images.length}`,
      }, {});
      // Delay kecil agar tidak spam/terblokir rate limit
      if (i < images.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
  }

  return card.id;
}

// Handler utama: .art / .artwork / .artall
const mainHandler = async (m, { conn, text, config, usedPrefix, command }) => {
  // .artall -> panggil allHandler
  if (command === 'artall') return allHandler(m, { conn, text, config, usedPrefix, command });

  // .art / .artwork -> logic existing
  const query = String(text || '').trim();
  if (!query) return m.reply(`Format: ${usedPrefix}${command} <nama kartu | passcode>\nContoh: ${usedPrefix}${command} Dark Magician`);

  cleanCache();

  const ygo = getClient(config);
  let card = null;

  try {
    if (/^\d{6,9}$/.test(query)) {
      card = (await ygo.cardById(query)).data?.[0] || null;
    } else {
      try {
        card = (await ygo.cardByName(query)).data?.[0] || null;
      } catch {
        card = null;
      }
    }

    if (!card) {
      const fuzzy = (await ygo.fuzzyCards(query, { num: 10, sort: 'name' })).data || [];
      if (fuzzy.length === 1) card = fuzzy[0];
      else if (fuzzy.length > 1) {
        return m.reply(fuzzy.map((item) => item.name).join('\n'));
      } else {
        return m.reply('Kartu tidak ditemukan.');
      }
    }
  } catch (err) {
    return m.reply(formatYgoError(err));
  }

  const images = card?.card_images || [];
  if (!images.length) return m.reply('Gambar kartu tidak tersedia.');

  // Simpan ke cache untuk button callback
  artCache.set(card.id, { images, at: Date.now() });

  // Kirim artwork pertama (cropped)
  const buffer = await downloadCardImage(card, {
    cacheDir: config.ygoprodeck?.imageCacheDir ? `${config.root}/${config.ygoprodeck.imageCacheDir}` : '',
    maxCache: config.ygoprodeck?.imageCacheMax,
    variant: 'cropped',
  }).catch(() => null);

  if (!buffer) return m.reply('Gagal mengunduh gambar kartu.');

  // Jika hanya 1 artwork, kirim langsung tanpa button
  if (images.length === 1) {
    await conn.sendMessage(m.chat, { image: buffer }, {});
    return card.id;
  }

  // >1 artwork: coba kirim dengan buttons (WhatsApp Business API)
  // Format Baileys 6.7.x untuk buttons
  const buttons = images.slice(0, 3).map((img, idx) => ({
    buttonId: `${usedPrefix}artpick ${idx + 1} ${card.id}`,
    buttonText: { displayText: `Art ${idx + 1}` },
    type: 1,
  }));

  const buttonMsg = {
    image: buffer,
    caption: `🃏 *${cardTitle(card)}*\nArtwork 1 dari ${images.length}`,
    footer: 'Pilih artwork alternatif:',
    buttons,
    headerType: 4, // 4 = image
  };

  try {
    // Coba kirim dengan buttons (hanya bekerja di WhatsApp Business API)
    await conn.sendMessage(m.chat, buttonMsg, { quoted: m });
  } catch (err) {
    // Fallback: kirim gambar + teks menu jika buttons gagal (akun reguler)
    const menuText = [
      `🃏 *${cardTitle(card)}*`,
      `Artwork 1 dari ${images.length}`,
      '',
      'Balas dengan nomor artwork:',
      ...images.slice(0, 5).map((_, idx) => `${idx + 1}. Art ${idx + 1}`),
      '',
      `Contoh: ${usedPrefix}artpick 2 ${card.id}`,
    ].join('\n');

    await conn.sendMessage(m.chat, { image: buffer, caption: menuText }, { quoted: m });
  }

  return card.id;
};

// Handler untuk button callback: .artpick <index> <card_id>
// Juga menangani reply teks dari user (fallback untuk akun non-Business)
const pickHandler = async (m, { conn, text, config, usedPrefix, command }) => {
  const args = String(text || '').trim().split(/\s+/);
  if (args.length < 2) return;

  const index = Number(args[0]) - 1;
  const cardId = args[1];
  if (!Number.isInteger(index) || index < 0) return;

  cleanCache();

  const cached = artCache.get(cardId);
  if (!cached) return m.reply('Sesi memilih artwork sudah kadaluarsa. Silakan ketik .art lagi.');

  const { images } = cached;
  if (index >= images.length) return m.reply(`Artwork ke-${index + 1} tidak tersedia. Total: ${images.length}.`);

  // Ambil kartu lagi untuk download image (bisa dari cache ygoprodeck)
  const ygo = getClient(config);
  let card = null;
  try {
    card = (await ygo.cardById(cardId)).data?.[0] || null;
  } catch {
    return m.reply('Gagal mengambil data kartu.');
  }
  if (!card) return m.reply('Kartu tidak ditemukan.');

  const buffer = await downloadCardImage(card, {
    cacheDir: config.ygoprodeck?.imageCacheDir ? `${config.root}/${config.ygoprodeck.imageCacheDir}` : '',
    maxCache: config.ygoprodeck?.imageCacheMax,
    variant: index, // variant sebagai number = pilih artwork ke-n
  }).catch(() => null);

  if (!buffer) return m.reply('Gagal mengunduh artwork alternatif.');

  // Kirim artwork yang dipilih (cropped, tanpa button)
  await conn.sendMessage(m.chat, { image: buffer }, {});
  artCache.delete(cardId);
  return card.id;
};

mainHandler.help = ['art', 'artwork', 'artall'];
mainHandler.tags = ['game'];
mainHandler.command = /^(art|artwork|artall)$/i;
mainHandler.limit = true;

pickHandler.help = ['artpick'];
pickHandler.tags = ['game'];
pickHandler.command = /^artpick$/i;
pickHandler.limit = true;
pickHandler.hidden = true;

export { mainHandler as handler, pickHandler };
export default mainHandler;