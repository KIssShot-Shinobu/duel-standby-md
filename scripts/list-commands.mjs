/**
 * Daftar semua command bot, dibaca langsung dari `plugins/`.
 *
 *   node scripts/list-commands.mjs              -> tampilkan di terminal
 *   node scripts/list-commands.mjs --markdown   -> tulis docs/COMMANDS.md
 *   node scripts/list-commands.mjs --prefix .   -> prefix yang ditampilkan
 */
import fs from 'node:fs';
import path from 'node:path';
import { PluginManager } from '../lib/plugins.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const markdown = args.includes('--markdown');
const prefixIndex = args.indexOf('--prefix');
const prefix = prefixIndex >= 0 ? args[prefixIndex + 1] : '.';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const manager = new PluginManager(path.join(ROOT, 'plugins'), { logger: quiet });
await manager.loadAll();

const flagList = (plugin) => {
  const flags = [];
  if (plugin.owner) flags.push('owner');
  if (plugin.premium) flags.push('premium');
  if (plugin.admin) flags.push('admin grup');
  if (plugin.botAdmin) flags.push('bot harus admin');
  if (plugin.group) flags.push('hanya grup');
  if (plugin.private) flags.push('hanya japri');
  if (plugin.register) flags.push('wajib daftar');
  if (plugin.prefix === false) flags.push('tanpa prefix');
  if (plugin.limit === true) flags.push('1 limit');
  else if (typeof plugin.limit === 'number' && plugin.limit > 0) flags.push(`${plugin.limit} limit`);
  return flags;
};

const rows = manager.list.map((entry) => ({
  category: entry.category,
  file: entry.name,
  commands: (entry.help.length ? entry.help : entry.commands).map(String),
  flags: flagList(entry.plugin),
  eventOnly: entry.commands.length === 0,
  hooks: ['before', 'all', 'onGroupParticipants', 'onGroupsUpdate', 'onCall'].filter(
    (hook) => typeof entry.plugin?.[hook] === 'function',
  ),
}));

const categories = [...new Set(rows.map((row) => row.category))].sort((a, b) => {
  if (a === 'event') return 1;
  if (b === 'event') return -1;
  return a.localeCompare(b);
});

const totalCommands = rows.filter((row) => !row.eventOnly).reduce((sum, row) => sum + row.commands.length, 0);

const lines = [];
lines.push(`🤖 DAFTAR COMMAND — ${rows.length} plugin, ${totalCommands} command, ${categories.length} kategori`);
lines.push(`Prefix: ${prefix} (bisa diganti lewat .env PREFIX atau --prefix)`);
lines.push('');

for (const category of categories) {
  const group = rows.filter((row) => row.category === category);
  lines.push(`━━━ ${category.toUpperCase()} (${group.length} plugin) ━━━`);
  for (const row of group) {
    const names = row.commands.length ? row.commands.map((name) => `${prefix}${name}`).join(', ') : '(event otomatis)';
    const flags = row.flags.length ? `  [${row.flags.join(' • ')}]` : '';
    lines.push(`  ${names}${flags}`);
    lines.push(`      ↳ ${row.file}${row.hooks.length ? ` • hook: ${row.hooks.join(', ')}` : ''}`);
  }
  lines.push('');
}

const output = lines.join('\n');
console.log(output);

if (markdown) {
  const md = [];
  md.push('# Daftar Command');
  md.push('');
  md.push(`> Dibuat otomatis oleh \`npm run commands -- --markdown\` — ${rows.length} plugin, ${totalCommands} command.`);
  md.push(`> Prefix default: \`${prefix}\` (lihat \`PREFIX\` di \`.env\`).`);
  md.push('');
  for (const category of categories) {
    const group = rows.filter((row) => row.category === category);
    md.push(`## ${category}`);
    md.push('');
    md.push('| Command | Keterangan syarat | File |');
    md.push('|---|---|---|');
    for (const row of group) {
      const names = row.commands.length ? row.commands.map((name) => `\`${prefix}${name}\``).join(', ') : '_(event otomatis)_';
      md.push(`| ${names} | ${row.flags.length ? row.flags.join(', ') : '—'} | \`${row.file}\` |`);
    }
    md.push('');
  }
  const target = path.join(ROOT, 'docs', 'COMMANDS.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${md.join('\n')}\n`, 'utf8');
  console.log(`\n📄 Dokumentasi ditulis ke docs/COMMANDS.md`);
}
