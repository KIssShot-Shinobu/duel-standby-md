import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(new URL('../database/database.json', import.meta.url), 'utf8'));
const lidMap = d.lidMap;

console.log('=== record mentah (SEBELUM perbaikan) ===');
for (const key of Object.keys(d.users)) {
  const digits = String(key).replace(/[^0-9]/g, '');
  const real = lidMap[`${digits}@lid`];
  if (!real || real === key) continue;
  const u = d.users[key];
  console.log(`\nrecord: ${JSON.stringify(key)}   -> seharusnya: ${real}`);
  console.log(`   premium=${u.premium} premiumUntil=${u.premiumUntil ? new Date(u.premiumUntil).toISOString().slice(0, 10) : u.premiumUntil}`);
  console.log(`   limit=${u.limit} limitBonus=${u.limitBonus} exp=${u.exp} saldo=${u.saldo} cmds=${u.totalCommands}`);
  const r = d.users[real];
  console.log(`   [record asli] premium=${r.premium} premiumUntil=${r.premiumUntil ? new Date(r.premiumUntil).toISOString().slice(0, 10) : r.premiumUntil} limit=${r.limit} limitBonus=${r.limitBonus} exp=${r.exp}`);
}