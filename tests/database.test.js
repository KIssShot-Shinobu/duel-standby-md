import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../config.js';
import { Database, DEFAULT_USER, initDatabase } from '../lib/database.js';
import { consumeLimit, isParticipantAdmin, levelFromExp, levelProgress, expForLevel, refreshLimit } from '../lib/permissions.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-db-'));
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

test('database: default, user, dan chat', async () => {
  const dir = tmpDir();
  const db = new Database(path.join(dir, 'database.json'), { saveInterval: 5, logger: { warn() {}, error() {} } });
  db.load();

  assert.equal(db.stats().users, 0);
  const user = db.user('628111@s.whatsapp.net');
  assert.equal(user.limit, 0);
  assert.equal(user.role, 'user');
  assert.equal(Object.keys(DEFAULT_USER()).every((key) => key in user), true);

  const chat = db.chat('123@g.us');
  assert.equal(chat.antiLink, false);
  assert.equal(chat.welcome, true);

  await db.save(true);
  db.close();
});

test('database: simpan -> muat ulang (roundtrip)', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'database.json');

  const first = new Database(file, { saveInterval: 5, logger: { warn() {}, error() {} } });
  first.load();
  first.user('628222@s.whatsapp.net').saldo = 1234;
  first.chat('999@g.us').antiLink = true;
  first.data.stats.messages = 42;
  await first.save(true);
  first.close();

  const second = new Database(file, { saveInterval: 5, logger: { warn() {}, error() {} } });
  second.load();
  assert.equal(second.user('628222@s.whatsapp.net').saldo, 1234);
  assert.equal(second.chat('999@g.us').antiLink, true);
  assert.equal(second.data.stats.messages, 42);
  second.close();
});

test('database: section rentals & renters terpisah dari users, survive roundtrip', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'database.json');

  const first = new Database(file, { saveInterval: 5, logger: { warn() {}, error() {} } });
  first.load();

  // selalu objek setelah load, walau file kosong
  assert.equal(typeof first.data.rentals, 'object');
  assert.equal(typeof first.data.renters, 'object');
  assert.notEqual(first.data.rentals, first.data.users);
  assert.notEqual(first.data.renters, first.data.users);

  first.data.rentals['123@g.us'] = {
    status: 'active',
    renter: '628111@s.whatsapp.net',
    startedAt: 1,
    expiresAt: 999,
    history: [],
  };
  first.data.renters['628111@s.whatsapp.net'] = { since: 1, name: 'Budi', groups: ['123@g.us'] };
  await first.save(true);
  first.close();

  const second = new Database(file, { saveInterval: 5, logger: { warn() {}, error() {} } });
  second.load();
  assert.equal(second.data.rentals['123@g.us'].status, 'active');
  assert.equal(second.data.renters['628111@s.whatsapp.net'].name, 'Budi');
  second.close();
});

test('database: section sholat selalu objek & survive roundtrip', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'database.json');

  const first = new Database(file, { saveInterval: 5, logger: { warn() {}, error() {} } });
  first.load();

  // selalu objek setelah load, walau file kosong
  assert.equal(typeof first.data.sholat, 'object');
  assert.notEqual(first.data.sholat, first.data.users);

  first.data.sholat['628111@s.whatsapp.net'] = { jid: '628111@s.whatsapp.net', cityId: '1301' };
  await first.save(true);
  first.close();

  const second = new Database(file, { saveInterval: 5, logger: { warn() {}, error() {} } });
  second.load();
  assert.equal(second.data.sholat['628111@s.whatsapp.net'].cityId, '1301');
  second.close();

  // nilai rusak (bukan objek) diperbaiki, bukan dipertahankan
  fs.writeFileSync(file, JSON.stringify({ sholat: 'rusak' }), 'utf8');
  const third = new Database(file, { saveInterval: 5, logger: { warn() {}, error() {} } });
  third.load();
  assert.deepEqual(third.data.sholat, {});
  third.close();
});

