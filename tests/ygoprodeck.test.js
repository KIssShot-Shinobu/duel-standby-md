import test from 'node:test';
import assert from 'node:assert/strict';

// Mock fetch global: wajib dipasang SEBELUM klien dibuat.
const calls = [];
const DARK_MAGICIAN = {
  id: 46986414,
  name: 'Dark Magician',
  type: 'Normal Monster',
  humanReadableCardType: 'Normal Monster',
  frameType: 'normal',
  desc: "''The ultimate wizard in terms of attack and defense.''",
  race: 'Spellcaster',
  atk: 2500,
  def: 2100,
  level: 7,
  attribute: 'DARK',
  archetype: 'Dark Magician',
  ygoprodeck_url: 'https://ygoprodeck.com/card/dark-magician-4003',
  banlist_info: { ban_tcg: 'Semi-Limited' },
  card_sets: [
    { set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB-005', set_rarity: 'Ultra Rare', set_price: '46.71' },
    { set_name: 'Starter Deck: Yugi', set_code: 'SDY-006', set_rarity: 'Ultra Rare', set_price: '9.96' },
  ],
  card_images: [{ id: 46986414, image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg' }],
  card_prices: [{ cardmarket_price: '0.02', tcgplayer_price: '0.36', ebay_price: '0.99', amazon_price: '14.45' }],
};

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2gAAAABJRU5ErkJggg==',
  'base64',
);

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload),
});

const binaryResponse = (buffer) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => buffer,
  text: async () => '',
});

globalThis.fetch = async (url) => {
  const target = String(url);
  calls.push(target);

  if (target.includes('images.ygoprodeck.com')) return binaryResponse(TINY_PNG);
  if (target.includes('randomcard.php')) return jsonResponse({ data: [{ ...DARK_MAGICIAN, id: 999, name: 'Random Card' }] });
  if (target.includes('cardsetsinfo.php')) {
    const query = new URL(target).searchParams;
    const setcode = query.get('setcode');
    const setname = query.get('setname');
    const payload = (code, name) => ({
      id: 46986414,
      name: 'Man-Eater Bug',
      set_name: name,
      set_code: code,
      set_rarity: 'Common',
      set_price: '2.25',
    });
    if (setcode && /^[A-Za-z]{2,6}-[A-Za-z0-9]+$/.test(setcode)) return jsonResponse(payload(setcode, 'Starter Deck: Yugi'));
    if (setcode) return jsonResponse({ error: "No valid parameter set. This API accepts the following parameters: 'setname'." }, 400);
    if (setname) return jsonResponse(payload('SDY-046', setname));
    return jsonResponse({ error: 'No valid parameter set.' }, 400);
  }
  if (target.includes('cardsets.php')) {
    return jsonResponse([
      { set_name: 'Metal Raiders', set_code: 'MRD', num_of_cards: 144, tcg_date: '2002-06-26' },
      { set_name: 'Battle of Chaos', set_code: 'BACH', num_of_cards: 100, tcg_date: '2022-02-10' },
    ]);
  }
  if (target.includes('archetypes.php')) {
    return jsonResponse([{ archetype_name: 'Blue-Eyes' }, { archetype_name: 'Dark Magician' }]);
  }
  if (target.includes('cardinfo.php')) {
    const query = new URL(target).searchParams;
    const name = query.get('name') || '';
    const fname = query.get('fname') || '';
    const banlist = query.get('banlist');

    if (name && name.toLowerCase() !== 'dark magician') {
      return jsonResponse({ error: 'No card matching your query was found in the database.' }, 400);
    }
    if (name) return jsonResponse({ data: [DARK_MAGICIAN] });
    if (fname) return jsonResponse({ data: [DARK_MAGICIAN, { ...DARK_MAGICIAN, id: 46986415, name: 'Dark Magician Girl' }] });
    if (banlist) {
      return jsonResponse({
        data: [
          { ...DARK_MAGICIAN, name: 'Forbidden Card', banlist_info: { ban_tcg: 'Forbidden' } },
          { ...DARK_MAGICIAN, name: 'Limited Card', banlist_info: { ban_tcg: 'Limited' } },
          { ...DARK_MAGICIAN, name: 'Semi Card', banlist_info: { ban_tcg: 'Semi-Limited' } },
        ],
        meta: { total_rows: 3 },
      });
    }
    return jsonResponse({ data: [DARK_MAGICIAN], meta: { total_rows: 1 } });
  }

  return jsonResponse({ error: `endpoint tidak dikenal: ${target}` }, 404);
};

