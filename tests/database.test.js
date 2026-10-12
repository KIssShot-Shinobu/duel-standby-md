import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Database, DEFAULT_USER, initDatabase } from '../lib/database.js';
import { consumeLimit, levelFromExp, levelProgress, expForLevel, refreshLimit } from '../lib/permissions.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-db-'));

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
