/**
 * Ubah audio/video menjadi voice note (ptt).
 *   .tovn  -> reply audio/video
 */
import { toPTT } from '../lib/media.js';

const handler = async (m, { conn, config, usedPrefix, command }) => {
  const target = m.quoted && m.quoted.msg?.mimetype ? m.quoted : m;
  const mime = target.msg?.mimetype || '';

  if (!/audio|video|ogg|mp4|mpeg/i.test(mime)) {
    throw `Reply audio atau video dengan caption *${usedPrefix}${command}*`;
  }

  await m.reply(config.messages.wait);
  const buffer = await target.download();
  const ogg = await toPTT(buffer);
  return conn.sendAudio(m.chat, ogg, { ptt: true, mimetype: 'audio/ogg; codecs=opus', target: m });
};

handler.help = ['tovn', 'tovoice'];
handler.tags = ['tools'];
handler.command = /^(tovn|tovoice|toptv)$/i;
handler.limit = true;

export default handler;
