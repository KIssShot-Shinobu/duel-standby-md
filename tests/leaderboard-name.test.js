/**
 * Papan peringkat menampilkan NOMOR, bukan nama.
 *
 * Akarnya: bot tidak pernah menyimpan nama WhatsApp user. `db.data.users[].name`
 * cuma diisi `.main-info`/`.daftar`, jadi 132 dari 140 user punya nama kosong dan
 * semua papan skor jatuh ke `user.name || nomor`. Nama hanya diberikan WhatsApp
 * lewat `pushName` pada pesan masuk — jadi harus disimpan saat pesan itu
 * diproses, kalau tidak hilang tiap restart (Baileys tidak mengirim daftar
 * kontak: `syncFullHistory: false`, dan `groupMetadata` tidak memuat nama).
 *
 * Test di sini mengunci tiga hal:
 *   1. handler menyimpan `pushName` ke record user, dan bertahan setelah reload;
 *   2. nama yang didaftarkan sendiri lewat `.main-info` tidak tertimpa;
 *   3. papan peringkat & kartu profil memakai nama itu, bukan nomor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import { userDisplayName } from '../lib/messages.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

/** db tiruan ringan: plugin hanya butuh `data.users`, `user()`, `touch()`. */
function fakeDb(users) {
  return {
    data: { users },
    touch() {},
    user(jid) {
      if (!users[jid]) users[jid] = { jid };
      return users[jid];
    },
  };
}

const incoming = (text, sender, pushName) => ({
  key: { remoteJid: sender, fromMe: false, id: `IN-${Math.random().toString(36).slice(2, 8)}` },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName,
});

