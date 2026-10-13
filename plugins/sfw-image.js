/**
 * Gambar anime aman (SFW) — pasangan dari `.nsfw`.
 *
 *   .sfw              -> gambar acak (nekos.best: neko/waifu)
 *   .sfw hug          -> kategori nekos.best / PurrBot
 *   .sfw cat_ears     -> tag booru (Safebooru / Danbooru rating:safe)
 *   .sfwlist          -> daftar kategori yang tersedia
 *
 * Provider: nekos.best -> Danbooru (safe) -> yande.re (safe) -> Safebooru ->
 * PurrBot. Bisa diatur lewat env `IMAGE_PROVIDERS`. Gambar diunduh lalu
 * dikirim, bukan hotlink.
 */
import { downloadImage, fetchImage, findBlockedTags, imageCaption, listCategories, normalizeTags } from '../lib/image-source.js';
import { sendImageResult } from '../lib/media-send.js';
import { userError } from '../lib/errors.js';

/** Dedup per chat: simpan history 20 gambar terakhir supaya tidak repeat. */
const lastSeen = new Map();
const MAX_HISTORY = 20;

function getAvoidSet(chatId) {
  const history = lastSeen.get(chatId);
  if (!history) return new Set();
  return new Set(history);
}

function addToHistory(chatId, itemId) {
  let history = lastSeen.get(chatId);
  if (!history) {
    history = [];
    lastSeen.set(chatId, history);
  }
  history.push(itemId);
  if (history.length > MAX_HISTORY) history.shift();
}

const TAG_EXAMPLES = ['cat_ears', 'kimono', 'school_uniform', 'landscape', 'twintails'];

function helpText(config, usedPrefix) {
  const lines = ['🖼️ *GAMBAR ANIME (SFW)*', '', `• ${usedPrefix}sfw — gambar acak`, `• ${usedPrefix}sfw hug — kategori siap pakai`, `• ${usedPrefix}sfw cat_ears — cari sesuai tag`];
  for (const group of listCategories('sfw')) {
    lines.push('', `*${group.provider}:* ${group.categories.slice(0, 18).join(', ')}${group.categories.length > 18 ? ', …' : ''}`);
  }
  lines.push('', `*Contoh tag:* ${TAG_EXAMPLES.join(', ')}`);
  return lines.join('\n');
}

const handler = async (m, { conn, text, config, usedPrefix, command }) => {
  if (/^sfwlist$/i.test(command)) return m.reply(helpText(config, usedPrefix));

  const query = String(text || '').trim();
  const blocked = findBlockedTags(normalizeTags(query), config.images?.blockedTags);
  if (blocked.length) throw userError(`❌ Tag *${blocked.join(', ')}* tidak diizinkan.`);

  let item;
  try {
    item = await fetchImage({ mode: 'sfw', query, config, avoid: getAvoidSet(m.chat) });
  } catch (err) {
    throw userError(`❌ Gagal mengambil gambar.\n_${err.message}_`);
  }
  addToHistory(m.chat, item.id);

  const buffer = await downloadImage(item, { config }).catch(() => null);
  if (!buffer) throw userError('❌ Gambar gagal diunduh. Coba lagi sebentar lagi.');

  // GIF dikirim sebagai animasi (GIF WhatsApp) — kalau ffmpeg tidak ada,
  // otomatis jadi stiker WebP animasi supaya tetap bergerak.
  await sendImageResult(conn, m.chat, { buffer, caption: imageCaption(item), quoted: m, config });
  return item.id;
};

handler.help = ['sfw', 'sfwlist'];
handler.tags = ['image'];
handler.command = /^(sfw|anime|sfwlist|w|waifu)$/i;
handler.limit = true;

export default handler;
