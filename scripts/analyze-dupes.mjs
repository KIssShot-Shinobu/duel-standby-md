import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(new URL('../database/database.json', import.meta.url), 'utf8'));
const users = d.users;
const lidMap = d.lidMap || {};

console.log('=== 4 record premium: LID-as-phone vs nomor sebenarnya ===');
for (const key of Object.keys(users)) {
  const u = users[key];
  if (!u.premium && !(u.limitBonus > 0)) continue;
  const lidDigits = key.split('@')[0];
  const mapped = lidMap[`${lidDigits}@lid`];
  console.log(`\nrecord premium : ${key}`);
  console.log(`  exp=${u.exp} saldo=${u.saldo} cmds=${u.totalCommands} registered=${u.registered}`);
  console.log(`  lidMapsays   : ${lidDigits}@lid -> ${mapped}`);
  if (mapped) {
    const real = users[mapped];
    console.log(`  record nyata : ${mapped}`);
    console.log(
      real
        ? `    exp=${real.exp} saldo=${real.saldo} cmds=${real.totalCommands} premium=${real.premium} limit=${real.limit} lastLimitReset=${real.lastLimitReset ? new Date(real.lastLimitReset).toISOString() : 0}`
        : '    (TIDAK ADA record untuk nomor ini)',
    );
  }
}

console.log('\n=== cek: apakah ada nomor LIKE (62xx) yang td punya record LID ganda? ===');
for (const [lid, pn] of Object.entries(lidMap)) {
  const fake = `${lid.split('@')[0]}@s.whatsapp.net`;
  if (users[fake]) console.log(`  DUPLIKAT: ${fake}  dan  ${pn}`);
}