test('database: file rusak tidak menghapus data (dibackup .corrupt)', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'database.json');
  fs.writeFileSync(file, '{ bukan json');

  const warnings = [];
  const db = new Database(file, { saveInterval: 5, logger: { warn: (m) => warnings.push(m), error() {} } });
  db.load();

  assert.equal(warnings.length, 1);
  assert.ok(fs.readdirSync(dir).some((name) => name.includes('.corrupt-')));
  assert.equal(db.stats().users, 0);
  db.close();
});

test('database: initDatabase menambah hitungan start', async () => {
  const dir = tmpDir();
  const db = await initDatabase(
    { database: { file: path.join(dir, 'database.json'), saveInterval: 5 } },
    { warn() {}, error() {} },
  );
  assert.equal(db.data.stats.starts, 1);
  db.close();
});

test('database: pemetaan LID -> nomor telepon', () => {
  const dir = tmpDir();
  const db = new Database(path.join(dir, 'database.json'), { saveInterval: 5, logger: { warn() {}, error() {} } });
  db.load();

  const lid = '271446714642565@lid';
  const pn = '6289530694332@s.whatsapp.net';

  // sebelum dipetakan, jid LID dibiarkan apa adanya
  assert.equal(db.resolveLid(lid), lid);
  assert.equal(db.resolveLid(pn), pn);

  db.user(lid).saldo = 99;
  assert.equal(db.mapLid(lid, pn), true);
  assert.equal(db.resolveLid(lid), pn);
  // data user ikut dipindahkan ke jid nomor telepon
  assert.equal(db.user(pn).saldo, 99);
  assert.equal(db.data.users[lid], undefined);
  // pemetaan ulang tidak dianggap perubahan
  assert.equal(db.mapLid(lid, pn), false);

  db.close();
});

test('database: pemetaan LID tidak menghapus premium/limit dari owner', () => {
  const dir = tmpDir();
  const db = new Database(path.join(dir, 'database.json'), { saveInterval: 5, logger: quiet });
  db.load();

  const lid = '999888777666555@lid';
  const pn = '628111222333@s.whatsapp.net';

  // Owner memberi premium + limit saat target masih tercatat sebagai LID.
  const lidUser = db.user(lid);
  lidUser.premium = true;
  lidUser.premiumUntil = Date.now() + 30 * 86400000;
  lidUser.limitBonus = 10;
  lidUser.limit = 30;

  // Record nomor telepon sudah ada tapi masih default (premium=false, limit=0).
  db.user(pn);

  assert.equal(db.mapLid(lid, pn), true);
  const merged = db.user(pn);
  assert.equal(merged.premium, true, 'premium tidak boleh hilang saat penggabungan');
  assert.ok(merged.premiumUntil > Date.now(), 'masa premium harus ikut');
  assert.equal(merged.limitBonus, 10, 'bonus limit owner tidak boleh hilang');
  assert.ok(merged.limit >= 30, `limit hasil gabung terlalu kecil: ${merged.limit}`);
  assert.equal(db.data.users[lid], undefined, 'record LID harus dilebur');
  db.close();
});

test('database: user(LID) memakai record nomor telepon setelah dipetakan', () => {
  const dir = tmpDir();
  const db = new Database(path.join(dir, 'database.json'), { saveInterval: 5, logger: quiet });
  db.load();

  const lid = '111222333444555@lid';
  const pn = '628555666777@s.whatsapp.net';

  db.mapLid(lid, pn);
  const viaLid = db.user(lid);
  const viaPn = db.user(pn);

  assert.equal(viaLid.jid, pn, 'user(LID) harus menunjuk record nomor telepon');
  assert.equal(viaLid, viaPn, 'harus object yang sama, bukan record terpisah');

  // premium yang ditulis lewat LID tetap terlihat lewat nomor telepon
  viaLid.premium = true;
  viaLid.limitBonus = 5;
  assert.equal(db.user(pn).premium, true);
  assert.equal(db.user(pn).limitBonus, 5);
  db.close();
});

