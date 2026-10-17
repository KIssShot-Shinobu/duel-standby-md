import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_DATA } from '../lib/database.js';
import * as Rent from '../lib/rent.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000;

const fakeDb = (overrides = {}) => {
  const data = DEFAULT_DATA();
  Object.assign(data.rentals, overrides.rentals || {});
  Object.assign(data.renters, overrides.renters || {});
  if (overrides.rentPrice !== undefined) data.settings.rentPrice = overrides.rentPrice;
  return { data, touch() {} };
};

const rentConfig = () => ({
  root: process.cwd(),
  bot: { owners: ['6280000000000'] },
  rent: {
    enabled: true,
    days: 30,
    pricePerMonth: 50000,
    qrisFile: 'assets/qris.jpg',
    reminderDays: [3, 1],
    freePlugins: ['game-yugioh', 'tools-sticker', 'sticker-', 'tools-toimg'],
    alwaysAllowed: ['main-', 'owner-', 'rent.js', '_rent-guard'],
    gatedMessage: '🔒 Fitur butuh sewa aktif.',
  },
});

test('rentSettings: harga dari db.settings.rentPrice menang atas config', () => {
  const cfg = rentConfig();
  assert.equal(Rent.rentSettings(fakeDb(), cfg).pricePerMonth, 50000);
  assert.equal(Rent.rentSettings(fakeDb({ rentPrice: 75000 }), cfg).pricePerMonth, 75000);
  assert.equal(Rent.rentSettings(fakeDb(), cfg).days, 30);
});

test('requestRent: status pending + renter tersimpan', () => {
  const db = fakeDb();
  const rental = Rent.requestRent(db, '123@g.us', { renter: '628111@s.whatsapp.net', renterName: 'Budi' });
  assert.equal(rental.status, 'pending');
  assert.equal(rental.renter, '628111@s.whatsapp.net');
  assert.equal(Rent.getRental(db, '123@g.us').renterName, 'Budi');
});

test('activateRent: active 30 hari + registry renters dibuat', () => {
  const db = fakeDb();
  Rent.activateRent(db, '123@g.us', { renter: '628111@s.whatsapp.net', renterName: 'Budi', days: 30, by: 'owner' });
  const rental = Rent.getRental(db, '123@g.us');
  assert.equal(rental.status, 'active');
  assert.equal(rental.expiresAt - rental.startedAt, 30 * DAY);
  assert.equal(db.data.renters['628111@s.whatsapp.net'].groups.includes('123@g.us'), true);
});

test('rentalStatus: null / pending / active / expired', () => {
  const db = fakeDb();
  assert.equal(Rent.rentalStatus(db, 'x1@g.us', { now: NOW }), null);
  Rent.requestRent(db, 'x2@g.us', { renter: 'a', renterName: '' });
  assert.equal(Rent.rentalStatus(db, 'x2@g.us', { now: NOW }), 'pending');
  Rent.activateRent(db, 'x3@g.us', { renter: 'a', renterName: '', days: 30, by: 'o', now: NOW });
  assert.equal(Rent.rentalStatus(db, 'x3@g.us', { now: NOW }), 'active');
  assert.equal(Rent.rentalStatus(db, 'x3@g.us', { now: NOW + 31 * DAY }), 'expired');
});

test('extendRent: perpanjang dari expiresAt lama; expired -> dari now', () => {
  const db = fakeDb();
  Rent.activateRent(db, '123@g.us', { renter: 'a', renterName: '', days: 30, by: 'o', now: NOW });
  const first = Rent.getRental(db, '123@g.us').expiresAt;
  Rent.extendRent(db, '123@g.us', { days: 30, by: 'o', now: NOW + 10 * DAY });
  assert.equal(Rent.getRental(db, '123@g.us').expiresAt, first + 30 * DAY);

  // expired -> base = now, bukan expiresAt lama
  Rent.activateRent(db, '999@g.us', { renter: 'a', renterName: '', days: 30, by: 'o', now: NOW });
  Rent.extendRent(db, '999@g.us', { days: 30, by: 'o', now: NOW + 60 * DAY });
  assert.equal(Rent.getRental(db, '999@g.us').expiresAt, NOW + 60 * DAY + 30 * DAY);
});

test('remainingDays: ceil, dan 0 kalau expired', () => {
  const db = fakeDb();
  Rent.activateRent(db, '123@g.us', { renter: 'a', renterName: '', days: 30, by: 'o', now: NOW });
  assert.equal(Rent.remainingDays(db, '123@g.us', { now: NOW + (28.5) * DAY }), 2);
  assert.equal(Rent.remainingDays(db, '123@g.us', { now: NOW + 31 * DAY }), 0);
});

