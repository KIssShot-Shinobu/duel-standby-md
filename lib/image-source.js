/**
 * Sumber gambar anime untuk plugin `.sfw` (aman) dan `.nsfw` (18+).
 *
 * Provider yang didukung (semua gratis, tanpa akun):
 *   - danbooru  : booru terbesar, bisa tag + rating (`rating:explicit` / `rating:safe`)
 *   - yandere   : Moebooru, tag + rating
 *   - purrbot   : endpoint tetap (kategori), SFW & NSFW
 *   - nekosbest : kategori SFW (PNG/GIF)
 *   - safebooru : booru SFW, bisa tag
 *
 * Aturan yang dipatuhi modul ini:
 *   1. Gambar DIUNDUH lalu dikirim (bukan hotlink) + cache berkas opsional.
 *   2. Tag terlarang (konten anak) ditolak di query DAN disaring dari hasil.
 *   3. Ada fallback berurutan; provider yang gagal tidak menghentikan sisanya.
 *   4. User-Agent deskriptif + timeout, sesuai permintaan tiap API.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const USER_AGENT = 'RTXZY-Clean (bot WhatsApp; fitur .sfw/.nsfw)';

/**
 * Tag yang tidak boleh diminta maupun ditampilkan.
 * Konten seksual yang melibatkan anak adalah kejahatan di semua yurisdiksi —
 * ini bukan opsi, dan sengaja dicek dua kali (query + hasil API).
 */
export const DEFAULT_BLOCKED_TAGS = [
  'loli',
  'lolicon',
  'shota',
  'shotacon',
  'child',
  'children',
  'kids',
  'toddler',
  'infant',
  'baby',
  'underage',
  'minor',
  'pedo',
  'pedophile',
  'cub',
  'elementary_school',
  'kindergarten',
];

