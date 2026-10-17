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
 * Tingkat berurutan; pencarian berhenti di tingkat pertama yang berisi hasil:
 *   1. id sama persis,
 *   2. nama lengkap sama persis,
 *   3. nama berakhiran kata utuh yang diminta (mis. "makassar" -> "KOTA MAKASSAR"),
 *   4. semua kata yang diminta muncul sebagai kata utuh di nama (mis. "bandung barat").
 *
 * Tingkat 3 & 4 sengaja **kata utuh**: "arta" tidak boleh cocok ke "KOTA JAKARTA".
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

  const names = cities.map((entry) => ({ entry, name: normalizeCityName(entry?.name) }));
  const queryWords = query.split(' ');

  const tiers = [
    (name) => name === query,
    (name) => name.endsWith(` ${query}`),
    (name) => {
      const words = name.split(' ');
      return queryWords.every((word) => words.includes(word));
    },
  ];

  for (const matches of tiers) {
    const found = names.filter((item) => matches(item.name)).map((item) => item.entry);
    if (found.length === 1) return { city: found[0] };
    if (found.length > 1) return { ambiguous: found };
  }

  return null;
}
