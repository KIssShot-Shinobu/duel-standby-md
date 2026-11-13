import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateReminder,
  resetReminderCache,
  sanitizeReminder,
  sholatAiReady,
  pickStyle,
  STYLES,
  DEFAULT_STYLES,
} from '../lib/sholat-ai.js';

const INFO = {
  cityId: '1301',
  cityName: 'KOTA JAKARTA',
  timezone: 'Asia/Jakarta',
  prayer: 'maghrib',
  time: '17:49',
  date: '2026-10-17',
};

const configUji = (patch = {}) => ({
  ai: { base: 'https://ai.test/v1/', key: 'kunci-uji', model: 'model-uji' },
  sholat: { ai: true, aiModel: '', aiTimeoutMs: 2000, aiMaxChars: 400, ...patch },
});

/** Respons AI tiruan dengan isi tertentu. */
const balas = (content) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

test('sholatAiReady: butuh key dan tidak dimatikan lewat SHOLAT_AI=false', () => {
  assert.equal(sholatAiReady(configUji()), true);
  assert.equal(sholatAiReady({ ...configUji(), ai: { ...configUji().ai, key: '' } }), false);
  assert.equal(sholatAiReady(configUji({ ai: false })), false);
});

test('sanitizeReminder membuang pagar kode/markdown dan memotong panjang', () => {
  assert.equal(sanitizeReminder('```\n**Halo** sayang\n```'), 'Halo sayang');
  assert.equal(sanitizeReminder('a'.repeat(500), 100).length, 100);
});

test('generateReminder mengirim prompt pasangan tanpa kutipan agama', async () => {
  resetReminderCache();
  let dikirim = null;
  const fetchImpl = async (url, opts) => {
    dikirim = { url, opts };
    return balas('Sayang, sudah Maghrib nih. Jam 17:49, yuk siap-siap.');
  };

  const teks = await generateReminder(configUji(), INFO, { fetchImpl });

  assert.equal(dikirim.url, 'https://ai.test/v1/chat/completions');
  const body = JSON.parse(dikirim.opts.body);
  assert.equal(body.model, 'model-uji');
  assert.equal(body.temperature, 0.9);
  assert.match(body.messages[0].content, /pasangan/);
  assert.match(body.messages[0].content, /Jangan mengutip ayat/);
  assert.match(body.messages[1].content, /Maghrib/);
  assert.match(body.messages[1].content, /17:49 WIB/);
  assert.match(body.messages[1].content, /KOTA JAKARTA/);
  assert.match(teks, /17:49/);
});

test('generateReminder memakai SHOLAT_AI_MODEL kalau diisi', async () => {
  resetReminderCache();
  let body = null;
  const fetchImpl = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return balas('Jam 17:49, sayang.');
  };

  await generateReminder(configUji({ aiModel: 'model-pengingat' }), INFO, { fetchImpl });
  assert.equal(body.model, 'model-pengingat');
});

test('generateReminder tidak memanggil jaringan tanpa key atau saat dimatikan', async () => {
  resetReminderCache();
  let dipanggil = 0;
  const fetchImpl = async () => {
    dipanggil += 1;
    return balas('Jam 17:49, sayang.');
  };

  const tanpaKey = { ...configUji(), ai: { ...configUji().ai, key: '' } };
  assert.equal(await generateReminder(tanpaKey, INFO, { fetchImpl }), '');
  assert.equal(await generateReminder(configUji({ ai: false }), INFO, { fetchImpl }), '');
  assert.equal(dipanggil, 0);
});

test('generateReminder mengembalikan string kosong saat AI error / kosong / tanpa jam', async () => {
  resetReminderCache();
  const kasus = [
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => {
      throw new Error('jaringan mati');
    },
    async () => balas('   '),
    async () => balas('Sayang, sudah waktunya sholat.'),
  ];

  for (const fetchImpl of kasus) {
    resetReminderCache();
    assert.equal(await generateReminder(configUji(), INFO, { fetchImpl }), '');
  }
});

