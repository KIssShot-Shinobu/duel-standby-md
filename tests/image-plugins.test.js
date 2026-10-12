import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import baseConfig from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { clearListCache } from '../lib/image-source.js';
import { setCategory } from '../lib/menu-config.js';
import { createGroupCache } from '../lib/permissions.js';
import { PluginManager } from '../lib/plugins.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');

/** fetch tiruan untuk plugin (plugin memakai globalThis.fetch). */
function stubFetch(routes, buffer = Buffer.from('gambar')) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, headers: options.headers || {} });
    if (target.includes('images.test')) {
      return { ok: true, status: 200, arrayBuffer: async () => buffer };
    }
    const match = Object.entries(routes).find(([needle]) => target.includes(needle));
    if (!match) return { ok: false, status: 404, text: async () => '{"error":"rute tidak dikenal"}' };
    return { ok: true, status: 200, text: async () => JSON.stringify(match[1]) };
  };
  return calls;
}

const DANBOORU = [
  {
    id: 42,
    rating: 'e',
    large_file_url: 'https://images.test/danbooru-42.jpg',
    tag_string_general: 'cat_ears',
    tag_string_artist: 'artist_x',
    tag_string_character: '',
    tag_string_copyright: '',
  },
];

const NEKOSBEST = {
  results: [{ url: 'https://images.test/neko-1.png', artist_name: 'Artist N', source_url: 'https://source.test/1' }],
};

const imageConfig = (overrides = {}) => ({
  images: {
    timeoutMs: 2000,
    limitPosts: 5,
    listTtlMs: 1000,
    cacheDir: '',
    maxBytes: 1024 * 1024,
    providers: { nsfw: ['danbooru'], sfw: ['nekosbest'] },
    blockedTags: undefined,
    ...overrides,
  },
});

/** Database palsu: hanya butuh chat(), touch(), dan save(). */
function makeDb({ nsfw = false } = {}) {
  const chats = {};
  return {
    data: { chats },
    chat(jid) {
      if (!chats[jid]) chats[jid] = { nsfw, updatedAt: 0 };
      return chats[jid];
    },
    touch() {
      this.touched = true;
    },
    async save() {
      return true;
    },
  };
}

