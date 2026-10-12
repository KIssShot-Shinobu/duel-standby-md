/**
 * Cek cepat provider API NSFW dari IP tempat bot berjalan.
 *
 *   npm run check:nsfw
 *
 * Hanya mengambil METADATA (JSON) — tidak ada gambar dewasa yang diunduh atau
 * ditampilkan. Gunanya: blokir Cloudflare/geo berbeda-beda per IP, jadi provider
 * yang jalan di laptop belum tentu jalan di panel/VPS, dan sebaliknya.
 *
 * Provider yang butuh kredensial memakai env (opsional):
 *   GELBOORU_API_KEY + GELBOORU_USER_ID
 *   RULE34_API_KEY   + RULE34_USER_ID
 *   NHENTAI_API_KEY  (opsional; anon sudah cukup untuk cek)
 */
import print from '../lib/print.js';

const UA = 'RTXZY-Clean/1.2.7 (bot WhatsApp; cek ketersediaan provider NSFW)';
const TIMEOUT_MS = 12000;

const env = (name) => String(process.env[name] || '').trim();

const keyed = (name, required) => {
  const missing = required.filter((key) => !env(key));
  return missing.length ? `butuh env ${missing.join(' + ')}` : '';
};

/** Provider yang benar-benar menyajikan gambar/konten NSFW (bukan cuma daftar tag). */
const NSFW_PROVIDERS = new Set([
  'Danbooru',
  'yande.re',
  'e621',
  'PurrBot',
  'waifu.im cari',
  'nhentai v2',
  'MangaDex',
  'Gelbooru',
  'rule34.xxx',
  'waifu.pics',
]);

const PROVIDERS = [
  {
    name: 'Danbooru',
    note: 'NSFW • tanpa key',
    url: 'https://danbooru.donmai.us/posts.json?limit=3&tags=rating%3Ae',
    count: (json) => (Array.isArray(json) ? json.length : 0),
  },
  {
    name: 'yande.re',
    note: 'NSFW • tanpa key',
    url: 'https://yande.re/post.json?limit=3&tags=rating%3Ae',
    count: (json) => (Array.isArray(json) ? json.length : 0),
  },
  {
    name: 'Konachan',
    note: 'SFW mirror (.net)',
    url: 'https://konachan.net/post.json?limit=3&tags=rating%3Asafe',
    count: (json) => (Array.isArray(json) ? json.length : 0),
  },
  {
    name: 'e621',
    note: 'NSFW furry • 2 req/detik',
    url: 'https://e621.net/posts.json?limit=3&tags=rating%3Ae',
    count: (json) => json?.posts?.length ?? 0,
  },
  {
    name: 'PurrBot',
    note: 'NSFW GIF • tanpa key',
    url: 'https://api.purrbot.site/v2/img/nsfw/neko/gif',
    count: (json) => (json?.link ? 1 : 0),
  },
  {
    name: 'waifu.im',
    note: 'NSFW • Cloudflare ketat',
    url: 'https://api.waifu.im/tags',
    count: (json) =>
      json?.items?.some((item) => ['ero', 'hentai', 'ecchi'].includes(item.slug)) ? json.items.length : 0,
  },
  {
    name: 'waifu.im cari',
    note: 'endpoint gambar (rawan blokir)',
    url: 'https://api.waifu.im/search?included_tags=hentai&limit=3',
    count: (json) => json?.images?.length ?? 0,
  },
  {
    name: 'nhentai v2',
    note: 'manga/doujin • anon',
    url: 'https://nhentai.net/api/v2/galleries/random',
    count: (json) => (json?.id ?? json?.gallery_id ? 1 : 0),
  },
  {
    name: 'MangaDex',
    note: 'manga • rating pornographic',
    url: 'https://api.mangadex.org/manga?limit=3&contentRating%5B%5D=pornographic',
    count: (json) => json?.data?.length ?? 0,
  },
  {
    name: 'Nekosia',
    note: 'SFW/suggestive saja',
    url: 'https://api.nekosia.cat/api/v1/images/catgirl?rating=suggestive',
    count: (json) => (json?.image?.original?.url ? 1 : 0),
  },
  {
    name: 'nekos.best',
    note: 'SFW total',
    url: 'https://nekos.best/api/v2/neko',
    count: (json) => json?.results?.length ?? 0,
  },
  {
    name: 'Safebooru',
    note: 'SFW • tanpa key',
    url: 'https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=3',
    count: (json) => (Array.isArray(json) ? json.length : 0),
  },
  {
    name: 'Gelbooru',
    note: 'NSFW • wajib key',
    missing: () => keyed('gelbooru', ['GELBOORU_API_KEY', 'GELBOORU_USER_ID']),
    url: () =>
      `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=3&tags=rating%3Aexplicit` +
      `&api_key=${env('GELBOORU_API_KEY')}&user_id=${env('GELBOORU_USER_ID')}`,
    count: (json) => (Array.isArray(json) ? json.length : json?.post?.length ?? 0),
  },
  {
    name: 'rule34.xxx',
    note: 'NSFW • wajib key',
    missing: () => keyed('rule34', ['RULE34_API_KEY', 'RULE34_USER_ID']),
    url: () =>
      `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=3&tags=rating%3Aexplicit` +
      `&api_key=${env('RULE34_API_KEY')}&user_id=${env('RULE34_USER_ID')}`,
    count: (json) => (Array.isArray(json) ? json.length : 0),
  },
  {
    name: 'waifu.pics',
    note: 'dicek: API mati?',
    url: 'https://api.waifu.pics/nsfw/waifu',
    count: (json) => (json?.url ? 1 : 0),
  },
];

