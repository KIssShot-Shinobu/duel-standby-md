/**
 * Broadcast pesan ke semua chat yang pernah berinteraksi dengan bot.
 *   .broadcast Pesan yang mau dikirim
 */
import { sleep } from '../lib/functions.js';

const handler = async (m, { conn, text, db, config, wait }) => {
  if (!text) return m.reply(`Contoh: ${config.bot.prefix[0]}broadcast Halo semua, bot baru saja diperbarui!`);

  const targets = Object.entries(db.data.chats)
    .filter(([jid, chat]) => jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net'))
    .filter(([, chat]) => !chat.mute)
    .map(([jid]) => jid);

  if (!targets.length) return m.reply('Belum ada chat yang tercatat di database.');

  const done = await wait();
  let sent = 0;
  let failed = 0;

  for (const jid of targets) {
    try {
      await conn.sendMessage(jid, { text: `📢 *BROADCAST*\n\n${text}` });
      sent += 1;
    } catch {
      failed += 1;
    }
    await sleep(1500); // jeda supaya tidak dianggap spam oleh WhatsApp
  }

  await done(`📢 Broadcast selesai.\n\n✅ Terkirim: ${sent}\n❌ Gagal: ${failed}\n🎯 Total: ${targets.length}`);
  db.touch();
};

handler.help = ['broadcast'];
handler.tags = ['owner'];
handler.command = /^(broadcast|bc)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
