import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import baseConfig from '../config.js';
import { handleMessage } from '../handler.js';
import { Database } from '../lib/database.js';
import { PluginManager } from '../lib/plugins.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const pluginsDir = path.resolve(import.meta.dirname, '..', 'plugins');
const SENDER = '628123456789@s.whatsapp.net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-dbg-'));
const db = new Database(path.join(dir, 'db.json'), { saveInterval: 60000, logger: quiet });
db.load();
const plugins = new PluginManager(pluginsDir, { logger: quiet });
await plugins.loadAll();
const sent = [];
const conn = {
  user: { id: '628999@s.whatsapp.net', name: 'Bot Uji' },
  sendMessage: async (chat, content) => { sent.push(content); return { key: { id: `M${sent.length}`, remoteJid: chat } }; },
  readMessages: async () => [],
  groupMetadata: async () => ({ subject: 'G', participants: [] }),
  getName: async () => 'x',
  contacts: {},
};

const u = db.user(SENDER);
u.saldo = 100000;
u.lastLimitReset = Date.now();

const msg = (t) => ({
  key: { remoteJid: SENDER, fromMe: false, id: `B${Math.random().toString(36).slice(2, 7)}` },
  message: { conversation: t },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Pembeli',
});

for (const cmd of ['.buylimit', '.buylimit 10', '.buylimit 30', '.buylimit 9999', '.profile']) {
  sent.length = 0;
  const r = await handleMessage(conn, msg(cmd), { plugins, db, config: baseConfig, logger: quiet });
  const cur = db.user(SENDER);
  console.log(`\n>>> ${cmd}`);
  console.log(`    result   : handled=${r.handled} reason=${r.reason}`);
  console.log(`    limit=${cur.limit} bonus=${cur.limitBonus} saldo=${cur.saldo}`);
  for (const s of sent) console.log(`    ---\n${(s?.text || '').replace(/\n/g, '\n    ')}`);
}
db.close();