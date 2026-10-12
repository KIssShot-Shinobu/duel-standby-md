import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { attachHelpers } from '../lib/simple.js';
import {
  addExif,
  hasFfmpeg,
  imageToWebp,
  pickDownloadedFile,
  resolveYtDlp,
  runFfmpeg,
  toAudio,
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

test('audioExtension menebak jenis audio dari magic bytes', () => {
  assert.equal(audioExtension(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)])), 'mp3');
  assert.equal(audioExtension(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(14)])), 'mp3');
  assert.equal(audioExtension(Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(4)])), 'm4a');
  assert.equal(audioExtension(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(12)])), 'ogg');
  assert.equal(audioExtension(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])), 'webm');
  assert.equal(audioExtension(Buffer.alloc(4)), 'm4a');
});
