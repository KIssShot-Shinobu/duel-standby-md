/**
 * Saklar bot per grup: admin grup bisa mematikan bot di grupnya sendiri.
 *
 * Perilaku yang dikunci di sini:
 *   1. admin grup bisa `.bot off` / `.bot on`, dan statusnya tersimpan;
 *   2. member biasa ditolak (gate `handler.admin`), jadi tidak bisa mematikan bot;
 *   3. saat OFF: member TIDAK dibalas sama sekali, tapi admin grup tetap
 *      dilayani — kalau tidak, tidak ada cara menyalakannya kembali;
 *   4. `.bot` tanpa argumen hanya menampilkan status (tidak mengubah apa pun);
 *   5. hanya berlaku di grup.
 *
 * Fitur penjaga grup (welcome, antilink, antispam) sengaja tetap jalan saat OFF:
 * yang berhenti hanya respons bot, sesuai keputusan owner.
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
import groupBot from '../plugins/group-bot.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

const GROUP = '123@g.us';
const ADMIN = '628111111111@s.whatsapp.net';
const MEMBER = '628222222222@s.whatsapp.net';

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-gbot-'));
  const file = path.join(dir, 'db.json');
  const db = new Database(file, { saveInterval: 5000, logger: quiet });
  db.load();
  // Intro DM (plugins/_dm-intro.js) menyapa user baru dan menambah pesan keluar —
  // matikan supaya hitungan balasan di test ini hanya soal `.bot`.
  db.user(ADMIN).dmIntroSentAt = Date.now();
  db.user(MEMBER).dmIntroSentAt = Date.now();

  const sent = [];
  const conn = {
    user: { id: '628999999999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [{ id: ADMIN, admin: 'admin' }] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  return { db, file, conn, sent };
}

async function loadPlugins() {
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();
  return plugins;
}

const msg = (text, sender, chat = GROUP) => ({
  key: {
    remoteJid: chat,
    fromMe: false,
    id: `IN-${Math.random().toString(36).slice(2, 8)}`,
    ...(chat.endsWith('@g.us') ? { participant: sender } : {}),
  },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Uji',
});

const allText = (sent) => sent.map((item) => item.content?.text || '').join('\n');
const lastText = (sent) => sent.at(-1)?.content?.text || '';

// ── Admin grup bisa mematikan & menyalakan ─────────────────────────────────

test('.bot off mematikan bot untuk grup itu, .bot on menyalakannya lagi', async () => {
  const { db, file, conn, sent } = harness();
  const plugins = await loadPlugins();

  const off = await handleMessage(conn, msg('.bot off', ADMIN), { plugins, db, config, logger: quiet });
  assert.equal(off.handled, true);
  assert.equal(db.chat(GROUP).mute, true, 'mute harus aktif');
  assert.match(allText(sent), /dimatikan/i);

  const on = await handleMessage(conn, msg('.bot on', ADMIN), { plugins, db, config, logger: quiet });
  assert.equal(on.handled, true);
  assert.equal(db.chat(GROUP).mute, false, 'mute harus kembali nonaktif');
  assert.match(lastText(sent), /dinyalakan/i);

  // status ikut tersimpan ke database (bukan cuma di memori)
  await db.save(true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).chats[GROUP].mute, false);
  db.close();
});

test('member biasa tidak bisa mematikan bot', async () => {
  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();

  const result = await handleMessage(conn, msg('.bot off', MEMBER), { plugins, db, config, logger: quiet });

  assert.equal(result.reason, 'need-admin');
  assert.equal(db.chat(GROUP).mute, false, 'status tidak boleh berubah');
  assert.match(allText(sent), /admin/i);
  db.close();
});

// ── Perilaku saat bot OFF ──────────────────────────────────────────────────

test('saat OFF: member tidak dibalas sama sekali, admin tetap dilayani', async () => {
  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();
  await handleMessage(conn, msg('.bot off', ADMIN), { plugins, db, config, logger: quiet });

  const sebelum = sent.length;
  const member = await handleMessage(conn, msg('.menu', MEMBER), { plugins, db, config, logger: quiet });

  assert.equal(member.reason, 'muted');
  assert.equal(sent.length, sebelum, 'member tidak boleh menerima balasan apa pun');

  // Admin tetap dilayani — satu-satunya jalan menyalakan bot kembali.
  const admin = await handleMessage(conn, msg('.bot on', ADMIN), { plugins, db, config, logger: quiet });
  assert.equal(admin.handled, true);
  assert.equal(db.chat(GROUP).mute, false);
  db.close();
});

test('saat OFF: hadiah XP berhenti walau bot tetap jalan untuk admin', async () => {
  const { db, conn } = harness();
  const plugins = await loadPlugins();
  await handleMessage(conn, msg('.bot off', ADMIN), { plugins, db, config, logger: quiet });

  await handleMessage(conn, msg('halo semua', MEMBER), { plugins, db, config, logger: quiet });

  assert.equal(db.user(MEMBER).exp, 0, 'chat yang dimatikan tidak memberi XP');
  db.close();
});

// ── Status & batasan ───────────────────────────────────────────────────────

test('.bot tanpa argumen menampilkan status tanpa mengubah apa pun', async () => {
  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();

  await handleMessage(conn, msg('.bot', ADMIN), { plugins, db, config, logger: quiet });
  assert.match(lastText(sent), /ON/);
  assert.equal(db.chat(GROUP).mute, false);

  await handleMessage(conn, msg('.bot off', ADMIN), { plugins, db, config, logger: quiet });
  await handleMessage(conn, msg('.bot', ADMIN), { plugins, db, config, logger: quiet });
  assert.match(lastText(sent), /OFF/);
  db.close();
});

test('plugin .bot dengan argumen ngawur hanya memberi contoh, tidak mengubah status', async () => {
  const chatData = { mute: false };
  const replies = [];
  const m = {
    chat: GROUP,
    sender: ADMIN,
    reply: async (text) => {
      replies.push(String(text));
      return { key: { id: 'R' } };
    },
  };

  await groupBot(m, { args: ['nyala'], chatData, db: { touch() {} }, config });

  assert.equal(chatData.mute, false, 'status tidak boleh berubah');
  assert.match(replies[0], /on\|off/);
});

test('.bot hanya berlaku di grup', async () => {
  const { db, conn } = harness();
  const plugins = await loadPlugins();
  const dm = '628222222222@s.whatsapp.net';

  const result = await handleMessage(conn, msg('.bot off', MEMBER, dm), { plugins, db, config, logger: quiet });

  // Gate admin diperiksa lebih dulu daripada gate grup (handler.js), jadi di DM
  // jawabannya 'need-admin' — sama seperti `.welcome on` di DM. Yang penting:
  // saklar grup tidak bisa diubah dari chat pribadi.
  assert.equal(result.reason, 'need-admin');
  assert.equal(db.chat(dm).mute, false, 'chat pribadi tidak boleh kena saklar grup');
  db.close();
});
