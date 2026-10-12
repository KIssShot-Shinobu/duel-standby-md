/**
 * Sumber media untuk plugin (dipakai .sticker dan .smeme).
 * Urutan prioritas: tautan di argumen/teks > pesan yang di-reply > pesan itu sendiri.
 */
import { fetchBuffer, isUrl } from './functions.js';

/**
 * @param {any} m objek pesan (hasil smsg)
 * @param {{args?: string[], text?: string}} options
 * @returns {{kind: 'url'|'quoted'|'self', node?: any, url?: string, label: string}|null}
 */
export function pickMediaSource(m, { args = [], text = '' } = {}) {
  const urlArg = [...(args || []), String(text || '')]
    .map((value) => String(value).trim())
    .find((value) => isUrl(value));
  if (urlArg) return { kind: 'url', url: urlArg, label: urlArg };

  if (m?.quoted?.msg?.mimetype) return { kind: 'quoted', node: m.quoted, label: 'media yang di-reply' };
  if (m?.msg?.mimetype) return { kind: 'self', node: m, label: 'media yang dikirim' };
  // dokumen/pesan lama: tetap coba selama ada isi media
  if (m?.quoted?.msg) return { kind: 'quoted', node: m.quoted, label: 'media yang di-reply' };
  return null;
}

/** Ambil isi berkas dari sumber media. */
export async function loadMedia(source, { timeout = 30000 } = {}) {
  if (!source) throw new Error('Tidak ada sumber media.');
  if (source.kind === 'url') return fetchBuffer(source.url, { timeout });
  return source.node.download();
}

/** Ambil mimetype yang tercatat pada pesan (bisa kosong/keliru — verifikasi isi berkas bila perlu). */
export function mediaMime(source) {
  if (!source || source.kind === 'url') return '';
  return source.node?.msg?.mimetype || '';
}

export default { pickMediaSource, loadMedia, mediaMime };
