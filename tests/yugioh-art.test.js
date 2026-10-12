import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock fetch: cardinfo (JSON) + gambar (biner). Dipasang sebelum klien dibuat.
const calls = [];
const CARD = {
  id: 46986414,
  name: 'Dark Magician',
  card_images: [
    { id: 46986414, image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg', image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/46986414.jpg' },
    { id: 46986415, image_url: 'https://images.ygoprodeck.com/images/cards/46986415.jpg' },
  ],
};
const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

globalThis.fetch = async (url) => {
  const target = String(url);
  calls.push(target);
  if (target.includes('images.ygoprodeck.com')) {
    return { ok: true, status: 200, arrayBuffer: async () => TINY_JPEG };
  }
  if (target.includes('cardinfo.php')) {
    const query = new URL(target).searchParams;
    const name = query.get('name') || '';
    const fname = query.get('fname') || '';
    const id = query.get('id') || '';
    if (id) {
      return id === String(CARD.id)
        ? { ok: true, status: 200, text: async () => JSON.stringify({ data: [CARD] }) }
        : { ok: false, status: 400, text: async () => JSON.stringify({ error: 'No card matching your query was found in the database.' }) };
    }
    if (name && name.toLowerCase() !== 'dark magician') {
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'No card matching your query was found in the database.' }) };
    }
    if (name) return { ok: true, status: 200, text: async () => JSON.stringify({ data: [CARD] }) };
    if (fname) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ data: [{ ...CARD, name: 'Dark Magician Girl' }, { ...CARD, name: 'Dark Magician Knight' }] }),
      };
    }
  }
  return { ok: false, status: 404, text: async () => JSON.stringify({ error: 'tidak diharapkan' }) };
};

const { downloadCardImage } = await import('../lib/ygoprodeck.js');
const { default: cardArt } = await import('../plugins/game-yugioh-art.js');

const makeCtx = ({ emitReplies = true } = {}) => {
  const sent = [];
  const replies = [];
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-cardcache-'));
  const conn = {
    sendMessage: async (chat, content, options) => {
      sent.push({ chat, content, options });
      return { key: { id: `M${sent.length}` } };
    },
  };
  const config = {
    root: '/tmp',
    ygoprodeck: { imageCacheDir: null, imageCacheMax: 10, cacheFile: false },
  };
  const m = {
    chat: '628111@s.whatsapp.net',
    reply: async (value) => {
      if (emitReplies) replies.push(String(value));
      return { key: { id: `R${replies.length}` } };
    },
  };
  return { sent, replies, conn, m, config, cacheDir };
};

test('downloadCardImage menyimpan ke cache dan memakai ulang hasil cache', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-imgcache-'));
  const before = calls.filter((url) => url.includes('images.ygoprodeck.com')).length;

  const first = await downloadCardImage(CARD, { cacheDir: dir });
  assert.deepEqual(first, TINY_JPEG);
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(calls.filter((url) => url.includes('images.ygoprodeck.com')).length, before + 1);

  const second = await downloadCardImage(CARD, { cacheDir: dir });
  assert.deepEqual(second, TINY_JPEG);
  assert.equal(
    calls.filter((url) => url.includes('images.ygoprodeck.com')).length,
    before + 1,
    'unduhan kedua harus diambil dari cache',
  );

  // artwork alternatif -> berkas cache berbeda
  const alt = await downloadCardImage(CARD, { cacheDir: dir, variant: 1 });
  assert.deepEqual(alt, TINY_JPEG);
  assert.equal(fs.readdirSync(dir).length, 2);

  // tanpa gambar
  assert.equal(await downloadCardImage({ card_images: [] }, { cacheDir: dir }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.card mengirim HANYA gambar (tanpa caption/teks/quote)', async () => {
  const ctx = makeCtx();
  await cardArt(ctx.m, { conn: ctx.conn, text: 'Dark Magician', config: ctx.config, usedPrefix: '.', command: 'card' });

  assert.equal(ctx.sent.length, 1, 'harus tepat 1 pesan');
  const message = ctx.sent[0];
  assert.deepEqual(Object.keys(message.content), ['image'], 'isi pesan hanya boleh field image');
  assert.ok(Buffer.isBuffer(message.content.image));
  assert.equal(message.content.caption, undefined, 'caption tidak boleh ada');
  assert.deepEqual(message.options, {}, 'tidak boleh ada options (quoted dll.)');
  assert.equal(ctx.replies.length, 0, 'tidak boleh ada pesan teks tambahan');
});

test('.card mendukung passcode dan artwork alternatif', async () => {
  const ctx = makeCtx();
  await cardArt(ctx.m, { conn: ctx.conn, text: '46986414', config: ctx.config, usedPrefix: '.', command: 'card' });
  assert.equal(ctx.sent.length, 1);
  assert.ok(calls.some((url) => url.includes('cardinfo.php?id=46986414')));

  const alt = makeCtx();
  await cardArt(alt.m, { conn: alt.conn, text: 'Dark Magician 2', config: alt.config, usedPrefix: '.', command: 'card' });
  assert.equal(alt.sent.length, 1);
  assert.ok(calls.some((url) => url.includes('/cards/46986415.jpg')), 'artwork ke-2 harus dipakai');
});

test('.card: nama ambigu -> daftar nama polos, tanpa gambar', async () => {
  const ctx = makeCtx();
  await cardArt(ctx.m, { conn: ctx.conn, text: 'Dark Magician G', config: ctx.config, usedPrefix: '.', command: 'card' });

  assert.equal(ctx.sent.length, 0, 'tidak boleh mengirim gambar saat ambigu');
  assert.equal(ctx.replies.length, 1);
  assert.equal(ctx.replies[0], 'Dark Magician Girl\nDark Magician Knight');
});

test('.card tanpa argumen memberi format singkat', async () => {
  const ctx = makeCtx();
  await cardArt(ctx.m, { conn: ctx.conn, text: '', config: ctx.config, usedPrefix: '.', command: 'card' });

  assert.equal(ctx.sent.length, 0);
  assert.match(ctx.replies[0], /^Format: \.card <nama kartu \| passcode>/);
});
