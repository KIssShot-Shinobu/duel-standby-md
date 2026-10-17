/**
 * Logika jadwal sholat — MURNI.
 *
 * Modul ini tidak menyentuh jaringan maupun jam sistem: semua masukan waktu
 * lewat argumen (`{ now }`, `times`) supaya bisa diuji tanpa jaringan dan
 * tanpa menunggu waktu nyata. Pengambilan data dari MyQuran ada di
 * `lib/sholat-source.js`, dan pengiriman DM ada di `main.js`.
 */

/** Waktu wajib yang dikirim; urutannya sekaligus urutan tampilan. */
export const PRAYERS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];

export const PRAYER_LABEL = {
  subuh: 'Subuh',
  dzuhur: 'Dzuhur',
  ashar: 'Ashar',
  maghrib: 'Maghrib',
  isya: 'Isya',
};

export const TZ_LABEL = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
};

/**
 * Kode provinsi (2 digit pertama `id` kota dari API) -> zona waktu.
 *
 * Indonesia tidak memakai DST. Yang paling mudah keliru: Kalimantan *Barat*
 * (20) memakai WIB, sedangkan Kalimantan lain (21-24) memakai WITA.
 */
export const PROVINCE_TZ = {
  '01': 'Asia/Jakarta', '02': 'Asia/Jakarta', '03': 'Asia/Jakarta', '04': 'Asia/Jakarta',
  '05': 'Asia/Jakarta', '06': 'Asia/Jakarta', '07': 'Asia/Jakarta', '08': 'Asia/Jakarta',
  '09': 'Asia/Jakarta', '10': 'Asia/Jakarta', '11': 'Asia/Jakarta', '12': 'Asia/Jakarta',
  '13': 'Asia/Jakarta', '14': 'Asia/Jakarta', '15': 'Asia/Jakarta', '16': 'Asia/Jakarta',
  '17': 'Asia/Makassar', '18': 'Asia/Makassar', '19': 'Asia/Makassar', '20': 'Asia/Jakarta',
  '21': 'Asia/Makassar', '22': 'Asia/Makassar', '23': 'Asia/Makassar', '24': 'Asia/Makassar',
  '25': 'Asia/Makassar', '26': 'Asia/Makassar', '27': 'Asia/Makassar', '28': 'Asia/Makassar',
  '29': 'Asia/Makassar', '30': 'Asia/Makassar',
  '31': 'Asia/Jayapura', '32': 'Asia/Jayapura', '33': 'Asia/Jayapura', '34': 'Asia/Jayapura',
};

/** Zona waktu sebuah kota dari kode provinsinya. `null` = belum didukung (jangan ditebak). */
export function timezoneForCity(cityId) {
  const prefix = String(cityId ?? '').padStart(4, '0').slice(0, 2);
  return PROVINCE_TZ[prefix] ?? null;
}

