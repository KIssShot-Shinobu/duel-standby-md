/**
 * Cek runtime fitur gambar: `.sfw` selalu, `.nsfw` kalau diminta.
 *
 *   node scripts/image-check.mjs            # hanya SFW
 *   node scripts/image-check.mjs --nsfw     # SFW + NSFW (18+)
 *   node scripts/image-check.mjs --query hug
 *
 * Skrip ini memakai config asli (termasuk urutan provider & filter tag),
 * mengunduh satu gambar dari tiap mode ke MEMORI lalu menghapusnya —
 * berguna untuk memastikan pipeline (API -> unduh -> buffer) jalan di server.
 */
import config from '../config.js';
import print from '../lib/print.js';
import { clearListCache, downloadImage, fetchImage } from '../lib/image-source.js';

const args = process.argv.slice(2);
const queryIndex = args.findIndex((value) => value === '--query' || value === '-q');
const query = queryIndex >= 0 ? String(args[queryIndex + 1] || '') : '';
const modes = args.includes('--nsfw') ? ['sfw', 'nsfw'] : ['sfw'];

/** Tebak format berkas dari magic bytes (tanpa menampilkan gambarnya). */
function sniff(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (/^GIF8/.test(buffer.subarray(0, 6).toString('ascii'))) return 'gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return 'format tidak dikenal';
}

print.info(`Cek pipeline gambar (${modes.join(' + ')})${query ? ` • tag "${query}"` : ''}`);
console.log('');

let failed = 0;
for (const mode of modes) {
  const providers = config.images?.providers?.[mode] || [];
  print.kv(`${mode.toUpperCase()} provider`, providers.join(' → '));
  clearListCache();
  const started = Date.now();
  try {
    const item = await fetchImage({ mode, query, config });
    const buffer = await downloadImage(item, { config });
    const size = Math.round(buffer.length / 1024);
    print.kv(
      `${mode.toUpperCase()} hasil`,
      `${item.label} • ${item.rating} • ${sniff(buffer)} • ${size} KB • ${Date.now() - started} ms`,
      { tag: 'success' },
    );
    if (item.artist) print.kv('Artist', item.artist);
    if (item.page) print.kv('Sumber', item.page);
    if (!/jpeg|png|gif|webp/.test(sniff(buffer))) failed += 1;
  } catch (err) {
    failed += 1;
    print.kv(`${mode.toUpperCase()} gagal`, err.message, { tag: 'error' });
  }
  console.log('');
}

print.kv('Kesimpulan', failed ? `${failed} mode gagal` : 'semua mode jalan', { tag: failed ? 'error' : 'success' });
process.exit(failed ? 1 : 0);
