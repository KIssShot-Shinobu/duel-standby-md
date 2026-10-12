/**
 * Utilitas media berbasis ffmpeg (tanpa dependency binary tambahan).
 * Kalau ffmpeg tidak tersedia, fungsi akan melempar error yang jelas
 * dan plugin bisa menanganinya dengan pesan ramah.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/** ─────────────────────────── yt-dlp ─────────────────────────── */

const DEFAULT_YTDLP_PATHS = ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', '/bin/yt-dlp', 'yt-dlp'];

let ytdlpCache;

/**
 * Cari binary yt-dlp: YTDLP_PATH env -> path umum Linux -> PATH -> folder proyek.
 * @returns {{bin: string, version: string}|null}
 */
export function resolveYtDlp(customPath = '', { refresh = false } = {}) {
  if (!refresh && !customPath && ytdlpCache !== undefined) return ytdlpCache;
  const cwd = process.cwd();
  const candidates = [
    customPath,
    process.env.YTDLP_PATH,
    ...DEFAULT_YTDLP_PATHS,
    path.join(cwd, 'yt-dlp'),
    path.join(cwd, 'yt-dlp.exe'),
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
      if (result.status === 0) {
        const version = String(result.stdout || '').trim().split(/\r?\n/)[0] || 'unknown';
        const found = { bin, version };
        if (!customPath) ytdlpCache = found;
        return found;
      }
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  if (!customPath) ytdlpCache = null;
  return null;
}

export function hasYtDlp(customPath = '') {
  return Boolean(resolveYtDlp(customPath));
}

/** Pesan bantuan kalau yt-dlp tidak terdeteksi (dipakai plugin downloader). */
export function ytDlpInstallHint(config) {
  const hintPath = config?.ytdlp?.path || process.env.YTDLP_PATH || '/path/ke/yt-dlp';
  return [
    '❌ *yt-dlp tidak ditemukan.*',
    '',
    'Cek dulu di terminal panel:',
    '```yt-dlp --version```',
    'Kalau ada tapi bot tidak menemukannya, set path di `.env`:',
    '```',
    `YTDLP_PATH=${hintPath}`,
    '```',
    'Kalau belum terpasang: `pip install -U yt-dlp` atau `apt install yt-dlp`.',
  ].join('\n');
}

function splitArgs(value = '') {
  return (
    String(value)
      .match(/"[^"]*"|\S+/g)
      ?.map((part) => part.replace(/^"|"$/g, '')) || []
  );
}

/** Argumen tambahan dari env YTDLP_ARGS, mis: --extractor-args "youtube:player_client=android" */
export function ytDlpExtraArgs() {
  return splitArgs(process.env.YTDLP_ARGS || '');
}

/** File cookies (format Netscape) untuk video yang butuh login/verifikasi bot. */
export function ytDlpCookies() {
  return process.env.YTDLP_COOKIES || '';
}

function commonArgs({ cookies = '' } = {}) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--no-part',
    '--retries', '3',
    '--socket-timeout', '25',
    '--no-mtime',
  ];
  if (cookies) args.push('--cookies', cookies);
  args.push(...ytDlpExtraArgs());
  return args;
}

function hintFromStderr(text = '') {
  if (/sign in to confirm|not a bot|confirm you.?re not a bot/i.test(text)) {
    return 'YouTube meminta verifikasi "bukan bot". Ekspor cookies browser ke file lalu set `YTDLP_COOKIES=/path/cookies.txt`.';
  }
  if (/age-restricted|confirm your age/i.test(text)) return 'Video dibatasi umur — butuh cookies.';
  if (/private video|members-only|join this channel/i.test(text)) return 'Video privat / khusus member.';
  if (/video unavailable|has been removed|deleted/i.test(text)) return 'Video tidak tersedia atau sudah dihapus.';
  if (/ffmpeg (is )?not installed|ffmpeg not found|postprocessing/i.test(text)) {
    return 'Butuh ffmpeg untuk menggabungkan video+audio. Pasang ffmpeg di server, atau biarkan bot memakai format progressive (tanpa merge).';
  }
  if (/requested format is not available/i.test(text)) {
    return [
      'Format yang diminta tidak tersedia untuk video ini.',
      'Video YouTube modern biasanya menyediakan video & audio terpisah, sehingga butuh ffmpeg untuk digabung.',
      'Pasang ffmpeg, atau turunkan `YTDLP_MAX_HEIGHT` (mis. 480).',
    ].join(' ');
  }
  if (/unable to download webpage|getaddrinfo|network|timed out|ssl/i.test(text)) {
    return 'Server gagal menjangkau YouTube (jaringan/DNS/SSL). Cek koneksi panel.';
  }
  return '';
}

/** Pilih file hasil unduhan yt-dlp (abaikan file sementara .part/.ytdl). */
export function pickDownloadedFile(files = []) {
  const candidates = files
    .filter((file) => !/\.(part|ytdl|temp)$/i.test(file))
    .filter((file) => !file.startsWith('.'));
  if (!candidates.length) return null;
  // yt-dlp menulis satu file utama; kalau ada beberapa (mis. thumbnail), pilih yang terbesar.
  return candidates.length === 1 ? candidates[0] : candidates.sort((a, b) => b.length - a.length)[0];
}

