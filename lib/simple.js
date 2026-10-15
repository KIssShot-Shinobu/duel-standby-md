/**
 * Helper tambahan yang ditempelkan ke socket Baileys (conn),
 * supaya plugin bisa memakai API ringkas bergaya RTXZY-MD:
 *   conn.reply, conn.sendImage, conn.sendImageAsSticker, conn.getName, ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanJid, bareNumber, safeFileName } from './functions.js';
import print from './print.js';
import media from './media.js';

export function attachHelpers(conn, { config, logger = console } = {}) {
  const tmpDir = config?.media?.tmpDir || path.resolve('tmp');
  const maxStickerSeconds = config?.media?.maxStickerSeconds ?? 10;
  const packname = config?.bot?.packname || '';
  const author = config?.bot?.author || '';

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch {
    /* ignore */
  }

  const nameCache = new Map();
  conn.names = nameCache;

  conn.getName = async (jid) => nameCache.get(cleanJid(jid)) || bareNumber(jid);
  conn.setName = (jid, name) => {
    if (jid && name) nameCache.set(cleanJid(jid), String(name));
  };

  const quoted = (target) => (target ? { quoted: target } : undefined);

  // Bungkus sendMessage supaya setiap pesan KELUAR dari bot tampil di terminal
  // (sebelumnya hanya pesan masuk yang di-log via printMessage/printCommand).
  if (typeof conn.sendMessage === 'function' && !conn.sendMessage.__logged) {
    const originalSend = conn.sendMessage.bind(conn);
    const wrapped = async (chat, content = {}, options = {}) => {
      try {
        const text = print.outgoingPreview(content);
        const skip = !text && !content?.sticker && !content?.image && !content?.video && !content?.audio && !content?.document && !content?.react && !content?.delete;
        if (!skip) {
          print.printOutgoing({
            chat,
            content,
            isGroup: String(chat || '').endsWith('@g.us'),
            timeZone: config?.bot?.timezone,
          });
        }
      } catch {
        /* log terminal tidak boleh menggagalkan kirim */
      }
      return originalSend(chat, content, options);
    };
    wrapped.__logged = true;
    conn.sendMessage = wrapped;
  }

  conn.reply = (chat, text, target, options = {}) =>
    conn.sendMessage(chat, { text: String(text ?? ''), ...options }, quoted(target));

  conn.sendText = (chat, text, target, options = {}) => conn.reply(chat, text, target, options);

  conn.sendImage = (chat, buffer, caption = '', target, options = {}) =>
    conn.sendMessage(chat, { image: buffer, caption, ...options }, quoted(target));

  conn.sendVideo = (chat, buffer, caption = '', target, options = {}) =>
    conn.sendMessage(chat, { video: buffer, caption, ...options }, quoted(target));

  conn.sendAudio = (chat, buffer, { ptt = false, mimetype = 'audio/mpeg', target, ...options } = {}) =>
    conn.sendMessage(chat, { audio: buffer, ptt, mimetype, ...options }, quoted(target));

  conn.sendDocument = (chat, buffer, filename = 'file', caption = '', target, options = {}) =>
    conn.sendMessage(
      chat,
      { document: buffer, fileName: safeFileName(filename), caption, mimetype: options.mimetype, ...options },
      quoted(target),
    );

  conn.sendSticker = (chat, webpBuffer, target) =>
    conn.sendMessage(chat, { sticker: webpBuffer }, quoted(target));

  const tmpFile = (extension) => {
    const file = path.join(tmpDir, `sticker-${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    return file;
  };

  /**
   * Gambar -> stiker. Mengembalikan path file sementara (kompatibel RTXZY:
   * plugin lama biasanya memanggil fs.unlinkSync(path)).
   */
  conn.sendImageAsSticker = async (chat, buffer, target, options = {}) => {
    const webp = await media.addExif(await media.imageToWebp(buffer), {
      packname: options.packname ?? packname,
      author: options.author ?? author,
    });
    const file = tmpFile('webp');
    fs.writeFileSync(file, webp);
    await conn.sendSticker(chat, webp, target);
    return file;
  };

  /**
   * Video/gif -> stiker animasi.
   * Kalau hasil animasi masih melebihi batas WhatsApp (1 MB), otomatis turun ke
   * stiker statis (frame pertama) supaya user tetap menerima stiker, bukan error.
   *
   * Catatan acuan RTXZY-MD: video/GIF-chat (mp4, gifPlayback) WAJIB ffmpeg —
   * sharp tidak bisa decode mp4. Kalau ffmpeg belum ada, lempar pesan yang jelas
   * (jangan biarkan error mentah "encoder null" yang membingungkan).
   */
  conn.sendVideoAsSticker = async (chat, buffer, target, options = {}) => {
    const seconds = options.seconds ?? maxStickerSeconds;
    const pack = { packname: options.packname ?? packname, author: options.author ?? author };

    let webp;
    try {
      webp = await media.addExif(await media.videoToWebp(buffer, { seconds }), pack);
    } catch (err) {
      let hint = '';
      if (!media.hasFfmpeg()) {
        hint = '\nPasang ffmpeg: Windows `winget install Gyan.FFmpeg`, Linux `apt install ffmpeg`.';
      } else if (media.webpEncoder && media.webpEncoder() !== 'ffmpeg') {
        hint = '\nffmpeg ada tapi tanpa encoder libwebp — pasang ffmpeg full (`apt install ffmpeg`) lalu restart bot.';
      }
      throw new Error(`${err?.message || err}${hint}`);
    }
    let fellBack = false;
    if (webp.length > media.MAX_STICKER_BYTES) {
      fellBack = true;
      logger?.warn?.(
        `[sticker] animasi ${(webp.length / 1024).toFixed(0)}KB melebihi batas WhatsApp — dialihkan ke stiker statis`,
      );
      try {
        webp = await media.addExif(await media.imageToWebp(buffer), pack);
      } catch {
        /* video mp4 tidak bisa jadi statis via sharp tanpa ffmpeg — pakai hasil animasi */
        fellBack = false;
      }
    }
    logger?.debug?.(`[sticker] webp ${(webp.length / 1024).toFixed(0)}KB${fellBack ? ' (statis)' : ' (animasi)'}`);

    const file = tmpFile('webp');
    fs.writeFileSync(file, webp);
    await conn.sendSticker(chat, webp, target);
    return file;
  };

  logger?.debug?.('[simple] helper conn terpasang');
  return conn;
}

export default attachHelpers;
