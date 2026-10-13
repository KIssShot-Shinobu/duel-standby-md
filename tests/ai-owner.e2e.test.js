import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import baseConfig from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

const OWNER = '628111@s.whatsapp.net';
const BOT = '628999@s.whatsapp.net';
const ownerNumber = '628111';

async function setup({ key = 'sk-test' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-aio-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  db.chat('o1@g.us').antiSpam = false;
  const renterFree = db.user(OWNER);
  renterFree.lastLimitReset = Date.now();
  renterFree.limit = 20;

  const sent = [];
  const conn = {
    user: { id: BOT, name: 'Bot Uji' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, ...content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  const config = {
    ...baseConfig,
    root: dir,
    bot: { ...baseConfig.bot, owners: [ownerNumber], ownerJids: [OWNER] },
    ai: { ...baseConfig.ai, key, base: 'https://ai.test/v1', ownerFile: 'owner-ai.json' },
  };
  return { dir, db, plugins, conn, sent, config };
}

let aiCalls = 0;
let lastSystem = '';

function stubAI(answer = 'Hmph. Baiklah, aku ingat.') {
  aiCalls = 0;
  lastSystem = '';
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/chat/completions')) {
      aiCalls += 1;
      lastSystem = JSON.parse(opts.body).messages[0].content;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: answer } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

const replyMsg = (text, owner = true) => ({
  key: { remoteJid: 'o1@g.us', fromMe: false, id: `R${Math.random()}`, participant: owner ? OWNER : '628222@s.whatsapp.net' },
  message: {
    extendedTextMessage: {
      text,
      contextInfo: { participant: BOT, quotedMessage: { conversation: 'Aku sedang di sini.' } },
    },
  },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: owner ? 'Owner' : 'Orang',
});

const tagMsg = (text) => ({
  key: { remoteJid: 'o1@g.us', fromMe: false, id: `T${Math.random()}`, participant: OWNER },
  message: {
    extendedTextMessage: { text, contextInfo: { mentionedJid: [BOT] } },
  },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Owner',
});

const aiText = (sent) => sent.filter((s) => s.chat === 'o1@g.us').map((s) => s.text || s.caption || '').join('\n');

test('owner reply pesan bot -> AI menjawab + memori tersimpan (bypass gating)', async () => {
  const t = await setup();
  stubAI('Hmph. Kau di sini, ya. Aku tidak bilang aku rindu.');

  // grup o1@g.us TIDAK disewa -> tetap harus dijawab (owner bypass)
  const r = await handleMessage(t.conn, replyMsg('Aku kangen kamu'), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(aiCalls, 1, 'AI harus dipanggil');
  assert.match(lastSystem, /Shinobu|vampire/i, 'persona waifu dipakai');
  assert.match(aiText(t.sent), /tidak bilang aku rindu/);
  assert.notEqual(r.reason, 'rent-gated');

  // memori tersimpan di file terpisah
  const file = path.join(t.dir, 'owner-ai.json');
  assert.ok(fs.existsSync(file), 'file memori owner dibuat');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = saved[OWNER];
  assert.ok(entry, 'memori untuk owner tersimpan');
  assert.equal(entry.history.at(-1).role, 'assistant');

  t.db.close();
});

test('owner tag/mention bot -> AI menjawab', async () => {
  const t = await setup();
  stubAI('Hmph. Jangan banyak tanya. Cukup belikan aku donat.');
  await handleMessage(t.conn, tagMsg('belikan donat dong'), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(aiCalls, 1);
  assert.match(aiText(t.sent), /donat/i);
  t.db.close();
});

test('NON-owner reply pesan bot -> AI TIDAK dipanggil', async () => {
  const t = await setup();
  stubAI();
  await handleMessage(t.conn, replyMsg('halo bot', false), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(aiCalls, 0, 'non-owner tidak boleh memicu AI owner');
  assert.doesNotMatch(aiText(t.sent), /tidak bilang aku rindu/);
  t.db.close();
});

test('.resetownai menghapus memori owner', async () => {
  const t = await setup();
  stubAI('Aku ingat.');
  await handleMessage(t.conn, tagMsg('cerita masa laluku'), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });

  await handleMessage(t.conn, {
    key: { remoteJid: OWNER, fromMe: false, id: `C${Math.random()}` },
    message: { conversation: '.resetownai' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  }, { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });

  const file = path.join(t.dir, 'owner-ai.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved[OWNER], undefined, 'memori owner harus terhapus');
  t.db.close();
});

test('owner .ai eksplisit memakai persona waifu + memori owner', async () => {
  const t = await setup();
  stubAI('Hmph. Baik. Aku dengarkan.');
  await handleMessage(t.conn, {
    key: { remoteJid: OWNER, fromMe: false, id: `D${Math.random()}` },
    message: { conversation: '.ai tolong dengar ceritaku' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  }, { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(aiCalls, 1);
  assert.match(lastSystem, /Shinobu|vampire/i);
  const file = path.join(t.dir, 'owner-ai.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved[OWNER].history[0].role, 'user');
  t.db.close();
});