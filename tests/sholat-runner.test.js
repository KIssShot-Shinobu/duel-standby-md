import test from 'node:test';
import assert from 'node:assert/strict';

import { subscribe, getSubscription } from '../lib/sholat.js';
import { runSholatSweep } from '../lib/sholat-runner.js';

const JKT = '628111@s.whatsapp.net';
const MKS = '628222@s.whatsapp.net';

const JAKARTA = { id: '1301', name: 'KOTA JAKARTA' };
const MAKASSAR = { id: '2622', name: 'KOTA MAKASSAR' };

const TIMES_JKT = { subuh: '04:15', dzuhur: '11:42', ashar: '14:48', maghrib: '17:49', isya: '18:58' };
const TIMES_MKS = { subuh: '04:52', dzuhur: '12:19', ashar: '15:25', maghrib: '18:49', isya: '19:58' };

const CONFIG = { sholat: { graceMinutes: 30 } };

/** Pada instan ini WIB 17:49 == WITA 18:49 -> maghrib jatuh tempo di dua zona. */
const SEKARANG = Date.parse('2026-10-17T10:49:00Z');
const TANGGAL = '2026-10-17';

/** db tiruan minimal. */
const fakeDb = () => ({ data: { sholat: {} }, touched: 0, touch() { this.touched += 1; } });

/** fetchTimes tiruan: jadwal tetap, bisa dipaksa gagal per kota. */
const timesFor = (gagal = []) => async (_config, cityId) => {
  if (gagal.includes(cityId)) throw new Error(`API mati untuk ${cityId}`);
  return { cityId, date: TANGGAL, times: cityId === '2622' ? TIMES_MKS : TIMES_JKT };
};

/** Socket tiruan; `gagal` = predikat jid yang pengirimannya selalu gagal. */
const fakeSocket = (gagal = () => false) => ({
  terkirim: [],
  /** Semua percobaan kirim, termasuk yang gagal. */
  percobaan: [],
  async sendMessage(jid, content) {
    this.percobaan.push(jid);
    if (gagal(jid)) throw new Error('nomor tidak bisa dihubungi');
    this.terkirim.push({ jid, content });
    return { key: { remoteJid: jid } };
  },
});

/** Logger tiruan yang merekam peringatan/error. */
const fakeLogger = () => {
  const logger = {
    warnings: [],
    errors: [],
    warn: (pesan) => logger.warnings.push(pesan),
    error: (pesan) => logger.errors.push(pesan),
  };
  return logger;
};

test('sweep: DM terkirim lalu ditandai terkirim', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const socket = fakeSocket();

  const plan = await runSholatSweep(db, CONFIG, socket, {
    now: SEKARANG,
    fetchTimes: timesFor(),
  });

  assert.equal(plan.sends.length, 1);
  assert.equal(socket.terkirim.length, 1);
  assert.equal(socket.terkirim[0].jid, JKT);
  assert.match(socket.terkirim[0].content.text, /MAGHRIB/);
  assert.deepEqual(getSubscription(db, JKT).sent, { date: TANGGAL, keys: ['maghrib'] });
});

test('sweep: DM yang GAGAL tidak ditandai terkirim, jadi dicoba lagi setelah jeda', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const logger = fakeLogger();
  const socket = fakeSocket((jid) => jid === JKT);

  await runSholatSweep(db, CONFIG, socket, { now: SEKARANG, logger, fetchTimes: timesFor() });

  assert.equal(socket.terkirim.length, 0);
  assert.deepEqual(getSubscription(db, JKT).sent, { date: '', keys: [] }, 'belum terkirim = belum ditandai');
  assert.equal(logger.warnings.length, 1, 'kegagalan DM harus terlihat di log');
  assert.match(logger.warnings[0], /gagal/);

  // Satu menit kemudian BELUM dicoba lagi: percobaan gagal diberi jeda
  // `retryAfterMs` supaya DM yang gagal terus tidak dikirim tiap menit.
  const socketJeda = fakeSocket();
  await runSholatSweep(db, CONFIG, socketJeda, { now: SEKARANG + 60_000, fetchTimes: timesFor() });
  assert.equal(socketJeda.percobaan.length, 0, 'belum waktunya retry');

  // Setelah jeda lewat, baru dicoba lagi -> berhasil -> ditandai.
  const socket2 = fakeSocket();
  await runSholatSweep(db, CONFIG, socket2, { now: SEKARANG + 300_000, fetchTimes: timesFor() });
  assert.equal(socket2.terkirim.length, 1);
  assert.deepEqual(getSubscription(db, JKT).sent, { date: TANGGAL, keys: ['maghrib'] });
});

