/**
 * Naikkan / turunkan jabatan anggota grup.
 *   .promote @user
 *   .demote @user
 */
import { getTargets, bareNumber } from '../lib/functions.js';

const handler = async (m, { conn, args, command, config }) => {
  const targets = getTargets(m, args).filter((jid) => jid !== conn.user?.id);
  if (!targets.length) return m.reply(`Contoh: ${config.bot.prefix[0]}${command} @user`);

  const action = /^(promote|naikkan|jadiadmin)$/i.test(command) ? 'promote' : 'demote';
  const label = action === 'promote' ? 'diangkat jadi admin' : 'diturunkan dari admin';

  const results = [];
  for (const jid of targets) {
    try {
      await conn.groupParticipantsUpdate(m.chat, [jid], action);
      results.push(`✅ ${bareNumber(jid)} ${label}`);
    } catch (err) {
      results.push(`❌ ${bareNumber(jid)} -> ${err.message}`);
    }
  }
  user.totalCommands = (user.totalCommands || 0) + 0; // sentuh user (biar konsisten tersimpan)
  return m.reply(`*「 ${action.toUpperCase()} 」*\n\n${results.join('\n')}`);
};

handler.help = ['promote', 'demote'];
handler.tags = ['group'];
handler.command = /^(promote|demote|naikkan|turunkan|jadiadmin)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.limit = false;

export default handler;
