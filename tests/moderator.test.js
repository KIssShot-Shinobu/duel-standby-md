/**
 * Role moderator: owner bisa mengangkat user jadi moderator, dan moderator
 * memakai SEMUA fitur tanpa limit — di grup maupun di DM.
 *
 * Batas yang disetujui owner:
 *   A. moderator BUKAN owner — command bertanda `owner: true` tetap tertutup
 *      (kalau tidak, moderator bisa `.mod add` dirinya lalu menguasai bot);
 *   B. moderator boleh melewati gate sewa grup (boleh dipakai di grup yang belum
 *      disewa);
 *   C. moderator tetap kena command/kategori yang dimatikan owner lewat menu.
 *
 * Sumber kebenaran role: `user.role = 'mod'` di database (bisa diatur runtime,
 * bertahan setelah restart) ATAU daftar `config.bot.mods` dari env — yang lama
 * tidak boleh rusak.
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
import { isMods } from '../lib/permissions.js';
import { setCommand } from '../lib/menu-config.js';
import modPlugin from '../plugins/owner-mod.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

const OWNER = '628999999999@s.whatsapp.net';
const MOD = '628111222333@s.whatsapp.net';
const BIASA = '628555666777@s.whatsapp.net';

/** Database + socket tiruan. Plugin asli dimuat terpisah (loadPlugins). */
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-mod-'));
  const file = path.join(dir, 'db.json');
  const db = new Database(file, { saveInterval: 5000, logger: quiet });
  db.load();

  const sent = [];
  const conn = {
    user: { id: OWNER, name: 'Bot Uji' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
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

/** Pesan masuk sederhana (DM kalau chat-nya bukan @g.us). */
const msg = (text, sender, chat = sender) => ({
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

/** Semua teks yang dikirim bot (gabungan) — supaya tidak bergantung urutan. */
const allText = (sent) => sent.map((item) => item.content?.text || item.content?.caption || '').join('\n');

/** Manager plugin tiruan untuk plugin buatan (menguji tag premium/register). */
function stubPlugins(plugin, { name = 'tools-fake.js', category = 'tools' } = {}) {
  return { find: () => ({ name, category, plugin }), hooks: { before: [], all: [] } };
}

/** Siapkan user dengan tanggal reset limit "hari ini" supaya kuota tidak direset. */
function withLimit(db, jid, limit) {
  const user = db.user(jid);
  user.lastLimitReset = Date.now();
  user.limit = limit;
  return user;
}

// ── Deteksi moderator ──────────────────────────────────────────────────────

test('isMods: role database DAN daftar config sama-sama diakui', () => {
  const cfg = { bot: { mods: ['628777888999'] } };

  assert.equal(isMods(MOD, cfg, { role: 'mod' }), true, 'moderator dari database');
  assert.equal(isMods('628777888999@s.whatsapp.net', cfg, { role: 'user' }), true, 'moderator dari config env');
  assert.equal(isMods(BIASA, cfg, { role: 'user' }), false, 'user biasa bukan moderator');
  assert.equal(isMods(MOD, cfg), false, 'tanpa data user, role tidak bisa dibaca');
});

// ── Bebas limit (DM) ───────────────────────────────────────────────────────

test('moderator bebas limit di DM — limit tidak dipotong', async () => {
  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();
  const user = withLimit(db, MOD, 3);
  user.role = 'mod';

  const result = await handleMessage(conn, msg('.yts lagu uji', MOD), { plugins, db, config, logger: quiet });

  assert.equal(result.handled, true, `command tidak jalan: ${allText(sent)}`);
  assert.equal(db.user(MOD).limit, 3, 'limit moderator tidak boleh berkurang');
  db.close();
});

test('user biasa tetap dipotong limitnya (batas moderator tidak bocor)', async () => {
  const { db, conn } = harness();
  const plugins = await loadPlugins();
  withLimit(db, BIASA, 3);

  await handleMessage(conn, msg('.yts lagu uji', BIASA), { plugins, db, config, logger: quiet });

  assert.equal(db.user(BIASA).limit, 2, 'user biasa tetap bayar 1 limit');
  db.close();
});

// ── Bebas gate sewa grup ───────────────────────────────────────────────────

test('moderator boleh memakai fitur di grup yang belum disewa', async () => {
  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();
  const group = '123@g.us';
  withLimit(db, MOD, 3).role = 'mod';

  const result = await handleMessage(conn, msg('.yts lagu uji', MOD, group), { plugins, db, config, logger: quiet });

  assert.equal(result.handled, true, `moderator kena gate sewa: ${allText(sent)}`);
  assert.doesNotMatch(allText(sent), /butuh sewa aktif/);
  db.close();
});

test('user biasa di grup yang belum disewa tetap terkunci', async () => {
  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();
  withLimit(db, BIASA, 3);

  const result = await handleMessage(conn, msg('.yts lagu uji', BIASA, '123@g.us'), { plugins, db, config, logger: quiet });

  assert.equal(result.reason, 'rent-gated');
  assert.match(allText(sent), /butuh sewa aktif/);
  db.close();
});

// ── Bisa dipakai di DM walau bot dijalankan --gconly ───────────────────────

test('moderator tetap dilayani di DM saat bot memakai --gconly', async () => {
  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();
  withLimit(db, MOD, 3).role = 'mod';
  withLimit(db, BIASA, 3);

  const before = config.flags.gcOnly;
  config.flags.gcOnly = true;
  try {
    const asMod = await handleMessage(conn, msg('.yts lagu uji', MOD), { plugins, db, config, logger: quiet });
    assert.equal(asMod.handled, true, `moderator harus tetap dilayani: ${allText(sent)}`);

    const asUser = await handleMessage(conn, msg('.yts lagu uji', BIASA), { plugins, db, config, logger: quiet });
    assert.equal(asUser.reason, 'gconly', 'user biasa tetap diabaikan di DM');
  } finally {
    config.flags.gcOnly = before;
  }
  db.close();
});

// ── Bebas tag premium / register ───────────────────────────────────────────

test('moderator bebas memakai plugin bertanda premium', async () => {
  const { db, conn } = harness();
  db.user(MOD).role = 'mod';
  let ran = 0;
  const fake = async () => {
    ran += 1;
  };
  fake.premium = true;

  const result = await handleMessage(conn, msg('.fake', MOD), { plugins: stubPlugins(fake), db, config, logger: quiet });

  assert.equal(result.handled, true);
  assert.equal(ran, 1, 'plugin premium harus jalan untuk moderator');
  db.close();
});

test('user biasa tetap ditolak plugin bertanda premium', async () => {
  const { db, conn, sent } = harness();
  let ran = 0;
  const fake = async () => {
    ran += 1;
  };
  fake.premium = true;

  const result = await handleMessage(conn, msg('.fake', BIASA), { plugins: stubPlugins(fake), db, config, logger: quiet });

  assert.equal(result.reason, 'need-premium');
  assert.equal(ran, 0);
  assert.match(allText(sent), /premium/i);
  db.close();
});

test('moderator bebas memakai plugin yang mewajibkan daftar', async () => {
  const { db, conn } = harness();
  db.user(MOD).role = 'mod';
  let ran = 0;
  const fake = async () => {
    ran += 1;
  };
  fake.register = true;

  const result = await handleMessage(conn, msg('.fake', MOD), { plugins: stubPlugins(fake), db, config, logger: quiet });

  assert.equal(result.handled, true);
  assert.equal(ran, 1);
  db.close();
});

// ── Batas kekuasaan moderator (keputusan owner: A dan C) ───────────────────

test('moderator TIDAK bisa memakai command owner (bukan co-owner)', async () => {
  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();
  db.user(MOD).role = 'mod';

  const result = await handleMessage(conn, msg('.premium add 628555666777 30', MOD), { plugins, db, config, logger: quiet });

  assert.equal(result.reason, 'need-owner');
  assert.equal(db.user(BIASA).premium, false, 'moderator tidak boleh memberi premium ke siapa pun');
  assert.match(allText(sent), /khusus owner/i);
  db.close();
});

test('moderator tetap kena command yang dimatikan owner', async () => {
  const { db, conn, sent } = harness();
  db.user(MOD).role = 'mod';
  let ran = 0;
  const fake = async () => {
    ran += 1;
  };
  setCommand(db, 'tools-fake.js', { enabled: false });

  const result = await handleMessage(conn, msg('.fake', MOD), { plugins: stubPlugins(fake), db, config, logger: quiet });

  assert.equal(result.reason, 'disabled');
  assert.equal(ran, 0, 'command yang dimatikan owner tidak boleh jalan untuk moderator');
  assert.match(allText(sent), /dimatikan/i);
  db.close();
});

// ── Perintah .mod (khusus owner) ───────────────────────────────────────────

const TARGET = '628123456789';
const TARGET_JID = `${TARGET}@s.whatsapp.net`;

/** Jalankan plugin .mod seperti owner memakainya dari WhatsApp. */
async function modRun(db, { command = 'mod', args = [], mentionedJid = [], quoted = null, cfg = config } = {}) {
  const sent = [];
  const m = {
    chat: 'x',
    sender: OWNER,
    pushName: 'Owner',
    mentionedJid,
    quoted,
    reply: async (text) => {
      sent.push(String(text));
      return { key: { id: 'R' } };
    },
  };
  await modPlugin(m, { plugins: {}, db, config: cfg, args, command, usedPrefix: '.', conn: { sendMessage: async () => ({}) } });
  return sent.at(-1) || '';
}

test('.mod add mengangkat moderator dan tersimpan ke disk', async () => {
  const { db, file } = harness();
  const reply = await modRun(db, { args: ['add', TARGET] });

  assert.equal(db.user(TARGET_JID).role, 'mod');
  assert.match(reply, /moderator/i);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).users[TARGET_JID].role, 'mod', 'role harus ikut tersimpan');
  db.close();
});

test('.mod add lewat mention tidak membuat record palsu', async () => {
  const { db } = harness();
  await modRun(db, { args: ['add', `@${TARGET}`] });

  assert.equal(db.user(TARGET_JID).role, 'mod', 'role harus masuk ke user sebenarnya');
  const bogus = Object.keys(db.data.users).filter((jid) => jid.startsWith('@'));
  assert.deepEqual(bogus, [], `ada record palsu: ${bogus.join(', ')}`);
  db.close();
});

test('.mod add sambil reply pesan user (tanpa menulis nomor)', async () => {
  const { db } = harness();
  await modRun(db, { args: ['add'], quoted: { sender: '628222333444@s.whatsapp.net' } });

  assert.equal(db.user('628222333444@s.whatsapp.net').role, 'mod');
  db.close();
});

test('.mod add dua kali tidak menggandakan dan tetap melaporkan status', async () => {
  const { db } = harness();
  await modRun(db, { args: ['add', TARGET] });
  const reply = await modRun(db, { args: ['add', TARGET] });

  assert.equal(db.user(TARGET_JID).role, 'mod');
  assert.match(reply, /sudah moderator/i);
  db.close();
});

test('.mod del mencabut moderator (kembali jadi user biasa)', async () => {
  const { db } = harness();
  await modRun(db, { args: ['add', TARGET] });
  const reply = await modRun(db, { args: ['del', TARGET] });

  assert.equal(db.user(TARGET_JID).role, 'user');
  assert.match(reply, /dicabut/i);

  // setelah dicabut, hak istimewanya hilang
  assert.equal(isMods(TARGET_JID, config, db.user(TARGET_JID)), false);
  db.close();
});

test('.mod list menampilkan moderator dari database DAN dari config', async () => {
  const { db } = harness();
  const cfg = { ...config, bot: { ...config.bot, mods: ['628777888999'] } };
  await modRun(db, { args: ['add', TARGET], cfg });
  db.user(TARGET_JID).name = 'Budi';

  const reply = await modRun(db, { args: ['list'], cfg });

  assert.match(reply, /Daftar Moderator \(2\)/);
  assert.match(reply, /Budi \(628123456789\)/);
  assert.match(reply, /628777888999/, 'moderator dari config env harus ikut terdaftar');
  db.close();
});

test('.mod list kosong jika belum ada moderator', async () => {
  const { db } = harness();
  const reply = await modRun(db, { args: ['list'], cfg: { ...config, bot: { ...config.bot, mods: [] } } });

  assert.match(reply, /Belum ada moderator/);
  db.close();
});

test('.mod tanpa target valid hanya memberi petunjuk, tanpa membuat user palsu', async () => {
  const { db } = harness();
  const before = Object.keys(db.data.users).length;
  const reply = await modRun(db, { args: ['add'] });

  assert.equal(Object.keys(db.data.users).length, before, 'tidak boleh ada user baru');
  assert.match(reply, /Manajemen moderator/i);
  assert.equal(db.user(TARGET_JID).role, 'user');
  db.close();
});

test('.mod hanya untuk owner — moderator sendiri pun tidak bisa', async () => {
  assert.equal(modPlugin.owner, true, 'plugin .mod wajib bertanda owner');

  const { db, conn, sent } = harness();
  const plugins = await loadPlugins();
  db.user(MOD).role = 'mod';

  const result = await handleMessage(conn, msg(`.mod add ${TARGET}`, MOD), { plugins, db, config, logger: quiet });

  assert.equal(result.reason, 'need-owner');
  assert.equal(db.user(TARGET_JID).role, 'user', 'moderator tidak boleh mengangkat moderator lain');
  assert.match(allText(sent), /khusus owner/i);
  db.close();
});
