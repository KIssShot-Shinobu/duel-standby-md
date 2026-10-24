import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_BLOCKED_TAGS,
  clearListCache,
  downloadImage,
  fetchImage,
  findBlockedTags,
  imageCaption,
  listCategories,
  normalizeTags,
} from '../lib/image-source.js';
import { config } from '../config.js';

/** fetch tiruan: cocokkan URL dengan potongan string -> payload */
function makeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers || {} });
    const match = Object.entries(routes).find(([needle]) => String(url).includes(needle));
    if (!match) return { ok: false, status: 404, text: async () => '{"error":"rute tidak dikenal"}' };
    const value = typeof match[1] === 'function' ? match[1](String(url)) : match[1];
    if (value instanceof Error) throw value;
    if (value.status && value.status >= 400) {
      return { ok: false, status: value.status, text: async () => JSON.stringify(value.body || {}) };
    }
    if (value.buffer) {
      const buffer = value.buffer;
      return { ok: true, status: 200, arrayBuffer: async () => buffer };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(value) };
  };
  impl.calls = calls;
  return impl;
}

const imageConfig = (overrides = {}) => ({
  images: {
    timeoutMs: 2000,
    limitPosts: 5,
    listTtlMs: 60000,
    cacheDir: '',
    cacheMax: 10,
    maxBytes: 1024 * 1024,
    providers: { nsfw: ['danbooru'], sfw: ['nekosbest'] },
    blockedTags: DEFAULT_BLOCKED_TAGS,
    ...overrides,
  },
});

const DANBOORU_POST = {
  id: 111,
  rating: 'e',
  large_file_url: 'https://cdn.donmai.us/sample/aaa.jpg',
  file_url: 'https://cdn.donmai.us/original/aaa.jpg',
  tag_string_general: 'cat_ears maid',
  tag_string_character: 'rem_(re:zero)',
  tag_string_artist: 'some_artist',
  tag_string_copyright: '',
};

const YANDERE_POST = {
  id: 222,
  rating: 'e',
  sample_url: 'https://files.yande.re/sample/bbb.jpg',
  file_url: 'https://files.yande.re/image/bbb.jpg',
  tags: 'cat_ears swimsuit',
  author: 'other_artist',
};

// ── Filter tag ─────────────────────────────────────────────────────────────

test('findBlockedTags menolak tag anak walau menempel pada tag lain', () => {
  assert.deepEqual(findBlockedTags(['cat_ears', 'maid']), []);
  assert.deepEqual(findBlockedTags(['loli']), ['loli']);
  assert.deepEqual(findBlockedTags(['loli_(genshin_impact)']), ['loli_(genshin_impact)']);
  assert.deepEqual(findBlockedTags(['shota', 'cub']), ['shota', 'cub']);
});

test('normalizeTags memecah koma/spasi ganda', () => {
  assert.deepEqual(normalizeTags(' Cat Ears,  maid '), ['cat', 'ears', 'maid']);
});

// ── Pemilihan provider ─────────────────────────────────────────────────────

test('mode NSFW memakai Danbooru dengan rating:explicit', async () => {
  clearListCache();
  const fetchImpl = makeFetch({ 'danbooru.donmai.us/posts.json': [DANBOORU_POST] });
  const item = await fetchImage({ mode: 'nsfw', config: imageConfig(), fetchImpl });

  assert.equal(item.provider, 'danbooru');
  assert.equal(item.url, DANBOORU_POST.large_file_url);
  assert.equal(item.rating, 'explicit');
  assert.equal(item.page, 'https://danbooru.donmai.us/posts/111');
  assert.match(decodeURIComponent(fetchImpl.calls[0].url), /rating:explicit/);
  assert.match(fetchImpl.calls[0].headers['User-Agent'], /RTXZY-Clean/);
});

test('mode SFW memakai nekos.best dan membawa atribusi artist', async () => {
  clearListCache();
  const fetchImpl = makeFetch({
    'nekos.best/api/v2/nene': { results: [] },
    'nekos.best/api/v2/neko': {
      results: [{ url: 'https://nekos.best/api/v2/neko/abc.png', artist_name: 'Artist A', artist_href: 'https://x.test/a', source_url: 'https://pixiv.test/1' }],
    },
  });
  const item = await fetchImage({ mode: 'sfw', config: imageConfig(), fetchImpl });

  assert.equal(item.provider, 'nekosbest');
  assert.equal(item.artist, 'Artist A');
  assert.equal(item.page, 'https://pixiv.test/1');
  assert.equal(item.rating, 'safe');
});

test('SFW melewati provider yang hasilnya sudah dipakai agar tidak mengulang gambar', async () => {
  clearListCache();
  const fetchImpl = makeFetch({
    'nekos.best/api/v2/neko': {
      results: [{ url: 'https://nekos.best/api/v2/neko/repeated.png', artist_name: 'Artist A' }],
    },
    'danbooru.donmai.us/posts.json': [{ ...DANBOORU_POST, id: 777 }],
  });
  const config = imageConfig({ providers: { nsfw: [], sfw: ['nekosbest', 'danbooru'] } });

  const first = await fetchImage({ mode: 'sfw', config, fetchImpl });
  const second = await fetchImage({ mode: 'sfw', config, fetchImpl, avoid: new Set([first.id]) });

  assert.equal(first.provider, 'nekosbest');
  assert.equal(second.provider, 'danbooru');
  assert.notEqual(second.id, first.id);
});