test('database: record LID lama (premium/limit 0) tidak menimpa premium nomor', () => {
  // Keadaan yang terbentuk di server sebelum pemetaan LID diperbaiki:
  // owner menambah premium ke record nomor telepon, sementara semua pesan user
  // masuk ke record LID (yang stayed free 20 limit). Saat pemetaan akhirnya
  // dipelajari, kedua record harus dilebur: premium/limit dari nomor bertahan,
  // dan exp/saldo/command dari record LID ikut terselamatkan.
  const dir = tmpDir();
  const db = new Database(path.join(dir, 'database.json'), { saveInterval: 5, logger: quiet });
  db.load();

  const lid = '271446714642565@lid';
  const pn = '6289530694332@s.whatsapp.net';

  const pnUser = db.user(pn);
  pnUser.premium = true;
  pnUser.premiumUntil = Date.now() + 30 * 86400000;
  pnUser.limit = config.limits.premium;
  pnUser.exp = 0;
  pnUser.saldo = 0;
  pnUser.totalCommands = 0;

  const lidUser = db.user(lid);
  lidUser.premium = false;
  lidUser.limit = config.limits.free;
  lidUser.exp = 500;
  lidUser.saldo = 300;
  lidUser.totalCommands = 50;

  db.mapLid(lid, pn);

  assert.equal(db.data.users[lid], undefined, 'record LID harus hilang setelah dilebur');
  const merged = db.user(pn);
  assert.equal(merged.premium, true, 'premium dari nomor telepon tidak boleh ditimpa record LID');
  assert.ok(merged.premiumUntil > Date.now(), 'masa premium harus ikut tersimpan');
  assert.equal(merged.limit, config.limits.premium, 'limit premium harus bertahan');
  assert.equal(merged.exp, 500, 'exp dari record LID harus ikut terselamatkan');
  assert.equal(merged.saldo, 300, 'saldo dari record LID harus ikut terselamatkan');
  assert.equal(merged.totalCommands, 50, 'total command dari record LID harus ikut terselamatkan');
  db.close();
});

test('database: dua record hantu untuk satu user -> masa premium terpanjang', () => {
  // Terlihat di data panel: satu user punya `271446714642565@s.whatsapp.net`
  // (premium s/d 2027-03-31) DAN `@271446714642565` (s/d 2026-11-11, limit
  // 1000). Setelah dilebur, yang harus menang adalah masa premium TERPANJANG.
  const dir = tmpDir();
  const db = new Database(path.join(dir, 'database.json'), { saveInterval: 5, logger: quiet });
  db.load();

  const lid = '271446714642565@lid';
  const pn = '628970080509@s.whatsapp.net';
  const day = 86400000;
  db.data.lidMap[lid] = pn;

  db.user(pn).exp = 812;
  db.data.users[`${lid.split('@')[0]}@s.whatsapp.net`] = {
    ...DEFAULT_USER(), premium: true, premiumUntil: Date.now() + 200 * day, limit: 120, limitBonus: 20,
  };
  db.data.users[`@${lid.split('@')[0]}`] = {
    ...DEFAULT_USER(), premium: true, premiumUntil: Date.now() + 30 * day, limit: 1000,
  };

  const repaired = db.repairLidRecords();

  assert.equal(repaired, 2, 'kedua record hantu harus digabung');
  assert.equal(db.data.users[`${lid.split('@')[0]}@s.whatsapp.net`], undefined);
  assert.equal(db.data.users[`@${lid.split('@')[0]}`], undefined);
  const u = db.user(pn);
  assert.equal(u.premium, true);
  assert.ok(u.premiumUntil > Date.now() + 199 * day, 'masa premium TERPANJANG harus menang');
  assert.equal(u.limitBonus, 20, 'bonus hanya di satu record, tidak boleh berlipat');
  assert.equal(u.limit, 1000, 'limit tertinggi harus menang');
  assert.equal(u.exp, 812, 'aktivitas user asli harus tetap ada');
  db.close();
});

