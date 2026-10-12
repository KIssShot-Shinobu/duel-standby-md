/**
 * Papan peringkat.
 *   .leaderboard        -> berdasarkan exp
 *   .leaderboard saldo  -> berdasarkan saldo
 */
import { bareNumber } from '../lib/functions.js';

const handler = async (m, { args, db, config }) => {
  const metric = (args[0] || 'exp').toLowerCase();
  const field = ['saldo', 'balance', 'uang'].includes(metric) ? 'saldo' : metric === 'level' ? 'level' : 'exp';

  const users = Object.entries(db.data.users)
    .map(([jid, user]) => ({ jid, value: Number(user[field]) || 0, name: user.name || '' }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  if (!users.length) return m.reply('Belum ada data. Coba klaim dulu: ' + `${config.bot.prefix[0]}daily`);

  const medals = ['🥇', '🥈', '🥉'];
  const rows = users.map(
    (item, index) => `${medals[index] || `${index + 1}.`} ${item.name || bareNumber(item.jid)} — *${item.value.toLocaleString('id-ID')}*`,
  );

  return m.reply(`🏆 *LEADERBOARD ${field.toUpperCase()}*\n\n${rows.join('\n')}`);
};

handler.help = ['leaderboard', 'top'];
handler.tags = ['rpg'];
handler.command = /^(leaderboard|top|peringkat)$/i;
handler.limit = false;

export default handler;