test('sweep: DM gagal terus dibatasi (jeda 5 menit, maksimal 3 percobaan) dan tiap kegagalan terlihat', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const logger = fakeLogger();
  const socket = fakeSocket(() => true); // selalu gagal
  const cfg = { sholat: { graceMinutes: 30, retryAfterMs: 300_000, maxAttempts: 3 } };

  // sweeper tiap menit selama seluruh jendela toleransi (31 siklus)
  for (let menit = 0; menit <= 30; menit += 1) {
    await runSholatSweep(db, cfg, socket, { now: SEKARANG + menit * 60_000, logger, fetchTimes: timesFor() });
  }

  assert.equal(socket.percobaan.length, 3, 'percobaan dibatasi maxAttempts, bukan tiap menit');
  assert.equal(logger.warnings.length, 3, 'setiap kegagalan harus terlihat, bukan hanya yang pertama');
  for (const pesan of logger.warnings) assert.match(pesan, /gagal/);
});

test('sweep: batas percobaan dihitung per waktu sholat (subuh menyerah, dzuhur tetap dicoba)', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const socket = fakeSocket(() => true);
  const cfg = { sholat: { graceMinutes: 30, retryAfterMs: 300_000, maxAttempts: 2 } };

  const subuh = Date.parse('2026-10-16T21:16:00Z'); // WIB 04:16 -> subuh jatuh tempo
  for (const menit of [0, 5, 10]) {
    await runSholatSweep(db, cfg, socket, { now: subuh + menit * 60_000, logger: fakeLogger(), fetchTimes: timesFor() });
  }
  assert.equal(socket.percobaan.length, 2, 'subuh menyerah setelah 2 percobaan');

  const dzuhur = Date.parse('2026-10-17T04:43:00Z'); // WIB 11:43 -> dzuhur jatuh tempo
  await runSholatSweep(db, cfg, socket, { now: dzuhur, logger: fakeLogger(), fetchTimes: timesFor() });

  assert.equal(socket.percobaan.length, 3, 'dzuhur tetap dicoba walau subuh sudah menyerah');
});

test('sweep: yang sudah terkirim tidak dikirim dua kali di siklus berikutnya', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const socket = fakeSocket();

  await runSholatSweep(db, CONFIG, socket, { now: SEKARANG, fetchTimes: timesFor() });
  const lagi = await runSholatSweep(db, CONFIG, socket, { now: SEKARANG + 60_000, fetchTimes: timesFor() });

  assert.equal(lagi.sends.length, 0);
  assert.equal(socket.terkirim.length, 1);
});

test('sweep: pelanggan tanpa zona waktu dikenali dilewati + dilaporkan', async () => {
  const db = fakeDb();
  db.data.sholat['628333@s.whatsapp.net'] = {
    jid: '628333@s.whatsapp.net',
    cityId: '9999',
    cityName: 'NGACO',
    timezone: '',
    enabled: true,
    sent: { date: '', keys: [] },
  };
  const logger = fakeLogger();
  const socket = fakeSocket();

  const plan = await runSholatSweep(db, CONFIG, socket, { now: SEKARANG, logger, fetchTimes: timesFor() });

  assert.deepEqual(plan.sends, []);
  assert.equal(socket.terkirim.length, 0);
  assert.deepEqual(plan.skipped.map((item) => item.reason), ['unknown-timezone']);
  assert.equal(logger.warnings.length, 1, 'pelanggan yang dilewati harus terlihat di log');
  assert.match(logger.warnings[0], /unknown-timezone/);
});

test('sweep: jadwal satu kota gagal diambil tidak menghentikan pelanggan lain', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  subscribe(db, MKS, MAKASSAR, { now: 0 });
  const logger = fakeLogger();
  const socket = fakeSocket();

  const plan = await runSholatSweep(db, CONFIG, socket, {
    now: SEKARANG,
    logger,
    fetchTimes: timesFor(['1301']), // Jakarta gagal, Makassar normal
  });

  assert.deepEqual(plan.sends.map((send) => send.jid), [MKS]);
  assert.equal(socket.terkirim.length, 1);
  assert.match(logger.warnings[0], /1301 gagal diambil/);
  assert.deepEqual(getSubscription(db, MKS).sent, { date: TANGGAL, keys: ['maghrib'] });
  assert.deepEqual(getSubscription(db, JKT).sent, { date: '', keys: [] });
});

test('sweep: DM dikirim ke alamat chat (LID), bukan ke nomor identitas', async () => {
  const db = fakeDb();
  const LID = '271446714642565@lid';
  db.data.lidMap = { [LID]: JKT };
  subscribe(db, JKT, JAKARTA, { now: 0, sendTo: LID });
  const socket = fakeSocket();

  await runSholatSweep(db, CONFIG, socket, { now: SEKARANG, fetchTimes: timesFor() });

  assert.equal(socket.percobaan[0], LID, 'pengingat harus dikirim ke chat LID yang WhatsApp pakai');
  assert.deepEqual(
    getSubscription(db, JKT).sent,
    { date: TANGGAL, keys: ['maghrib'] },
    'penandaan tetap memakai identitas (jid), bukan alamat kirim',
  );
});

test('sweep: record lama tanpa alamat kirim memakai LID dari lidMap', async () => {
  const db = fakeDb();
  const LID = '999@lid';
  db.data.lidMap = { [LID]: JKT };
  subscribe(db, JKT, JAKARTA, { now: 0 }); // record lama: belum ada sendTo
  const socket = fakeSocket();

  await runSholatSweep(db, CONFIG, socket, { now: SEKARANG, fetchTimes: timesFor() });

  assert.equal(socket.percobaan[0], LID, 'LID dicari dari lidMap supaya record lama ikut terkirim');
});

