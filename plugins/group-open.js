/**
 * Buka / tutup grup.
 *   .open   -> semua anggota bisa kirim pesan
 *   .close  -> hanya admin
 */
const handler = async (m, { conn, command }) => {
  const open = /^(open|buka)$/i.test(command);
  await conn.groupSettingUpdate(m.chat, open ? 'not_announcement' : 'announcement');
  return m.reply(open ? '🔓 Grup dibuka, semua anggota bisa mengirim pesan.' : '🔒 Grup ditutup, hanya admin yang bisa mengirim pesan.');
};

handler.help = ['open', 'close'];
handler.tags = ['group'];
handler.command = /^(open|close|buka|tutup)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.limit = false;

export default handler;
