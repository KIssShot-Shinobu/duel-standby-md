/**
 * Manajemen user oleh owner.
 *   .premium add|del 628xx [hari]
 *   .ban 628xx [alasan]
 *   .unban 628xx
 *   .limit add|del 628xx 10
 *   .resetlimit 628xx
 */
import { toJid, bareNumber } from '../lib/functions.js';
import { refreshLimit } from '../lib/permissions.js';

const handler = async (m, { conn, args, command, config, db }) => {
  const action = (args[0] || '').toLowerCase();
  const rawTarget = args[1];
  if (!rawTarget) {
    return m.reply(
      [
        '*Manajemen user*',
        `${config.bot.prefix[0]}premium add|del <nomor> [hari]`,
        `${config.bot.prefix[0]}ban <nomor> [alasan]`,
        `${config.bot.prefix[0]}unban <nomor>`,
        `${config.bot.prefix[0]}limit add|del <nomor> <jumlah>`,
        `${config.bot.prefix[0]}resetlimit <nomor>`,
        '',
        'Nomor bisa format 628xx atau 08xx.',
      ].join('\n'),
    );
  }

  const target = toJid(rawTarget);
  const user = db.user(target);

  if (/^limit$/i.test(command)) {
    const amount = Math.abs(Number(args[2]) || 0);
    if (!['add', 'del'].includes(action) || !amount) {
      return m.reply(`Format: ${config.bot.prefix[0]}limit add|del ${bareNumber(target)} 10`);
    }
    user.limit = Math.max(0, (user.limit || 0) + (action === 'add' ? amount : -amount));
    db.touch();
    return m.reply(`✅ Limit ${bareNumber(target)} sekarang *${user.limit}*`);
  }

  if (/^(premium)$/i.test(command)) {
    if (!['add', 'del'].includes(action)) {
      return m.reply(`Format: ${config.bot.prefix[0]}premium add|del ${bareNumber(target)} [hari]`);
    }
    if (action === 'add') {
      const days = Number(args[2]) || config.limits.premiumDays;
      user.premium = true;
      user.premiumUntil = Date.now() + days * 86400000;
      db.touch();
      return m.reply(`✅ ${bareNumber(target)} sekarang *premium* selama ${days} hari.`);
    }
    user.premium = false;
    user.premiumUntil = 0;
    db.touch();
    return m.reply(`✅ Premium ${bareNumber(target)} dicabut.`);
  }

  if (/^(ban)$/i.test(command)) {
    user.banned = true;
    user.bannedReason = args.slice(2).join(' ') || 'tanpa alasan';
    db.touch();
    return m.reply(`🚫 ${bareNumber(target)} diblokir. Alasan: ${user.bannedReason}`);
  }

  if (/^(unban)$/i.test(command)) {
    user.banned = false;
    user.bannedReason = '';
    db.touch();
    return m.reply(`✅ Blokir ${bareNumber(target)} dibuka.`);
  }

  if (/^(resetlimit)$/i.test(command)) {
    user.lastLimitReset = 0;
    const limit = refreshLimit(db, user, config);
    db.touch();
    return m.reply(`✅ Limit ${bareNumber(target)} direset menjadi *${limit}*`);
  }

  return m.reply('Command tidak dikenali.');
};

handler.help = ['premium', 'ban', 'unban', 'limit', 'resetlimit'];
handler.tags = ['owner'];
handler.command = /^(premium|ban|unban|limit|resetlimit)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
