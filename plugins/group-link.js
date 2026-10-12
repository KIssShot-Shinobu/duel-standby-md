/**
 * Tautan undangan grup.
 *   .link          -> tampilkan link
 *   .link reset    -> reset (revoke) link lama
 */
const handler = async (m, { conn, args, config }) => {
  try {
    if ((args[0] || '').toLowerCase() === 'reset') {
      const code = await conn.groupRevokeInvite(m.chat);
      return m.reply(`✅ Link grup berhasil direset:\nhttps://chat.whatsapp.com/${code}`);
    }
    const code = await conn.groupInviteCode(m.chat);
    return m.reply(`🔗 *Link grup ${(await conn.groupMetadata(m.chat)).subject}*\n\nhttps://chat.whatsapp.com/${code}`);
  } catch (err) {
    return m.reply(`Gagal mengambil link: ${err.message}\n\nPastikan bot admin di grup ini. ${config.bot.prefix[0]}link reset untuk membuat link baru.`);
  }
};

handler.help = ['link'];
handler.tags = ['group'];
handler.command = /^(link|linkgc|invite)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.limit = false;

export default handler;
