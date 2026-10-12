/**
 * Hadiah harian.
 *   .daily  -> klaim saldo, limit, dan exp sekali per 24 jam
 */
import { randomInt, clockString } from '../lib/functions.js';
import { refreshLimit } from '../lib/permissions.js';

const COOLDOWN = 24 * 60 * 60 * 1000;

const handler = async (m, { user, db, config }) => {
  const last = user.lastDaily || 0;
  const elapsed = Date.now() - last;
  if (last && elapsed < COOLDOWN) {
    return m.reply(`⏳ Kamu sudah klaim hari ini.\nCoba lagi dalam *${clockString(COOLDOWN - elapsed)}*.`);
  }

  const saldo = randomInt(500, 1500);
  const exp = randomInt(50, 150);
  const bonusLimit = randomInt(1, 5);

  user.lastDaily = Date.now();
  user.saldo = (user.saldo || 0) + saldo;
  user.exp = (user.exp || 0) + exp;
  user.limit = refreshLimit(db, user, config) + bonusLimit;
  user.streak = (user.streak || 0) + (elapsed < COOLDOWN * 2 && last ? 1 : 0);
  db.touch();

  return m.reply(
    [
      '🎁 *HADIAH HARIAN*',
      '',
      `💰 Saldo  : +${saldo}`,
      `✨ Exp    : +${exp}`,
      `🎯 Limit  : +${bonusLimit}`,
      user.streak > 1 ? `🔥 Streak : ${user.streak} hari` : null,
      '',
      `Total saldo: *${user.saldo}* • Total exp: *${user.exp}*`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
};

handler.help = ['daily'];
handler.tags = ['rpg'];
handler.command = /^(daily|harian)$/i;
handler.limit = false;

export default handler;
