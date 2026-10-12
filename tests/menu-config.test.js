import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import {
  KNOWN_CATEGORIES,
  categoryState,
  commandState,
  ensureMenuSettings,
  isCategoryEnabled,
  isCategoryVisible,
  pluginEnabled,
  pluginVisible,
  setCategory,
  setCommand,
} from '../lib/menu-config.js';
import menuPlugin from '../plugins/main-menu.js';
import ownerMenuPlugin from '../plugins/owner-menu.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');

const makeDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-menu-db-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();
  return db;
};

const makeConn = () => {
  const sent = [];
  return {
    sent,
    conn: {
      user: { id: '628999@s.whatsapp.net' },
      sendMessage: async (chat, content) => {
        sent.push({ chat, content });
        return { key: { id: `M${sent.length}`, remoteJid: chat } };
      },
      readMessages: async () => [],
      groupMetadata: async () => ({ participants: [] }),
      getName: async (jid) => String(jid).split('@')[0],
    },
  };
};

// ── Pengaturan dasar ───────────────────────────────────────────────────────

test('kategori nsfw: tampil & menyala sebagai master switch (konten tetap opt-in per grup)', () => {
  const db = makeDb();
  const menu = ensureMenuSettings(db);

  assert.ok(KNOWN_CATEGORIES.nsfw, 'nsfw tidak terdaftar di KNOWN_CATEGORIES');
  assert.equal(KNOWN_CATEGORIES.nsfw.adult, true, 'nsfw harus ditandai kategori dewasa');
  assert.equal(menu.categories.nsfw.visible, true, 'nsfw default tampil');
  assert.equal(menu.categories.nsfw.enabled, true, 'master switch nyala; gambar tetap opt-in per grup');

  assert.deepEqual(categoryState(db, 'nsfw'), { visible: true, enabled: true });
  // owner tetap bisa mematikan seluruh fitur
  setCategory(db, 'nsfw', { enabled: false });
  assert.equal(categoryState(db, 'nsfw').enabled, false);
  // kategori lain default tampil & aktif
  assert.deepEqual(categoryState(db, 'game'), { visible: true, enabled: true });
  db.close();
});

test('setCategory & setCommand mengubah status dan tersimpan', () => {
  const db = makeDb();
  setCategory(db, 'game', { visible: false, enabled: false });
  assert.equal(isCategoryVisible(db, 'game'), false);
  assert.equal(isCategoryEnabled(db, 'game'), false);

  setCommand(db, 'sticker-smeme.js', { enabled: false });
  assert.equal(commandState(db, 'sticker-smeme.js').enabled, false);
  assert.equal(commandState(db, 'sticker-smeme.js').visible, true, 'hide/off terpisah');

  const plugin = { name: 'sticker-smeme.js', category: 'tools' };
  // kategori 'game' sudah dimatikan di atas; kategori lain tidak terpengaruh
  assert.equal(pluginEnabled(db, { name: 'tools-calc.js', category: 'tools' }), true, 'kategori lain tetap aktif');
  assert.equal(pluginEnabled(db, plugin), false, 'command yang dimatikan tidak aktif');
  assert.equal(pluginVisible(db, plugin), true, 'masih tampil karena hanya dimatikan');

  // kategori off -> semua command di kategori itu tidak aktif walau command-nya on
  assert.equal(pluginEnabled(db, { name: 'tools-calc.js', category: 'game' }), false);
  assert.equal(pluginVisible(db, { name: 'tools-calc.js', category: 'game' }), false);
  db.close();
});

// ── Handler: command dimatikan / kategori dewasa ──────────────────────────

async function setupPlugins(sources) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-menu-plugins-'));
  for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join(dir, name), source);
  const plugins = new PluginManager(dir, { logger: quiet });
  await plugins.loadAll();
  return plugins;
}

const message = (text) => ({
  key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: `T${Math.random().toString(36).slice(2, 7)}` },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Tester',
});

