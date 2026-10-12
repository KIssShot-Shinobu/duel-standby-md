/**
 * Plugin manager bergaya RTXZY-MD.
 *
 * Kontrak plugin (compatible dengan ekosistem RTXZY/wabot-aq):
 *   const handler = async (m, ctx) => { ... }        // command handler (opsional)
 *   handler.command = /^(ping)$/i                      // RegExp | string | string[]
 *   handler.help    = ['ping']                         // daftar bantuan
 *   handler.tags    = ['main']                         // kategori menu
 *   handler.limit   = true | false | 2                 // biaya limit
 *   handler.owner   = true                             // hanya owner
 *   handler.admin   = true                             // hanya admin grup
 *   handler.botAdmin= true                             // bot harus admin
 *   handler.group   = true                             // hanya di grup
 *   handler.private = true                             // hanya di chat pribadi
 *   handler.register= true                             // wajib terdaftar
 *   handler.premium = true                             // hanya premium
 *   handler.before  = async (m, ctx) => true           // hook sebelum command
 *   handler.all     = async (m, ctx) => {}             // hook tiap pesan (tanpa command)
 *   export default handler
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  help: [],
  tags: [],
  limit: false,
  owner: false,
  admin: false,
  botAdmin: false,
  group: false,
  private: false,
  register: false,
  premium: false,
};

export function getCommandNames(plugin) {
  if (!plugin?.command) return [];
  if (plugin.command instanceof RegExp) return [];
  if (Array.isArray(plugin.command)) return plugin.command.flatMap(getCommandNames);
  return [String(plugin.command).toLowerCase()];
}

/**
 * Nama command yang dipakai untuk index/menu.
 * Plugin dengan `command` berupa RegExp tidak punya nama literal, jadi
 * dipakai `handler.help` sebagai nama tampilan (seperti RTXZY/wabot-aq).
 * Saat dispatch, regex-nya tetap diverifikasi agar tidak salah panggil.
 */
export function getDisplayNames(plugin) {
  const literal = getCommandNames(plugin);
  if (literal.length) return literal;
  if (plugin?.command instanceof RegExp && Array.isArray(plugin?.help)) {
    return plugin.help.map((name) => String(name).toLowerCase());
  }
  return [];
}

export function isRegexCommand(plugin) {
  return plugin?.command instanceof RegExp;
}

export function categoryOf(fileName, plugin) {
  const tag = (plugin?.tags || [])[0];
  if (tag) return String(tag).toLowerCase();
  const base = path.basename(fileName, path.extname(fileName));
  if (base.startsWith('_')) return 'event';
  const prefix = base.split('-')[0];
  return prefix ? prefix.toLowerCase() : 'misc';
}

export class PluginManager {
  /** @param {string} dir @param {{logger?: any}} options */
  constructor(dir, { logger = console } = {}) {
    this.dir = path.resolve(dir);
    this.logger = logger;
    /** @type {Map<string, any>} */
    this.plugins = new Map();
    /** @type {Map<string, any>} */
    this.commandIndex = new Map();
    this.hooks = { before: [], all: [] };
    this.errors = [];
    this.watcher = null;
    this._reloadTimer = null;
  }

  async loadAll() {
    if (!fs.existsSync(this.dir)) {
      this.logger?.warn?.(`[plugins] folder tidak ditemukan: ${this.dir}`);
      return this;
    }
    const files = fs
      .readdirSync(this.dir)
      .filter((file) => file.endsWith('.js'))
      .sort();
    for (const file of files) {
      await this.loadFile(path.join(this.dir, file)).catch((err) => {
        this.errors.push({ file, message: err.message });
        this.logger?.error?.(`[plugins] gagal memuat ${file}: ${err.message}`);
      });
    }
    this.rebuildIndex();
    return this;
  }

