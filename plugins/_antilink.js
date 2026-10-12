/**
 * Anti-link: hapus & keluarkan pengirim tautan grup WhatsApp lain.
 * Diaktifkan per grup: .antilink on
 *
 * Event plugin (handler.before) — dijalankan sebelum command apa pun.
 */
const GROUP_LINK = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i;
const OTHER_LINKS = /(https?:\/\/)?(www\.)?(t\.me|telegram\.me|bit\.ly|tinyurl\.com|s.id|linktr\.ee)\//i;

const handler = {};
handler.before = async (m, { conn, chatData, config, isBotAdmin, isAdmin }) => {
  if (!m.isGroup || m.fromMe || !chatData.antiLink) return true;

  const text = `${m.text || ''} ${m.msg?.caption || ''}`;
  if (!GROUP_LINK.test(text) && !OTHER_LINKS.test(text)) return true;

  const senderName = m.pushName || m.sender.split('@')[0];
  await m.reply(`🚫 *ANTI LINK*\n\n*${senderName}* mengirim tautan yang tidak diizinkan.\nPesan dihapus${isBotAdmin && !isAdmin ? ' dan kamu dikeluarkan' : ''}.`);

  if (isAdmin) {
    await m.reply('ℹ️ Kamu admin, jadi tidak dikeluarkan. Tapi pesannya tetap dihapus.');
  }

  if (!isBotAdmin) {
    await m.reply('ℹ️ Jadikan bot admin agar bisa menghapus & mengeluarkan otomatis.');
    return true;
  }

  await m.delete().catch(() => {});

  if (!isAdmin && GROUP_LINK.test(text)) {
    await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {});
  }
  return true;
};

export default handler;
