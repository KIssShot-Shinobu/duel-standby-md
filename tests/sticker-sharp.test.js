import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import {
  MAX_ANIMATED_STICKER_BYTES,
  MAX_STICKER_BYTES,
  hasFfmpeg,
  imageToWebp,
  loadSharp,
  stickerEncoder,
  videoToWebp,
} from '../lib/media.js';
import { sendImageResult } from '../lib/media-send.js';
import { smsg } from '../lib/serialize.js';
import { attachHelpers } from '../lib/simple.js';
import stickerPlugin from '../plugins/tools-sticker.js';

const FIXTURE_GIF = path.resolve(import.meta.dirname, 'fixtures', 'animated.gif');
const fixture = () => fs.readFileSync(FIXTURE_GIF);

/** PNG 256x256 dibuat dengan sharp (tanpa ffmpeg). */
const makePng = (size = 256) =>
  sharp({ create: { width: size, height: size, channels: 4, background: { r: 30, g: 120, b: 220, alpha: 1 } } })
    .png()
    .toBuffer();

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

const stubConn = () => {
  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (_chat, content) => {
      sent.push(content);
      return { key: { id: `M${sent.length}` } };
    },
  };
  return { conn, sent };
};

// ── Encoder ────────────────────────────────────────────────────────────────

test('stickerEncoder memakai sharp kalau terpasang (tanpa ffmpeg)', async () => {
  const loaded = await loadSharp();
  assert.ok(loaded, 'sharp harus bisa dimuat di repo ini');
  assert.equal(await stickerEncoder(), 'sharp');
});

test('imageToWebp mengubah PNG jadi WEBP 512 tanpa ffmpeg', async () => {
  const webp = await imageToWebp(await makePng());

  assert.equal(webp.subarray(8, 12).toString(), 'WEBP', 'bukan berkas WebP');
  const meta = await sharp(webp).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok(meta.width <= 512 && meta.height <= 512, `ukuran stiker ${meta.width}x${meta.height} melebihi 512`);
  assert.ok(webp.length <= MAX_STICKER_BYTES);
});

// ── GIF -> stiker animasi (inti perbaikan) ─────────────────────────────────

test('videoToWebp mengubah GIF menjadi WebP ANIMASI (sharp, tanpa ffmpeg)', async () => {
  const webp = await videoToWebp(fixture(), { seconds: 10, fps: 15 });

  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  const meta = await sharp(webp, { animated: true }).metadata();
  assert.ok((meta.pages || 1) > 1, `stiker GIF harus tetap bergerak (pages=${meta.pages})`);
  assert.ok(webp.length <= MAX_ANIMATED_STICKER_BYTES, `stiker ${(webp.length / 1024).toFixed(0)}KB melebihi target`);
});

test('videoToWebp menghormati batas durasi (jumlah frame)', async () => {
  const pendek = await videoToWebp(fixture(), { seconds: 0.2, fps: 5 });
  const meta = await sharp(pendek, { animated: true }).metadata();
  assert.ok(meta.pages <= 2, `frame harus dipangkas, dapat ${meta.pages}`);
});

// ── Plugin .sticker ────────────────────────────────────────────────────────

test('plugin .sticker membuat stiker ANIMASI dari GIF walau ffmpeg tidak ada', async () => {
  const { conn, sent } = stubConn();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-sticker-gif-'));
  attachHelpers(conn, {
    config: { media: { tmpDir, maxStickerSeconds: 10 }, bot: { packname: 'Uji', author: 'Bot' } },
    logger: quiet,
  });

  const gif = fixture();
  const m = smsg(conn, {
    key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'GIF1' },
    message: { documentMessage: { mimetype: 'image/gif', fileName: 'animasi.gif', fileLength: gif.length } },
    messageTimestamp: 1700000006,
    pushName: 'Tester',
  });
  m.download = async () => gif;

  await stickerPlugin(m, {
    conn,
    args: [],
    command: 'sticker',
    usedPrefix: '.',
    config: { bot: { packname: 'Uji', author: 'Bot' }, messages: { stickerWait: '...' }, media: { maxStickerSeconds: 10 } },
  });

  const sticker = sent.map((content) => content.sticker).find(Boolean);
  assert.ok(sticker, 'stiker tidak terkirim');
  assert.equal(sticker.subarray(8, 12).toString(), 'WEBP');
  const meta = await sharp(sticker, { animated: true }).metadata();
  assert.ok((meta.pages || 1) > 1, 'stiker hasil GIF harus bergerak');
  assert.equal(sticker.includes(Buffer.from('sticker-pack-name')), true, 'EXIF packname tidak tertanam');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('plugin .sticker menolak video kepanjangan SEBELUM cek encoder', async () => {
  const { conn } = stubConn();
  const m = smsg(conn, {
    key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'VID9' },
    message: { videoMessage: { mimetype: 'video/mp4', seconds: 45, fileLength: 9999 } },
    messageTimestamp: 1700000007,
  });
  m.download = async () => Buffer.alloc(2048);

  await assert.rejects(
    () =>
      stickerPlugin(m, {
        conn,
        args: [],
        command: 'sticker',
        usedPrefix: '.',
        config: { bot: { packname: 'Uji', author: 'Bot' }, messages: { stickerWait: '...' }, media: { maxStickerSeconds: 10 } },
      }),
    /terlalu panjang/i,
  );
});

// ── Pengiriman hasil (GIF WhatsApp) ────────────────────────────────────────

test('sendImageResult: PNG dikirim sebagai gambar', async () => {
  const { conn, sent } = stubConn();
  const mode = await sendImageResult(conn, 'chat', { buffer: await makePng(64), caption: 'halo' });

  assert.equal(mode, 'image');
  assert.equal(sent.length, 1);
  assert.ok(Buffer.isBuffer(sent[0].image));
  assert.equal(sent[0].caption, 'halo');
});

test('sendImageResult: GIF tetap bergerak (gifPlayback atau stiker animasi)', async () => {
  const { conn, sent } = stubConn();
  const mode = await sendImageResult(conn, 'chat', { buffer: fixture(), caption: '🔞 Danbooru', config: { bot: { packname: 'Uji', author: 'Bot' } } });

  if (hasFfmpeg()) {
    // ffmpeg ada: GIF WhatsApp (video + gifPlayback) dengan caption menempel
    assert.equal(mode, 'gif');
    assert.equal(sent[0].gifPlayback, true);
    assert.equal(sent[0].mimetype, 'video/mp4');
    assert.ok(Buffer.isBuffer(sent[0].video));
    assert.equal(sent[0].caption, '🔞 Danbooru');
  } else {
    // tanpa ffmpeg: stiker WebP animasi + caption dikirim terpisah (atribusi tetap ada)
    assert.equal(mode, 'sticker');
    const sticker = sent.map((content) => content.sticker).find(Boolean);
    assert.ok(sticker, 'stiker animasi tidak terkirim');
    const meta = await sharp(sticker, { animated: true }).metadata();
    assert.ok((meta.pages || 1) > 1, 'stiker harus bergerak');
    assert.equal(sent.map((content) => content.text).filter(Boolean).join(' '), '🔞 Danbooru');
  }
});
