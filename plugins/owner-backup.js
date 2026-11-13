/**
 * Backup database ke Telegram sekarang juga (tanpa menunggu jadwal).
 *   .backup
 *
 * Konfigurasi di .env:
 *   TELEGRAM_BOT_TOKEN=123:abc
 *   TELEGRAM_CHAT_ID=123456789
 *   BACKUP_INTERVAL_HOURS=6      (jadwal otomatis, lihat main.js)
 */
import { sendDatabaseBackup } from '../lib/backup.js';
import { formatBytes } from '../lib/functions.js';
import { userError } from '../lib/errors.js';

const handler = async (m, { db, config, wait }) => {
  const update = await wait();
  try {
    const { sent, bytes } = await sendDatabaseBackup(db, config);
    const text = `✅ Backup terkirim ke Telegram: ${sent} file (${formatBytes(bytes)}).`;
    if (typeof update === 'function') await update(text);
    else await m.reply(text);
  } catch (err) {
    throw userError(`❌ Gagal backup: ${err.message}`);
  }
};

handler.help = ['backup'];
handler.tags = ['owner'];
handler.command = /^(backup|backupdb)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
