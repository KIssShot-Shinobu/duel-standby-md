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
  ensureLimitSettings,
  formatLimitInfo,
  limitSummary,
  parseLimitAction,
  pluginLimitCost,
  resolveLimit,
  setCategoryLimit,
  setCommandLimit,
} from '../lib/limit-config.js';
import limitPlugin from '../plugins/owner-limit.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');

const makeDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-limit-db-'));
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

const message = (text) => ({
  key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: `T${Math.random().toString(36).slice(2, 7)}` },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Tester',
});

// ── Utilitas ───────────────────────────────────────────────────────────────

test('parseLimitAction menerjemahkan aksi owner', () => {
  assert.deepEqual(parseLimitAction('default'), { mode: 'default' });
  assert.deepEqual(parseLimitAction('gratis'), { mode: 'free' });
  assert.deepEqual(parseLimitAction('free'), { mode: 'free' });
  assert.deepEqual(parseLimitAction('pakai'), { mode: 'on' });
  assert.deepEqual(parseLimitAction('3'), { mode: 'custom', cost: 3 });
  assert.deepEqual(parseLimitAction('0'), { mode: 'custom', cost: 0 });
  assert.equal(parseLimitAction('abc'), null);
  assert.equal(parseLimitAction(''), null);
  assert.equal(parseLimitAction('-2'), null);
});

test('resolveLimit: bawaan plugin, override command & kategori', () => {
  const db = makeDb();
  const paid = { name: 'x-paid.js', category: 'tools', limit: true };
  const free = { name: 'x-free.js', category: 'tools', limit: false };
  const five = { name: 'x-five.js', category: 'game', limit: 5 };

  // bawaan plugin
  assert.equal(resolveLimit(db, paid).cost, 1);
  assert.equal(resolveLimit(db, paid).source, 'plugin');
  assert.equal(resolveLimit(db, free).cost, 0);
  assert.equal(resolveLimit(db, five).cost, 5);
  assert.equal(pluginLimitCost({ limit: 2 }), 2);
  assert.equal(pluginLimitCost({}), 0);

  // command dibuat gratis
  setCommandLimit(db, 'x-paid.js', parseLimitAction('gratis'));
  assert.equal(resolveLimit(db, paid).cost, 0);
  assert.equal(resolveLimit(db, paid).free, true);

  // command gratis dipaksa pakai limit
  setCommandLimit(db, 'x-free.js', parseLimitAction('pakai'));
  assert.equal(resolveLimit(db, free).cost, 1);

  // biaya custom
  setCommandLimit(db, 'x-paid.js', parseLimitAction('7'));
  assert.equal(resolveLimit(db, paid).cost, 7);
  assert.equal(resolveLimit(db, paid).mode, 'custom');

  // aturan kategori berlaku kalau command tidak diatur
  setCategoryLimit(db, 'game', parseLimitAction('gratis'));
  assert.equal(resolveLimit(db, five).cost, 0);

  // command menang atas kategori
  setCommandLimit(db, 'x-five.js', parseLimitAction('2'));
  assert.equal(resolveLimit(db, five).cost, 2);
  assert.equal(resolveLimit(db, five).source, 'command');

  // 'default' menghapus aturan command -> aturan kategori berlaku kembali
  setCommandLimit(db, 'x-five.js', parseLimitAction('default'));
  assert.equal(resolveLimit(db, five).cost, 0, 'aturan kategori gratis harus kembali berlaku');
  assert.equal(resolveLimit(db, five).source, 'category');
  db.close();
});

test('resolveLimit juga menerima entry dari PluginManager', () => {
  const db = makeDb();
  // entry nyata: { name, category, plugin }
  const entry = { name: 'x-entry.js', category: 'game', plugin: { limit: true } };
  assert.equal(resolveLimit(db, entry).cost, 1, 'biaya harus dibaca dari entry.plugin');
  setCategoryLimit(db, 'game', parseLimitAction('gratis'));
  assert.equal(resolveLimit(db, entry).cost, 0);
  db.close();
});

test('formatLimitInfo menjelaskan asal biaya', () => {
  const db = makeDb();
  const plugin = { name: 'x.js', category: 'tools', limit: true };
  assert.equal(formatLimitInfo(resolveLimit(db, plugin)), 'biaya 1 (bawaan plugin)');
  setCommandLimit(db, 'x.js', parseLimitAction('gratis'));
  assert.equal(formatLimitInfo(resolveLimit(db, plugin)), 'gratis');
  setCommandLimit(db, 'x.js', parseLimitAction('pakai'));
  assert.equal(formatLimitInfo(resolveLimit(db, plugin)), 'biaya 1 (aturan owner)');
  db.close();
});

// ── Handler ────────────────────────────────────────────────────────────────

async function setupPlugins(sources) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-limit-plugins-'));
  for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join(dir, name), source);
  const manager = new PluginManager(dir, { logger: quiet });
  await manager.loadAll();
  return manager;
}

const PLUGIN_WITH_LIMIT = `const handler = async (m) => m.reply('jalan');
handler.help = ['bayar']; handler.tags = ['test']; handler.command = /^(bayar)$/i; handler.limit = true;
export default handler;`;

