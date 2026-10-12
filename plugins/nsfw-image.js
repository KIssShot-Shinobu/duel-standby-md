/**
 * Gambar anime 18+ (khusus dewasa) — **opt-in per grup**.
 *
 *   .nsfw on / .nsfw off  -> nyalakan/matikan di grup ini (admin grup atau owner bot)
 *   .nsfwstatus           -> status kategori bot + status chat ini
 *   .nsfwlist             -> daftar kategori, contoh tag, cara pakai
 *   .nsfw                 -> gambar acak (rating: explicit)
 *   .nsfw cat_ears        -> sesuai tag booru
 *   .nsfw yuri            -> kategori tetap PurrBot
 *
 * Dua lapis kontrol:
 *   1. **Owner bot** — kategori `nsfw` (master switch, nyala secara default).
 *      Kalau dimatikan, gambar tidak bisa diambil; namun command `on/off/status/list`
 *      tetap dijawab supaya admin grup tahu keadaannya (`handler.adultExempt`).
 *   2. **Admin grup / owner** — flag `db.chat(jid).nsfw` lewat `.nsfw on|off`.
 *      Bawaannya mati, jadi tiap grup harus menyetujui sendiri.
 *
 * Provider: Danbooru -> yande.re -> PurrBot (env `NSFW_PROVIDERS`). Gambar
 * diunduh lalu dikirim (bukan hotlink) dan tag terlarang disaring di
 * lib/image-source.js.
 */
import { downloadImage, fetchImage, findBlockedTags, imageCaption, listCategories, normalizeTags } from '../lib/image-source.js';
import { sendImageResult } from '../lib/media-send.js';
import { userError } from '../lib/errors.js';
import { isCategoryEnabled } from '../lib/menu-config.js';
import {
  canToggleNsfw,
  chatNsfwEnabled,
  formatNsfwStatus,
  lockedText,
  parseNsfwAction,
  setChatNsfw,
  toggleDeniedText,
} from '../lib/nsfw-gate.js';

/** Dedup sederhana per chat: jangan kirim gambar yang sama dua kali berturut-turut. */
const lastSeen = new Map();

const TAG_EXAMPLES = ['cat_ears', 'maid', 'swimsuit', 'thighhighs', 'yuri', 'kimono'];

function helpText(config, usedPrefix, status) {
  const lines = [
    '🔞 *GAMBAR 18+*',
    '',
    '*Status:*',
    formatNsfwStatus(status),
    '',
    '*Cara pakai:*',
    `• ${usedPrefix}nsfw — acak (rating explicit)`,
    `• ${usedPrefix}nsfw cat_ears — cari sesuai tag`,
    `• ${usedPrefix}nsfw on / off — nyalakan/matikan di ${status.isGroup ? 'grup ini' : 'chat ini'}`,
  ];

  for (const group of listCategories('nsfw')) {
    lines.push('', `*${group.provider}:* ${group.categories.slice(0, 12).join(', ')}${group.categories.length > 12 ? ', …' : ''}`);
  }
  lines.push('', `*Contoh tag:* ${TAG_EXAMPLES.join(', ')}`);
  lines.push('', '_Tag yang melibatkan anak ditolak otomatis._');
  return lines.join('\n');
}

