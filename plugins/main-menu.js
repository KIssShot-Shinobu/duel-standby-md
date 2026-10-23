/**
 * Menu utama: menampilkan command yang terdaftar, dikelompokkan per kategori.
 * Kategori/command yang disembunyikan owner tidak ikut tampil (lihat lib/menu-config.js).
 *
 *   .menu              -> ringkasan semua kategori (nama utama saja, hemat baris)
 *   .menu tools        -> detail satu kategori (termasuk alias + biaya limit)
 *   .help sticker      -> detail sebuah command
 *
 * Tampilan sengaja dibuat ringkas: nama utama per plugin, dibungkus beberapa
 * kolom, satu baris kosong antar kategori — dulu setiap alias menempati satu
 * baris sendiri sehingga menu bisa 130+ baris.
 */
import { KNOWN_CATEGORIES, categoryState, commandState, ensureMenuSettings, formatState, wrapCommands } from '../lib/menu-config.js';
import { formatLimitInfo, resolveLimit } from '../lib/limit-config.js';
import { refreshLimit } from '../lib/permissions.js';
import { bareNumber, shortClock } from '../lib/functions.js';
import { commandList, joinLines } from '../lib/messages.js';

/** Urutan kategori yang enak dibaca; sisanya alfabetis. */
const CATEGORY_ORDER = ['main', 'owner', 'group', 'tools', 'downloader', 'fun', 'reaction', 'ai', 'rpg', 'game', 'image', 'nsfw', 'info', 'event'];

const sortCategories = (tags) =>
  [...tags].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

const categoryLabel = (tag) => KNOWN_CATEGORIES[tag]?.label || tag.toUpperCase();

/** Nama utama sebuah plugin (alias pertama / command pertama). */
const primaryName = (entry) => entry.help[0] || entry.commands[0] || entry.name.replace(/\.js$/, '');

/** Semua nama (utama + alias) sebuah plugin. */
const allNames = (entry) => (entry.help.length ? entry.help : entry.commands).filter(Boolean);

