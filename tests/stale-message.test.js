import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-stale-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net', name: 'Bot Uji' },
    sendMessage: async (chat, content, opts) => {
      sent.push({ chat, content, opts });
      return { key: { id: `MSG${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  return { dir, db, plugins, conn, sent };
}

/** Pesan dengan timestamp relatif umur tertentu (detik). */
const agedMsg = (text, ageSeconds, chat = '628111@s.whatsapp.net') => ({
  key: {
    remoteJid: chat,
    fromMe: false,
    id: `IN-${Math.random().toString(36).slice(2, 8)}`,
    ...(chat.endsWith('@g.us') ? { participant: '628111@s.whatsapp.net' } : {}),
  },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000) - ageSeconds,
  pushName: 'Tester',
});

test('pesan basi (lewat threshold) diabaikan tanpa balasan', async () => {
  const { db, plugins, conn, sent } = await setup();
  // 1 jam lalu — jauh melebihi threshold 5 menit.
  const result = await handleMessage(conn, agedMsg('.calc 2+3', 3600), { plugins, db, config, logger: quiet });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'stale-message');
  assert.equal(sent.length, 0, 'tidak boleh ada balasan untuk pesan basi');
  db.close();
});

test('pesan segar (dalam threshold) tetap diproses', async () => {
  const { db, plugins, conn, sent } = await setup();
  // 10 detik lalu — masih dalam threshold.
  const result = await handleMessage(conn, agedMsg('.calc 2+3', 10), { plugins, db, config, logger: quiet });

  assert.equal(result.handled, true);
  assert.equal(result.plugin, 'tools-calc.js');
  assert.ok(sent.length > 0, 'pesan segar harus dibalas');
  db.close();
});

test('pesan tanpa timestamp (0) tidak dianggap basi', async () => {
  const { db, plugins, conn, sent } = await setup();
  const msg = agedMsg('.calc 2+3', 0);
  msg.messageTimestamp = 0; // timestamp hilang — jangan buang, proses saja
  const result = await handleMessage(conn, msg, { plugins, db, config, logger: quiet });

  assert.equal(result.handled, true, 'pesan tanpa timestamp tidak boleh dibuang');
  assert.ok(sent.length > 0);
  db.close();
});

test('timestamp di masa depan (clock skew) tidak dianggap basi', async () => {
  const { db, plugins, conn, sent } = await setup();
  // 60 detik ke depan — karena skew jam, harus tetap diproses.
  const msg = agedMsg('.calc 2+3', -60);
  const result = await handleMessage(conn, msg, { plugins, db, config, logger: quiet });

  assert.equal(result.handled, true, 'clock skew ke depan tidak boleh membuang pesan');
  assert.ok(sent.length > 0);
  db.close();
});
