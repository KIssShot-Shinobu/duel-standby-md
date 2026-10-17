import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import baseConfig from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';
import * as Rent from '../lib/rent.js';
import { clearCache } from '../lib/sholat-source.js';
import sholatPlugin from '../plugins/sholat.js';

const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const SENDER = '628111@s.whatsapp.net';
const GROUP = '120363046825098789@g.us';

const DEFAULT_CITIES = [
  { id: '1301', lokasi: 'KOTA JAKARTA' },
  { id: '2622', lokasi: 'KOTA MAKASSAR' },
  { id: '3211', lokasi: 'KOTA SOFIFI' },
  { id: '3212', lokasi: 'KOTA SOFIFI' },
];

/** Tiruan MyQuran API v2 — di localhost supaya test tidak menyentuh jaringan nyata. */
async function startFakeApi({ cities = DEFAULT_CITIES, failCities = false, failJadwal = false } = {}) {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    res.setHeader('content-type', 'application/json');

    if (url.startsWith('/v2/sholat/kota/semua')) {
      if (failCities) {
        res.statusCode = 500;
        res.end('{}');
        return;
      }
      res.end(JSON.stringify({ status: true, data: cities }));
      return;
    }

    const match = url.match(/^\/v2\/sholat\/jadwal\/(\d+)\//);
    if (match) {
      if (failJadwal) {
        res.statusCode = 500;
        res.end('{}');
        return;
      }
      res.end(
        JSON.stringify({
          status: true,
          data: {
            id: Number(match[1]),
            lokasi: 'KOTA UJI',
            daerah: 'DKI JAKARTA',
            jadwal: {
              subuh: '04:15',
              dzuhur: '11:42',
              ashar: '14:48',
              maghrib: '17:49',
              isya: '18:58',
              date: '2026-10-17',
            },
          },
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end('{}');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}/v2`,
    close: () =>
      new Promise((resolve) => {
        // `fetch` Node memakai koneksi keep-alive; tanpa ini server.close()
        // menunggu selamanya dan test menggantung.
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

async function setup({ cities, failCities, failJadwal } = {}) {
  const api = await startFakeApi({ cities, failCities, failJadwal });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-sholat-plug-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 5000, logger: quiet });
  db.load();
  // Intro DM (plugins/_dm-intro.js) menyapa user baru dan menempati balasan
  // pertama — matikan supaya helper reply() menangkap jawaban command.
  db.user(SENDER).dmIntroSentAt = Date.now();

  const plugins = new PluginManager(pluginsDir, { logger: quiet });
  await plugins.loadAll();

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net', name: 'Bot Uji' },
    sendMessage: async (chat, content, opts) => {
      sent.push({ chat, content, opts });
      return { key: { id: `M${sent.length}`, remoteJid: chat } };
    },
    readMessages: async () => [],
    groupMetadata: async () => ({ subject: 'Grup Uji', participants: [] }),
    getName: async (jid) => String(jid).split('@')[0],
    contacts: {},
  };

  const config = {
    ...baseConfig,
    bot: { ...baseConfig.bot, owners: ['6289999999999'], ownerJids: ['6289999999999@s.whatsapp.net'] },
    sholat: { ...baseConfig.sholat, apiBase: api.base },
  };

  // Cache modul-level dibagi antar test; bersihkan supaya katalog kota dari
  // server test sebelumnya tidak bocor ke test berikutnya.
  clearCache();

  return {
    db,
    plugins,
    conn,
    sent,
    config,
    close: async () => {
      db.close();
      await api.close();
    },
  };
}

/** Jalankan test dengan harness + pembersihan yang selalu jalan (walau assertion gagal). */
async function withHarness(t, { cities, failCities, failJadwal } = {}, run) {
  const ctx = await setup({ cities, failCities, failJadwal });
  t.after(() => ctx.close());
  return run(ctx, { plugins: ctx.plugins, db: ctx.db, config: ctx.config, logger: quiet });
}

const msg = (text, chat = SENDER, pushName = 'Tester') => ({
  key: {
    remoteJid: chat,
    fromMe: false,
    id: `IN-${Math.random().toString(36).slice(2, 8)}`,
    ...(chat.endsWith('@g.us') ? { participant: SENDER } : {}),
  },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName,
});

const dmMsg = (text, chat = SENDER) => msg(text, chat);

const repliesTo = (sent, chat) =>
  sent
    .filter((item) => item.chat === chat)
    .map((item) => item.content?.text || item.content?.caption || '')
    .filter(Boolean);

const reply = (sent, chat) => repliesTo(sent, chat)[0] || '';
const lastReply = (sent, chat) => repliesTo(sent, chat).at(-1) || '';

test('.sholat tanpa argumen: bantuan + status belum berlangganan', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    const result = await handleMessage(ctx.conn, dmMsg('.sholat'), opts);
    assert.equal(result.handled, true);

    const text = reply(ctx.sent, SENDER);
    assert.match(text, /daftar/i);
    assert.match(text, /jadwal/i);
    assert.match(text, /stop/i);
  });
});

test('.sholat daftar <daerah>: menyimpan langganan + menampilkan jadwal hari ini', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    const result = await handleMessage(ctx.conn, dmMsg('.sholat daftar makassar'), opts);
    assert.equal(result.handled, true);

    const record = ctx.db.data.sholat[SENDER];
    assert.ok(record, 'langganan harus tersimpan');
    assert.equal(record.cityId, '2622');
    assert.equal(record.cityName, 'KOTA MAKASSAR');
    assert.equal(record.timezone, 'Asia/Makassar');

    const text = reply(ctx.sent, SENDER);
    assert.match(text, /MAKASSAR/);
    assert.match(text, /04:15/);
    assert.match(text, /DM/i);
  });
});

test('.sholat daftar <nama ambigu>: menampilkan kandidat, tidak memilih diam-diam', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, dmMsg('.sholat daftar sofifi'), opts);

    const text = reply(ctx.sent, SENDER);
    assert.match(text, /3211/);
    assert.match(text, /3212/);
    assert.equal(ctx.db.data.sholat[SENDER], undefined, 'tidak boleh berlangganan saat ambigu');
  });
});

test('.sholat daftar <id>: berlangganan walau namanya tidak disebut', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, dmMsg('.sholat daftar 1301'), opts);

    assert.equal(ctx.db.data.sholat[SENDER].cityId, '1301');
    assert.equal(ctx.db.data.sholat[SENDER].cityName, 'KOTA JAKARTA');
  });
});

test('.sholat daftar <daerah ngawur>: pesan ramah, tanpa langganan', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, dmMsg('.sholat daftar ngawur'), opts);

    assert.match(reply(ctx.sent, SENDER), /tidak ditemukan/i);
    assert.equal(ctx.db.data.sholat[SENDER], undefined);
  });
});

test('.sholat jadwal: menampilkan 5 waktu untuk daerah yang dilanggan', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, dmMsg('.sholat daftar makassar'), opts);
    const result = await handleMessage(ctx.conn, dmMsg('.sholat jadwal'), opts);
    assert.equal(result.handled, true);

    const text = lastReply(ctx.sent, SENDER);
    assert.match(text, /JADWAL SHOLAT/i);
    for (const time of ['04:15', '11:42', '14:48', '17:49', '18:58']) {
      assert.ok(text.includes(time), `jadwal harus memuat ${time}`);
    }
  });
});

test('.sholat jadwal tanpa langganan: mengajak daftar', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, dmMsg('.sholat jadwal'), opts);
    assert.match(reply(ctx.sent, SENDER), /belum berlangganan/i);
  });
});

// ── Alamat kirim: DM ber-LID ───────────────────────────────────────────────
//
// WhatsApp sekarang mengalamatkan DM dengan LID (`remoteJid` = `…@lid`,
// `remoteJidAlt` = nomor telepon). Balasan bot jalan karena dikirim ke `m.chat`
// (LID), sedangkan langganan sholat menyimpan nomor — dan kiriman "dingin" ke
// nomor tidak terantar. Test di bawah mengunci alamat kirimnya.

const LID = '271446714642565@lid';

/** DM seperti WhatsApp mengirimnya: `remoteJid` = LID, `remoteJidAlt` = nomor. */
const lidDm = (text) => ({
  key: {
    remoteJid: LID,
    remoteJidAlt: SENDER,
    fromMe: false,
    id: `IN-${Math.random().toString(36).slice(2, 8)}`,
  },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Tester',
});

test('.sholat daftar dari DM ber-LID menyimpan alamat kirim = chat LID', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, lidDm('.sholat daftar makassar'), opts);

    const record = ctx.db.data.sholat[SENDER];
    assert.ok(record, 'langganan tersimpan pada identitas nomor telepon');
    assert.equal(record.jid, SENDER);
    assert.equal(record.sendTo, LID, 'pengingat dikirim ke chat LID yang WhatsApp pakai');
  });
});

test('.sholat menyegarkan alamat kirim record lama yang masih menyimpan nomor', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, lidDm('.sholat daftar makassar'), opts);
    ctx.db.data.sholat[SENDER].sendTo = null; // seolah record dibuat sebelum perbaikan

    await handleMessage(ctx.conn, lidDm('.sholat'), opts);

    assert.equal(ctx.db.data.sholat[SENDER].sendTo, LID, 'alamat kirim diperbarui saat user mengetik .sholat');
  });
});

test('.sholat daftar dari grup tidak memakai grup sebagai alamat kirim', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, msg('.sholat daftar makassar', GROUP), opts);

    const record = ctx.db.data.sholat[SENDER];
    assert.ok(record, 'pendaftaran dari grup tetap tercatat pada identitas pengirim');
    assert.equal(record.sendTo, null, 'pengingat tidak boleh dikirim ke grup');
  });
});

test('.sholat test (owner): mengirim pesan uji ke alamat LID dan melaporkan hasilnya', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    const ownerOpts = { ...opts, config: { ...ctx.config, bot: { ...ctx.config.bot, owners: ['628111'] } } };

    await handleMessage(ctx.conn, lidDm('.sholat daftar makassar'), ownerOpts);
    await handleMessage(ctx.conn, lidDm('.sholat test'), ownerOpts);

    const uji = ctx.sent.filter((item) => item.chat === LID && /Uji/i.test(item.content?.text || ''));
    assert.equal(uji.length, 1, 'pesan uji harus dikirim ke LID');
    assert.match(lastReply(ctx.sent, LID), /Terkirim/i);
  });
});

test('.sholat test (owner): kegagalan kirim dilaporkan beserta alasannya', async () => {
  const db = {
    data: {
      sholat: {
        [SENDER]: {
          jid: SENDER,
          sendTo: LID,
          cityId: '1301',
          cityName: 'KOTA JAKARTA',
          timezone: 'Asia/Jakarta',
          enabled: true,
          sent: { date: '', keys: [] },
        },
      },
      lidMap: {},
    },
    resolveIdentity: (jid) => jid,
    touch() {},
  };
  const replies = [];
  const m = {
    chat: LID,
    sender: SENDER,
    reply: async (text) => {
      replies.push(String(text));
      return { key: { id: 'R' } };
    },
  };

  await sholatPlugin(m, {
    args: ['test'],
    db,
    config: baseConfig,
    isOwner: true,
    conn: { sendMessage: async () => { throw new Error('no session'); } },
    usedPrefix: '.',
  });

  assert.match(replies.at(-1), /gagal/i);
  assert.match(replies.at(-1), /no session/, 'alasan asli harus dilaporkan supaya bisa didiagnosis');
});

test('.sholat test ditolak untuk non-owner', async () => {
  const replies = [];
  const m = { chat: LID, sender: SENDER, reply: async (text) => { replies.push(String(text)); return { key: { id: 'R' } }; } };

  await sholatPlugin(m, {
    args: ['test'],
    db: { data: { sholat: {}, lidMap: {} }, resolveIdentity: (jid) => jid, touch() {} },
    config: baseConfig,
    isOwner: false,
    conn: { sendMessage: async () => ({}) },
    usedPrefix: '.',
  });

  assert.match(replies.at(-1), /owner/i);
});

test('.sholat stop: menghapus langganan', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    await handleMessage(ctx.conn, dmMsg('.sholat daftar makassar'), opts);
    assert.ok(ctx.db.data.sholat[SENDER]);

    await handleMessage(ctx.conn, dmMsg('.sholat stop'), opts);
    assert.equal(ctx.db.data.sholat[SENDER], undefined);
    assert.match(lastReply(ctx.sent, SENDER), /dihentikan/i);
  });
});

test('nama daerah terlalu umum: jadi daftar kandidat terbatas, bukan satu daerah diam-diam', async (t) => {
  // Bentuk katalog MyQuran sungguhan: satu nama BERAKHIRAN "KOTA"
  // (KAB. LIMA PULUH KOTA — yang dulu langsung dipilih diam-diam) plus banyak
  // nama lain yang juga memuat kata "KOTA".
  const cities = [
    { id: '0304', lokasi: 'KAB. LIMA PULUH KOTA' },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `32${String(index + 1).padStart(2, '0')}`,
      lokasi: `KOTA UJI ${index + 1}`,
    })),
  ];

  await withHarness(t, { cities }, async (ctx, opts) => {
    await handleMessage(ctx.conn, dmMsg('.sholat daftar kota'), opts);

    const text = reply(ctx.sent, SENDER);
    assert.equal(
      ctx.db.data.sholat[SENDER],
      undefined,
      'daerah umum tidak boleh langsung dijadikan langganan',
    );
    assert.equal(
      (text.match(/•/g) || []).length,
      ctx.config.sholat.maxCandidates,
      'hanya maxCandidates baris ditampilkan',
    );
    assert.match(text, /dan 11 lainnya/);
    assert.match(text, /terlalu umum/i);
  });
});

test('API katalog mati: balasan ramah, bukan error mentah', async (t) => {
  await withHarness(t, { failCities: true }, async (ctx, opts) => {
    const result = await handleMessage(ctx.conn, dmMsg('.sholat daftar makassar'), opts);

    assert.equal(result.handled, true);
    assert.match(reply(ctx.sent, SENDER), /tidak bisa diambil/i);
    assert.equal(ctx.db.data.sholat[SENDER], undefined);
  });
});

test('API jadwal mati: tidak berlangganan setengah jalan', async (t) => {
  await withHarness(t, { failJadwal: true }, async (ctx, opts) => {
    await handleMessage(ctx.conn, dmMsg('.sholat daftar makassar'), opts);

    assert.match(reply(ctx.sent, SENDER), /tidak bisa diambil/i);
    assert.equal(ctx.db.data.sholat[SENDER], undefined, 'langganan baru dibuat setelah jadwal didapat');
  });
});

test('pengirim ber-LID: langganan disimpan di nomor telepon aslinya', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    // "LID yang dipaksakan jadi nomor" — persis kasus yang ditangani
    // db.resolveIdentity; tanpa itu langganan tersimpan di record hantu.
    const lidAsPn = '271446714642565@s.whatsapp.net';
    ctx.db.data.lidMap[lidAsPn] = SENDER;

    await handleMessage(ctx.conn, dmMsg('.sholat daftar makassar', lidAsPn), opts);

    assert.equal(ctx.db.data.sholat[lidAsPn], undefined, 'tidak boleh pakai jid hantu');
    assert.equal(ctx.db.data.sholat[SENDER]?.cityId, '2622');

    // Dan `.sholat stop` dari nomor aslinya menemukan langganan itu.
    await handleMessage(ctx.conn, dmMsg('.sholat stop', SENDER), opts);
    assert.equal(ctx.db.data.sholat[SENDER], undefined);
    assert.match(lastReply(ctx.sent, SENDER), /dihentikan/i);
  });
});

test('dipakai dari grup: langganan melekat pada pengirim, bukan grup', async (t) => {
  await withHarness(t, {}, async (ctx, opts) => {
    // Grup tanpa sewa aktif dikunci sistem rent (kebijakan repo yang sudah ada).
    Rent.activateRent(ctx.db, GROUP, { renter: SENDER, renterName: 'Tester', days: 30, by: 'owner', now: Date.now() });

    const result = await handleMessage(ctx.conn, msg('.sholat daftar makassar', GROUP), opts);
    assert.equal(result.handled, true);

    assert.equal(ctx.db.data.sholat[GROUP], undefined, 'grup bukan pelanggan');
    assert.equal(ctx.db.data.sholat[SENDER]?.cityId, '2622');
  });
});
