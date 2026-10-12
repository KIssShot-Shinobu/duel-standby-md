/**
 * Menu utama: menampilkan command yang terdaftar, dikelompokkan per kategori.
 * Kategori/command yang disembunyikan owner tidak ikut tampil (lihat lib/menu-config.js).
 *
 *   .menu            -> seluruh kategori
 *   .menu tools      -> hanya kategori tools
 *   .help sticker    -> detail sebuah command
 */
import { KNOWN_CATEGORIES, categoryState, commandState, ensureMenuSettings, formatState } from '../lib/menu-config.js';

const handler = async (m, { conn, plugins, config, db, usedPrefix, args }) => {
  ensureMenuSettings(db);
  const prefix = usedPrefix || config.bot.prefix[0];
  const query = (args[0] || '').toLowerCase();

  if (query) {
    const entry = plugins.find(query);
    if (entry) {
      const helps = entry.help.length ? entry.help.join(', ') : '(tidak ada alias)';
      const lines = [
        `*「 ${query.toUpperCase()} 」*`,
        '',
        `📄 File     : ${entry.name}`,
        `🏷️ Kategori : ${entry.category}`,
        `⌨️ Alias    : ${helps}`,
        `💳 Limit    : ${entry.plugin.limit ? (entry.plugin.limit === true ? '1' : entry.plugin.limit) : 'gratis'}`,
        `⚙️ Status   : ${formatState({ ...commandState(db, entry.name), enabled: commandState(db, entry.name).enabled && categoryState(db, entry.category).enabled })}`,
        `🔒 Khusus   : ${[
          entry.plugin.owner && 'owner',
          entry.plugin.premium && 'premium',
          entry.plugin.admin && 'admin grup',
          entry.plugin.group && 'di grup',
          entry.plugin.private && 'chat pribadi',
          entry.plugin.register && 'terdaftar',
        ].filter(Boolean).join(', ') || 'semua orang'}`,
        '',
        `Contoh: ${prefix}${entry.help[0] || query}`,
      ];
      return m.reply(lines.join('\n'));
    }
  }

  // Gabungkan kategori dari plugin dengan kategori bawaan (mis. nsfw yang masih kosong)
  const categoryMap = new Map(plugins.categories());
  for (const tag of Object.keys(KNOWN_CATEGORIES)) if (!categoryMap.has(tag)) categoryMap.set(tag, []);

  const now = new Date();
  const jam = new Intl.DateTimeFormat('id-ID', {
    timeZone: config.bot.timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now);

  const visibleCategories = [...categoryMap.entries()]
    .map(([tag, entries]) => [
      tag,
      entries.filter((entry) => commandState(db, entry.name).visible),
    ])
    .filter(([tag]) => categoryState(db, tag).visible);

  const header = [
    `╭─「 *${config.bot.name}* 」`,
    `│ 👤 ${m.pushName || m.sender.split('@')[0]}`,
    `│ 🕒 ${jam}`,
    `│ 📦 ${plugins.size} file plugin`,
    `│ 🔑 Prefix: ${config.bot.prefix.join(' ')}`,
    `╰────`,
  ].join('\n');

  const wanted = query ? visibleCategories.filter(([tag]) => tag === query) : visibleCategories;
  if (!wanted.length) {
    return m.reply(
      `${header}\n\n❌ Kategori *${query}* tidak ditemukan atau disembunyikan.\nKategori tersedia: ${visibleCategories.map(([tag]) => tag).join(', ')}`,
    );
  }

  const totalCommands = visibleCategories.reduce(
    (sum, [, entries]) => sum + entries.filter((entry) => entry.help.length || entry.commands.length).length,
    0,
  );

  const blocks = wanted.map(([tag, entries]) => {
    const names = entries
      .flatMap((entry) => (entry.help.length ? entry.help : entry.commands))
      .filter(Boolean)
      .sort();
    const label = KNOWN_CATEGORIES[tag]?.label || tag.toUpperCase();
    if (!names.length) {
      return `╭─「 ${label} (0) 」\n│ _(belum ada command)_\n╰────`;
    }
    return `╭─「 ${label} (${names.length}) 」\n${names.map((name) => `│ ${prefix}${name}`).join('\n')}\n╰────`;
  });

  const footer = `\n📊 ${totalCommands} command tampil dari ${plugins.size} plugin.\n💡 ${prefix}menu <kategori> untuk filter, ${prefix}help <command> untuk detail.`;

  return conn.sendMessage(m.chat, { text: `${header}\n\n${blocks.join('\n')}${footer}` }, { quoted: m });
};

handler.help = ['menu', 'help', 'bantuan'];
handler.tags = ['main'];
handler.command = /^(menu|help|bantuan)$/i;
handler.limit = false;

export default handler;
