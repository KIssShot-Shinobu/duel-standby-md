/**
 * Utilitas media berbasis ffmpeg (tanpa dependency binary tambahan).
 * Kalau ffmpeg tidak tersedia, fungsi akan melempar error yang jelas
 * dan plugin bisa menanganinya dengan pesan ramah.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function ffmpegPath() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

let ffmpegCached;
export function hasFfmpeg() {
  if (ffmpegCached !== undefined) return ffmpegCached;
  try {
    const result = spawnSync(ffmpegPath(), ['-version'], { stdio: 'ignore' });
    ffmpegCached = result.status === 0;
  } catch {
    ffmpegCached = false;
  }
  return ffmpegCached;
}

/**
 * Jalankan ffmpeg dengan input dari stdin dan hasil dari stdout.
 * @param {string[]} args
 * @param {Buffer} [input]
 */
export function runFfmpeg(args, input, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffmpeg timeout'));
    }, timeout);
    timer.unref?.();

    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg tidak bisa dijalankan: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString().trim().split('\n').slice(-3).join(' | ');
        reject(new Error(`ffmpeg keluar dengan kode ${code}: ${detail}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

const SCALE = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';

/** Gambar (jpg/png/webp) -> stiker webp statis. */
export async function imageToWebp(buffer) {
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vcodec', 'libwebp',
      '-vf', SCALE,
      '-lossless', '0',
      '-q:v', '70',
      '-preset', 'default',
      '-an',
      '-vsync', '0',
      '-f', 'webp',
      'pipe:1',
    ],
    buffer,
  );
}

/** Video/gif -> stiker webp animasi. */
export async function videoToWebp(buffer, { seconds = 10, fps = 15 } = {}) {
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vcodec', 'libwebp',
      '-vf', `fps=${fps},${SCALE}`,
      '-loop', '0',
      '-preset', 'default',
      '-an',
      '-vsync', '0',
      '-t', String(seconds),
      '-f', 'webp',
      'pipe:1',
    ],
    buffer,
  );
}

/** Stiker webp -> png. */
export async function webpToPng(buffer) {
  return runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vcodec', 'png', '-f', 'image2pipe', 'pipe:1'],
    buffer,
  );
}

/** Stiker webp -> mp4. */
export async function webpToMp4(buffer) {
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-movflags', 'frag_keyframe+empty_moov',
      '-an',
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-f', 'mp4',
      'pipe:1',
    ],
    buffer,
  );
}

/** Media apa pun -> mp3. */
export async function toAudio(buffer) {
  return runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k', '-f', 'mp3', 'pipe:1'],
    buffer,
  );
}

/** Media apa pun -> voice note (ogg/opus). */
export async function toPTT(buffer) {
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-ar', '48000',
      '-ac', '1',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-f', 'ogg',
      'pipe:1',
    ],
    buffer,
  );
}

/** Gambar statis + audio (atau video) -> mp4. */
export async function toVideo(buffer) {
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-movflags', 'frag_keyframe+empty_moov',
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-f', 'mp4',
      'pipe:1',
    ],
    buffer,
  );
}

/** Ubah resolusi gambar via ffmpeg (tanpa sharp). */
export async function resizeImage(buffer, width = 512, height = -1) {
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vf', `scale=${width}:${height}`,
      '-f', 'image2pipe',
      '-vcodec', 'png',
      'pipe:1',
    ],
    buffer,
  );
}

/**
 * Tempelkan metadata EXIF (packname/author) ke stiker webp.
 * Memakai node-webpmux; kalau gagal, buffer asli dikembalikan.
 */
export async function addExif(webpBuffer, { packname = '', author = '' } = {}) {
  try {
    const module = await import('node-webpmux');
    const Image = module.default?.Image || module.Image;
    if (!Image) throw new Error('node-webpmux tidak menyediakan Image');

    const json = {
      'sticker-pack-id': randomUUID(),
      'sticker-pack-name': packname,
      'sticker-pack-publisher': author,
      emojis: ['🤖'],
    };
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exifHeader = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00,
      0x00, 0x00,
    ]);
    const exif = Buffer.concat([exifHeader, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);

    const image = new Image();
    await image.load(webpBuffer);
    image.exif = exif;
    const result = await image.save(null);
    return Buffer.isBuffer(result) ? result : webpBuffer;
  } catch {
    return webpBuffer;
  }
}

/** Cek ketersediaan yt-dlp (dipakai plugin downloader YouTube). */
let ytdlpCached;
export function hasYtDlp(customPath = '') {
  if (ytdlpCached !== undefined && !customPath) return ytdlpCached;
  const bin = customPath || process.env.YTDLP_PATH || 'yt-dlp';
  try {
    const result = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    const ok = result.status === 0;
    if (!customPath) ytdlpCached = ok;
    return ok;
  } catch {
    if (!customPath) ytdlpCached = false;
    return false;
  }
}

/** Unduh media memakai yt-dlp ke Buffer (audio atau video). */
export async function ytDlpDownload(url, { format = 'audio', maxDuration = 900, customPath = '' } = {}) {
  const bin = customPath || process.env.YTDLP_PATH || 'yt-dlp';
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--no-progress',
    '--retries', '2',
    '--socket-timeout', '20',
    '--match-filter', `duration < ${maxDuration}`,
    '-o', '-',
  ];
  if (format === 'audio') args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best', '-x', '--audio-format', 'mp3');
  else args.push('-f', 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4]/b');
  args.push(url);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('yt-dlp timeout'));
    }, 180000);
    timer.unref?.();
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => errors.push(c));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`yt-dlp tidak bisa dijalankan: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || buffer.length === 0) {
        const detail = Buffer.concat(errors).toString().trim().split('\n').slice(-3).join(' | ');
        reject(new Error(`yt-dlp gagal (kode ${code}): ${detail || 'tidak ada output'}`));
        return;
      }
      resolve(buffer);
    });
  });
}

export default {
  hasFfmpeg,
  hasYtDlp,
  imageToWebp,
  videoToWebp,
  webpToPng,
  webpToMp4,
  toAudio,
  toPTT,
  toVideo,
  resizeImage,
  addExif,
  ytDlpDownload,
  runFfmpeg,
};
