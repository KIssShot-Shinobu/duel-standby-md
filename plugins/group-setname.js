/**
 * Ubah nama grup.
 *   .setname Nama Baru
 */
const handler = async (m, { conn, text, config }) => {
  if (!text) return m.reply(`Contoh: ${config.bot.prefix[0]}setname Grup Keren`);
  if (text.length > 100) return m.reply('Nama grup maksimal 100 karakter.');
  await conn.groupUpdateSubject(m.chat, text.trim());
  return m.reply(`✅ Nama grup diubah menjadi *${text.trim()}*`);
};

handler.help = ['setname'];
handler.tags = ['group'];
handler.command = /^(setname|setsubject)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.limit = false;

export default handler;
