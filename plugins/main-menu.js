/**
 * Menu utama: menampilkan semua command yang terdaftar, dikelompokkan per kategori.
 *   .menu            -> seluruh kategori
 *   .menu tools      -> hanya kategori tools
 *   .help sticker    -> detail sebuah command
 */
const handler = async (m, { conn, plugins, config, usedPrefix, text, args }) => {
  const prefix = usedPrefix || config.bot.prefix[0];
  const categories = plugins.categories();
  const total = plugins.size;
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

  const now = new Date();
  const jam = new Intl.DateTimeFormat('id-ID', {
    timeZone: config.bot.timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now);

  const header = [
    `╭─「 *${config.bot.name}* 」`,
    `│ 👤 ${m.pushName || m.sender.split('@')[0]}`,
    `│ 🕒 ${jam}`,
    `│ 📦 ${total} file plugin`,
    `│ 🔑 Prefix: ${config.bot.prefix.join(' ')}`,
    `╰────`,
  ].join('\n');

  const wanted = query ? categories.filter(([tag]) => tag === query) : categories;
  if (!wanted.length) {
    return m.reply(`${header}\n\n❌ Kategori *${query}* tidak ditemukan.\nKategori tersedia: ${categories.map(([tag]) => tag).join(', ')}`);
  }

  const blocks = wanted.map(([tag, entries]) => {
    const names = entries
      .flatMap((entry) => (entry.help.length ? entry.help : entry.commands))
      .filter(Boolean)
      .sort();
    return `╭─「 ${tag.toUpperCase()} (${names.length}) 」\n${names.map((name) => `│ ${prefix}${name}`).join('\n')}\n╰────`;
  });

  const footer = `\n💡 ${prefix}menu <kategori> untuk filter, ${prefix}help <command> untuk detail.`;

  return conn.sendMessage(m.chat, { text: `${header}\n\n${blocks.join('\n')}${footer}` }, { quoted: m });
};

handler.help = ['menu', 'help', 'bantuan'];
handler.tags = ['main'];
handler.command = /^(menu|help|bantuan)$/i;
handler.limit = false;

export default handler;
