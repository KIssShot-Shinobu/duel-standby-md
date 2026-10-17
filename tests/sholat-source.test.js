import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchCities, fetchDayTimes, clearCache } from '../lib/sholat-source.js';

const CFG = { sholat: { apiBase: 'https://contoh.invalid/v2', timeoutMs: 1000 } };

/** Stub `fetchJson`: menerima url, mengembalikan payload siap pakai (bukan Response). */
const stub = (payload) => async () => payload;

test('fetchCities memetakan payload dan memakai cache', async () => {
  clearCache();
  let calls = 0;
  const json = async () => {
    calls += 1;
    return { status: true, data: [{ id: '1301', lokasi: 'KOTA JAKARTA' }] };
  };

  assert.deepEqual(await fetchCities(CFG, { json }), [{ id: '1301', name: 'KOTA JAKARTA' }]);
  assert.deepEqual(await fetchCities(CFG, { json }), [{ id: '1301', name: 'KOTA JAKARTA' }]);
  assert.equal(calls, 1, 'panggilan kedua harus dari cache');
});

test('fetchCities melempar saat status:false atau jaringan gagal', async () => {
  clearCache();
  await assert.rejects(() => fetchCities(CFG, { json: stub({ status: false, data: null }) }));
  await assert.rejects(() =>
    fetchCities(CFG, {
      json: async () => {
        throw new Error('putus');
      },
    }),
  );
});

test('fetchDayTimes memetakan jadwal dan cache per kota per hari', async () => {
  clearCache();
  let calls = 0;
  const json = async (url, options) => {
    calls += 1;
    assert.match(String(url), /\/sholat\/jadwal\/1301\/2026\/10\/17$/);
    assert.equal(options.timeout, 1000, 'timeout dari config diteruskan ke fetchJson');
    return {
      status: true,
      data: {
        id: 1301,
        lokasi: 'KOTA JAKARTA',
        daerah: 'DKI JAKARTA',
        jadwal: {
          tanggal: 'Sabtu, 17/10/2026',
          imsak: '04:05',
          subuh: '04:15',
          terbit: '05:28',
          dhuha: '05:55',
          dzuhur: '11:42',
          ashar: '14:48',
          maghrib: '17:49',
          isya: '18:58',
          date: '2026-10-17',
        },
      },
    };
  };

  const hasil = await fetchDayTimes(CFG, '1301', '2026-10-17', { json });
  assert.deepEqual(hasil, {
    cityId: '1301',
    date: '2026-10-17',
    times: { subuh: '04:15', dzuhur: '11:42', ashar: '14:48', maghrib: '17:49', isya: '18:58' },
  });

  await fetchDayTimes(CFG, '1301', '2026-10-17', { json });
  assert.equal(calls, 1);
});

test('fetchDayTimes melempar bila field jadwal kurang', async () => {
  clearCache();
  const json = stub({ status: true, data: { jadwal: { subuh: '04:15', dzuhur: '11:42' } } });
  await assert.rejects(() => fetchDayTimes(CFG, '1301', '2026-10-17', { json }));
});

test('fetchCities memakai katalog cache yang sudah kedaluwarsa bila pengambilan gagal', async () => {
  clearCache();
  const waktuAsli = Date.now;
  let sekarang = waktuAsli();
  Date.now = () => sekarang;
  try {
    const isi = stub({ status: true, data: [{ id: '1301', lokasi: 'KOTA JAKARTA' }] });
    await fetchCities(CFG, { json: isi });

    // Lewati TTL (7 hari) lalu matikan API: katalog lama harus tetap dipakai
    // supaya user tidak kehilangan kemampuan mendaftar karena gangguan sesaat.
    sekarang += 8 * 24 * 60 * 60 * 1000;
    const hasil = await fetchCities(CFG, {
      json: async () => {
        throw new Error('API mati');
      },
    });
    assert.deepEqual(hasil, [{ id: '1301', name: 'KOTA JAKARTA' }]);
  } finally {
    Date.now = waktuAsli;
    clearCache();
  }
});

test('fetchCities melempar bila API gagal dan belum ada cache sama sekali', async () => {
  clearCache();
  await assert.rejects(() =>
    fetchCities(CFG, {
      json: async () => {
        throw new Error('API mati');
      },
    }),
  );
});
