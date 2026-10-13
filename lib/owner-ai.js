/**
 * Memori percakapan AI dengan OWNER, disimpan di FILE TERPISAH
 * (default `database/owner-ai.json`) — bukan di record chat/user biasa.
 *
 * Tiap owner punya riwayat sendiri yang bisa lebih panjang dari history chat
 * biasa, dan bertahan antar restart. Penulisan atomik (tmp -> rename) dengan
 * debounce, sama seperti Database utama.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Satu instance memori owner untuk seluruh proses (di-flush saat shutdown). */
let singleton = null;

export function createOwnerMemory({ file = '', logger = console } = {}) {
  const store = {};
  let dirty = false;
  let timer = null;
  let loaded = false;

  const load = () => {
    if (loaded) return store;
    loaded = true;
    if (!file) return store;
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed)) store[key] = value;
        }
      }
    } catch {
      /* file rusak -> mulai bersih */
    }
    return store;
  };

  const flush = () => {
    if (!file || !dirty) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store), 'utf8');
      fs.renameSync(tmp, file);
      dirty = false;
    } catch (err) {
      logger?.error?.(`[owner-ai] gagal menyimpan memori: ${err.message}`);
    }
  };

  const schedule = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, 3000);
    timer.unref?.();
  };

  return {
    /** Riwayat sebuah owner, atau null. */
    get(jid) {
      return load()[jid] || null;
    },
    /** Tambah satu pesan ke riwayat owner, potong paling belakang `max`. */
    push(jid, role, content, max = 50) {
      load();
      const entry = (store[jid] = store[jid] || { history: [], lastAt: 0 });
      entry.history = [...entry.history, { role, content }].slice(-Math.max(1, Number(max) || 50));
      entry.lastAt = Date.now();
      schedule();
      return entry;
    },
    /** Hapus memori owner ini. */
    clear(jid) {
      load();
      if (store[jid]) {
        delete store[jid];
        schedule();
      }
    },
    flush,
    size() {
      return Object.keys(load()).length;
    },
  };
}

/** Ambil (atau buat) memori owner bersama untuk satu config. */
export function getOwnerMemory(config) {
  const ownerFile = config?.ai?.ownerFile
    ? path.resolve(config.root || process.cwd(), config.ai.ownerFile)
    : '';
  if (!singleton || singleton.file !== ownerFile) {
    singleton = createOwnerMemory({ file: ownerFile });
    singleton.file = ownerFile;
  }
  return singleton;
}

export default { createOwnerMemory, getOwnerMemory };