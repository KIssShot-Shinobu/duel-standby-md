/**
 * Sumber data jadwal sholat — MyQuran API v2 (gratis, tanpa API key).
 *
 * Ini satu-satunya modul jadwal sholat yang menyentuh jaringan. Panggilan HTTP
 * memakai `fetchJson` dari `lib/functions.js` supaya timeout, cek status, dan
 * parsing JSON tidak ditulis dua kali. Sisanya hanya logika khas MyQuran.
 *
 * Ada dua cache di memori (bukan di disk):
 *  - katalog kota — jarang berubah, TTL panjang;
 *  - jadwal harian — kunci `kota:tanggal`, jadi satu request per kota per hari.
 *
 * Cache hanya menyimpan hasil yang berhasil; kegagalan selalu dilempar ke
 * pemanggil supaya bisa dicatat dan diulang siklus berikutnya.
 */
import { PRAYERS } from './sholat.js';
import { fetchJson } from './functions.js';

/** Katalog kota nyaris tidak berubah — segarkan seminggu sekali. */
const CITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let citiesCache = { at: 0, items: null };
const dayCache = new Map();

/** Kosongkan cache (dipakai test). */
export function clearCache() {
  citiesCache = { at: 0, items: null };
  dayCache.clear();
}

async function getMyquran(config, url, json) {
  const payload = await json(url, { timeout: config?.sholat?.timeoutMs ?? 15000 });
  if (payload?.status !== true) throw new Error('respons MyQuran tidak sukses');
  return payload;
}

/**
 * Daftar kota/kabupaten (`{ id, name }`).
 *
 * Memakai cache lama bila pengambilan gagal, supaya gangguan sesaat pada API
 * tidak membuat user kehilangan kemampuan mendaftar.
 */
export async function fetchCities(config, { json = fetchJson } = {}) {
  const now = Date.now();
  if (citiesCache.items && now - citiesCache.at < CITY_TTL_MS) return citiesCache.items;

  try {
    const payload = await getMyquran(config, `${config.sholat.apiBase}/sholat/kota/semua`, json);
    const items = (payload.data || []).map((item) => ({ id: String(item.id), name: String(item.lokasi) }));
    if (!items.length) throw new Error('katalog kota kosong');

    citiesCache = { at: now, items };
    return items;
  } catch (error) {
    if (citiesCache.items) return citiesCache.items;
    throw error;
  }
}

/**
 * Jadwal satu kota pada satu tanggal.
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {Promise<{cityId: string, date: string, times: Record<string, string>}>}
 */
export async function fetchDayTimes(config, cityId, dateStr, { json = fetchJson } = {}) {
  const key = `${cityId}:${dateStr}`;
  if (dayCache.has(key)) return dayCache.get(key);

  const [year, month, day] = String(dateStr).split('-');
  const url = `${config.sholat.apiBase}/sholat/jadwal/${cityId}/${year}/${month}/${day}`;
  const payload = await getMyquran(config, url, json);

  const jadwal = payload.data?.jadwal || {};
  const times = {};
  for (const prayer of PRAYERS) {
    const value = jadwal[prayer];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`jadwal ${prayer} tidak lengkap untuk kota ${cityId} (${dateStr})`);
    }
    times[prayer] = value.trim();
  }

  const result = { cityId: String(cityId), date: String(jadwal.date || dateStr), times };
  dayCache.set(key, result);
  return result;
}
