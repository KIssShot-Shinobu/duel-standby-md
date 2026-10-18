/**
 * Blokir & buka blokir user.
 *
 *   .ban <nomor|mention|reply> [alasan]   -> user diabaikan bot di semua chat
 *   .unban <nomor|mention|reply>          -> buka blokirnya
 *
 * Boleh owner DAN moderator (`handler.mods = true`) — lihat gate di handler.js.
 *
 * Pengaman: moderator tidak boleh menyasar owner atau moderator lain. Tanpa ini
 * satu moderator bisa mengunci owner dari botnya sendiri, dan owner tidak bisa
 * memakai `.unban` karena dirinya sudah diblokir. Owner tetap boleh menyasar
 * siapa pun (dan mengurus daftar moderator lewat `.mod add|del`).
 *
 * Target boleh: nomor (628xx / 08xx), mention (@628xx), atau cukup reply pesan
 * user. Target ber-LID dipetakan ke record nomor telepon lewat `db.resolveIdentity`
 * supaya blokirnya masuk ke record yang benar.
 */
import { isJidUser, resolveUserTarget } from '../lib/functions.js';
// Diimpor dengan nama lain: `isOwner` dari ctx (boolean) akan menutupi fungsi ini.
import { isMods, isOwner as isOwnerJid } from '../lib/permissions.js';
import { userDisplayName } from '../lib/messages.js';

const HELP = (config) => {
  const p = config.bot.prefix[0];
  return [
    '*Blokir user*',
    `${p}ban <nomor> [alasan]   → blokir dari bot`,
    `${p}unban <nomor>          → buka blokirnya`,
    '',
    'Nomor bisa format 628xx, 08xx, atau mention @628xx.',
    'Bisa juga reply pesan user lalu ketik perintahnya.',
    '',
    'Dipakai owner & moderator. Owner/moderator hanya bisa disasar owner.',
  ].join('\n');
};

const handler = async (m, { args, command, config, db, isOwner }) => {
  const { jid: rawTarget, rest } = resolveUserTarget(m, args, { shorthand: false });
  const target = rawTarget ? db.resolveIdentity?.(rawTarget) || rawTarget : rawTarget;
  if (!target || !isJidUser(target)) return m.reply(HELP(config));

  const user = db.user(target);
  const label = userDisplayName(user, target);

  // Pengaman: hanya owner yang boleh menyasar owner / moderator.
  if (!isOwner) {
    const owner = isOwnerJid(target, config);
    const mod = isMods(target, config, user);
    if (owner || mod) {
      return m.reply(`⚠️ *${label}* ${owner ? 'owner' : 'moderator'} bot — hanya owner yang bisa mengubahnya.`);
    }
  }

  if (/^ban$/i.test(command)) {
    if (user.banned) return m.reply(`ℹ️ ${label} sudah diblokir.`);
    user.banned = true;
    user.bannedReason = rest.join(' ') || 'tanpa alasan';
    db.touch();
    await db.save?.(true);
    return m.reply(`🚫 ${label} diblokir. Alasan: ${user.bannedReason}`);
  }

  if (!user.banned) return m.reply(`ℹ️ ${label} memang tidak sedang diblokir.`);
  user.banned = false;
  user.bannedReason = '';
  db.touch();
  await db.save?.(true);
  return m.reply(`✅ Blokir ${label} dibuka.`);
};

handler.help = ['ban', 'unban'];
handler.tags = ['owner'];
handler.command = /^(ban|unban)$/i;
handler.mods = true;
handler.limit = false;

export default handler;
