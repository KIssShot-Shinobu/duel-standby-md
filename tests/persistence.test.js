import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import { parseLimitAction, setCategoryLimit, setCommandLimit } from '../lib/limit-config.js';
import { categoryState, commandState, setCategory, setCommand } from '../lib/menu-config.js';
import menuPlugin from '../plugins/main-menu.js';
import ownerMenuPlugin from '../plugins/owner-menu.js';
import ownerLimitPlugin from '../plugins/owner-limit.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');

const makeFileDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-persist-'));
  const file = path.join(dir, 'database.json');
  const db = new Database(file, { saveInterval: 5000, logger: quiet });
  db.load();
  return { db, file, dir };
};

const readRaw = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ── Pengaturan bertahan setelah restart ────────────────────────────────────

test('pengaturan menu bertahan setelah database dimuat ulang', async () => {
  const { db, file } = makeFileDb();

  setCategory(db, 'nsfw', { enabled: true, visible: false });
  setCategory(db, 'game', { visible: false });
  setCommand(db, 'sticker-smeme.js', { enabled: false });
  await db.save(true);
  db.close();

  // "restart": buka file yang sama
  const reloaded = new Database(file, { saveInterval: 5000, logger: quiet });
  reloaded.load();

  assert.deepEqual(categoryState(reloaded, 'nsfw'), { visible: false, enabled: true });
  assert.deepEqual(categoryState(reloaded, 'game'), { visible: false, enabled: true });
  assert.equal(commandState(reloaded, 'sticker-smeme.js').enabled, false);
  reloaded.close();
});

test('pengaturan limit bertahan setelah database dimuat ulang', async () => {
  const { db, file } = makeFileDb();

  setCommandLimit(db, 'sticker-smeme.js', parseLimitAction('gratis'));
  setCommandLimit(db, 'downloader-ytmp4.js', parseLimitAction('4'));
  setCategoryLimit(db, 'game', parseLimitAction('pakai'));
  await db.save(true);
  db.close();

  const reloaded = new Database(file, { saveInterval: 5000, logger: quiet });
  reloaded.load();
  const limit = reloaded.data.settings.limit;

  assert.equal(limit.commands['sticker-smeme.js'].mode, 'free');
  assert.equal(limit.commands['downloader-ytmp4.js'].cost, 4);
  assert.equal(limit.categories.game.mode, 'on');
  reloaded.close();
});

test('flushSync menulis perubahan tertunda (jaring pengaman saat proses berhenti)', () => {
  const { db, file } = makeFileDb();
  setCategory(db, 'nsfw', { enabled: true });

  // belum ada save() & timer debounce belum jalan -> berkas bahkan belum ada
  const before = fs.existsSync(file) ? readRaw(file) : {};
  assert.equal(before.settings?.menu?.categories?.nsfw?.enabled ?? null, null);

  db.flushSync(); // inilah yang dipanggil dari process.on('exit')
  assert.equal(readRaw(file).settings.menu.categories.nsfw.enabled, true);
  db.close();
});

// ── Perubahan lewat command owner langsung tersimpan ──────────────────────

const ownerCtx = (db, plugins, { command, args = [] }) => {
  const sent = [];
  return {
    sent,
    ctx: {
      plugins,
      db,
      args,
      command,
      usedPrefix: '.',
      m: {
        chat: 'x',
        sender: '628999@s.whatsapp.net',
        pushName: 'Owner',
        reply: async (text) => {
          sent.push(String(text));
          return { key: { id: 'R' } };
        },
      },
      conn: { sendMessage: async () => ({ key: { id: 'M' } }) },
    },
  };
};

test('.category/.cmdset/.limitcmd langsung menulis ke disk (tanpa menunggu debounce)', async () => {
  const { db, file } = makeFileDb();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  await ownerMenuPlugin(ownerCtx(db, plugins, { command: 'category', args: ['nsfw', 'on'] }).ctx.m, ownerCtx(db, plugins, { command: 'category', args: ['nsfw', 'on'] }).ctx);
  let raw = readRaw(file);
  assert.equal(raw.settings.menu.categories.nsfw.enabled, true, 'kategori nsfw harus langsung tersimpan');
  assert.equal(raw.settings.menu.categories.nsfw.visible, true);

  await ownerMenuPlugin(ownerCtx(db, plugins, { command: 'cmdset', args: ['smeme', 'hide'] }).ctx.m, ownerCtx(db, plugins, { command: 'cmdset', args: ['smeme', 'hide'] }).ctx);
  raw = readRaw(file);
  assert.equal(raw.settings.menu.commands['sticker-smeme.js'].visible, false);

  await ownerLimitPlugin(ownerCtx(db, plugins, { command: 'limitcmd', args: ['smeme', 'gratis'] }).ctx.m, ownerCtx(db, plugins, { command: 'limitcmd', args: ['smeme', 'gratis'] }).ctx);
  raw = readRaw(file);
  assert.equal(raw.settings.limit.commands['sticker-smeme.js'].mode, 'free');

  await ownerLimitPlugin(ownerCtx(db, plugins, { command: 'limitcat', args: ['game', '2'] }).ctx.m, ownerCtx(db, plugins, { command: 'limitcat', args: ['game', '2'] }).ctx);
  raw = readRaw(file);
  assert.equal(raw.settings.limit.categories.game.cost, 2);
  db.close();
});

test('menu memakai pengaturan hasil muat ulang (bukan default)', async () => {
  const { db, file } = makeFileDb();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  setCategory(db, 'game', { visible: false });
  setCommand(db, 'sticker-smeme.js', { visible: false });
  await db.save(true);
  db.close();

  const reloaded = new Database(file, { saveInterval: 5000, logger: quiet });
  reloaded.load();

  const sent = [];
  const m = {
    chat: 'x',
    sender: '628999@s.whatsapp.net',
    pushName: 'Owner',
    reply: async () => ({ key: { id: 'R' } }),
  };
  const conn = { sendMessage: async (_c, content) => (sent.push(content.text), { key: { id: 'M' } }) };

  await menuPlugin(m, {
    conn,
    plugins,
    db: reloaded,
    config: { bot: { name: 'Uji', prefix: ['.'], timezone: 'Asia/Jakarta' } },
    usedPrefix: '.',
    args: [],
  });

  const menu = sent.at(-1);
  assert.doesNotMatch(menu, /GAME/, 'kategori game harus tetap tersembunyi setelah restart');
  assert.doesNotMatch(menu, /\.smeme/);
  assert.match(menu, /NSFW \(18\+\)/, 'placeholder nsfw tetap ada');
  reloaded.close();
});