test('sweep: tanpa LID yang diketahui tetap memakai nomor (perilaku lama tidak rusak)', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const socket = fakeSocket();

  await runSholatSweep(db, CONFIG, socket, { now: SEKARANG, fetchTimes: timesFor() });

  assert.equal(socket.percobaan[0], JKT);
});

test('sweep: saat sambungan WhatsApp tertutup, DM ditunda tanpa memakai jatah percobaan', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const logger = fakeLogger();
  const socket = fakeSocket();
  // Seperti Baileys saat websocket-nya tertutup: `sendMessage` akan melempar
  // "Connection Closed" tanpa sempat mengirim apa pun.
  socket.ws = { isOpen: false };

  const plan = await runSholatSweep(db, CONFIG, socket, { now: SEKARANG, logger, fetchTimes: timesFor() });

  assert.equal(plan.sends.length, 1, 'rencana kirimnya tetap dihitung');
  assert.equal(socket.percobaan.length, 0, 'tidak boleh mencoba kirim saat sambungan tertutup');
  assert.deepEqual(getSubscription(db, JKT).sent, { date: '', keys: [] });
  assert.equal(getSubscription(db, JKT).attempts, null, 'jatah percobaan tidak boleh terpakai');
  assert.match(logger.warnings.join('\n'), /tertutup/i);
});

test('sweep: begitu sambungan hidup lagi, DM terkirim (jatah percobaan masih utuh)', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const logger = fakeLogger();

  const putus = fakeSocket();
  putus.ws = { isOpen: false };
  await runSholatSweep(db, CONFIG, putus, { now: SEKARANG, logger, fetchTimes: timesFor() });

  const hidup = fakeSocket();
  hidup.ws = { isOpen: true };
  await runSholatSweep(db, CONFIG, hidup, { now: SEKARANG + 60_000, logger, fetchTimes: timesFor() });

  assert.equal(hidup.terkirim.length, 1, 'DM harus terkirim begitu tersambung');
  assert.deepEqual(getSubscription(db, JKT).sent, { date: TANGGAL, keys: ['maghrib'] });
});

test('sweep: tanpa pelanggan tidak menyentuh jaringan sama sekali', async () => {
  const db = fakeDb();
  let panggilan = 0;
  const socket = fakeSocket();

  const plan = await runSholatSweep(db, CONFIG, socket, {
    now: SEKARANG,
    fetchTimes: async () => {
      panggilan += 1;
      return { times: TIMES_JKT };
    },
  });

  assert.deepEqual(plan, { sends: [], skipped: [] });
  assert.equal(panggilan, 0);
  assert.equal(socket.terkirim.length, 0);
});

// ── Teks pengingat dari AI ─────────────────────────────────────────────────

test('sweep: teks pengingat memakai hasil AI kalau tersedia', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const socket = fakeSocket();
  const diminta = [];

  await runSholatSweep(db, CONFIG, socket, {
    now: SEKARANG,
    fetchTimes: timesFor(),
    generate: async (_config, send) => {
      diminta.push(send.prayer);
      return `Sayang, sudah ${send.prayer} jam ${send.time}.`;
    },
  });

  assert.deepEqual(diminta, ['maghrib']);
  assert.equal(socket.terkirim[0].content.text, 'Sayang, sudah maghrib jam 17:49.');
});

test('sweep: AI gagal -> teks bawaan tetap terkirim dan ditandai', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const socket = fakeSocket();

  await runSholatSweep(db, CONFIG, socket, {
    now: SEKARANG,
    fetchTimes: timesFor(),
    generate: async () => {
      throw new Error('AI mati');
    },
  });

  assert.equal(socket.terkirim.length, 1);
  assert.match(socket.terkirim[0].content.text, /MAGHRIB/);
  assert.deepEqual(getSubscription(db, JKT).sent, { date: TANGGAL, keys: ['maghrib'] });
});

test('sweep: tanpa pelanggan tidak memanggil AI', async () => {
  let dipanggil = 0;
  const plan = await runSholatSweep(fakeDb(), CONFIG, fakeSocket(), {
    now: SEKARANG,
    fetchTimes: timesFor(),
    generate: async () => {
      dipanggil += 1;
      return 'teks';
    },
  });

  assert.equal(dipanggil, 0);
  assert.equal(plan.sends.length, 0);
});

test('sweep: sambungan tertutup -> AI tidak dipanggil', async () => {
  const db = fakeDb();
  subscribe(db, JKT, JAKARTA, { now: 0 });
  const socket = fakeSocket();
  socket.ws = { isOpen: false };
  let dipanggil = 0;

  await runSholatSweep(db, CONFIG, socket, {
    now: SEKARANG,
    fetchTimes: timesFor(),
    generate: async () => {
      dipanggil += 1;
      return 'teks';
    },
  });

  assert.equal(dipanggil, 0);
  assert.equal(socket.terkirim.length, 0);
});
