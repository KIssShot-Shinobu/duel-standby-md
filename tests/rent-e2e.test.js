import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import baseConfig from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import * as Rent from '../lib/rent.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

async function setup({ participants = [], owners = baseConfig.bot.owners } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-rent-e2e-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net', name: 'Bot Uji' },
    sendMessage: async (chat, content, opts) => {
      sent.push({ chat, content, opts });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  const config = {
    ...baseConfig,
    bot: { ...baseConfig.bot, owners, ownerJids: owners.map((n) => `${n}@s.whatsapp.net`) },
  };
  return { dir, db, plugins, conn, sent, config };
}

const msg = (text, chat = '628111@s.whatsapp.net') => ({
  key: {
    remoteJid: chat,
    fromMe: false,
    id: `IN-${Math.random().toString(36).slice(2, 8)}`,
    ...(chat.endsWith('@g.us') ? { participant: '628111@s.whatsapp.net' } : {}),
  },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Tester',
});

const replyText = (sent, chat) =>
  (sent.find((s) => s.chat === chat && s.content?.text)?.content?.text || '');

/** Siapkan chat: matikan antiSpam supaya hook antispam (tracker global) tidak mengganggu determinisme. */
const ungated = (db, chat) => {
  db.chat(chat).antiSpam = false;
  return chat;
};

test('grup tanpa rental: command kategori dikunci + pesan sewa', async () => {
  const t = await setup();
  const r = await handleMessage(t.conn, msg('.calc 1+1', ungated(t.db, '999@g.us')), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(r.reason, 'rent-gated');
  assert.match(replyText(t.sent, '999@g.us'), /sewa aktif/);
  t.db.close();
});

test('grup tanpa rental: .menu (main) tetap jalan', async () => {
  const t = await setup();
  const r = await handleMessage(t.conn, msg('.menu', ungated(t.db, '999@g.us')), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.notEqual(r.reason, 'rent-gated');
  t.db.close();
});

test('grup owner tanpa rental: tidak dikunci', async () => {
  const t = await setup({ participants: [{ id: '6289999999999@s.whatsapp.net' }], owners: ['6289999999999'] });
  const r = await handleMessage(t.conn, msg('.calc 1+1', ungated(t.db, '999@g.us')), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.notEqual(r.reason, 'rent-gated');
  assert.equal(r.handled, true);
  t.db.close();
});

test('grup sewa aktif: command kategori jalan', async () => {
  const t = await setup();
  Rent.activateRent(t.db, '999@g.us', { renter: '628111@s.whatsapp.net', renterName: 'Tester', days: 30, by: 'owner', now: Date.now() });
  const r = await handleMessage(t.conn, msg('.calc 1+1', ungated(t.db, '999@g.us')), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.notEqual(r.reason, 'rent-gated');
  assert.equal(r.handled, true);
  t.db.close();
});

test('grup sewa EXPIRED: dikunci lagi', async () => {
  const t = await setup();
  Rent.activateRent(t.db, '999@g.us', { renter: '628111@s.whatsapp.net', renterName: 'Tester', days: 30, by: 'owner', now: Date.now() - 40 * 86400000 });
  const r = await handleMessage(t.conn, msg('.calc 1+1', ungated(t.db, '999@g.us')), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(r.reason, 'rent-gated');
  t.db.close();
});

test('penyewa aktif: tidak kena batas limit (kontrol: non-renter kena no-limit)', async () => {
  // non-renter, limit 0, grup aktif -> no-limit
  const a = await setup();
  Rent.activateRent(a.db, '888@g.us', { renter: '628777@s.whatsapp.net', renterName: 'Y', days: 30, by: 'owner', now: Date.now() });
  const nonRenter = a.db.user('628111@s.whatsapp.net');
  nonRenter.limit = 0;
  nonRenter.lastLimitReset = Date.now();
  const rNo = await handleMessage(a.conn, msg('.toimg', ungated(a.db, '888@g.us')), { plugins: a.plugins, db: a.db, config: a.config, logger: quiet });
  assert.equal(rNo.reason, 'no-limit');
  a.db.close();

  // renter aktif (di grup lain), limit 0 -> tetap jalan & limit tidak dipotong
  const b = await setup();
  Rent.activateRent(b.db, '999@g.us', { renter: '628111@s.whatsapp.net', renterName: 'T', days: 30, by: 'owner', now: Date.now() });
  const renter = b.db.user('628111@s.whatsapp.net');
  renter.limit = 0;
  renter.lastLimitReset = Date.now();
  const rYes = await handleMessage(b.conn, msg('.toimg', ungated(b.db, '888@g.us')), { plugins: b.plugins, db: b.db, config: b.config, logger: quiet });
  assert.equal(rYes.reason, 'user-error'); // lolos limit, lalu toimg tolak karena .toimg butuh stiker
  assert.equal(renter.limit, 0, 'limit penyewa tidak boleh berkurang');
  b.db.close();
});