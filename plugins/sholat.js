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

async function daftar(m, { args, db, config }) {
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

    return m.reply(
      [
        `Nama *${query}* cocok di ${found.ambiguous.length} daerah. Pakai id yang benar:`,
        '',
        ...baris,
        '',
        `Contoh: \`.sholat daftar ${tampil[0].id}\``,
      ].join('\n'),
    );
  }

  const city = found.city;
  const timezone = timezoneForCity(city.id);
  if (!timezone) return m.reply(`Daerah *${city.name}* belum didukung.`);

  let day;
  try {
    day = await fetchDayTimes(config, city.id, tanggalLokal(timezone));
  } catch {
    return m.reply(GAGAL_AMBIL);
  }

  const record = subscribe(db, m.sender, city);
  if (!record) return m.reply(`Daerah *${city.name}* belum didukung.`);

  return m.reply(
    [
      formatTimes(record, day.times),
      '',
      `✅ Kamu berlangganan *${city.name}*. Pengingat dikirim ke DM (chat pribadi) ini.`,
      'Berhenti kapan saja: `.sholat stop`',
    ].join('\n'),
  );
}

async function jadwal(m, { db, config }) {
  const record = getSubscription(db, m.sender);
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

function status(m, db) {
  const record = getSubscription(db, m.sender);
  const baris = record ? `📍 Kamu berlangganan *${record.cityName}*.` : 'Kamu belum berlangganan.';
  return m.reply(`${HELP}\n\n${baris}`);
}

function berhenti(m, db) {
  const dihapus = unsubscribe(db, m.sender);
  return m.reply(
    dihapus ? '✅ Langganan jadwal sholat dihentikan.' : 'ℹ️ Kamu memang belum berlangganan.',
  );
}

const handler = async (m, ctx) => {
  const sub = String(ctx.args[0] || '').toLowerCase();

  if (!sub) return status(m, ctx.db);
  if (sub === 'stop' || sub === 'berhenti' || sub === 'off') return berhenti(m, ctx.db);
  if (sub === 'jadwal') return jadwal(m, ctx);
  if (sub === 'daftar' || sub === 'subscribe') return daftar(m, ctx);

  return m.reply(`Perintah \`${sub}\` tidak dikenal.\n\n${HELP}`);
};

handler.help = ['sholat'];
handler.tags = ['islami'];
handler.command = /^(sholat|salat|shalat)$/i;
handler.limit = false;

export default handler;
