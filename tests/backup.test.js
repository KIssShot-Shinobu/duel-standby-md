import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { backupFiles, backupProblem, sendDatabaseBackup } from '../lib/backup.js';

/** Config + file database sementara di folder tmp. */
function siapkan({ ownerAi = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
  const file = path.join(dir, 'database.json');
  fs.writeFileSync(file, '{"users":{},"chats":{}}');
  const ownerFile = path.join(dir, 'owner-ai.json');
  if (ownerAi) fs.writeFileSync(ownerFile, '{"owner":[]}');

  const config = {
    database: { file },
    ai: { ownerFile },
    bot: { timezone: 'Asia/Jakarta' },
    backup: { enabled: true, intervalHours: 6, telegramToken: '123:abc', telegramChatId: '42' },
  };
  return { dir, file, config };
}

test('backupProblem menjelaskan env yang belum diisi', () => {
  const { config } = siapkan();
  assert.equal(backupProblem(config), '');

  assert.match(backupProblem({ ...config, backup: { ...config.backup, telegramToken: '' } }), /TELEGRAM_BOT_TOKEN/);
  assert.match(backupProblem({ ...config, backup: { ...config.backup, telegramChatId: '' } }), /TELEGRAM_CHAT_ID/);
});

test('backupFiles hanya mengambil file yang benar-benar ada', () => {
  const tanpa = siapkan();
  assert.deepEqual(
    backupFiles(tanpa.config).map((f) => f.name),
    ['database.json'],
  );

  const dengan = siapkan({ ownerAi: true });
  assert.deepEqual(
    backupFiles(dengan.config).map((f) => f.name),
    ['database.json', 'owner-ai.json'],
  );
});

test('sendDatabaseBackup mengirim file ke Telegram dan menyimpan database dulu', async () => {
  const { config } = siapkan();
  const panggilan = [];
  let disimpan = false;

  const db = {
    save: async (segera) => {
      disimpan = segera;
    },
  };
  const fetchImpl = async (url, opts) => {
    panggilan.push({ url, opts });
    return { ok: true, status: 200, text: async () => '' };
  };

  const hasil = await sendDatabaseBackup(db, config, { fetchImpl, now: Date.UTC(2026, 10, 13, 3, 0, 0) });

  assert.equal(disimpan, true);
  assert.equal(panggilan.length, 1);
  assert.equal(panggilan[0].url, 'https://api.telegram.org/bot123:abc/sendDocument');
  assert.equal(panggilan[0].opts.method, 'POST');

  const body = panggilan[0].opts.body;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('chat_id'), '42');
  assert.equal(body.get('document').name, 'database.json');
  assert.match(body.get('caption'), /Backup/);

  assert.equal(hasil.sent, 1);
  assert.equal(hasil.bytes, 23);
});

test('sendDatabaseBackup meneruskan penolakan Telegram sebagai error jelas', async () => {
  const { config } = siapkan();
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });

  await assert.rejects(() => sendDatabaseBackup(null, config, { fetchImpl }), /Telegram menolak \(401\)/);
});

test('sendDatabaseBackup menolak jalan tanpa token', async () => {
  const { config } = siapkan();
  const kosong = { ...config, backup: { ...config.backup, telegramToken: '' } };
  await assert.rejects(() => sendDatabaseBackup(null, kosong, { fetchImpl: async () => assert.fail('tidak boleh memanggil jaringan') }), /TELEGRAM_BOT_TOKEN/);
});
