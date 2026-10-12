/**
 * Ubah mode bot: self (hanya owner) atau public.
 *   .mode            -> lihat mode
 *   .mode self|public
 */
const handler = async (m, { args, config, db }) => {
  const current = config.bot.mode;
  const choice = (args[0] || '').toLowerCase();

  if (!choice) {
    return m.reply(`Mode bot saat ini: *${current}*\n\nUbah dengan: ${config.bot.prefix[0]}mode self|public`);
  }
  if (!['self', 'public'].includes(choice)) {
    return m.reply('Pilihan hanya *self* atau *public*.');
  }

  config.bot.mode = choice;
  db.data.settings.mode = choice;
  db.data.settings.self = choice === 'self';
  db.touch();
  await db.save(true);

  return m.reply(`✅ Mode bot diubah ke *${choice}*.${choice === 'self' ? '\nHanya owner & mods yang dilayani.' : ''}`);
};

handler.help = ['mode'];
handler.tags = ['owner'];
handler.command = /^mode$/i;
handler.owner = true;
handler.limit = false;

export default handler;
