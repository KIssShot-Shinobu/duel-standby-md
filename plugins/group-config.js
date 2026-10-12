/**
 * Saklar fitur per grup.
 *   .antilink on|off     -> hapus & tendang pengirim link grup lain
 *   .antispam on|off     -> batasi spam pesan beruntun
 *   .welcome on|off      -> pesan selamat datang / pamit
 *   .detect on|off       -> notifikasi perubahan info grup
 */
const handler = async (m, { args, command, chatData, db, config, user, isOwner }) => {
  const choice = (args[0] || '').toLowerCase();
  const map = {
    antilink: 'antiLink',
    antispam: 'antiSpam',
    welcome: 'welcome',
    detect: 'detect',
  };
  const key = map[command.toLowerCase()];
  if (!key) return m.reply('Fitur tidak dikenali.');

  if (!['on', 'off'].includes(choice)) {
    return m.reply(
      `*${command}* saat ini: *${chatData[key] ? 'ON' : 'OFF'}*\n\nUbah dengan: ${config.bot.prefix[0]}${command} on|off${isOwner && key === 'welcome' ? '' : ' (admin grup)'}`,
    );
  }

  chatData[key] = choice === 'on';
  if (key === 'antispam') user.warn = 0;
  db.touch();
  return m.reply(`${chatData[key] ? '✅' : '❌'} *${command}* ${chatData[key] ? 'diaktifkan' : 'dimatikan'} untuk grup ini.`);
};

handler.help = ['antilink', 'antispam', 'welcome', 'detect'];
handler.tags = ['group'];
handler.command = /^(antilink|antispam|welcome|detect)$/i;
handler.group = true;
handler.admin = true;
handler.limit = false;

export default handler;
