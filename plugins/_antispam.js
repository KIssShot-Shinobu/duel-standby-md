/**
 * Anti-spam sederhana: batasi jumlah pesan per user dalam jendela waktu.
 * Diaktifkan per grup: .antispam on
 *
 * Ambang batas bisa diatur lewat env:
 *   ANTISPAM_WINDOW_MS (default 5000)
 *   ANTISPAM_MAX       (default 6)
 *   ANTISPAM_MAX_WARN  (default 3) -> setelah itu dikeluarkan (kalau bot admin)
 */
import { sleep } from '../lib/functions.js';

const WINDOW = Number(process.env.ANTISPAM_WINDOW_MS) || 5000;
const MAX_MESSAGES = Number(process.env.ANTISPAM_MAX) || 6;
const MAX_WARN = Number(process.env.ANTISPAM_MAX_WARN) || 3;

const tracker = new Map(); // sender -> { count, firstAt, lastNoticeAt }

const handler = {};
handler.before = async (m, { conn, db, chatData, isBotAdmin, isOwner, isAdmin }) => {
  if (!m.isGroup || m.fromMe || !chatData.antiSpam || isOwner || isAdmin) return true;

  const now = Date.now();
  const entry = tracker.get(m.sender) || { count: 0, firstAt: now, lastNoticeAt: 0 };
  if (now - entry.firstAt > WINDOW) {
    entry.count = 0;
    entry.firstAt = now;
  }
  entry.count += 1;
  tracker.set(m.sender, entry);

  if (tracker.size > 2000) tracker.clear(); // jaga memori

  if (entry.count <= MAX_MESSAGES) return true;

  const user = db.user(m.sender);
  // beri tahu maksimal sekali per jendela waktu
  if (now - entry.lastNoticeAt > WINDOW) {
    entry.lastNoticeAt = now;
    user.warn = (user.warn || 0) + 1;
    db.touch();

    const teks = `⚠️ *ANTI SPAM*\n\n*${m.pushName || m.sender.split('@')[0]}* terlalu banyak mengirim pesan.\nPeringatan: ${user.warn}/${MAX_WARN}`;

    if (user.warn >= MAX_WARN) {
      user.warn = 0;
      db.touch();
      await m.reply(`${teks}\n\n🚪 Kamu dikeluarkan dari grup.`);
      if (isBotAdmin) {
        await sleep(500);
        await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {});
      }
      return false;
    }

    await m.reply(teks);
  }

  return false; // jangan proses pesan spam
};

export default handler;
