/**
 * Unduh video X/Twitter (mp4) memakai yt-dlp — tanpa API key.
 *   .x https://x.com/user/status/1234567890
 *
 * Satu tweet bisa berisi beberapa video; semuanya dikirim berurutan.
 * Hanya tweet publik — tweet yang butuh login (protected/age-restricted)
 * tidak bisa diunduh tanpa cookies (`YTDLP_COOKIES`).
 */
import { hasFfmpeg, hasYtDlp, ytDlpDownloadAll, ytDlpInstallHint } from '../lib/media.js';
import { formatBytes } from '../lib/functions.js';

const TWEET_URL = /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/[^/\s]+\/status(?:es)?\/\d+(?:[/?#]\S*)?$/i;

/** Link status X/Twitter (bukan profil, bukan t.co). */
export function isTweetUrl(url) {
  return TWEET_URL.test(String(url || '').trim());
}

const handler = async (m, { conn, text, config, usedPrefix, wait }) => {
  const url = String(text || '').trim().split(/\s+/)[0];
  if (!url) return m.reply(`Contoh: ${usedPrefix}x https://x.com/user/status/1234567890`);
  if (!isTweetUrl(url)) return m.reply('Link itu bukan tweet X/Twitter. Pakai link status, mis. https://x.com/user/status/123');

  if (!hasYtDlp(config.ytdlp.path)) {
    return m.reply(ytDlpInstallHint(config));
  }

  // wait() mengirim pesan tunggu dan mengembalikan fungsi untuk mengeditnya.
  const update = await wait();

  let buffers;
  try {
    buffers = await ytDlpDownloadAll(url, {
      format: 'video',
      height: config.ytdlp.maxHeight,
      maxDuration: config.ytdlp.maxDurationSeconds,
      customPath: config.ytdlp.path,
    });
  } catch (err) {
    if (!hasFfmpeg()) {
      throw new Error(
        [
          err.message,
          '',
          '⚠️ *ffmpeg tidak terdeteksi di server.*',
          'Video X biasanya menyimpan video & audio terpisah, jadi butuh ffmpeg untuk menggabungkannya.',
          `Pasang ffmpeg di server, atau turunkan kualitas lewat env \`YTDLP_MAX_HEIGHT\` (sekarang ${config.ytdlp.maxHeight}p).`,
        ].join('\n'),
      );
    }
    throw err;
  }

  const sent = [];
  let total = 0;
  for (const buffer of buffers) {
    if (buffer.length > config.media.maxUploadBytes) continue;
    await conn.sendVideo(
      m.chat,
      buffer,
      [
        '𝕏 *Video X*',
        buffers.length > 1 ? `🎞️ ${sent.length + 1}/${buffers.length}` : null,
        `📦 ${formatBytes(buffer.length)} • maks ${config.ytdlp.maxHeight}p`,
      ]
        .filter(Boolean)
        .join('\n'),
      m,
    );
    sent.push(buffer);
    total += buffer.length;
  }

  if (!sent.length) {
    throw new Error(
      `Video terlalu besar (${formatBytes(buffers.reduce((n, b) => n + b.length, 0))}) untuk dikirim WhatsApp.\n💡 Turunkan kualitas lewat env \`YTDLP_MAX_HEIGHT\` (sekarang ${config.ytdlp.maxHeight}p).`,
    );
  }

  const skipped = buffers.length - sent.length;
  if (typeof update === 'function') {
    await update(`✅ ${sent.length} video X terkirim.` + (skipped ? `\n⚠️ ${skipped} video dilewati (terlalu besar).` : ''));
  }
  return total;
};

handler.help = ['x', 'twitter', 'tw'];
handler.tags = ['downloader'];
handler.command = /^(x|tw|twitter)$/i;
handler.limit = true;

export default handler;
