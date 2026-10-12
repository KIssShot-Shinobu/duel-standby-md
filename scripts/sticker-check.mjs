/**
 * Cek manual fitur stiker (dipakai untuk memastikan server sudah benar).
 *
 *   npm run check:sticker
 *
 * Yang diuji: encoder yang tersedia, gambar → WebP → EXIF, GIF → stiker
 * ANIMASI, stiker → gambar, video → stiker (kalau ffmpeg ada), dan jalur plugin
 * `.sticker` sungguhan. GIF uji tertanam di dalam skrip supaya pengecekan tetap
 * jalan di server **tanpa ffmpeg** — justru itu kasus yang dulu bikin error.
 */
import path from 'node:path';

import print from '../lib/print.js';
import * as media from '../lib/media.js';
import { attachHelpers } from '../lib/simple.js';
import { smsg } from '../lib/serialize.js';

/** GIF 2 frame 16x16 (tertanam) — cukup untuk membuktikan animasi terjaga. */
const GIF_KECIL = Buffer.from(
  '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',
  'base64',
);

const bold = (text) => print.color.bold(text);
const say = (label, value) => print.kv(label, value);

print.info('Cek pipeline stiker (tanpa perlu WhatsApp)');
console.log('');

// ── Encoder ────────────────────────────────────────────────────────────────
const encoder = await media.stickerEncoder();
say('Encoder', encoder ? `${bold(encoder)}${encoder === 'sharp' ? ' (tanpa ffmpeg)' : ''}` : 'TIDAK ADA', {
  tag: encoder ? 'success' : 'error',
});
say('ffmpeg', media.hasFfmpeg() ? 'tersedia' : 'tidak ada (video → stiker & GIF WhatsApp dilewati)');
if (!encoder) {
  print.error('Tidak ada encoder WebP. Jalankan: npm install sharp');
  process.exit(1);
}

// ── Gambar → WebP → EXIF ───────────────────────────────────────────────────
const sharp = await media.loadSharp();
const png = sharp
  ? await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer()
  : await media.runFfmpeg(
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=128x128', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
      null,
    );
say('1. PNG uji', `${png.length} bytes`);

const webp = await media.imageToWebp(png);
say('2. Gambar ke WebP', `${webp.length} bytes • magic ${webp.subarray(8, 12).toString()}`, { tag: 'success' });

const withExif = await media.addExif(webp, { packname: 'Uji Pack', author: 'Uji Author' });
say('3. EXIF packname', withExif.includes(Buffer.from('sticker-pack-name')) ? 'tertanam' : 'TIDAK tertanam', {
  tag: withExif.includes(Buffer.from('sticker-pack-name')) ? 'success' : 'warn',
});

// ── GIF → stiker ANIMASI (inti perbaikan) ─────────────────────────────────
const animWebp = await media.videoToWebp(GIF_KECIL, { seconds: 5, fps: 15 });
const animMeta = sharp ? await sharp(animWebp, { animated: true }).metadata() : null;
say(
  '4. GIF ke stiker',
  `${animWebp.length} bytes • ${animMeta?.pages || '?'} frame • magic ${animWebp.subarray(8, 12).toString()}`,
  { tag: (animMeta?.pages || 1) > 1 ? 'success' : 'error' },
);
if ((animMeta?.pages || 1) <= 1) print.warn('Stiker GIF TIDAK bergerak — laporkan ini.');

// ── Stiker → gambar (butuh ffmpeg) ─────────────────────────────────────────
if (media.hasFfmpeg()) {
  const png2 = await media.webpToPng(withExif);
  say('5. Stiker ke PNG', `${png2.length} bytes • magic ${png2.subarray(1, 4).toString()}`, { tag: 'success' });
} else {
  say('5. Stiker ke PNG', 'dilewati (butuh ffmpeg)');
}

// ── Video → stiker (butuh ffmpeg) ──────────────────────────────────────────
if (media.hasFfmpeg()) {
  const mp4 = await media.runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=128x128:rate=10:duration=2', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
    null,
  );
  const vidWebp = await media.videoToWebp(mp4, { seconds: 3 });
  say('6. Video ke stiker', `${vidWebp.length} bytes • magic ${vidWebp.subarray(8, 12).toString()}`, { tag: 'success' });
} else {
  say('6. Video ke stiker', 'dilewati (butuh ffmpeg — GIF tetap jalan tanpa ffmpeg)');
}

// ── Jalur plugin `.sticker` dengan GIF ─────────────────────────────────────
const sent = [];
const conn = {
  user: { id: '628999@s.whatsapp.net' },
  sendMessage: async (_chat, content) => {
    sent.push(content);
    return { key: { id: `M${sent.length}` } };
  },
};
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
attachHelpers(conn, {
  config: { media: { tmpDir: path.join(process.cwd(), 'tmp'), maxStickerSeconds: 10 }, bot: { packname: 'Uji', author: 'Bot' } },
  logger: quiet,
});

const m = smsg(conn, {
  key: { remoteJid: '123@g.us', participant: '628111@s.whatsapp.net', fromMe: false, id: 'GIF1' },
  message: { documentMessage: { mimetype: 'image/gif', fileName: 'uji.gif', fileLength: GIF_KECIL.length } },
  messageTimestamp: 1700000000,
  pushName: 'Tester',
});
m.download = async () => GIF_KECIL;

const stickerPlugin = (await import('../plugins/tools-sticker.js')).default;
await stickerPlugin(m, {
  conn,
  args: [],
  command: 'sticker',
  usedPrefix: '.',
  config: { bot: { packname: 'Uji', author: 'Bot' }, messages: { stickerWait: '...' }, media: { maxStickerSeconds: 10 } },
});

const sticker = sent.map((content) => content.sticker).find(Boolean);
const stickerMeta = sticker && sharp ? await sharp(sticker, { animated: true }).metadata() : null;
say(
  '7. Plugin .sticker (GIF)',
  sticker
    ? `${sticker.length} bytes • ${stickerMeta?.pages || '?'} frame • EXIF ${sticker.includes(Buffer.from('sticker-pack-name')) ? 'ada' : 'tidak ada'}`
    : 'GAGAL kirim',
  { tag: sticker ? 'success' : 'error' },
);

console.log('');
print.info('Semua langkah selesai. Kalau ada yang gagal, kirim output ini.');
