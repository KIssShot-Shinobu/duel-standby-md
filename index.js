/**
 * Supervisor: menjaga main.js tetap hidup + menyediakan HTTP health check.
 *
 *   node index.js                 -> bot + health server
 *   node index.js --qr            -> login pakai QR
 *   node index.js --pair 628xxx   -> login pakai pairing code
 *
 * Setiap kali main.js mati, supervisor menyalakannya kembali (dengan backoff),
 * jadi bot tetap online walau ada error tak terduga.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import config from './config.js';
import logger from './lib/logger.js';
import print from './lib/print.js';
import { startHealthServer } from './lib/health.js';

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) {
  console.error(`❌ Node.js ${process.versions.node} tidak didukung. Pakai Node.js 20.11+ (disarankan 22).`);
  process.exit(1);
}

let child = null;
let shuttingDown = false;
let restarts = 0;

/** Path relatif dengan pemisah '/' supaya log tetap rapi di Windows. */
const relPath = (target) => (path.relative(config.root, target) || target).split(path.sep).join('/');

async function startHealth() {
  if (!config.flags.health) return null;
  try {
    const health = await startHealthServer({
      port: config.health.port,
      host: config.health.host,
      statusFile: config.health.statusFile,
      meta: { author: config.bot.name, version: config.version },
    });
    print.kv('Health', `${health.url} • GET / dan GET /health`, { tag: 'success' });
    return health;
  } catch (err) {
    print.warn(`Health server gagal start: ${err.message}`);
    return null;
  }
}

function startBot() {
  if (shuttingDown) return;
  const script = path.resolve(config.root, 'main.js');
  const args = [script, ...process.argv.slice(2)];

  child = spawn(process.execPath, args, {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: process.env,
  });

  child.on('message', (message) => {
    if (message === 'restart') {
      print.info('Restart diminta plugin...');
      child?.kill('SIGTERM');
      return;
    }
    if (message === 'uptime') child?.send(process.uptime());
  });

  child.on('error', (err) => {
    print.error(`Gagal menjalankan ${script}: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    const wasRunning = Boolean(child);
    child = null;
    if (shuttingDown || !wasRunning) return;
    if (config.flags.test) {
      // Mode pengujian: jangan restart, cukup keluar mengikuti kode anak.
      print.info(`Mode --test: bot keluar dengan kode ${code ?? 0}, supervisor tidak restart.`);
      shutdown('test-mode').catch(() => process.exit(code ?? 0));
      return;
    }
    restarts += 1;
    const wait = Math.min(15000, 1000 * restarts);
    print.warn(`Bot berhenti (kode=${code ?? 'null'} signal=${signal ?? 'null'}). Restart dalam ${wait} ms...`);
    setTimeout(startBot, wait).unref?.();
  });
}

const health = await startHealth();
if (!config.flags.health) print.warn('Health server dimatikan (--no-health).');

startBot();
print.rows([
  ['Supervisor', 'aktif — bot dijalankan ulang otomatis kalau berhenti'],
  ['Mode', `${config.bot.mode} • prefix "${config.bot.prefix.join('')}"`],
  ['Database', relPath(config.database.file)],
]);

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  print.warn(`Menerima ${signal}, menghentikan bot...`);
  try {
    child?.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  try {
    await health?.close?.();
  } catch {
    /* ignore */
  }
  logger.flush?.();
  process.exit(0);
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal).catch(() => process.exit(1));
  });
}
