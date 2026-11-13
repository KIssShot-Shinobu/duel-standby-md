/**
 * Teks pengingat sholat yang ditulis AI.
 *
 * Pengingat bawaan `lib/sholat.js` selalu sama persis. Modul ini membuat versi
 * yang lebih personal — gaya pasangan yang mengingatkan — tetapi tetap aman:
 *   - jam harus benar; teks AI yang jamnya tidak cocok dibuang,
 *   - dilarang mengutip ayat/hadits/dalil (ditegaskan di system prompt),
 *   - tidak menahan pengiriman: gagal/timeout/kosong = pakai teks bawaan.
 *
 * Satu teks dibuat per kota + tanggal + waktu sholat lalu di-cache, jadi semua
 * pelanggan di kota yang sama menerima teks yang sama dan AI hanya dipanggil
 * maksimal 5 kali per kota per hari.
 */
import { PRAYER_LABEL, TZ_LABEL } from './sholat.js';

/** Gaya bicara pengingat. Teks ini masuk ke system prompt, bukan ke pesan. */
export const STYLES = {
  tsundere:
    'Gaya tsundere ringan: sedikit jutek dan malu-malu, boleh pakai "b-bukan karena aku peduli", tapi tetap sopan dan tidak kasar.',
  kuudere: 'Gaya kuudere: tenang, datar, dingin di permukaan tapi tetap perhatian. Kalimat pendek dan efisien.',
  dandere: 'Gaya dandere: pemalu dan ragu-ragu, banyak "eh..." dan "kalau sempat", tapi tulus.',
  genki: 'Gaya genki: ceria, energik, bersemangat, penuh ajakan positif.',
  calm: 'Gaya calm/onee-san: hangat, tenang, dewasa, menenangkan seperti kakak yang menyayangi.',
  teasing: 'Gaya teasing: suka menggoda dengan ringan dan bercanda, tapi tidak merendahkan atau melecehkan ibadah.',
};

export const DEFAULT_STYLES = Object.keys(STYLES);

const CACHE_MAX = 200;
const cache = new Map();
const inFlight = new Map();
/** Gaya terakhir per kota+tanggal, supaya tidak muncul dua kali berturut-turut. */
const lastStyle = new Map();

/** AI siap dipakai? Butuh key; `SHOLAT_AI=false` mematikan walau key ada. */
export function sholatAiReady(config) {
  return config?.sholat?.ai !== false && Boolean(config?.ai?.key);
}

/** Kosongkan cache — dipakai tes supaya tiap kasus mulai dari nol. */
export function resetReminderCache() {
  cache.clear();
  inFlight.clear();
  lastStyle.clear();
}

/**
 * Pilih satu gaya secara acak. `avoid` mencegah gaya yang sama muncul dua kali
 * berturut-turut selama masih ada pilihan lain.
 */
export function pickStyle(styles = DEFAULT_STYLES, { random = Math.random, avoid = '' } = {}) {
  const daftar = (Array.isArray(styles) ? styles : DEFAULT_STYLES).filter((gaya) => STYLES[gaya]);
  const pilihan = daftar.length ? daftar : DEFAULT_STYLES;
  const kandidat = pilihan.length > 1 && avoid ? pilihan.filter((gaya) => gaya !== avoid) : pilihan;
  return kandidat[Math.floor(random() * kandidat.length)] || kandidat[0];
}

/** Gaya untuk satu pengingat: paksaan owner > acak (hindari gaya sebelumnya). */
function resolveStyle(config, info, random) {
  const dipaksa = String(config?.sholat?.aiStyle || '').toLowerCase();
  if (dipaksa && STYLES[dipaksa]) return dipaksa;

  const kunci = `${info?.cityId}|${info?.date}`;
  const gaya = pickStyle(config?.sholat?.aiStyles, { random, avoid: lastStyle.get(kunci) || '' });
  lastStyle.set(kunci, gaya);
  return gaya;
}

/** Buang pagar kode/markdown yang kadang ikut ditulis model, rapikan spasi. */
export function sanitizeReminder(text, maxChars = 400) {
  return String(text ?? '')
    .replace(/```[a-z]*\s*/gi, '')
    .replace(/\*\*/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, Math.max(80, Number(maxChars) || 400))
    .trim();
}

function promptSistem(gaya, maxChars) {
  return [
    'Kamu adalah pasangan yang perhatian dan penyayang.',
    'Kamu mengingatkan pengguna waktu sholat lewat chat WhatsApp.',
    `Gaya bicara: ${STYLES[gaya] || STYLES.calm}`,
    'Tulis 2-3 kalimat singkat, hangat, dan natural seperti orang yang sayang — bukan pengumuman atau ceramah.',
    'Wajib menyebut nama sholat, jam, dan kota.',
    'Jangan mengutip ayat, hadits, atau dalil agama. Jangan mengarang kutipan.',
    'Jangan menyebut nama gaya ini atau bahwa kamu sedang berperan.',
    'Jangan memakai markdown tebal, bullet, atau tanda kutip.',
    `Maksimal ${maxChars} karakter.`,
  ].join(' ');
}

/**
 * Buat teks pengingat untuk satu waktu sholat.
 * @returns {Promise<string>} string kosong = pakai teks bawaan.
 */
export async function generateReminder(config, info, { fetchImpl = fetch, random = Math.random } = {}) {
  if (!sholatAiReady(config)) return '';

  const key = `${info?.cityId}|${info?.date}|${info?.prayer}`;
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    try {
      const maxChars = Math.max(80, Number(config?.sholat?.aiMaxChars) || 400);
      const model = config?.sholat?.aiModel || config?.ai?.model;
      const gaya = resolveStyle(config, info, random);
      const timezone = TZ_LABEL[info?.timezone] || info?.timezone || '';
      const waktu = `${info?.time} ${timezone}`.trim();

      const response = await fetchImpl(`${String(config.ai.base).replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.ai.key}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.9,
          messages: [
            { role: 'system', content: promptSistem(gaya, maxChars) },
            {
              role: 'user',
              content: `Sekarang waktu ${PRAYER_LABEL[info.prayer] || info.prayer} pukul ${waktu} di ${info.cityName}. Tulis pengingatnya.`,
            },
          ],
        }),
        signal: AbortSignal.timeout(Math.max(1000, Number(config?.sholat?.aiTimeoutMs) || 8000)),
      });

      if (!response.ok) return '';
      const json = await response.json();
      const teks = sanitizeReminder(json?.choices?.[0]?.message?.content, maxChars);

      // Jam salah = pengingat berbahaya. Buang, pakai teks bawaan.
      if (!teks || !teks.includes(info.time)) return '';

      cache.set(key, teks);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return teks;
    } catch {
      return '';
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}

export default {
  generateReminder,
  sanitizeReminder,
  sholatAiReady,
  resetReminderCache,
  pickStyle,
  STYLES,
  DEFAULT_STYLES,
};
