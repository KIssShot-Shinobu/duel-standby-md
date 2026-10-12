/**
 * Kredit & terima kasih.
 *   .tqto / .credit
 */
const handler = async (m, { config }) => {
  return m.reply(
    [
      `╭─「 *CREDIT* 」`,
      '│',
      '│ 🙏 Allah SWT',
      '│ 👨‍👩‍👦 Orang tua & keluarga',
      `│ 🧑‍💻 Owner: ${config.bot.ownerName}`,
      '│ 📚 Baileys (WhiskeySockets) — library WhatsApp',
      '│ 🧬 wabot-aq / RTXZY-MD — inspirasi arsitektur plugin',
      '│ 🎨 picocolors, pino, yt-search, node-webpmux',
      '│ 💬 Semua yang memakai & mengembangkan bot ini',
      '│',
      '│ ⚠️ Bot ini hasil tulis ulang bersih (clean-room),',
      '│    bukan salinan kode repo lain.',
      '╰────────────',
    ].join('\n'),
  );
};

handler.help = ['tqto', 'credit'];
handler.tags = ['info'];
handler.command = /^(tqto|credit|thanks)$/i;
handler.limit = false;

export default handler;
