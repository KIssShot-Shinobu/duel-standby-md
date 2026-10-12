import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  canToggleNsfw,
  chatNsfwEnabled,
  formatNsfwStatus,
  lockedText,
  parseNsfwAction,
  setChatNsfw,
  toggleDeniedText,
} from '../lib/nsfw-gate.js';
import { Database } from '../lib/database.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };

const makeDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-nsfw-gate-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  return { db, dir };
};

test('parseNsfwAction menerima berbagai kata, menolak tag', () => {
  for (const word of ['on', 'ON', 'enable', 'aktif', 'aktifkan', 'nyalakan']) {
    assert.equal(parseNsfwAction(word), 'on', `${word} harus dianggap "on"`);
  }
  for (const word of ['off', 'disable', 'mati', 'matikan', 'nonaktif', 'nonaktifkan']) {
    assert.equal(parseNsfwAction(word), 'off', `${word} harus dianggap "off"`);
  }
  for (const word of ['cat_ears', 'yuri', '', 'loli', 'onoff']) {
    assert.equal(parseNsfwAction(word), '', `${word} bukan aksi`);
  }
});

test('status NSFW per chat default MATI dan bisa diubah', () => {
  const { db } = makeDb();
  const chat = '123@g.us';

  assert.equal(chatNsfwEnabled(db, chat), false, 'default harus mati');

  assert.equal(setChatNsfw(db, chat, true), true);
  assert.equal(chatNsfwEnabled(db, chat), true);
  assert.equal(db.chat(chat).nsfw, true);

  assert.equal(setChatNsfw(db, chat, false), false);
  assert.equal(chatNsfwEnabled(db, chat), false);

  // grup lain tidak ikut berubah
  assert.equal(chatNsfwEnabled(db, '456@g.us'), false);
  db.close();
});

test('flag NSFW per chat tersimpan ke database', () => {
  const { db, dir } = makeDb();
  setChatNsfw(db, '789@g.us', true);
  db.close();

  const reloaded = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  reloaded.load();
  assert.equal(chatNsfwEnabled(reloaded, '789@g.us'), true, 'status harus bertahan setelah restart');
  reloaded.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('canToggleNsfw: owner di mana saja, admin hanya di grup', () => {
  assert.equal(canToggleNsfw({ isOwner: true }), true);
  assert.equal(canToggleNsfw({ isOwner: true, isGroup: false, isAdmin: false }), true);
  assert.equal(canToggleNsfw({ isOwner: false, isAdmin: true, isGroup: true }), true);
  assert.equal(canToggleNsfw({ isOwner: false, isAdmin: true, isGroup: false }), false, 'admin grup tidak relevan di japri');
  assert.equal(canToggleNsfw({ isOwner: false, isAdmin: false, isGroup: true }), false, 'member biasa tidak boleh');
  assert.equal(canToggleNsfw({}), false);
});

test('teks bantuan menyebut siapa yang boleh dan caranya', () => {
  assert.match(toggleDeniedText(true), /admin grup/i);
  assert.match(toggleDeniedText(false), /chat pribadi/i);
  assert.match(lockedText('.', true), /belum diaktifkan/i);
  assert.match(lockedText('.', true), /\.nsfw on/);

  const status = formatNsfwStatus({ globalEnabled: true, chatEnabled: false, isGroup: true, usedPrefix: '.' });
  assert.match(status, /Kategori bot : ✅ aktif/);
  assert.match(status, /Grup ini\s+: ⛔ mati/);
  assert.match(status, /nsfw on \/ nsfw off/);
});
