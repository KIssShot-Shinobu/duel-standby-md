import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { backupSessionDir, hasUsableSession, readCreds, sessionInfo, shouldRequestPairing } from '../lib/session.js';

const tmpSession = (creds) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-session-'));
  if (creds !== undefined) {
    fs.writeFileSync(path.join(dir, 'creds.json'), typeof creds === 'string' ? creds : JSON.stringify(creds));
  }
  return dir;
};

test('readCreds: null kalau tidak ada / rusak', () => {
  assert.equal(readCreds(tmpSession()), null);
  assert.equal(readCreds(tmpSession('{ bukan json')), null);
  assert.equal(readCreds(tmpSession({ me: { id: '6281:1@s.whatsapp.net' } })).me.id, '6281:1@s.whatsapp.net');
});

test('hasUsableSession: sesi hasil QR (me.id, registered=false) tetap dianggap login', () => {
  // Ini kasus yang bikin bot minta pairing code padahal sudah login.
  const qrSession = tmpSession({ registered: false, me: { id: '6289530694332:3@s.whatsapp.net', name: 'Shinobu' } });
  assert.equal(hasUsableSession(qrSession), true);

  const pairingSession = tmpSession({ registered: true, me: { id: '6289530694332:3@s.whatsapp.net' } });
  assert.equal(hasUsableSession(pairingSession), true);

  const emptySession = tmpSession({ registered: false });
  assert.equal(hasUsableSession(emptySession), false);

  assert.equal(hasUsableSession(tmpSession()), false);
  assert.equal(hasUsableSession(path.join(os.tmpdir(), 'folder-yang-tidak-ada-xyz')), false);
});

test('sessionInfo merangkum keadaan sesi', () => {
  const dir = tmpSession({ registered: false, me: { id: '6281:1@s.whatsapp.net' } });
  const info = sessionInfo(dir);
  assert.equal(info.exists, true);
  assert.equal(info.hasCreds, true);
  assert.equal(info.registered, false);
  assert.equal(info.me, '6281:1@s.whatsapp.net');
  assert.equal(info.usable, true);
});

test('shouldRequestPairing: pairing code hanya untuk sesi kosong', () => {
  const emptySession = tmpSession();
  const existingSession = tmpSession({ registered: false, me: { id: '6289530694332:3@s.whatsapp.net' } });

  // kasus utama: sesi sudah ada -> JANGAN minta pairing code
  assert.deepEqual(shouldRequestPairing({ pair: '6289530694332', sessionDir: existingSession }), {
    allowed: false,
    reason: 'session-exists',
  });
  // sesi kosong + nomor pairing -> boleh
  assert.deepEqual(shouldRequestPairing({ pair: '6289530694332', sessionDir: emptySession }), {
    allowed: true,
    reason: 'fresh-session',
  });
  // mode QR -> tidak pernah minta pairing code
  assert.deepEqual(shouldRequestPairing({ pair: '6289530694332', qr: true, sessionDir: emptySession }), {
    allowed: false,
    reason: 'qr-mode',
  });
  // tanpa nomor pairing -> tidak minta
  assert.deepEqual(shouldRequestPairing({ pair: '', sessionDir: emptySession }), {
    allowed: false,
    reason: 'no-pairing-number',
  });
});

test('backupSessionDir memindahkan folder sesi tanpa menghapus isinya', () => {
  const dir = tmpSession({ registered: true });
  const target = backupSessionDir(dir);
  assert.ok(target, 'backup gagal');
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(path.join(target, 'creds.json')), true);
  assert.match(path.basename(target), /^rtxzy-session-.*\.logged-out-/);

  // folder besar dihapus agar tidak menumpuk di temp
  fs.rmSync(target, { recursive: true, force: true });
  assert.equal(backupSessionDir(path.join(os.tmpdir(), 'tidak-ada-xyz')), null);
});