/** Pecah input user menjadi daftar tag (`"cat ears, maid"` -> `['cat','ears','maid']`). */
export function normalizeTags(input = '') {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[,;]+/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Pecah sebuah tag menjadi kata (`loli_(genshin_impact)` -> `['loli','genshin','impact']`). */
export function tagTokens(tag = '') {
  return String(tag)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Cari tag terlarang pada daftar tag (memeriksa tiap kata, jadi `loli_*` ikut kena). */
export function findBlockedTags(list = [], blocked = DEFAULT_BLOCKED_TAGS) {
  const block = new Set(blocked.map((item) => String(item).toLowerCase()));
  const hits = new Set();
  for (const item of list) {
    for (const token of tagTokens(item)) {
      if (block.has(token)) hits.add(String(item));
    }
  }
  return [...hits];
}

/** Acak satu elemen; `rng` bisa diganti saat tes. */
const pickOne = (list, rng = Math.random) => (list.length ? list[Math.floor(rng() * list.length) % list.length] : null);

/** URL-encode tag pencarian booru (`rating:explicit cat_ears`). */
const booruQuery = (tags = []) => encodeURIComponent(tags.filter(Boolean).join(' '));

const firstTag = (value = '') => String(value).split(' ').filter(Boolean)[0] || '';

/** Rating booru (`s`/`q`/`e`) -> label manusia. */
const ratingLabel = (rating = '') =>
  ({ s: 'safe', g: 'safe', general: 'safe', q: 'questionable', sensitive: 'questionable', e: 'explicit' })[String(rating).toLowerCase()] ||
  String(rating || '');

// ── Provider ───────────────────────────────────────────────────────────────

const PURRBOT_NSFW = [
  'anal',
  'blowjob',
  'cum',
  'fuck',
  'neko',
  'pussylick',
  'solo',
  'solo_male',
  'threesome_fff',
  'threesome_ffm',
  'threesome_mmf',
  'yaoi',
  'yuri',
];

const PURRBOT_SFW = [
  'angry',
  'background',
  'bite',
  'blush',
  'comfy',
  'cry',
  'cuddle',
  'dance',
  'eevee',
  'fluff',
  'holo',
  'hug',
  'icon',
  'kiss',
  'kitsune',
  'lay',
  'lick',
  'neko',
  'okami',
  'pat',
  'poke',
  'pout',
  'senko',
  'shiro',
  'slap',
  'smile',
  'tail',
  'tickle',
];

const NEKOSBEST_SFW = [
  'neko',
  'waifu',
  'husbando',
  'kitsune',
  'hug',
  'pat',
  'kiss',
  'cuddle',
  'dance',
  'smile',
  'blush',
  'wink',
  'wave',
  'poke',
  'tickle',
  'slap',
  'kick',
  'punch',
  'bite',
  'bonk',
  'baka',
  'happy',
  'laugh',
  'cry',
  'pout',
  'yawn',
  'sleep',
  'think',
  'shrug',
  'stare',
  'highfive',
  'handshake',
  'handhold',
  'feed',
  'nom',
  'nya',
  'wag',
  'carry',
  'kabedon',
  'blowkiss',
  'thumbsup',
  'salute',
  'nod',
  'nope',
  'shocked',
  'bored',
  'facepalm',
  'tableflip',
  'spin',
  'shake',
  'run',
  'clap',
  'yeet',
  'sip',
  'smug',
  'teehee',
  'bleh',
  'confused',
  'peck',
  'lappillow',
];

/**
 * Registry provider.
 * Setiap provider punya `list()` yang mengembalikan item seragam:
 * `{ id, provider, label, url, page, rating, artist, tags }`
 */
export const PROVIDERS = {
  danbooru: {
    id: 'danbooru',
    label: 'Danbooru',
    modes: ['nsfw', 'sfw'],
    tagSearch: true,
    async list({ mode, query, limit, fetchJson }) {
      const tags = [`rating:${mode === 'nsfw' ? 'explicit' : 'safe'}`, ...normalizeTags(query)];
      const url = `https://danbooru.donmai.us/posts.json?limit=${limit}&tags=${booruQuery(tags)}`;
      const posts = await fetchJson(url);
      if (!Array.isArray(posts)) return [];
      return posts
        .map((post) => ({
          id: `danbooru:${post.id}`,
          provider: 'danbooru',
          label: 'Danbooru',
          url: post.large_file_url || post.file_url || '',
          page: post.id ? `https://danbooru.donmai.us/posts/${post.id}` : '',
          rating: ratingLabel(post.rating),
          artist: firstTag(post.tag_string_artist),
          tags: [post.tag_string_general, post.tag_string_character, post.tag_string_copyright]
            .filter(Boolean)
            .join(' ')
            .split(' ')
            .filter(Boolean),
        }))
        .filter((item) => item.url);
    },
  },

  yandere: {
    id: 'yandere',
    label: 'yande.re',
    modes: ['nsfw', 'sfw'],
    tagSearch: true,
    async list({ mode, query, limit, fetchJson }) {
      const tags = [`rating:${mode === 'nsfw' ? 'explicit' : 'safe'}`, ...normalizeTags(query)];
      const url = `https://yande.re/post.json?limit=${limit}&tags=${booruQuery(tags)}`;
      const posts = await fetchJson(url);
      if (!Array.isArray(posts)) return [];
      return posts
        .map((post) => ({
          id: `yandere:${post.id}`,
          provider: 'yandere',
          label: 'yande.re',
          // `sample_url` jauh lebih kecil dari file asli -> aman untuk WhatsApp
          url: post.sample_url || post.file_url || post.jpeg_url || '',
          page: post.id ? `https://yande.re/post/show/${post.id}` : '',
          rating: ratingLabel(post.rating),
          artist: firstTag(post.author || ''),
          tags: String(post.tags || '').split(' ').filter(Boolean),
        }))
        .filter((item) => item.url);
    },
  },

  purrbot: {
    id: 'purrbot',
    label: 'PurrBot',
    modes: ['nsfw', 'sfw'],
    tagSearch: false,
    categories: { nsfw: PURRBOT_NSFW, sfw: PURRBOT_SFW },
    async list({ mode, query, fetchJson }) {
      const wanted = normalizeTags(query)[0];
      const list = mode === 'nsfw' ? PURRBOT_NSFW : PURRBOT_SFW;
      const category = list.includes(wanted) ? wanted : mode === 'nsfw' ? 'neko' : 'neko';
      // Sebagian kategori hanya tersedia sebagai gif, sebagian img -> coba keduanya.
      const formats = mode === 'nsfw' ? ['gif', 'img'] : ['gif', 'img'];
      let lastError = null;
      for (const format of formats) {
        try {
          const url = `https://api.purrbot.site/v2/img/${mode}/${category}/${format}`;
          const payload = await fetchJson(url);
          const link = payload?.link;
          if (!link) continue;
          return [
            {
              id: `purrbot:${category}:${link}`,
              provider: 'purrbot',
              label: 'PurrBot',
              url: link,
              page: `https://purrbot.site/api/img/${mode}/${category}`,
              rating: mode === 'nsfw' ? 'explicit' : 'safe',
              artist: '',
              tags: [category].filter(Boolean),
            },
          ];
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError) throw lastError;
      return [];
    },
  },

  nekosbest: {
    id: 'nekosbest',
    label: 'nekos.best',
    modes: ['sfw'],
    tagSearch: false,
    categories: { sfw: NEKOSBEST_SFW },
    async list({ query, fetchJson }) {
      const wanted = normalizeTags(query)[0];
      const category = NEKOSBEST_SFW.includes(wanted) ? wanted : 'neko';
      const payload = await fetchJson(`https://nekos.best/api/v2/${category}`);
      const results = payload?.results || [];
      return results
        .map((item) => ({
          id: `nekosbest:${item.url}`,
          provider: 'nekosbest',
          label: 'nekos.best',
          url: item.url || '',
          page: item.source_url || item.artist_href || '',
          rating: 'safe',
          artist: item.artist_name || '',
          tags: [category],
        }))
        .filter((item) => item.url);
    },
  },

  safebooru: {
    id: 'safebooru',
    label: 'Safebooru',
    modes: ['sfw'],
    tagSearch: true,
    async list({ query, limit, fetchJson }) {
      const tags = normalizeTags(query);
      const url = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=${limit}${
        tags.length ? `&tags=${booruQuery(tags)}` : ''
      }`;
      const posts = await fetchJson(url);
      if (!Array.isArray(posts)) return [];
      return posts
        .map((post) => ({
          id: `safebooru:${post.id}`,
          provider: 'safebooru',
          label: 'Safebooru',
          url: post.sample_url || post.file_url || '',
          page: post.id ? `https://safebooru.org/index.php?page=post&s=view&id=${post.id}` : '',
          rating: ratingLabel(post.rating || 'safe'),
          artist: '',
          tags: String(post.tags || '').split(' ').filter(Boolean),
        }))
        .filter((item) => item.url);
    },
  },
};

