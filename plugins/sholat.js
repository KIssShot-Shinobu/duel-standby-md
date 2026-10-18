/**
 * Jadwal sholat via DM.
 *   .sholat daftar <daerah>  -> berlangganan pengingat tiap waktu sholat
 *   .sholat jadwal           -> jadwal hari ini untuk daerah yang dilanggan
 *   .sholat stop             -> berhenti berlangganan
 *
 * Plugin ini hanya mengurus pendaftaran dan menampilkan jadwal. Pengiriman DM
 * saat waktu sholat tiba dilakukan sweep berkala di `main.js` (lihat
 * `lib/sholat.js`), supaya tetap jalan walau user tidak sedang chat.
 */
import {
  formatTimes,
  getSubscription,
  localParts,
  resolveCity,
  sendTargetFor,
  subscribe,
  timezoneForCity,
  unsubscribe,
} from '../lib/sholat.js';
import { fetchCities, fetchDayTimes } from '../lib/sholat-source.js';

const HELP = [
  '🕌 *JADWAL SHOLAT*',
  '',
  'Bot mengirim DM tiap waktu sholat tiba (Subuh, Dzuhur, Ashar, Maghrib, Isya).',
  '',
  '• `.sholat daftar <daerah>` — berlangganan, contoh: `.sholat daftar makassar`',
  '• `.sholat jadwal` — jadwal hari ini',
  '• `.sholat stop` — berhenti berlangganan',
].join('\n');

const GAGAL_AMBIL = '⚠️ Jadwal sholat sedang tidak bisa diambil. Coba lagi sebentar lagi.';

/** Tanggal lokal kota si pelanggan — bukan tanggal server. */
const tanggalLokal = (timezone) => localParts(new Date(), timezone).date;

async function daftar(m, { args, db, config }, jid) {
  const query = args.slice(1).join(' ').trim();
  if (!query) return m.reply('Sebutkan daerahnya, contoh: `.sholat daftar makassar`');

  let cities;
  try {
    cities = await fetchCities(config);
  } catch {
    return m.reply(GAGAL_AMBIL);
  }

  const found = resolveCity(cities, query);
  if (!found) {
    return m.reply(`Daerah *${query}* tidak ditemukan.\nContoh: \`.sholat daftar makassar\``);
  }

  if (found.ambiguous) {
    const max = Number(config.sholat?.maxCandidates) || 10;
    const tampil = found.ambiguous.slice(0, max);
    const baris = tampil.map((city) => `• ${city.name} (${city.id})`);
    const sisa = found.ambiguous.length - tampil.length;
    if (sisa > 0) baris.push(`…dan ${sisa} lainnya`);

    const saran = sisa > 0 ? ['', `Nama *${query}* terlalu umum. Tulis lebih lengkap, mis. \`kota bandung\`.`] : [];

    return m.reply(
      [
        `Nama *${query}* cocok di ${found.ambiguous.length} daerah. Pakai id yang benar:`,
        '',
        ...baris,
        ...saran,
        '',
        `Contoh: \`.sholat daftar ${tampil[0].id}\``,
      ].join('\n'),
    );
  }

  const city = found.city;
  const timezone = timezoneForCity(city.id);
  if (!timezone) return m.reply(`Daerah *${city.name}* belum didukung.`);

  // Zona waktu sudah dipastikan di atas, jadi `subscribe` selalu berhasil
  // (keduanya memakai tabel `PROVINCE_TZ` yang sama).
  let day;
  try {
    day = await fetchDayTimes(config, city.id, tanggalLokal(timezone));
  } catch {
    return m.reply(GAGAL_AMBIL);
  }

  // Alamat kirim = chat yang WhatsApp pakai untuk DM ini (`m.chat`, biasanya
  // `…@lid`). Dari grup jangan dipakai: pengingatnya nanti masuk ke grup.
  const record = subscribe(db, jid, city, { sendTo: m.isGroup ? null : m.chat });

  return m.reply(
    [
      formatTimes(record, day.times),
      '',
      `✅ Kamu berlangganan *${city.name}*. Pengingat dikirim ke DM (chat pribadi) ini.`,
      'Berhenti kapan saja: `.sholat stop`',
    ].join('\n'),
  );
}

