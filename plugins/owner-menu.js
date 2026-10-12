/**
 * Atur menu: kategori & command mana yang tampil/diaktifkan (khusus owner).
 *
 *   .menuset                        -> ringkasan semua kategori + jumlah command disembunyikan
 *   .menuset list                   -> daftar kategori & statusnya
 *   .menuset list game              -> daftar command dalam kategori game
 *   .category nsfw show|hide        -> tampilkan / sembunyikan kategori
 *   .category nsfw on|off           -> aktifkan / matikan seluruh kategori
 *   .cmdset smeme show|hide         -> tampilkan / sembunyikan command
 *   .cmdset smeme on|off            -> aktifkan / matikan command
 *
 * Perubahan langsung tersimpan di database dan dipakai oleh `.menu` serta
 * pengecekan izin command (lihat lib/menu-config.js + handler.js).
 */
import {
  KNOWN_CATEGORIES,
  categoryState,
  commandState,
  ensureMenuSettings,
  formatState,
  setCategory,
  setCommand,
} from '../lib/menu-config.js';
import { userError } from '../lib/errors.js';

const TOGGLE = {
  show: { visible: true },
  hide: { visible: false },
  on: { enabled: true },
  off: { enabled: false },
};

const ACTION_LABEL = {
  show: 'ditampilkan',
  hide: 'disembunyikan',
  on: 'diaktifkan',
  off: 'dimatikan',
};

/** Semua kategori (plugin + bawaan). */
function allCategories(plugins) {
  const map = new Map(plugins.categories());
  for (const tag of Object.keys(KNOWN_CATEGORIES)) if (!map.has(tag)) map.set(tag, []);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Cari plugin dari nama command atau nama file. */
function findPlugin(plugins, target) {
  const byFile = plugins.list.find((entry) => entry.name.toLowerCase() === target.toLowerCase());
  if (byFile) return byFile;
  return plugins.find(target);
}

const handler = async (m, { plugins, db, args, command, usedPrefix }) => {
  ensureMenuSettings(db);

  // ── .category <tag> show|hide|on|off ─────────────────────────────────────
  if (/^category$/i.test(command)) {
    const tag = String(args[0] || '').toLowerCase();
    const action = String(args[1] || '').toLowerCase();
    if (!tag || !(action in TOGGLE)) {
      throw userError(
        [
          '❌ Format: `' + `${usedPrefix}${command} <kategori> show|hide|on|off` + '`',
          '',
          `Contoh: ${usedPrefix}${command} nsfw show`,
          `Contoh: ${usedPrefix}${command} nsfw on`,
        ].join('\n'),
      );
    }
    const categories = allCategories(plugins).map(([name]) => name);
    if (!categories.includes(tag)) {
      throw userError(`❌ Kategori *${tag}* tidak ada.\nKategori tersedia: ${categories.join(', ')}`);
    }
    const next = setCategory(db, tag, TOGGLE[action]);
    await db.save?.(true); // langsung tulis ke disk supaya tidak hilang kalau bot dimatikan
    return m.reply(`✅ Kategori *${tag}* ${ACTION_LABEL[action]}.\nStatus sekarang: ${formatState(next)}`);
  }

  // ── .cmdset <command|file> show|hide|on|off ──────────────────────────────
  if (/^cmdset$/i.test(command)) {
    const target = String(args[0] || '').toLowerCase();
    const action = String(args[1] || '').toLowerCase();
    if (!target || !(action in TOGGLE)) {
      throw userError(
        [
          '❌ Format: `' + `${usedPrefix}${command} <command> show|hide|on|off` + '`',
          '',
          `Contoh: ${usedPrefix}${command} smeme hide`,
          `Contoh: ${usedPrefix}${command} smeme off`,
        ].join('\n'),
      );
    }
    const entry = findPlugin(plugins, target);
    if (!entry) throw userError(`❌ Command *${target}* tidak ditemukan.`);

    const next = setCommand(db, entry.name, TOGGLE[action]);
    await db.save?.(true); // langsung tulis ke disk
    return m.reply(
      [
        `✅ *${entry.help.join(', ') || entry.name}* ${ACTION_LABEL[action]}.`,
        `Status command: ${formatState(next)}`,
        `Status kategori ${entry.category}: ${formatState(categoryState(db, entry.category))}`,
      ].join('\n'),
    );
  }

  // ── .menuset [list] [kategori] ───────────────────────────────────────────
  const mode = String(args[0] || '').toLowerCase();

  if (mode === 'list' && args[1]) {
    const tag = String(args[1]).toLowerCase();
    const found = allCategories(plugins).find(([name]) => name === tag);
    if (!found) throw userError(`❌ Kategori *${tag}* tidak ada.`);
    const [, entries] = found;
    if (!entries.length) {
      return m.reply(`📂 *${tag}* masih kosong (belum ada plugin).`);
    }
    const lines = [
      `📂 *KATEGORI ${tag.toUpperCase()}* — ${formatState(categoryState(db, tag))}`,
      '',
      ...entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => {
          const state = commandState(db, entry.name);
          const mark = `${state.visible ? '👁️' : '🚫'}${state.enabled ? '✅' : '⛔'}`;
          return `${mark} ${usedPrefix}${entry.help[0] || entry.name} — ${entry.name}`;
        }),
      '',
      `Keterangan: 👁️ tampil / 🚫 disembunyikan · ✅ aktif / ⛔ dimatikan`,
    ];
    return m.reply(lines.join('\n'));
  }

  const categories = allCategories(plugins);
  const hiddenCommands = plugins.list.filter((entry) => !commandState(db, entry.name).visible);

  const lines = [
    '⚙️ *PENGATURAN MENU*',
    '',
    ...categories.map(([tag, entries]) => {
      const state = categoryState(db, tag);
      const visibleCount = entries.filter((entry) => commandState(db, entry.name).visible).length;
      const label = KNOWN_CATEGORIES[tag]?.label || tag;
      const note = entries.length ? `${visibleCount}/${entries.length} command tampil` : 'belum ada plugin';
      return `• *${label}* — ${formatState(state)}\n   ↳ ${note}`;
    }),
    '',
    `🙈 Command disembunyikan: ${hiddenCommands.length}`,
    `⛔ Command dimatikan: ${plugins.list.filter((entry) => !commandState(db, entry.name).enabled).length}`,
    '',
    '*Cara ubah:*',
    `${usedPrefix}category <kategori> show|hide|on|off`,
    `${usedPrefix}cmdset <command> show|hide|on|off`,
    `${usedPrefix}menuset list <kategori>`,
    '',
    '_Catatan: `off` memblokir command, `hide` hanya menyembunyikan dari menu._',
  ];

  return m.reply(lines.join('\n'));
};

handler.help = ['menuset', 'category', 'cmdset'];
handler.tags = ['owner'];
handler.command = /^(menuset|category|cmdset)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
