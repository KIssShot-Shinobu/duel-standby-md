import test from 'node:test';
import assert from 'node:assert/strict';

import { addExif, hasFfmpeg, imageToWebp, runFfmpeg, toAudio, webpToPng } from '../lib/media.js';
import { smsg, extractText } from '../lib/serialize.js';

const ffmpeg = hasFfmpeg();

test('ffmpeg tersedia (kalau tidak ada, tes media dilewati)', (t) => {
  if (!ffmpeg) t.skip('ffmpeg tidak terpasang di mesin ini');
  else assert.equal(ffmpeg, true);
});

test('konversi gambar -> webp -> png + exif', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');

  const png = await runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
    null,
  );
  assert.ok(png.length > 0);

  const webp = await imageToWebp(png);
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');

  const withExif = await addExif(webp, { packname: 'Uji', author: 'Bot' });
  assert.equal(withExif.subarray(8, 12).toString(), 'WEBP');
  assert.ok(withExif.length >= webp.length);

  const back = await webpToPng(webp);
  assert.equal(back.subarray(1, 4).toString(), 'PNG');
});

test('konversi audio (wav -> mp3)', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  const wav = await runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'wav', 'pipe:1'],
    null,
  );
  const mp3 = await toAudio(wav);
  // Header ID3 atau frame sync MP3
  assert.ok(mp3.subarray(0, 3).toString() === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0));
});

test('smsg membuat objek m dari pesan teks', () => {
  const conn = { user: { id: '628999@s.whatsapp.net' } };
  const m = smsg(conn, {
    key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'X1' },
    message: { conversation: 'halo bot' },
    messageTimestamp: 1700000000,
    pushName: 'Tester',
  });

  assert.equal(m.chat, '628111@s.whatsapp.net');
  assert.equal(m.sender, '628111@s.whatsapp.net');
  assert.equal(m.text, 'halo bot');
  assert.equal(m.isGroup, false);
  assert.equal(m.mtype, 'conversation');
  assert.deepEqual(m.mentionedJid, []);
  assert.equal(typeof m.reply, 'function');
  assert.equal(smsg(conn, { key: {}, message: {} }), null);
});

test('smsg membuka ephemeralMessage & mendeteksi mention', () => {
  const conn = { user: { id: '628999@s.whatsapp.net' } };
  const m = smsg(conn, {
    key: { remoteJid: '123@g.us', participant: '628111:3@s.whatsapp.net', fromMe: false, id: 'X2' },
    message: {
      ephemeralMessage: {
        message: {
          extendedTextMessage: {
            text: 'hai @628222333444',
            contextInfo: { mentionedJid: ['628222333444@s.whatsapp.net'] },
          },
        },
      },
    },
    messageTimestamp: 1700000001,
    pushName: 'Grup User',
  });

  assert.equal(m.isGroup, true);
  assert.equal(m.sender, '628111@s.whatsapp.net');
  assert.equal(extractText({ ephemeralMessage: { message: { conversation: 'cek' } } }), 'cek');
  assert.deepEqual(m.mentionedJid, ['628222333444@s.whatsapp.net']);
});
