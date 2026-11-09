import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { attachHelpers } from '../lib/simple.js';
import {
  addExif,
  detectMediaKind,
  ffmpegInstallHint,
  hasFfmpeg,
  imageToWebp,
  isAnimatedWebp,
  isGif,
  MAX_ANIMATED_STICKER_BYTES,
  MAX_STICKER_BYTES,
  mp4VideoCodec,
  toWhatsAppVideo,
  pickDownloadedFile,
  resolveYtDlp,
  runFfmpeg,
  runProcess,
  toAudio,
  videoToWebp,
  webpToPng,
} from '../lib/media.js';
import { extractText, detectType, hasMeaningfulContent, smsg } from '../lib/serialize.js';
import { audioExtension } from '../plugins/downloader-ytmp3.js';
import stickerPlugin from '../plugins/tools-sticker.js';

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

test('smsg mengutamakan nomor telepon (PN) dibanding LID', () => {
  const conn = { user: { id: '628999@s.whatsapp.net' } };
  const m = smsg(conn, {
    key: {
      remoteJid: '123@g.us',
      participant: '271446714642565@lid',
      participantLid: '271446714642565@lid',
      participantPn: '6289530694332@s.whatsapp.net',
      fromMe: false,
      id: 'X3',
    },
    message: { conversation: '.menu' },
    messageTimestamp: 1700000002,
    pushName: 'KissShot',
  });

  assert.equal(m.sender, '6289530694332@s.whatsapp.net');
  assert.equal(m.senderPn, '6289530694332@s.whatsapp.net');
  assert.equal(m.senderLid, '271446714642565@lid');
});

test('hasMeaningfulContent menyaring protocolMessage / senderKeyDistributionMessage', () => {
  assert.equal(hasMeaningfulContent({ conversation: 'halo' }), true);
  assert.equal(hasMeaningfulContent({ extendedTextMessage: { text: '.menu' } }), true);
  assert.equal(hasMeaningfulContent({ imageMessage: { mimetype: 'image/jpeg' } }), true);
  // SKD + teks asli (pola yang muncul di log panel) -> tetap diproses
  assert.equal(
    hasMeaningfulContent({ senderKeyDistributionMessage: { groupId: 'x' }, conversation: '.menu' }),
    true,
  );
  // murni protocol -> diabaikan
  assert.equal(hasMeaningfulContent({ protocolMessage: { type: 6 } }), false);
  assert.equal(hasMeaningfulContent({ senderKeyDistributionMessage: { groupId: 'x' } }), false);
  assert.equal(hasMeaningfulContent({ messageContextInfo: {} }), false);
  assert.equal(hasMeaningfulContent({}), false);
});

test('resolveYtDlp: null kalau tidak ada, atau berisi bin+version kalau ada', () => {
  const resolved = resolveYtDlp('', { refresh: true });
  if (resolved === null) {
    assert.equal(resolved, null);
  } else {
    assert.equal(typeof resolved.bin, 'string');
    assert.equal(typeof resolved.version, 'string');
  }
});

test('detectType & mtype tetap benar walau senderKeyDistributionMessage di depan', () => {
  const content = {
    senderKeyDistributionMessage: { groupId: 'x' },
    imageMessage: { mimetype: 'image/jpeg', fileLength: 100 },
  };
  // bug lama: key pertama (SKD) dianggap tipe media -> stiker gagal
  assert.equal(detectType(content), 'image');
  const built = smsg(
    { user: { id: '6289@s.whatsapp.net' } },
    {
      key: { remoteJid: '123@g.us', participant: '6281@s.whatsapp.net', id: 'X', fromMe: false },
      message: content,
      messageTimestamp: 1,
    },
  );
  assert.equal(built.mtype, 'imageMessage');
  // m.msg = konten dalam, sehingga m.msg.mimetype tersedia (dipakai plugin stiker)
  assert.equal(built.msg.mimetype, 'image/jpeg');
  assert.equal(built.content.imageMessage.mimetype, 'image/jpeg');
  assert.equal(detectType({ senderKeyDistributionMessage: { groupId: 'x' } }), null);
});

