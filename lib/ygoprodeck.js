/**
 * Klien Yu-Gi-Oh! API (YGOPRODeck v7) — gratis, tanpa API key.
 * Dokumentasi: https://ygoprodeck.com/api-guide/
 *
 * Catatan dari penyedia API:
 *  - rate limit 20 request/detik (lebih dari itu diblokir 1 jam);
 *  - data cardinfo di-cache di sisi mereka ±2 hari;
 *  - mereka meminta data disimpan lokal semaksimal mungkin -> klien ini
 *    menyimpan cache di memori + opsional ke berkas (database/ygoprodeck-cache.json);
 *  - gambar kartu jangan di-hotlink terus-menerus: bot mengunduh gambar
 *    sekali per perintah lalu mengirimkannya sebagai lampiran WhatsApp.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BASE = 'https://db.ygoprodeck.com/api/v7';

/** Parameter yang diterima cardinfo.php */
export const CARD_FILTERS = [
  'name',
  'fname',
  'id',
  'konami_id',
  'type',
  'atk',
  'def',
  'level',
  'race',
  'attribute',
  'link',
  'linkmarker',
  'scale',
  'cardset',
  'archetype',
  'banlist',
  'sort',
  'format',
  'staple',
  'misc',
  'has_effect',
  'startdate',
  'enddate',
  'dateregion',
  'num',
  'offset',
  'language',
];

/** Alias nilai `type` supaya enak diketik dari WhatsApp. */
export const TYPE_ALIASES = {
  normal: 'Normal Monster',
  effect: 'Effect Monster',
  ritual: 'Ritual Monster',
  fusion: 'Fusion Monster',
  synchro: 'Synchro Monster',
  xyz: 'XYZ Monster',
  link: 'Link Monster',
  pendulum: 'Pendulum Effect Monster',
  spell: 'Spell Card',
  trap: 'Trap Card',
  token: 'Token',
  skill: 'Skill Card',
};

const BOOLEAN_STYLE = { has_effect: 'bool', staple: 'yes', misc: 'yes' };

/** Parameter yang diterima cardsetsinfo.php */
export const SET_FILTERS = ['setcode', 'setname'];

/**
 * Bersihkan & normalkan parameter sebelum dikirim ke API.
 *
 * Catatan hasil uji langsung: API menolak `num` tanpa `offset`
 * ("You cannot use only one of 'offset' or 'num'"), jadi keduanya
 * selalu dilengkapi otomatis.
 */
export function normalizeParams(params = {}, allowed = CARD_FILTERS) {
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(params)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const key = String(rawKey).toLowerCase();
    if (!allowed.includes(key)) continue;
    if (typeof rawValue === 'boolean') {
      const style = BOOLEAN_STYLE[key];
      result[key] = style === 'bool' ? String(rawValue) : rawValue ? 'yes' : 'no';
      continue;
    }
    result[key] = String(rawValue).trim();
  }

  // num & offset harus berpasangan.
  if (result.num !== undefined && result.offset === undefined) result.offset = '0';
  if (result.offset !== undefined && result.num === undefined) result.num = '50';

  return result;
}

/** Terjemahkan ekspresi ">2500 / >=2500 / <4 / <=8" menjadi format API (gt2500, lte8). */
export function encodeComparison(operator, value) {
  const number = String(value).replace(/[^\d-]/g, '');
  if (!number) return null;
  const map = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '=': '' };
  if (!(operator in map)) return null;
  return `${map[operator]}${number}`;
}

/**
 * Parse teks pencarian lanjutan, contoh:
 *   atk>2500 level<=4 type=xyz attribute=dark sort=atk num=5
 *   type="xyz monster" archetype="blue-eyes"
 */