async function jadwal(m, { db, config }, jid) {
  const record = getSubscription(db, jid);
  if (!record) {
    return m.reply(`Kamu belum berlangganan jadwal sholat.\nContoh: \`.sholat daftar makassar\``);
  }

  try {
    const day = await fetchDayTimes(config, record.cityId, tanggalLokal(record.timezone));
    return m.reply(formatTimes(record, day.times));
  } catch {
    return m.reply(GAGAL_AMBIL);
  }
}

function status(m, db, jid) {
  const record = getSubscription(db, jid);
  const baris = record ? `📍 Kamu berlangganan *${record.cityName}*.` : 'Kamu belum berlangganan.';
  return m.reply(`${HELP}\n\n${baris}`);
}

function berhenti(m, db, jid) {
  const dihapus = unsubscribe(db, jid);
  return m.reply(
    dihapus ? '✅ Langganan jadwal sholat dihentikan.' : 'ℹ️ Kamu memang belum berlangganan.',
  );
}

/**
 * Segarkan alamat kirim dari chat yang WhatsApp pakai sekarang.
 *
 * Record yang dibuat sebelum perbaikan menyimpan nomor telepon, dan kiriman ke
 * nomor tidak terantar di era LID. User yang mengetik `.sholat` apa pun
 * memperbaikinya sendiri, tanpa perlu `.sholat stop` lalu daftar ulang.
 */
function segarkanAlamatKirim(db, jid, m) {
  const record = getSubscription(db, jid);
  if (!record || m?.isGroup) return;
  const chat = String(m?.chat || '');
  if (!chat.endsWith('@lid') || record.sendTo === chat) return;
  record.sendTo = chat;
  db.touch?.();
}

/**
 * Owner: buktikan jalur DM pengingat sekarang juga, tanpa menunggu waktu sholat.
 * Mengirim persis seperti sweep (tanpa kutipan) lalu melaporkan hasilnya —
 * termasuk alasan aslinya kalau gagal, supaya bisa didiagnosis.
 */
async function ujiKirim(m, { conn, db, isOwner }, jid) {
  if (!isOwner) return m.reply('Perintah ini khusus owner.');
  const record = getSubscription(db, jid);
  if (!record) return m.reply('Kamu belum berlangganan, jadi tidak ada alamat kirim untuk diuji.');

  const to = sendTargetFor(db, record);
  try {
    await conn.sendMessage(to, {
      text: '🧪 *Uji kirim pengingat sholat*\n\nKalau pesan ini kamu terima, jalur DM pengingat sudah benar.',
    });
    return m.reply(`✅ Terkirim ke \`${to}\`.`);
  } catch (err) {
    return m.reply(`❌ Gagal kirim ke \`${to}\`:\n${err?.message || err}`);
  }
}

const handler = async (m, ctx) => {
  const sub = String(ctx.args[0] || '').toLowerCase();
  // Kunci langganan memakai identitas yang sudah diselesaikan (LID -> nomor
  // telepon), sama seperti `db.user()`. Tanpa ini, user yang JID-nya berbentuk
  // "LID yang dipaksakan jadi nomor" akan terdaftar di record hantu: sweep
  // tetap mengirim DM, tapi `.sholat stop` tidak menemukan langganannya.
  const jid = ctx.db.resolveIdentity(m.sender);
  segarkanAlamatKirim(ctx.db, jid, m);

  if (!sub) return status(m, ctx.db, jid);
  if (sub === 'stop' || sub === 'berhenti' || sub === 'off') return berhenti(m, ctx.db, jid);
  if (sub === 'jadwal') return jadwal(m, ctx, jid);
  if (sub === 'daftar' || sub === 'subscribe') return daftar(m, ctx, jid);
  if (sub === 'test') return ujiKirim(m, ctx, jid);

  return m.reply(`Perintah \`${sub}\` tidak dikenal.\n\n${HELP}`);
};

handler.help = ['sholat'];
handler.tags = ['islami'];
handler.command = /^(sholat|salat|shalat)$/i;
handler.limit = false;

export default handler;