test('database: resolveIdentity mengubah LID-yang-dipaksakan-jadi-nomor', () => {
  const dir = tmpDir();
  const db = new Database(path.join(dir, 'database.json'), { saveInterval: 5, logger: quiet });
  db.load();

  db.data.lidMap['271446714642565@lid'] = '628970080509@s.whatsapp.net';

  for (const bogus of ['271446714642565@s.whatsapp.net', '@271446714642565', '271446714642565']) {
    assert.equal(
      db.resolveIdentity(bogus),
      '628970080509@s.whatsapp.net',
      `resolveIdentity harus mengembalikan nomor asli untuk ${bogus}`,
    );
    assert.equal(db.user(bogus).jid, '628970080509@s.whatsapp.net', `user(${bogus}) harus record nomor`);
  }
  db.close();
});

test('database: load() melebur sisa record LID dari versi lama', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'database.json');
  const pn = '6289530694332@s.whatsapp.net';
  const lid = '271446714642565@lid';

  fs.writeFileSync(
    file,
    JSON.stringify({
      meta: {},
      settings: {},
      stats: {},
      users: {
        [lid]: { jid: lid, premium: true, premiumUntil: Date.now() + 86400000, limitBonus: 7, limit: 40, saldo: 12 },
        [pn]: { jid: pn, premium: false, limitBonus: 0, limit: 0 },
      },
      chats: {},
      lidMap: { [lid]: pn },
    }),
    'utf8',
  );

  const db = new Database(file, { saveInterval: 5, logger: quiet });
  db.load();

  const user = db.user(pn);
  assert.equal(user.premium, true, 'premium di record LID harus ikut pindah');
  assert.equal(user.limitBonus, 7, 'bonus limit harus ikut pindah');
  assert.equal(user.saldo, 12, 'saldo harus ikut pindah');
  assert.equal(db.data.users[lid], undefined, 'record LID harus dilebur saat load');
  db.close();
});

test('permissions: limit, premium, dan level', () => {
  const dir = tmpDir();
  const db = new Database(path.join(dir, 'database.json'), { saveInterval: 5, logger: { warn() {}, error() {} } });
  db.load();
  const config = { limits: { free: 10, premium: 50, resetIntervalMs: 86400000 }, bot: { premiumJids: [], owners: [] } };
  const user = db.user('628333@s.whatsapp.net');

  user.lastLimitReset = Date.now();
  user.limit = 2;
  assert.equal(refreshLimit(db, user, config), 2);

  const plugin = { limit: true };
  assert.equal(consumeLimit(db, user, plugin, config).ok, true);
  assert.equal(user.limit, 1);
  assert.equal(consumeLimit(db, user, plugin, config).ok, true);
  const denied = consumeLimit(db, user, plugin, config);
  assert.equal(denied.ok, false);

  assert.equal(expForLevel(2), 400);
  assert.equal(levelFromExp(400), 2);
  assert.equal(levelProgress(400).percent, 0);
  db.close();
});

test('permissions: admin grup dikenali walau identitas LID/nomor berbeda', () => {
  // daftar peserta memakai LID, pengirim terbaca sebagai nomor telepon
  const metadataLid = {
    participants: [{ id: '271446714642565@lid', admin: 'admin' }, { id: '628222222222@s.whatsapp.net' }],
  };
  assert.equal(isParticipantAdmin(metadataLid, '628111111111@s.whatsapp.net', ['271446714642565@lid']), true);
  assert.equal(isParticipantAdmin(metadataLid, '628222222222@s.whatsapp.net'), false, 'bukan admin');

  // sebaliknya: daftar peserta memakai nomor telepon, pengirim terbaca sebagai LID
  const metadataPn = { participants: [{ id: '628111111111@s.whatsapp.net', admin: 'superadmin' }] };
  assert.equal(isParticipantAdmin(metadataPn, '271446714642565@lid', ['628111111111@s.whatsapp.net']), true);

  // kolom identitas alternatif peserta ikut dicek (lid/phoneNumber)
  const metadataAlt = { participants: [{ lid: '999888777666555@lid', phoneNumber: '628333333333', admin: 'admin' }] };
  assert.equal(isParticipantAdmin(metadataAlt, '628333333333@s.whatsapp.net'), true);

  assert.equal(isParticipantAdmin({ participants: [] }, '628111111111@s.whatsapp.net'), false);
  assert.equal(isParticipantAdmin(null, '628111111111@s.whatsapp.net'), false);
});
