/**
 * Ping / kecepatan respons + ringkasan runtime.
 *   .ping
 */
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { ok, joinLines, thinking } from '../lib/messages.js';

const handler = async (m, { conn, db, plugins, runtime }) => {
  const start = performance.now();
  const sent = await m.reply(thinking());
  const latency = Math.round(performance.now() - start);

  const mem = process.memoryUsage();
  const usedRam = (os.totalmem() - os.freemem()) / 1024 ** 3;
  const totalRam = os.totalmem() / 1024 ** 3;
  const stats = db.stats();
  const uptime = runtime?.startedAt ? Date.now() - runtime.startedAt : process.uptime() * 1000;
  const jam = Math.floor(uptime / 3600000);
  const menit = Math.floor(uptime / 60000) % 60;
  const detik = Math.floor(uptime / 1000) % 60;

  const text = joinLines([
    `🏓 *Pong!* ${ok(`${latency} ms`)}`,
    '',
    `🕒 Uptime: ${jam}j ${menit}m ${detik}s`,
    `🔌 Koneksi: ${runtime?.connected ? 'nyambung' : 'putus'}`,
    `🧩 Plugin: ${plugins.size} file`,
    `👥 User: ${stats.users} · 💬 Chat: ${stats.chats} · 📨 Pesan: ${stats.messages}`,
    '',
    `🖥️ Server: ${os.platform()} ${os.arch()} · ${os.cpus().length} core`,
    `💾 RAM: ${usedRam.toFixed(2)} / ${totalRam.toFixed(2)} GB`,
    `🧠 Heap: ${(mem.heapUsed / 1024 ** 2).toFixed(1)} MB`,
  ]);

  if (sent?.key) {
    await conn.sendMessage(m.chat, { text, edit: sent.key }).catch(() => m.reply(text));
  } else {
    await m.reply(text);
  }
};

handler.help = ['ping', 'speed'];
handler.tags = ['main'];
handler.command = /^(ping|speed|pong)$/i;
handler.limit = false;

export default handler;