function lastLines(text = '', count = 3) {
  return String(text).trim().split(/\r?\n/).filter(Boolean).slice(-count).join(' | ');
}

/** Jalankan yt-dlp dan kembalikan stdout sebagai Buffer. */
function runYtDlp(args, { timeout = 180000, customPath = '' } = {}) {
  const resolved = resolveYtDlp(customPath);
  if (!resolved) return Promise.reject(new Error('yt-dlp tidak ditemukan'));

  return new Promise((resolve, reject) => {
    const child = spawn(resolved.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`yt-dlp timeout setelah ${Math.round(timeout / 1000)}s`));
    }, timeout);
    timer.unref?.();

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`yt-dlp tidak bisa dijalankan: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const errorText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        const hint = hintFromStderr(errorText);
        reject(new Error(`yt-dlp gagal (kode ${code}): ${lastLines(errorText) || 'tanpa detail'}${hint ? `\n💡 ${hint}` : ''}`));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: errorText, bin: resolved.bin, version: resolved.version });
    });
  });
}

/**
 * Ambil metadata video tanpa mengunduh (judul, durasi, ukuran).
 * @returns {Promise<{title?: string, duration?: number, uploader?: string, filesize?: number, isLive?: boolean}>}
 */
export async function ytDlpInfo(url, { timeout = 60000, customPath = '' } = {}) {
  const { stdout } = await runYtDlp([...commonArgs({ cookies: ytDlpCookies() }), '--dump-single-json', '--skip-download', url], {
    timeout,
    customPath,
  });
  const text = stdout.toString('utf8').trim();
  const line = text.split(/\r?\n/).filter(Boolean).pop();
  if (!line) throw new Error('yt-dlp tidak memberi metadata (video mungkin dibatasi).');
  const json = JSON.parse(line);
  return {
    title: json.title,
    duration: json.duration,
    uploader: json.uploader || json.channel,
    filesize: json.filesize || json.filesize_approx,
    isLive: Boolean(json.is_live),
  };
}

/**
 * Unduh media ke Buffer (berbasis file sementara, file dihapus otomatis).
 *
 * Kenapa file dan bukan stdout (`-o -`)?
 *  - video modern sering hanya punya format terpisah (video & audio), sehingga
 *    butuh merge — dan merge hanya bisa dilakukan ke file;
 *  - kalau ffmpeg tersedia, audio bisa langsung dikonversi ke mp3 oleh yt-dlp;
 *  - output ke stdout terbatas pada satu stream mentah tanpa post-processing.
 *
 * Selector menyesuaikan ketersediaan ffmpeg:
 *  - ffmpeg ada   : `bv*+ba` (merge ke mp4) dengan cadangan progressive.
 *  - ffmpeg tidak : hanya format progressive (`b`) supaya tidak butuh merge.
 */
export async function ytDlpDownload(
  url,
  { format = 'audio', customPath = '', height = 720, maxDuration = 0, timeout = 300000, checkDuration = true } = {},
) {
  if (checkDuration && maxDuration) {
    const info = await ytDlpInfo(url, { customPath }).catch(() => null);
    if (info?.duration && info.duration > maxDuration) {
      throw new Error(
        `Durasi video ${Math.round(info.duration)}s melebihi batas ${maxDuration}s.\n💡 Ubah lewat env ` +
          '`YTDLP_MAX_DURATION` kalau perlu.',
      );
    }
  }

  const ffmpegReady = hasFfmpeg();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-ytdlp-'));
  const template = path.join(workDir, 'media.%(ext)s');

  const args = [...commonArgs({ cookies: ytDlpCookies() })];
  if (format === 'audio') {
    if (ffmpegReady) args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3');
    else args.push('-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best');
  } else {
    args.push(
      '-f',
      ffmpegReady
        ? `bv*[ext=mp4][height<=${height}]+ba[ext=m4a]/b[ext=mp4][height<=${height}]/bv*[height<=${height}]+ba/b[height<=${height}]/b`
        : `b[ext=mp4][height<=${height}]/b[height<=${height}]/b`,
    );
    if (ffmpegReady) args.push('--merge-output-format', 'mp4');
  }
  args.push('-o', template, url);

  try {
    await runYtDlp(args, { timeout, customPath });
    const picked = pickDownloadedFile(fs.readdirSync(workDir));
    if (!picked) throw new Error('yt-dlp selesai tetapi tidak ada file hasil unduhan.');
    const buffer = fs.readFileSync(path.join(workDir, picked));
    if (!buffer.length) throw new Error('File hasil unduhan kosong.');
    return buffer;
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export default {
  hasFfmpeg,
  hasYtDlp,
  resolveYtDlp,
  ytDlpInstallHint,
  ytDlpInfo,
  pickDownloadedFile,
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
