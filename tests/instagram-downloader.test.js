import test from 'node:test';
import assert from 'node:assert/strict';

import handler, { instagramShortcode, isInstagramUrl } from '../plugins/downloader-instagram.js';

test('isInstagramUrl menerima link post/reel/tv/share Instagram', () => {
  const valid = [
    'https://www.instagram.com/p/CxYz123AbCd/',
    'https://instagram.com/reel/CxYz123AbCd/',
    'https://www.instagram.com/reels/CxYz123AbCd/',
    'https://www.instagram.com/tv/CxYz123AbCd/',
    'https://m.instagram.com/share/BAbCdEfGh',
    'http://instagr.am/p/CxYz123AbCd/',
  ];
  for (const url of valid) assert.equal(isInstagramUrl(url), true, `harus diterima: ${url}`);
});

test('isInstagramUrl menolak profil, stories, domain lain, dan link kosong', () => {
  const invalid = [
    'https://www.instagram.com/username/',
    'https://www.instagram.com/stories/username/123',
    'https://www.instagram.com/p/',
    'https://instagram.com.evil.com/p/CxYz123AbCd/',
    'https://tiktok.com/@user/video/123',
    'bukan url',
    '',
  ];
  for (const url of invalid) assert.equal(isInstagramUrl(url), false, `harus ditolak: ${url}`);
});

test('handler .ig menolak link non-Instagram tanpa memanggil jaringan', async () => {
  const replies = [];
  const m = { reply: async (text) => replies.push(text) };
  await handler(m, { text: 'https://tiktok.com/@user/video/1', usedPrefix: '.' });
  assert.equal(replies.length, 1);
  assert.match(replies[0], /bukan post Instagram/i);
});

test('handler .ig memberi contoh pemakaian kalau tanpa link', async () => {
  const replies = [];
  const m = { reply: async (text) => replies.push(text) };
  await handler(m, { text: '', usedPrefix: '.', command: 'ig' });
  assert.equal(replies.length, 1);
  assert.match(replies[0], /\.ig https:\/\/www\.instagram\.com\/p\//);
});

test('instagramShortcode mengambil jenis dan kode post', () => {
  assert.deepEqual(instagramShortcode('https://www.instagram.com/p/DfPXOhAEmTf/?obrf=MXd5'), {
    kind: 'p',
    code: 'DfPXOhAEmTf',
  });
  assert.deepEqual(instagramShortcode('https://instagram.com/reel/CxYz123AbCd/'), { kind: 'reel', code: 'CxYz123AbCd' });
  assert.equal(instagramShortcode('https://www.instagram.com/username/'), null);
});

test('handler .ig memakai jalur foto publik saat yt-dlp ditolak Instagram', async () => {
  const realFetch = globalThis.fetch;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03]);
  globalThis.fetch = async (url) =>
    String(url).includes('oembed')
      ? new Response(JSON.stringify({ title: 'Halo dunia', author_name: 'budi' }), { status: 200 })
      : new Response(jpeg, { status: 200 });

  try {
    const calls = [];
    const conn = { sendImage: async (chat, buffer, caption) => calls.push({ chat, buffer, caption }) };
    const config = {
      ytdlp: { path: 'ytdlp-tidak-ada-di-mesin-ini', maxHeight: 720, maxDurationSeconds: 0 },
      media: { maxUploadBytes: 5_000_000 },
    };
    const m = { chat: 'grup@g.us', reply: async () => {} };

    await handler(m, {
      conn,
      text: 'https://www.instagram.com/p/DfPXOhAEmTf/?obrf=MXd5MGs4azU3djIwMA==',
      config,
      usedPrefix: '.',
      command: 'ig',
      wait: async () => async () => {},
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].buffer[0], 0xff);
    assert.match(calls[0].caption, /Instagram/);
    assert.match(calls[0].caption, /budi/);
    assert.match(calls[0].caption, /Halo dunia/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