function makeContext({ config = imageConfig(), nsfw = false, isGroup = true, isAdmin = false, isOwner = false, limit, limitCost = 0 } = {}) {
  const db = makeDb({ nsfw });
  const sent = [];
  const replies = [];
  const user = { jid: '628111@s.whatsapp.net', limit: limit ?? 20 };
  const conn = {
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}` } };
    },
  };
  const m = {
    chat: '123@g.us',
    sender: '628111@s.whatsapp.net',
    fromMe: false,
    isGroup,
    pushName: 'Tester',
    reply: async (text) => {
      replies.push(String(text));
      return { key: { id: 'R' } };
    },
  };
  return { conn, m, sent, replies, config, db, user, isAdmin, isOwner, limitCost };
}

// ── SFW ────────────────────────────────────────────────────────────────────

test('plugin .sfw mengirim gambar aman dengan atribusi artist', async () => {
  clearListCache();
  stubFetch({ 'nekos.best/api/v2': NEKOSBEST });
  const { default: sfwPlugin } = await import('../plugins/sfw-image.js');
  const ctx = makeContext();

  await sfwPlugin(ctx.m, { ...ctx, text: 'neko', usedPrefix: '.', command: 'sfw' });

  assert.equal(ctx.sent.length, 1);
  assert.match(ctx.sent[0].content.caption, /nekos\.best/);
  assert.match(ctx.sent[0].content.caption, /Artist N/);
  assert.doesNotMatch(ctx.sent[0].content.caption, /🔞/);
});

test('plugin .sfw memakai tag booru kalau bukan kategori', async () => {
  clearListCache();
  const calls = stubFetch({ 'danbooru.donmai.us': [{ ...DANBOORU[0], rating: 's', tag_string_general: 'cat_ears' }] });
  const { default: sfwPlugin } = await import('../plugins/sfw-image.js');
  const ctx = makeContext({ config: imageConfig({ providers: { nsfw: [], sfw: ['danbooru'] } }) });

  await sfwPlugin(ctx.m, { ...ctx, text: 'cat_ears', usedPrefix: '.', command: 'sfw' });

  assert.equal(ctx.sent.length, 1);
  assert.match(decodeURIComponent(calls[0].url), /rating:safe/);
});

test('plugin .sfwlist menampilkan kategori SFW', async () => {
  const { default: sfwPlugin } = await import('../plugins/sfw-image.js');
  const ctx = makeContext();

  await sfwPlugin(ctx.m, { ...ctx, text: '', usedPrefix: '.', command: 'sfwlist' });

  assert.match(ctx.replies.at(-1), /nekos\.best/);
  assert.match(ctx.replies.at(-1), /hug/);
});

test('plugin .sfw memberi pesan ramah saat semua provider gagal', async () => {
  clearListCache();
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '{"error":"down"}' });
  const { default: sfwPlugin } = await import('../plugins/sfw-image.js');
  const ctx = makeContext();

  await assert.rejects(() => sfwPlugin(ctx.m, { ...ctx, text: '', usedPrefix: '.', command: 'sfw' }), /Gagal mengambil gambar/i);
  assert.equal(ctx.sent.length, 0);
});

// ── NSFW: gerbang per grup ─────────────────────────────────────────────────

test('plugin .nsfw terkunci selama grup belum menyalakannya', async () => {
  clearListCache();
  const calls = stubFetch({ 'danbooru.donmai.us': DANBOORU });
  const { default: nsfwPlugin } = await import('../plugins/nsfw-image.js');
  const ctx = makeContext({ nsfw: false, isGroup: true });

  await assert.rejects(() => nsfwPlugin(ctx.m, { ...ctx, text: '', usedPrefix: '.', command: 'nsfw' }), /belum diaktifkan/i);
  assert.equal(calls.length, 0, 'tidak boleh memanggil API saat terkunci');
  assert.equal(ctx.sent.length, 0);
});

test('plugin .nsfw mengirim gambar setelah grup diaktifkan', async () => {
  clearListCache();
  const calls = stubFetch({ 'danbooru.donmai.us': DANBOORU });
  const { default: nsfwPlugin } = await import('../plugins/nsfw-image.js');
  const ctx = makeContext({ nsfw: true, isGroup: true });

  const id = await nsfwPlugin(ctx.m, { ...ctx, text: '', usedPrefix: '.', command: 'nsfw' });

  assert.equal(id, 'danbooru:42');
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].content.image.toString(), 'gambar');
  assert.match(ctx.sent[0].content.caption, /Danbooru/);
  assert.match(ctx.sent[0].content.caption, /🔞/);
  assert.match(decodeURIComponent(calls[0].url), /rating:explicit/);
});

test('plugin .nsfw on: admin grup boleh, member biasa tidak', async () => {
  const { default: nsfwPlugin } = await import('../plugins/nsfw-image.js');

  const admin = makeContext({ nsfw: false, isGroup: true, isAdmin: true, limit: 9, limitCost: 1 });
  await nsfwPlugin(admin.m, { ...admin, text: 'on', usedPrefix: '.', command: 'nsfw' });
  assert.equal(admin.db.chat('123@g.us').nsfw, true, 'flag grup harus tersimpan');
  assert.match(admin.replies.at(-1), /diaktifkan/i);
  assert.equal(admin.user.limit, 10, 'limit dikembalikan karena on/off tidak mengirim gambar');

  const member = makeContext({ nsfw: false, isGroup: true, isAdmin: false });
  await assert.rejects(() => nsfwPlugin(member.m, { ...member, text: 'on', usedPrefix: '.', command: 'nsfw' }), /admin grup/i);
  assert.equal(member.db.chat('123@g.us').nsfw, false, 'member biasa tidak boleh mengubah');
});

test('plugin .nsfw off mematikan kembali grup', async () => {
  const { default: nsfwPlugin } = await import('../plugins/nsfw-image.js');
  const ctx = makeContext({ nsfw: true, isGroup: true, isAdmin: true });

  await nsfwPlugin(ctx.m, { ...ctx, text: 'off', usedPrefix: '.', command: 'nsfw' });

  assert.equal(ctx.db.chat('123@g.us').nsfw, false);
  assert.match(ctx.replies.at(-1), /dimatikan/i);
});

test('plugin .nsfw on di chat pribadi hanya untuk owner', async () => {
  const { default: nsfwPlugin } = await import('../plugins/nsfw-image.js');

  const user = makeContext({ nsfw: false, isGroup: false, isOwner: false });
  await assert.rejects(() => nsfwPlugin(user.m, { ...user, text: 'on', usedPrefix: '.', command: 'nsfw' }), /chat pribadi/i);

  const owner = makeContext({ nsfw: false, isGroup: false, isOwner: true });
  await nsfwPlugin(owner.m, { ...owner, text: 'on', usedPrefix: '.', command: 'nsfw' });
  assert.equal(owner.db.chat('123@g.us').nsfw, true);
});

test('plugin .nsfwstatus menampilkan status global & grup (gratis limit)', async () => {
  const { default: nsfwPlugin } = await import('../plugins/nsfw-image.js');
  const ctx = makeContext({ nsfw: true, isGroup: true, limit: 19, limitCost: 1 });

  await nsfwPlugin(ctx.m, { ...ctx, text: '', usedPrefix: '.', command: 'nsfwstatus' });

  assert.match(ctx.replies.at(-1), /STATUS FITUR 18\+/);
  assert.match(ctx.replies.at(-1), /Grup ini/);
  assert.equal(ctx.user.limit, 20, 'status tidak boleh memotong limit');
});

test('plugin .nsfw menolak tag terlarang tanpa memanggil API', async () => {
  clearListCache();
  const calls = stubFetch({ 'danbooru.donmai.us': DANBOORU });
  const { default: nsfwPlugin } = await import('../plugins/nsfw-image.js');
  const ctx = makeContext({ nsfw: true, isGroup: true, limit: 19, limitCost: 1 });

  await assert.rejects(() => nsfwPlugin(ctx.m, { ...ctx, text: 'loli cat_ears', usedPrefix: '.', command: 'nsfw' }), /tidak diizinkan/i);
  assert.equal(calls.length, 0);
  assert.equal(ctx.user.limit, 20, 'limit dikembalikan saat request dibatalkan');
});

// ── End-to-end lewat handler (termasuk gating kategori) ────────────────────

async function e2eSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-image-e2e-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}` } };
    },
    readMessages: async () => [],
    groupMetadata: async (chat) => ({
      subject: 'Grup Uji',
      participants:
        chat === 'admin@g.us'
          ? [{ id: '628111@s.whatsapp.net', admin: 'admin' }, { id: '628222@s.whatsapp.net' }]
          : [{ id: '628111@s.whatsapp.net' }, { id: '628222@s.whatsapp.net' }],
    }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };
  const msg = (body, chat, sender = '628111@s.whatsapp.net') => ({
    key: { remoteJid: chat, fromMe: false, id: `X${Math.random().toString(36).slice(2, 7)}`, participant: sender },
    message: { conversation: body },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Tester',
  });
  const config = { ...baseConfig, images: { ...baseConfig.images, cacheDir: '' } };
  return { db, plugins, conn, sent, msg, config, dir, groupCache: createGroupCache(60) };
}

