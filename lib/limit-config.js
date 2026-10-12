/**
 * Pengaturan limit per command / kategori (oleh owner).
 *
 * Biaya limit bawaan datang dari plugin (`handler.limit` = true / angka / false).
 * Owner bisa menimpanya lewat database (`settings.limit`):
 *
 *   mode 'default' : ikut plugin
 *   mode 'free'    : gratis (tidak memotong limit)
 *   mode 'on'      : tetap pakai limit (minimal 1)
 *   mode 'custom'  : pakai limit sebesar angka tertentu
 *
 * Prioritas: pengaturan command > pengaturan kategori > bawaan plugin.
 */

export const LIMIT_ACTIONS = {
  default: { mode: 'default' },
  gratis: { mode: 'free' },
  free: { mode: 'free' },
  nol: { mode: 'free' },
  pakai: { mode: 'on' },
  on: { mode: 'on' },
  ya: { mode: 'on' },
};

export const ACTION_LABEL = {
  default: 'ikut plugin',
  gratis: 'gratis (tanpa limit)',
  free: 'gratis (tanpa limit)',
  pakai: 'pakai limit',
  on: 'pakai limit',
};

const MAX_COST = 1000;

/** Terjemahkan aksi dari user menjadi pengaturan limit. */
export function parseLimitAction(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw in LIMIT_ACTIONS) return LIMIT_ACTIONS[raw];
  const number = Number(raw);
  if (Number.isFinite(number) && number >= 0) return { mode: 'custom', cost: Math.min(MAX_COST, Math.floor(number)) };
  return null;
}

export function ensureLimitSettings(db) {
  if (!db?.data) return { commands: {}, categories: {} };
  if (!db.data.settings || typeof db.data.settings !== 'object') db.data.settings = {};
  const settings = db.data.settings;
  if (!settings.limit || typeof settings.limit !== 'object') settings.limit = { commands: {}, categories: {} };
  if (!settings.limit.commands || typeof settings.limit.commands !== 'object') settings.limit.commands = {};
  if (!settings.limit.categories || typeof settings.limit.categories !== 'object') settings.limit.categories = {};
  return settings.limit;
}

/** Biaya limit bawaan sebuah plugin. */
export function pluginLimitCost(plugin) {
  if (typeof plugin?.limit === 'number' && plugin.limit > 0) return plugin.limit;
  return plugin?.limit === true ? 1 : 0;
}

/**
 * Normalisasi argumen: boleh plugin langsung, boleh entry dari PluginManager
 * (`{ name, category, plugin }`).
 */
function normalizeTarget(target) {
  const plugin = target?.plugin || target || {};
  const name = target?.name || plugin.name || '';
  const category = target?.category || plugin.tags?.[0] || '';
  return { plugin, name, category };
}

/**
 * Hitung biaya limit efektif untuk sebuah plugin/entry.
 * @returns {{cost: number, base: number, mode: string, source: 'default'|'command'|'category'|'plugin', free: boolean}}
 */
export function resolveLimit(db, target) {
  const { plugin, name, category } = normalizeTarget(target);
  const settings = ensureLimitSettings(db);
  const rawCommand = name ? settings.commands[name] : undefined;
  const rawCategory = category ? settings.categories[category] : undefined;
  const base = pluginLimitCost(plugin);

  // Entri dengan mode 'default' = tidak ada aturan (biar kategori bisa berlaku lagi).
  const commandEntry = rawCommand && rawCommand.mode !== 'default' ? rawCommand : undefined;
  const categoryEntry = rawCategory && rawCategory.mode !== 'default' ? rawCategory : undefined;

  const entry = commandEntry || categoryEntry || null;
  const source = commandEntry ? 'command' : categoryEntry ? 'category' : 'plugin';
  const mode = entry?.mode || 'default';

  let cost = base;
  if (mode === 'free') cost = 0;
  else if (mode === 'on') cost = base > 0 ? base : 1;
  else if (mode === 'custom') cost = Math.max(0, Math.min(MAX_COST, Number(entry.cost) || 0));

  return { cost, base, mode, source, free: cost === 0 };
}

export function resolveLimitCost(db, plugin) {
  return resolveLimit(db, plugin).cost;
}
export function setCommandLimit(db, name, action) {
  const settings = ensureLimitSettings(db);
  if (!action || action.mode === 'default') delete settings.commands[name];
  else settings.commands[name] = { ...action };
  db?.touch?.();
  return settings.commands[name] || { mode: 'default' };
}

export function setCategoryLimit(db, tag, action) {
  const settings = ensureLimitSettings(db);
  if (!action || action.mode === 'default') delete settings.categories[tag];
  else settings.categories[tag] = { ...action };
  db?.touch?.();
  return settings.categories[tag] || { mode: 'default' };
}

/** Ringkasan pengaturan limit untuk ditampilkan ke owner. */
export function limitSummary(db, plugins) {
  const settings = ensureLimitSettings(db);
  const entries = plugins?.list || [];

  const fromPlugin = { free: 0, paid: 0 };
  for (const entry of entries) {
    if (pluginLimitCost(entry.plugin) > 0) fromPlugin.paid += 1;
    else fromPlugin.free += 1;
  }

  const describe = (entry) => {
    if (entry.mode === 'free') return 'gratis';
    if (entry.mode === 'custom') return `${entry.cost} limit`;
    if (entry.mode === 'on') return 'pakai limit';
    return 'ikut plugin';
  };

  const commandOverrides = Object.entries(settings.commands).map(([name, entry]) => {
    const plugin = entries.find((item) => item.name === name);
    return { name, label: plugin?.help[0] || name, setting: describe(entry) };
  });

  const categoryOverrides = Object.entries(settings.categories).map(([tag, entry]) => ({
    tag,
    setting: describe(entry),
  }));

  return { fromPlugin, commandOverrides, categoryOverrides };
}

export function formatLimitInfo(resolved) {
  if (resolved.cost <= 0) return 'gratis';
  const base = `biaya ${resolved.cost}`;
  if (resolved.mode === 'default') return `${base} (bawaan plugin)`;
  if (resolved.source === 'category') return `${base} (aturan kategori)`;
  if (resolved.source === 'command') return `${base} (aturan owner)`;
  return base;
}

export default {
  LIMIT_ACTIONS,
  parseLimitAction,
  ensureLimitSettings,
  pluginLimitCost,
  resolveLimit,
  resolveLimitCost,
  setCommandLimit,
  setCategoryLimit,
  limitSummary,
  formatLimitInfo,
};
