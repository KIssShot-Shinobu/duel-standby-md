import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import config from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import { UserError, errorLog, errorText, isFriendlyError, userError } from '../lib/errors.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };

// ── Utilitas error ─────────────────────────────────────────────────────────

test('isFriendlyError mengenali string, UserError, dan Error biasa', () => {
  assert.equal(isFriendlyError('pesan ramah'), true);
  assert.equal(isFriendlyError(userError('pesan ramah')), true);
  assert.equal(isFriendlyError(new UserError('x')), true);
  assert.equal(isFriendlyError(new Error('bug teknis')), false);
  assert.equal(isFriendlyError(undefined), false);
});

test('errorText & errorLog selalu menghasilkan teks yang berguna', () => {
  assert.equal(errorText('pesan ramah'), 'pesan ramah');
  assert.equal(errorText(new Error('boom')), 'boom');
  assert.equal(errorText(undefined), 'Kesalahan tidak diketahui');
  assert.equal(errorText({ message: 'dari objek' }), 'dari objek');
  assert.equal(errorText(42), '42');
  // inilah yang bikin log menampilkan "undefined" sebelumnya:
  assert.match(errorLog(new Error('boom')), /boom/);
  assert.equal(errorLog('pesan ramah'), 'pesan ramah');
  assert.notEqual(errorLog('pesan ramah'), undefined);
});

// ── Handler: error ramah vs error teknis ───────────────────────────────────

async function setupWithPlugins(pluginSources) {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-err-plugins-'));
  for (const [name, source] of Object.entries(pluginSources)) {
    fs.writeFileSync(path.join(pluginDir, name), source);
  }
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-err-db-'));
  const db = new Database(path.join(dbDir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();

  const plugins = new PluginManager(pluginDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
  };
  const msg = (text) => ({
    key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: `T${Math.random().toString(36).slice(2, 7)}` },
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Tester',
  });

  return { db, plugins, conn, sent, msg };
}

test('handler meneruskan pesan ramah dari plugin (throw string)', async () => {
  const { db, plugins, conn, sent, msg } = await setupWithPlugins({
    'x-friendly.js': `const handler = async () => { throw 'Kirim atau reply gambar/video dulu ya'; };
handler.help = ['ramah']; handler.tags = ['test']; handler.command = /^(ramah)$/i;
export default handler;`,
  });

  const result = await handleMessage(conn, msg('.ramah'), { plugins, db, config, logger: quiet });

  const reply = sent.at(-1)?.content?.text || '';
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'user-error');
  assert.match(reply, /Kirim atau reply gambar\/video dulu ya/);
  assert.doesNotMatch(reply, /Terjadi kesalahan/);
  db.close();
});

test('handler menyamarkan error teknis dan hanya membocorkannya saat --debug', async () => {
  const { db, plugins, conn, sent, msg } = await setupWithPlugins({
    'x-crash.js': `const handler = async () => { throw new Error('boom teknis'); };
handler.help = ['crash']; handler.tags = ['test']; handler.command = /^(crash)$/i;
export default handler;`,
  });

  await handleMessage(conn, msg('.crash'), { plugins, db, config, logger: quiet });
  const reply = sent.at(-1)?.content?.text || '';
  assert.match(reply, /Ups, ada yang error di server/);
  assert.doesNotMatch(reply, /boom teknis/);

  // mode debug menampilkan detail
  const debugConfig = { ...config, flags: { ...config.flags, debug: true } };
  await handleMessage(conn, msg('.crash'), { plugins, db, config: debugConfig, logger: quiet });
  assert.match(sent.at(-1)?.content?.text || '', /boom teknis/);
  db.close();
});

test('handler menerima userError dari plugin', async () => {
  const errorsUrl = pathToFileURL(path.resolve(import.meta.dirname, '..', 'lib', 'errors.js')).href;
  const { db, plugins, conn, sent, msg } = await setupWithPlugins({
    'x-usererror.js': `import { userError } from '${errorsUrl}';
const handler = async () => { throw userError('Video terlalu panjang (45s). Maksimal 10 detik.'); };
handler.help = ['panjang']; handler.tags = ['test']; handler.command = /^(panjang)$/i;
export default handler;`,
  });

  await handleMessage(conn, msg('.panjang'), { plugins, db, config, logger: quiet });
  assert.match(sent.at(-1)?.content?.text || '', /terlalu panjang \(45s\)/);
  db.close();
});
