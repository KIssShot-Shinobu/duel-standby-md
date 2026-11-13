/**
 * Backup database ke Telegram secara berkala.
 *
 * Yang dikirim: file database (semua user/chat/rental/sewa) dan memori AI owner
 * bila ada. Kode program tidak ikut (sudah ada di git) dan folder `sessions/`
 * — yang berisi kredensial penuh akun WhatsApp — SENGAJA tidak pernah dikirim.
 *
 * Tanpa dependensi baru: Telegram `sendDocument` dipanggil dengan `fetch` +
 * `FormData` bawaan Node 20+.
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.telegram.org';

/** File yang ikut dibackup (hanya yang benar-benar ada). */
export function backupFiles(config) {
  const daftar = [config?.database?.file, config?.ai?.ownerFile].filter(Boolean);
  return [...new Set(daftar)]
    .map((file) => ({ path: file, name: path.basename(file) }))
    .filter((item) => {
      try {
        return fs.statSync(item.path).isFile();
      } catch {
        return false;
      }
    });
}

/** Alasan backup tidak bisa jalan (kosong = siap). */
export function backupProblem(config) {
  if (!config?.backup?.telegramToken) return 'TELEGRAM_BOT_TOKEN belum diisi di .env';
  if (!config?.backup?.telegramChatId) return 'TELEGRAM_CHAT_ID belum diisi di .env';
  return '';
}

/**
 * Simpan database ke disk lalu kirim tiap file ke Telegram.
 * @returns {Promise<{sent: number, bytes: number}>}
 */
export async function sendDatabaseBackup(db, config, { now = Date.now(), fetchImpl = fetch } = {}) {
  const problem = backupProblem(config);
  if (problem) throw new Error(problem);

  const files = backupFiles(config);
  if (!files.length) throw new Error('file database tidak ditemukan');

  // Pastikan yang dikirim adalah isi terbaru, bukan snapshot debounce.
  await db?.save?.(true);

  const waktu = new Date(now).toLocaleString('id-ID', { timeZone: config?.bot?.timezone || 'Asia/Jakarta' });
  const { telegramToken: token, telegramChatId: chatId } = config.backup;

  let sent = 0;
  let bytes = 0;
  for (const file of files) {
    const buffer = fs.readFileSync(file.path);
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', `🗄️ Backup *${file.name}*\n${waktu}`);
    form.set('parse_mode', 'Markdown');
    form.append('document', new Blob([buffer], { type: 'application/json' }), file.name);

    const res = await fetchImpl(`${API}/bot${token}/sendDocument`, { method: 'POST', body: form });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Telegram menolak (${res.status}): ${detail.slice(0, 200)}`);
    }
    sent += 1;
    bytes += buffer.length;
  }

  return { sent, bytes };
}

export default { backupFiles, backupProblem, sendDatabaseBackup };
