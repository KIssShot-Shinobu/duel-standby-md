import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { PluginManager, getDisplayNames } from '../lib/plugins.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

test('semua plugin dimuat tanpa error dan punya kontrak valid', async () => {
  const pm = new PluginManager(pluginsDir, { logger: quiet });
  await pm.loadAll();

  assert.equal(pm.errors.length, 0, `error plugin: ${JSON.stringify(pm.errors)}`);
  assert.ok(pm.size >= 30, `jumlah plugin terlalu sedikit: ${pm.size}`);

  for (const entry of pm.list) {
    const plugin = entry.plugin;
    const callable = typeof plugin === 'function';
    const hasHook = ['before', 'all', 'onGroupParticipants', 'onGroupsUpdate', 'onCall'].some(
      (hook) => typeof plugin?.[hook] === 'function',
    );
    assert.ok(callable || hasHook, `${entry.name} tidak punya handler/hook`);
    if (entry.commands.length) {
      assert.ok(callable, `${entry.name} punya command tapi tidak bisa dipanggil`);
      assert.ok(Array.isArray(plugin.help), `${entry.name} tanpa handler.help`);
      assert.ok(Array.isArray(plugin.tags) && plugin.tags.length > 0, `${entry.name} tanpa handler.tags`);
    }
  }
});

test('tidak ada nama command yang dobel', async () => {
  const pm = new PluginManager(pluginsDir, { logger: quiet });
  await pm.loadAll();

  const seen = new Map();
  const duplicates = [];
  for (const entry of pm.list) {
    for (const command of getDisplayNames(entry.plugin)) {
      if (seen.has(command)) duplicates.push({ command, a: seen.get(command), b: entry.name });
      else seen.set(command, entry.name);
    }
  }
  assert.deepEqual(duplicates, []);
  assert.equal(pm.commandIndex.size, seen.size);
});

test('kategori menu terisi dan hook event terdeteksi', async () => {
  const pm = new PluginManager(pluginsDir, { logger: quiet });
  await pm.loadAll();

  const categories = pm.categories().map(([tag]) => tag);
  for (const expected of ['main', 'owner', 'group', 'tools', 'downloader', 'rpg', 'ai', 'fun', 'info', 'event']) {
    assert.ok(categories.includes(expected), `kategori "${expected}" tidak ada (${categories.join(', ')})`);
  }

  assert.ok(pm.hooks.before.length >= 3, 'hook before kurang');
  assert.ok(pm.hooks.onGroupParticipants.length >= 1, 'hook onGroupParticipants kurang');
});

test('pencarian command literal dan regex', async () => {
  const pm = new PluginManager(pluginsDir, { logger: quiet });
  await pm.loadAll();

  assert.equal(pm.find('menu')?.name, 'main-menu.js');
  assert.equal(pm.find('ping')?.name, 'main-ping.js');
  assert.equal(pm.find('tidak-ada-command-ini'), null);
  // regex: command = /^(sticker|stiker|s|stick)$/i
  assert.equal(pm.find('s')?.name, 'tools-sticker.js');
});
