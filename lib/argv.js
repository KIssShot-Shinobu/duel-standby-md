/**
 * Parser argumen CLI bergaya RTXZY-MD.
 *   node index.js --qr --pair 628xxx --prefix . --db json
 * Semua flag dikembalikan dalam bentuk { 'nama-flag': true | 'nilai' }.
 *
 * Hanya flag yang butuh nilai (lihat VALUE_FLAGS) yang "memakan" argumen
 * berikutnya; sisanya dianggap boolean. Jadi `--no-connect extra` tidak
 * menelan "extra" sebagai nilai.
 */
const VALUE_FLAGS = new Set(['prefix', 'pair', 'db', 'port', 'session', 'host', 'env', 'p']);

export function parseArgv(argv = process.argv.slice(2)) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (!arg.startsWith('--') && !(arg.startsWith('-') && arg.length === 2)) {
      positionals.push(arg);
      continue;
    }

    const body = arg.startsWith('--') ? arg.slice(2) : arg.slice(1);
    const eq = body.indexOf('=');
    if (eq > -1) {
      flags[body.slice(0, eq).toLowerCase()] = body.slice(eq + 1);
      continue;
    }

    const key = body.toLowerCase();
    const next = argv[i + 1];
    if (VALUE_FLAGS.has(key) && next !== undefined && !String(next).startsWith('-')) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  // Alias pendek biar nyaman dipakai.
  if (flags.q === true && flags.qr === undefined) flags.qr = true;
  if (flags.p && flags.prefix === undefined) flags.prefix = flags.p;

  return { flags, positionals };
}

export function flagEnabled(flags, name, defaultValue = false) {
  if (!(name in flags)) return defaultValue;
  const value = flags[name];
  if (value === false || value === 'false' || value === '0') return false;
  return true;
}

export default { parseArgv, flagEnabled };