/** Ambil satu provider; selalu mengembalikan status, tidak pernah melempar. */
async function probe(provider) {
  const nsfw = NSFW_PROVIDERS.has(provider.name);
  const missing = provider.missing?.();
  if (missing) return { status: 'skip', detail: missing, nsfw };

  try {
    const target = typeof provider.url === 'function' ? provider.url() : provider.url;
    const response = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      const blocked = /cloudflare|just a moment|attention required/i.test(text);
      return { status: 'gagal', detail: `${response.status}${blocked ? ' • diblok Cloudflare' : ''}`, nsfw };
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { status: 'gagal', detail: 'respons bukan JSON', nsfw };
    }
    const count = provider.count(json);
    return { status: count > 0 ? 'ok' : 'kosong', detail: `${response.status} • ${count} hasil`, nsfw };
  } catch (err) {
    const reason = /ENOTFOUND|EAI_AGAIN/.test(String(err?.cause?.code || err?.message))
      ? 'DNS gagal (domain mati?)'
      : err?.name === 'TimeoutError'
        ? `timeout > ${TIMEOUT_MS} ms`
        : String(err?.message || err).slice(0, 60);
    return { status: 'gagal', detail: reason, nsfw };
  }
}

print.info(`Cek ${PROVIDERS.length} provider (metadata saja, tanpa mengunduh gambar)`);
console.log('');

const results = [];
for (const provider of PROVIDERS) {
  const result = await probe(provider);
  const label = `${provider.name.padEnd(12)} ${provider.note.padEnd(24)}`;
  if (result.status === 'ok') print.success(`${label} ${result.detail}`);
  else if (result.status === 'skip') print.info(`${label} dilewati — ${result.detail}`);
  else print.warn(`${label} ${result.status} — ${result.detail}`);
  results.push({ provider, ...result });
}

const ok = results.filter((item) => item.status === 'ok');
const okNsfw = ok.filter((item) => item.nsfw);
const gagal = results.filter((item) => item.status === 'gagal');

console.log('');
print.kv('Jalan', `${ok.length}/${PROVIDERS.length} provider`, { tag: ok.length ? 'success' : 'warn' });
print.kv('Siap NSFW', okNsfw.length ? okNsfw.map((item) => item.provider.name).join(', ') : 'tidak ada', {
  tag: okNsfw.length ? 'success' : 'error',
});
if (gagal.length) print.kv('Bermasalah', gagal.map((item) => item.provider.name).join(', '), { tag: 'warn' });
print.info('Fallback disarankan: Danbooru → yande.re → PurrBot → Nekosia (SFW).');
print.info('Detail riset + catatan ToS: docs/NSFW-API-RESEARCH.md');

process.exit(okNsfw.length ? 0 : 1);