const handler = async (m, ctx) => {
  const { conn, db, user, text, config, usedPrefix, command, isAdmin, isOwner } = ctx;
  const isGroup = Boolean(m.isGroup);
  const globalEnabled = isCategoryEnabled(db, 'nsfw');
  const chatEnabled = chatNsfwEnabled(db, m.chat);
  const status = { globalEnabled, chatEnabled, isGroup, usedPrefix };

  /**
   * Kembalikan limit yang sudah dipotong handler kalau command ternyata tidak
   * mengirim gambar (on/off/status/list) atau gagal sebelum kirim.
   */
  const refundLimit = () => {
    const cost = Number(ctx.limitCost) || 0;
    if (cost <= 0 || !user) return;
    user.limit = (Number(user.limit) || 0) + cost;
    db.touch?.();
  };

  if (/^nsfwstatus$/i.test(command)) {
    refundLimit();
    return m.reply(['🔞 *STATUS FITUR 18+*', '', formatNsfwStatus(status)].join('\n'));
  }

  if (/^nsfwlist$/i.test(command)) {
    refundLimit();
    return m.reply(helpText(config, usedPrefix, status));
  }

  // ── .nsfw on|off — gerbang per grup ──────────────────────────────────────
  const action = parseNsfwAction(String(text || '').trim().split(/\s+/)[0] || '');
  if (action) {
    if (!canToggleNsfw({ isOwner, isAdmin, isGroup })) {
      refundLimit();
      throw userError(toggleDeniedText(isGroup));
    }
    const enabled = setChatNsfw(db, m.chat, action === 'on');
    await db.save?.(true);
    refundLimit();

    const lines = [
      `${enabled ? '🔞' : '🔒'} Fitur 18+ *${enabled ? 'diaktifkan' : 'dimatikan'}* di ${isGroup ? 'grup ini' : 'chat ini'}.`,
    ];
    if (enabled && !globalEnabled) {
      // Bisa terjadi karena plugin ini dikecualikan dari gerbang kategori
      // (handler.adultExempt) supaya admin grup tetap dapat balasan jelas.
      lines.push(
        '',
        '⚠️ Tapi kategori NSFW bot sedang *dimatikan owner*, jadi gambarnya belum bisa dipakai.',
        `Owner perlu menjalankan: *${usedPrefix}category nsfw on*`,
      );
    } else if (enabled) {
      lines.push('', `Semua member bisa memakai *${usedPrefix}nsfw*. Matikan lagi: *${usedPrefix}nsfw off*`);
    } else {
      lines.push('', `Command 18+ kembali diblokir di sini. Nyatakan: *${usedPrefix}nsfw on*`);
    }
    return m.reply(lines.join('\n'));
  }

  // ── Ambil gambar (butuh kategori bot + izin grup + tag bersih) ───────────
  if (!globalEnabled) {
    refundLimit();
    throw userError(
      [
        '⛔ Fitur 18+ sedang *dimatikan owner bot*.',
        `Owner bisa menyalakan lagi: *${usedPrefix}category nsfw on*`,
      ].join('\n'),
    );
  }

  if (!chatEnabled) {
    refundLimit();
    throw userError(lockedText(usedPrefix, isGroup));
  }

  const query = String(text || '').trim();
  const blocked = findBlockedTags(normalizeTags(query), config.images?.blockedTags);
  if (blocked.length) {
    refundLimit();
    throw userError(`❌ Tag *${blocked.join(', ')}* tidak diizinkan di bot ini.`);
  }

  let item;
  try {
    item = await fetchImage({ mode: 'nsfw', query, config, avoid: new Set([lastSeen.get(m.chat)]) });
  } catch (err) {
    refundLimit();
    throw userError(`❌ Gagal mengambil gambar 18+.\n_${err.message}_`);
  }
  lastSeen.set(m.chat, item.id);

  const buffer = await downloadImage(item, { config }).catch(() => null);
  if (!buffer) {
    refundLimit();
    throw userError('❌ Gambar gagal diunduh. Coba lagi sebentar lagi.');
  }

  // GIF dikirim sebagai animasi (GIF WhatsApp) — kalau ffmpeg tidak ada,
  // otomatis jadi stiker WebP animasi supaya tetap bergerak.
  await sendImageResult(conn, m.chat, {
    buffer,
    caption: imageCaption(item, { adult: true }),
    quoted: m,
    config,
  });
  return item.id;
};

handler.help = ['nsfw', 'nsfwstatus', 'nsfwlist'];
handler.tags = ['nsfw'];
handler.command = /^(nsfw|nsfwrandom|nsfwstatus|nsfwlist)$/i;
// Limit dipotong handler, lalu dikembalikan untuk command yang tidak mengirim gambar.
handler.limit = true;
// Tetap boleh dijalankan walau kategori NSFW dimatikan owner, supaya admin grup
// bisa mengatur grupnya dan mendapat balasan jelas (gambar tetap diblokir).
handler.adultExempt = true;

export default handler;