test('generateReminder menyimpan hasil per kota+tanggal+sholat (tidak memanggil ulang)', async () => {
  resetReminderCache();
  let dipanggil = 0;
  const fetchImpl = async (_url, opts) => {
    dipanggil += 1;
    const body = JSON.parse(opts.body);
    const jam = (body.messages[1].content.match(/pukul (\d{2}:\d{2})/) || [])[1];
    return balas(`Waktunya sholat jam ${jam}, sayang.`);
  };

  await generateReminder(configUji(), INFO, { fetchImpl });
  await generateReminder(configUji(), INFO, { fetchImpl });
  assert.equal(dipanggil, 1, 'teks yang sama harus dipakai ulang');

  await generateReminder(configUji(), { ...INFO, prayer: 'isya', time: '18:58' }, { fetchImpl });
  assert.equal(dipanggil, 2, 'waktu sholat lain butuh teks sendiri');
});

test('generateReminder menyatukan permintaan bersamaan untuk kunci yang sama', async () => {
  resetReminderCache();
  let dipanggil = 0;
  const fetchImpl = async () => {
    dipanggil += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return balas('Jam 17:49, sayang.');
  };

  const [a, b] = await Promise.all([
    generateReminder(configUji(), INFO, { fetchImpl }),
    generateReminder(configUji(), INFO, { fetchImpl }),
  ]);

  assert.equal(dipanggil, 1);
  assert.equal(a, b);
});

test('kegagalan tidak di-cache, percobaan berikutnya tetap memanggil AI', async () => {
  resetReminderCache();
  let dipanggil = 0;
  const fetchImpl = async () => {
    dipanggil += 1;
    return dipanggil === 1 ? { ok: false, status: 500 } : balas('Jam 17:49, sayang.');
  };

  assert.equal(await generateReminder(configUji(), INFO, { fetchImpl }), '');
  assert.match(await generateReminder(configUji(), INFO, { fetchImpl }), /17:49/);
  assert.equal(dipanggil, 2);
});

// ── Variasi gaya ───────────────────────────────────────────────────────────

test('pickStyle memilih acak dan menghindari gaya yang barusan dipakai', () => {
  assert.equal(pickStyle(['tsundere', 'kuudere'], { random: () => 0 }), 'tsundere');
  assert.equal(pickStyle(['tsundere', 'kuudere'], { random: () => 0, avoid: 'tsundere' }), 'kuudere');
  assert.ok(DEFAULT_STYLES.includes(pickStyle(['gaya-aneh'], { random: () => 0 })));
  assert.ok(DEFAULT_STYLES.includes(pickStyle()));
});

test('generateReminder memutar gaya acak dan tidak mengulang gaya sebelumnya', async () => {
  resetReminderCache();
  const sistem = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    sistem.push(body.messages[0].content);
    const jam = (body.messages[1].content.match(/pukul (\d{2}:\d{2})/) || [])[1];
    return balas(`Jam ${jam}, sayang.`);
  };

  await generateReminder(configUji(), INFO, { fetchImpl, random: () => 0 });
  await generateReminder(configUji(), { ...INFO, prayer: 'isya', time: '18:58' }, { fetchImpl, random: () => 0 });

  assert.equal(sistem.length, 2);
  assert.match(sistem[0], /tsundere/);
  assert.match(sistem[1], /kuudere/);
  assert.notEqual(sistem[0], sistem[1], 'gaya harus berganti');
});

test('SHOLAT_AI_STYLE memaksa satu gaya; nama tak dikenal diabaikan', async () => {
  resetReminderCache();
  let sistem = '';
  const fetchImpl = async (_url, opts) => {
    sistem = JSON.parse(opts.body).messages[0].content;
    return balas('Jam 17:49, sayang.');
  };

  await generateReminder(configUji({ aiStyle: 'genki' }), INFO, { fetchImpl, random: () => 0 });
  assert.match(sistem, /Gaya bicara: Gaya genki/);

  resetReminderCache();
  await generateReminder(configUji({ aiStyle: 'yandere' }), INFO, { fetchImpl, random: () => 0 });
  assert.match(sistem, /tsundere/);
});

test('SHOLAT_AI_STYLES membatasi pilihan gaya', async () => {
  resetReminderCache();
  let sistem = '';
  const fetchImpl = async (_url, opts) => {
    sistem = JSON.parse(opts.body).messages[0].content;
    return balas('Jam 17:49, sayang.');
  };

  await generateReminder(configUji({ aiStyles: ['calm'] }), INFO, { fetchImpl, random: () => 0.9 });
  assert.match(sistem, /Gaya bicara: Gaya calm/);
});
