import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../config.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import { refreshLimit } from '../lib/permissions.js';
import ownerUser, { resolveTarget } from '../plugins/owner-user.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');

const OWNER = '628999999999@s.whatsapp.net';
const TARGET = '628123456789';
const TARGET_JID = `${TARGET}@s.whatsapp.net`;

const makeDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-owner-user-'));
  const file = path.join(dir, 'db.json');
  const db = new Database(file, { saveInterval: 60000, logger: quiet });
  db.load();
  return { db, file };
};

const run = async (db, { command, args = [], mentionedJid = [], quoted = null }) => {
  const sent = [];
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();
  const m = {
    chat: 'x',
    sender: OWNER,
    pushName: 'Owner',
    mentionedJid,
    quoted,
    reply: async (text) => {
      sent.push(String(text));
      return { key: { id: 'R' } };
    },
  };
  await ownerUser(m, { plugins, db, config, args, command, usedPrefix: '.', conn: { sendMessage: async () => ({}) } });
  return sent.at(-1) || '';
};

// ── Resolusi target ────────────────────────────────────────────────────────

test('resolveTarget menerima nomor, 08xx, mention, dan mention di argumen', () => {
  const cases = [
    [['628123456789'], TARGET_JID],
    [['08123456789'], TARGET_JID],
    [['@628123456789'], TARGET_JID],
    [['628123456789:12@s.whatsapp.net'], TARGET_JID],
  ];
  for (const [args, expected] of cases) {
    const { jid } = resolveTarget({}, args);
    assert.equal(jid, expected, `args ${JSON.stringify(args)} -> ${jid}`);
  }
  // sisa argumen menjadi parameter (hari / jumlah)
  assert.deepEqual(resolveTarget({}, ['628123456789', '30']).rest, ['30']);
});

test('resolveTarget memakai mention / pesan yang di-reply kalau nomor tidak ditulis', () => {
  assert.equal(resolveTarget({ mentionedJid: [TARGET_JID] }, ['30']).jid, TARGET_JID);
  assert.equal(resolveTarget({ quoted: { sender: '628222@s.whatsapp.net' } }, ['30']).jid, '628222@s.whatsapp.net');

  // angka pada argumen tetap dianggap parameter (hari / jumlah), bukan target
  const viaQuote = resolveTarget({ quoted: { sender: TARGET_JID } }, ['30']);
  assert.equal(viaQuote.jid, TARGET_JID);
  assert.deepEqual(viaQuote.rest, ['30']);

  // tanpa target sama sekali
  assert.equal(resolveTarget({}, ['30']).jid, '');
});

// ── Premium ────────────────────────────────────────────────────────────────

test('.premium add menambahkan premium + kuota limit premium', async () => {
  const { db, file } = makeDb();
  const reply = await run(db, { command: 'premium', args: ['add', TARGET, '30'] });

  const user = db.user(TARGET_JID);
  assert.equal(user.premium, true, 'premium harus aktif');
  assert.ok(user.premiumUntil > Date.now() + 29 * 86400000, 'masa premium 30 hari');
  assert.equal(user.limit, config.limits.premium, 'kuota limit langsung jadi kuota premium');
  assert.match(reply, /premium/i);

  // tersimpan ke disk
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.users[TARGET_JID].premium, true);
  db.close();
});

test('.premium add dengan mention (@nomor) tidak membuat record palsu', async () => {
  const { db } = makeDb();
  await run(db, { command: 'premium', args: ['add', `@${TARGET}`, '7'] });

  assert.equal(db.user(TARGET_JID).premium, true, 'premium harus masuk ke user sebenarnya');
  const bogus = Object.keys(db.data.users).filter((jid) => jid.startsWith('@'));
  assert.deepEqual(bogus, [], `ada record palsu: ${bogus.join(', ')}`);
  db.close();
});

test('.premium add saat reply pesan user (tanpa menulis nomor)', async () => {
  const { db } = makeDb();
  await run(db, { command: 'premium', args: ['add', '30'], quoted: { sender: '628222333444@s.whatsapp.net' } });

  const user = db.user('628222333444@s.whatsapp.net');
  assert.equal(user.premium, true);
  assert.ok(user.premiumUntil > Date.now() + 29 * 86400000, '30 hari dari argumen');
  db.close();
});