test('plugin .sticker mengubah gambar menjadi webp (butuh ffmpeg)', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');

  const png = await runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=96x96', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
    null,
  );

  // Skenario asli: pesan grup berisi senderKeyDistributionMessage + imageMessage
  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (_chat, content) => {
      sent.push(content);
      return { key: { id: `MSG${sent.length}` } };
    },
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-sticker-'));
  attachHelpers(conn, { config: { media: { tmpDir }, bot: { packname: 'Uji', author: 'Bot' } } });

  const m = smsg(conn, {
    key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'IMG1' },
    message: {
      senderKeyDistributionMessage: { groupId: 'x' },
      imageMessage: { mimetype: 'image/jpeg', fileLength: 4242, caption: '.sticker' },
    },
    messageTimestamp: 1700000003,
    pushName: 'Tester',
  });
  m.download = async () => png;

  await stickerPlugin(m, {
    conn,
    args: [],
    command: 'sticker',
    usedPrefix: '.',
    config: { bot: { packname: 'Uji', author: 'Bot' }, messages: { stickerWait: '...' }, media: { maxStickerSeconds: 10 } },
  });

  const sticker = sent.map((content) => content.sticker).find(Boolean);
  assert.ok(sticker, `stiker tidak terkirim (terkirim: ${JSON.stringify(sent.map((c) => Object.keys(c)))} )`);
  assert.equal(sticker.subarray(8, 12).toString(), 'WEBP');
  assert.equal(sticker.includes(Buffer.from('sticker-pack-name')), true, 'EXIF packname tidak tertanam');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('plugin .sticker memberi pesan jelas kalau tidak ada media', async () => {
  let message = '';
  await assert.rejects(
    stickerPlugin(
      { chat: 'x', msg: {}, quoted: null, reply: async () => {} },
      { conn: {}, args: [], command: 'sticker', usedPrefix: '.', config: { bot: {}, messages: {}, media: {} } },
    ),
    (err) => {
      message = String(err);
      return /gambar\/video/i.test(message);
    },
  );
  assert.match(message, /gambar\/video/i);
});

test('plugin .sticker mengubah video menjadi stiker animasi (butuh ffmpeg)', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');

  const mp4 = await runFfmpeg(
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=96x96:rate=10:duration=2',
      '-pix_fmt', 'yuv420p',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4', 'pipe:1',
    ],
    null,
  );

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (_chat, content) => {
      sent.push(content);
      return { key: { id: `MSG${sent.length}` } };
    },
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-sticker-vid-'));
  attachHelpers(conn, { config: { media: { tmpDir, maxStickerSeconds: 10 }, bot: { packname: 'Uji', author: 'Bot' } } });

  const m = smsg(conn, {
    key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'VID1' },
    message: { videoMessage: { mimetype: 'video/mp4', seconds: 3, fileLength: 9999 } },
    messageTimestamp: 1700000004,
    pushName: 'Tester',
  });
  m.download = async () => mp4;

  await stickerPlugin(m, {
    conn,
    args: [],
    command: 'sticker',
    usedPrefix: '.',
    config: { bot: { packname: 'Uji', author: 'Bot' }, messages: { stickerWait: '...' }, media: { maxStickerSeconds: 10 } },
  });

  const sticker = sent.map((content) => content.sticker).find(Boolean);
  assert.ok(sticker, 'stiker video tidak terkirim');
  assert.equal(sticker.subarray(8, 12).toString(), 'WEBP');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('plugin .sticker menolak video yang terlalu panjang', async () => {
  const conn = { user: { id: '6289@s.whatsapp.net' }, sendMessage: async () => ({ key: { id: 'M' } }) };
  const m = smsg(conn, {
    key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'VID2' },
    message: { videoMessage: { mimetype: 'video/mp4', seconds: 45, fileLength: 9999 } },
    messageTimestamp: 1700000005,
  });
  m.download = async () => Buffer.alloc(2048);

  await assert.rejects(
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

test('pickDownloadedFile mengabaikan file sementara', () => {
  assert.equal(pickDownloadedFile([]), null);
  assert.equal(pickDownloadedFile(['media.m4a.part']), null);
  assert.equal(pickDownloadedFile(['.hidden', 'media.mp4.ytdl']), null);
  assert.equal(pickDownloadedFile(['media.m4a']), 'media.m4a');
  assert.equal(pickDownloadedFile(['media.mp4', 'media.mp4.part']), 'media.mp4');
});

// ── Stiker: GIF, WebP animasi, reply media orang lain, tautan ──────────────

/**
 * Folder kerja uji di dalam proyek (`tmp/`), bukan Temp sistem: proses ffmpeg
 * boleh menulis di area proyek, sama seperti saat bot berjalan.
 */
const mediaTmpDir = (prefix) => {
  const dir = path.join(process.cwd(), 'tmp', `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** Buat GIF animasi kecil (butuh ffmpeg). */
async function makeGif(dir, name = 'anim.gif', { size = 64, seconds = 1, rate = 10 } = {}) {
  const target = path.join(dir, name);
  await runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}x${size}:rate=${rate}:duration=${seconds}`, '-y', target],
    null,
  );
  return fs.readFileSync(target);
}

/** Buat mp4 kecil untuk menguji webp animasi. */
const makeMp4 = () =>
  runFfmpeg(
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=1',
      '-pix_fmt', 'yuv420p',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4', 'pipe:1',
    ],
    null,
  );