const {
  DEFAULT_BASE,
  normalizeParams,
  parseSearchQuery,
  encodeComparison,
  createClient,
  formatCardCaption,
  formatCardText,
  formatCardLine,
  banlistSummary,
  priceSummary,
} = await import('../lib/ygoprodeck.js');
const { default: ygoPlugin } = await import('../plugins/game-yugioh.js');
const { default: searchPlugin } = await import('../plugins/game-yugioh-search.js');
const { default: banlistPlugin } = await import('../plugins/game-yugioh-banlist.js');

const testConfig = { root: process.cwd(), ygoprodeck: { base: DEFAULT_BASE, cacheFile: false } };

// ── Utilitas ────────────────────────────────────────────────────────────────

test('normalizeParams menyaring key tidak dikenal & menormalkan boolean', () => {
  assert.deepEqual(
    normalizeParams({ name: 'Dark Magician', staple: true, has_effect: false, misc: true, bogus: 'x', num: 5, empty: '' }),
    { name: 'Dark Magician', staple: 'yes', has_effect: 'false', misc: 'yes', num: '5', offset: '0' },
  );
});

test('normalizeParams: num & offset selalu berpasangan (aturan API)', () => {
  // num tanpa offset -> offset=0 (kalau tidak, API membalas HTTP 400)
  assert.deepEqual(normalizeParams({ fname: 'Magician', num: '3' }), { fname: 'Magician', num: '3', offset: '0' });
  // offset tanpa num -> num diisi default
  assert.deepEqual(normalizeParams({ offset: '20' }), { offset: '20', num: '50' });
  // param khusus endpoint lain tidak ikut disaring untuk endpoint itu
  assert.deepEqual(normalizeParams({ setcode: 'SDY-046' }, ['setcode', 'setname']), { setcode: 'SDY-046' });
  assert.deepEqual(normalizeParams({ setcode: 'SDY-046' }), {});
});

test('encodeComparison menerjemahkan operator', () => {
  assert.equal(encodeComparison('>', '2500'), 'gt2500');
  assert.equal(encodeComparison('>=', '2000'), 'gte2000');
  assert.equal(encodeComparison('<', '4'), 'lt4');
  assert.equal(encodeComparison('<=', '8'), 'lte8');
  assert.equal(encodeComparison('?', '5'), null);
});

test('parseSearchQuery mengurai filter lanjutan', () => {
  const { params, unknown } = parseSearchQuery('atk>2500 level<=4 attribute=dark sort=atk num=5');
  assert.equal(params.atk, 'gt2500');
  assert.equal(params.level, 'lte4');
  assert.equal(params.attribute, 'dark');
  assert.equal(params.sort, 'atk');
  assert.equal(params.num, '5');
  assert.deepEqual(unknown, []);

  assert.equal(parseSearchQuery('type=xyz').params.type, 'XYZ Monster');
  assert.equal(parseSearchQuery('type="xyz monster"').params.type, 'XYZ Monster');
  assert.equal(parseSearchQuery('type=spell card').params.type, 'Spell Card');
  assert.equal(parseSearchQuery('archetype="blue-eyes"').params.archetype, 'blue-eyes');
  assert.deepEqual(parseSearchQuery('foo=bar').unknown, ['foo']);
});

// ── Klien API ───────────────────────────────────────────────────────────────

test('klien memanggil endpoint yang benar & men-cache hasil', async () => {
  const client = createClient({ fetchImpl: globalThis.fetch, cacheFile: '' });
  const before = calls.length;

  const first = await client.cardByName('Dark Magician');
  assert.equal(first.data[0].name, 'Dark Magician');
  assert.match(calls.at(-1), /cardinfo\.php\?name=Dark\+Magician/);

  const second = await client.cardByName('Dark Magician');
  assert.equal(second.data[0].id, 46986414);
  assert.equal(calls.length, before + 1, 'permintaan kedua harus dilayani dari cache');
});

test('klien meneruskan pesan error dari API', async () => {
  const client = createClient({ fetchImpl: globalThis.fetch, cacheFile: '' });
  await assert.rejects(client.cardByName('Kartu Tidak Ada'), /No card matching your query/);
});

test('random card tidak di-cache', async () => {
  const client = createClient({ fetchImpl: globalThis.fetch, cacheFile: '' });
  await client.random();
  await client.random();
  assert.equal(calls.filter((url) => url.includes('randomcard.php')).length, 2);
});

