/**
 * Saklar bot per grup.
 *
 *   .bot          -> status sekarang (ON/OFF)
 *   .bot on|off   -> nyalakan / matikan bot DI GRUP INI
 *
 * Saat OFF, `chat.mute` aktif: bot tidak membalas member sama sekali dan tidak
 * memberi hadiah XP (lihat handler.js). Admin grup & owner tetap dilayani —
 * justru itu satu-satunya jalan menyalakannya kembali.
 *
 * Fitur penjaga grup (welcome/pamit, antilink, antispam) sengaja TETAP jalan:
 * yang berhenti hanya respons bot terhadap member.
 *
 * Dijalankan admin grup, sama seperti `.welcome on` dan saklar grup lain.
 */
const handler = async (m, { args, chatData, db, config }) => {
  const choice = String(args[0] || '').toLowerCase();
  const p = config.bot.prefix[0];

  if (!['on', 'off'].includes(choice)) {
    return m.reply(
      `*bot* di grup ini saat ini: *${chatData.mute ? 'OFF' : 'ON'}*\n\nUbah dengan: ${p}bot on|off (admin grup)`,
    );
  }

  chatData.mute = choice === 'off';
  db.touch();

  return m.reply(
    chatData.mute
      ? `❌ *Bot dimatikan untuk grup ini.*\nMember tidak dibalas sampai dinyalakan lagi. Admin grup masih bisa: ${p}bot on`
      : '✅ *Bot dinyalakan untuk grup ini.*',
  );
};

handler.help = ['bot'];
handler.tags = ['group'];
handler.command = /^bot$/i;
handler.group = true;
handler.admin = true;
handler.limit = false;

export default handler;
