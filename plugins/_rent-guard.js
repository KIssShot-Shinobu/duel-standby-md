/**
 * Tawaran sewa otomatis: saat bot ditambahkan ke grup, kirim QRIS + info sewa
 * ke yang menambahkan (via DM). Berjalan lewat hook `onGroupParticipants`
 * (action 'add' dan bot termasuk peserta yang ditambahkan).
 */
import fs from 'node:fs';
import { cleanJid } from '../lib/functions.js';
import * as Rent from '../lib/rent.js';

const handler = {};

handler.onGroupParticipants = async (conn, update, { groupMetadata, config, db } = {}) => {
  if (config?.rent?.enabled === false) return;
  if (update?.action !== 'add') return;

  const bot = conn?.user?.id;
  const added = update?.participants || [];
  if (!bot || !added.some((jid) => cleanJid(jid) === cleanJid(bot))) return;

  const adder = update?.author;
  if (!adder) return;

  const s = Rent.rentSettings(db || { data: {} }, config);
  const price = s.pricePerMonth ? `Rp${s.pricePerMonth.toLocaleString('id-ID')} / bulan` : '(harga diumumkan owner)';
  const subject = groupMetadata?.subject || 'grup ini';
  const p = config?.bot?.prefix?.[0] || '.';

  const text = [
    `🎫 Bot masuk ke grup *${subject}*!`,
    '',
    `💰 Sewa  : ${price}`,
    `🗓️ Durasi: ${s.days} hari`,
    '',
    'Fitur bot di grup ini masih *terkunci* sampai grup disewa.',
    'Untuk menyewa, kirim ini ke bot lewat DM:',
    '',
    `${p}rent ${subject}`,
    '',
    'Bot akan mengirim QRIS & instruksi pembayaran.',
  ].join('\n');

  let image = null;
  try {
    if (fs.existsSync(s.qrisPath)) image = fs.readFileSync(s.qrisPath);
  } catch {
    /* QRIS opsional */
  }

  try {
    if (image) await conn.sendMessage(adder, { image, caption: text });
    else await conn.sendMessage(adder, { text });
  } catch {
    /* DM ke pengguna bisa gagal — jangan sampai menjatuhkan event */
  }
};

export default handler;