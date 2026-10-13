import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(new URL('../database/database.json', import.meta.url), 'utf8'));
const lidMap = d.lidMap;

console.log('=== 4 user premium: status pendaftaran di record ASLI ===');
for (const pn of ['628970080509@s.whatsapp.net', '628970023421@s.whatsapp.net', '6285179553092@s.whatsapp.net', '6281295964065@s.whatsapp.net']) {
  const u = d.users[pn];
  console.log(`  ${pn}  registered=${u.registered} age=${u.age} name=${JSON.stringify(u.name)} premium=${u.premium}`);
}

console.log('\n=== berapakah user yang registered? ===');
const users = Object.entries(d.users);
console.log('  registered=true :', users.filter(([, u]) => u.registered).length, '/', users.length);
console.log('  exp > 0 (aktif) :', users.filter(([, u]) => (u.exp || 0) > 0).length);

console.log('\n=== adakah premium user yang TIDAK registered? ===');
const pn = users.filter(([, u]) => u.premium && !u.registered);
console.log(pn.length ? pn.map(([k]) => k).join('\n  ') : '  (tidak ada)');