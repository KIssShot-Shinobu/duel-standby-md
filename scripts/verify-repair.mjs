/**
 * Verifikasi perbaikan terhadap database.json asli dari panel.
 * Jalankan: node scripts/verify-repair.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../lib/database.js';

const src = new URL('../database/database.json', import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-verify-'));
const file = path.join(dir, 'database.json');
fs.copyFileSync(src, file);

const logger = { warn: (m) => console.log('  [warn]', m), error() {}, info() {}, debug() {} };
const db = new Database(file, { saveInterval: 999999, logger });
db.load();

console.log('=== SEBELUM ===');
const before = Object.keys(db.data.users).length;
console.log('total user:', before);
for (const k of Object.keys(db.data.users)) {
  const u = db.data.users[k];
  if (u.premium || (u.limitBonus || 0) > 0) {
    console.log(`  ${k}  premium=${u.premium} limit=${u.limit} bonus=${u.limitBonus}`);
  }
}

console.log('\n=== JALAN repairLidRecords() ===');
const repaired = db.repairLidRecords();
console.log('  record digabung:', repaired);

console.log('\n=== SESUDAH ===');
console.log('total user:', Object.keys(db.data.users).length);
for (const k of Object.keys(db.data.users)) {
  const u = db.data.users[k];
  if (u.premium || (u.limitBonus || 0) > 0) {
    const resolved = db.resolveIdentity(k);
    console.log(
      `  ${k}  premium=${u.premium} limit=${u.limit} bonus=${u.limitBonus} exp=${u.exp} saldo=${u.saldo} cmds=${u.totalCommands}`,
    );
    if (resolved !== k) console.log(`      -> resolveIdentity() mengembalikan: ${resolved}`);
  }
}

console.log('\n=== CEK: masih ada record hantu (LID sebagai nomor)? ===');
const ghosts = Object.keys(db.data.users).filter((k) => {
  const d = k.split('@')[0];
  return db.data.lidMap[`${d}@lid`] && db.data.lidMap[`${d}@lid`] !== k;
});
console.log(ghosts.length ? ghosts : '  (tidak ada — semua bersih)');

console.log('\n=== CEK: 4 user premium punya aktivitas (bukan record kosong)? ===');
for (const [lid, pn] of Object.entries(db.data.lidMap)) {
  const u = db.data.users[pn];
  if (u && u.premium) {
    console.log(
      `  ${pn}  premium=${u.premium} s/d ${new Date(u.premiumUntil).toISOString().slice(0, 10)} limit=${u.limit} bonus=${u.limitBonus} exp=${u.exp} saldo=${u.saldo}`,
    );
  }
}

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('\n(salinan sementara dihapus; database asli tidak disentuh)');