/** Kategori bawaan sebuah provider untuk mode tertentu (dipakai `.sfwlist`). */
export function listCategories(mode = 'sfw') {
  const items = [];
  for (const provider of Object.values(PROVIDERS)) {
    const categories = provider.categories?.[mode] || [];
    if (categories.length) items.push({ provider: provider.label, id: provider.id, categories });
  }
  return items;
}

// ── Pemanggilan HTTP + cache ───────────────────────────────────────────────

/** Pembuat pemanggil JSON dengan User-Agent sopan + timeout. */
export function createJsonFetcher({ fetchImpl, timeoutMs = 20000 } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  return async function fetchJson(url) {
    const response = await doFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('respons bukan JSON');
    }
  };
}

/** Cache daftar hasil per (provider, mode, query, limit) supaya API tidak dibombardir. */
const listCache = new Map();
const LIST_CACHE_MAX = 200;

function cacheGet(key, ttlMs) {
  const hit = listCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    listCache.delete(key);
    return null;
  }
  return hit.items;
}

function cacheSet(key, items) {
  listCache.set(key, { at: Date.now(), items });
  while (listCache.size > LIST_CACHE_MAX) listCache.delete(listCache.keys().next().value);
}

/** Kosongkan cache daftar (dipakai tes). */
export function clearListCache() {
  listCache.clear();
}

// ── API utama ──────────────────────────────────────────────────────────────

/**
 * Ambil satu gambar dari provider sesuai mode.
 *
 * @param {{
 *   mode?: 'sfw'|'nsfw',
 *   query?: string,
 *   config?: any,
 *   fetchImpl?: Function,
 *   random?: Function,
 *   avoid?: Set<string>
 * }} options
 * @returns {Promise<{id:string, provider:string, label:string, url:string, page:string, rating:string, artist:string, tags:string[]}>}
 */
