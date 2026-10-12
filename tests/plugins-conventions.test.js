import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Uji konvensi kode plugin.
 *
 * Latar belakang: pernah ada bug `.ytmp4` -> "done is not a function" karena
 * `m.reply()` (yang mengembalikan objek pesan) disangka fungsi edit.
 * Fungsi untuk mengedit pesan tunggu hanya datang dari `wait()`.
 */
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const pluginFiles = fs.readdirSync(pluginsDir).filter((file) => file.endsWith('.js'));

test('plugin tidak memakai nilai balik m.reply sebagai fungsi', () => {
  const offenders = [];

  for (const file of pluginFiles) {
    const source = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
    for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+m\.reply\(/g)) {
      const name = match[1];
      const called = new RegExp(`(await|return)\\s+${name}\\s*\\(`).test(source);
      const typeofChecked = new RegExp(`typeof\\s+${name}\\s*===`).test(source);
      if (called || typeofChecked) {
        offenders.push(`${file}: "${name}" berasal dari m.reply lalu dipakai sebagai fungsi`);
      }
    }
  }

  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('pemakaian m.reply(...) tidak pernah di-await untuk diedit', () => {
  const offenders = [];
  for (const file of pluginFiles) {
    const source = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
    if (/await\s+done\s*\(/.test(source) && !/const\s+done\s*=\s*await\s+wait\(/.test(source)) {
      offenders.push(`${file}: memanggil done() tanpa mengambilnya dari wait()`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('setiap plugin punya help, tags, dan export default yang valid', () => {
  for (const file of pluginFiles) {
    const source = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
    assert.match(source, /export default/, `${file} tidak mengekspor default`);
    if (/handler\.command\s*=/.test(source)) {
      assert.match(source, /handler\.help\s*=/, `${file} punya command tapi tanpa handler.help`);
      assert.match(source, /handler\.tags\s*=/, `${file} punya command tapi tanpa handler.tags`);
    }
  }
});

test('plugin tidak memakai require() di modul ESM', () => {
  const offenders = [];
  for (const file of pluginFiles) {
    const source = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
    if (/^\s*(const|let|var)\s+.*=\s*require\(/m.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `pakai import, bukan require: ${offenders.join(', ')}`);
});
