import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import baseConfig from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const SENDER = '628123456789@s.whatsapp.net';

// Hadiah chat dimatikan supaya saldo yang diuji benar-benar saldo dari setup.
const config = { ...baseConfig, rewards: { ...baseConfig.rewards, chat: { ...baseConfig.rewards.chat, enabled: false } } };

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-buylimit-e2e-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();
  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net', name: 'Bot Uji' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  return { db, plugins, conn, sent };
}

// Di chat pribadi pengirim = remoteJid, jadi remoteJid harus SENDER supaya
// pesan diatribusikan ke user yang jadi target pengujian.
const chat = (body) => ({
  key: { remoteJid: SENDER, fromMe: false, id: `B${Math.random().toString(36).slice(2, 7)}` },
  message: { conversation: body },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Pembeli',
});

const run = (conn, db, plugins, body) => handleMessage(conn, chat(body), { plugins, db, config, logger: quiet });
const body = (sent) => sent.map((item) => item.content?.text || '').join('\n');

test('E2E: .buylimit menampilkan katalog tanpa memotong limit', async () => {
  const { db, plugins, conn, sent } = await setup();
  const user = db.user(SENDER);
  user.saldo = 100000;
  user.lastLimitReset = Date.now();

  const result = await run(conn, db, plugins, '.buylimit');

  assert.equal(result.handled, true, `plugin tidak jalan: ${result.reason}`);
  const text = body(sent);
  assert.match(text, /Belanja Limit/);
  assert.match(text, /10 limit/);
  assert.match(text, /30 limit/);
  assert.match(text, /60 limit/);
  assert.match(text, /hemat/);
  assert.equal(user.limitBonus, 0, 'melihat katalog tidak boleh membeli apa pun');
  db.close();
});

test('E2E: .buylimit 30 membeli paket dan memotong saldo', async () => {
  const { db, plugins, conn, sent } = await setup();
  const user = db.user(SENDER);
  user.saldo = 100000;
  user.lastLimitReset = Date.now();
  const saldoAwal = user.saldo;
  const pack = baseConfig.buyLimit.packages.find((p) => p.limit === 30);

  const result = await run(conn, db, plugins, '.buylimit 30');

  assert.equal(result.handled, true, `plugin tidak jalan: ${result.reason}`);
  assert.equal(user.limitBonus, 30, 'bonus harus naik 30');
  assert.equal(user.saldo, saldoAwal - pack.price, 'saldo harus dipotong harga paket');
  assert.match(body(sent), /Berhasil beli \*30\* limit/);
  assert.match(body(sent), /permanen/);
  db.close();
});

test('E2E: .buylimit sendiri tidak memotong limit', async () => {
  const { db, plugins, conn } = await setup();
  const user = db.user(SENDER);
  user.saldo = 100000;
  user.lastLimitReset = Date.now();
  user.limit = 20; // kuota penuh

  await run(conn, db, plugins, '.buylimit');

  assert.equal(user.limit, 20, 'menampilkan katalog tidak boleh memotong limit');
  db.close();
});

test('E2E: saldo kurang ditolak dan saldo tidak berubah', async () => {
  const { db, plugins, conn, sent } = await setup();
  const user = db.user(SENDER);
  user.saldo = 100;

  const result = await run(conn, db, plugins, '.buylimit 10');

  assert.equal(result.handled, true);
  assert.match(body(sent), /Saldo kamu belum cukup/);
  assert.equal(user.saldo, 100, 'saldo tidak boleh berubah saat gagal');
  assert.equal(user.limitBonus, 0);
  db.close();
});

test('E2E: jumlah di luar rentang menampilkan format + katalog', async () => {
  const { db, plugins, conn, sent } = await setup();
  db.user(SENDER).saldo = 100000;

  await run(conn, db, plugins, '.buylimit 9999');

  const text = body(sent);
  assert.match(text, /Minimal/);
  assert.match(text, /Belanja Limit/);
  db.close();
});

test('E2E: batas harian terbuka lagi di siklus limit berikutnya', async () => {
  const { db, plugins, conn, sent } = await setup();
  const user = db.user(SENDER);
  user.saldo = 1000000;
  user.lastLimitReset = Date.now();

  // habiskan jatah siklus ini
  await run(conn, db, plugins, `.buylimit ${baseConfig.buyLimit.dailyCap}`);
  assert.equal(user.buyDayAmount, baseConfig.buyLimit.dailyCap);

  sent.length = 0;
  await run(conn, db, plugins, '.buylimit 1');
  assert.match(body(sent), /jatah beli limit harian sudah habis/i);

  // jendela 24 jam berikutnya
  user.buyDayKey = Date.now() - baseConfig.limits.resetIntervalMs - 1000;
  sent.length = 0;
  await run(conn, db, plugins, '.buylimit 1');
  assert.match(body(sent), /Berhasil beli \*1\* limit/, 'setelah reset siklus harus bisa beli lagi');
  db.close();
});

test('E2E: limit yang dibeli dipakai command berlimit seperti biasa', async () => {
  const { db, plugins, conn } = await setup();
  const user = db.user(SENDER);
  user.saldo = 100000;
  user.lastLimitReset = Date.now();

  await run(conn, db, plugins, '.buylimit 10');
  const setelahBeli = user.limit;

  // `.banlist` punya handler.limit = true (biaya 1). `.calc` sengaja tidak
  // dipakai di sini karena itu command gratis.
  await run(conn, db, plugins, '.banlist');
  assert.equal(user.limit, setelahBeli - 1, 'limit yang dibeli harus terpakai command biasa');
  db.close();
});

test('E2E: command gratis tidak memotong limit yang dibeli', async () => {
  const { db, plugins, conn } = await setup();
  const user = db.user(SENDER);
  user.saldo = 100000;
  user.lastLimitReset = Date.now();

  await run(conn, db, plugins, '.buylimit 10');
  const setelahBeli = user.limit;

  await run(conn, db, plugins, '.calc 1+1');
  assert.equal(user.limit, setelahBeli, 'command gratis tidak boleh memotong limit');
  db.close();
});