const handler = async (m, { conn, plugins, config, db, usedPrefix, args, isOwner, runtime }) => {
  ensureMenuSettings(db);
  const prefix = usedPrefix || config.bot.prefix[0];
  const query = String(args[0] || '').toLowerCase();

  // Kategori terlihat
  const categoryMap = new Map(plugins.categories());
  for (const tag of Object.keys(KNOWN_CATEGORIES)) if (!categoryMap.has(tag)) categoryMap.set(tag, []);

  const visible = [...categoryMap.entries()]
    .map(([tag, entries]) => [tag, entries.filter((entry) => commandState(db, entry.name).visible)])
    .filter(([tag]) => categoryState(db, tag).visible)
    // Kategori `owner` hanya untuk owner — user biasa tidak perlu melihat daftar
    // command yang tetap akan ditolak handler.
    .filter(([tag]) => isOwner === true || tag !== 'owner');
  const categories = sortCategories(visible.map(([tag]) => tag)).map((tag) => [tag, visible.find(([item]) => item === tag)?.[1] || []]);

  // ── Detail satu command: `.help sticker` / `.menu sticker` ──────────────
  const entry = query ? plugins.find(query) : null;
  if (entry && commandState(db, entry.name).visible && (isOwner === true || entry.category !== 'owner')) {
    const limit = resolveLimit(db, entry);
    const categoryEnabled = categoryState(db, entry.category).enabled;
    const names = allNames(entry);
    const status = formatState({ ...commandState(db, entry.name), enabled: commandState(db, entry.name).enabled && categoryEnabled });
    const khusus = [
      entry.plugin.owner && 'owner',
      entry.plugin.premium && 'premium',
      entry.plugin.admin && 'admin grup',
      entry.plugin.group && 'di grup',
      entry.plugin.private && 'chat pribadi',
      entry.plugin.register && 'terdaftar',
    ].filter(Boolean).join(', ') || 'semua orang';

    const text = [
      `📋 *${names[0]?.toUpperCase() || query.toUpperCase()}*`,
      '',
      `🏷️ Kategori: ${categoryLabel(entry.category)}`,
      `⌨️ Alias: ${names.join(', ') || '(tidak ada)'}`,
      `💳 Limit: ${formatLimitInfo(limit)}`,
      `⚙️ Status: ${status}`,
      `🔒 Khusus: ${khusus}`,
      '',
      `💡 Contoh: ${prefix}${names[0] || query}`,
    ].join('\n');
    
    return conn.sendMessage(m.chat, { text }, { quoted: m });
  }

  // ── Semua command (`.menu all`) ─────────────────────────────────────────
  if (query === 'all') {
    const blocks = [];
    let totalCommands = 0;

    for (const [tag, entries] of categories) {
      const list = entries.filter((e) => e.help.length || e.commands.length).sort((a, b) => primaryName(a).localeCompare(primaryName(b)));
      const off = !categoryState(db, tag).enabled;
      if (!list.length) {
        blocks.push(`${categoryLabel(tag)} (0)${off && isOwner ? ' ⛔' : ''}\n   Belum ada command di sini.`);
        continue;
      }
      totalCommands += list.length;
      blocks.push(`${categoryLabel(tag)} (${list.length})${off && isOwner ? ' ⛔' : ''}\n${wrapCommands(list.map(primaryName), { prefix }).join('\n')}`);
    }

    const text = [
      `📋 *SEMUA COMMAND* (${totalCommands})`,
      '',
      blocks.join('\n\n'),
      '',
      `💡 Ketik \`${prefix}menu <kategori>\` buat detail, atau \`${prefix}help <command>\``,
    ].join('\n');
    return conn.sendMessage(m.chat, { text }, { quoted: m });
  }

  // ── Detail satu kategori ────────────────────────────────────────────────
  if (query) {
    const found = categories.find(([tag]) => tag === query);
    if (!found) {
      return m.reply(joinLines(`Kategori *${query}* gak ketemu atau disembunyikan.\nKategori: ${categories.map(([tag]) => tag).join(', ')}`));
    }

    const [tag, entries] = found;
    const list = entries.filter((e) => e.help.length || e.commands.length).sort((a, b) => primaryName(a).localeCompare(primaryName(b)));
    const disabledCategory = !categoryState(db, tag).enabled;

    const cmds = list.map((entry) => {
      const names = allNames(entry).map((name) => `${prefix}${name}`).join(' · ');
      const limit = resolveLimit(db, entry);
      const off = !commandState(db, entry.name).enabled || disabledCategory;
      const badges = [limit.cost > 0 ? `${limit.cost} limit` : 'gratis', off && isOwner ? 'dimatikan' : ''].filter(Boolean);
      return `${names}${badges.length ? ` (${badges.join(' · ')})` : ''}`;
    });

    const title = `${categoryLabel(tag)} — ${list.length} command`;
    return conn.sendMessage(m.chat, { text: commandList(title, cmds, prefix) }, { quoted: m });
  }

  // ── Ringkasan: sapaan + info bot + daftar kategori ──────────────────────
  const mode = String(config.bot.mode || 'public').toLowerCase() === 'self' ? 'Self' : 'Publik';
  const uptime = runtime?.startedAt ? Date.now() - runtime.startedAt : process.uptime() * 1000;
  const limits = refreshLimit(db, db.user(m.sender), config);
  const daftar = categories.map(
    ([tag]) => `│ • ${prefix}menu ${tag}${categoryState(db, tag).enabled || !isOwner ? '' : ' ⛔'}`,
  );

  const summary = [
    `Hallo @${bareNumber(m.sender)}! 👋`,
    'Saya adalah Bot Otomatis yang siap membantu Anda 24/7!',
    '',
    '「  I N F O  B O T  」',
    ` •  Mode : ${mode}`,
    ` •  Nama : ${config.bot.name}`,
    ` •  Versi : ${config.version}`,
    ` •  Limits : ${limits}`,
    ` •  Uptime : ${shortClock(uptime)}`,
    '',
    '',
    'Berikut daftar menu yang tersedia:',
    '╭─「 DAFTAR MENU 」',
    `│ • ${prefix}menu all`,
    ...daftar,
    '╰────',
    '',
    `Ketik \`${prefix}menu <nama_menu>\` untuk melihat fiturnya.`,
    `Contoh: ${prefix}menu tools`,
    '',
    '',
    `Powered By ${config.bot.name}`,
  ].join('\n');

  return conn.sendMessage(m.chat, { text: summary, mentions: [m.sender] }, { quoted: m });
};

handler.help = ['menu', 'help', 'bantuan'];
handler.tags = ['main'];
handler.command = /^(menu|help|bantuan)$/i;
handler.limit = false;

export default handler;