async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-lb-'));
  const file = path.join(dir, 'db.json');
  const db = new Database(file, { saveInterval: 5000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();
  const conn = {
    user: { id: '628999@s.whatsapp.net', name: 'Bot Uji' },
    sendMessage: async (chat, content, opts) => {
      void chat;
      void content;
      void opts;
      return { key: { id: 'MSG1', remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  return { db, file, plugins, conn };
}

// ── Penyimpanan nama ────────────────────────────────────────────────────────

test('handler menyimpan nama WhatsApp (pushName) pengirim', async () => {
  const { db, plugins, conn } = await harness();
  const sender = '628222333444@s.whatsapp.net';

  await handleMessage(conn, incoming('halo semua', sender, 'Budi Santoso'), { plugins, db, config, logger: quiet });

  assert.equal(db.data.users[sender].pushName, 'Budi Santoso');
  db.close();
});

test('nama WhatsApp bertahan setelah database dimuat ulang (restart bot)', async () => {
  const { db, file, plugins, conn } = await harness();
  const sender = '628222333444@s.whatsapp.net';

  await handleMessage(conn, incoming('halo', sender, 'Budi Santoso'), { plugins, db, config, logger: quiet });
  await db.save(true);
  db.close();

  const reloaded = new Database(file, { saveInterval: 0, logger: quiet });
  reloaded.load();
  assert.equal(reloaded.user(sender).pushName, 'Budi Santoso');
  reloaded.close();
});

test('nama hasil .main-info tidak ditimpa nama WhatsApp', async () => {
  const { db, plugins, conn } = await harness();
  const sender = '628222333444@s.whatsapp.net';

  // daftar dulu, baru kirim pesan (urutan ini yang paling rentan)
  db.user(sender).name = 'Budi Terdaftar';
  await handleMessage(conn, incoming('halo', sender, 'Budi WA'), { plugins, db, config, logger: quiet });

  assert.equal(db.user(sender).name, 'Budi Terdaftar');
  assert.equal(db.user(sender).pushName, 'Budi WA');
  db.close();
});

// ── Pemilihan nama ──────────────────────────────────────────────────────────

test('userDisplayName: nama daftar -> nama WhatsApp -> nomor ramah 08xx', () => {
  assert.equal(userDisplayName({ name: 'Ani', pushName: 'ani_wa' }, '628111@s.whatsapp.net'), 'Ani');
  assert.equal(userDisplayName({ pushName: 'Budi' }, '628222@s.whatsapp.net'), 'Budi');
  assert.equal(userDisplayName({}, '628123@s.whatsapp.net'), '08123', 'tanpa nama apa pun tetap bukan 628123');
  assert.equal(userDisplayName(undefined, '628999@s.whatsapp.net'), '08999');
});

// ── Papan peringkat ─────────────────────────────────────────────────────────

async function runLeaderboard(users, args = []) {
  const { default: plugin } = await import('../plugins/rpg-leaderboard.js');
  let out = '';
  const m = {
    chat: '123@g.us',
    sender: '628111@s.whatsapp.net',
    fromMe: false,
    reply: async (value) => {
      out = String(value);
    },
  };
  await plugin(m, { args, db: fakeDb(users), config, usedPrefix: '.' });
  return out;
}

test('leaderboard: nama WhatsApp tampil, bukan nomor', async () => {
  const out = await runLeaderboard({
    '628111@s.whatsapp.net': { exp: 500, pushName: 'Budi' },
    '628222@s.whatsapp.net': { exp: 400 },
    '628333444555@s.whatsapp.net': { exp: 100 },
    '628555@s.whatsapp.net': { exp: 50 },
  });

  assert.match(out, /LEADERBOARD EXP/);
  assert.match(out, /🥇 Budi — \*500\*/);
  assert.match(out, /🥈 08222 — \*400\*/, 'user tanpa nama sama sekali jatuh ke 08xx');
  assert.match(out, /🥉 08333444555 — \*100\*/);
  assert.match(out, /4\. 08555 — \*50\*/, 'peringkat 4 dan seterusnya pakai angka');
  assert.equal(out.includes('628111'), false, 'nomor mentah tidak boleh muncul saat nama tersedia');
});

test('leaderboard: nama daftar menang atas nama WhatsApp, urut & bermedali', async () => {
  const out = await runLeaderboard({
    '628111@s.whatsapp.net': { exp: 10, name: 'Ani', pushName: 'ani_wa' },
    '628222@s.whatsapp.net': { exp: 900, pushName: 'Budi' },
  });

  assert.match(out, /🥇 Budi — \*900\*/);
  assert.match(out, /🥈 Ani — \*10\*/);
});

test('leaderboard saldo: memakai saldo dan menampilkan nama', async () => {
  const out = await runLeaderboard(
    {
      '628111@s.whatsapp.net': { exp: 999, saldo: 5, pushName: 'Budi' },
      '628222@s.whatsapp.net': { saldo: 250, pushName: 'Ani' },
    },
    ['saldo'],
  );

  assert.match(out, /LEADERBOARD SALDO/);
  assert.match(out, /🥇 Ani — \*250\*/);
  assert.match(out, /🥈 Budi — \*5\*/);
  assert.equal(out.includes('999'), false, 'exp tidak boleh dipakai saat minta saldo');
});

test('leaderboard: level 0 tidak nyangkut, yang kosong dikasih arahan', async () => {
  const out = await runLeaderboard({ '628111@s.whatsapp.net': { exp: 0, pushName: 'Budi' } });
  assert.match(out, /Belum ada data/);
});

// ── Papan skor tebak kartu ──────────────────────────────────────────────────

test('yugoscore: menampilkan nama WhatsApp pemain, bukan nomor', async () => {
  const { default: plugin } = await import('../plugins/game-yugioh-guess.js');
  const users = {
    '628111@s.whatsapp.net': { jid: '628111@s.whatsapp.net', ygoWins: 3, saldo: 0, pushName: 'Juara' },
    '628222@s.whatsapp.net': { jid: '628222@s.whatsapp.net', ygoWins: 1, saldo: 0, pushName: 'Pemula' },
  };
  let out = '';
  const m = {
    chat: '123@g.us',
    sender: '628111@s.whatsapp.net',
    fromMe: false,
    text: '.yugoscore',
    reply: async (value) => {
      out = String(value);
    },
  };
  const conn = { user: { id: '628999@s.whatsapp.net' }, sendMessage: async () => ({ key: { id: 'M1' } }) };

  await plugin(m, { conn, args: [], config, db: fakeDb(users), command: 'yugoscore', usedPrefix: '.', user: users['628111@s.whatsapp.net'] });

  assert.match(out, /PAPAN SKOR TEBAK KARTU/);
  assert.match(out, /🥇 Juara — 3 benar/);
  assert.match(out, /🥈 Pemula — 1 benar/);
  assert.equal(out.includes('628111'), false, 'nomor mentah tidak boleh muncul saat nama tersedia');
});

// ── Kartu profil user lain ──────────────────────────────────────────────────

test('profile user lain: menampilkan nama WhatsApp-nya, bukan nomor', async () => {
  const { default: plugin } = await import('../plugins/main-info.js');
  const target = '628222333444@s.whatsapp.net';
  const users = {
    '628999@s.whatsapp.net': { jid: '628999@s.whatsapp.net', exp: 10 },
    [target]: { jid: target, exp: 500, pushName: 'Budi Santoso' },
  };
  const db = {
    data: { users },
    touch() {},
    user: (jid) => users[jid] || (users[jid] = { jid }),
    resolveIdentity: (jid) => jid,
    resolveLid: (jid) => jid,
    stats: () => ({ users: Object.keys(users).length }),
  };
  let out = '';
  const m = {
    chat: '628999@s.whatsapp.net',
    sender: '628999@s.whatsapp.net',
    fromMe: false,
    pushName: 'Owner',
    reply: async (value) => {
      out = String(value);
    },
  };

  await plugin(m, {
    conn: { getName: async () => 'x' },
    text: target.split('@')[0],
    args: [target.split('@')[0]],
    command: 'profile',
    config,
    db,
    plugins: { find: () => null },
    user: users['628999@s.whatsapp.net'],
    runtime: null,
    chatData: {},
    isOwner: true,
    usedPrefix: '.',
  });

  assert.match(out, /Budi Santoso/);
  assert.equal(out.includes('08333444'), false, 'nomor ramah tidak boleh dipakai kalau nama ada');
});
