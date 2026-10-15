import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import baseConfig from '../config.js';
import { Database } from '../lib/database.js';
import { adjustLimit, limitBase, refreshLimit } from '../lib/permissions.js';
import { buyCatalog, buyStatus, quote, purchase } from '../lib/buy-limit.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const TARGET = '628123456789@s.whatsapp.net';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-buylimit-'));
  const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
  db.load();
  return { db, dir };
}

// ── katalog & harga ─────────────────────────────────────────────────────────

test('katalog berisi paket dengan harga dan penghematan', () => {
  const items = buyCatalog(baseConfig);
  assert.ok(items.length >= 3, 'minimal ada 3 paket');
  for (const item of items) {
    assert.ok(item.limit > 0, 'setiap paket punya jumlah limit');
    assert.ok(item.price > 0, 'setiap paket punya harga');
    assert.ok(item.label.includes(String(item.limit)), 'label paket menyebut jumlahnya');
  }
  // harga paket harus lebih murah dari harga satuan (diskon)
  const unit = baseConfig.buyLimit.price;
  for (const item of items) assert.ok(item.price < item.limit * unit, `${item.label} harus ada diskon`);
});

test('quote paket memakai harga paket, bukan harga satuan', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 999999;

  const pack = baseConfig.buyLimit.packages[0];
  const result = quote(user, baseConfig, String(pack.limit));

  assert.equal(result.ok, true);
  assert.equal(result.limit, pack.limit);
  assert.equal(result.cost, pack.price, 'harga harus sama dengan harga paket');
  assert.equal(result.isPackage, true);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quote jumlah bebas memakai harga satuan', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 999999;

  const result = quote(user, baseConfig, 7);

  assert.equal(result.ok, true);
  assert.equal(result.limit, 7);
  assert.equal(result.cost, 7 * baseConfig.buyLimit.price);
  assert.equal(result.isPackage, false);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── validasi ───────────────────────────────────────────────────────────────

test('quote menolak jumlah di luar rentang', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 9999999;

  assert.equal(quote(user, baseConfig, 0).reason, 'invalid');
  assert.equal(quote(user, baseConfig, -5).reason, 'invalid');
  assert.equal(quote(user, baseConfig, 9999).reason, 'invalid');
  assert.equal(quote(user, baseConfig, 'abc').reason, 'invalid');
  assert.equal(quote(user, baseConfig, '').reason, 'invalid');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quote menolak saat saldo kurang', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 10;

  // 7 dipakai supaya tidak menabrak harga paket.
  const result = quote(user, baseConfig, 7);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'saldo');
  assert.equal(result.needed, 7 * baseConfig.buyLimit.price);
  assert.equal(result.have, 10);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pembelian tidak bisa melewati batas harian', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 9999999;
  user.lastLimitReset = Date.now(); // siklus limit harian baru saja dimulai

  const cap = baseConfig.buyLimit.dailyCap;
  const first = quote(user, baseConfig, cap);
  assert.equal(first.ok, true, 'pembelian pertama sampai batas harian harus boleh');

  purchase(db, user, baseConfig, first);
  assert.equal(buyStatus(user, baseConfig).dayAmount, cap);
  assert.equal(buyStatus(user, baseConfig).dayLeft, 0);

  const second = quote(user, baseConfig, 1);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'dailyCap');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pembelian tidak bisa melewati batas bulanan', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 99999999;
  user.lastLimitReset = Date.now();

  // Habiskan kuota harian beberapa kali dengan memulai jendela 24 jam baru tiap
  // kali (tracker harian direset begitu `buyDayKey` sudah lewat interval).
  const monthCap = baseConfig.buyLimit.monthlyCap;
  const dayCap = baseConfig.buyLimit.dailyCap;
  let guard = 0;
  while (buyStatus(user, baseConfig).monthAmount < monthCap && guard < 100) {
    const q = quote(user, baseConfig, dayCap);
    if (!q.ok) break;
    purchase(db, user, baseConfig, q);
    guard += 1;
    user.buyDayKey = Date.now() - baseConfig.limits.resetIntervalMs - 1000;
  }
  assert.equal(buyStatus(user, baseConfig).monthAmount, monthCap, 'tracker bulanan harus terisi sampai batas');

  const blocked = quote(user, baseConfig, 1);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'monthlyCap');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('batas harian ikut reset saat siklus limit harian mulai lagi', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 9999999;
  user.lastLimitReset = Date.now();

  const q = quote(user, baseConfig, baseConfig.buyLimit.dailyCap);
  purchase(db, user, baseConfig, q);
  assert.equal(buyStatus(user, baseConfig).dayAmount, baseConfig.buyLimit.dailyCap);

  // majukan jendela pembelian di luar interval reset
  user.buyDayKey = Date.now() - baseConfig.limits.resetIntervalMs - 1000;
  assert.equal(buyStatus(user, baseConfig).dayAmount, 0, 'tracker harian harus nol setelah jendela baru');
  assert.equal(quote(user, baseConfig, 1).reason, undefined);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('katalog dan quote tidak boleh beda pendapat (setiap paket harus bisa dibeli)', () => {
  // Invariant: apa pun yang ditawarkan katalog HARUS bisa dibeli. Dulu min/max
  // (yang dikhususkan untuk jumlah bebas) ikut menolak paket, jadi katalog
  // menawarkan paket yang `.buylimit 30` jawab "format salah".
  const cases = [
    baseConfig,
    { ...baseConfig, buyLimit: { ...baseConfig.buyLimit, min: 15 } },
    { ...baseConfig, buyLimit: { ...baseConfig.buyLimit, max: 20 } },
    { ...baseConfig, buyLimit: { ...baseConfig.buyLimit, min: 5, max: 25 } },
  ];

  for (const config of cases) {
    const { db, dir } = tmpDb();
    const user = db.user(TARGET);
    user.saldo = 1e9;
    user.lastLimitReset = Date.now();

    for (const item of buyCatalog(config)) {
      const result = quote(user, config, String(item.limit));
      assert.equal(
        result.ok,
        true,
        `katalog menawarkan ${item.limit} limit tapi quote menolaknya ` +
          `(reason: ${result.reason}) dengan min=${config.buyLimit.min} max=${config.buyLimit.max}`,
      );
      assert.equal(result.cost, item.price, 'harga harus sama dengan yang ditawarkan katalog');
    }
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('min/max tetap menolak jumlah bebas di luar rentang', () => {
  const config = { ...baseConfig, buyLimit: { ...baseConfig.buyLimit, min: 5, max: 25 } };
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 1e9;

  assert.equal(quote(user, config, 4).reason, 'invalid', 'di bawah min harus ditolak');
  assert.equal(quote(user, config, 26).reason, 'invalid', 'di atas max harus ditolak');
  // 12 sengaja bukan angka paket (paket = 10/30/60) supaya benar-benar
  // menguji jalur jumlah bebas, bukan jalur paket yang memang bebas rentang.
  assert.equal(quote(user, config, 12).ok, true, 'angka bebas dalam rentang tetap boleh');
  assert.equal(quote(user, config, 12).cost, 12 * config.buyLimit.price, 'harga satuan untuk jumlah bebas');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('purchase menolak hasil yang tidak lolos quote (validasi ulang, bukan percaya buta)', () => {
  // purchase() dulu mempercayai result apa adanya: saldo 5 bisa membeli 60
  // limit dengan cost 0, dan memanggilnya dua kali mendorong tracker harian
  // ke 120 padahal cap-nya 60. Validasi ulang membuatnya mustahil.
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 5;
  user.lastLimitReset = Date.now();

  const forged = { ok: true, limit: 60, cost: 0, isPackage: false };
  const first = purchase(db, user, baseConfig, forged);

  assert.equal(first.ok, false, 'pembelian yang tidak lolos quote harus ditolak');
  assert.equal(first.reason, 'saldo', 'penolakan harus menyebut alasan sebenarnya');
  assert.equal(first.limit, 0, 'tidak boleh melaporkan limit terbeli');
  assert.equal(user.saldo, 5, 'saldo tidak boleh berubah saat ditolak');
  assert.equal(user.limitBonus, 0, 'bonus tidak boleh naik saat ditolak');
  assert.equal(buyStatus(user, baseConfig).dayAmount, 0, 'tracker harian tidak boleh terisi');

  // pemanggilan berulang tidak bisa menumpuk lewat cap
  purchase(db, user, baseConfig, forged);
  assert.equal(buyStatus(user, baseConfig).dayAmount, 0, 'cap harian tidak bisa dibobol');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('purchase tetap menormalkan saldo & bonus negatif walau transaksi ditolak', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 10;
  user.limitBonus = -50;

  const res = purchase(db, user, baseConfig, { ok: true, limit: 5, cost: 0, isPackage: false });

  assert.equal(res.ok, false, 'saldo 10 tidak cukup untuk 5 limit');
  assert.ok(user.saldo >= 0, 'saldo tidak boleh negatif');
  assert.ok(user.limitBonus >= 0, 'bonus tidak boleh negatif');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quote menolak input yang bukan bilangan bulat desimal murni', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 1e9;

  // Number() menerima semua ini — hex lolos jadi angka, pecahan membeli 30
  // limit dengan harga satuan (7500) bukan harga paket (5000).
  assert.equal(quote(user, baseConfig, '0x1A').reason, 'invalid', 'hex harus ditolak');
  assert.equal(quote(user, baseConfig, '30.7').reason, 'invalid', 'pecahan harus ditolak');
  assert.equal(quote(user, baseConfig, '1e3').reason, 'invalid', 'notasi ilmiah harus ditolak');
  assert.equal(quote(user, baseConfig, '  ').reason, 'invalid', 'spasi saja harus ditolak');
  assert.equal(quote(user, baseConfig, '-5').reason, 'invalid', 'negatif harus ditolak');
  assert.equal(quote(user, baseConfig, '+30').reason, 'invalid', 'tanda plus harus ditolak');

  // yang valid tetap diterima, termasuk spasi di sekitar
  assert.equal(quote(user, baseConfig, ' 30 ').ok, true, 'spasi di sekitar angka sah');
  assert.equal(quote(user, baseConfig, 30).ok, true, 'angka number sah');
  assert.equal(quote(user, baseConfig, ' 30 ').cost, baseConfig.buyLimit.packages.find((p) => p.limit === 30).price);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── efek pembelian ─────────────────────────────────────────────────────────

test('pembelian mengurangi saldo dan menambah limitBonus', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 50000;
  const saldoAwal = user.saldo;

  const q = quote(user, baseConfig, 10);
  const result = purchase(db, user, baseConfig, q);

  assert.equal(result.limit, 10);
  assert.equal(result.cost, q.cost);
  assert.equal(user.saldo, saldoAwal - q.cost, 'saldo harus berkurang');
  assert.equal(user.limitBonus, 10, 'bonus limit harus naik');
  assert.equal(user.limit, limitBase(user, baseConfig) + 10, 'limit aktif harus ikut naik');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('limit yang dibeli bertahan setelah reset harian', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 50000;
  user.lastLimitReset = Date.now();

  const q = quote(user, baseConfig, 15);
  purchase(db, user, baseConfig, q);

  // reset harian: limit dikembalikan ke kuota dasar + bonus
  user.lastLimitReset = Date.now() - baseConfig.limits.resetIntervalMs - 1;
  const limit = refreshLimit(db, user, baseConfig);

  assert.equal(user.limitBonus, 15, 'bonus tidak boleh hilang saat reset');
  assert.equal(limit, limitBase(user, baseConfig) + 15);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('limit yang dibeli terpakai seperti limit biasa', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 50000;
  user.lastLimitReset = Date.now();

  purchase(db, user, baseConfig, quote(user, baseConfig, 10));
  const sebelum = refreshLimit(db, user, baseConfig);

  adjustLimit(db, user, -3, baseConfig); // berjalan seperti pemakaian biasa
  assert.equal(refreshLimit(db, user, baseConfig), sebelum - 3);
  assert.equal(user.limitBonus, 7, 'pemakaian memotong bonus seperti biasa');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pembelian pada user premium memakai kuota premium', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 50000;
  user.premium = true;
  user.premiumUntil = Date.now() + 86400000;
  // `lastLimitReset` sengaja dibiarkan 0: dengan begitu refreshLimit mengisi
  // limit ke kuota premium dulu, jadi assertion di bawah benar-benar menguji
  // kuota premium — bukan sekadar sisa limit yang kebetulan ada.

  purchase(db, user, baseConfig, quote(user, baseConfig, 10));

  assert.equal(user.limit, baseConfig.limits.premium + 10);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pembelian ditolak saat fitur dimatikan owner', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 50000;
  const config = { ...baseConfig, buyLimit: { ...baseConfig.buyLimit, enabled: false } };

  assert.equal(quote(user, config, 10).reason, 'disabled');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saldo dan bonus tidak pernah negatif walau ada data rusak', () => {
  const { db, dir } = tmpDb();
  const user = db.user(TARGET);
  user.saldo = 10;
  user.limitBonus = -50;

  const blocked = quote(user, baseConfig, 5);
  assert.equal(blocked.ok, false, 'saldo kurang harus ditolak');

  const forced = { ok: true, limit: 5, cost: 0, isPackage: false };
  purchase(db, user, baseConfig, forced);
  assert.ok(user.saldo >= 0, 'saldo tidak boleh negatif');
  assert.ok(user.limitBonus >= 0, 'bonus tidak boleh negatif');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});