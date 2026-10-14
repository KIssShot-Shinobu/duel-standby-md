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
import { commandList, joinLines, userName } from '../lib/messages.js';

/** Urutan kategori yang enak dibaca; sisanya alfabetis. */
const CATEGORY_ORDER = ['main', 'owner', 'group', 'tools', 'downloader', 'fun', 'ai', 'rpg', 'game', 'image', 'nsfw', 'info', 'event'];

const RULE = '─'.repeat(24);

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

const handler = async (m, { conn, plugins, config, db, usedPrefix, args, isOwner }) => {
  ensureMenuSettings(db);
  const prefix = usedPrefix || config.bot.prefix[0];
  const query = String(args[0] || '').toLowerCase();

  // Kategori terlihat
  const categoryMap = new Map(plugins.categories());
  for (const tag of Object.keys(KNOWN_CATEGORIES)) if (!categoryMap.has(tag)) categoryMap.set(tag, []);

  const visible = [...categoryMap.entries()]
    .map(([tag, entries]) => [tag, entries.filter((entry) => commandState(db, entry.name).visible)])
    .filter(([tag]) => categoryState(db, tag).visible);
  const categories = sortCategories(visible.map(([tag]) => tag)).map((tag) => [tag, visible.find(([item]) => item === tag)?.[1] || []]);

  // ── Detail satu command: `.help sticker` / `.menu sticker` ──────────────
  const entry = query ? plugins.find(query) : null;
  if (entry && commandState(db, entry.name).visible) {
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

  // ── Ringkasan semua kategori ────────────────────────────────────────────
  const blocks = [];
  let totalCommands = 0;

  for (const [tag, entries] of categories) {
    const list = entries.filter((e) => e.help.length || e.commands.length).sort((a, b) => primaryName(a).localeCompare(primaryName(b)));
    const off = !categoryState(db, tag).enabled;
    if (!list.length) {
      blocks.push(`${categoryLabel(tag)} (${list.length})${off && isOwner ? ' ⛔' : ''}\n   Belum ada command di sini.`);
      continue;
    }
    totalCommands += list.length;
    const cmds = list.map(primaryName);
    blocks.push(`${categoryLabel(tag)} (${list.length})${off && isOwner ? ' ⛔' : ''}\n${wrapCommands(cmds, { prefix }).join('\n')}`);
  }

  const summary = [
    `🤖 *${config.bot.name}* v${config.version}`,
    `👤 Hai ${userName(m)}!`,
    `📦 ${plugins.size} plugin · ${categories.length} kategori · ${totalCommands} command`,
    '',
    // Satu baris kosong antar kategori supaya tidak menempel dan tetap enak dibaca.
    blocks.join('\n\n'),
    '',
    `💡 Ketik \`${prefix}menu <kategori>\` buat liat detail, atau \`${prefix}help <command>\``,
  ].join('\n');

  return conn.sendMessage(m.chat, { text: summary }, { quoted: m });
};

handler.help = ['menu', 'help', 'bantuan'];
handler.tags = ['main'];
handler.command = /^(menu|help|bantuan)$/i;
handler.limit = false;

export default handler;