test('endpoint pendukung: sets, setInfo (+fallback setname), archetypes', async () => {
  const client = createClient({ fetchImpl: globalThis.fetch, cacheFile: '' });
  assert.equal((await client.sets()).length, 2);
  assert.equal((await client.setInfo('SDY-046')).set_code, 'SDY-046');

  // kalau API menolak setcode, klien mencoba setname
  const byName = await client.setInfo('Starter Deck: Yugi');
  assert.equal(byName.set_name, 'Starter Deck: Yugi');
  assert.match(calls.at(-1), /cardsetsinfo\.php\?setname=Starter\+Deck/);

  assert.equal((await client.archetypes())[0].archetype_name, 'Blue-Eyes');
});

// ── Format ─────────────────────────────────────────────────────────────────

test('format kartu memuat statistik penting dan tetap muat caption', () => {
  const stats = { ...DARK_MAGICIAN, banlist_info: { ban_tcg: 'Semi-Limited' } };
  const caption = formatCardCaption(stats);
  assert.match(caption, /Dark Magician/);
  assert.match(caption, /Normal Monster/);
  assert.match(caption, /ATK 2500 \/ DEF 2100/);
  assert.match(caption, /Semi-Limited/);
  assert.match(caption, /TCGplayer \$0\.36/);
  assert.ok(caption.length <= 1024, `caption terlalu panjang: ${caption.length}`);

  const text = formatCardText(stats);
  assert.match(text, /ultimate wizard/);
  assert.match(text, /LOB-005/);

  const line = formatCardLine(DARK_MAGICIAN, 0);
  assert.match(line, /1\. \*Dark Magician\*/);
  assert.match(line, /46986414/);
});

test('banlistSummary & priceSummary menangani data kosong', () => {
  assert.equal(banlistSummary({}), null);
  assert.equal(banlistSummary(DARK_MAGICIAN), 'TCG: Semi-Limited');
  assert.equal(priceSummary({}), null);
  assert.match(priceSummary(DARK_MAGICIAN), /Cardmarket €0\.02/);
});

// ── Plugin ─────────────────────────────────────────────────────────────────

test('plugin .ygo mengirim foto + efek', async () => {
  const messages = [];
  const conn = { sendImage: async (_chat, buffer, caption) => messages.push({ type: 'image', size: buffer.length, caption }) };
  const m = { chat: '628111@s.whatsapp.net', reply: async (text) => messages.push({ type: 'text', text }) };

  await ygoPlugin(m, { conn, text: 'Dark Magician', config: testConfig, usedPrefix: '.', command: 'ygo' });

  assert.equal(messages[0].type, 'image');
  assert.match(messages[0].caption, /Dark Magician/);
  assert.ok(messages.some((item) => item.type === 'text' && /Efek/.test(item.text)));
});

test('plugin .ygo menampilkan pilihan saat nama tidak persis', async () => {
  const messages = [];
  const conn = { sendImage: async () => {} };
  const m = { chat: '628111@s.whatsapp.net', reply: async (text) => messages.push(text) };

  await ygoPlugin(m, { conn, text: 'Dark Magician G', config: testConfig, usedPrefix: '.', command: 'ygo' });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /kartu yang mirip/);
  assert.match(messages[0], /Dark Magician Girl/);
});

test('plugin .ygosearch menyusun filter & menampilkan hasil', async () => {
  const messages = [];
  const m = { chat: 'x', reply: async (text) => messages.push(text) };

  await searchPlugin(m, { text: 'atk>2500 attribute=dark sort=atk', config: testConfig, usedPrefix: '.', command: 'ygosearch' });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /HASIL PENCARIAN/);
  assert.match(messages[0], /atk=gt2500/);
  assert.match(messages[0], /Dark Magician/);
  assert.ok(calls.some((url) => /cardinfo\.php\?.*atk=gt2500/.test(url)));
});

test('plugin .ygosearch memberi petunjuk saat filter kosong', async () => {
  const messages = [];
  await searchPlugin({ reply: async (text) => messages.push(text) }, { text: '', config: testConfig, usedPrefix: '.', command: 'ygosearch' });
  assert.match(messages[0], /PENCARIAN KARTU/);
});

test('plugin .banlist mengelompokkan status', async () => {
  const messages = [];
  await banlistPlugin({ chat: 'x', reply: async (text) => messages.push(text) }, { text: 'tcg', config: testConfig, usedPrefix: '.', command: 'banlist' });

  const body = messages.join('\n');
  assert.match(body, /BANLIST TCG/);
  assert.match(body, /Forbidden \(1\)/);
  assert.match(body, /Limited \(1\)/);
  assert.match(body, /Semi-Limited \(1\)/);
  // urutan grup: Forbidden dulu, lalu Limited, lalu Semi-Limited
  assert.ok(body.indexOf('Forbidden (1)') < body.indexOf('Limited (1)'));
  assert.ok(body.indexOf('Limited (1)') < body.indexOf('Semi-Limited (1)'));
});
