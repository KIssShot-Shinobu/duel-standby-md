/**
 * Restart bot (dijalankan ulang oleh supervisor index.js).
 *   .restart
 */
const handler = async (m, { db }) => {
  await m.reply('♻️ Restart bot...').catch(() => {});
  await db.save(true).catch(() => {});

  if (typeof process.send === 'function') {
    process.send('restart');
    return;
  }
  // Tanpa supervisor: keluar dan biarkan process manager (pm2/panel) menyalakan ulang.
  setTimeout(() => process.exit(0), 500);
};

handler.help = ['restart'];
handler.tags = ['owner'];
handler.command = /^(restart|reboot)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
