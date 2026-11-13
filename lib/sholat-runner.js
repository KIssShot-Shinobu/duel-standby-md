/**
 * Orkestrasi sweep jadwal sholat: ambil jadwal tiap kota, tentukan siapa yang
 * harus dikirimi apa, kirim DM-nya, lalu tandai terkirim.
 *
 * Dipisah dari `main.js` supaya urutan "kirim dulu, baru tandai" (spec D4) —
 * satu-satunya jaminan bahwa DM yang gagal akan dicoba lagi — bisa diuji tanpa
 * koneksi WhatsApp. Logika keputusannya sendiri ada di `lib/sholat.js` (murni).
 */
import * as Sholat from './sholat.js';
import { fetchDayTimes } from './sholat-source.js';
import { generateReminder } from './sholat-ai.js';

/**
 * Kegagalan yang berulang tiap siklus (API mati, kota tak dikenal) dilaporkan
 * sekali saja per kunci, supaya log tidak dibanjiri tiap menit. Hanya
 * memengaruhi log — tidak ada perilaku yang bergantung pada ini. Kegagalan
 * pengiriman DM TIDAK memakai ini: kegagalan itu dibatasi jumlah percobaannya
 * (lihat `markAttempt`) sehingga tetap layak dicetak tiap kali.
 */
const sudahDilaporkan = new Set();

function laporkanSekali(logger, key, pesan) {
  if (sudahDilaporkan.has(key)) return;
  sudahDilaporkan.add(key);
  logger?.warn?.(pesan);
}

/**
 * Socket jelas siap kirim? Saat websocket tertutup, `sendMessage` melempar
 * "Connection Closed" tanpa sempat mengirim apa pun. Socket tiruan atau bentuk
 * lain yang tidak punya `ws` dianggap siap (jangan menebak).
 */
function socketSiap(socket) {
  const ws = socket?.ws;
  if (!ws || typeof ws.isOpen !== 'boolean') return true;
  return ws.isOpen;
}

/** Ambil jadwal tiap kota yang dilanggan, sekali per kota per siklus. */
async function ambilJadwalSemuaKota(db, config, { now, logger, fetchTimes }) {
  const timesByCity = {};
  const sudahDicoba = new Set();

  for (const sub of Sholat.listActiveSubscriptions(db)) {
    if (sudahDicoba.has(sub.cityId)) continue;
    sudahDicoba.add(sub.cityId);

    const timezone = sub.timezone || Sholat.timezoneForCity(sub.cityId);
    if (!timezone) continue; // `sweep` yang akan mencatatnya sebagai unknown-timezone

    const dateStr = Sholat.localParts(new Date(now), timezone).date;
    try {
      timesByCity[sub.cityId] = (await fetchTimes(config, sub.cityId, dateStr)).times;
    } catch (err) {
      // Kota ini dilewati siklus ini; pelanggan lain tetap diproses.
      laporkanSekali(
        logger,
        `fetch:${sub.cityId}:${dateStr}`,
        `[sholat] jadwal ${sub.cityId} gagal diambil: ${err.message}`,
      );
    }
  }

  return timesByCity;
}

/**
 * @param {object} socket Koneksi WhatsApp (cukup punya `sendMessage`).
 * @returns {Promise<{sends: object[], skipped: {jid: string, reason: string}[]}>}
 */
export async function runSholatSweep(
  db,
  config,
  socket,
  { now = Date.now(), logger, fetchTimes = fetchDayTimes, generate = generateReminder } = {},
) {
  if (!Sholat.listActiveSubscriptions(db).length) return { sends: [], skipped: [] };

  const timesByCity = await ambilJadwalSemuaKota(db, config, { now, logger, fetchTimes });
  const plan = Sholat.sweep(db, config, { now, timesByCity });

  for (const item of plan.skipped) {
    laporkanSekali(logger, `skip:${item.jid}:${item.reason}`, `[sholat] ${item.jid} dilewati: ${item.reason}`);
  }

  // Sambungan sedang tertutup: jangan buang jatah percobaan. Tanpa penjagaan ini
  // `maxAttempts` habis hanya karena bot sempat terputus, dan pengingatnya tidak
  // pernah dicoba lagi setelah tersambung. Percobaan TIDAK dihitung di sini.
  if (!socketSiap(socket)) {
    laporkanSekali(
      logger,
      'offline',
      '[sholat] sambungan WhatsApp tertutup — pengiriman pengingat ditunda sampai tersambung lagi',
    );
    return plan;
  }

  // Teks pengingat ditulis AI (gaya pasangan). Kalau AI gagal/timeout/kosong,
  // `send.text` tetap teks bawaan dari lib/sholat.js — pengiriman tidak pernah
  // dibatalkan atau ditunda lama oleh AI. Dijalankan paralel supaya satu kota
  // yang lambat tidak menahan kota lain.
  if (plan.sends.length) {
    await Promise.allSettled(
      plan.sends.map(async (send) => {
        const teks = await generate(config, send);
        if (teks) send.text = teks;
      }),
    );
  }

  for (const send of plan.sends) {
    try {
      // Dikirim ke `send.to` (alamat chat yang WhatsApp pakai, biasanya `…@lid`),
      // bukan ke `send.jid` (nomor identitas) — kiriman ke nomor tidak terantar
      // sejak WhatsApp memakai LID.
      await socket.sendMessage(send.to || send.jid, { text: send.text });
      // Ditandai HANYA setelah pengiriman benar-benar berhasil (spec D4): DM
      // yang gagal dicoba lagi setelah jeda, dan tidak diulang kalau sudah
      // terkirim.
      Sholat.markSent(db, send);
    } catch (err) {
      // `markAttempt` memberi jeda supaya DM yang gagal tidak dicoba tiap
      // menit, dan pesannya SELALU dicetak (bukan sekali) supaya penyebabnya
      // kelihatan. Sebelumnya kegagalan kedua dan seterusnya didiamkan,
      // sehingga log hanya menampilkan percobaan kirim tanpa alasan apa pun.
      const percobaan = Sholat.markAttempt(db, send, { now });
      logger?.warn?.(`[sholat] DM ke ${send.jid} gagal (percobaan ke-${percobaan}): ${err?.message}`);
    }
  }

  return plan;
}
