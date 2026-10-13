/**
 * Info bot & info user.
 *   .info            -> info bot
 *   .profile         -> profil sendiri (level, limit, exp, saldo)
 *   .profile 628xx   -> profil user lain (owner; bisa juga mention/reply)
 *   .daftar Nama.20  -> registrasi user
 */
import { bareNumber, resolveUserTarget } from '../lib/functions.js';
import { userError } from '../lib/errors.js';
import { hasFfmpeg, hasYtDlp } from '../lib/media.js';
import { isPremiumUser, levelProgress, refreshLimit } from '../lib/permissions.js';
import { profileText, botInfo, ok, err, friendlyNumber } from '../lib/messages.js';

const handler = async (m, { conn, text, args, command, config, db, plugins, user, runtime, chatData, isOwner }) => {
  if (/^(daftar|register|reg)$/i.test(command)) {
    if (user.registered) return m.reply(err('Kamu udah terdaftar kok.', m));
    const [name, age] = String(text || '').split('.');
    if (!name) return m.reply(`Contoh: ${config.bot.prefix[0]}daftar NamaKamu.20`);
    user.name = name.trim().slice(0, 40);
    user.age = Number(age) || -1;
    user.registered = true;
    db.touch();
    return m.reply(ok(`Registrasi berhasil!\n\nNama: *${user.name}*\nUmur: *${user.age < 0 ? '-' : user.age}*`));
  }

  if (/^(profile|profil|me)$/i.test(command)) {
    const requested = resolveUserTarget(m, args || [], { shorthand: false }).jid;
    const targetJid = requested ? db.resolveIdentity?.(requested) || requested : m.sender;
    const selfJid = db.resolveLid?.(m.sender) || m.sender;
    const isSelf = targetJid === selfJid;

    if (!isSelf && !isOwner) {
      throw userError('Hanya owner bot yang bisa liat profil user lain.');
    }

    const profile = isSelf ? user : db.user(targetJid);
    const progress = levelProgress(profile.exp || 0);
    const bonus = Math.max(0, Number(profile.limitBonus) || 0);
    const premiumActive = isPremiumUser(profile, profile.jid || targetJid, config);
    const limit = refreshLimit(db, profile, config);
    const quota = (premiumActive ? config.limits.premium : config.limits.free) + bonus;
    const until =
      Number(profile.premiumUntil) > Date.now()
        ? new Date(profile.premiumUntil).toLocaleDateString('id-ID', { timeZone: config.bot.timezone })
        : '';
    const total = db.stats();
    const rank =
      Object.values(db.data.users)
        .map((item) => item.exp || 0)
        .sort((a, b) => b - a)
        .indexOf(profile.exp || 0) + 1;
    const other = !isSelf;

    return m.reply(
      profileText({
        name: profile.name || (isSelf ? m.pushName : friendlyNumber(targetJid)) || '-',
        age: profile.age,
        registered: profile.registered,
        premium: premiumActive,
        until,
        level: progress.level,
        exp: profile.exp,
        limit,
        quota,
        saldo: profile.saldo,
        rank: rank > 0 ? rank : 0,
        totalUsers: total.users,
        totalCommands: profile.totalCommands,
        banned: profile.banned ? { reason: profile.bannedReason } : null,
        isSelf,
        limitBonus: bonus,
      }, m),
      m.chat,
      // `m.reply(payload, chatTarget, options)` — objek opsi WAJIB di argumen
      // ketiga; dulu dikirim sebagai argumen kedua sehingga chat tujuan berisi
      // objek `{ mentions }` dan pesan gagal terkirim di WhatsApp asli.
      other ? { mentions: [targetJid] } : {},
    );
  }

  const stats = db.stats();
  return m.reply(
    botInfo({
      name: config.bot.name,
      version: config.version,
      ownerName: config.bot.ownerName,
      pluginCount: plugins.size,
      commandCount: plugins.commands.length,
      userCount: stats.users,
      chatCount: stats.chats,
      messageCount: stats.messages,
      prefix: config.bot.prefix,
      mode: config.bot.mode,
      nodeVersion: process.version,
      ffmpeg: hasFfmpeg(),
      ytdlp: hasYtDlp(config.ytdlp.path),
      connected: runtime?.connected,
    }, m) + '\n\n' +
    `_Grup ini: welcome=${chatData.welcome ? 'on' : 'off'}, antilink=${chatData.antiLink ? 'on' : 'off'}, antispam=${chatData.antiSpam ? 'on' : 'off'}_`
  );
};

handler.help = ['info', 'profile', 'profil', 'daftar'];
handler.tags = ['main'];
handler.command = /^(info|profile|profil|me|daftar|register|reg)$/i;
handler.limit = false;

export default handler;
