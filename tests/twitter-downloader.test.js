import test from 'node:test';
import assert from 'node:assert/strict';

import handler, { isTweetUrl } from '../plugins/downloader-twitter.js';

test('isTweetUrl menerima link status X/Twitter yang sah', () => {
  const valid = [
    'https://x.com/NASA/status/2110094874024219133',
    'https://twitter.com/user/status/1234567890',
    'https://mobile.twitter.com/user/statuses/1234567890',
    'http://x.com/i/status/1234567890/video/2',
    'https://www.x.com/user/status/1234567890?s=20&t=abc',
  ];
  for (const url of valid) assert.equal(isTweetUrl(url), true, `harus diterima: ${url}`);
});

test('isTweetUrl menolak profil, domain lain, dan status tanpa id angka', () => {
  const invalid = [
    'https://x.com/NASA',
    'https://tiktok.com/@user/video/123',
    'https://youtube.com/watch?v=abc',
    'https://x.com.evil.com/user/status/123',
    'https://x.com/user/status/abcdef',
    'https://x.com/user/status/',
    'bukan url',
    '',
  ];
  for (const url of invalid) assert.equal(isTweetUrl(url), false, `harus ditolak: ${url}`);
});

test('handler .x menolak link non-tweet tanpa memanggil jaringan', async () => {
  const replies = [];
  const m = { reply: async (text) => replies.push(text) };
  await handler(m, { text: 'https://tiktok.com/@user/video/1', usedPrefix: '.' });
  assert.equal(replies.length, 1);
  assert.match(replies[0], /bukan tweet/i);
});

test('handler .x memberi contoh pemakaian kalau tanpa link', async () => {
  const replies = [];
  const m = { reply: async (text) => replies.push(text) };
  await handler(m, { text: '', usedPrefix: '.' });
  assert.equal(replies.length, 1);
  assert.match(replies[0], /\.x https:\/\/x\.com\//);
});
