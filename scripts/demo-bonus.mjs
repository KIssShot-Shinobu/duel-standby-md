/**
 * Demo: kenapa limitBonus owner dan pembelian user tercampur.
 * Jalankan: node scripts/demo-bonus.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import baseConfig from '../config.js';
import { Database } from '../lib/database.js';
import { adjustLimit } from '../lib/permissions.js';
import { quote, purchase } from '../lib/buy-limit.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-bonusdemo-'));
const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
db.load();

// Pakai user sungguhan dari database panel supaya angkanya tidak dibuat-buat
const PN = '628970080509@s.whatsapp.net';
const u = db.user(PN);
u.saldo = 100000;

const show = (label) =>
  console.log(
    `${label.padEnd(34)} limitBonus=${String(u.limitBonus).padStart(4)}  saldo=${String(u.saldo).padStart(7)}  ` +
      `buyMonthAmount=${String(u.buyMonthAmount || 0).padStart(4)}`,
  );

show('awal');

console.log('\n-- owner kasih bonus 20 lewat .limit add --');
adjustLimit(db, u, 20, baseConfig);
show('setelah owner +20');

console.log('\n-- user beli 30 limit pakai saldo --');
purchase(db, u, baseConfig, quote(db, u, baseConfig, 30));
show('setelah beli 30');

console.log('\nPertanyaan: 50 itu 20 dari owner + 30 dari user?');
console.log('  record bisa jawab? ->', u.limitBonus === 50 ? 'angka cocok, tapi SUMBERNYA hilang' : '?');
console.log('  owner tanya "user ini beli berapa?" -> jawabannya:', u.buyMonthAmount || 0, '(cuma bulan ini)');
console.log('  owner tanya "kasih bonus 20 lagi" ->', `limitBonus jadi ${u.limitBonus + 20}, bukan 20 dari owner + 20 = 40`);

console.log('\n-- sekarang owner mau cabut bonus yang USER beli, sisakan yang owner beri --');
console.log('   Jeffrey bisa: tidak. satu angka, tidak dipisah.');
console.log('   Kalau owner reset ke 20, bonus user ikut hilang.');
console.log('   Kalau owner reset ke 50, user autres dapatelte买 yang bukan miliknya.');

db.close();
fs.rmSync(dir, { recursive: true, force: true });