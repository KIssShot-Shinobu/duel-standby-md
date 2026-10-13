/**
 * Keluarkan anggota dari grup (admin only).
 *   .gkick @user / reply / .gkick 628xxxx
 *   .groupkick @user / .keluarkan @user
 */
import { getTargets } from '../lib/functions.js';
import { isParticipantAdmin } from '../lib/permissions.js';
import { friendlyNumber, joinLines } from '../lib/messages.js';

const handler = async (m, { conn, args, config, groupMetadata }) => {
  const targets = getTargets(m, args).filter((jid) => jid !== conn.user?.id);
  if (!targets.length) {
    return m.reply(`Tag/reply atau tulis nomornya.\nContoh: ${config.bot.prefix[0]}gkick 628xxxxxxxxxx`);
  }

  const results = [];
  for (const jid of targets) {
    if (isParticipantAdmin(groupMetadata, jid)) {
      results.push(`${friendlyNumber(jid)} admin, jadi dilewatin aja.`);
      continue;
    }
    try {
      await conn.groupParticipantsUpdate(m.chat, [jid], 'remove');
      results.push(`${friendlyNumber(jid)} udah dikeluarkan.`);
    } catch (e) {
      results.push(`${friendlyNumber(jid)} gagal: ${e.message}`);
    }
  }
  return m.reply(joinLines(`*Kick selesai*\n\n${results.join('\n')}`));
};

handler.help = ['gkick', 'groupkick', 'keluarkan'];
handler.tags = ['group'];
handler.command = /^(gkick|groupkick|keluarkan)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.limit = false;

export default handler;
