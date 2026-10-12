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
import { fileTypeFromBuffer } from 'file-type';

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
 * Jalankan sebuah binary: input lewat stdin, hasil dari stdout.
 * @param {string} bin
 * @param {string[]} args
 * @param {Buffer|null} input
 */
export function runProcess(bin, args, input = null, { timeout = 120000, label = bin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} timeout setelah ${Math.round(timeout / 1000)}s`));
    }, timeout);
    timer.unref?.();

    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${label} tidak bisa dijalankan: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString().trim().split('\n').slice(-3).join(' | ');
        reject(new Error(`${label} keluar dengan kode ${code}: ${detail}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Jalankan ffmpeg dengan input dari stdin dan hasil dari stdout. */
export function runFfmpeg(args, input, options = {}) {
  return runProcess(ffmpegPath(), args, input, { label: 'ffmpeg', ...options });
}

let drawtextCached;
/** Apakah build ffmpeg ini punya filter drawtext (butuh libfreetype)? */
export function hasDrawtext() {
  if (drawtextCached !== undefined) return drawtextCached;
  if (!hasFfmpeg()) {
    drawtextCached = false;
    return drawtextCached;
  }
  try {
    const output =
      spawnSync(ffmpegPath(), ['-hide_banner', '-filters'], {
        encoding: 'utf8',
        timeout: 20000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).stdout || '';
    drawtextCached = /\bdrawtext\b/.test(output);
  } catch {
    drawtextCached = false;
  }
  return drawtextCached;
}

/** Lokasi font yang umum di Linux/Termux/Windows/macOS. */
export const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/truetype/msttcorefonts/Impact.ttf',
  '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  'C:/Windows/Fonts/impact.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  '/System/Library/Fonts/Supplemental/Impact.ttf',
  '/Library/Fonts/Arial Bold.ttf',
];

/** Cari berkas font di dalam sebuah folder (maks. beberapa level). */
function scanFonts(root, maxEntries = 4000) {
  const stack = [{ dir: root, depth: 0 }];
  const found = [];
  let visited = 0;
  while (stack.length && visited < maxEntries) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 4) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!/\.(ttf|otf)$/i.test(entry.name)) continue;
      found.push(full);
      if (/bold|impact/i.test(entry.name)) return full; // font tebal paling cocok untuk meme
    }
  }
  return found[0] || null;
}

let fontCached;
/**
 * Tentukan font untuk drawtext.
 * Prioritas: argumen -> env FFMPEG_FONT -> lokasi umum -> pemindaian /usr/share/fonts.
 */
export function resolveFont(customPath = '') {
  const explicit = String(customPath || process.env.FFMPEG_FONT || '').trim();
  if (explicit) {
    try {
      if (fs.existsSync(explicit)) return explicit;
    } catch {
      /* lanjut ke deteksi otomatis */
    }
  }
  if (!customPath && fontCached !== undefined) return fontCached;

  const found = FONT_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  const result = found || scanFonts('/usr/share/fonts');
  if (!customPath) fontCached = result;
  return result;
}

/** Escape teks agar aman dipakai di filtergraph drawtext. */
export function escapeDrawtext(text = '') {
  return String(text)
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/** Pecah teks meme menjadi beberapa baris (maks `maxLines`). */
export function wrapMemeText(text, maxChars = 18, maxLines = 3) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= maxChars) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  // Jangan buang teks: gabungkan sisanya ke baris terakhir yang diizinkan.
  return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(' ')];
}

const MEME_FONT_SIZES = [64, 56, 48, 42, 36, 32, 28, 24, 20];

/**
 * Susun filtergraph ffmpeg untuk meme (tanpa menjalankannya) — dipisah supaya
 * mudah diuji/di-debug.
 * @returns {{filter: string, layout: {fontSize: number, topLines: string[], bottomLines: string[]}}}
 */
