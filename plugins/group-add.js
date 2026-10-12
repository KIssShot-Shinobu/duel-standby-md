/**
 * Tambah anggota ke grup.
 *   .add 628xxxx
 */
import { getTargets, bareNumber } from '../lib/functions.js';

const handler = async (m, { conn, args, config }) => {
  const targets = getTargets(m, args);
  if (!targets.length) return m.reply(`Contoh: ${config.bot.prefix[0]}add 628xxxxxxxxxx`);

  const results = [];
  for (const jid of targets) {
    try {
      const response = await conn.groupParticipantsUpdate(m.chat, [jid], 'add');
      const status = response?.[0]?.status ?? 'ok';
      results.push(`✅ ${bareNumber(jid)} -> ${status}`);
    } catch (err) {
      results.push(`❌ ${bareNumber(jid)} -> ${err.message}`);
    }
  }
  return m.reply(`*「 TAMBAH ANGGOTA 」*\n\n${results.join('\n')}`);
};

handler.help = ['add'];
handler.tags = ['group'];
handler.command = /^(add|tambah)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.limit = false;

export default handler;