test('provider yang gagal otomatis jatuh ke provider berikutnya', async () => {
  clearListCache();
  const fetchImpl = makeFetch({
    'danbooru.donmai.us': { status: 503, body: { error: 'down' } },
    'yande.re/post.json': [YANDERE_POST],
  });
  const item = await fetchImage({
    mode: 'nsfw',
    config: imageConfig({ providers: { nsfw: ['danbooru', 'yandere'], sfw: [] } }),
    fetchImpl,
  });

  assert.equal(item.provider, 'yandere');
  assert.equal(item.url, YANDERE_POST.sample_url, 'pakai sample (lebih kecil) bukan file asli');
});

test('hasil yang mengandung tag terlarang dibuang, bukan dikirim', async () => {
  clearListCache();
  const fetchImpl = makeFetch({
    'danbooru.donmai.us': [
      { ...DANBOORU_POST, id: 1, tag_string_general: 'loli dress' },
      { ...DANBOORU_POST, id: 2, tag_string_general: 'cat_ears dress' },
    ],
  });
  const item = await fetchImage({ mode: 'nsfw', config: imageConfig(), fetchImpl });
  assert.equal(item.id, 'danbooru:2', 'hanya hasil bersih yang boleh dipakai');
});

test('kalau semua hasil kena filter, pindah ke provider berikutnya', async () => {
  clearListCache();
  const fetchImpl = makeFetch({
    'danbooru.donmai.us': [{ ...DANBOORU_POST, tag_string_general: 'loli dress' }],
    'yande.re/post.json': [YANDERE_POST],
  });
  const item = await fetchImage({
    mode: 'nsfw',
    config: imageConfig({ providers: { nsfw: ['danbooru', 'yandere'], sfw: [] } }),
    fetchImpl,
  });
  assert.equal(item.provider, 'yandere');
});

test('query dengan tag terlarang ditolak sebelum memanggil API', async () => {
  clearListCache();
  const fetchImpl = makeFetch({});
  await assert.rejects(
    () => fetchImage({ mode: 'nsfw', query: 'loli cat_ears', config: imageConfig(), fetchImpl }),
    /tidak diizinkan/i,
  );
  assert.equal(fetchImpl.calls.length, 0, 'tidak boleh ada request ke API');
});

test('PurrBot memakai kategori yang diminta', async () => {
  clearListCache();
  const fetchImpl = makeFetch({ 'api.purrbot.site/v2/img/nsfw/yuri/gif': { link: 'https://cdn.purrbot.site/nsfw/yuri/gif/yuri_001.gif', error: false } });
  const item = await fetchImage({
    mode: 'nsfw',
    query: 'yuri',
    config: imageConfig({ providers: { nsfw: ['purrbot'], sfw: [] } }),
    fetchImpl,
  });
  assert.equal(item.provider, 'purrbot');
  assert.equal(item.url, 'https://cdn.purrbot.site/nsfw/yuri/gif/yuri_001.gif');
  assert.equal(item.rating, 'explicit');
});

test('daftar kategori tersedia untuk kedua mode', () => {
  const sfw = listCategories('sfw').map((group) => group.id);
  const nsfw = listCategories('nsfw').map((group) => group.id);
  assert.ok(sfw.includes('nekosbest'));
  assert.ok(sfw.includes('purrbot'));
  assert.ok(nsfw.includes('purrbot'));
});

// ── Unduh + cache ──────────────────────────────────────────────────────────

test('downloadImage mengunduh sekali lalu memakai cache lokal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtxzy-img-'));
  const imageConfigLocal = imageConfig({ cacheDir: 'cache/images', cacheMax: 5 });
  const buffer = Buffer.from('isi-gambar-palsu');
  const fetchImpl = makeFetch({ 'cdn.donmai.us': { buffer } });

  const first = await downloadImage({ url: 'https://cdn.donmai.us/a.jpg', provider: 'danbooru' }, { config: { root, images: imageConfigLocal.images }, fetchImpl });
  const second = await downloadImage({ url: 'https://cdn.donmai.us/a.jpg', provider: 'danbooru' }, { config: { root, images: imageConfigLocal.images }, fetchImpl });

  assert.equal(first.toString(), 'isi-gambar-palsu');
  assert.equal(second.toString(), 'isi-gambar-palsu');
  assert.equal(fetchImpl.calls.length, 1, 'panggilan kedua harus dari cache');
  assert.ok(fs.readdirSync(path.join(root, 'cache/images')).length === 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('downloadImage menolak berkas yang melebihi batas ukuran', async () => {
  const fetchImpl = makeFetch({ 'cdn.donmai.us': { buffer: Buffer.alloc(2048) } });
  await assert.rejects(
    () => downloadImage({ url: 'https://cdn.donmai.us/big.jpg' }, { config: { images: { maxBytes: 1024 } }, fetchImpl }),
    /terlalu besar/i,
  );
});

test('imageCaption mencantumkan provider dan tautan sumber', () => {
  const caption = imageCaption({
    label: 'Danbooru',
    rating: 'explicit',
    artist: 'some_artist',
    page: 'https://danbooru.donmai.us/posts/1',
  }, { adult: true });
  assert.match(caption, /Danbooru/);
  assert.match(caption, /explicit/);
  assert.match(caption, /some_artist/);
  assert.match(caption, /danbooru\.donmai\.us/);
  assert.match(caption, /🔞/);
});

test('purrbot tidak dipakai sebagai provider NSFW default', () => {
  assert.ok(!config.images.providers.nsfw.includes('purrbot'));
  assert.ok(config.images.providers.sfw.includes('purrbot'), 'SFW tetap memakai purrbot');
});