export function parseSearchQuery(text = '') {
  const params = {};
  const unknown = [];
  const tokens = String(text).match(/(?:[a-z_]+)\s*(?:>=|<=|>|<|=)\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi) || [];

  for (const token of tokens) {
    const match = token.match(/^([a-z_]+)\s*(>=|<=|>|<|=)\s*(.+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const operator = match[2];
    const value = match[3].replace(/^["']|["']$/g, '').trim();
    if (value === '') continue;

    if (['atk', 'def', 'level'].includes(key) && operator !== '=') {
      params[key] = encodeComparison(operator, value);
      continue;
    }
    if (key === 'type') {
      const lower = value.toLowerCase();
      params.type = TYPE_ALIASES[lower] || TYPE_ALIASES[lower.split(/\s+/)[0]] || value;
      continue;
    }
    if (key === 'sort') {
      params.sort = value.toLowerCase();
      continue;
    }
    if (['num', 'offset', 'link', 'scale'].includes(key)) {
      params[key] = value.replace(/[^\d]/g, '');
      continue;
    }
    if (CARD_FILTERS.includes(key)) {
      params[key] = value;
      continue;
    }
    unknown.push(key);
  }

  return { params: normalizeParams(params), unknown };
}

export function cardTitle(card) {
  return card?.name || 'Tanpa nama';
}

/** Ringkasan statistik dasar sebuah kartu. */
export function cardStats(card = {}) {
  return {
    id: card.id,
    name: card.name,
    type: card.humanReadableCardType || card.type || '-',
    race: card.race || '-',
    attribute: card.attribute || '-',
    level: card.level ?? card.linkval ?? null,
    atk: card.atk ?? null,
    def: card.def ?? null,
    scale: card.scale ?? null,
    archetype: card.archetype || null,
    isLink: card.frameType === 'link',
    isPendulum: Boolean(card.scale),
  };
}

export function banlistSummary(card = {}) {
  const info = card.banlist_info;
  if (!info) return null;
  const parts = [];
  if (info.ban_tcg) parts.push(`TCG: ${info.ban_tcg}`);
  if (info.ban_ocg) parts.push(`OCG: ${info.ban_ocg}`);
  if (info.ban_goat) parts.push(`Goat: ${info.ban_goat}`);
  return parts.length ? parts.join(' • ') : null;
}

const priceFormat = (value, symbol) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `${symbol}${number.toFixed(2)}`;
};

export function priceSummary(card = {}) {
  const price = (card.card_prices || [])[0];
  if (!price) return null;
  return (
    [
      priceFormat(price.tcgplayer_price, '$') ? `TCGplayer ${priceFormat(price.tcgplayer_price, '$')}` : null,
      priceFormat(price.cardmarket_price, '€') ? `Cardmarket ${priceFormat(price.cardmarket_price, '€')}` : null,
      priceFormat(price.ebay_price, '$') ? `eBay ${priceFormat(price.ebay_price, '$')}` : null,
      priceFormat(price.amazon_price, '$') ? `Amazon ${priceFormat(price.amazon_price, '$')}` : null,
    ]
      .filter(Boolean)
      .join(' • ') || null
  );
}

export function raritySummary(card = {}, limit = 3) {
  const sets = card.card_sets || [];
  if (!sets.length) return null;
  const cheapest = [...sets]
    .filter((set) => Number(set.set_price) > 0)
    .sort((a, b) => Number(a.set_price) - Number(b.set_price))
    .slice(0, limit)
    .map((set) => `${set.set_code} (${set.set_rarity}) $${Number(set.set_price).toFixed(2)}`);
  return cheapest.length ? cheapest.join(' • ') : null;
}

/** Caption pendek untuk foto kartu (batas caption WhatsApp ±1024 karakter). */
export function formatCardCaption(card = {}) {
  const stats = cardStats(card);
  const lines = [`🃏 *${cardTitle(card)}*`, '', `📛 ${stats.type}`, `🌀 ${stats.attribute}${stats.race !== '-' ? ` • ${stats.race}` : ''}`];

  if (stats.isLink) lines.push(`🔗 Link-${stats.level ?? '-'}${card.linkmarkers ? ` (${card.linkmarkers.join(', ')})` : ''}`);
  else if (stats.level !== null) lines.push(`${stats.isPendulum ? '🔮' : '⭐'} Level/Rank ${stats.level}${stats.scale ? ` • Scale ${stats.scale}` : ''}`);

  if (stats.atk !== null || stats.def !== null) {
    lines.push(`⚔️ ATK ${stats.atk ?? '?'} / DEF ${stats.def ?? (stats.isLink ? 'LINK' : '?')}`);
  }
  if (stats.archetype) lines.push(`🏷️ Archetype: ${stats.archetype}`);

  const banlist = banlistSummary(card);
  if (banlist) lines.push(`🚫 Banlist: ${banlist}`);

  const price = priceSummary(card);
  if (price) lines.push(`💰 ${price}`);

  lines.push('', `🆔 ${stats.id}`, `🔗 ${card.ygoprodeck_url || `https://db.ygoprodeck.com/card/?search=${encodeURIComponent(cardTitle(card))}`}`);
  return lines.join('\n').slice(0, 1000);
}

/** Teks lengkap (efek + set termurah + tanggal rilis bila ada). */
export function formatCardText(card = {}) {
  const parts = [`📖 *Efek ${cardTitle(card)}*`, '', card.desc || '-'];

  const misc = card.misc_info?.[0];
  if (misc) {
    const dates = [misc.tcg_date ? `TCG ${misc.tcg_date}` : null, misc.ocg_date ? `OCG ${misc.ocg_date}` : null].filter(Boolean);
    if (dates.length) parts.push('', `📅 ${dates.join(' • ')}`);
    if (misc.formats?.length) parts.push(`🎮 Format: ${misc.formats.join(', ')}`);
    if (misc.treated_as) parts.push(`🔁 Treated as: ${misc.treated_as}`);
  }

  const rarity = raritySummary(card, 3);
  if (rarity) parts.push('', `🏷️ *Cetakan termurah:*\n${rarity}`);

  const totalSets = (card.card_sets || []).length;
  if (totalSets) parts.push('', `_Total ${totalSets} cetakan di database._`);

  return parts.join('\n');
}

/** Satu baris ringkas untuk daftar hasil pencarian. */
export function formatCardLine(card = {}, index = null) {
  const stats = cardStats(card);
  const statsText = [
    stats.atk !== null ? `ATK ${stats.atk}` : null,
    stats.def !== null ? `DEF ${stats.def}` : null,
    stats.isLink && stats.level !== null ? `LINK-${stats.level}` : null,
    !stats.isLink && stats.level !== null ? `Lv${stats.level}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const prefix = index === null ? '•' : `${index + 1}.`;
  return `${prefix} *${stats.name}* — ${stats.type}${statsText ? ` (${statsText})` : ''}\n   🆔 ${stats.id}`;
}

export function errorMessage(payload, status) {
  if (payload && typeof payload === 'object' && payload.error) return String(payload.error);
  return `YGOPRODeck membalas HTTP ${status}`;
}

/** Hapus berkas cache gambar paling lama bila melebihi batas. */
function evictImageCache(dir, max) {
  try {
    const files = fs
      .readdirSync(dir)
      .map((name) => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const item of files.slice(Math.max(0, max))) {
      fs.unlinkSync(path.join(dir, item.name));
    }
  } catch {
    /* cache bersifat opsional */
  }
}

/**
 * Unduh gambar kartu (dan simpan ke cache lokal).
 *
 * API YGOPRODeck meminta gambar diunduh & disimpan sendiri, bukan di-hotlink
 * terus-menerus — karena itu hasilnya di-cache di `cacheDir`.
 *
 * @param {object} card
 * @param {{cacheDir?: string, maxCache?: number, fetchImpl?: Function, variant?: 'full'|'small'|'cropped'|number}} options
 * @returns {Promise<Buffer|null>}
 */
export async function downloadCardImage(card, { cacheDir = '', maxCache = 300, fetchImpl, variant = 'full' } = {}) {
  const images = card?.card_images || [];
  if (!images.length) return null;

  // `variant` boleh angka -> pilih artwork ke-n (alt art)
  const index = typeof variant === 'number' ? Math.min(Math.max(0, variant), images.length - 1) : 0;
  const image = images[index];
  const url =
    variant === 'cropped'
      ? image.image_url_cropped
      : variant === 'small'
        ? image.image_url_small
        : image.image_url;
  if (!url) return null;

  const cacheKey = `${image.id || card.id || 'card'}-${typeof variant === 'number' ? variant : variant}.jpg`;
  const cachePath = cacheDir ? path.join(cacheDir, cacheKey) : '';

  if (cachePath) {
    try {
      if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);
    } catch {
      /* lanjut unduh */
    }
  }

  const doFetch = fetchImpl || globalThis.fetch;
  const response = await doFetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`gagal mengunduh gambar kartu (HTTP ${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('gambar kartu kosong');

  if (cachePath) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cachePath, buffer);
      evictImageCache(cacheDir, maxCache);
    } catch {
      /* cache bersifat opsional */
    }
  }

  return buffer;
}

/**
 * Buat klien. `fetchImpl` bisa diganti untuk keperluan tes.
 */
export function createClient({
  base = DEFAULT_BASE,
  timeout = 30000,
  fetchImpl,
  cacheFile = '',
  cacheMax = 400,
  cacheTtlMs = 2 * 24 * 60 * 60 * 1000,
  logger = console,
} = {}) {
  const memory = new Map();
  const doFetch = fetchImpl || globalThis.fetch;

  let disk = null;
  let diskDirty = false;
  let diskTimer = null;

  const loadDisk = () => {
    if (disk || !cacheFile) return disk;
    disk = {};
    try {
      if (fs.existsSync(cacheFile)) {
        const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (parsed && typeof parsed === 'object') disk = parsed;
      }
    } catch {
      disk = {};
    }
    return disk;
  };

  const flushDisk = () => {
    if (!cacheFile || !diskDirty || !disk) return;
    try {
      const entries = Object.entries(disk).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, cacheMax);
      disk = Object.fromEntries(entries);
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(disk), 'utf8');
      fs.renameSync(tmp, cacheFile);
      diskDirty = false;
    } catch {
      /* cache disk bersifat opsional */
    }
  };

  const readCache = (key) => {
    const hit = memory.get(key);
    if (hit && Date.now() - hit.at < cacheTtlMs) return hit.data;
    if (cacheFile) {
      const stored = loadDisk()[key];
      if (stored && Date.now() - stored.at < cacheTtlMs) {
        memory.set(key, { at: stored.at, data: stored.data });
        return stored.data;
      }
    }
    return null;
  };

  const writeCache = (key, data) => {
    memory.set(key, { at: Date.now(), data });
    if (memory.size > cacheMax) memory.delete(memory.keys().next().value);
    if (!cacheFile) return;
    const serialized = JSON.stringify(data);
    if (serialized.length > 512 * 1024) return; // jangan simpan respons raksasa
    loadDisk()[key] = { at: Date.now(), data };
    diskDirty = true;
    if (!diskTimer) {
      diskTimer = setTimeout(() => {
        diskTimer = null;
        flushDisk();
      }, 5000);
      diskTimer.unref?.();
    }
  };

  async function request(endpoint, params = {}, { useCache = true, allowed = CARD_FILTERS } = {}) {
    const query = new URLSearchParams(normalizeParams(params, allowed)).toString();
    const url = `${base.replace(/\/+$/, '')}/${endpoint}${query ? `?${query}` : ''}`;
    const cacheKey = `${endpoint}?${query}`;

    if (useCache) {
      const cached = readCache(cacheKey);
      if (cached) return cached;
    }

    let response;
    try {
      response = await doFetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'rtxzy-md-clean (WhatsApp bot)' },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new Error(`Tidak bisa menghubungi YGOPRODeck: ${err.message}`);
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Respons YGOPRODeck tidak valid (HTTP ${response.status})`);
    }
    if (!response.ok || payload?.error) throw new Error(errorMessage(payload, response.status));

    if (useCache) writeCache(cacheKey, payload);
    return payload;
  }

  return {
    base,
    request,
    card: (params) => request('cardinfo.php', params),
    cardByName: (name) => request('cardinfo.php', { name }),
    fuzzyCards: (fname, extra = {}) => request('cardinfo.php', { fname, ...extra }),
    cardById: (id) => request('cardinfo.php', { id }),
    random: () => request('randomcard.php', {}, { useCache: false }),
    sets: () => request('cardsets.php', {}, { allowed: [] }),
    /**
     * Info 1 kartu dari kode set (mis. SDY-046).
     * API v7 menerima `setcode`; kalau ditolak, dicoba `setname`.
     */
    setInfo: async (codeOrName) => {
      const value = String(codeOrName || '').trim();
      try {
        return await request('cardsetsinfo.php', { setcode: value }, { allowed: SET_FILTERS });
      } catch (err) {
        if (!/no valid parameter/i.test(err.message)) throw err;
        return request('cardsetsinfo.php', { setname: value }, { allowed: SET_FILTERS });
      }
    },
    archetypes: () => request('archetypes.php', {}, { allowed: [] }),
    dbVersion: () => request('checkDBVer.php', {}, { useCache: false, allowed: [] }),
    cacheSize: () => memory.size,
    clearCache: () => {
      memory.clear();
      disk = {};
      diskDirty = false;
      if (cacheFile && fs.existsSync(cacheFile)) {
        try {
          fs.unlinkSync(cacheFile);
        } catch {
          /* ignore */
        }
      }
    },
    flush: () => flushDisk(),
    logger,
  };
}

let singleton = null;

/** Klien bersama, dipakai semua plugin Yu-Gi-Oh!. */
export function getClient(config = {}) {
  const options = config.ygoprodeck || {};
  const disabled = options.cacheFile === false || options.cacheFile === '';
  const cacheFile = disabled
    ? ''
    : options.cacheFile || path.resolve(config.root || process.cwd(), 'database/ygoprodeck-cache.json');
  if (!singleton) {
    singleton = createClient({
      base: options.base || DEFAULT_BASE,
      timeout: options.timeout || 30000,
      cacheFile,
      cacheMax: options.cacheMax || 400,
      cacheTtlMs: options.cacheTtlMs || 2 * 24 * 60 * 60 * 1000,
    });
    return singleton;
  }
  if (options.base && singleton.base !== options.base) {
    singleton = createClient({ base: options.base, timeout: options.timeout || 30000, cacheFile });
  }
  return singleton;
}

export default {
  DEFAULT_BASE,
  CARD_FILTERS,
  SET_FILTERS,
  createClient,
  getClient,
  normalizeParams,
  parseSearchQuery,
  encodeComparison,
  formatCardCaption,
  formatCardText,
  formatCardLine,
  cardStats,
  banlistSummary,
  priceSummary,
  raritySummary,
  downloadCardImage,
  TYPE_ALIASES,
};
