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
import rentGuard from '../plugins/_rent-guard.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const GROUP = '120363046825098789@g.us';
const ID = '120363046825098789';

async function setup({ owners = ['6289999999999'], sender = '628111@s.whatsapp.net', groups = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-rent-plug-'));
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
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    groupFetchAllParticipating: async () => ({
      [GROUP]: { id: GROUP, subject: 'Grup Pelarian Doi' },
      '456@g.us': { id: '456@g.us', subject: 'ECCLESIA' },
    }),
    groupGetInviteInfo: async () => ({ id: GROUP, subject: 'Grup Pelarian Doi' }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  const config = {
    ...baseConfig,
    bot: { ...baseConfig.bot, owners, ownerJids: owners.map((n) => `${n}@s.whatsapp.net`) },
  };
  const extra = { groups };
  return { dir, db, plugins, conn, sent, config, extra };
}

const msg = (text, chat = '628111@s.whatsapp.net', pushName = 'Tester') => ({
  key: {
    remoteJid: chat,
    fromMe: false,
    id: `IN-${Math.random().toString(36).slice(2, 8)}`,
    ...(chat.endsWith('@g.us') ? { participant: '628111@s.whatsapp.net' } : {}),
  },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName,
});

const dmMsg = (text, chat = '628111@s.whatsapp.net') => msg(text, chat);

const reply = (sent, chat) =>
  (sent.find((s) => s.chat === chat && (s.content?.text || s.content?.caption))?.content?.text ||
    sent.find((s) => s.chat === chat && s.content?.caption)?.content?.caption ||
    '');

test('.rent bare di DM: menampilkan info sewa', async () => {
  const t = await setup();
  const r = await handleMessage(t.conn, dmMsg('.rent'), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(r.handled, true);
  assert.match(reply(t.sent, '628111@s.whatsapp.net'), /sewa/i);
  t.db.close();
});

test('.rent <id grup> di DM: buat pending + owner diberitahu', async () => {
  const t = await setup();
  const r = await handleMessage(t.conn, dmMsg(`.rent ${ID}`), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(r.handled, true);
  const rental = Rent.getRental(t.db, GROUP);
  assert.ok(rental, 'rental harus dibuat');
  assert.equal(rental.status, 'pending');
  assert.equal(rental.renter, '628111@s.whatsapp.net');
  const ownerJid = '6289999999999@s.whatsapp.net';
  assert.ok(t.sent.some((s) => s.chat === ownerJid && /Permintaan sewa/i.test(s.content?.text || '')), 'owner harus dapat DM');
  t.db.close();
});

test('.rentstatus grup aktif: menampilkan sisa hari', async () => {
  const t = await setup();
  Rent.activateRent(t.db, GROUP, { renter: '628111@s.whatsapp.net', renterName: 'Tester', days: 30, by: 'owner', now: Date.now() });
  const r = await handleMessage(t.conn, dmMsg(`.rentstatus ${ID}`), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  const text = reply(t.sent, '628111@s.whatsapp.net');
  assert.match(text, /aktif/i);
  assert.match(text, /\d+ hari/i);
  t.db.close();
});

test('owner .rent approve <id> [hari]: sewa aktif', async () => {
  const t = await setup({ owners: ['628111'] });
  const r = await handleMessage(t.conn, dmMsg(`.rent approve ${ID} 30`, '628111@s.whatsapp.net'), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(r.handled, true);
  assert.equal(Rent.rentalStatus(t.db, GROUP), 'active');
  t.db.close();
});

test('non-owner .rent add <grup>: ditolak "Khusus owner", bukan gagal cari grup', async () => {
  const t = await setup({ owners: ['6289999999999'] });
  const r = await handleMessage(t.conn, dmMsg(`.rent add ${ID}`), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(r.reason, 'user-error');
  assert.match(reply(t.sent, '628111@s.whatsapp.net'), /Khusus owner/i);
  assert.equal(Rent.getRental(t.db, GROUP), null, 'tidak boleh ada rental dibuat oleh non-owner');
  t.db.close();
});

test('owner .rent add <jid @g.us>: aktif meski pakai JID eksplisit', async () => {
  const t = await setup({ owners: ['628111'] });
  const jid = '6289670762522-1614085129@g.us';
  const r = await handleMessage(t.conn, dmMsg(`.rent add ${jid} 30`, '628111@s.whatsapp.net'), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  assert.equal(r.handled, true);
  assert.equal(Rent.rentalStatus(t.db, jid), 'active');
  t.db.close();
});

test('.grouplist (owner): daftar grup + status; non-owner ditolak', async () => {
  const owner = await setup({ owners: ['628111'] });
  await Rent.activateRent(owner.db, GROUP, { renter: '628111@s.whatsapp.net', renterName: 'T', days: 30, by: 'owner', now: Date.now() });
  const r1 = await handleMessage(owner.conn, dmMsg('.grouplist', '628111@s.whatsapp.net'), { plugins: owner.plugins, db: owner.db, config: owner.config, logger: quiet });
  const text = reply(owner.sent, '628111@s.whatsapp.net');
  assert.match(text, /DAFTAR GRUP/i);
  assert.match(text, /Grup Pelarian Doi/i);
  owner.db.close();

  const user = await setup({ owners: ['6289999999999'] });
  const r2 = await handleMessage(user.conn, dmMsg('.grouplist'), { plugins: user.plugins, db: user.db, config: user.config, logger: quiet });
  assert.equal(r2.reason, 'user-error');
  assert.match(reply(user.sent, '628111@s.whatsapp.net'), /Khusus owner/i);
  user.db.close();
});

test('handler.all: teks DM dari user dengan pending rental diteruskan ke owner (bukti bayar)', async () => {
  const t = await setup();
  Rent.requestRent(t.db, GROUP, { renter: '628111@s.whatsapp.net', renterName: 'Tester' });
  const r = await handleMessage(t.conn, dmMsg('sudah transfer ya bang'), { plugins: t.plugins, db: t.db, config: t.config, logger: quiet });
  const ownerJid = '6289999999999@s.whatsapp.net';
  const forwarded = t.sent.find((s) => s.chat === ownerJid && s.content?.text);
  assert.ok(forwarded, 'owner harus menerima bukti');
  assert.match(forwarded.content.text, /sudah transfer ya bang/);
  assert.equal(r.handled, false); // bukan command -> hook all (tidak diproses sebagai command)
  t.db.close();
});

// ── _rent-guard: tawaran saat bot ditambahkan ─────────────────────────────

function guardCtx({ dir, enabled = true }) {
  const qrisPath = path.join(dir, 'qris.jpg');
  fs.writeFileSync(qrisPath, Buffer.from('qris-placeholder'));
  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}` } };
    },
  };
  const config = {
    ...baseConfig,
    root: dir,
    bot: { ...baseConfig.bot, prefix: ['.'] },
    rent: { ...baseConfig.rent, enabled, qrisFile: 'qris.jpg' },
  };
  return { conn, sent, config };
}

test('_rent-guard: bot ditambahkan -> tawaran + QRIS ke penambah', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-guard-'));
  const { conn, sent, config } = guardCtx({ dir });
  const update = {
    id: '123@g.us',
    action: 'add',
    participants: ['628999@s.whatsapp.net'],
    author: '628111@s.whatsapp.net',
  };
  await rentGuard.onGroupParticipants(conn, update, { groupMetadata: { subject: 'Grup Uji' }, config });
  const msg = sent.find((s) => s.chat === '628111@s.whatsapp.net');
  assert.ok(msg, 'penambah harus dapat pesan');
  assert.ok(msg.content.image, 'QRIS ikut terkirim');
  assert.match(String(msg.content.caption || ''), /sewa/i);
});

test('_rent-guard: remove / tanpa author / bukan bot -> tidak ada kiriman', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-guard-'));
  const { conn, sent, config } = guardCtx({ dir });

  await rentGuard.onGroupParticipants(conn, { id: 'x', action: 'remove', participants: ['628999@s.whatsapp.net'], author: '628111@s.whatsapp.net' }, { groupMetadata: {}, config });
  assert.equal(sent.length, 0, 'action remove tidak boleh kirim');

  await rentGuard.onGroupParticipants(conn, { id: 'x', action: 'add', participants: ['628999@s.whatsapp.net'], author: '' }, { groupMetadata: {}, config });
  assert.equal(sent.length, 0, 'tanpa author tidak boleh kirim');

  await rentGuard.onGroupParticipants(conn, { id: 'x', action: 'add', participants: ['628888@s.whatsapp.net'], author: '628111@s.whatsapp.net' }, { groupMetadata: {}, config });
  assert.equal(sent.length, 0, 'bukan bot yang ditambahkan tidak boleh kirim');

  // fitur dimatikan
  const off = guardCtx({ dir, enabled: false });
  await rentGuard.onGroupParticipants(off.conn, { id: 'x', action: 'add', participants: ['628999@s.whatsapp.net'], author: '628111@s.whatsapp.net' }, { groupMetadata: {}, config: off.config });
  assert.equal(off.sent.length, 0, 'rent disabled tidak boleh kirim');
});