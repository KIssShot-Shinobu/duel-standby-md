/**
 * Naikkan versi rilis di package.json + config.js (sekaligus membuang BOM).
 *
 *   node scripts/bump-version.mjs 1.1.8
 *   VERSION=1.1.8 node scripts/bump-version.mjs package.json config.js
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const version = process.argv[2] || process.env.VERSION || '';

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Pemakaian: node scripts/bump-version.mjs <x.y.z>');
  process.exit(1);
}

const targets = process.argv.slice(3);
const files = (targets.length ? targets : ['package.json', 'config.js']).map((file) => path.resolve(ROOT, file));

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');
  const hadBom = source.charCodeAt(0) === 0xfeff;
  if (hadBom) source = source.slice(1);

  source = source.replace(/"version"\s*:\s*"\d+\.\d+\.\d+"/, `"version": "${version}"`);
  source = source.replace(/version\s*:\s*'\d+\.\d+\.\d+'/, `version: '${version}'`);

  fs.writeFileSync(file, source, 'utf8'); // selalu tanpa BOM
  const found = source.match(/\d+\.\d+\.\d+/);
  console.log(`${path.relative(ROOT, file)}: BOM=${hadBom ? 'dibuang' : 'tidak ada'} | versi=${found ? found[0] : '-'}`);
}
