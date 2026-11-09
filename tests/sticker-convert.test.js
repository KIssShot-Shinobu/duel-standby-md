import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import handler from '../plugins/tools-sticker-convert.js';
import { hasFfmpeg, mp4VideoCodec, videoToWebp } from '../lib/media.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = { media: { maxUploadBytes: 64 * 1024 * 1024 } };

// PNG 1x1 — cukup untuk membuktikan input non-stiker ditolak.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** m tiruan: stiker yang di-reply. */
const quotedMessage = (buffer, mimetype = 'image/webp') => ({
  chat: '123@g.us',
  text: '.togif',
  quoted: { msg: { mimetype }, download: async () => buffer },
});

test('tanpa media -> pesan cara pakai', async () => {
  await assert.rejects(handler({ chat: 'x', text: '.togif' }, { conn: {}, command: 'togif', usedPrefix: '.', config }), /Tidak ada stiker/);
});

test('media non-stiker ditolak sebelum konversi', async () => {
  await assert.rejects(
    handler(quotedMessage(PNG_1PX, 'image/png'), { conn: {}, command: 'togif', usedPrefix: '.', config }),
    /bukan stiker/,
  );
});

test('.togif mengirim video dengan gifPlayback, .tomp4 tanpa gifPlayback', async (t) => {
  if (!hasFfmpeg()) return t.skip('ffmpeg tidak terpasang');

  const gif = fs.readFileSync(path.join(here, 'fixtures', 'animated.gif'));
  const sticker = await videoToWebp(gif, { seconds: 3 });

  const calls = [];
  const conn = { sendMessage: async (chat, content) => calls.push(content) };

  await handler(quotedMessage(sticker), { conn, command: 'togif', usedPrefix: '.', config });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].gifPlayback, true);
  assert.equal(mp4VideoCodec(calls[0].video), 'avc1');
  assert.match(calls[0].caption, /GIF/i);

  await handler(quotedMessage(sticker), { conn, command: 'tomp4', usedPrefix: '.', config });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].gifPlayback, undefined);
  assert.equal(mp4VideoCodec(calls[1].video), 'avc1');
  assert.match(calls[1].caption, /MP4/i);

  await handler(quotedMessage(sticker), { conn, command: 'topng', usedPrefix: '.', config });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].mimetype, 'image/png');
  assert.equal(calls[2].image.subarray(1, 4).toString(), 'PNG');
  assert.match(calls[2].caption, /PNG/i);

  await handler(quotedMessage(sticker), { conn, command: 'tojpg', usedPrefix: '.', config });
  assert.equal(calls.length, 4);
  assert.equal(calls[3].mimetype, 'image/jpeg');
  assert.equal(calls[3].image.subarray(0, 3).toString('hex'), 'ffd8ff');
  assert.match(calls[3].caption, /JPG/i);
});
