import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../config.js';
import { handleMessage, parseCommand } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-handler-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net', name: 'Bot Uji' },
    sendMessage: async (chat, content, opts) => {
      sent.push({ chat, content, opts });
      return { key: { id: `MSG${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  return { dir, db, plugins, conn, sent };
}

const textMsg = (text, chat = '628111@s.whatsapp.net', extra = {}) => ({
  key: {
    remoteJid: chat,
    fromMe: false,
    id: `IN-${Math.random().toString(36).slice(2, 8)}`,
    ...(chat.endsWith('@g.us') ? { participant: '628111@s.whatsapp.net' } : {}),
  },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Tester',
  ...extra,
});

const lastText = (sent) => {
  const last = sent.at(-1);
  return last?.content?.text || '';
};

test('parseCommand memisahkan prefix, command, dan argumen', () => {
  assert.deepEqual(parseCommand('.calc 1+1', ['.']), { usedPrefix: '.', command: 'calc', text: '1+1', args: ['1+1'] });
  assert.equal(parseCommand('halo', ['.']), null);
  assert.equal(parseCommand('.', ['.']), null);
});

test('command berjalan end-to-end (.calc 2+3)', async () => {
  const { db, plugins, conn, sent } = await setup();
  const result = await handleMessage(conn, textMsg('.calc 2+3'), { plugins, db, config, logger: quiet });

  assert.equal(result.handled, true);
  assert.equal(result.plugin, 'tools-calc.js');
  assert.match(lastText(sent), /=\s*5/);
  db.close();
});

test('menu menampilkan kategori dari semua plugin', async () => {
  const { db, plugins, conn, sent } = await setup();
  await handleMessage(conn, textMsg('.menu'), { plugins, db, config, logger: quiet });

  const menu = lastText(sent);
  assert.match(menu, /MAIN/);
  assert.match(menu, /TOOLS/);
  assert.match(menu, /DOWNLOADER/);
  assert.ok(menu.length > 300, 'menu terlalu pendek');
  db.close();
});

test('plugin owner ditolak untuk non-owner', async () => {
  const { db, plugins, conn, sent } = await setup();
  const before = config.bot.mode;
  const result = await handleMessage(conn, textMsg('.mode self'), { plugins, db, config, logger: quiet });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'need-owner');
  assert.match(lastText(sent), /khusus owner/i);
  assert.equal(config.bot.mode, before, 'mode tidak boleh berubah');
  db.close();
});

test('limit dipotong untuk plugin berlimit', async () => {
  const { db, plugins, conn } = await setup();
  const sender = '628111@s.whatsapp.net';
  db.user(sender).lastLimitReset = Date.now();
  db.user(sender).limit = 5;

  await handleMessage(conn, textMsg('.yts lagu uji'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).limit, 4);

  // limit habis -> ditolak
  db.user(sender).limit = 0;
  const denied = await handleMessage(conn, textMsg('.yts lagu uji'), { plugins, db, config, logger: quiet });
  assert.equal(denied.reason, 'no-limit');
  db.close();
});

test('hook before berjalan: AFK aktif lalu dibatalkan saat kirim pesan', async () => {
  const { db, plugins, conn, sent } = await setup();
  const sender = '628111@s.whatsapp.net';

  await handleMessage(conn, textMsg('.afk rapat'), { plugins, db, config, logger: quiet });
  assert.ok(db.user(sender).afk > 0);

  await handleMessage(conn, textMsg('halo semua'), { plugins, db, config, logger: quiet });
  assert.equal(db.user(sender).afk, -1);
  assert.match(sent.map((item) => item.content?.text || '').join('\n'), /kembali/i);
  db.close();
});

test('anti-link tidak mengganggu pesan grup biasa', async () => {
  const { db, plugins, conn } = await setup();
  const result = await handleMessage(conn, textMsg('pagi semua', '123@g.us'), { plugins, db, config, logger: quiet });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'no-plugin');
  assert.equal(db.data.stats.messages, 1);
  db.close();
});

test('pesan tanpa konten nyata (protocolMessage) diabaikan', async () => {
  const { db, plugins, conn } = await setup();
  const protocolOnly = {
    key: { remoteJid: '80144945410195@lid', fromMe: false, id: 'P1', participant: '80144945410195@lid' },
    message: { protocolMessage: { type: 6, key: { id: 'X' } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
  const result = await handleMessage(conn, protocolOnly, { plugins, db, config, logger: quiet });
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'no-content');

  // senderKeyDistributionMessage + teks asli tetap harus diproses
  const withText = {
    key: { remoteJid: '123@g.us', fromMe: false, id: 'P2', participant: '271446714642565@lid', participantPn: '628111222333@s.whatsapp.net' },
    message: { senderKeyDistributionMessage: { groupId: 'x' }, conversation: '.calc 3*3' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'LID User',
  };
  const ok = await handleMessage(conn, withText, { plugins, db, config, logger: quiet });
  assert.equal(ok.handled, true);
  // pengirim sudah dikonversi ke nomor telepon, bukan LID
  assert.ok(db.data.users['628111222333@s.whatsapp.net']);
  db.close();
});

test('pesan ber-LID dengan participantAlt: premium/limit nomor telepon tetap terpakai', async () => {
  const { db, plugins, conn, sent } = await setup();
  const lid = '271446714642565@lid';
  const pn = '628111222333@s.whatsapp.net';

  // Owner sudah memberi premium + limit ke NOMOR tersebut.
  const granted = db.user(pn);
  granted.premium = true;
  granted.premiumUntil = Date.now() + 30 * 86400000;
  granted.limitBonus = 10;
  granted.limit = config.limits.premium + 10;

  // WhatsApp mengirim `participant` = LID dan `participantAlt` = nomor telepon.
  const raw = {
    key: { remoteJid: '123@g.us', fromMe: false, id: 'ALT1', participant: lid, participantAlt: pn },
    message: { conversation: '.profile' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'LID User',
  };
  const result = await handleMessage(conn, raw, { plugins, db, config, logger: quiet });
  assert.equal(result.handled, true);

  // pemetaan LID -> nomor telepon harus dipelajari dari participantAlt
  assert.equal(db.data.lidMap[lid], pn, 'pemetaan LID tidak tersimpan');
  assert.equal(db.data.users[lid], undefined, 'tidak boleh ada record LID terpisah');

  const body = sent.map((item) => item.content?.text || '').join('\n');
  assert.match(body, /Premium: Ya/, 'premium yang diberikan owner harus terlihat di .profile');
  assert.match(body, new RegExp(`Limit: ${config.limits.premium + 10}/`), 'limit harus menampilkan pemberian owner');
  assert.match(body, /\+10 bonus/);
  db.close();
});

test('chat grup: identitas dari daftar peserta (lid+phoneNumber) dipakai', async () => {
  // Di grup, WA sering mengirim `key.participant` = LID saja tanpa participantPn
  // maupun participantAlt, jadi nomor teleponnya tidak ada di pesan. Yang
  // satu-satunya sumber pasangan LID <-> nomor adalah daftar peserta grup
  // (`{ lid, phoneNumber }`). Kalau itu tidak dipakai untuk memetakan LID,
  // user tetap punya record terpisah dari record yang diedit owner.
  const { db, plugins, conn, sent } = await setup();
  const lid = '271446714642565@lid';
  const pn = '628111222333@s.whatsapp.net';

  const granted = db.user(pn);
  granted.premium = true;
  granted.premiumUntil = Date.now() + 30 * 86400000;
  granted.limitBonus = 10;
  granted.limit = config.limits.premium + 10;

  conn.groupMetadata = async () => ({
    subject: 'Grup Uji',
    participants: [{ id: lid, lid, phoneNumber: pn, admin: null }],
  });

  const raw = {
    key: { remoteJid: '123@g.us', fromMe: false, id: 'LIDGRP1', participant: lid },
    message: { conversation: '.profile' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'LID User',
  };
  const result = await handleMessage(conn, raw, { plugins, db, config, logger: quiet });
  assert.equal(result.handled, true);

  assert.equal(db.data.users[lid], undefined, 'tidak boleh ada record LID terpisah');
  assert.equal(db.data.lidMap[lid], pn, 'pemetaan harus diambil dari daftar peserta grup');

  const body = sent.map((item) => item.content?.text || '').join('\n');
  assert.match(body, /Premium: Ya/, 'premium yang diberikan owner harus terlihat di .profile');
  assert.match(body, new RegExp(`Limit: ${config.limits.premium + 10}/`));
  db.close();
});

test('chat pribadi ber-LID: premium/limit nomor telepon tetap terpakai', async () => {
  // Regresi: di chat pribadi WA baru, `key.remoteJid` = nomor telepon dan
  // `key.remoteJidAlt` = LID. Kalau hanya remoteJidAlt yang dipakai untuk
  // menentukan pengirim, user tercatat di record LID terpisah sehingga premium
  // yang diberikan owner lewat nomor telepon tidak terlihat saat dia `.profile`.
  const { db, plugins, conn, sent } = await setup();
  const lid = '271446714642565@lid';
  const pn = '628111222333@s.whatsapp.net';

  // Owner sudah memberi premium + limit ke NOMOR tersebut.
  const granted = db.user(pn);
  granted.premium = true;
  granted.premiumUntil = Date.now() + 30 * 86400000;
  granted.limitBonus = 10;
  granted.limit = config.limits.premium + 10;

  const raw = {
    key: { remoteJid: pn, remoteJidAlt: lid, fromMe: false, id: 'LIDPRIV1' },
    message: { conversation: '.profile' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'LID User',
  };
  const result = await handleMessage(conn, raw, { plugins, db, config, logger: quiet });
  assert.equal(result.handled, true);

  assert.equal(db.data.users[lid], undefined, 'tidak boleh ada record LID terpisah');
  assert.equal(db.data.lidMap[lid], pn, 'pemetaan LID -> nomor telepon harus tersimpan');

  const body = sent.map((item) => item.content?.text || '').join('\n');
  assert.match(body, /Premium: Ya/, 'premium yang diberikan owner harus terlihat di .profile');
  assert.match(body, new RegExp(`Limit: ${config.limits.premium + 10}/`), 'limit harus menampilkan pemberian owner');
  assert.match(body, /\+10 bonus/);
  db.close();
});

test('ctx.wait() mengirim pesan tunggu lalu bisa mengeditnya', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-wait-plugins-'));
  fs.writeFileSync(
    path.join(dir, 'x-wait.js'),
    `const handler = async (m, { wait }) => {
  const update = await wait();
  if (typeof update !== 'function') throw 'wait() tidak mengembalikan fungsi';
  await update('selesai diproses');
};
handler.help = ['w'];
handler.tags = ['test'];
handler.command = /^(w)$/i;
export default handler;`,
  );

  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-wait-db-'));
  const db = new Database(path.join(dbDir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();
  const plugins = new PluginManager(dir, { logger: quiet });
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
  };

  const result = await handleMessage(
    conn,
    {
      key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'W1' },
      message: { conversation: '.w' },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: 'Tester',
    },
    { plugins, db, config, logger: quiet },
  );

  assert.equal(result.handled, true);
  assert.ok(
    sent.some((item) => item.content.text === config.messages.wait),
    'pesan tunggu tidak terkirim',
  );
  const edited = sent.find((item) => item.content.text === 'selesai diproses');
  assert.ok(edited, 'pesan tunggu tidak diedit');
  assert.ok(edited.content.edit, 'edit() harus memakai key pesan tunggu');
  db.close();
});

test('pesan dari chat yang di-mute diabaikan', async () => {
  const { db, plugins, conn } = await setup();
  db.chat('123@g.us').mute = true;
  const result = await handleMessage(conn, textMsg('.ping', '123@g.us'), { plugins, db, config, logger: quiet });

  assert.equal(result.reason, 'muted');
  db.close();
});

test('pesan tidak valid / newsletter dilewati', async () => {
  const { db, plugins, conn } = await setup();
  assert.equal((await handleMessage(conn, { key: {} }, { plugins, db, config, logger: quiet })).handled, false);

  const newsletter = textMsg('halo', '123@newsletter');
  assert.equal((await handleMessage(conn, newsletter, { plugins, db, config, logger: quiet })).reason, 'skipped-chat');

  const status = textMsg('halo', 'status@broadcast');
  assert.equal((await handleMessage(conn, status, { plugins, db, config, logger: quiet })).reason, 'skipped-chat');
  db.close();
});
