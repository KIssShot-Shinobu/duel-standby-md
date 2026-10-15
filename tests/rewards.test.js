import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import { levelFromExp, rewardChatMessage } from '../lib/permissions.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');

const makeDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-reward-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();
  return db;
};

const rewardConfig = (overrides = {}) => ({
  ...config,
  rewards: { chat: { enabled: true, expMin: 1, expMax: 9, saldoMin: 1, saldoMax: 9, cooldownMs: 0, levelUpNotice: true, ...overrides } },
});

// ── Fungsi reward ──────────────────────────────────────────────────────────

test('rewardChatMessage memberi XP & saldo acak 1-9 tiap panggilan', () => {
  const db = makeDb();
  const jid = '628111@s.whatsapp.net';
  const conf = rewardConfig();

  let totalExp = 0;
  let totalSaldo = 0;
  for (let i = 0; i < 60; i += 1) {
    const reward = rewardChatMessage(db, jid, conf, { now: Date.now() + i });
    assert.ok(reward.exp >= 1 && reward.exp <= 9, `exp di luar 1-9: ${reward.exp}`);
    assert.ok(reward.saldo >= 1 && reward.saldo <= 9, `saldo di luar 1-9: ${reward.saldo}`);
    totalExp += reward.exp;
    totalSaldo += reward.saldo;
  }

  const user = db.user(jid);
  assert.equal(user.exp, totalExp, 'exp harus terakumulasi');
  assert.equal(user.saldo, totalSaldo, 'saldo harus terakumulasi');
  assert.equal(user.level, levelFromExp(totalExp));
  db.close();
});

test('rewardChatMessage menghormati batas min/max dari config', () => {
  const db = makeDb();
  const jid = '628111@s.whatsapp.net';
  const conf = rewardConfig({ expMin: 5, expMax: 5, saldoMin: 7, saldoMax: 7 });

  const reward = rewardChatMessage(db, jid, conf);
  assert.equal(reward.exp, 5);
  assert.equal(reward.saldo, 7);
  db.close();
});

test('rewardChatMessage mendeteksi naik level', () => {
  const db = makeDb();
  const jid = '628111@s.whatsapp.net';
  const user = db.user(jid);
  user.exp = 99;
  user.level = 0; // level 1 dimulai di 100 exp

  const reward = rewardChatMessage(db, jid, rewardConfig({ expMin: 1, expMax: 1 }));
  assert.equal(user.exp, 100);
  assert.equal(reward.level, 1);
  assert.equal(reward.levelUp, true);
  db.close();
});

test('rewardChatMessage bisa dimatikan & mendukung cooldown', () => {
  const db = makeDb();
  const jid = '628111@s.whatsapp.net';

  // dimatikan
  assert.equal(rewardChatMessage(db, jid, rewardConfig({ enabled: false })), null);
  assert.equal(db.user(jid).exp, 0);

  // cooldown: panggilan kedua dalam jendela cooldown diabaikan
  const conf = rewardConfig({ cooldownMs: 10000 });
  const first = rewardChatMessage(db, jid, conf, { now: 1_000_000 });
  assert.ok(first);
  assert.equal(rewardChatMessage(db, jid, conf, { now: 1_000_000 + 5000 }), null, 'harus kena cooldown');
  const later = rewardChatMessage(db, jid, conf, { now: 1_000_000 + 10001 });
  assert.ok(later, 'setelah cooldown lewat harus dapat lagi');
  db.close();
});

// ── Terpasang di handler ───────────────────────────────────────────────────

async function setup() {
  const db = makeDb();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
  };
  return { db, plugins, conn, sent };
}

const chatMessage = (text, chat = '628111@s.whatsapp.net', extra = {}) => ({
  key: { remoteJid: chat, fromMe: false, id: `T${Math.random().toString(36).slice(2, 7)}`, ...(chat.endsWith('@g.us') ? { participant: '628111@s.whatsapp.net' } : {}) },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Tester',
  ...extra,
});

test('setiap pesan user mendapat XP & saldo 1-9', async () => {
  const { db, plugins, conn } = await setup();
  const sender = '628111@s.whatsapp.net';
  db.user(sender).exp = 0;
  db.user(sender).saldo = 0;

  const result = await handleMessage(conn, chatMessage('halo semua'), { plugins, db, config, logger: quiet });

  assert.equal(result.handled, false, 'bukan command, tapi tetap dapat hadiah');
  assert.equal(result.reward.exp >= 1 && result.reward.exp <= 9, true);
  assert.equal(db.user(sender).exp, result.reward.exp);
  assert.equal(db.user(sender).saldo, result.reward.saldo);
  db.close();
});

