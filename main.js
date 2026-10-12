/**
 * Entry point bot (dijalankan oleh index.js, atau langsung: node main.js).
 *
 * Tugasnya: siapkan database, muat plugin, sambungkan ke WhatsApp,
 * dan teruskan event ke handler.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import logger from './lib/logger.js';
import print from './lib/print.js';
import { initDatabase } from './lib/database.js';
import { PluginManager } from './lib/plugins.js';
import { createApi } from './lib/api.js';
import { createConnection } from './lib/connection.js';
import { startHealthServer, writeStatus } from './lib/health.js';
import { hasFfmpeg, hasYtDlp } from './lib/media.js';
import { dispatchCall, dispatchGroupParticipants, dispatchGroupsUpdate, handleMessage } from './handler.js';

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) {
  console.error(`❌ Node.js ${process.versions.node} tidak didukung. Pakai Node.js 20.11+ (disarankan 22).`);
  process.exit(1);
}

process.env.TZ = process.env.TZ || config.bot.timezone;

const runtime = {
  connected: false,
  connecting: false,
  botNumber: null,
  botName: null,
  startedAt: Date.now(),
  lastMessageAt: null,
  pairingCode: null,
  healthUrl: null,
  errors: 0,
};

const dirs = [config.session.dir, config.media.tmpDir, path.dirname(config.database.file)];
for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });

print.banner(`🜲 ${config.bot.name}`, `v${config.version}`);

// ── Database ────────────────────────────────────────────────────────────
const db = await initDatabase(config, logger);
print.success(`Database siap: ${db.stats().file} (${db.stats().users} user, ${db.stats().chats} chat)`);

// ── Plugin ──────────────────────────────────────────────────────────────
const pluginsDir = path.resolve(config.root, 'plugins');
const plugins = new PluginManager(pluginsDir, { logger });
await plugins.loadAll();
const summary = plugins.summary();
print.success(
  `Plugin dimuat: ${summary.total} file, ${summary.commands} command, ${summary.hooks} hook${summary.errors ? `, ${summary.errors} error` : ''}`,
);

if (config.flags.reload) {
  plugins.watch((event) => {
    if (event.type === 'error') print.error(`Hot reload ${path.basename(event.file)}: ${event.message}`);
    else print.info(`Hot reload ${event.type}: ${path.basename(event.file)}`);
  });
}

// ── Global compatibility (plugin lama RTXZY/wabot-aq memakai global.*) ──
const legacyGlobals = {
  owner: config.bot.owners,
  mods: config.bot.mods,
  prems: config.bot.premiumJids.map((jid) => jid.split('@')[0]),
  nameowner: config.bot.ownerName,
  numberowner: config.bot.owners[0] || '',
  wm: config.bot.name,
  packname: config.bot.packname,
  author: config.bot.author,
  prefix: config.bot.prefix.join(''),
  wait: config.messages.wait,
  eror: config.messages.error,
  stiker_wait: config.messages.stickerWait,
  db,
  config,
  plugins,
  runtime,
};
for (const [key, value] of Object.entries(legacyGlobals)) globalThis[key] = value;

const api = createApi(config);

// ── Status & health ─────────────────────────────────────────────────────
function statusPayload(extra = {}) {
  return {
    bot: config.bot.name,
    version: config.version,
    mode: config.bot.mode,
    connected: runtime.connected,
    botNumber: runtime.botNumber,
    pairingCode: runtime.pairingCode,
    uptime: Math.round((Date.now() - runtime.startedAt) / 1000),
    plugins: plugins.summary(),
    database: db.stats(),
    restartCount: runtime.restarts || 0,
    lastMessageAt: runtime.lastMessageAt,
    ...extra,
  };
}

function publishStatus(extra = {}) {
  writeStatus(config.health.statusFile, statusPayload(extra));
}

publishStatus();

// ── Autoclear tmp ───────────────────────────────────────────────────────
function clearTmp(maxAgeMs = 10 * 60 * 1000) {
  if (!config.flags.autocleartmp) return;
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(config.media.tmpDir)) {
      const target = path.join(config.media.tmpDir, file);
      const stat = fs.statSync(target);
      if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(target);
    }
  } catch {
    /* ignore */
  }
}

clearTmp();
setInterval(clearTmp, 10 * 60 * 1000).unref?.();
setInterval(() => publishStatus(), 15000).unref?.();