test('handler memblokir command yang dimatikan owner', async () => {
  const db = makeDb();
  const { conn, sent } = makeConn();
  const plugins = await setupPlugins({
    'x-halo.js': `const handler = async (m) => m.reply('hai dari plugin');
handler.help = ['halo']; handler.tags = ['test']; handler.command = /^(halo)$/i;
export default handler;`,
  });

  // normal
  const ok = await handleMessage(conn, message('.halo'), { plugins, db, config, logger: quiet });
  assert.equal(ok.handled, true);
  assert.match(sent.at(-1).content.text, /hai dari plugin/);

  // dimatikan lewat command
  setCommand(db, 'x-halo.js', { enabled: false });
  const blocked = await handleMessage(conn, message('.halo'), { plugins, db, config, logger: quiet });
  assert.equal(blocked.reason, 'disabled');
  assert.match(sent.at(-1).content.text, /dimatikan sama owner/i);

  // dimatikan lewat kategori
  setCommand(db, 'x-halo.js', { enabled: true });
  setCategory(db, 'test', { enabled: false });
  const blockedByCategory = await handleMessage(conn, message('.halo'), { plugins, db, config, logger: quiet });
  assert.equal(blockedByCategory.reason, 'disabled');
  db.close();
});

test('kategori nsfw yang dimatikan owner diabaikan tanpa pesan (kecuali plugin adultExempt)', async () => {
  const db = makeDb();
  const { conn, sent } = makeConn();
  const plugins = await setupPlugins({
    'nsfw-test.js': `const handler = async (m) => m.reply('konten dewasa');
handler.help = ['nsfwtest']; handler.tags = ['nsfw']; handler.command = /^(nsfwtest)$/i;
export default handler;`,
    'nsfw-toggle.js': `const handler = async (m) => m.reply('toggle jalan');
handler.help = ['nsfwtoggle']; handler.tags = ['nsfw']; handler.command = /^(nsfwtoggle)$/i;
handler.adultExempt = true;
export default handler;`,
  });

  // master switch dimatikan owner -> command dewasa diabaikan diam-diam
  setCategory(db, 'nsfw', { enabled: false });
  const before = sent.length;
  const silent = await handleMessage(conn, message('.nsfwtest'), { plugins, db, config, logger: quiet });
  assert.equal(silent.reason, 'adult-disabled');
  assert.equal(sent.length, before, 'tidak boleh ada balasan untuk kategori dewasa yang tertutup');

  // plugin bertanda adultExempt tetap dijawab (mis. toggle per grup)
  const exempt = await handleMessage(conn, message('.nsfwtoggle'), { plugins, db, config, logger: quiet });
  assert.equal(exempt.handled, true, 'plugin adultExempt harus tetap dijalankan');
  assert.match(sent.at(-1).content.text, /toggle jalan/);

  // setelah owner mengaktifkan -> command biasa jalan
  setCategory(db, 'nsfw', { enabled: true });
  const active = await handleMessage(conn, message('.nsfwtest'), { plugins, db, config, logger: quiet });
  assert.equal(active.handled, true);
  assert.match(sent.at(-1).content.text, /konten dewasa/);
  db.close();
});

// ── Plugin menu ────────────────────────────────────────────────────────────

const loadRealPlugins = async () => {
  const manager = new PluginManager(pluginsDir, { logger: quiet });
  await manager.loadAll();
  return manager;
};

const menuCtx = (db, plugins) => {
  const { conn, sent } = makeConn();
  const m = {
    chat: '628111@s.whatsapp.net',
    sender: '628999@s.whatsapp.net',
    pushName: 'Owner',
    reply: async (text) => {
      sent.push({ chat: '628111@s.whatsapp.net', content: { text: String(text) } });
      return { key: { id: `R${sent.length}` } };
    },
  };
  return { conn, sent, m, config, db, plugins, usedPrefix: '.', args: [], command: 'menu' };
};

const lastText = (ctx) => ctx.sent.at(-1)?.content?.text || '';

