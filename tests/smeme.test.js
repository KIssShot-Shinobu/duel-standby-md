import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  drawMemeText,
  escapeDrawtext,
  hasDrawtext,
  hasFfmpeg,
  imageToWebp,
  resolveFont,
  resolveFont as resolveFontAlias,
  runFfmpeg,
  wrapMemeText,
} from '../lib/media.js';
import { pickMediaSource } from '../lib/media-source.js';
import { attachHelpers } from '../lib/simple.js';
import { smsg } from '../lib/serialize.js';
import smemePlugin from '../plugins/sticker-smeme.js';

const ffmpeg = hasFfmpeg();

const workDir = (prefix) => {
  const dir = path.join(process.cwd(), 'tmp', `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const makePng = (color = 'green', size = 256) =>
  runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}x${size}`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
    null,
  );

// ── Utilitas teks ──────────────────────────────────────────────────────────

test('wrapMemeText memecah teks panjang menjadi beberapa baris', () => {
  assert.deepEqual(wrapMemeText('GAME OVER', 20), ['GAME OVER']);
  assert.deepEqual(wrapMemeText('aku menyerah karena ini terlalu sulit', 12), [
    'aku menyerah',
    'karena ini',
    'terlalu sulit',
  ]);
  // maksimal 3 baris
  assert.ok(wrapMemeText('a b c d e f g h i j k l m n o p q r s t u', 4).length <= 3);
  assert.deepEqual(wrapMemeText('   ', 10), []);
});

test('escapeDrawtext meng-escape karakter khusus filtergraph', () => {
  assert.equal(escapeDrawtext("it's 100%: a,b;c[d]"), "it\\'s 100\\%\\: a\\,b\\;c\\[d\\]");
  assert.equal(escapeDrawtext('baris\nbaru'), 'baris baru');
  assert.equal(escapeDrawtext('back\\slash'), 'back\\\\slash');
});

test('resolveFont menemukan berkas font di sistem', () => {
  const font = resolveFont();
  assert.ok(font, 'tidak ada font yang terdeteksi — pasang fonts-dejavu-core atau set FFMPEG_FONT');
  assert.equal(fs.existsSync(font), true);
  assert.equal(resolveFontAlias(font), font);
});

// ── Render meme ────────────────────────────────────────────────────────────

test('drawMemeText menggambar teks (hasilnya beda dari gambar polos)', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  if (!hasDrawtext()) return t.skip('ffmpeg tanpa filter drawtext');

  const png = await makePng('green', 256);
  const plain = await runFfmpeg(
    [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black',
      '-frames:v', '1',
      '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
    ],
    png,
  );

  const meme = await drawMemeText(png, { top: 'GAME OVER', bottom: 'aku menyerah' });
  assert.equal(meme.subarray(1, 4).toString(), 'PNG', 'hasil harus PNG');
  assert.notDeepEqual(meme, plain, 'teks tidak tergambar (hasil identik dengan gambar polos)');
  assert.ok(meme.length > 0);

  // teks dengan karakter khusus tidak boleh merusak filtergraph
  const tricky = await drawMemeText(png, { top: "it's 50%: yes, no; [x]", bottom: '' });
  assert.equal(tricky.subarray(1, 4).toString(), 'PNG');
});

// ── Plugin .smeme ──────────────────────────────────────────────────────────

test('plugin .smeme mengirim stiker meme dari gambar', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  if (!hasDrawtext()) return t.skip('ffmpeg tanpa drawtext');

  const png = await makePng('blue', 256);
  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (_chat, content) => {
      sent.push(content);
      return { key: { id: `M${sent.length}` } };
    },
  };
  const dir = workDir('smeme');
  attachHelpers(conn, { config: { media: { tmpDir: dir, maxStickerSeconds: 10 }, bot: { packname: 'Uji', author: 'Bot' } } });
  const config = {
    bot: { packname: 'Uji', author: 'Bot', prefix: ['.'] },
    messages: { stickerWait: '...' },
    media: { maxStickerSeconds: 10, fontPath: '' },
  };

  const m = smsg(conn, {
    key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'SM1' },
    message: { imageMessage: { mimetype: 'image/jpeg', fileLength: png.length, caption: '.smeme atas|bawah' } },
    messageTimestamp: 1700000020,
    pushName: 'Tester',
  });
  m.download = async () => png;

  await smemePlugin(m, { conn, text: 'GAME OVER|aku menyerah', command: 'smeme', usedPrefix: '.', config });

  const sticker = sent.map((content) => content.sticker).find(Boolean);
  assert.ok(sticker, 'stiker meme tidak terkirim');
  assert.equal(sticker.subarray(8, 12).toString(), 'WEBP');
  assert.equal(sticker.includes(Buffer.from('sticker-pack-name')), true, 'EXIF packname tidak ada');

  // harus BEDA dengan stiker tanpa teks
  const plainSticker = await imageToWebp(png);
  assert.notDeepEqual(sticker, plainSticker, 'stiker meme identik dengan stiker biasa');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugin .smeme menolak kalau tidak ada gambar', async () => {
  await assert.rejects(
    smemePlugin(
      { chat: 'x', msg: {}, quoted: null, reply: async () => {} },
      { conn: {}, text: 'atas|bawah', command: 'smeme', usedPrefix: '.', config: { bot: {}, messages: {}, media: {} } },
    ),
    /Tidak ada gambar/i,
  );
});

test('plugin .smeme menolak kalau teks kosong', async () => {
  await assert.rejects(
    smemePlugin(
      { chat: 'x', msg: {}, quoted: null, reply: async () => {} },
      { conn: {}, text: '', command: 'smeme', usedPrefix: '.', config: { bot: {}, messages: {}, media: {} } },
    ),
    /Teks meme belum diisi/i,
  );
});

test('command .smeme menerima beberapa alias seperti di project aslinya', () => {
  for (const name of ['smeme', 'sme', 'stikermeme', 'stickermeme', 'stikerme', 'memesticker']) {
    assert.match(name, smemePlugin.command, `${name} tidak dikenali`);
  }
  assert.doesNotMatch('sticker', smemePlugin.command);
  assert.deepEqual(smemePlugin.help, ['smeme', 'stikermeme']);
});

test('pickMediaSource memilih reply lebih dulu daripada pesan sendiri', () => {
  const quoted = { msg: { mimetype: 'image/jpeg' }, download: async () => Buffer.from('q') };
  const own = { msg: { mimetype: 'image/png' }, download: async () => Buffer.from('o') };
  assert.equal(pickMediaSource({ quoted, msg: own.msg }, {}).kind, 'quoted');
  assert.equal(pickMediaSource({ quoted: null, msg: own.msg }, {}).kind, 'self');
  assert.equal(pickMediaSource({ quoted: null, msg: {} }, { args: ['https://x.test/a.png'] }).kind, 'url');
  assert.equal(pickMediaSource({ quoted: null, msg: {} }, {}), null);
});
