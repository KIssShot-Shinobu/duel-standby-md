// Cek manual integrasi Yu-Gi-Oh! API (YGOPRODeck v7) — butuh internet.
//   node scripts/ygoprodeck-check.mjs
import { createClient, formatCardCaption } from '../lib/ygoprodeck.js';

const client = createClient({ cacheFile: '' });
const show = (label, value) => console.log(`${label.padEnd(22)}:`, value);

try {
  const version = await client.dbVersion();
  show('versi database', JSON.stringify(version));
} catch (err) {
  show('versi database', `GAGAL -> ${err.message}`);
}

try {
  const card = (await client.cardByName('Dark Magician')).data[0];
  show('cardinfo (nama)', `${card.name} | ATK ${card.atk} / DEF ${card.def} | ${card.type}`);
  show('caption contoh', formatCardCaption(card).split('\n').slice(0, 4).join(' / '));
} catch (err) {
  show('cardinfo (nama)', `GAGAL -> ${err.message}`);
}

try {
  const fuzzy = await client.fuzzyCards('Magician', { num: 3, sort: 'name' });
  show('fuzzy "Magician"', fuzzy.data.map((card) => card.name).join(', '));
} catch (err) {
  show('fuzzy', `GAGAL -> ${err.message}`);
}

try {
  const advanced = await client.card({ attribute: 'dark', level: '4', sort: 'atk', num: 3 });
  show('filter (dark lv4)', advanced.data.map((card) => `${card.name} (${card.atk})`).join(', '));
} catch (err) {
  show('filter', `GAGAL -> ${err.message}`);
}

try {
  const random = (await client.random()).data[0];
  show('kartu acak', random.name);
} catch (err) {
  show('kartu acak', `GAGAL -> ${err.message}`);
}

try {
  const archetypes = await client.archetypes();
  show('jumlah archetype', archetypes.length);
} catch (err) {
  show('archetype', `GAGAL -> ${err.message}`);
}

try {
  const sets = await client.sets();
  show('jumlah card set', Array.isArray(sets) ? sets.length : 'n/a');
} catch (err) {
  show('card set', `GAGAL -> ${err.message}`);
}

try {
  const info = await client.setInfo('SDY-046');
  show('cardsetsinfo', `${info.name} | ${info.set_name} | ${info.set_rarity}`);
} catch (err) {
  show('cardsetsinfo', `GAGAL -> ${err.message}`);
}

try {
  const banlist = await client.card({ banlist: 'tcg', num: '500', sort: 'name' });
  const dist = banlist.data.reduce((acc, card) => {
    const status = card.banlist_info?.ban_tcg || 'tanpa status';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  show('banlist TCG', `${banlist.data.length} kartu -> ${JSON.stringify(dist)}`);
} catch (err) {
  show('banlist TCG', `GAGAL -> ${err.message}`);
}

try {
  const card = (await client.cardByName('Dark Magician')).data[0];
  const response = await fetch(card.card_images[0].image_url, { signal: AbortSignal.timeout(30000) });
  const buffer = Buffer.from(await response.arrayBuffer());
  show('unduh gambar', `${buffer.length} bytes (${response.status})`);
} catch (err) {
  show('unduh gambar', `GAGAL -> ${err.message}`);
}
