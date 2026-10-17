import test from 'node:test';
import assert from 'node:assert/strict';

import {
  timezoneForCity,
  normalizeCityName,
  resolveCity,
  subscribe,
  unsubscribe,
  getSubscription,
  listActiveSubscriptions,
  localParts,
  duePrayers,
  PRAYERS,
} from '../lib/sholat.js';

/** Daftar kota tiruan; dua entri bernama sama sengaja, seperti KOTA SOFIFI di API nyata. */
const CITIES = [
  { id: '1301', name: 'KOTA JAKARTA' },
  { id: '2622', name: 'KOTA MAKASSAR' },
  { id: '1709', name: 'KOTA DENPASAR' },
  { id: '3329', name: 'KOTA JAYAPURA' },
  { id: '2013', name: 'KOTA PONTIANAK' },
  { id: '3211', name: 'KOTA SOFIFI' },
  { id: '3212', name: 'KOTA SOFIFI' },
  { id: '1201', name: 'KAB. BANDUNG' },
  { id: '1219', name: 'KOTA BANDUNG' },
];

test('timezoneForCity: WIB/WITA/WIT termasuk batas Kalimantan Barat', () => {
  assert.equal(timezoneForCity('1301'), 'Asia/Jakarta');
  assert.equal(timezoneForCity('2013'), 'Asia/Jakarta'); // Kalbar = WIB
  assert.equal(timezoneForCity('1709'), 'Asia/Makassar');
  assert.equal(timezoneForCity('3329'), 'Asia/Jayapura');
  assert.equal(timezoneForCity('9999'), null);
  assert.equal(timezoneForCity(''), null);
});

test('normalizeCityName membuang tanda baca dan merapikan spasi', () => {
  assert.equal(normalizeCityName('KAB. BANDUNG'), 'KAB BANDUNG');
  assert.equal(normalizeCityName('  kota   jakarta '), 'KOTA JAKARTA');
});

test('resolveCity: id, cocok kata utuh, ambiguitas, dan batas kata', () => {
  assert.deepEqual(resolveCity(CITIES, '1301'), { city: CITIES[0] });
  assert.deepEqual(resolveCity(CITIES, 'makassar'), { city: CITIES[1] });
  assert.equal(resolveCity(CITIES, 'sofifi').ambiguous.length, 2);
  assert.equal(resolveCity(CITIES, 'bandung').ambiguous.length, 2); // KAB + KOTA
  assert.equal(resolveCity(CITIES, 'arta'), null); // 'KOTA JAKARTA' TIDAK boleh cocok sebagian kata
  assert.equal(resolveCity(CITIES, 'ngawur'), null);
  assert.equal(resolveCity(CITIES, ''), null);
});

const JID = '628111@s.whatsapp.net';

/** db tiruan minimal — cukup untuk helper langganan. */
const fakeDb = () => ({
  data: { sholat: {} },
  touched: 0,
  touch() {
    this.touched += 1;
  },
});

test('subscribe menyimpan record lengkap & menolak kota tanpa zona waktu', () => {
  const db = fakeDb();
  const rec = subscribe(db, JID, CITIES[1], { now: 1000 });
  assert.equal(rec.cityId, '2622');
  assert.equal(rec.cityName, 'KOTA MAKASSAR');
  assert.equal(rec.timezone, 'Asia/Makassar');
  assert.equal(rec.enabled, true);
  assert.deepEqual(rec.sent, { date: '', keys: [] });
  assert.equal(db.touched, 1);

  assert.equal(subscribe(fakeDb(), JID, { id: '9999', name: 'NGACO' }, { now: 1 }), null);
});

test('subscribe ulang menimpa daerah tapi mempertahankan createdAt', () => {
  const db = fakeDb();
  subscribe(db, JID, CITIES[1], { now: 1000 });
  const again = subscribe(db, JID, CITIES[0], { now: 5000 });
  assert.equal(again.cityId, '1301');
  assert.equal(again.createdAt, 1000);
  assert.equal(again.updatedAt, 5000);
});

