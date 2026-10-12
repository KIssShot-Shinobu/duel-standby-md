import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readStatus, startHealthServer, writeStatus } from '../lib/health.js';

test('health server merespons / , /health dan 404', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-health-'));
  const statusFile = path.join(dir, 'status.json');

  writeStatus(statusFile, { connected: true, bot: 'Uji' });
  assert.equal(readStatus(statusFile).connected, true);

  const health = await startHealthServer({ port: 0, host: '127.0.0.1', statusFile, meta: { author: 'rtxzy-md-clean' } });
  try {
    const root = await (await fetch(`${health.url}/`)).json();
    assert.equal(root.response.status, true);
    assert.equal(root.response.connected, true);

    const healthBody = await (await fetch(`${health.url}/health`)).json();
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.bot, 'Uji');
    assert.ok(healthBody.uptime >= 0);

    const missing = await fetch(`${health.url}/tidak-ada`);
    assert.equal(missing.status, 404);
  } finally {
    await health.close();
  }
});

test('writeStatus menulis secara atomik', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-health-'));
  const file = path.join(dir, 'nested', 'status.json');
  assert.equal(writeStatus(file, { a: 1 }), true);
  assert.deepEqual(readStatus(file), { a: 1 });
  assert.equal(readStatus(path.join(dir, 'tidak-ada.json')), null);
});