test('.menu menampilkan kategori nsfw + command, dan menyembunyikan yang di-hide', async () => {
  const db = makeDb();
  const plugins = await loadRealPlugins();
  const ctx = menuCtx(db, plugins);

  await menuPlugin(ctx.m, ctx);
  const awal = lastText(ctx);
  assert.match(awal, /NSFW \(18\+\)/, 'kategori nsfw harus tampil');
  assert.match(awal, /\.nsfw/, 'command .nsfw tampil (kategori tetap mati sampai diaktifkan)');
  assert.match(awal, /\.smeme/, 'smeme tampil secara default');

  // sembunyikan command nsfw -> kategori tetap tampil, isinya kosong
  setCommand(db, 'nsfw-image.js', { visible: false });
  await menuPlugin(ctx.m, ctx);
  assert.doesNotMatch(lastText(ctx), /\.nsfw/, 'command .nsfw harus hilang dari menu');
  assert.match(lastText(ctx), /Belum ada command di sini/, 'kategori kosong tetap tampil dengan keterangan');
  setCommand(db, 'nsfw-image.js', { visible: true });

  // sembunyikan command smeme
  setCommand(db, 'sticker-smeme.js', { visible: false });
  await menuPlugin(ctx.m, ctx);
  assert.doesNotMatch(lastText(ctx), /\.smeme/, 'smeme harus hilang dari menu');

  // sembunyikan kategori game
  setCategory(db, 'game', { visible: false });
  await menuPlugin(ctx.m, ctx);
  assert.doesNotMatch(lastText(ctx), /GAME/, 'kategori game harus hilang dari menu');
  assert.doesNotMatch(lastText(ctx), /\.tebakygo/);

  // tampilkan lagi
  setCategory(db, 'game', { visible: true });
  await menuPlugin(ctx.m, ctx);
  assert.match(lastText(ctx), /GAME/);
  db.close();
});

test('.menuset menampilkan status kategori & cara mengubahnya', async () => {
  const db = makeDb();
  const plugins = await loadRealPlugins();
  const ctx = menuCtx(db, plugins);
  ctx.args = [];
  ctx.command = 'menuset';
  setCategory(db, 'nsfw', { enabled: false }); // supaya ada kategori yang dimatikan untuk ditampilkan

  await ownerMenuPlugin(ctx.m, ctx);
  const body = lastText(ctx);
  assert.match(body, /PENGATURAN MENU/);
  assert.match(body, /NSFW \(18\+\)/);
  assert.match(body, /⛔ dimatikan/);
  assert.match(body, /category <kategori> show\|hide\|on\|off/);
  db.close();
});

test('.category & .cmdset mengubah pengaturan', async () => {
  const db = makeDb();
  const plugins = await loadRealPlugins();
  const ctx = menuCtx(db, plugins);

  ctx.command = 'category';
  ctx.args = ['nsfw', 'on'];
  await ownerMenuPlugin(ctx.m, ctx);
  assert.match(lastText(ctx), /Kategori \*nsfw\* diaktifkan/);
  assert.equal(categoryState(db, 'nsfw').enabled, true);

  ctx.command = 'category';
  ctx.args = ['nsfw', 'hide'];
  await ownerMenuPlugin(ctx.m, ctx);
  assert.equal(categoryState(db, 'nsfw').visible, false);

  ctx.command = 'cmdset';
  ctx.args = ['smeme', 'off'];
  await ownerMenuPlugin(ctx.m, ctx);
  assert.match(lastText(ctx), /dimatikan/);
  assert.equal(commandState(db, 'sticker-smeme.js').enabled, false);

  // target tidak dikenal
  ctx.command = 'cmdset';
  ctx.args = ['tidakadacommand', 'off'];
  await assert.rejects(ownerMenuPlugin(ctx.m, ctx), /tidak ditemukan/i);

  // kategori tidak dikenal
  ctx.command = 'category';
  ctx.args = ['ngawur', 'off'];
  await assert.rejects(ownerMenuPlugin(ctx.m, ctx), /tidak ada/i);
  db.close();
});

test('.menuset list <kategori> menampilkan command beserta statusnya', async () => {
  const db = makeDb();
  const plugins = await loadRealPlugins();
  const ctx = menuCtx(db, plugins);
  setCommand(db, 'sticker-smeme.js', { enabled: false });

  ctx.command = 'menuset';
  ctx.args = ['list', 'tools'];
  await ownerMenuPlugin(ctx.m, ctx);
  const body = lastText(ctx);
  assert.match(body, /KATEGORI TOOLS/);
  assert.match(body, /sticker-smeme\.js/);
  assert.match(body, /⛔/, 'status dimatikan harus terlihat');
  db.close();
});

test('plugin menu owner hanya bisa dipakai owner', () => {
  assert.equal(ownerMenuPlugin.owner, true);
  assert.deepEqual(ownerMenuPlugin.help, ['menuset', 'category', 'cmdset']);
  assert.match('menuset', ownerMenuPlugin.command);
  assert.match('category', ownerMenuPlugin.command);
  assert.match('cmdset', ownerMenuPlugin.command);
});