test('isGroupGated: matriks free / kunci / aktif / owner', () => {
  const db = fakeDb();
  const { rentCli } = { rentCli: rentConfig() };
  const opts = (participants = [], isOwner = false) => ({ participants, isOwner, now: NOW });

  // belum punya rental -> dikunci kecuali free/main
  assert.equal(Rent.isGroupGated(db, '1@g.us', 'downloader-tiktok.js', rentCli, opts()), true);
  assert.equal(Rent.isGroupGated(db, '1@g.us', 'game-yugioh.js', rentCli, opts()), false);
  assert.equal(Rent.isGroupGated(db, '1@g.us', 'tools-sticker.js', rentCli, opts()), false);
  assert.equal(Rent.isGroupGated(db, '1@g.us', 'main-menu.js', rentCli, opts()), false);
  assert.equal(Rent.isGroupGated(db, '1@g.us', 'rent.js', rentCli, opts()), false);

  // pending -> terkunci
  Rent.requestRent(db, '2@g.us', { renter: 'a', renterName: '' });
  assert.equal(Rent.isGroupGated(db, '2@g.us', 'downloader-tiktok.js', rentCli, opts()), true);

  // active -> tidak terkunci
  Rent.activateRent(db, '3@g.us', { renter: 'a', renterName: '', days: 30, by: 'o', now: NOW });
  assert.equal(Rent.isGroupGated(db, '3@g.us', 'downloader-tiktok.js', rentCli, opts()), false);

  // expired -> terkunci lagi
  assert.equal(Rent.isGroupGated(db, '3@g.us', 'downloader-tiktok.js', rentCli, { participants: [], isOwner: false, now: NOW + 31 * DAY }), true);

  // grup owner -> bebas walau belum sewa
  const ownerParticipants = [{ id: '6280000000000@s.whatsapp.net' }];
  assert.equal(Rent.isGroupGated(db, '4@g.us', 'downloader-tiktok.js', rentCli, opts(ownerParticipants)), false);

  // isOwner -> bebas
  assert.equal(Rent.isGroupGated(db, '4@g.us', 'downloader-tiktok.js', rentCli, opts([], true)), false);

  // rent dinonaktifkan -> tidak pernah gated
  const cfgOff = rentConfig();
  cfgOff.rent.enabled = false;
  assert.equal(Rent.isGroupGated(db, '1@g.us', 'downloader-tiktok.js', cfgOff, opts()), false);
});

test('isRenterActive: aktif di grup mana pun -> unli; semua expired -> false', () => {
  const db = fakeDb();
  Rent.activateRent(db, '5@g.us', { renter: 'r1@s.whatsapp.net', renterName: '', days: 30, by: 'o', now: NOW });
  assert.equal(Rent.isRenterActive(db, 'r1@s.whatsapp.net', { now: NOW }), true);
  assert.equal(Rent.isRenterActive(db, 'r1@s.whatsapp.net', { now: NOW + 31 * DAY }), false);
  assert.equal(Rent.isRenterActive(db, 'nobody', { now: NOW }), false);
});

test('sweepRentals: tandai expired sekali, reminder H-3 & H-1 sekali', () => {
  const db = fakeDb();
  Rent.activateRent(db, 'g1@g.us', { renter: 'a', renterName: '', days: 30, by: 'o', now: NOW });

  // H-5: belum ada reminder
  let plan = Rent.sweepRentals(db, rentConfig(), { now: NOW + 25 * DAY });
  assert.equal(plan.expired.length, 0);
  assert.equal(plan.remind.length, 0);

  // H-3: reminder d3
  plan = Rent.sweepRentals(db, rentConfig(), { now: NOW + 27 * DAY });
  assert.deepEqual(plan.remind.map((r) => r.remaining), [3]);

  // sweep lagi di H-3: tidak dobel
  plan = Rent.sweepRentals(db, rentConfig(), { now: NOW + 27 * DAY });
  assert.equal(plan.remind.length, 0);

  // H-1: reminder d1
  plan = Rent.sweepRentals(db, rentConfig(), { now: NOW + 29 * DAY });
  assert.equal(plan.remind.length, 1);
  assert.equal(plan.remind[0].remaining, 1);
  assert.equal(plan.remind[0].renterJid, 'a');

  // lewat tanggal: expired (sekali)
  plan = Rent.sweepRentals(db, rentConfig(), { now: NOW + 31 * DAY });
  assert.deepEqual(plan.expired, ['g1@g.us']);
  assert.equal(Rent.rentalStatus(db, 'g1@g.us', { now: NOW + 31 * DAY }), 'expired');

  // sweep lagi: expired tidak dobel
  plan = Rent.sweepRentals(db, rentConfig(), { now: NOW + 32 * DAY });
  assert.equal(plan.expired.length, 0);
});

test('parseGroupInput: link / id / nama / null', () => {
  assert.deepEqual(Rent.parseGroupInput('https://chat.whatsapp.com/AbC123'), { kind: 'link', value: 'AbC123' });
  assert.deepEqual(Rent.parseGroupInput('120363046825098789'), { kind: 'id', value: '120363046825098789' });
  assert.deepEqual(Rent.parseGroupInput('6289670762522-1614085129@g.us'), { kind: 'id', value: '6289670762522-1614085129@g.us' });
  assert.deepEqual(Rent.parseGroupInput('grup pelarian doi'), { kind: 'name', value: 'grup pelarian doi' });
  assert.equal(Rent.parseGroupInput('   '), null);
});

