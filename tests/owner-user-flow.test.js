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

const OWNER = '628999999999@s.whatsapp.net';
const TARGET = '628123456789@s.whatsapp.net';
const LID = '271446714642565@lid';

// Owner untuk pengujian (config asli tetap dipakai untuk limits/messages).
const config = { ...baseConfig, bot: { ...baseConfig.bot, owners: ['628999999999'], ownerJids: [OWNER] } };

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-owner-flow-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();
  const sent = [];
  const conn = {
    user: { id: '628999000000@s.whatsapp.net', name: 'Bot Uji' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  return { db, plugins, conn, sent };
}

const text = (body, chat = '123@g.us', sender = OWNER) => ({
  key: { remoteJid: chat, fromMe: false, id: `T${Math.random().toString(36).slice(2, 7)}`, participant: sender },
  message: { conversation: body },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Owner',
});

const mention = (body, jid, chat = '123@g.us') => ({
  key: { remoteJid: chat, fromMe: false, id: `T${Math.random().toString(36).slice(2, 7)}`, participant: OWNER },
  message: { extendedTextMessage: { text: body, contextInfo: { mentionedJid: [jid] } } },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Owner',
});

/** Owner me-reply pesan user (cara paling umum: tidak mengetik nomor). */
const replyTo = (body, quotedSender, chat = '123@g.us') => ({
  key: { remoteJid: chat, fromMe: false, id: `R${Math.random().toString(36).slice(2, 7)}`, participant: OWNER },
  message: {
    extendedTextMessage: {
      text: body,
      contextInfo: { participant: quotedSender, stanzaId: 'Q1', quotedMessage: { conversation: 'pesan lama user' } },
    },
  },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Owner',
});

const lastText = (sent) => sent.at(-1)?.content?.text || '';
const run = (conn, db, plugins, raw) => handleMessage(conn, raw, { plugins, db, config, logger: quiet });

// ── Nomor ditulis langsung ────────────────────────────────────────────────

test('E2E: .premium add <nomor> 30 lewat handler', async () => {
  const { db, plugins, conn, sent } = await setup();
  const result = await run(conn, db, plugins, text('.premium add 628123456789 30'));

  assert.equal(result.handled, true, `handler tidak menjalankan plugin: ${result.reason}`);
  assert.equal(db.user(TARGET).premium, true);
  assert.ok(db.user(TARGET).premiumUntil > Date.now() + 29 * 86400000);
  assert.match(lastText(sent), /premium/i);
  db.close();
});

test('E2E: .limit add <nomor> 10 lewat handler', async () => {
  const { db, plugins, conn, sent } = await setup();
  const result = await run(conn, db, plugins, text('.limit add 628123456789 10'));

  assert.equal(result.handled, true, `handler tidak menjalankan plugin: ${result.reason}`);
  assert.equal(db.user(TARGET).limitBonus, 10);
  assert.equal(db.user(TARGET).limit, baseConfig.limits.free + 10);
  assert.match(lastText(sent), /10/);
  db.close();
});

// ── Reply pesan user (nomor telepon) ─────────────────────────────────────

test('E2E: .premium add 30 dengan reply pesan user', async () => {
  const { db, plugins, conn } = await setup();
  await run(conn, db, plugins, replyTo('.premium add 30', TARGET));
  assert.equal(db.user(TARGET).premium, true, 'premium harus masuk ke user yang di-reply');
  db.close();
});

test('E2E: .limit add 10 dengan reply pesan user', async () => {
  const { db, plugins, conn } = await setup();
  await run(conn, db, plugins, replyTo('.limit add 10', TARGET));
  assert.equal(db.user(TARGET).limitBonus, 10, 'bonus limit harus masuk ke user yang di-reply');
  db.close();
});

// ── Reply pesan user ber-LID (WhatsApp baru) ─────────────────────────────

test('E2E: .premium add saat reply user LID masuk ke record nomor telepon', async () => {
  const { db, plugins, conn } = await setup();
  db.mapLid(LID, TARGET); // user sudah pernah chat -> pemetaan LID diketahui

  await run(conn, db, plugins, replyTo('.premium add 30', LID));

  assert.equal(db.user(TARGET).premium, true, 'premium harus masuk ke user sebenarnya (nomor telepon)');
  assert.equal(db.data.users[LID], undefined, 'tidak boleh membuat record LID terpisah');
  db.close();
});

test('E2E: .limit add saat reply user LID masuk ke record nomor telepon', async () => {
  const { db, plugins, conn } = await setup();
  db.mapLid(LID, TARGET);

  await run(conn, db, plugins, replyTo('.limit add 10', LID));

  assert.equal(db.user(TARGET).limitBonus, 10, 'bonus limit harus masuk ke record nomor telepon');
  assert.equal(db.data.users[LID], undefined, 'tidak boleh membuat record LID terpisah');
  db.close();
});

test('E2E: .premium add dengan ANGKA LID tidak membuat user hantu', async () => {
  // Regresi dari data server sungguhan: LID juga 14-15 digit, jadi lolos dari
  // NUMBER_ARG dan toJid() menempelkan @s.whatsapp.net padanya. Record
  // `271446714642565@s.whatsapp.net` tercipta, premium masuk ke situ, dan user
  // aslinya (yang pesanannya selalu resolve ke nomor telepon) tetap free.
  const { db, plugins, conn } = await setup();
  db.mapLid(LID, TARGET);

  await run(conn, db, plugins, text('.premium add 271446714642565 30'));

  assert.equal(
    db.data.users['271446714642565@s.whatsapp.net'],
    undefined,
    'LID tidak boleh diubah jadi nomor telepon palsu',
  );
  assert.equal(db.user(TARGET).premium, true, 'premium harus masuk ke nomor telepon sebenarnya');
  db.close();
});

test('E2E: .limit add dengan ANGKA LID tidak membuat user hantu', async () => {
  const { db, plugins, conn } = await setup();
  db.mapLid(LID, TARGET);

  await run(conn, db, plugins, text('.limit add 271446714642565 10'));

  assert.equal(db.data.users['271446714642565@s.whatsapp.net'], undefined);
  assert.equal(db.user(TARGET).limitBonus, 10, 'bonus limit harus masuk ke nomor telepon sebenarnya');
  db.close();
});

test('E2E: mention user LID tetap masuk ke record nomor telepon', async () => {
  const { db, plugins, conn } = await setup();
  db.mapLid(LID, TARGET);

  await run(conn, db, plugins, mention('.premium add 30', LID));

  assert.equal(db.user(TARGET).premium, true, 'mention harus mengarah ke record nomor telepon');
  assert.equal(db.data.users[LID], undefined, 'tidak boleh membuat record LID terpisah');
  db.close();
});

test('E2E: premium/limit yang diberikan saat pemetaan LID belum diketahui tetap terbawa', async () => {
  const { db, plugins, conn } = await setup();

  // WhatsApp belum pernah memberi pasangan LID + nomor -> target memakai record LID.
  await run(conn, db, plugins, replyTo('.premium add 30', LID));
  await run(conn, db, plugins, replyTo('.limit add 10', LID));
  assert.equal(db.user(LID).premium, true);
  assert.equal(db.user(LID).limitBonus, 10);

  // user mengirim pesan (LID + nomor telepon sekaligus) -> pemetaan terbentuk
  db.mapLid(LID, TARGET);

  assert.equal(db.user(TARGET).premium, true, 'premium harus terbawa ke record nomor telepon');
  assert.equal(db.user(TARGET).limitBonus, 10, 'bonus limit harus terbawa');
  assert.equal(db.data.users[LID], undefined, 'record LID harus dilebur');
  db.close();
});

// ── Kombinasi premium + limit ────────────────────────────────────────────

test('E2E: premium + limit bonus tidak saling menimpa', async () => {
  const { db, plugins, conn } = await setup();
  await run(conn, db, plugins, text('.limit add 628123456789 15'));
  await run(conn, db, plugins, text('.premium add 628123456789 30'));

  const user = db.user(TARGET);
  assert.equal(user.premium, true);
  assert.equal(user.limitBonus, 15, 'bonus owner harus tetap ada setelah premium ditambahkan');
  assert.equal(user.limit, baseConfig.limits.premium + 15, 'kuota premium + bonus');

  // setelah reset harian, keduanya tetap benar
  user.lastLimitReset = Date.now() - 25 * 60 * 60 * 1000;
  const { refreshLimit } = await import('../lib/permissions.js');
  assert.equal(refreshLimit(db, user, config), baseConfig.limits.premium + 15);
  db.close();
});

// ── Verifikasi dari sisi user (.profile) ──────────────────────────────────

test('E2E: setelah premium + limit diberikan, .profile <nomor> menampilkan perubahannya', async () => {
  const { db, plugins, conn, sent } = await setup();
  await run(conn, db, plugins, text('.premium add 628123456789 30'));
  await run(conn, db, plugins, text('.limit add 628123456789 10'));

  await run(conn, db, plugins, text('.profile 628123456789'));

  const body = lastText(sent);
  assert.match(body, /Profil 08123456789/, 'owner harus melihat profil user yang diminta, bukan profilnya sendiri');
  assert.match(body, /Premium: Ya \(sampai /);
  assert.match(
    body,
    new RegExp(`Limit: ${baseConfig.limits.premium + 10}/${baseConfig.limits.premium + 10}`),
    `limit di profil harus ${baseConfig.limits.premium + 10}`,
  );
  assert.match(body, /\+10 bonus owner/);
  db.close();
});

test('E2E: .profile user lain ditolak untuk selain owner', async () => {
  const { db, plugins, conn, sent } = await setup();
  await run(conn, db, plugins, text('.profile 628123456789', '123@g.us', '628111222333@s.whatsapp.net'));
  assert.match(lastText(sent), /Hanya owner bot yang bisa liat profil user lain/);
  db.close();
});

test('E2E: member biasa tetap bisa melihat profilnya sendiri', async () => {
  const { db, plugins, conn, sent } = await setup();
  await run(conn, db, plugins, text('.profile', '123@g.us', '628111222333@s.whatsapp.net'));

  const body = lastText(sent);
  assert.match(body, /Profilmu/);
  assert.doesNotMatch(body, /Profil 08/, 'tanpa target -> profil sendiri');
  assert.doesNotMatch(body, /Hanya owner bot yang bisa liat profil user lain/);
  assert.match(body, new RegExp(`Limit: ${baseConfig.limits.free}/${baseConfig.limits.free}`));
  db.close();
});
