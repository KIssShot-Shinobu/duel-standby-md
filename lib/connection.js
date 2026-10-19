/**
 * Koneksi WhatsApp via Baileys (multi-device).
 *  - mode default: pairing code (--pair 628xxx) atau QR (--qr / tanpa pairing)
 *  - sesi disimpan di sessions/ (multi-file auth state)
 *  - auto reconnect dengan backoff, berhenti kalau sesi logout
 */
import fs from 'node:fs';
import NodeCache from 'node-cache';
import qrcode from 'qrcode-terminal';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { attachHelpers } from './simple.js';
import { createGroupCache } from './permissions.js';
import { cleanJid } from './functions.js';
import { baileysLogger } from './logger.js';
import { hasUsableSession, sessionInfo, shouldRequestPairing } from './session.js';

const MAX_BACKOFF = 30000;

const prettyPairingCode = (code) => String(code).match(/.{1,4}/g)?.join('-') || code;

export async function createConnection({
  config,
  logger = console,
  handlers = {},
  showQr = true,
} = {}) {
  fs.mkdirSync(config.session.dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(config.session.dir);
  const groupCache = createGroupCache();
  const msgRetryCounterCache = new NodeCache();

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    version = undefined;
  }

  const holder = { conn: null };
  let stopped = false;
  let attempts = 0;
  let pairingRequested = false;
  let pairingTimer = null;
  /** Sudah pernah tersambung (login berhasil) di proses ini. */
  let openedOnce = false;

  const current = () => holder.conn;

  const cancelPairing = () => {
    if (pairingTimer) {
      clearTimeout(pairingTimer);
      pairingTimer = null;
    }
  };

  const handleConnectionUpdate = (conn, update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && showQr) {
      console.log('\n📱 Scan QR di bawah ini dengan WhatsApp (Perangkat Tertaut):\n');
      qrcode.generate(qr, { small: !config.flags.bigQr });
      console.log('');
      logger?.info?.('[connection] QR baru dibuat');
    }

    if (connection === 'connecting') {
      handlers.onConnecting?.(conn);
      logger?.info?.('[connection] menyambung ke WhatsApp...');
    }

    if (connection === 'open') {
      attempts = 0;
      openedOnce = true;
      cancelPairing(); // sesi sudah login: JANGAN minta pairing code lagi
      handlers.onOpen?.(conn);
      logger?.info?.('[connection] tersambung');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      if (loggedOut) cancelPairing();
      handlers.onClose?.(conn, { statusCode, loggedOut });

      if (stopped) return;
      if (loggedOut) {
        logger?.error?.(
          `[connection] sesi logout (kode ${statusCode}). Hapus folder ${config.session.dir} lalu pairing ulang.`,
        );
        handlers.onLoggedOut?.();
        return;
      }

      attempts += 1;
      const wait = Math.min(MAX_BACKOFF, 2000 * attempts);
      logger?.warn?.(`[connection] terputus (kode ${statusCode ?? 'unknown'}), mencoba lagi dalam ${wait} ms`);
      setTimeout(() => {
        start().catch((err) => logger?.error?.(`[connection] reconnect gagal: ${err.message}`));
      }, wait).unref?.();
    }
  };

  async function start() {
    if (stopped) return null;
    const conn = makeWASocket({
      version,
      logger: baileysLogger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      msgRetryCounterCache,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
      getMessage: async () => undefined,
      cachedGroupMetadata: async (jid) => {
        const sock = holder.conn;
        if (!sock) return undefined;
        return (await groupCache.get(sock, jid)) || undefined;
      },
    });

    holder.conn = conn;
    // `globalThis.conn` WAJIB selalu menunjuk socket yang hidup: sweep berkala di
    // main.js (jadwal sholat, pengingat sewa) dan plugin lama mengirim lewat
    // global ini. Dulu global diisi sekali saat start pertama, sehingga setelah
    // reconnect ia menunjuk socket LAMA yang sudah tertutup — pengirimannya gagal
    // dengan "Connection Closed" padahal pesan masuk tetap jalan (handler memakai
    // `conn` yang baru). Karena itu disegarkan di sini, tempat socket dibuat.
    globalThis.conn = conn;
    attachHelpers(conn, { config, logger });

    conn.ev.on('creds.update', saveCreds);

    conn.ev.on('connection.update', (update) => handleConnectionUpdate(conn, update));

    conn.ev.on('messages.upsert', ({ messages, type }) => {
      for (const raw of messages || []) {
        if (!raw?.message) continue;
        const senderJid = raw.key?.participant || raw.key?.remoteJid;
        if (senderJid && raw.pushName && !raw.key?.fromMe) conn.setName?.(cleanJid(senderJid), raw.pushName);
        handlers.onMessage?.(conn, raw, type);
      }
    });

    conn.ev.on('group-participants.update', (update) => {
      groupCache.invalidate(update?.id);
      handlers.onGroupParticipants?.(conn, update);
    });

    conn.ev.on('groups.update', (updates) => {
      for (const update of updates || []) groupCache.invalidate(update?.id);
      handlers.onGroupsUpdate?.(conn, updates);
    });

    conn.ev.on('call', (calls) => handlers.onCall?.(conn, calls));

    // Minta pairing code HANYA kalau benar-benar belum punya sesi:
    //  - `--qr` tidak minta pairing code;
    //  - sesi yang sudah login (registered ATAU punya me.id, mis. hasil QR)
    //    tidak boleh minta pairing code — WhatsApp akan mematikan sesi (401);
    //  - dibatalkan juga kalau socket sudah 'open' sebelum jeda habis.
    const info = sessionInfo(config.session.dir);
    const decision = shouldRequestPairing({
      pair: config.flags.pair,
      qr: config.flags.qr,
      sessionDir: config.session.dir,
    });
    const pairingAllowed = decision.allowed;

    if (config.flags.pair && decision.reason === 'session-exists') {
      logger?.info?.(
        `[connection] sesi sudah login (me=${info.me || '-'}, registered=${info.registered}) — pairing code tidak diminta.`,
      );
    }

    if (pairingAllowed && !state.creds.registered && !pairingRequested) {
      pairingRequested = true;
      pairingTimer = setTimeout(async () => {
        pairingTimer = null;
        // Cek ulang: bisa saja sudah tersambung / sesi tersimpan saat jeda.
        if (stopped || openedOnce || state.creds.registered || state.creds.me?.id || hasUsableSession(config.session.dir)) {
          logger?.info?.('[connection] pairing code dibatalkan (sesi sudah aktif).');
          return;
        }
        try {
          const code = await conn.requestPairingCode(config.flags.pair);
          logger?.info?.(`[connection] pairing code: ${code}`);
          handlers.onPairingCode?.(prettyPairingCode(code), code);
        } catch (err) {
          pairingRequested = false;
          logger?.error?.(`[connection] gagal minta pairing code: ${err.message}`);
        }
      }, config.session.pairingDelay).unref?.();
    }

    return conn;
  }

  await start();

  return {
    get conn() {
      return holder.conn;
    },
    getConn: current,
    groupCache,
    state,
    saveCreds,
    version,
    async stop() {
      stopped = true;
      cancelPairing();
      try {
        holder.conn?.end?.(new Error('bot dihentikan'));
      } catch {
        /* ignore */
      }
    },
    get stopped() {
      return stopped;
    },
  };
}

export default createConnection;
