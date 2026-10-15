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
import { downloadImage, fetchImage, findBlockedTags, listCategories, normalizeTags } from '../lib/image-source.js';
import { sendImageResult } from '../lib/media-send.js';
import { userError } from '../lib/errors.js';

/**
 * Dedup GLOBAL (semua chat): 80 gambar terakhir yang dikirim bot.
 * Dipakai global supaya dua chat yang memakai `.sfw` bersamaan juga tidak
 * menerima gambar yang sama, dan riwayat tetap terlacak lintas chat.
 */
const recent = [];
const MAX_HISTORY = 80;

function getAvoidSet() {
  return new Set(recent);
}

function addToHistory(itemId) {
  recent.push(itemId);
  if (recent.length > MAX_HISTORY) recent.splice(0, recent.length - MAX_HISTORY);
}

/**
 * Kunci serial untuk blok "pilih gambar + catat riwayat".
 * Tanpa ini, dua perintah yang berjalan bersamaan (main.js memanggil
 * handleMessage tanpa await) membaca snapshot `avoid` yang sama sebelum
 * yang satu menulis riwayat -> keduanya memilih gambar identik.
 */
let pickQueue = Promise.resolve();
function withPickLock(fn) {
  const run = pickQueue.then(fn, fn);
  pickQueue = run.then(() => {}, () => {});
  return run;
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
    // Pilih + catat dalam satu blok serial (lihat withPickLock) supaya riwayat
    // selalu berisi gambar yang baru saja dipilih, termasuk saat dipakai bersamaan.
    item = await withPickLock(async () => {
      const picked = await fetchImage({ mode: 'sfw', query, config, avoid: getAvoidSet() });
      addToHistory(picked.id);
      return picked;
    });
  } catch (err) {
    throw userError(`❌ Gagal mengambil gambar.\n_${err.message}_`);
  }

  const buffer = await downloadImage(item, { config }).catch(() => null);
  if (!buffer) throw userError('❌ Gambar gagal diunduh. Coba lagi sebentar lagi.');

  // GIF dikirim sebagai animasi (GIF WhatsApp) — kalau ffmpeg tidak ada,
  // otomatis jadi stiker WebP animasi supaya tetap bergerak.
  await sendImageResult(conn, m.chat, { buffer, caption: '', quoted: m, config });
  return item.id;
};

handler.help = ['sfw', 'sfwlist'];
handler.tags = ['image'];
handler.command = /^(sfw|anime|sfwlist|w|waifu)$/i;
handler.limit = true;

export default handler;
