import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createOwnerMemory } from '../lib/owner-ai.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oa-')), 'owner-ai.json');
const quiet = { warn() {}, error() {} };

test('owner-ai: push menyimpan history per owner & trim ke max', () => {
  const mem = createOwnerMemory({ file: tmp(), logger: quiet });
  for (let i = 0; i < 60; i++) mem.push('o1@s.whatsapp.net', 'user', `pesan ${i}`, 50);
  const entry = mem.get('o1@s.whatsapp.net');
  assert.equal(entry.history.length, 50);
  assert.equal(entry.history[0].content, 'pesan 10');
  assert.equal(entry.history.at(-1).content, 'pesan 59');
  assert.ok(entry.lastAt > 0);
});

test('owner-ai: clear menghapus memori owner', () => {
  const mem = createOwnerMemory({ file: tmp(), logger: quiet });
  mem.push('o1@s.whatsapp.net', 'user', 'halo');
  assert.ok(mem.get('o1@s.whatsapp.net'));
  mem.clear('o1@s.whatsapp.net');
  assert.equal(mem.get('o1@s.whatsapp.net'), null);
});

test('owner-ai: flush + reload roundtrip (bertahan restart)', () => {
  const file = tmp();
  const mem = createOwnerMemory({ file, logger: quiet });
  mem.push('o1@s.whatsapp.net', 'user', 'ingat ini');
  mem.push('o1@s.whatsapp.net', 'assistant', 'aku ingat');
  mem.flush();

  const again = createOwnerMemory({ file, logger: quiet });
  const entry = again.get('o1@s.whatsapp.net');
  assert.equal(entry.history.length, 2);
  assert.equal(entry.history[0].content, 'ingat ini');
  assert.equal(entry.history[1].content, 'aku ingat');
});

test('owner-ai: file rusak tidak dianggap crash (mulai bersih)', () => {
  const file = tmp();
  fs.writeFileSync(file, '{ bukan json');
  const mem = createOwnerMemory({ file, logger: quiet });
  assert.equal(mem.get('o1@s.whatsapp.net'), null);
  mem.push('o1@s.whatsapp.net', 'user', 'baru');
  mem.flush();
  const again = createOwnerMemory({ file, logger: quiet });
  assert.equal(again.get('o1@s.whatsapp.net').history[0].content, 'baru');
});