const textsOf = (sent) => sent.map((item) => item.content?.text || item.content?.caption || '').join('\n');

test('E2E: kategori NSFW dimatikan owner -> toggle tetap dijawab, gambar ditolak', async () => {
  clearListCache();
  const calls = stubFetch({ 'danbooru.donmai.us': DANBOORU });
  const { db, plugins, conn, sent, msg, config, dir, groupCache } = await e2eSetup();
  setCategory(db, 'nsfw', { enabled: false });

  // master switch mati, tapi admin grup tetap dapat balasan (plugin adultExempt)
  const on = await handleMessage(conn, msg('.nsfw on', 'admin@g.us'), { plugins, db, config, logger: quiet, groupCache });
  assert.equal(on.handled, true, 'admin grup tidak boleh diabaikan diam-diam');
  assert.match(textsOf(sent), /dimatikan owner/i);
  assert.equal(db.chat('admin@g.us').nsfw, true, 'flag grup tetap bisa disetel');

  // gambar tetap diblokir selama kategori mati
  const blocked = await handleMessage(conn, msg('.nsfw', 'admin@g.us'), { plugins, db, config, logger: quiet, groupCache });
  assert.equal(blocked.handled, false);
  assert.match(textsOf(sent), /dimatikan owner bot/i);
  assert.equal(calls.length, 0, 'tidak boleh memanggil API saat kategori mati');
  assert.equal(sent.filter((item) => item.content?.image).length, 0);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('E2E: admin grup tetap dikenali walau daftar peserta memakai LID', async () => {
  clearListCache();
  stubFetch({ 'danbooru.donmai.us': DANBOORU });
  const { db, plugins, conn, sent, config, dir, groupCache } = await e2eSetup();
  setCategory(db, 'nsfw', { enabled: true });
  // WhatsApp memakai LID di daftar peserta, pengirim terbaca sebagai nomor telepon
  conn.groupMetadata = async () => ({
    subject: 'Grup LID',
    participants: [{ id: '271446714642565@lid', admin: 'admin' }],
  });

  const raw = {
    key: {
      remoteJid: 'admin@g.us',
      fromMe: false,
      id: 'LID1',
      participant: '271446714642565@lid',
      participantAlt: '628111@s.whatsapp.net',
    },
    message: { conversation: '.nsfw on' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Admin LID',
  };
  const result = await handleMessage(conn, raw, { plugins, db, config, logger: quiet, groupCache });

  assert.equal(result.handled, true, `admin ber-LID tidak dikenali (${result.reason || 'ok'})`);
  assert.match(textsOf(sent), /diaktifkan/i);
  assert.equal(db.chat('admin@g.us').nsfw, true);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('E2E: admin menyalakan grup, grup lain tetap terkunci', async () => {
  clearListCache();
  stubFetch({ 'danbooru.donmai.us': DANBOORU });
  const { db, plugins, conn, sent, msg, config, dir, groupCache } = await e2eSetup();
  setCategory(db, 'nsfw', { enabled: true });

  // admin grup menyalakan fitur di grupnya
  const on = await handleMessage(conn, msg('.nsfw on', 'admin@g.us'), { plugins, db, config, logger: quiet, groupCache });
  assert.equal(on.handled, true);
  assert.match(textsOf(sent), /diaktifkan/i);
  assert.equal(db.chat('admin@g.us').nsfw, true);

  // member biasa di grup yang sama tetap bisa memakainya
  await handleMessage(conn, msg('.nsfw', 'admin@g.us', '628222@s.whatsapp.net'), { plugins, db, config, logger: quiet, groupCache });
  assert.equal(sent.filter((item) => item.content?.image).length, 1, 'gambar terkirim di grup yang sudah opt-in');

  // grup lain belum menyetujui -> ditolak, tanpa gambar
  const locked = await handleMessage(conn, msg('.nsfw', 'lain@g.us'), { plugins, db, config, logger: quiet, groupCache });
  assert.equal(locked.handled, false);
  assert.match(textsOf(sent), /belum diaktifkan di chat ini/i);
  assert.equal(sent.filter((item) => item.content?.image).length, 1, 'tidak ada gambar tambahan');

  // member biasa tidak boleh menyalakan grup
  await handleMessage(conn, msg('.nsfw on', 'lain@g.us', '628222@s.whatsapp.net'), { plugins, db, config, logger: quiet, groupCache });
  assert.equal(db.chat('lain@g.us').nsfw, false);
  assert.match(textsOf(sent), /admin grup/i);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