  async loadFile(file, { reload = false } = {}) {
    const absolute = path.resolve(file);
    const name = path.basename(absolute);
    const url = pathToFileURL(absolute).href + (reload ? `?v=${Date.now()}` : '');
    const module = await import(url);
    const plugin = module.default ?? module.handler ?? module;
    if (!plugin || (typeof plugin !== 'function' && typeof plugin !== 'object')) {
      throw new Error('plugin tidak mengekspor function/object');
    }

    if (typeof plugin === 'function' && !plugin.command && !plugin.before && !plugin.all) {
      this.errors.push({ file: name, message: 'plugin tanpa command/before/all' });
      return null;
    }

    const entry = {
      name,
      file: absolute,
      category: categoryOf(absolute, plugin),
      plugin,
      commands: getDisplayNames(plugin),
      regex: isRegexCommand(plugin),
      help: plugin.help || DEFAULTS.help,
      tags: plugin.tags || DEFAULTS.tags,
    };
    this.plugins.set(name, entry);
    this.rebuildIndex();
    return entry;
  }

  unloadFile(file) {
    const name = path.basename(file);
    if (this.plugins.has(name)) {
      this.plugins.delete(name);
      this.rebuildIndex();
      return true;
    }
    return false;
  }

  rebuildIndex() {
    this.commandIndex = new Map();
    this.hooks = { before: [], all: [], onGroupParticipants: [], onGroupsUpdate: [], onCall: [] };
    for (const entry of this.plugins.values()) {
      for (const command of entry.commands) {
        if (this.commandIndex.has(command)) {
          const previous = this.commandIndex.get(command);
          this.logger?.warn?.(`[plugins] command "${command}" dobel: ${previous.name} & ${entry.name}`);
        }
        this.commandIndex.set(command, entry);
      }
      for (const hook of ['before', 'all', 'onGroupParticipants', 'onGroupsUpdate', 'onCall']) {
        if (typeof entry.plugin[hook] === 'function') this.hooks[hook].push(entry);
      }
    }
    return this;
  }

  /** Cari plugin dari nama command (index literal dulu, lalu scan regex). */
  find(command) {
    if (!command) return null;
    const key = String(command).toLowerCase();
    const indexed = this.commandIndex.get(key);
    if (indexed && (!indexed.regex || indexed.plugin.command.test(key))) return indexed;
    for (const entry of this.plugins.values()) {
      if (entry.regex && entry.plugin.command.test(key)) return entry;
    }
    return null;
  }

  /** Semua command literal (untuk menu & validasi duplikat). */
  get commands() {
    return [...this.commandIndex.keys()].sort();
  }

  get list() {
    return [...this.plugins.values()];
  }

  get size() {
    return this.plugins.size;
  }

  categories() {
    const groups = new Map();
    for (const entry of this.list) {
      const list = groups.get(entry.category) || [];
      list.push(entry);
      groups.set(entry.category, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  summary() {
    const { before, all, onGroupParticipants, onGroupsUpdate, onCall } = this.hooks;
    return {
      total: this.size,
      commands: this.commandIndex.size,
      hooks: before.length + all.length + onGroupParticipants.length + onGroupsUpdate.length + onCall.length,
      errors: this.errors.length,
    };
  }

  /**
   * Pantau perubahan file plugin -> hot reload.
   * @param {(event: {type: string, file: string}) => void} onChange
   */
  watch(onChange) {
    if (this.watcher) return this.watcher;
    try {
      this.watcher = fs.watch(this.dir, { persistent: false }, (_event, filename) => {
        if (!filename || !String(filename).endsWith('.js')) return;
        const file = path.join(this.dir, String(filename));
        clearTimeout(this._reloadTimer);
        this._reloadTimer = setTimeout(async () => {
          try {
            if (fs.existsSync(file)) {
              await this.loadFile(file, { reload: true });
              onChange?.({ type: 'reload', file });
            } else {
              this.unloadFile(file);
              onChange?.({ type: 'remove', file });
            }
          } catch (err) {
            onChange?.({ type: 'error', file, message: err.message });
          }
        }, 300);
      });
      this.watcher.unref?.();
    } catch (err) {
      this.logger?.warn?.(`[plugins] hot reload tidak aktif: ${err.message}`);
    }
    return this.watcher;
  }

  close() {
    this.watcher?.close?.();
    this.watcher = null;
  }
}

export default PluginManager;
