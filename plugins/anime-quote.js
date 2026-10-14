/**
 * Kutipan anime dari Animechan API (https://api.animechan.io/v1).
 *   .animequote
 *   .animequote anime <nama>
 *   .animequote char <nama>
 */
const BASE = 'https://api.animechan.io/v1';

async function fetchQuote({ anime, character } = {}) {
  let path = '/quotes/random';
  const params = new URLSearchParams();
  if (anime) params.set('anime', anime);
  if (character) params.set('character', character);
  const qs = params.toString();
  if (qs) path += `?${qs}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.status && json.status !== 'success') throw new Error(json?.message || 'API error');
    return json?.data;
  } finally {
    clearTimeout(timer);
  }
}

const handler = async (m, ctx) => {
  const args = ctx?.args || [];
  let anime, character;
  if (args[0]?.toLowerCase() === 'anime' && args.slice(1).join(' ').trim()) {
    anime = args.slice(1).join(' ').trim();
  } else if ((args[0]?.toLowerCase() === 'char' || args[0]?.toLowerCase() === 'character') && args.slice(1).join(' ').trim()) {
    character = args.slice(1).join(' ').trim();
  } else if (args.length) {
    // Default: anggap nama anime
    anime = args.join(' ').trim();
  }

  await m.react('⏳').catch(() => {});

  let data;
  try {
    data = await fetchQuote({ anime, character });
  } catch (err) {
    throw new Error(`Gagal mengambil kutipan anime: ${err?.message || err}`);
  }
  if (!data?.content) throw new Error('Kutipan tidak ditemukan.');

  const quote = data.content;
  const charName = data.character?.name || 'Unknown';
  const animeName = data.anime?.name || (anime || character || 'Unknown');
  return m.reply(`💬 _"${quote}"_\n\n— *${charName}*, ${animeName}`);
};

handler.help = ['animequote', 'aquote', 'quoteanime'];
handler.tags = ['fun'];
handler.command = /^(animequote|aquote|quoteanime|kutipanime)$/i;
handler.limit = 1;

export default handler;