/**
 * Info bot & info user.
 *   .info         -> info bot
 *   .profile      -> profil user (level, limit, exp, saldo)
 *   .daftar Nama.20 -> registrasi user
 */
import { hasFfmpeg, hasYtDlp } from '../lib/media.js';
import { levelProgress, refreshLimit } from '../lib/permissions.js';

const handler = async (m, { conn, text, command, config, db, plugins, user, runtime, chatData }) => {
  if (/^(daftar|register|reg)$/i.test(command)) {
    if (user.registered) return m.reply('_Kamu sudah terdaftar._');
    const [name, age] = String(text || '').split('.');
    if (!name) return m.reply(`Contoh: ${config.bot.prefix[0]}daftar NamaKamu.20`);
    user.name = name.trim().slice(0, 40);
    user.age = Number(age) || -1;
    user.registered = true;
    db.touch();
    return m.reply(`✅ Registrasi berhasil!\n\nNama: *${user.name}*\nUmur: *${user.age < 0 ? '-' : user.age}*`);
  }

  if (/^(profile|profil|me)$/i.test(command)) {
    const progress = levelProgress(user.exp || 0);
    const limit = refreshLimit(db, user, config);
    const total = db.stats();
    const rank = Object.values(db.data.users)
      .map((item) => item.exp || 0)
      .sort((a, b) => b - a)
      .indexOf(user.exp || 0) + 1;

    return m.reply(
      [
        `╭─「 *PROFIL* 」`,
        `│ 🧑 Nama    : ${user.name || m.pushName || '-'}`,
        `│ 🎂 Umur    : ${user.age < 0 ? '-' : user.age}`,
        `│ 📛 Status  : ${user.registered ? 'terdaftar' : 'belum terdaftar'}`,
        `│ 💎 Premium : ${user.premium ? 'ya' : 'tidak'}`,
        `│ 🏆 Level   : ${progress.level} (${progress.percent}%)`,
        `│ ✨ Exp     : ${user.exp}`,
        `│ 🎯 Limit   : ${limit}/${user.premium ? config.limits.premium : config.limits.free}`,
        `│ 💰 Saldo   : ${user.saldo}`,
        `│ ⚔️ Rank    : ${rank > 0 ? rank : '-'} dari ${total.users}`,
        `│ ⌨️ Command : ${user.totalCommands}`,
        `╰────────────`,
      ].join('\n'),
    );
  }

  const stats = db.stats();
  return m.reply(
    [
      `╭─「 *${config.bot.name}* 」`,
      `│ 🤖 Nama      : ${config.bot.name}`,
      `│ 🏷️ Versi     : ${config.version}`,
      `│ 👑 Owner     : ${config.bot.ownerName} (${config.bot.owners.join(', ') || '-'})`,
      `│ 🧩 Plugin    : ${plugins.size} file / ${plugins.commands.length} command`,
      `│ 👥 User      : ${stats.users}`,
      `│ 💬 Chat      : ${stats.chats}`,
      `│ 📨 Pesan     : ${stats.messages}`,
      `│ 🔑 Prefix    : ${config.bot.prefix.join(' ')}`,
      `│ 🎚️ Mode      : ${config.bot.mode}`,
      `│ 🧠 Node.js   : ${process.version}`,
      `│ 🎞️ ffmpeg    : ${hasFfmpeg() ? 'tersedia' : 'tidak ada'}`,
      `│ 🎬 yt-dlp    : ${hasYtDlp(config.ytdlp.path) ? 'tersedia' : 'tidak ada'}`,
      `│ 🔗 Koneksi   : ${runtime?.connected ? 'terhubung' : 'terputus'}`,
      `╰────────────`,
      '',
      `_Grup ini: welcome=${chatData.welcome ? 'on' : 'off'}, antilink=${chatData.antiLink ? 'on' : 'off'}, antispam=${chatData.antiSpam ? 'on' : 'off'}_`,
    ].join('\n'),
  );
};

handler.help = ['info', 'profile', 'profil', 'daftar'];
handler.tags = ['main'];
handler.command = /^(info|profile|profil|me|daftar|register|reg)$/i;
handler.limit = false;

export default handler;