export function buildMemeFilter({ top = '', bottom = '', font, size = 512, margin = 14 } = {}) {
  const topText = String(top || '').trim();
  const bottomText = String(bottom || '').trim();

  let layout = null;
  const words = [...topText.split(/\s+/), ...bottomText.split(/\s+/)].filter(Boolean);
  const longestWord = words.reduce((max, word) => Math.max(max, word.length), 0);

  for (const fontSize of MEME_FONT_SIZES) {
    const maxChars = Math.max(6, Math.floor((size - margin * 2) / (fontSize * 0.55)));
    const topLines = topText ? wrapMemeText(topText, maxChars) : [];
    const bottomLines = bottomText ? wrapMemeText(bottomText, maxChars) : [];
    const fitsWord = longestWord * fontSize * 0.62 <= size - margin * 2;
    if (fitsWord && topLines.length <= 3 && bottomLines.length <= 3) {
      layout = { fontSize, topLines, bottomLines };
      break;
    }
  }
  if (!layout) {
    const fontSize = MEME_FONT_SIZES.at(-1);
    const maxChars = Math.max(6, Math.floor((size - margin * 2) / (fontSize * 0.55)));
    layout = { fontSize, topLines: wrapMemeText(topText, maxChars), bottomLines: wrapMemeText(bottomText, maxChars) };
  }

  const lineHeight = Math.round(layout.fontSize * 1.15);
  // Path font: garis miring ke depan + escape titik dua (Windows: C\:/...).
  const fontArg = String(font).replace(/\\/g, '/').replace(/:/g, '\\:');
  const filters = [
    `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
    `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=black`,
  ];

  const pushLine = (line, y) => {
    filters.push(
      'drawtext=' +
        `fontfile=${fontArg}` + // tanpa tanda kutip: lebih aman untuk path Windows
        `:text=${escapeDrawtext(line)}` + // semua karakter khusus sudah di-escape
        `:fontcolor=white:borderw=3:bordercolor=black:fontsize=${layout.fontSize}` +
        ':x=(w-text_w)/2' +
        `:y=${y}`,
    );
  };

  layout.topLines.forEach((line, index) => pushLine(line, margin + index * lineHeight));
  layout.bottomLines.forEach((line, index) => {
    pushLine(line, size - margin - (layout.bottomLines.length - index) * lineHeight);
  });

  return { filter: filters.join(','), layout };
}

/**
 * Gambar teks meme (atas/bawah) di atas sebuah gambar — mirip memegen.link,
 * tetapi dirender lokal dengan ffmpeg drawtext (tanpa upload ke layanan lain).
 *
 * @param {Buffer} buffer gambar sumber
 * @param {{top?: string, bottom?: string, fontPath?: string, size?: number, margin?: number}} options
 * @returns {Promise<Buffer>} PNG hasil meme
 */
export async function drawMemeText(buffer, { top = '', bottom = '', fontPath = '', size = 512, margin = 14 } = {}) {
  if (!hasFfmpeg()) throw new Error('ffmpeg tidak tersedia untuk membuat meme.');
  if (!hasDrawtext()) {
    throw new Error('Build ffmpeg ini tidak punya filter drawtext (libfreetype). Pasang ffmpeg lengkap: `apt install ffmpeg`.');
  }
  const font = resolveFont(fontPath);
  if (!font) {
    throw new Error(
      'Berkas font tidak ditemukan. Pasang font (`apt install fonts-dejavu-core`) atau set `FFMPEG_FONT=/path/ke/font.ttf`.',
    );
  }

  const { filter } = buildMemeFilter({ top, bottom, font, size, margin });

  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vf', filter,
      '-frames:v', '1',
      '-an',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      'pipe:1',
    ],
    buffer,
    { timeout: 60000 },
  );
}

/** Cari binary di env, PATH, dan lokasi umum Linux. */
export function resolveBinary(name, extraPaths = []) {
  const envKey = `${name.toUpperCase()}_PATH`;
  const candidates = [process.env[envKey], name, ...extraPaths, `/usr/local/bin/${name}`, `/usr/bin/${name}`, `/bin/${name}`].filter(
    Boolean,
  );
  for (const bin of candidates) {
    try {
      const result = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
      if (result.status === 0) return bin;
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  return null;
}

let cwebpCached;
/** Binary cwebp (paket `webp`) sebagai cadangan kalau ffmpeg tanpa libwebp. */
export function resolveCwebp() {
  if (cwebpCached !== undefined) return cwebpCached;
  cwebpCached = resolveBinary('cwebp');
  return cwebpCached;
}

let webpSupport;
/**
 * Encoder WebP yang tersedia: 'ffmpeg' (libwebp) | 'cwebp' | null.
 * Beberapa build ffmpeg tidak menyertakan libwebp, sehingga stiker gagal —
 * dengan cek ini kita bisa kasih pesan yang jelas atau memakai cwebp.
 */
export function webpEncoder() {
  if (webpSupport !== undefined) return webpSupport;
  if (hasFfmpeg()) {
    try {
      const output =
        spawnSync(ffmpegPath(), ['-hide_banner', '-encoders'], {
          encoding: 'utf8',
          timeout: 20000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).stdout || '';
      if (/libwebp/.test(output)) {
        webpSupport = 'ffmpeg';
        return webpSupport;
      }
    } catch {
      /* lanjut ke cwebp */
    }
  }
  webpSupport = resolveCwebp() ? 'cwebp' : null;
  return webpSupport;
}

/** Apakah buffer ini WebP animasi (punya chunk ANIM/ANMF)? */
export function isAnimatedWebp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) return false;
  if (buffer.subarray(0, 4).toString() !== 'RIFF') return false;
  if (buffer.subarray(8, 12).toString() !== 'WEBP') return false;
  return buffer.includes(Buffer.from('ANIM')) || buffer.includes(Buffer.from('ANMF'));
}

/** Apakah buffer ini GIF (87a/89a)? */
export function isGif(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return false;
  return buffer.subarray(0, 3).toString() === 'GIF';
}

/**
 * Tebak jenis media dari ISI berkas (bukan dari mimetype pesan, yang sering
 * keliru — mis. GIF dikirim sebagai dokumen application/octet-stream).
 * @returns {Promise<{kind: 'gif'|'animated'|'image'|'video'|'sticker'|'other', mime: string}>}
 */
export async function detectMediaKind(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { kind: 'other', mime: '' };
  if (isGif(buffer)) return { kind: 'gif', mime: 'image/gif' };
  if (isAnimatedWebp(buffer)) return { kind: 'animated', mime: 'image/webp' };

  try {
    const type = await fileTypeFromBuffer(buffer);
    const mime = type?.mime || '';
    if (mime === 'image/gif') return { kind: 'gif', mime };
    if (mime === 'image/webp') return { kind: isAnimatedWebp(buffer) ? 'animated' : 'image', mime };
    if (mime.startsWith('image/')) return { kind: 'image', mime };
    if (mime.startsWith('video/')) return { kind: 'video', mime };
    if (mime === 'application/x-tgsticker') return { kind: 'sticker', mime };
    return { kind: 'other', mime };
  } catch {
    return { kind: 'other', mime: '' };
  }
}

function assertWebp(buffer, label) {
  if (!buffer?.length) throw new Error(`${label}: hasil konversi kosong`);
  if (buffer.length < 16 || buffer.subarray(8, 12).toString() !== 'WEBP') {
    throw new Error(`${label}: hasil konversi bukan berkas WebP yang sah`);
  }
  return buffer;
}

/** Encode gambar memakai cwebp (cadangan bila ffmpeg tanpa libwebp). */
async function cwebpEncode(buffer, { quality = 70, size = 512 } = {}) {
  const bin = resolveCwebp();
  if (!bin) throw new Error('cwebp tidak ditemukan');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-cwebp-'));
  const input = path.join(dir, 'input.img');
  const output = path.join(dir, 'output.webp');
  try {
    fs.writeFileSync(input, buffer);
    await runProcess(bin, ['-quiet', '-q', String(quality), '-resize', String(size), '0', '-o', output, input], null, {
      timeout: 60000,
      label: 'cwebp',
    });
    return fs.readFileSync(output);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const SCALE = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';

const NO_WEBP_HINT =
  'Stiker butuh encoder WebP. Pasang ffmpeg yang menyertakan libwebp (`apt install ffmpeg`) atau paket `webp` (perintah cwebp).';

/** Gambar (jpg/png/webp) -> stiker webp statis. */
export async function imageToWebp(buffer) {
  const encoder = webpEncoder();
  if (encoder === 'cwebp') return assertWebp(await cwebpEncode(buffer), 'cwebp');
  if (encoder !== 'ffmpeg') throw new Error(NO_WEBP_HINT);

  const result = await runFfmpeg(
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
      '-frames:v', '1',
      '-f', 'webp',
      'pipe:1',
    ],
    buffer,
  );
  return assertWebp(result, 'ffmpeg');
}

/** Video/gif -> stiker webp animasi. */
export async function videoToWebp(buffer, { seconds = 10, fps = 15 } = {}) {
  const encoder = webpEncoder();
  if (encoder === 'cwebp') throw new Error('Stiker animasi butuh ffmpeg dengan libwebp (cwebp hanya untuk gambar diam).');
  if (encoder !== 'ffmpeg') throw new Error(NO_WEBP_HINT);

  const result = await runFfmpeg(
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vcodec', 'libwebp',
      '-vf', `fps=${fps},${SCALE}`,
      '-loop', '0',
      '-preset', 'default',
      '-an',
      '-t', String(seconds),
      '-f', 'webp',
      'pipe:1',
    ],
    buffer,
  );
  return assertWebp(result, 'ffmpeg');
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
  runProcess,
  webpEncoder,
  resolveCwebp,
  resolveBinary,
  isAnimatedWebp,
  isGif,
  detectMediaKind,
  hasDrawtext,
  resolveFont,
  escapeDrawtext,
  wrapMemeText,
  buildMemeFilter,
  drawMemeText,
};
