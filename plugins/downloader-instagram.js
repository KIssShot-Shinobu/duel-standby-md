/**
 * Unduh media Instagram (video/reel DAN gambar/carousel) memakai yt-dlp — tanpa API key.
 *   .ig https://www.instagram.com/p/xxxx
 *   .ig https://www.instagram.com/reel/xxxx
 *
 * Satu post carousel bisa berisi beberapa foto/video; semuanya dikirim
 * berurutan — foto sebagai gambar, video sebagai video (ditebak dari isi
 * berkasnya, bukan dari link).
 *
 * Instagram makin sering menolak yt-dlp tanpa login ("rate-limit reached or
 * login required"). Untuk post FOTO ada jalur publik tanpa cookies: oembed
 * (caption/penulis) + `/p/<kode>/media/?size=l` (JPEG ukuran penuh). Jalur itu
 * hanya dipakai kalau yt-dlp gagal, dan tidak dipakai untuk reel/tv karena di
 * sana yang didapat cuma sampul video.
 *
 * Catatan jujur: post privat tetap butuh cookies (`YTDLP_COOKIES` ke file hasil
 * ekspor browser).
 */
import { hasYtDlp, ytDlpDownloadAll, ytDlpInstallHint, detectMediaKind } from '../lib/media.js';
import { formatBytes } from '../lib/functions.js';
import { userError } from '../lib/errors.js';

const IG_URL = /^https?:\/\/(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:p|reel|reels|tv|share)(?:\/[\w-]+)+/i;

/** UA browser: tanpa ini oembed & endpoint media dibalas halaman login. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Link post/reel/tv/share Instagram (bukan profil, bukan situs lain). */
export function isInstagramUrl(url) {
  return IG_URL.test(String(url || '').trim());
}

/** Jenis + shortcode dari link Instagram (`p`, `reel`, `tv`, ...). */
export function instagramShortcode(url) {
  const match = String(url || '').match(/instagram\.com\/(p|reel|reels|tv|share)\/([\w-]+)/i);
  return match ? { kind: match[1].toLowerCase(), code: match[2] } : null;
}

/**
 * Post foto publik tanpa cookies: oembed untuk caption/penulis, lalu endpoint
 * media untuk JPEG ukuran penuh (biasanya 1080px).
 * @returns {Promise<{buffer: Buffer, caption: string}>}
 */
export async function fetchPublicPhoto(url, code) {
  const metaRes = await fetch(`https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!metaRes.ok) throw new Error(`oembed ${metaRes.status}`);
  const meta = await metaRes.json();

  const imgRes = await fetch(`https://www.instagram.com/p/${code}/media/?size=l`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!imgRes.ok) throw new Error(`media ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('media bukan JPEG');

  const text = String(meta.title || '').trim().slice(0, 800);
  const author = String(meta.author_name || '').trim();
  return {
    buffer,
    caption: ['📸 *Instagram*', author ? `👤 @${author}` : null, text || null].filter(Boolean).join('\n'),
  };
}

const handler = async (m, { conn, text, config, usedPrefix, command, wait }) => {
  const url =
    String(text || '').trim().split(/\s+/)[0] || String(m.quoted?.text || '').trim().split(/\s+/)[0];
  if (!url) return m.reply(`Contoh: ${usedPrefix}${command} https://www.instagram.com/p/xxxx`);
  if (!isInstagramUrl(url)) {
    return m.reply('Link itu bukan post Instagram. Pakai link post/reel, mis. https://www.instagram.com/p/xxxx');
  }

  const target = instagramShortcode(url);
  const ytDlpReady = hasYtDlp(config.ytdlp.path);
  if (!ytDlpReady && target?.kind !== 'p') return m.reply(ytDlpInstallHint(config));

  // wait() mengirim pesan tunggu dan mengembalikan fungsi untuk meng-editnya.
  const update = await wait();

  let buffers = [];
  let ytError = null;
  if (ytDlpReady) {
    try {
      buffers = await ytDlpDownloadAll(url, {
        // format 'video' berakhir di fallback `/b` yang juga menangkap format
        // gambar — post carousel (foto) tetap terunduh lewat jalur yang sama.
        format: 'video',
        height: config.ytdlp.maxHeight,
        maxDuration: config.ytdlp.maxDurationSeconds,
        customPath: config.ytdlp.path,
      });
    } catch (err) {
      ytError = err;
    }
  }

  // yt-dlp ditolak (login/rate-limit) atau tidak ada: coba jalur foto publik.
  if (!buffers.length && target?.kind === 'p') {
    try {
      const { buffer, caption } = await fetchPublicPhoto(url, target.code);
      if (buffer.length > config.media.maxUploadBytes) {
        throw userError(`Media terlalu besar (${formatBytes(buffer.length)}) untuk dikirim WhatsApp.`);
      }
      await conn.sendImage(m.chat, buffer, caption, m);
      if (typeof update === 'function') await update(`✅ Foto Instagram terkirim • ${formatBytes(buffer.length)}`);
      return buffer.length;
    } catch (err) {
      // Simpan sebagai error terakhir supaya pesan yang tampil tetap informatif.
      ytError = err;
    }
  }

  if (!buffers.length) {
    if (!ytDlpReady) return m.reply(ytDlpInstallHint(config));
    if (/login|rate|429|cookies|sign in|restricted|oembed|media/i.test(ytError?.message || '')) {
      throw userError(
        [
          'Instagram menolak permintaan ini (butuh login / kena rate-limit).',
          '💡 Ekspor cookies browser ke file lalu set `YTDLP_COOKIES=/path/cookies.txt` di server.',
        ].join('\n'),
      );
    }
    throw ytError || userError('Gagal mengunduh media Instagram.');
  }

  const sent = [];
  let total = 0;
  for (const buffer of buffers) {
    if (buffer.length > config.media.maxUploadBytes) continue;

    // Jenis media ditebak dari ISI buffer — carousel IG bisa campur foto & video.
    const { kind } = await detectMediaKind(buffer);
    const caption = [
      '📸 *Instagram*',
      buffers.length > 1 ? `🎞️ ${sent.length + 1}/${buffers.length}` : null,
      `📦 ${formatBytes(buffer.length)}`,
    ]
      .filter(Boolean)
      .join('\n');

    if (kind === 'image') await conn.sendImage(m.chat, buffer, caption, m);
    else if (kind === 'video') await conn.sendVideo(m.chat, buffer, caption, m);
    else await conn.sendDocument(m.chat, buffer, 'media', '', m);

    sent.push(buffer);
    total += buffer.length;
  }

  if (!sent.length) {
    throw userError(
      `Media terlalu besar (${formatBytes(buffers.reduce((n, b) => n + b.length, 0))}) untuk dikirim WhatsApp.\n💡 Turunkan kualitas lewat env \`YTDLP_MAX_HEIGHT\` (sekarang ${config.ytdlp.maxHeight}p).`,
    );
  }

  const skipped = buffers.length - sent.length;
  if (typeof update === 'function') {
    await update(`✅ ${sent.length} media Instagram terkirim.` + (skipped ? `\n⚠️ ${skipped} media dilewati (terlalu besar).` : ''));
  }
  return total;
};

handler.help = ['instagram', 'ig'];
handler.tags = ['downloader'];
handler.command = /^(instagram|insta|ig|igdl)$/i;
handler.limit = true;

export default handler;
