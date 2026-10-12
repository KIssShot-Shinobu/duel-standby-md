/**
 * Broadcast pesan ke semua chat yang pernah berinteraksi dengan bot.
 *   .broadcast Pesan yang mau dikirim
 */
import { sleep } from '../lib/functions.js';
import { err, joinLines, thinking } from '../lib/messages.js';

const handler = async (m, { conn, text, db, config, wait }) => {
  if (!text) return m.reply(`Contoh: ${config.bot.prefix[0]}broadcast Halo semua, bot baru saja diperbarui!`);

  const targets = Object.entries(db.data.chats)
    .filter(([jid]) => jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net'))
    .filter(([, chat]) => !chat.mute)
    .map(([jid]) => jid);

  if (!targets.length) return m.reply(err('Belum ada chat yang tercatat di database.', m));

  const done = await wait(thinking());
  let sent = 0;
  let failed = 0;

  for (const jid of targets) {
    try {
      await conn.sendMessage(jid, { text: `📢 *Broadcast*\n\n${text}` });
      sent += 1;
    } catch {
      failed += 1;
    }
    await sleep(1500);
  }

  await done(joinLines(`*Broadcast selesai*\n\n✅ Terkirim: ${sent}\n❌ Gagal: ${failed}\n🎯 Total: ${targets.length}`));
  db.touch();
};

handler.help = ['broadcast'];
handler.tags = ['owner'];
handler.command = /^(broadcast|bc)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
