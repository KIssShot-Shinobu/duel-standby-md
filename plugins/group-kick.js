/**
 * Keluarkan anggota dari grup.
 *   .kick @user / reply / .kick 628xxxx
 */
import { getTargets, bareNumber } from '../lib/functions.js';
import { isParticipantAdmin } from '../lib/permissions.js';

const handler = async (m, { conn, args, config, groupMetadata }) => {
  const targets = getTargets(m, args).filter((jid) => jid !== conn.user?.id);
  if (!targets.length) return m.reply(`Tag/reply atau tulis nomor.\nContoh: ${config.bot.prefix[0]}kick 628xxxxxxxxxx`);

  const results = [];
  for (const jid of targets) {
    if (isParticipantAdmin(groupMetadata, jid)) {
      results.push(`⚠️ ${bareNumber(jid)} adalah admin, dilewati`);
      continue;
    }
    try {
      await conn.groupParticipantsUpdate(m.chat, [jid], 'remove');
      results.push(`✅ ${bareNumber(jid)} dikeluarkan`);
    } catch (err) {
      results.push(`❌ ${bareNumber(jid)} -> ${err.message}`);
    }
  }
  return m.reply(`*「 KICK 」*\n\n${results.join('\n')}`);
};

handler.help = ['kick'];
handler.tags = ['group'];
handler.command = /^(kick|keluarkan)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.limit = false;

export default handler;