test('.premium add saat masih aktif menambah hari dari sisa masa aktif', async () => {
  const { db } = makeDb();
  await run(db, { command: 'premium', args: ['add', TARGET, '30'] });
  const user = db.user(TARGET_JID);

  user.premiumUntil = Date.now() + 5 * 86400000; // sisa 5 hari
  const reply = await run(db, { command: 'premium', args: ['add', TARGET, '30'] });

  const sisaHari = (user.premiumUntil - Date.now()) / 86400000;
  assert.ok(sisaHari > 34.9 && sisaHari < 35.1, `harusnya ~35 hari, dapat ${sisaHari.toFixed(2)}`);
  assert.match(reply, /diperpanjang/i);
  db.close();
});

test('.premium del mencabut premium dan mengembalikan kuota free', async () => {
  const { db } = makeDb();
  await run(db, { command: 'premium', args: ['add', TARGET, '30'] });
  await run(db, { command: 'premium', args: ['del', TARGET] });

  const user = db.user(TARGET_JID);
  assert.equal(user.premium, false);
  assert.equal(user.premiumUntil, 0);
  assert.equal(user.limit, config.limits.free);
  db.close();
});

// ── Limit ──────────────────────────────────────────────────────────────────

test('.limit add menambah limit user baru dan bertahan setelah reset harian', async () => {
  const { db, file } = makeDb();
  const reply = await run(db, { command: 'limit', args: ['add', TARGET, '10'] });

  const user = db.user(TARGET_JID);
  assert.equal(user.limit, config.limits.free + 10, 'kuota dasar + tambahan owner');
  assert.equal(user.limitBonus, 10, 'tambahan disimpan sebagai bonus');
  assert.match(reply, /30|10/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).users[TARGET_JID].limit, config.limits.free + 10);

  // simulasikan reset harian berikutnya: bonus harus tetap ikut
  user.lastLimitReset = Date.now() - 25 * 60 * 60 * 1000;
  const afterReset = refreshLimit(db, user, config);
  assert.equal(afterReset, config.limits.free + 10, 'bonus owner tidak boleh hilang saat reset');
  db.close();
});

test('.limit add menyelaraskan kuota harian (angka sama dengan yang dilihat user)', async () => {
  const { db } = makeDb();
  const user = db.user(TARGET_JID);
  // seolah kuota kemarin habis & jadwal reset sudah lewat
  user.lastLimitReset = Date.now() - 25 * 60 * 60 * 1000;
  user.limit = 0;

  const reply = await run(db, { command: 'limit', args: ['add', TARGET, '10'] });

  assert.equal(user.limit, config.limits.free + 10, 'kuota harian di-refresh dulu, baru ditambah 10');
  assert.equal(refreshLimit(db, user, config), user.limit, 'angka balasan owner harus sama dengan .profile user');
  assert.match(reply, /kuota harian/);
  db.close();
});

test('.limit del mengurangi limit tanpa menyisakan angka negatif', async () => {
  const { db } = makeDb();
  await run(db, { command: 'limit', args: ['add', TARGET, '10'] });
  await run(db, { command: 'limit', args: ['del', TARGET, '4'] });

  const user = db.user(TARGET_JID);
  assert.equal(user.limitBonus, 6);
  assert.equal(user.limit, config.limits.free + 6);

  await run(db, { command: 'limit', args: ['del', TARGET, '999'] });
  assert.equal(user.limit, 0);
  assert.equal(user.limitBonus, 0);
  db.close();
});

test('.resetlimit tetap mempertahankan bonus owner', async () => {
  const { db } = makeDb();
  await run(db, { command: 'limit', args: ['add', TARGET, '15'] });
  db.user(TARGET_JID).limit = 0; // seolah sudah habis terpakai

  const reply = await run(db, { command: 'resetlimit', args: [TARGET] });
  assert.equal(db.user(TARGET_JID).limit, config.limits.free + 15);
  assert.match(reply, /reset/i);
  db.close();
});

// ── Keamanan input ─────────────────────────────────────────────────────────

test('target tidak valid tidak membuat user palsu (hanya petunjuk)', async () => {
  const { db } = makeDb();
  const before = Object.keys(db.data.users).length;
  const reply = await run(db, { command: 'premium', args: ['add'] });

  assert.equal(Object.keys(db.data.users).length, before, 'tidak boleh ada user baru');
  assert.match(reply, /Manajemen user/i);
  assert.equal(db.user(TARGET_JID).premium, false);
  db.close();
});

test('.ban & .unban tetap bekerja dan tersimpan', async () => {
  const { db, file } = makeDb();
  await run(db, { command: 'ban', args: [TARGET, 'spam'] });
  assert.equal(db.user(TARGET_JID).banned, true);
  assert.equal(db.user(TARGET_JID).bannedReason, 'spam');

  await run(db, { command: 'unban', args: [TARGET] });
  assert.equal(db.user(TARGET_JID).banned, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).users[TARGET_JID].banned, false);
  db.close();
});
