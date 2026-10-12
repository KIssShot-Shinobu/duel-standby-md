/**
 * Ubah video/audio menjadi mp3.
 *   .tomp3  -> reply video/audio
 */
import { toAudio } from '../lib/media.js';

const handler = async (m, { conn, config, usedPrefix, command }) => {
  const target = m.quoted && m.quoted.msg?.mimetype ? m.quoted : m;
  const mime = target.msg?.mimetype || '';

  if (!/audio|video|ogg|mp4|mpeg/i.test(mime)) {
    throw `Reply video/audio dengan caption *${usedPrefix}${command}*`;
  }

  await m.reply(config.messages.wait);
  const buffer = await target.download();
  const mp3 = await toAudio(buffer);
  return conn.sendAudio(m.chat, mp3, { ptt: false, mimetype: 'audio/mpeg', target: m });
};

handler.help = ['tomp3', 'toaudio'];
handler.tags = ['tools'];
handler.command = /^(tomp3|toaudio|tomp4)$/i;
handler.limit = true;

export default handler;
