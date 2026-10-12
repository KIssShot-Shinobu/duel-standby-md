// Cek manual fitur stiker: gambar -> webp -> EXIF, video -> webp animasi,
// webp -> png, plus jalur helper conn (sendImageAsSticker).
//   node scripts/sticker-check.mjs
import * as media from '../lib/media.js';
import { attachHelpers } from '../lib/simple.js';
import { unwrapMessage, detectType, smsg } from '../lib/serialize.js';

const ffmpegReady = media.hasFfmpeg();
console.log('ffmpeg tersedia   :', ffmpegReady, process.env.FFMPEG_PATH ? `(${process.env.FFMPEG_PATH})` : '');
console.log('ukuran gambar uji : 128x128 png');

const png = await media.runFfmpeg(
  ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=128x128', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
  null,
);
console.log('1) png dibuat     :', png.length, 'bytes');

const webp = await media.imageToWebp(png);
console.log('2) imageToWebp    :', webp.length, 'bytes | magic:', webp.subarray(8, 12).toString());

const withExif = await media.addExif(webp, { packname: 'Uji Pack', author: 'Uji Author' });
console.log('3) addExif        :', withExif.length, 'bytes | magic:', withExif.subarray(8, 12).toString(), '| exif:', withExif.includes(Buffer.from('sticker-pack-name')));

const png2 = await media.webpToPng(withExif);
console.log('4) webpToPng      :', png2.length, 'bytes | magic:', png2.subarray(1, 4).toString());

const mp4 = await media.runFfmpeg(
  [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=128x128:rate=10:duration=2',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', 'pipe:1',
  ],
  null,
);
console.log('5a) mp4 uji dibuat :', mp4.length, 'bytes');
const animWebp = await media.videoToWebp(mp4, { seconds: 3 });
console.log('5b) videoToWebp   :', animWebp.length, 'bytes | magic:', animWebp.subarray(8, 12).toString());

// Jalur yang dipakai plugin .sticker
const sent = [];
const conn = {
  user: { id: '628999@s.whatsapp.net' },
  sendMessage: async (chat, content) => {
    sent.push(content);
    return { key: { id: 'MSG1', remoteJid: chat } };
  },
};
attachHelpers(conn, { config: { media: { tmpDir: './tmp' }, bot: { packname: 'P', author: 'A' } } });
const file = await conn.sendImageAsSticker('628111@s.whatsapp.net', png, null, {});
console.log('6) sendImageAsSticker: terkirim =', sent.length === 1, '| tipe =', sent[0]?.sticker ? 'sticker' : Object.keys(sent[0] || {}), '| file =', file);

// Kasus yang bikin bug: pesan gambar di grup yang ikut membawa senderKeyDistributionMessage
const raw = {
  key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'X9' },
  message: { senderKeyDistributionMessage: { groupId: 'x' }, imageMessage: { mimetype: 'image/jpeg', fileLength: 1234 } },
  messageTimestamp: 1700000000,
  pushName: 'Tester',
};
const content = unwrapMessage(raw.message);
console.log('7) detectType     :', detectType(content));
console.log('8) mtype (smsg)   :', smsg(conn, raw)?.mtype);

// Jalur plugin .sticker dengan pesan bergaya SKD + image (kasus yang dulu gagal)
const stickerPlugin = (await import('../plugins/tools-sticker.js')).default;
let stickerBuffer = null;
const fakeConn = {
  user: { id: '628999@s.whatsapp.net' },
  sendMessage: async () => ({ key: { id: 'MSG1' } }),
  sendImageAsSticker: async (_chat, buffer) => {
    stickerBuffer = buffer;
    return null;
  },
};
const mReal = smsg(fakeConn, {
  key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'IMG1' },
  message: {
    senderKeyDistributionMessage: { groupId: 'x' },
    imageMessage: { mimetype: 'image/jpeg', fileLength: 4242, caption: '.sticker' },
  },
  messageTimestamp: 1700000000,
  pushName: 'Tester',
});
mReal.download = async () => png;
await stickerPlugin(mReal, {
  conn: fakeConn,
  args: [],
  command: 'sticker',
  usedPrefix: '.',
  config: { bot: { packname: 'Uji', author: 'Bot' }, messages: { stickerWait: '...' }, media: { maxStickerSeconds: 10 } },
});
console.log('9) plugin sticker :', stickerBuffer ? `OK (${stickerBuffer.length} bytes, magic ${stickerBuffer.subarray(8, 12).toString()})` : 'GAGAL');
