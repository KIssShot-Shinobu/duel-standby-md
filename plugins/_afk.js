/**
 * AFK (away from keyboard).
 *   .afk alasan     -> tandai AFK
 *   otomatis        -> dibatalkan saat pengirim mengirim pesan lagi,
 *                      dan orang yang men-tag kamu akan diberi tahu.
 */
import { clockString } from '../lib/functions.js';

const handler = async (m, { args, user, db }) => {
  user.afk = Date.now();
  user.afkReason = args.join(' ').trim();
  db.touch();
  return m.reply(`😴 *AFK*${user.afkReason ? `\nAlasan: ${user.afkReason}` : '\nTanpa alasan'}\n\nAFK akan otomatis berakhir saat kamu mengirim pesan.`);
};

handler.before = async (m, { db, config }) => {
  if (m.fromMe) return true;

  const sender = db.user(m.sender);
  if (sender.afk > -1) {
    const duration = clockString(Date.now() - sender.afk);
    sender.afk = -1;
    const reason = sender.afkReason || '';
    sender.afkReason = '';
    db.touch();
    await m.reply(`👋 Selamat datang kembali!\nKamu AFK selama *${duration}*${reason ? ` (${reason})` : ''}.`);
  }

  const jids = [...new Set([...(m.mentionedJid || []), ...(m.quoted?.sender ? [m.quoted.sender] : [])])];
  for (const jid of jids) {
    if (jid === m.sender) continue;
    const target = db.data.users[jid];
    if (!target || !target.afk || target.afk < 0) continue;
    const duration = clockString(Date.now() - target.afk);
    await m.reply(
      `⚠️ *@${jid.split('@')[0]}* sedang AFK${target.afkReason ? ` (${target.afkReason})` : ''} selama *${duration}*.\nJangan di-tag dulu ya 🙏`,
      m.chat,
      { mentions: [jid] },
    ).catch(() => {});
  }
  return true;
};

handler.help = ['afk'];
handler.tags = ['event'];
handler.command = /^(afk)$/i;
handler.limit = false;

export default handler;