const makePng = (size = 64) =>
  runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=red:s=${size}x${size}`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
    null,
  );

const stickerHarness = () => {
  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (_chat, content) => {
      sent.push(content);
      return { key: { id: `M${sent.length}` } };
    },
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-sticker-x-'));
  attachHelpers(conn, { config: { media: { tmpDir, maxStickerSeconds: 10 }, bot: { packname: 'Uji', author: 'Bot' } } });
  const config = { bot: { packname: 'Uji', author: 'Bot', prefix: ['.'] }, messages: { stickerWait: '...' }, media: { maxStickerSeconds: 10 } };
  return { sent, conn, config, tmpDir, sticker: () => sent.map((content) => content.sticker).find(Boolean) };
};

test('deteksi jenis media dari isi berkas (gif vs webp animasi vs gambar)', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  const dir = mediaTmpDir('kind');

  const gif = await makeGif(dir);
  assert.equal(isGif(gif), true, 'GIF tidak terdeteksi');
  assert.equal((await detectMediaKind(gif)).kind, 'gif');

  const png = await makePng();
  assert.equal((await detectMediaKind(png)).kind, 'image');

  const animated = await videoToWebp(await makeMp4(), { seconds: 2 });
  assert.equal(isAnimatedWebp(animated), true, 'webp animasi tidak terdeteksi');
  assert.equal((await detectMediaKind(animated)).kind, 'animated');

  const staticWebp = await imageToWebp(png);
  assert.equal(isAnimatedWebp(staticWebp), false);
  assert.equal((await detectMediaKind(staticWebp)).kind, 'image');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugin .sticker: GIF jadi stiker ANIMASI (bukan statis)', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  const dir = mediaTmpDir('gif');
  const gif = await makeGif(dir);
  const harness = stickerHarness();

  const m = smsg(harness.conn, {
    key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'GIF1' },
    message: { imageMessage: { mimetype: 'image/gif', fileLength: gif.length, caption: '.s' } },
    messageTimestamp: 1700000010,
    pushName: 'Tester',
  });
  m.download = async () => gif;

  await stickerPlugin(m, { conn: harness.conn, args: [], command: 'sticker', usedPrefix: '.', config: harness.config });

  const sticker = harness.sticker();
  assert.ok(sticker, 'stiker tidak terkirim');
  assert.equal(sticker.subarray(8, 12).toString(), 'WEBP');
  assert.equal(sticker.includes(Buffer.from('ANIM')), true, 'stiker dari GIF harus animasi (chunk ANIM)');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(harness.tmpDir, { recursive: true, force: true });
});

test('plugin .sticker: GIF yang dikirim sebagai dokumen tetap jadi stiker animasi', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  const dir = mediaTmpDir('gifdoc');
  const gif = await makeGif(dir);
  const harness = stickerHarness();

  const m = smsg(harness.conn, {
    key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'GIFDOC1' },
    // mimetype pesan sengaja tidak jelas -> harus dideteksi dari isi berkas
    message: { documentMessage: { mimetype: 'application/octet-stream', fileName: 'anim.gif', fileLength: gif.length } },
    messageTimestamp: 1700000011,
    pushName: 'Tester',
  });
  m.download = async () => gif;

  await stickerPlugin(m, { conn: harness.conn, args: [], command: 'sticker', usedPrefix: '.', config: harness.config });
  const sticker = harness.sticker();
  assert.ok(sticker, 'stiker tidak terkirim');
  assert.equal(sticker.includes(Buffer.from('ANIM')), true, 'GIF dari dokumen harus jadi stiker animasi');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(harness.tmpDir, { recursive: true, force: true });
});

test('plugin .sticker: reply gambar milik orang lain', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  const png = await makePng();
  const harness = stickerHarness();

  const m = smsg(harness.conn, {
    key: { remoteJid: '123@g.us', participant: '628222@s.whatsapp.net', fromMe: false, id: 'R1' },
    message: {
      extendedTextMessage: {
        text: '.s',
        contextInfo: {
          stanzaId: 'Q1',
          participant: '628111@s.whatsapp.net',
          quotedMessage: { imageMessage: { mimetype: 'image/jpeg', fileLength: 4242 } },
        },
      },
    },
    messageTimestamp: 1700000012,
    pushName: 'Tester',
  });

  assert.ok(m.quoted, 'pesan yang di-reply tidak terbentuk');
  assert.equal(m.quoted.msg.mimetype, 'image/jpeg');
  m.quoted.download = async () => png;

  await stickerPlugin(m, { conn: harness.conn, args: [], command: 'sticker', usedPrefix: '.', config: harness.config });

  const sticker = harness.sticker();
  assert.ok(sticker, 'stiker dari reply gambar orang lain tidak terkirim');
  assert.equal(sticker.subarray(8, 12).toString(), 'WEBP');
  fs.rmSync(harness.tmpDir, { recursive: true, force: true });
});

test('plugin .sticker: tautan GIF juga diproses jadi stiker animasi', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  const dir = mediaTmpDir('gifurl');
  const gif = await makeGif(dir);
  const harness = stickerHarness();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => gif });

  try {
    const m = smsg(harness.conn, {
      key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'URL1' },
      message: { conversation: '.s https://example.com/anim.gif' },
      messageTimestamp: 1700000013,
      pushName: 'Tester',
    });

    await stickerPlugin(m, {
      conn: harness.conn,
      args: ['https://example.com/anim.gif'],
      command: 'sticker',
      usedPrefix: '.',
      config: harness.config,
    });

    const sticker = harness.sticker();
    assert.ok(sticker, 'stiker dari tautan tidak terkirim');
    assert.equal(sticker.includes(Buffer.from('ANIM')), true, 'GIF dari tautan harus jadi stiker animasi');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(harness.tmpDir, { recursive: true, force: true });
  }
});

test('videoToWebp menjaga ukuran stiker animasi di bawah batas WhatsApp', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');
  const dir = mediaTmpDir('cap');
  // Sumber besar & berisik: kasus terburuk (tanpa pembatasan bisa > 1 MB)
  const gif = await makeGif(dir, 'besar.gif', { size: 320, seconds: 5, rate: 12 });

  const webp = await videoToWebp(gif, { seconds: 10 });
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  assert.equal(isAnimatedWebp(webp), true, 'harus tetap animasi');
  assert.ok(
    webp.length <= MAX_ANIMATED_STICKER_BYTES,
    `stiker ${(webp.length / 1024).toFixed(0)}KB melebihi target ${MAX_ANIMATED_STICKER_BYTES / 1024}KB`,
  );
  assert.ok(webp.length <= MAX_STICKER_BYTES, 'tidak boleh melebihi batas keras WhatsApp 1MB');

  // batas bisa diatur: target sangat kecil -> dipilih percobaan terkecil
  const tiny = await videoToWebp(gif, { seconds: 2, maxBytes: 1 });
  assert.ok(tiny.length < webp.length, 'harus turun kualitas saat target tidak tercapai');
  assert.equal(isAnimatedWebp(tiny), true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('audioExtension menebak jenis audio dari magic bytes', () => {
  assert.equal(audioExtension(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)])), 'mp3');
  assert.equal(audioExtension(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(14)])), 'mp3');
  assert.equal(audioExtension(Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(4)])), 'm4a');
  assert.equal(audioExtension(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(12)])), 'ogg');
  assert.equal(audioExtension(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])), 'webm');
  assert.equal(audioExtension(Buffer.alloc(4)), 'm4a');
});

test('runProcess tidak crash kalau proses menutup stdin lebih awal (EPIPE)', async () => {
  // ffmpeg berhenti membaca input begitu batas `-t` tercapai; sisa buffer yang
  // masih ditulis memicu EPIPE di stdin. Dulu error itu tidak ditangani sama
  // sekali, jadi satu video kepanjangan bisa mematikan proses bot.
  const out = await runProcess(process.execPath, ['-e', 'process.exit(0)'], Buffer.alloc(8 * 1024 * 1024));
  assert.ok(Buffer.isBuffer(out));
});

// ── Petunjuk pemasangan ffmpeg ──────────────────────────────────────────────

test('ffmpegInstallHint selalu menyebut Windows DAN Linux', () => {
  // Instruksi ini dulu diulang di 9 tempat dengan 5 redaksi berbeda, dan 7 di
  // antaranya hanya menyebut `apt install ffmpeg` — saran yang tak berguna bagi
  // user Windows. Sekarang helper ini SATU-satunya sumber teksnya, jadi baris
  // Windows tidak bisa lagi hilang diam-diam dari sebagian pesan error.
  const hint = ffmpegInstallHint();
  assert.match(hint, /winget install Gyan\.FFmpeg/, 'harus menyebut cara pasang di Windows');
  assert.match(hint, /apt install ffmpeg/, 'harus menyebut cara pasang di Linux');
  assert.match(hint, /ffmpeg -version/, 'baris cek ikut secara bawaan');

  const bare = ffmpegInstallHint({ check: false });
  assert.match(bare, /winget install Gyan\.FFmpeg/, 'Windows tetap ada walau tanpa baris cek');
  assert.match(bare, /apt install ffmpeg/, 'Linux tetap ada walau tanpa baris cek');
  assert.doesNotMatch(bare, /ffmpeg -version/, 'check:false harus menyembunyikan baris cek');
});

// ── Kodek video untuk WhatsApp ──────────────────────────────────────────────

test('mp4VideoCodec membaca fourcc kodek video dari berkas mp4', () => {
  const h264 = fs.readFileSync(new URL('./fixtures/color.mp4', import.meta.url));
  assert.equal(mp4VideoCodec(h264), 'avc1', 'fixture H.264 dikenali');

  assert.equal(mp4VideoCodec(Buffer.from('xxxxav01yyyy')), 'av01', 'AV1 dikenali');
  assert.equal(mp4VideoCodec(Buffer.from('bukan berkas video')), null, 'sampah -> null');
});

test('toWhatsAppVideo mengubah AV1 menjadi H.264 yang bisa diputar WhatsApp', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg tidak terpasang');

  let av1;
  try {
    // Facebook kini sering mengirim video AV1 (av01); WhatsApp tidak bisa
    // memutarnya dan menampilkan "something is wrong with the video file".
    av1 = await runFfmpeg(
      [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=96x96:rate=10:duration=1',
        '-c:v', 'libaom-av1', '-pix_fmt', 'yuv420p',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4', 'pipe:1',
      ],
      null,
      { timeout: 120000 },
    );
  } catch {
    return t.skip('encoder AV1 tidak tersedia di ffmpeg ini');
  }

  assert.equal(mp4VideoCodec(av1), 'av01', 'input tes memang AV1');
  const fixed = await toWhatsAppVideo(av1);
  assert.equal(mp4VideoCodec(fixed), 'avc1', 'hasil transkode harus H.264 (avc1)');
});
