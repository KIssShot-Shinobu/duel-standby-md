/**
 * Naikkan / turunkan jabatan anggota grup.
 *   .promote @user
 *   .demote @user
 */
import { getTargets } from '../lib/functions.js';
import { friendlyNumber, joinLines } from '../lib/messages.js';

const handler = async (m, { conn, args, command, config }) => {
  const targets = getTargets(m, args).filter((jid) => jid !== conn.user?.id);
  if (!targets.length) return m.reply(`Contoh: ${config.bot.prefix[0]}${command} @user`);

  const action = /^(promote|naikkan|jadiadmin)$/i.test(command) ? 'promote' : 'demote';
  const label = action === 'promote' ? 'diangkat jadi admin' : 'diturunkan dari admin';

  const results = [];
  for (const jid of targets) {
    try {
      await conn.groupParticipantsUpdate(m.chat, [jid], action);
      results.push(`${friendlyNumber(jid)} ${label}.`);
    } catch (e) {
      results.push(`${friendlyNumber(jid)} gagal: ${e.message}`);
    }
  }
  return m.reply(joinLines(`*${action.charAt(0).toUpperCase() + action.slice(1)} selesai*\n\n${results.join('\n')}`));
};

handler.help = ['promote', 'demote'];
handler.tags = ['group'];
handler.command = /^(promote|demote|naikkan|turunkan|jadiadmin)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.limit = false;

export default handler;