test('resolveGroupJid: link valid/batal, id, nama, tidak ketemu', async () => {
  const conn = {
    groupGetInviteInfo: async (code) => (code === 'GOOD' ? { id: '123@g.us', subject: 'Grup Uji' } : null),
    groupFetchAllParticipating: async () => ({
      '123@g.us': { id: '123@g.us', subject: 'Grup Pelarian Doi' },
      '456@g.us': { id: '456@g.us', subject: 'ECCLESIA' },
    }),
  };
  assert.deepEqual(await Rent.resolveGroupJid(conn, 'https://chat.whatsapp.com/GOOD'), { jid: '123@g.us', subject: 'Grup Uji' });
  assert.equal(await Rent.resolveGroupJid(conn, 'https://chat.whatsapp.com/BAD'), null);
  assert.deepEqual(await Rent.resolveGroupJid(conn, '120363046825098789'), { jid: '120363046825098789@g.us', subject: undefined });
  assert.deepEqual(await Rent.resolveGroupJid(conn, '6289670762522-1614085129@g.us'), { jid: '6289670762522-1614085129@g.us', subject: undefined });
  assert.deepEqual(await Rent.resolveGroupJid(conn, 'pelarian'), { jid: '123@g.us', subject: 'Grup Pelarian Doi' });
  assert.equal(await Rent.resolveGroupJid(conn, 'tidak ada grup ini'), null);
  assert.equal(await Rent.resolveGroupJid(conn, ''), null);
});

test('resolveGroupJid: nama yang cocok di banyak grup memunculkan kandidat, bukan pilih diam-diam', async () => {
  // Dua grup sama-sama bernama "ROOM 45" — kasus asli: owner menyewa grup
  // yang salah karena resolve memilih kecocokan pertama secara diam-diam.
  const conn = {
    groupFetchAllParticipating: async () => ({
      '120363401734744750@g.us': { id: '120363401734744750@g.us', subject: 'ROOM 45' },
      '120363402111344199@g.us': { id: '120363402111344199@g.us', subject: 'ROOM 45' },
    }),
  };
  await assert.rejects(
    () => Rent.resolveGroupJid(conn, 'ROOM 45'),
    (err) => {
      assert.equal(err.friendly, true, 'harus userError ramah');
      assert.match(err.message, /120363401734744750@g\.us/, 'kandidat pertama harus disebut');
      assert.match(err.message, /120363402111344199@g\.us/, 'kandidat kedua harus disebut');
      return true;
    },
  );
});

test('resolveGroupJid: nama yang cocok tunggal tetap jalan (tidak dianggap ambigu)', async () => {
  const conn = {
    groupFetchAllParticipating: async () => ({
      '111@g.us': { id: '111@g.us', subject: 'ROOM 45' },
      '222@g.us': { id: '222@g.us', subject: 'Grup Lain' },
    }),
  };
  assert.deepEqual(await Rent.resolveGroupJid(conn, 'ROOM 45'), { jid: '111@g.us', subject: 'ROOM 45' });
});

test('review: extendRent mereset reminders supaya periode berikutnya dapat reminder lagi', () => {
  const db = fakeDb();
  const cfg = rentConfig();
  Rent.activateRent(db, 'g@g.us', { renter: 'a', renterName: '', days: 30, by: 'o', now: NOW });

  // H-3 periode pertama -> reminder d3 terkirim
  let plan = Rent.sweepRentals(db, cfg, { now: NOW + 27 * DAY });
  assert.equal(plan.remind.length, 1);

  // renew (perpanjang) di H-1; expiry baru = NOW+29d+30d = NOW+59d ... sebenarnya
  // extendRent maju dari expiresAt lama (NOW+30d) -> NOW+60d. H-3 periode kedua = NOW+57d.
  Rent.extendRent(db, 'g@g.us', { days: 30, by: 'o', now: NOW + 29 * DAY });

  // H-3 periode kedua harus memicu reminder LAGI
  plan = Rent.sweepRentals(db, cfg, { now: NOW + 57 * DAY });
  assert.equal(plan.remind.length, 1, 'reminder periode kedua harus muncul setelah renew');
});

test('review: ownerInGroup mengenali peserta ber-LID yang punya phoneNumber', () => {
  const cfg = rentConfig();
  assert.equal(Rent.ownerInGroup([{ id: '271446714642565@lid', phoneNumber: '6280000000000@s.whatsapp.net' }], cfg), true);
  assert.equal(Rent.ownerInGroup([{ id: '271446714642565@lid' }], cfg), false);
  assert.equal(Rent.ownerInGroup([{ id: '6280000000000@s.whatsapp.net' }], cfg), true);
});