/** Bentuk normal nama daerah untuk pencocokan: huruf besar, tanpa tanda baca, spasi rapi. */
export function normalizeCityName(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cari kota dari masukan user.
 *
 * Urutan langkah:
 *   1. id sama persis,
 *   2. nama lengkap sama persis,
 *   3. nama berakhiran kata utuh yang diminta (mis. "makassar" -> "KOTA MAKASSAR"),
 *   4. semua kata yang diminta muncul sebagai kata utuh di nama.
 *
 * Langkah 3 & 4 digabung jadi **satu daftar kandidat**, tidak bertingkat.
 * Bertingkat berbahaya: "kota" berakhiran cocok dengan "KAB. LIMA PULUH KOTA",
 * jadi jawabannya langsung satu daerah — padahal ratusan nama lain juga memuat
 * "KOTA". Aturan produknya jelas: nama daerah yang ambigu tidak boleh ditebak
 * (lebih baik user memilih dari daftar daripada dikirimi jadwal daerah lain).
 * Kandidat dari langkah 3 ditaruh lebih dulu supaya yang paling relevan tampil
 * di atas.
 *
 * Pencocokan sengaja **kata utuh**, bukan substring: "arta" tidak boleh cocok
 * ke "KOTA JAKARTA".
 *
 * @returns {{city: {id: string, name: string}} | {ambiguous: {id: string, name: string}[]} | null}
 */
export function resolveCity(cities = [], input = '') {
  const raw = String(input ?? '').trim();
  if (!raw || !Array.isArray(cities) || !cities.length) return null;

  const byId = cities.filter((entry) => String(entry?.id) === raw);
  if (byId.length) return byId.length === 1 ? { city: byId[0] } : { ambiguous: byId };

  const query = normalizeCityName(raw);
  if (!query) return null;

  const queryWords = query.split(' ');
  const berakhiran = [];
  const memuatSemuaKata = [];

  for (const entry of cities) {
    const name = normalizeCityName(entry?.name);
    if (name === query || name.endsWith(` ${query}`)) {
      berakhiran.push(entry);
      continue;
    }
    const words = name.split(' ');
    if (queryWords.every((word) => words.includes(word))) memuatSemuaKata.push(entry);
  }

  const found = [...berakhiran, ...memuatSemuaKata];
  if (found.length === 1) return { city: found[0] };
  if (found.length > 1) return { ambiguous: found };
  return null;
}

/* ── Langganan (koleksi `db.data.sholat`) ───────────────────────────────── */

/**
 * Simpan langganan user. Satu user = satu daerah; mendaftar ulang menimpa.
 *
 * @returns {object|null} `null` bila zona waktu kota belum didukung — lebih
 *   baik menolak daripada mengirim pengingat di jam yang salah (spec D2).
 */
export function subscribe(db, jid, city, { now = Date.now() } = {}) {
  const timezone = timezoneForCity(city?.id);
  if (!timezone) return null;

  if (!db.data.sholat) db.data.sholat = {};
  const previous = db.data.sholat[jid];

  const record = {
    jid,
    cityId: String(city.id),
    cityName: String(city.name),
    timezone,
    enabled: true,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    // Selalu direset: jadwal hari ini dihitung ulang dari nol.
    sent: { date: '', keys: [] },
    // Percobaan gagal untuk waktu sholat yang sedang berjalan (lihat duePrayers).
    attempts: null,
  };

  db.data.sholat[jid] = record;
  db.touch?.();
  return record;
}

/** Hapus langganan. `true` bila ada yang dihapus. */
export function unsubscribe(db, jid) {
  if (!db.data?.sholat?.[jid]) return false;
  delete db.data.sholat[jid];
  db.touch?.();
  return true;
}

export function getSubscription(db, jid) {
  return db.data?.sholat?.[jid] ?? null;
}

/** Semua langganan yang masih aktif — dipakai sweep. */
export function listActiveSubscriptions(db) {
  return Object.values(db.data?.sholat || {}).filter((sub) => sub?.enabled);
}

/* ── Waktu ──────────────────────────────────────────────────────────────── */

const formatterCache = new Map();

function formatterFor(timezone) {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

/**
 * Jam lokal sebuah kota pada satu instan.
 *
 * Memakai `Intl` alih-alih aritmetika offset manual supaya tidak ada
 * kesalahan tanda/jam.
 *
 * @returns {{date: string, minutes: number}} `date` = 'YYYY-MM-DD' lokal kota,
 *   `minutes` = menit sejak tengah malam lokal.
 */
export function localParts(date, timezone) {
  const parts = formatterFor(timezone).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(pick('hour'));
  const minute = Number(pick('minute'));
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    minutes: hour * 60 + minute,
  };
}

/**
 * Percobaan kirim yang sudah gagal untuk satu record.
 *
 * Bentuk di database: `{ date, prayer, count, lastAt }`. Satu record hanya
 * menyimpan percobaan untuk waktu sholat yang sedang berjalan; begitu waktu
 * sholatnya berganti, hitungannya mulai dari nol lagi.
 */
function attemptsOf(sub, date, prayer) {
  const a = sub?.attempts;
  if (!a || a.date !== date || a.prayer !== prayer) return { count: 0, lastAt: 0 };
  return { count: Math.max(0, Number(a.count) || 0), lastAt: Math.max(0, Number(a.lastAt) || 0) };
}

/**
 * Waktu yang harus dikirim sekarang.
 *
 * Sebuah waktu jatuh tempo bila sudah lewat **dan** masih di dalam jendela
 * `graceMinutes`. Di luar jendela berarti bot sempat mati; notifikasinya
 * dibuang supaya user tidak dibanjiri pesan basi (spec D1). Waktu yang sudah
 * dikirim hari ini tidak diulang (spec D5).
 *
 * Percobaan yang GAGAL diberi jeda `retryAfterMs` dan dibatasi `maxAttempts`:
 * tanpa itu satu nomor yang tidak bisa dihubungi dicoba tiap siklus (60 detik)
 * selama seluruh jendela toleransi — 30 percobaan dan 30 baris log untuk satu
 * waktu sholat, padahal pesannya tidak pernah sampai.
 */
export function duePrayers(
  sub,
  times,
  { now = Date.now(), graceMinutes = 30, prayers = PRAYERS, retryAfterMs = 0, maxAttempts = Infinity } = {},
) {
  const timezone = sub?.timezone;
  if (!timezone || !times) return [];

  const { date, minutes } = localParts(new Date(now), timezone);
  const alreadySent = sub.sent?.date === date ? sub.sent.keys || [] : [];

  const due = [];
  for (const prayer of prayers) {
    if (alreadySent.includes(prayer)) continue;

    const value = times[prayer];
    if (typeof value !== 'string' || !/^\d{1,2}:\d{2}$/.test(value)) continue;

    const [hour, minute] = value.split(':').map(Number);
    const target = hour * 60 + minute;
    const elapsed = minutes - target;

    if (elapsed < 0 || elapsed > graceMinutes) continue;

    const tried = attemptsOf(sub, date, prayer);
    if (tried.count >= maxAttempts) continue;
    if (tried.lastAt && now - tried.lastAt < retryAfterMs) continue;

    due.push(prayer);
  }
  return due;
}

/* ── Pesan ──────────────────────────────────────────────────────────────── */

const tzLabel = (timezone) => TZ_LABEL[timezone] || timezone || '';

/** Pesan pengingat satu waktu sholat. */
export function buildMessage(sub, prayer, time) {
  const label = (PRAYER_LABEL[prayer] || prayer).toUpperCase();
  return [`🕌 *WAKTU SHOLAT — ${label}*`, `🕐 ${time} ${tzLabel(sub.timezone)}`, `📍 ${sub.cityName}`].join('\n');
}

/** Daftar jadwal hari ini (dipakai perintah `.sholat jadwal`). */
export function formatTimes(sub, times) {
  const lines = [
    `🕌 *JADWAL SHOLAT — ${sub.cityName}*`,
    `📍 Zona waktu: ${tzLabel(sub.timezone)}`,
    '',
  ];
  for (const prayer of PRAYERS) {
    const value = times?.[prayer];
    if (!value) continue;
    lines.push(`• ${PRAYER_LABEL[prayer] || prayer}: ${value}`);
  }
  return lines.join('\n');
}

/* ── Sweep ──────────────────────────────────────────────────────────────── */

/**
 * Hitung siapa yang perlu dikirimi apa sekarang.
 *
 * Murni: hanya membaca db dan `timesByCity`, tidak memanggil jaringan dan
 * **tidak menandai apa pun**. Penandaan dilakukan `markSent` setelah
 * pengiriman benar-benar sukses (spec D4), supaya DM yang gagal tidak hilang
 * diam-diam.
 *
 * @returns {{sends: object[], skipped: {jid: string, reason: string}[]}}
 */
export function sweep(db, config, { now = Date.now(), timesByCity = {} } = {}) {
  const sends = [];
  const skipped = [];
  const graceMinutes = config?.sholat?.graceMinutes ?? 30;
  const prayers = config?.sholat?.prayers ?? PRAYERS;
  // Jeda & batas percobaan ulang untuk DM yang gagal (lihat duePrayers).
  const retryAfterMs = config?.sholat?.retryAfterMs ?? 5 * 60 * 1000;
  const maxAttempts = config?.sholat?.maxAttempts ?? 3;

  for (const sub of listActiveSubscriptions(db)) {
    const timezone = sub.timezone || timezoneForCity(sub.cityId);
    if (!timezone) {
      skipped.push({ jid: sub.jid, reason: 'unknown-timezone' });
      continue;
    }

    const times = timesByCity[sub.cityId];
    if (!times) {
      skipped.push({ jid: sub.jid, reason: 'no-times' });
      continue;
    }

    const active = { ...sub, timezone };
    const { date } = localParts(new Date(now), timezone);

    for (const prayer of duePrayers(active, times, { now, graceMinutes, prayers, retryAfterMs, maxAttempts })) {
      sends.push({
        jid: sub.jid,
        cityId: sub.cityId,
        cityName: sub.cityName,
        timezone,
        prayer,
        time: times[prayer],
        date,
        text: buildMessage(active, prayer, times[prayer]),
      });
    }
  }

  return { sends, skipped };
}

/** Tandai satu kiriman berhasil; idempoten dan reset otomatis saat tanggal berganti. */
export function markSent(db, send) {
  const sub = db.data?.sholat?.[send?.jid];
  if (!sub) return false;

  // `keys` bisa saja hilang kalau file database disunting manual — perbaiki,
  // jangan sampai satu record rusak menghentikan seluruh sweep.
  if (sub.sent?.date !== send.date || !Array.isArray(sub.sent?.keys)) {
    sub.sent = { date: send.date, keys: [] };
  }
  if (!sub.sent.keys.includes(send.prayer)) sub.sent.keys.push(send.prayer);

  // Percobaan gagal sebelumnya tidak relevan lagi begitu berhasil terkirim.
  if (sub.attempts?.date === send.date && sub.attempts?.prayer === send.prayer) delete sub.attempts;

  db.touch?.();
  return true;
}

/**
 * Catat satu percobaan kirim yang GAGAL.
 *
 * Dipakai `duePrayers` untuk memberi jeda (`retryAfterMs`) dan membatasi jumlah
 * percobaan (`maxAttempts`) — supaya nomor yang tidak bisa dihubungi tidak
 * dicoba tiap siklus sampai jendela toleransi habis.
 *
 * @returns {number} jumlah percobaan gagal untuk waktu sholat ini (termasuk yang baru dicatat)
 */
export function markAttempt(db, send, { now = Date.now() } = {}) {
  const sub = db.data?.sholat?.[send?.jid];
  if (!sub) return 0;

  const count = attemptsOf(sub, send.date, send.prayer).count + 1;
  sub.attempts = { date: send.date, prayer: send.prayer, count, lastAt: now };
  db.touch?.();
  return count;
}