test('unsubscribe/getSubscription/listActiveSubscriptions', () => {
  const db = fakeDb();
  subscribe(db, JID, CITIES[0], { now: 1 });
  subscribe(db, '628222@s.whatsapp.net', CITIES[1], { now: 1 });
  db.data.sholat['628333@s.whatsapp.net'] = { jid: '628333@s.whatsapp.net', cityId: '1301', enabled: false };

  assert.equal(getSubscription(db, JID).cityId, '1301');
  assert.deepEqual(
    listActiveSubscriptions(db).map((s) => s.jid).sort(),
    [JID, '628222@s.whatsapp.net'].sort(),
  );

  assert.equal(unsubscribe(db, JID), true);
  assert.equal(unsubscribe(db, JID), false);
  assert.equal(getSubscription(db, JID), null);
});

const TIMES = { subuh: '04:15', dzuhur: '11:42', ashar: '14:48', maghrib: '17:49', isya: '18:58' };

/** Instan UTC untuk jam WIB (UTC+7) pada 2026-10-17. */
const wib = (h, m) => Date.parse(`2026-10-17T${String(h - 7).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

test('localParts menghitung jam lokal tiap zona', () => {
  const at = Date.parse('2026-10-17T10:49:00Z');
  assert.deepEqual(localParts(new Date(at), 'Asia/Jakarta'), { date: '2026-10-17', minutes: 17 * 60 + 49 });
  assert.deepEqual(localParts(new Date(at), 'Asia/Makassar'), { date: '2026-10-17', minutes: 18 * 60 + 49 });
  assert.deepEqual(localParts(new Date(at), 'Asia/Jayapura'), { date: '2026-10-17', minutes: 19 * 60 + 49 });
});

test('duePrayers: sebelum waktu tidak muncul, dalam toleransi muncul, lewat toleransi dibuang', () => {
  const sub = { timezone: 'Asia/Jakarta', sent: { date: '2026-10-17', keys: [] } };
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(17, 45), graceMinutes: 30 }), []);
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(17, 49), graceMinutes: 30 }), ['maghrib']);
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(18, 19), graceMinutes: 30 }), ['maghrib']);
  // Bot hidup setelah beberapa waktu lewat sekaligus -> hanya yang masih dalam jendela.
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(18, 20), graceMinutes: 30 }), []);
  assert.deepEqual(duePrayers(sub, TIMES, { now: wib(20, 30), graceMinutes: 30 }), []);
});

test('duePrayers: yang sudah terkirim hari ini tidak muncul lagi, dan tanggal baru mereset', () => {
  const sudah = { timezone: 'Asia/Jakarta', sent: { date: '2026-10-17', keys: ['maghrib'] } };
  assert.deepEqual(duePrayers(sudah, TIMES, { now: wib(17, 49), graceMinutes: 30 }), []);
  const hariBaru = { timezone: 'Asia/Jakarta', sent: { date: '2026-10-16', keys: ['maghrib'] } };
  assert.deepEqual(duePrayers(hariBaru, TIMES, { now: wib(17, 49), graceMinutes: 30 }), ['maghrib']);
});

test('duePrayers: waktu rusak/kosong dilewati tanpa merusak waktu lain', () => {
  const rusak = { ...TIMES, dzuhur: '', ashar: 'xx:yy', maghrib: undefined };
  const sub = { timezone: 'Asia/Jakarta', sent: { date: '2026-10-17', keys: [] } };
  assert.deepEqual(duePrayers(sub, rusak, { now: wib(17, 49), graceMinutes: 30 }), []);
  const jamPenuh = { ...rusak, isya: '17:49' };
  assert.deepEqual(duePrayers(sub, jamPenuh, { now: wib(17, 49), graceMinutes: 30 }), ['isya']);
});
