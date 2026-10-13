import test from 'node:test';
import assert from 'node:assert/strict';

test('env JIKAN_BASE dipakai sebagai base URL (default api.jikan.moe)', async () => {
  const prev = process.env.JIKAN_BASE;

  // Tanpa override -> default
  delete process.env.JIKAN_BASE;
  let called = '';
  globalThis.fetch = async (url) => {
    called = String(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ title: 'Naruto' }] }),
      json: async () => ({ data: [{ title: 'Naruto' }] }),
    };
  };
  const plain = await import(`../lib/jikan.js?bust=${Date.now()}-a`);
  await plain.searchAnime({ q: 'naruto', limit: 1 });
  assert.equal(called, 'https://api.jikan.moe/v4/anime?q=naruto&limit=1');

  // Dengan override -> base diganti (path trailing slash dibersihkan)
  process.env.JIKAN_BASE = 'https://jikan-proxy.example.net/v4/';
  const proxied = await import(`../lib/jikan.js?bust=${Date.now()}-b`);
  await proxied.searchAnime({ q: 'naruto', limit: 1 });
  assert.equal(called, 'https://jikan-proxy.example.net/v4/anime?q=naruto&limit=1');

  if (prev === undefined) delete process.env.JIKAN_BASE;
  else process.env.JIKAN_BASE = prev;
});