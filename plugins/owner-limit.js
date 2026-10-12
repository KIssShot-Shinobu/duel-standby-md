/**
 * Atur fitur mana yang memakai limit (khusus owner).
 *
 *   .limitset                              -> ringkasan pengaturan limit
 *   .limitcmd smeme gratis                 -> command gratis (tanpa limit)
 *   .limitcmd smeme pakai                  -> paksa pakai limit (minimal 1)
 *   .limitcmd smeme 5                      -> biaya 5 limit
 *   .limitcmd smeme default                -> kembali ke bawaan plugin
 *   .limitcat game gratis                  -> seluruh kategori gratis
 *   .limitcat downloader 2                 -> seluruh kategori biaya 2 limit
 *
 * Prioritas: pengaturan command > pengaturan kategori > bawaan plugin
 * (`handler.limit` di file plugin). Lihat lib/limit-config.js.
 */
import {
  ensureLimitSettings,
  formatLimitInfo,
  limitSummary,
  parseLimitAction,
  resolveLimit,
  setCategoryLimit,
  setCommandLimit,
} from '../lib/limit-config.js';
import { userError } from '../lib/errors.js';

function allCategories(plugins) {
  const map = new Map(plugins.categories());
  return [...map.keys()].sort((a, b) => a.localeCompare(b));
}

function findPlugin(plugins, target) {
  return (
    plugins.list.find((entry) => entry.name.toLowerCase() === String(target).toLowerCase()) ||
    plugins.find(String(target))
  );
}

const ACTION_TEXT = {
  default: 'kembali ke bawaan plugin',
  free: 'dibuat gratis (tanpa limit)',
  on: 'diwajibkan memakai limit',
  custom: 'biaya limit diubah',
};

const handler = async (m, { plugins, db, args, command, usedPrefix }) => {
  ensureLimitSettings(db);

  // ── .limitcmd <command> <aksi> ───────────────────────────────────────────
  if (/^limitcmd$/i.test(command)) {
    const target = String(args[0] || '').trim();
    const action = parseLimitAction(args[1]);
    if (!target || !action) {
      throw userError(
        [
          '❌ Format: `' + `${usedPrefix}${command} <command> default|gratis|pakai|<angka>` + '`',
          '',
          `Contoh: ${usedPrefix}${command} smeme gratis`,
          `Contoh: ${usedPrefix}${command} ygo 3`,
          `Contoh: ${usedPrefix}${command} smeme default`,
        ].join('\n'),
      );
    }
    const entry = findPlugin(plugins, target);
    if (!entry) throw userError(`❌ Command *${target}* tidak ditemukan.`);

    setCommandLimit(db, entry.name, action);
    const resolved = resolveLimit(db, entry);
    return m.reply(
      [
        `✅ *${entry.help[0] || entry.name}* ${ACTION_TEXT[action.mode] || 'diubah'}.`,
        `Biaya sekarang: *${formatLimitInfo(resolved)}*`,
        `(bawaan plugin: ${resolved.base > 0 ? `${resolved.base} limit` : 'gratis'})`,
      ].join('\n'),
    );
  }

  // ── .limitcat <kategori> <aksi> ──────────────────────────────────────────
  if (/^limitcat$/i.test(command)) {
    const tag = String(args[0] || '').trim().toLowerCase();
    const action = parseLimitAction(args[1]);
    if (!tag || !action) {
      throw userError(
        [
          '❌ Format: `' + `${usedPrefix}${command} <kategori> default|gratis|pakai|<angka>` + '`',
          '',
          `Contoh: ${usedPrefix}${command} game gratis`,
          `Contoh: ${usedPrefix}${command} downloader 2`,
        ].join('\n'),
      );
    }
    const categories = allCategories(plugins);
    if (!categories.includes(tag)) {
      throw userError(`❌ Kategori *${tag}* tidak ada.\nKategori tersedia: ${categories.join(', ')}`);
    }

    setCategoryLimit(db, tag, action);
    const sample = plugins.list.filter((entry) => entry.category === tag);
    const paid = sample.filter((entry) => resolveLimit(db, entry).cost > 0).length;
    return m.reply(
      [
        `✅ Kategori *${tag}* ${ACTION_TEXT[action.mode] || 'diubah'}.`,
        `Dari ${sample.length} command di kategori ini, ${paid} memakai limit.`,
        '',
        `_Catatan: pengaturan per-command (jika ada) tetap menang atas pengaturan kategori._`,
      ].join('\n'),
    );
  }

  // ── .limitset ────────────────────────────────────────────────────────────
  const summary = limitSummary(db, plugins);
  const list = (items) => (items.length ? items.slice(0, 15).join(', ') + (items.length > 15 ? ` … (+${items.length - 15})` : '') : '-');

  const lines = [
    '⚙️ *PENGATURAN LIMIT*',
    '',
    `📦 Bawaan plugin: *${summary.fromPlugin.paid}* command pakai limit, *${summary.fromPlugin.free}* gratis.`,
    '',
    `🙌 Dibuat gratis (${summary.commandOverrides.filter((item) => item.setting === 'gratis').length}):`,
    `   ${list(summary.commandOverrides.filter((item) => item.setting === 'gratis').map((item) => item.label))}`,
    '',
    `💳 Diubah biayanya (${summary.commandOverrides.filter((item) => item.setting !== 'gratis').length}):`,
    `   ${list(summary.commandOverrides.filter((item) => item.setting !== 'gratis').map((item) => `${item.label} (${item.setting})`))}`,
    '',
    `📂 Aturan kategori (${summary.categoryOverrides.length}):`,
    `   ${list(summary.categoryOverrides.map((item) => `${item.tag} (${item.setting})`))}`,
    '',
    '*Cara ubah:*',
    `${usedPrefix}limitcmd <command> default|gratis|pakai|<angka>`,
    `${usedPrefix}limitcat <kategori> default|gratis|pakai|<angka>`,
    '',
    '_Contoh: `' + `${usedPrefix}limitcmd smeme gratis` + '` — command itu tidak lagi memotong limit._',
  ];

  return m.reply(lines.join('\n'));
};

handler.help = ['limitset', 'limitcmd', 'limitcat'];
handler.tags = ['owner'];
handler.command = /^(limitset|limitcmd|limitcat)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
