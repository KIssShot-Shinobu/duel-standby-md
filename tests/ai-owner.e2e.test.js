import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import baseConfig from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import { getQuiz } from '../lib/quiz-instance.js';

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

const aiText = (sent) => sent.map((s) => s.text || s.caption || '').join('\n');

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

test('owner reply pesan USER LAIN -> AI TIDAK dipanggil', async () => {
  const t = await setup();
  stubAI('Hmph. Ini tidak seharusnya muncul.');
  await handleMessage(t.conn, {
    key: { remoteJid: 'o1@g.us', fromMe: false, id: `U${Math.random()}`, participant: OWNER },
    message: {
      extendedTextMessage: {
        text: 'eh iya bener',
        contextInfo: {
          participant: '628222@s.whatsapp.net', // member lain, bukan bot
          quotedMessage: { conversation: 'pesan member lain' },
        },
      },
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  }, { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(aiCalls, 0, 'balasan ke pesan user lain tidak boleh memicu AI');
  assert.doesNotMatch(aiText(t.sent), /tidak seharusnya muncul/i);
  t.db.close();
});

test('owner reply pesan bot lewat LID (fromMe false) -> AI tetap menjawab', async () => {
  const t = await setup();
  // Grup berbasis LID: quoted participant berisi LID bot, bukan nomor teleponnya,
  // sehingga `m.quoted.fromMe` bernilai false walau pesan itu milik bot.
  t.conn.user.lid = '99887766@lid';
  stubAI('Hmph. Aku mendengarmu.');
  await handleMessage(t.conn, {
    key: { remoteJid: 'o1@g.us', fromMe: false, id: `L${Math.random()}`, participant: OWNER },
    message: {
      extendedTextMessage: {
        text: 'lanjutkan ceritamu',
        contextInfo: {
          participant: '99887766@lid',
          quotedMessage: { conversation: 'jawaban AI sebelumnya' },
        },
      },
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  }, { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(aiCalls, 1, 'balasan ke pesan bot (via LID) harus tetap dijawab AI');
  assert.match(aiText(t.sent), /mendengarmu/i);
  t.db.close();
});

test('owner .aireply off -> balasan AI otomatis diam, .aireply on menyalakan lagi', async () => {
  const t = await setup();
  stubAI('Hmph. Aku di sini.');
  const deps = { plugins: t.plugins, db: t.db, config: t.config, logger: quiet };
  const cmd = (text) => ({
    key: { remoteJid: OWNER, fromMe: false, id: `C${Math.random()}` },
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  });

  await handleMessage(t.conn, cmd('.aireply off'), deps);
  assert.equal(t.db.data.settings.aiReply, false, 'setelan harus tersimpan di database');

  await handleMessage(t.conn, tagMsg('halo, masih di sana?'), deps);
  assert.equal(aiCalls, 0, 'saat saklar mati, AI tidak boleh membalas');

  await handleMessage(t.conn, cmd('.aireply on'), deps);
  assert.equal(t.db.data.settings.aiReply, true);
  await handleMessage(t.conn, tagMsg('halo lagi'), deps);
  assert.equal(aiCalls, 1, 'setelah dinyalakan, AI menjawab lagi');
  t.db.close();
});

test('.aireply: moderator boleh mengubah, user biasa ditolak', async () => {
  const t = await setup();
  stubAI();
  const deps = { plugins: t.plugins, db: t.db, config: t.config, logger: quiet };
  const MOD = '628333@s.whatsapp.net';
  const USER = '628444@s.whatsapp.net';
  const cmd = (sender, text) => ({
    key: { remoteJid: 'o1@g.us', fromMe: false, id: `C${Math.random()}`, participant: sender },
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'X',
  });

  t.db.user(MOD).role = 'mod';
  await handleMessage(t.conn, cmd(MOD, '.aireply off'), deps);
  assert.equal(t.db.data.settings.aiReply, false, 'moderator boleh mematikan');

  t.db.data.settings.aiReply = true;
  // User biasa dites di DM supaya tidak kena gate sewa grup.
  await handleMessage(t.conn, {
    key: { remoteJid: USER, fromMe: false, id: `C${Math.random()}` },
    message: { conversation: '.aireply off' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'User',
  }, deps);
  assert.equal(t.db.data.settings.aiReply, true, 'user biasa tidak boleh mengubah');
  assert.match(aiText(t.sent), /owner|moderator/i, 'user biasa diberi tahu alasannya');
  t.db.close();
});

test('owner DM teks polos (tanpa reply/tag) -> AI menjawab', async () => {
  const t = await setup();
  stubAI('Hmph. Kau mencariku?');
  await handleMessage(t.conn, {
    key: { remoteJid: OWNER, fromMe: false, id: `D${Math.random()}` },
    message: { conversation: 'kamu di mana?' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  }, { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(aiCalls, 1);
  assert.match(aiText(t.sent), /mencariku/);
  t.db.close();
});

test('tanpa AI_KEY -> owner reply diberi tahu (bukan diam)', async () => {
  const t = await setup({ key: '' });
  aiCalls = 0;
  await handleMessage(t.conn, replyMsg('halo'), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(aiCalls, 0);
  assert.match(aiText(t.sent), /AI_KEY/);
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

// ── Game tebak kartu × fitur AI owner ───────────────────────────────────────

const GAME_CARD = {
  id: 12345678,
  name: 'Kuriboh',
  type: 'Effect Monster',
  attribute: 'DARK',
  race: 'Fiend',
  atk: 300,
  def: 200,
  archetype: 'Kuriboh',
  card_images: [{ image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/12345678.jpg' }],
};
const GAME_DISTRACTORS = [
  { ...GAME_CARD, id: 1, name: 'Winged Kuriboh' },
  { ...GAME_CARD, id: 2, name: 'Kuribohrn' },
  { ...GAME_CARD, id: 3, name: 'Kuribandit' },
];

/** Stub fetch untuk AI + YGOProDeck (mulai game) sekaligus. */
function stubAIAndGame(answer = 'Hmph. AI aktif.') {
  aiCalls = 0;
  lastSystem = '';
  globalThis.fetch = async (url, opts) => {
    const target = String(url);
    if (target.includes('/chat/completions')) {
      aiCalls += 1;
      lastSystem = JSON.parse(opts.body).messages[0].content;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: answer } }] }) };
    }
    if (target.includes('randomcard.php')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [GAME_CARD] }) };
    }
    if (target.includes('cardinfo.php')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: GAME_DISTRACTORS }) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  };
}

test('game aktif: balas soal dijawab GAME (bukan AI); balas pesan bot lain tetap dijawab AI', async () => {
  const t = await setup();
  stubAIAndGame();
  t.config.ygoprodeck = { ...t.config.ygoprodeck, cacheFile: false };
  t.config.game = {
    ...t.config.game,
    yugioh: { ...(t.config.game?.yugioh || {}), rounds: 3, timeoutMs: 30000, roundDelayMs: 0, maxAttempts: 3 },
  };
  const deps = { plugins: t.plugins, db: t.db, config: t.config, logger: quiet };

  // 1) owner memulai game .tebakygo di grup
  await handleMessage(t.conn, {
    key: { remoteJid: 'o1@g.us', fromMe: false, id: `S${Math.random()}`, participant: OWNER },
    message: { conversation: '.tebakygo' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  }, deps);
  assert.match(aiText(t.sent), /TEBAK KARTU/, 'game harus mulai');

  const state = getQuiz()?.get('o1@g.us');
  assert.ok(state, 'state game aktif');
  const questionId = [...state.questionIds][0];
  assert.ok(questionId, 'id pesan soal tercatat');
  const correct = state.choices.find((choice) => choice.correct).label;

  // 2) owner BALAS PESAN SOAL dengan jawaban benar -> game yang menjawab, AI diam.
  //    fromMe quoted sengaja false meniru kasus LID (participant quoted bukan id bot).
  const before2 = t.sent.length;
  const r = await handleMessage(t.conn, {
    key: { remoteJid: 'o1@g.us', fromMe: false, id: `G${Math.random()}`, participant: OWNER },
    message: {
      extendedTextMessage: {
        text: correct,
        contextInfo: {
          participant: '99887766@s.whatsapp.net', // LID/bukan id bot -> fromMe salah
          quotedMessage: { conversation: 'Soal game' },
          stanzaId: questionId,
        },
      },
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  }, deps);
  assert.equal(r.reason, 'before:game-yugioh-guess.js', 'game yang menangani tebakan');
  assert.equal(aiCalls, 0, 'AI TIDAK boleh menjawab jawaban game');
  assert.match(
    t.sent.slice(before2).map((s) => s.text || s.caption || '').join('\n'),
    /BENAR/,
    'jawaban benar harus direspon game, bukan diam',
  );

  // 3) owner balas pesan bot LAMA (bukan soal) saat game masih jalan -> AI menjawab
  const before3 = t.sent.length;
  const r3 = await handleMessage(t.conn, {
    key: { remoteJid: 'o1@g.us', fromMe: false, id: `H${Math.random()}`, participant: OWNER },
    message: {
      extendedTextMessage: {
        text: 'cerita dong',
        contextInfo: { participant: BOT, quotedMessage: { conversation: 'pesan bot lama' }, stanzaId: 'PESAN-BOT-LAMA' },
      },
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Owner',
  }, deps);
  assert.equal(aiCalls, 1, 'balasan ke pesan bot NON-game harus tetap dijawab AI saat game aktif');
  assert.notEqual(r3.reason, 'before:game-yugioh-guess.js', 'bukan dianggap tebakan game');
  assert.match(t.sent.slice(before3).map((s) => s.text || s.caption || '').join('\n'), /Hmph\. AI aktif/);

  // 4) member biasa chat (reply pesan bot lama) -> tidak ada respon game/AI
  const before4 = t.sent.length;
  await handleMessage(t.conn, {
    key: { remoteJid: 'o1@g.us', fromMe: false, id: `J${Math.random()}`, participant: '628222@s.whatsapp.net' },
    message: {
      extendedTextMessage: {
        text: 'gimana kabar?',
        contextInfo: { participant: BOT, quotedMessage: { conversation: 'pesan bot lama' }, stanzaId: 'PESAN-BOT-LAMA' },
      },
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Orang',
  }, deps);
  assert.equal(aiCalls, 1, 'non-owner tidak memicu AI');
  assert.equal(t.sent.length, before4, 'chat biasa member tidak boleh dibalas apa pun');

  t.db.close();
});