test('handler memotong limit sesuai pengaturan owner', async () => {
  const db = makeDb();
  const { conn, sent } = makeConn();
  const plugins = await setupPlugins({ 'x-bayar.js': PLUGIN_WITH_LIMIT });
  const sender = '628111@s.whatsapp.net';

  const reset = () => {
    const user = db.user(sender);
    user.lastLimitReset = Date.now();
    user.limit = 10;
    return user;
  };

  // bawaan plugin: true -> potong 1
  reset();
  await handleMessage(conn, message('.bayar'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).limit, 9, 'bawaan plugin harus memotong 1 limit');

  // dibuat gratis
  setCommandLimit(db, 'x-bayar.js', parseLimitAction('gratis'));
  reset();
  await handleMessage(conn, message('.bayar'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).limit, 10, 'command gratis tidak boleh memotong limit');

  // biaya custom 4
  setCommandLimit(db, 'x-bayar.js', parseLimitAction('4'));
  reset();
  await handleMessage(conn, message('.bayar'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).limit, 6, 'biaya custom 4 harus memotong 4');

  // kategori dibuat gratis
  setCommandLimit(db, 'x-bayar.js', parseLimitAction('default'));
  setCategoryLimit(db, 'test', parseLimitAction('gratis'));
  reset();
  await handleMessage(conn, message('.bayar'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).limit, 10, 'aturan kategori harus berlaku');

  // limit habis -> ditolak
  setCategoryLimit(db, 'test', parseLimitAction('default'));
  reset();
  db.user(sender).limit = 1;
  await handleMessage(conn, message('.bayar'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).limit, 0);
  const denied = await handleMessage(conn, message('.bayar'), { plugins, db, config, logger: quiet });
  assert.equal(denied.reason, 'no-limit');
  assert.match(sent.at(-1).content.text, /limit/i);
  db.close();
});

test('command gratis bisa dipaksa memakai limit oleh owner', async () => {
  const db = makeDb();
  const { conn } = makeConn();
  const plugins = await setupPlugins({
    'x-gratis.js': `const handler = async (m) => m.reply('ok');
handler.help = ['gratis']; handler.tags = ['test']; handler.command = /^(gratis)$/i;
export default handler;`,
  });
  const sender = '628111@s.whatsapp.net';
  db.user(sender).lastLimitReset = Date.now();
  db.user(sender).limit = 10;

  await handleMessage(conn, message('.gratis'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).limit, 10, 'plugin tanpa limit = gratis');

  setCommandLimit(db, 'x-gratis.js', parseLimitAction('pakai'));
  await handleMessage(conn, message('.gratis'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).limit, 9, 'owner bisa memaksa pakai limit');
  db.close();
});

// ── Plugin owner-limit ─────────────────────────────────────────────────────

const loadRealPlugins = async () => {
  const manager = new PluginManager(pluginsDir, { logger: quiet });
  await manager.loadAll();
  return manager;
};

const ownerCtx = (db, plugins, args = [], command = 'limitset') => {
  const sent = [];
  return {
    sent,
    ctx: {
      plugins,
      db,
      args,
      command,
      usedPrefix: '.',
      conn: {},
      m: {
        chat: 'x',
        sender: '628999@s.whatsapp.net',
        pushName: 'Owner',
        reply: async (text) => {
          sent.push(String(text));
          return { key: { id: 'R' } };
        },
      },
    },
  };
};

test('.limitset menampilkan ringkasan pengaturan limit', async () => {
  const db = makeDb();
  const plugins = await loadRealPlugins();
  setCommandLimit(db, 'sticker-smeme.js', parseLimitAction('gratis'));
  setCategoryLimit(db, 'game', parseLimitAction('gratis'));

  const { sent, ctx } = ownerCtx(db, plugins);
  await limitPlugin(ctx.m, ctx);

  const body = sent.at(-1);
  assert.match(body, /PENGATURAN LIMIT/);
  assert.match(body, /Bawaan plugin/);
  assert.match(body, /Dibuat gratis/);
  assert.match(body, /smeme/);
  assert.match(body, /game \(gratis\)/);
  assert.match(body, /limitcmd <command>/);
  db.close();
});

test('.limitcmd & .limitcat mengubah biaya limit', async () => {
  const db = makeDb();
  const plugins = await loadRealPlugins();

  const cmd = ownerCtx(db, plugins, ['smeme', 'gratis'], 'limitcmd');
  await limitPlugin(cmd.ctx.m, cmd.ctx);
  assert.match(cmd.sent.at(-1), /dibuat gratis/);
  assert.equal(ensureLimitSettings(db).commands['sticker-smeme.js'].mode, 'free');

  const cat = ownerCtx(db, plugins, ['game', '3'], 'limitcat');
  await limitPlugin(cat.ctx.m, cat.ctx);
  assert.match(cat.sent.at(-1), /biaya limit diubah/);
  assert.equal(ensureLimitSettings(db).categories.game.mode, 'custom');

  // target/aksi tidak valid
  const bad = ownerCtx(db, plugins, ['smeme', 'ngawur'], 'limitcmd');
  await assert.rejects(limitPlugin(bad.ctx.m, bad.ctx), /Format/);

  const missing = ownerCtx(db, plugins, ['tidakadacommand', 'gratis'], 'limitcmd');
  await assert.rejects(limitPlugin(missing.ctx.m, missing.ctx), /tidak ditemukan/);

  const badCat = ownerCtx(db, plugins, ['ngawur', 'gratis'], 'limitcat');
  await assert.rejects(limitPlugin(badCat.ctx.m, badCat.ctx), /tidak ada/);
  db.close();
});

test('limitSummary menghitung bawaan plugin dengan benar', async () => {
  const db = makeDb();
  const plugins = await loadRealPlugins();
  const summary = limitSummary(db, plugins);

  assert.equal(summary.fromPlugin.paid + summary.fromPlugin.free, plugins.size);
  assert.ok(summary.fromPlugin.paid > 0, 'harus ada command berlimit');
  assert.ok(summary.fromPlugin.free > 0, 'harus ada command gratis');

  assert.equal(limitPlugin.owner, true);
  assert.deepEqual(limitPlugin.help, ['limitset', 'limitcmd', 'limitcat']);
  db.close();
});
