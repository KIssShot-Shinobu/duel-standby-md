/**
 * Pengaturan menu: kategori & command mana yang **tampil** dan mana yang **aktif**.
 *
 * Disimpan di database (`db.data.settings.menu`) supaya bertahan setelah restart.
 *
 *   visible : tampil atau tidak di `.menu`
 *   enabled : boleh dipakai atau tidak (kalau off -> command diblokir)
 *
 * Kategori "nsfw" berisi plugin gambar 18+ (`nsfw-image.js`). Kategori ini
 * **menyala secara default** sebagai master switch, tetapi kontennya tetap
 * **opt-in per grup** (`db.chat(jid).nsfw`, diatur admin grup/owner lewat
 * `.nsfw on`). Owner bisa mematikan seluruh fitur kapan saja dengan
 * `.category nsfw off` (atau per command: `.cmdset nsfw-image.js off`).
 */

/** Kategori bawaan yang dikenal walau belum ada plugin-nya. */
export const KNOWN_CATEGORIES = {
  nsfw: { label: 'NSFW (18+)', adult: true, visible: false, enabled: true },
  reaction: { label: 'Reaction GIF', visible: true, enabled: true },
};

export function defaultMenuSettings() {
  const categories = {};
  for (const [tag, meta] of Object.entries(KNOWN_CATEGORIES)) {
    categories[tag] = { visible: meta.visible !== false, enabled: meta.enabled === true };
  }
  return { categories, commands: {} };
}

/** Pastikan struktur pengaturan menu ada; kembalikan objeknya. */
export function ensureMenuSettings(db) {
  if (!db?.data) return defaultMenuSettings();
  if (!db.data.settings || typeof db.data.settings !== 'object') db.data.settings = {};
  const settings = db.data.settings;
  if (!settings.menu || typeof settings.menu !== 'object') settings.menu = defaultMenuSettings();
  const menu = settings.menu;
  if (!menu.categories || typeof menu.categories !== 'object') menu.categories = {};
  if (!menu.commands || typeof menu.commands !== 'object') menu.commands = {};

  // daftarkan kategori bawaan yang belum ada
  for (const [tag, meta] of Object.entries(KNOWN_CATEGORIES)) {
    if (!menu.categories[tag]) {
      menu.categories[tag] = { visible: meta.visible !== false, enabled: meta.enabled === true };
    }
  }
  return menu;
}

const normalizeState = (entry) => ({ visible: entry?.visible !== false, enabled: entry?.enabled !== false });

export function categoryState(db, tag) {
  return normalizeState(ensureMenuSettings(db).categories[tag]);
}

export function commandState(db, name) {
  return normalizeState(ensureMenuSettings(db).commands[name]);
}

export const isCategoryVisible = (db, tag) => categoryState(db, tag).visible;
export const isCategoryEnabled = (db, tag) => categoryState(db, tag).enabled;
export const isCommandVisible = (db, name) => commandState(db, name).visible;
export const isCommandEnabled = (db, name) => commandState(db, name).enabled;

/** Kategori dewasa (mis. nsfw) — untuk perlakuan khusus saat dimatikan. */
export const isAdultCategory = (tag) => Boolean(KNOWN_CATEGORIES[String(tag)]?.adult);

/** Command tampil di menu hanya kalau command & kategorinya sama-sama visible. */
export function pluginVisible(db, plugin) {
  return commandState(db, plugin.name).visible && categoryState(db, plugin.category).visible;
}

/** Command boleh dijalankan hanya kalau command & kategorinya sama-sama enabled. */
export function pluginEnabled(db, plugin) {
  return commandState(db, plugin.name).enabled && categoryState(db, plugin.category).enabled;
}

/**
 * Ubah status sebuah kategori.
 * @param {any} db
 * @param {string} tag
 * @param {{visible?: boolean, enabled?: boolean}} patch
 */
export function setCategory(db, tag, patch = {}) {
  const menu = ensureMenuSettings(db);
  const current = categoryState(db, tag);
  const next = normalizeState({ ...current, ...patch });
  menu.categories[tag] = next;
  db.touch?.();
  return next;
}

/**
 * Ubah status sebuah command (key = nama berkas plugin, mis. `sticker-smeme.js`).
 */
export function setCommand(db, name, patch = {}) {
  const menu = ensureMenuSettings(db);
  const current = commandState(db, name);
  const next = normalizeState({ ...current, ...patch });
  menu.commands[name] = next;
  db.touch?.();
  return next;
}

export const labels = {
  visible: { true: 'tampil', false: 'disembunyikan' },
  enabled: { true: 'aktif', false: 'dimatikan' },
};

export function formatState(state) {
  return [state.visible ? '👁️ tampil' : '🚫 disembunyikan', state.enabled ? '✅ aktif' : '⛔ dimatikan'].join(' · ');
}

/**
 * Bungkus daftar command menjadi beberapa baris supaya tidak melebar di HP.
 */
export function wrapCommands(items, { prefix = '.', indent = '   ', separator = ' · ', maxWidth = 38 } = {}) {
  const lines = [];
  let current = '';
  for (const item of items) {
    const text = `${prefix}${item}`;
    const candidate = current ? `${current}${separator}${text}` : text;
    if (current && candidate.length > maxWidth) {
      lines.push(indent + current);
      current = text;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(indent + current);
  return lines;
}

export default {
  KNOWN_CATEGORIES,
  defaultMenuSettings,
  ensureMenuSettings,
  categoryState,
  commandState,
  isCategoryVisible,
  isCategoryEnabled,
  isCommandVisible,
  isCommandEnabled,
  isAdultCategory,
  pluginVisible,
  pluginEnabled,
  setCategory,
  setCommand,
  formatState,
  wrapCommands,
};
