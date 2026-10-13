/**
 * Analisis database.json: carirecord LID terpisah / premium nyasar.
 * Jalankan: node scripts/analyze-db.mjs
 */
import fs from 'node:fs';

const file = new URL('../database/database.json', import.meta.url);
const d = JSON.parse(fs.readFileSync(file, 'utf8'));

const users = d.users || {};
const lidMap = d.lidMap || {};
const keys = Object.keys(users);
const lids = keys.filter((k) => k.endsWith('@lid'));
const pns = keys.filter((k) => k.endsWith('@s.whatsapp.net'));

console.log('=== RINGKASAN ===');
console.log('total user   :', keys.length);
console.log('record LID   :', lids.length);
console.log('record nomor :', pns.length);
console.log('lidMap entries:', Object.keys(lidMap).length);

console.log('\n=== lidMap ===');
for (const [lid, pn] of Object.entries(lidMap)) console.log(`  ${lid} -> ${pn}`);

console.log('\n=== record LID yang TIDAK ada padanannya di lidMap ===');
const orphan = lids.filter((lid) => !lidMap[lid]);
if (!orphan.length) console.log('  (tidak ada)');
for (const lid of orphan) {
  const u = users[lid];
  console.log(
    `  ${lid}  premium=${u.premium} premiumUntil=${u.premiumUntil ? new Date(u.premiumUntil).toISOString().slice(0, 10) : 0} ` +
      `limit=${u.limit}/${u.lastLimitReset ? new Date(u.lastLimitReset).toISOString().slice(0, 10) : 0} ` +
      `limitBonus=${u.limitBonus} exp=${u.exp} saldo=${u.saldo} cmds=${u.totalCommands} name=${JSON.stringify(u.name)}`,
  );
}

console.log('\n=== record nomor dengan premium / limitBonus ===');
for (const pn of pns) {
  const u = users[pn];
  if (u.premium || (u.limitBonus || 0) > 0) {
    console.log(
      `  ${pn}  premium=${u.premium} premiumUntil=${u.premiumUntil ? new Date(u.premiumUntil).toISOString().slice(0, 10) : 0} ` +
        `limit=${u.limit} limitBonus=${u.limitBonus} exp=${u.exp} saldo=${u.saldo} cmds=${u.totalCommands} name=${JSON.stringify(u.name)}`,
    );
  }
}

console.log('\n=== pasangan LID<->nomor yang TIDAK punya lidMap (duplikatstiaktif) ===');
// Tebak: record LID dengan prefix/angka yang sama dengan record nomor
const nums = (j) => j.replace(/[^0-9]/g, '');
const dupes = [];
for (const lid of lids) {
  const u = users[lid];
  // cari record nomor dengan exp/saldo sama -> indikasi user yang sama
  for (const pn of pns) {
    const p = users[pn];
    if (u.exp && p.exp && u.exp === p.exp && u.saldo === p.saldo && u.totalCommands === p.totalCommands) {
      dupes.push({ lid, pn });
    }
  }
}
if (!dupes.length) console.log('  (tidak ada kecocokan exp/saldo/cmd)');
for (const x of dupes) console.log(`  ${x.lid}  <->  ${x.pn}`);

console.log('\n=== semua record LID (ringkas) ===');
for (const lid of lids) {
  const u = users[lid];
  console.log(
    `  ${lid} premium=${u.premium} limit=${u.limit} exp=${u.exp} saldo=${u.saldo} cmds=${u.totalCommands} name=${JSON.stringify(u.name)}`,
  );
}