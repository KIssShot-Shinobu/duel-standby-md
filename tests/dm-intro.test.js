import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import baseConfig from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const SENDER = '628111@s.whatsapp.net';
const GROUP = '123456789@g.us';

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-dmintro-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net', name: 'Bot Uji' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    groupFetchAllParticipating: async () => ({}),
    groupGetInviteInfo: async () => null,
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  return { db, plugins, conn, sent, dir };
}

const dm = (text, { fromMe = false, chat = SENDER } = {}) => ({
  key: { remoteJid: chat, fromMe, id: `I${Math.random().toString(36).slice(2, 8)}` },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Tester',
});

const run = (t, msg, config = baseConfig) =>
  handleMessage(t.conn, msg, { plugins: t.plugins, db: t.db, config, logger: quiet });

const introOf = (t) => t.sent.find((s) => /Selamat datang di/i.test(s.content?.text || ''));

test('E2E: user baru DM menerima intro sekali', async () => {
  const t = await setup();
  await run(t, dm('halo bot'));

  const intro = introOf(t);
  assert.ok(intro, 'intro harus terkirim ke user baru');
  assert.match(intro.content.text, /Halo Tester!/);
  assert.match(intro.content.text, /Cara penggunaan bot/);
  assert.ok(t.db.user(SENDER).dmIntroSentAt > 0, 'penanda dmIntroSentAt harus terisi');
  t.db.close();
});

test('E2E: intro tidak dikirim ulang pada pesan berikutnya', async () => {
  const t = await setup();
  await run(t, dm('halo'));
  const afterFirst = t.sent.length;

  // Pesan biasa (bukan command) tidak dijawab bot, jadi `sent` tidak boleh
  // bertambah — yang penting intro tidak muncul lagi.
  await run(t, dm('halo lagi'));
  await run(t, dm('halo ketiga'));

  assert.equal(
    t.sent.filter((s) => /Selamat datang di/i.test(s.content?.text || '')).length,
    1,
    'intro hanya boleh muncul sekali meski beberapa pesan',
  );
  assert.equal(t.sent.length, afterFirst, 'pesan lanjutan tidak boleh memicu intro tambahan');
  t.db.close();
});

test('E2E: intro TIDAK dikirim di grup', async () => {
  const t = await setup();
  await run(t, dm('halo semua', { chat: GROUP }));

  assert.equal(introOf(t), undefined, 'grup tidak boleh menerima intro DM');
  assert.equal(t.db.user(GROUP).dmIntroSentAt, 0, 'penanda grup tidak boleh terisi');
  t.db.close();
});

test('E2E: pesan bot sendiri (fromMe) tidak memicu intro', async () => {
  const t = await setup();
  await run(t, dm('halo dari bot', { fromMe: true }));

  assert.equal(introOf(t), undefined, 'fromMe tidak boleh memicu intro');
  t.db.close();
});

test('E2E: intro mendahului command tanpa menelannya (command tetap dijawab)', async () => {
  const t = await setup();
  // `.ping` menjawab — intro harus di urutan pertama, jawaban command sesudahnya.
  await run(t, dm('.ping'));

  const intro = introOf(t);
  assert.ok(intro, 'user baru tetap menerima intro');
  const idxIntro = t.sent.indexOf(intro);
  const others = t.sent.filter((s) => s !== intro);
  assert.ok(others.length >= 1, 'command tetap harus dijawab walau intro mendahului');
  assert.match(others.map((s) => s.content?.text || '').join('\n'), /\S/,
    'jawaban command tidak boleh kosong');
  assert.ok(idxIntro >= 0);
  t.db.close();
});

test('E2E: blok penyewaan ikut tampil saat rent aktif, hilang saat dimatikan', async () => {
  const on = await setup();
  await run(on, dm('halo'), baseConfig);
  const intro = introOf(on).content.text;
  assert.match(intro, /Sewa bot/, 'rent aktif -> blok sewa tampil');
  assert.match(intro, /DM\) \*gratis\*/, 'intro harus menyatakan DM gratis tanpa sewa');
  on.db.close();

  const off = await setup();
  await run(off, dm('halo'), { ...baseConfig, rent: { ...baseConfig.rent, enabled: false } });
  assert.doesNotMatch(introOf(off).content.text, /Sewa bot/, 'rent dimatikan -> blok sewa hilang');
  assert.match(introOf(off).content.text, /Cara penggunaan bot/, 'panduan dasar tetap ada');
  off.db.close();
});

test('E2E: nama bot & prefix dari config dipakai di intro', async () => {
  const t = await setup();
  const cfg = { ...baseConfig, bot: { ...baseConfig.bot, name: 'Bot Kustom', prefix: ['!'] } };
  await run(t, dm('halo'), cfg);

  const text = introOf(t).content.text;
  assert.match(text, /Bot Kustom/);
  assert.match(text, /!menu/, 'prefix kustom harus dipakai');
  t.db.close();
});

test('E2E: intro tetap dikirim kalau upaya pertama gagal (penanda tidak terisi)', async () => {
  const t = await setup();
  const calls = [];
  const original = t.conn.sendMessage;
  t.conn.sendMessage = async (chat, content) => {
    calls.push(content);
    if (calls.length === 1) throw new Error('jaringan rusak');
    return original(chat, content);
  };

  await run(t, dm('halo'));
  assert.equal(t.db.user(SENDER).dmIntroSentAt, 0, 'kegagalan tidak boleh menandai intro terkirim');

  await run(t, dm('halo lagi'));
  assert.ok(t.db.user(SENDER).dmIntroSentAt > 0, 'percobaan berikutnya harus mengirim intro');
  t.db.close();
});
