import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../config.js';
import { Database } from '../lib/database.js';
import { setCategory, setCommand, wrapCommands } from '../lib/menu-config.js';
import { PluginManager } from '../lib/plugins.js';
import menuPlugin from '../plugins/main-menu.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');

async function render(args = [], { owner = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-menu-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  let out = '';
  const conn = {
    sendMessage: async (_chat, content) => {
      out = content.text;
      return { key: { id: 'M' } };
    },
  };
  const m = {
    chat: '628111@s.whatsapp.net',
    sender: '628999999999@s.whatsapp.net',
    pushName: 'Owner',
    reply: async (text) => {
      out = String(text);
      return { key: { id: 'R' } };
    },
  };
  await menuPlugin(m, { conn, plugins, config, db, usedPrefix: '.', args, command: 'menu', isOwner: owner });
  return { out, db, plugins, dir };
}

// ── wrapCommands ───────────────────────────────────────────────────────────

test('wrapCommands membungkus daftar command tanpa melebihi lebar', () => {
  const lines = wrapCommands(['alpha', 'beta', 'gamma', 'delta', 'epsilon'], { maxWidth: 20 });
  assert.ok(lines.length >= 2, 'harus terbagi beberapa baris');
  for (const line of lines) {
    assert.ok(line.length <= 20, `baris terlalu panjang: "${line}"`);
    assert.ok(line.startsWith('   '), 'harus menjorok konsisten');
  }
  assert.equal(lines.join(' ').replace(/\s+/g, ' ').includes('.alpha'), true);
});

test('wrapCommands tidak menyisakan pemisah di ujung baris', () => {
  const lines = wrapCommands(['satu', 'dua', 'tiga'], { maxWidth: 12 });
  for (const line of lines) {
    assert.doesNotMatch(line, /[·]\s*$/, `ada pemisah menggantung: "${line}"`);
  }
});

// ── Ringkasan menu ─────────────────────────────────────────────────────────

test('.menu ringkas: sapaan + info bot + daftar kategori', async () => {
  const { out, db, dir } = await render();

  const lines = out.split('\n');
  assert.ok(lines.length < 40, `menu terlalu panjang: ${lines.length} baris`);
  assert.ok(out.length < 1200, `menu terlalu panjang: ${out.length} karakter`);

  // sapaan menyebut pengirim (mention), bukan nama mati
  assert.match(out, /^Hallo @\d+! 👋/);
  assert.match(out, /siap membantu Anda 24\/7/);

  // blok info bot
  assert.match(out, /I N F O  B O T/);
  assert.match(out, /Mode : Publik/);
  assert.match(out, /Nama : .+/);
  assert.match(out, /Versi : /);
  assert.match(out, /Limits : \d+/);
  assert.match(out, /Uptime : \d{2}:\d{2}:\d{2}/);

  // daftar menu = kategori, bukan seluruh command
  assert.match(out, /DAFTAR MENU/);
  assert.match(out, /\.menu all/);
  assert.match(out, /\.menu main/);
  assert.match(out, /\.menu tools/);
  assert.match(out, /\.menu nsfw/);
  assert.match(out, /Contoh: \.menu /);
  assert.match(out, /Powered By /);

  // command individual tidak membanjiri menu utama (pindah ke `.menu all`)
  assert.doesNotMatch(out, /\.smeme/);
  assert.doesNotMatch(out, /\.tebakygo/);
  assert.doesNotMatch(out, /\.stiker/, 'alias tidak perlu di menu utama');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.menu all menampilkan seluruh command per kategori', async () => {
  const { out, db, dir } = await render(['all']);

  assert.match(out, /SEMUA COMMAND/);
  assert.match(out, /MAIN \(\d+\)/);
  assert.match(out, /\.smeme/);
  assert.match(out, /\.tebakygo/);
  assert.match(out, /\.nsfw/);
  assert.doesNotMatch(out, /\.stiker/, 'alias tetap tidak ikut');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.menu menandai kategori yang dimatikan owner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-menu-off-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();
  setCategory(db, 'game', { enabled: false });

  let out = '';
  const conn = { sendMessage: async (_chat, content) => { out = content.text; return { key: { id: 'M' } }; } };
  const m = { chat: 'x', sender: '628999999999@s.whatsapp.net', pushName: 'Owner', reply: async (t) => { out = String(t); } };
  await menuPlugin(m, { conn, plugins, config, db, usedPrefix: '.', args: [], command: 'menu', isOwner: true });

  assert.match(out, /\.menu game ⛔/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.menu <kategori> menampilkan alias + biaya limit', async () => {
  const { out, db, dir } = await render(['game']);

  assert.match(out, /GAME — \d+ command/);
  assert.match(out, /\.tebakygo · \.nyerah · \.stoptebak · \.yugoscore/, 'alias harus tampil di detail kategori');
  assert.match(out, /\(1 limit\)/);
  assert.match(out, /\(gratis\)/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.menu <kategori> kosong tetap memberi keterangan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-menu-empty-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();
  // sembunyikan semua command NSFW -> kategori tetap tampil tapi kosong
  setCommand(db, 'nsfw-image.js', { visible: false });

  let out = '';
  const conn = { sendMessage: async (_chat, content) => { out = content.text; return { key: { id: 'M' } }; } };
  const m = { chat: 'x', sender: '628999999999@s.whatsapp.net', pushName: 'Owner', reply: async (t) => { out = String(t); } };

  await menuPlugin(m, { conn, plugins, config, db, usedPrefix: '.', args: [], command: 'menu', isOwner: true });
  assert.match(out, /\.menu nsfw/);

  await menuPlugin(m, { conn, plugins, config, db, usedPrefix: '.', args: ['all'], command: 'menu', isOwner: true });
  assert.match(out, /NSFW \(18\+\)/);
  assert.match(out, /Belum ada command di sini/);

  await menuPlugin(m, { conn, plugins, config, db, usedPrefix: '.', args: ['nsfw'], command: 'menu', isOwner: true });
  assert.match(out, /Belum ada command di sini/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.help <command> menampilkan detail command', async () => {
  const { out, db, dir } = await render(['sticker']);

  assert.match(out, /\*STICKER\*/);
  assert.doesNotMatch(out, /📄 File: /, 'nama file plugin tidak boleh bocor ke user');
  assert.doesNotMatch(out, /tools-sticker\.js/, 'nama file plugin tidak boleh tampil di help');
  assert.match(out, /⌨️ Alias: sticker, stiker, s/);
  assert.match(out, /💳 Limit: /);
  assert.match(out, /💡 Contoh: \.sticker/);
  assert.doesNotMatch(out, /TOOLS —/, 'command detail tidak menampilkan daftar kategori');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.menu kategori tidak dikenal memberi daftar kategori', async () => {
  const { out, db, dir } = await render(['kategori-ngawur']);
  assert.match(out, /gak ketemu atau disembunyikan/);
  assert.match(out, /Kategori: .*main/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
