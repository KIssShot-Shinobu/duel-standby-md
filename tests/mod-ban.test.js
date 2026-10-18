/**
 * Moderator boleh memblokir & membuka blokir user.
 *
 * `.ban`/`.unban` dulu khusus owner (`plugins/owner-user.js`). Sekarang pindah ke
 * `plugins/owner-ban.js` dengan gate baru `handler.mods` (owner ATAU moderator).
 *
 * Pengaman yang dikunci di sini — bagian terpentingnya:
 *   - moderator TIDAK boleh memblokir owner: kalau boleh, satu moderator bisa
 *     mengunci owner dari botnya sendiri, dan owner tidak bisa `.unban` karena
 *     dirinya sudah diblokir;
 *   - moderator juga tidak boleh menyasar moderator lain (hanya owner yang
 *     mengurus daftar moderator, lewat `.mod add|del`);
 *   - owner tetap boleh menyasar siapa pun.
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
import banPlugin from '../plugins/owner-ban.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

const MOD = '628111222333@s.whatsapp.net';
const MOD2 = '628444555666@s.whatsapp.net';
const OWNER = '628999888777@s.whatsapp.net';
const USER = '628777888999@s.whatsapp.net';

/** Database + socket tiruan; daftar owner bisa diatur per test. */
function harness({ owners = ['628999888777'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-modban-'));
  const file = path.join(dir, 'db.json');
  const db = new Database(file, { saveInterval: 5000, logger: quiet });
  db.load();

  const sent = [];
  const conn = {
    user: { id: '628000000000@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  const cfg = { ...config, bot: { ...config.bot, owners } };
  return { db, file, conn, sent, cfg };
}

async function loadPlugins() {
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();
  return plugins;
}

const msg = (text, sender, extra = {}) => ({
  key: { remoteJid: sender, fromMe: false, id: `IN-${Math.random().toString(36).slice(2, 8)}` },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Uji',
  ...extra,
});

const allText = (sent) => sent.map((item) => item.content?.text || '').join('\n');
const lastText = (sent) => sent.at(-1)?.content?.text || '';

/** Jalankan satu pesan lewat handler dengan plugin asli. */
async function run(h, text, sender, extra = {}) {
  const plugins = h.plugins || (h.plugins = await loadPlugins());
  return handleMessage(h.conn, msg(text, sender, extra), { plugins, db: h.db, config: h.cfg, logger: quiet });
}

// ── Moderator boleh ban / unban ────────────────────────────────────────────

test('moderator bisa memblokir user biasa, alasannya tersimpan', async () => {
  const h = harness();
  h.db.user(MOD).role = 'mod';

  const result = await run(h, `.ban ${USER.split('@')[0]} spam`, MOD);

  assert.equal(result.handled, true);
  assert.equal(h.db.user(USER).banned, true);
  assert.equal(h.db.user(USER).bannedReason, 'spam');
  assert.match(lastText(h.sent), /diblokir/i);

  await h.db.save(true);
  assert.equal(JSON.parse(fs.readFileSync(h.file, 'utf8')).users[USER].banned, true);
  h.db.close();
});

test('moderator bisa membuka blokir lagi', async () => {
  const h = harness();
  h.db.user(MOD).role = 'mod';
  h.db.user(USER).banned = true;
  h.db.user(USER).bannedReason = 'spam';

  await run(h, `.unban ${USER.split('@')[0]}`, MOD);

  assert.equal(h.db.user(USER).banned, false);
  assert.equal(h.db.user(USER).bannedReason, '');
  assert.match(lastText(h.sent), /dibuka/i);
  h.db.close();
});

test('.ban lewat pesan yang di-reply atau mention tetap jalan', async () => {
  // Diuji langsung ke plugin: `smsg` membangun `m.quoted` sendiri dari pesan
  // mentah, jadi lewat handler tidak bisa disuntik dari test.
  const users = {};
  const db = {
    data: { users },
    user: (jid) => users[jid] || (users[jid] = { jid, banned: false }),
    resolveIdentity: (jid) => jid,
    touch() {},
    save: async () => true,
  };
  const replies = [];
  const m = {
    chat: 'x',
    sender: MOD,
    reply: async (text) => {
      replies.push(String(text));
      return { key: { id: 'R' } };
    },
  };
  const ctx = { args: [], command: 'ban', config, db, isOwner: false };

  await banPlugin({ ...m, quoted: { sender: USER } }, ctx);
  assert.equal(users[USER].banned, true, 'target dari pesan yang di-reply');

  const user2 = '628333444555@s.whatsapp.net';
  await banPlugin({ ...m, mentionedJid: [user2] }, ctx);
  assert.equal(users[user2].banned, true, 'target dari mention');

  assert.equal(replies.filter((text) => /diblokir/i.test(text)).length, 2);
});

// ── Pengaman: moderator tidak boleh menyasar owner / moderator lain ────────

test('moderator TIDAK bisa memblokir owner', async () => {
  const h = harness();
  h.db.user(MOD).role = 'mod';

  const result = await run(h, `.ban ${OWNER.split('@')[0]}`, MOD);

  assert.equal(result.handled, true, 'command tetap dijalankan, tapi ditolak dengan pesan');
  assert.equal(h.db.user(OWNER).banned, false, 'owner tidak boleh bisa diblokir moderator');
  assert.match(lastText(h.sent), /owner/i);
  h.db.close();
});

test('moderator TIDAK bisa memblokir moderator lain', async () => {
  const h = harness();
  h.db.user(MOD).role = 'mod';
  h.db.user(MOD2).role = 'mod';

  await run(h, `.ban ${MOD2.split('@')[0]}`, MOD);

  assert.equal(h.db.user(MOD2).banned, false);
  assert.match(lastText(h.sent), /moderator/i);
  h.db.close();
});

test('moderator TIDAK bisa membuka blokir owner', async () => {
  const h = harness();
  h.db.user(MOD).role = 'mod';
  h.db.user(OWNER).banned = true;

  await run(h, `.unban ${OWNER.split('@')[0]}`, MOD);

  assert.equal(h.db.user(OWNER).banned, true, 'status owner tidak boleh diubah moderator');
  h.db.close();
});

test('owner tetap boleh memblokir moderator', async () => {
  const h = harness();
  h.db.user(MOD).role = 'mod';

  await run(h, `.ban ${MOD.split('@')[0]} menyalahgunakan bot`, OWNER);

  assert.equal(h.db.user(MOD).banned, true);
  assert.equal(h.db.user(MOD).bannedReason, 'menyalahgunakan bot');
  h.db.close();
});

// ── Batas akses ────────────────────────────────────────────────────────────

test('user biasa tidak bisa memblokir siapa pun (need-mods)', async () => {
  const h = harness();

  const result = await run(h, `.ban ${USER.split('@')[0]}`, MOD);

  assert.equal(result.reason, 'need-mods');
  assert.equal(h.db.user(USER).banned, false);
  assert.match(lastText(h.sent), /moderator/i);
  h.db.close();
});

test('.ban tanpa target hanya memberi contoh, tanpa membuat user palsu', async () => {
  const h = harness();
  h.db.user(MOD).role = 'mod';
  const sebelum = Object.keys(h.db.data.users).length;

  await run(h, '.ban', MOD);

  assert.equal(Object.keys(h.db.data.users).length, sebelum, 'tidak boleh ada user baru');
  assert.match(lastText(h.sent), /ban/i);
  h.db.close();
});