// ── Mode tanpa koneksi (smoke test / cek instalasi) ─────────────────────
if (config.flags.noConnect) {
  print.warn('Mode --no-connect: bot tidak menyambung ke WhatsApp.');
  print.info(`ffmpeg: ${hasFfmpeg() ? 'tersedia' : 'TIDAK ditemukan (stiker/audio nonaktif)'}`);
  print.info(`yt-dlp: ${hasYtDlp(config.ytdlp.path) ? 'tersedia' : 'TIDAK ditemukan (downloader YouTube nonaktif)'}`);
  print.info(`API eksternal: ${api.configured ? 'terkonfigurasi' : 'kosong (plugin API akan menolak dengan pesan)'}`);
  print.info(`Kategori plugin: ${plugins.categories().map(([tag]) => tag).join(', ')}`);

  if (config.flags.health && !process.send) {
    const health = await startHealthServer({
      port: config.health.port,
      host: config.health.host,
      statusFile: config.health.statusFile,
      meta: { author: config.bot.name, version: config.version },
    });
    runtime.healthUrl = health.url;
    print.success(`Health server: ${health.url} (GET / dan GET /health)`);
    if (config.flags.test) {
      print.info('Mode --test: keluar setelah health check siap.');
    }
  }

  if (config.flags.test) {
    await db.save(true);
    plugins.close();
    db.close();
    process.exit(0);
  }

  // Tahan proses tetap hidup supaya bisa diperiksa manual.
  setInterval(() => {}, 1000);
} else {
  // ── Koneksi WhatsApp ──────────────────────────────────────────────────
  const connection = await createConnection({
    config,
    logger,
    showQr: config.flags.qr || !config.flags.pair,
    handlers: {
      onConnecting: () => {
        runtime.connecting = true;
      },
      onOpen: () => {
        runtime.connected = true;
        runtime.connecting = false;
        runtime.botNumber = connection.conn?.user?.id?.split(':')[0]?.split('@')[0] || null;
        runtime.botName = connection.conn?.user?.name || null;
        print.success(`✅ Tersambung sebagai ${runtime.botNumber}`);
        publishStatus({ event: 'open' });
      },
      onClose: (_conn, { statusCode, loggedOut }) => {
        runtime.connected = false;
        print.warn(`Koneksi tertutup (kode ${statusCode ?? 'unknown'}${loggedOut ? ', sesi logout' : ''})`);
        publishStatus({ event: 'close', statusCode });
      },
      onPairingCode: (pretty, raw) => {
        runtime.pairingCode = pretty;
        print.info(`🔑 Pairing code: ${pretty} (masukkan di WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon)`);
        publishStatus({ event: 'pairing' });
        void raw;
      },
      onLoggedOut: () => {
        publishStatus({ event: 'logged-out' });
      },
      onMessage: (conn, raw, type) => {
        runtime.lastMessageAt = Date.now();
        handleMessage(conn, raw, { plugins, db, config, groupCache: connection.groupCache, api, logger, upsertType: type }).catch(
          (err) => {
            runtime.errors += 1;
            logger.error?.(`[main] handleMessage: ${err.stack || err.message}`);
          },
        );
      },
      onGroupParticipants: (conn, update) => {
        dispatchGroupParticipants(conn, update, { plugins, db, config, logger }).catch((err) =>
          logger.error?.(`[main] groupParticipants: ${err.message}`),
        );
      },
      onGroupsUpdate: (conn, updates) => {
        dispatchGroupsUpdate(conn, updates, { plugins, db, config, logger }).catch((err) =>
          logger.error?.(`[main] groupsUpdate: ${err.message}`),
        );
      },
      onCall: (conn, calls) => {
        dispatchCall(conn, calls, { plugins, db, config, logger }).catch((err) =>
          logger.error?.(`[main] call: ${err.message}`),
        );
      },
    },
  });

  globalThis.conn = connection.conn;

  // ── IPC dengan supervisor (index.js) ──────────────────────────────────
  process.on('message', (message) => {
    if (message === 'uptime') process.send?.(process.uptime());
  });

  const shutdown = async (signal) => {
    print.warn(`Menerima ${signal}, mematikan bot...`);
    try {
      plugins.close();
      await connection.stop();
      await db.save(true);
      db.close();
      publishStatus({ event: 'shutdown', signal });
    } finally {
      process.exit(0);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      shutdown(signal).catch(() => process.exit(1));
    });
  }

  process.on('unhandledRejection', (reason) => {
    runtime.errors += 1;
    logger.error?.(`[main] unhandledRejection: ${reason}`);
  });
  process.on('uncaughtException', (err) => {
    runtime.errors += 1;
    logger.error?.(`[main] uncaughtException: ${err.stack || err.message}`);
  });
}

export { db, plugins, runtime, statusPayload };