test('pesan dari bot sendiri tidak mendapat hadiah', async () => {
  const { db, plugins, conn } = await setup();
  const sender = '628999@s.whatsapp.net';
  const before = db.user(sender).exp;

  await handleMessage(conn, { ...chatMessage('pesan bot'), key: { remoteJid: '628111@s.whatsapp.net', fromMe: true, id: 'ME1' } }, { plugins, db, config, logger: quiet });

  assert.equal(db.user(sender).exp, before, 'fromMe tidak boleh dapat XP');
  db.close();
});

test('reward bisa dimatikan lewat config', async () => {
  const { db, plugins, conn } = await setup();
  const sender = '628111@s.whatsapp.net';
  db.user(sender).exp = 0;

  const result = await handleMessage(conn, chatMessage('halo'), {
    plugins,
    db,
    config: { ...config, rewards: { chat: { enabled: false } } },
    logger: quiet,
  });

  assert.equal(result.reward, null);
  assert.equal(db.user(sender).exp, 0);
  db.close();
});

test('chat yang di-mute tidak memberi hadiah', async () => {
  const { db, plugins, conn } = await setup();
  const chat = '123@g.us';
  db.chat(chat).mute = true;
  const sender = '628111@s.whatsapp.net';
  db.user(sender).exp = 0;

  await handleMessage(conn, chatMessage('halo', chat), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).exp, 0, 'chat mute tidak memberi XP');
  db.close();
});

test('xp & saldo dicatat di terminal saja (tidak ada pesan ke user)', async () => {
  const db = makeDb();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const logs = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
  };
  const capture = { ...quiet, info: (line) => logs.push(String(line)) };
  const sender = '628111@s.whatsapp.net';
  db.user(sender).exp = 0;
  // Intro DM bukan bagian dari uji ini: ia menyapa user baru sekali dan akan
  // terhitung sebagai "pesan ke user" padahal yang diuji adalah reward.
  db.user(sender).dmIntroSentAt = Date.now();

  await handleMessage(conn, chatMessage('halo tanpa notifikasi'), { plugins, db, config, logger: capture });

  assert.equal(sent.length, 0, 'tidak boleh ada pesan dikirim ke user');
  assert.equal(logs.some((line) => line.includes('[reward]') && line.includes('+')), true, 'perolehan harus tercatat di terminal');
  assert.equal(db.user(sender).exp > 0, true, 'xp tetap diberikan');
  db.close();
});

test('naik level tidak dikirim ke chat secara default (hanya di terminal)', async () => {
  const db = makeDb();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const logs = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
  };
  const capture = { ...quiet, info: (line) => logs.push(String(line)) };
  const sender = '628111@s.whatsapp.net';
  const user = db.user(sender);
  user.exp = 99;
  user.level = 0;
  user.dmIntroSentAt = Date.now(); // intro DM di luar lingkup uji ini

  await handleMessage(conn, chatMessage('mau naik level'), { plugins, db, config, logger: capture });

  assert.equal(user.level, 1, 'level tetap naik');
  assert.equal(sent.length, 0, 'default: tidak ada pesan naik level ke chat');
  assert.equal(logs.some((line) => line.includes('NAIK LEVEL')), true, 'level-up harus tercatat di terminal');
  db.close();
});

test('pesan naik level dikirim ke chat kalau CHAT_LEVELUP_NOTICE diaktifkan', async () => {
  const { db, plugins, conn, sent } = await setup();
  const sender = '628111@s.whatsapp.net';
  const user = db.user(sender);
  user.exp = 99;
  user.level = 0;

  await handleMessage(conn, chatMessage('naik level dong'), {
    plugins,
    db,
    config: rewardConfig({ expMin: 1, expMax: 1 }),
    logger: quiet,
  });

  const texts = sent.map((item) => item.content.text || '').join('\n');
  assert.match(texts, /naik ke \*level 1\*/);

  // pemberitahuan bisa dimatikan
  sent.length = 0;
  const user2 = db.user('628222@s.whatsapp.net');
  user2.exp = 99;
  user2.level = 0;
  await handleMessage(conn, chatMessage('naik lagi', '628222@s.whatsapp.net'), {
    plugins,
    db,
    config: rewardConfig({ expMin: 1, expMax: 1, levelUpNotice: false }),
    logger: quiet,
  });
  assert.doesNotMatch(sent.map((item) => item.content.text || '').join('\n'), /naik ke/);
  db.close();
});