export async function fetchImage({ mode = 'sfw', query = '', config = {}, fetchImpl, random = Math.random, avoid = new Set() } = {}) {
  const settings = config.images || {};
  const blocked = Array.isArray(settings.blockedTags) && settings.blockedTags.length ? settings.blockedTags : DEFAULT_BLOCKED_TAGS;
  const queryTags = normalizeTags(query);

  const blockedQuery = findBlockedTags(queryTags, blocked);
  if (blockedQuery.length) throw new Error(`tag tidak diizinkan: ${blockedQuery.join(', ')}`);

  const order = (mode === 'nsfw' ? settings.providers?.nsfw : settings.providers?.sfw) || [];
  const fetchJson = createJsonFetcher({ fetchImpl, timeoutMs: settings.timeoutMs });
  const limit = Math.max(1, Math.min(Number(settings.limitPosts) || 30, 100));
  const ttlMs = Number(settings.listTtlMs) > 0 ? Number(settings.listTtlMs) : 10 * 60 * 1000;
  const errors = [];

  for (const id of order) {
    const provider = PROVIDERS[id];
    if (!provider || !provider.modes.includes(mode)) continue;

    const key = `${provider.id}|${mode}|${queryTags.join(' ')}|${limit}`;
    try {
      let items = cacheGet(key, ttlMs);
      if (!items) {
        items = (await provider.list({ mode, query, limit, fetchJson })) || [];
        if (items.length) cacheSet(key, items);
      }
      if (!items.length) {
        errors.push(`${provider.label}: tidak ada hasil`);
        continue;
      }

      const clean = items.filter((item) => !findBlockedTags(item.tags || [], blocked).length);
      if (!clean.length) {
        errors.push(`${provider.label}: semua hasil kena filter tag`);
        continue;
      }

      const fresh = clean.filter((item) => !avoid.has(item.id));
      const chosen = pickOne(fresh.length ? fresh : clean, random);
      if (chosen) return chosen;
      errors.push(`${provider.label}: kosong`);
    } catch (err) {
      errors.push(`${provider.label}: ${err.message}`);
    }
  }

  throw new Error(errors.length ? errors.join(' • ') : `tidak ada provider untuk mode ${mode}`);
}

/** Tebak ekstensi berkas dari URL (untuk cache lokal). */
function extensionOf(url = '') {
  const clean = String(url).split('?')[0];
  const match = clean.match(/\.(jpe?g|png|gif|webp)$/i);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
}

/** Buang berkas cache tertua kalau sudah melebihi batas. */
function evictCache(dir, maxFiles) {
  try {
    const files = fs
      .readdirSync(dir)
      .map((name) => ({ name, time: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const file of files.slice(Math.max(1, maxFiles))) fs.rmSync(path.join(dir, file.name), { force: true });
  } catch {
    /* cache bersifat opsional */
  }
}

/**
 * Unduh gambar (wajib — bukan hotlink) dan simpan ke cache lokal.
 *
 * @returns {Promise<Buffer>}
 */
export async function downloadImage(item, { config = {}, fetchImpl, timeoutMs } = {}) {
  if (!item?.url) throw new Error('URL gambar kosong');
  const settings = config.images || {};
  const dir = settings.cacheDir ? path.resolve(config.root || process.cwd(), settings.cacheDir) : '';
  const key = crypto.createHash('sha1').update(String(item.url)).digest('hex').slice(0, 24);
  const file = dir ? path.join(dir, `${item.provider || 'img'}-${key}${extensionOf(item.url)}`) : '';

  if (file) {
    try {
      if (fs.existsSync(file)) return fs.readFileSync(file);
    } catch {
      /* lanjut unduh */
    }
  }

  const doFetch = fetchImpl || globalThis.fetch;
  const response = await doFetch(item.url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
    signal: AbortSignal.timeout(Number(timeoutMs || settings.timeoutMs) || 20000),
  });
  if (!response.ok) throw new Error(`gagal mengunduh gambar (HTTP ${response.status})`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('berkas gambar kosong');

  const maxBytes = Number(settings.maxBytes) || 8 * 1024 * 1024;
  if (buffer.length > maxBytes) throw new Error(`gambar terlalu besar (${Math.round(buffer.length / 1024)} KB)`);

  if (file) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, buffer);
      evictCache(dir, Number(settings.cacheMax) || 200);
    } catch {
      /* cache bersifat opsional */
    }
  }

  return buffer;
}

/** Caption singkat: provider, rating, artist, dan tautan sumber (atribusi). */
export function imageCaption(item, { adult = false } = {}) {
  const head = `${adult ? '🔞' : '🖼️'} *${item.label}*${item.rating ? ` • ${item.rating}` : ''}`;
  const lines = [head];
  if (item.artist) lines.push(`🎨 ${item.artist}`);
  if (item.page) lines.push(`🔗 ${item.page}`);
  return lines.join('\n');
}

export default {
  USER_AGENT,
  DEFAULT_BLOCKED_TAGS,
  PROVIDERS,
  normalizeTags,
  tagTokens,
  findBlockedTags,
  listCategories,
  createJsonFetcher,
  clearListCache,
  fetchImage,
  downloadImage,
  imageCaption,
};
