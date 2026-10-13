/**
 * Format respons Jikan API menjadi pesan WhatsApp yang natural.
 */

const fmt = (n) => Number(n || 0).toLocaleString('id-ID');

const truncate = (text, max = 120) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
};

const joinList = (items, max = 5) => {
  if (!items?.length) return '-';
  const shown = items.slice(0, max).map((i) => i.name || i.title || i).join(', ');
  return items.length > max ? `${shown}, … (+${items.length - max} lainnya)` : shown;
};

const score = (value) => (value ? `*${value}*` : '-');

// ── Anime ────────────────────────────────────────────────────────────────────

export function animeSearch(data) {
  const list = data?.data || [];
  if (!list.length) return 'Gak ketemu anime yang cocok. Coba kata kunci lain.';
  const lines = [`🎬 *Hasil Pencarian Anime* (${list.length} ditemukan)`, ''];
  list.forEach((a, i) => {
    lines.push(
      `${i + 1}. *${a.title}*${a.title_english ? ` (${a.title_english})` : ''}`,
      `   📺 ${a.type || '-'} • ${a.episodes ? `${a.episodes} eps` : '?'} • ⭐ ${score(a.score)}`,
      `   📅 ${a.aired?.string || '-'} • 🆔 ${a.mal_id}`,
      a.synopsis ? `   _${truncate(a.synopsis, 100)}_` : '',
    );
  });
  lines.push('', 'Detail: `.animeinfo <nomor>` atau `.animeinfo <mal_id>`');
  return lines.filter(Boolean).join('\n');
}

export function animeDetail(a) {
  if (!a) return 'Anime tidak ditemukan.';
  const lines = [
    `🎬 *${a.title}*${a.title_english ? ` (${a.title_english})` : ''}`,
    a.title_japanese ? `   _${a.title_japanese}_` : '',
    '',
    a.synopsis ? `_${truncate(a.synopsis, 300)}_` : '',
    '',
    `⭐ Skor: ${score(a.score)} ${a.scored_by ? `(${fmt(a.scored_by)} votes)` : ''}`,
    `📺 Tipe: ${a.type || '-'} • ${a.episodes ? `${a.episodes} episode` : '?'}`,
    `📅 Tayang: ${a.aired?.string || '-'}`,
    `📊 Status: ${a.status || '-'}`,
    `🏢 Studio: ${joinList(a.studios, 3)}`,
    `🏷️ Genre: ${joinList(a.genres, 6)}`,
    a.duration ? `⏱️ Durasi: ${a.duration}` : '',
    `👥 Popularitas: #${a.popularity || '-'} • ❤️ ${fmt(a.favorites)} favorit`,
    `🔗 ${a.url || ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function animeEpisodes(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada data episode.';
  const lines = [`📺 *Daftar Episode* (${list.length} ditemukan)`, ''];
  list.slice(0, 15).forEach((ep) => {
    lines.push(`${ep.mal_id}. ${ep.title || 'Episode ' + ep.mal_id}${ep.title_japanese ? ` _${ep.title_japanese}_` : ''}`);
    if (ep.aired) lines.push(`   📅 ${new Date(ep.aired).toLocaleDateString('id-ID')}`);
  });
  if (data?.pagination?.has_next_page) lines.push('', 'Halaman berikutnya: `.eps <id> 2`');
  return lines.join('\n');
}

export function animeThemes(t) {
  const openings = t?.openings || [];
  const endings = t?.endings || [];
  if (!openings.length && !endings.length) return 'Belum ada data tema.';
  const lines = ['🎵 *Tema Lagu*', ''];
  if (openings.length) {
    lines.push('*Opening:*');
    openings.slice(0, 5).forEach((o) => lines.push(`  • ${o}`));
  }
  if (endings.length) {
    lines.push('*Ending:*');
    endings.slice(0, 5).forEach((e) => lines.push(`  • ${e}`));
  }
  return lines.join('\n');
}

export function animeStreaming(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada tautan streaming legal.';
  const lines = ['📺 *Streaming Legal*', ''];
  list.forEach((s) => lines.push(`• ${s.name}: ${s.url}`));
  return lines.join('\n');
}

export function animeRecommendations(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada rekomendasi.';
  const lines = ['💡 *Rekomendasi Anime*', ''];
  list.slice(0, 8).forEach((r) => {
    const a = r.entry || r;
    lines.push(`• *${a.title}* — ${r.content ? truncate(r.content, 60) : '⭐ ' + (a.score || '-')}`);
  });
  return lines.join('\n');
}

export function animeReviews(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada review.';
  const lines = ['📝 *Review Anime*', ''];
  list.slice(0, 5).forEach((r) => {
    lines.push(`• *${r.user?.username || 'Anonim'}* — ${r.reaction?.overall || '?'}/10`);
    if (r.recommendation) lines.push(`  _${truncate(r.recommendation, 100)}_`);
  });
  return lines.join('\n');
}

export function animeCharacters(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada data karakter.';
  const lines = ['👥 *Karakter*', ''];
  list.slice(0, 10).forEach((c) => {
    lines.push(`• *${c.character?.name}* (${c.role || '-'})`);
  });
  return lines.join('\n');
}

export function animeStaff(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada data staff.';
  const lines = ['🎬 *Staff*', ''];
  list.slice(0, 10).forEach((s) => {
    lines.push(`• *${s.person?.name}* — ${s.roles?.map((r) => r.name).join(', ') || '-'}`);
  });
  return lines.join('\n');
}

export function animeRelations(data) {
  const list = data?.data || [];
  if (!list.length) return 'Tidak ada relasi.';
  const lines = ['🔗 *Relasi*', ''];
  list.forEach((r) => {
    const entries = r.entry || [];
    const names = entries.map((e) => e.name).join(', ');
    lines.push(`• *${r.relation}*: ${names}`);
  });
  return lines.join('\n');
}

export function animePictures(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada gambar.';
  return `🖼️ *${list.length} gambar tersedia* — pilih salah satu untuk dikirim.`;
}

// ── Manga ────────────────────────────────────────────────────────────────────

export function mangaSearch(data) {
  const list = data?.data || [];
  if (!list.length) return 'Gak ketemu manga yang cocok. Coba kata kunci lain.';
  const lines = [`📚 *Hasil Pencarian Manga* (${list.length} ditemukan)`, ''];
  list.forEach((m, i) => {
    lines.push(
      `${i + 1}. *${m.title}*${m.title_english ? ` (${m.title_english})` : ''}`,
      `   📖 ${m.type || '-'} • ${m.chapters ? `${m.chapters} ch` : '?'} • ⭐ ${score(m.score)}`,
      `   📅 ${m.published?.string || '-'} • 🆔 ${m.mal_id}`,
    );
  });
  lines.push('', 'Detail: `.mangainfo <nomor>` atau `.mangainfo <mal_id>`');
  return lines.join('\n');
}

export function mangaDetail(m) {
  if (!m) return 'Manga tidak ditemukan.';
  const lines = [
    `📚 *${m.title}*${m.title_english ? ` (${m.title_english})` : ''}`,
    m.title_japanese ? `   _${m.title_japanese}_` : '',
    '',
    m.synopsis ? `_${truncate(m.synopsis, 300)}_` : '',
    '',
    `⭐ Skor: ${score(m.score)} ${m.scored_by ? `(${fmt(m.scored_by)} votes)` : ''}`,
    `📖 Tipe: ${m.type || '-'} • ${m.chapters ? `${m.chapters} chapter` : '?'}`,
    `📅 Terbit: ${m.published?.string || '-'}`,
    `📊 Status: ${m.status || '-'}`,
    `🏢 Serialisasi: ${joinList(m.serializations, 3)}`,
    `🏷️ Genre: ${joinList(m.genres, 6)}`,
    `👥 Popularitas: #${m.popularity || '-'} • ❤️ ${fmt(m.favorites)} favorit`,
    `🔗 ${m.url || ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function mangaCharacters(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada data karakter.';
  const lines = ['👥 *Karakter*', ''];
  list.slice(0, 10).forEach((c) => {
    lines.push(`• *${c.character?.name}* (${c.role || '-'})`);
  });
  return lines.join('\n');
}

// ── Character & People ───────────────────────────────────────────────────────

export function characterSearch(data) {
  const list = data?.data || [];
  if (!list.length) return 'Gak ketemu karakter. Coba kata kunci lain.';
  const lines = [`👥 *Hasil Pencarian Karakter* (${list.length} ditemukan)`, ''];
  list.forEach((c, i) => {
    lines.push(`${i + 1}. *${c.name}*${c.name_kanji ? ` (${c.name_kanji})` : ''} — ❤️ ${fmt(c.favorites)}`);
  });
  lines.push('', 'Detail: `.charinfo <nomor>` atau `.charinfo <mal_id>`');
  return lines.join('\n');
}

export function characterDetail(c) {
  if (!c) return 'Karakter tidak ditemukan.';
  const lines = [
    `👥 *${c.name}*${c.name_kanji ? ` (${c.name_kanji})` : ''}`,
    '',
    c.about ? `_${truncate(c.about, 300)}_` : '',
    '',
    `❤️ Favorit: ${fmt(c.favorites)}`,
    `🔗 ${c.url || ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function characterAnime(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada anime.';
  const lines = ['🎬 *Anime yang diikuti:*', ''];
  list.slice(0, 10).forEach((ca) => {
    lines.push(`• *${ca.anime?.title}* (${ca.role || '-'})`);
  });
  return lines.join('\n');
}

export function characterVoices(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada VA.';
  const lines = ['🎙️ *Voice Actor:*', ''];
  list.slice(0, 10).forEach((v) => {
    lines.push(`• *${v.person?.name}* (${v.language || '-'})`);
  });
  return lines.join('\n');
}

export function personSearch(data) {
  const list = data?.data || [];
  if (!list.length) return 'Gak ketemu orang. Coba kata kunci lain.';
  const lines = [`🎙️ *Hasil Pencarian Orang* (${list.length} ditemukan)`, ''];
  list.forEach((p, i) => {
    lines.push(`${i + 1}. *${p.name}* — ❤️ ${fmt(p.favorites)}`);
  });
  lines.push('', 'Detail: `.vainfo <nomor>` atau `.vainfo <mal_id>`');
  return lines.join('\n');
}

export function personDetail(p) {
  if (!p) return 'Orang tidak ditemukan.';
  const lines = [
    `🎙️ *${p.name}*${p.alternative_names?.length ? ` (${p.alternative_names.join(', ')})` : ''}`,
    '',
    p.about ? `_${truncate(p.about, 300)}_` : '',
    '',
    `❤️ Favorit: ${fmt(p.favorites)}`,
    `🔗 ${p.url || ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}

// ── Seasonal & Schedule ──────────────────────────────────────────────────────

export function seasonal(data) {
  const list = data?.data || [];
  if (!list.length) return 'Tidak ada data seasonal.';
  const lines = [`📅 *Anime Musim Ini* (${list.length} anime)`, ''];
  list.slice(0, 15).forEach((a, i) => {
    lines.push(
      `${i + 1}. *${a.title}*`,
      `   📺 ${a.type || '-'} • ${a.episodes ? `${a.episodes} eps` : '?'} • ⭐ ${score(a.score)}`,
      a.synopsis ? `   _${truncate(a.synopsis, 80)}_` : '',
    );
  });
  return lines.filter(Boolean).join('\n');
}

export function schedule(data) {
  const list = data?.data || [];
  if (!list.length) return 'Tidak ada jadwal.';
  const lines = ['📅 *Jadwal Anime Mingguan*', ''];
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  days.forEach((day, i) => {
    const items = list.filter((a) => a.day === day);
    if (items.length) {
      lines.push(`*${dayNames[i]}* (${items.length} anime):`);
      items.slice(0, 5).forEach((a) => lines.push(`  • ${a.title}`));
      lines.push('');
    }
  });
  return lines.join('\n');
}

// ── Top ──────────────────────────────────────────────────────────────────────

export function topAnime(data) {
  const list = data?.data || [];
  if (!list.length) return 'Tidak ada data top anime.';
  const lines = ['🏆 *Top Anime*', ''];
  list.slice(0, 15).forEach((a, i) => {
    lines.push(
      `${i + 1}. *${a.title}* — ⭐ ${score(a.score)}`,
      `   📺 ${a.type || '-'} • ${a.episodes ? `${a.episodes} eps` : '?'} • 📅 ${a.aired?.string || '-'}`,
    );
  });
  return lines.join('\n');
}

export function topManga(data) {
  const list = data?.data || [];
  if (!list.length) return 'Tidak ada data top manga.';
  const lines = ['🏆 *Top Manga*', ''];
  list.slice(0, 15).forEach((m, i) => {
    lines.push(
      `${i + 1}. *${m.title}* — ⭐ ${score(m.score)}`,
      `   📖 ${m.type || '-'} • ${m.chapters ? `${m.chapters} ch` : '?'} • 📅 ${m.published?.string || '-'}`,
    );
  });
  return lines.join('\n');
}

export function topCharacters(data) {
  const list = data?.data || [];
  if (!list.length) return 'Tidak ada data top karakter.';
  const lines = ['🏆 *Top Karakter*', ''];
  list.slice(0, 15).forEach((c, i) => {
    lines.push(`${i + 1}. *${c.name}* — ❤️ ${fmt(c.favorites)}`);
  });
  return lines.join('\n');
}

export function topPeople(data) {
  const list = data?.data || [];
  if (!list.length) return 'Tidak ada data top orang.';
  const lines = ['🏆 *Top Orang*', ''];
  list.slice(0, 15).forEach((p, i) => {
    lines.push(`${i + 1}. *${p.name}* — ❤️ ${fmt(p.favorites)}`);
  });
  return lines.join('\n');
}

// ── User ─────────────────────────────────────────────────────────────────────

export function userProfile(u) {
  if (!u) return 'User tidak ditemukan.';
  const lines = [
    `👤 *${u.username}*`,
    '',
    u.about ? `_${truncate(u.about, 300)}_` : '',
    '',
    `📊 Statistik: ${u.statistics?.anime?.days_watched ? `${u.statistics.anime.days_watched} hari nonton` : '-'}`,
    `   ${u.statistics?.manga?.days_read ? `${u.statistics.manga.days_read} hari baca` : ''}`,
    `❤️ Favorit: ${u.favorites?.anime?.length || 0} anime, ${u.favorites?.manga?.length || 0} manga`,
    `🔗 ${u.url || ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function userAnimeList(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada anime di list.';
  const lines = [`📺 *Anime List* (${list.length} anime)`, ''];
  list.slice(0, 15).forEach((item) => {
    const a = item.node || item;
    const status = item.list_status?.status || item.status || '-';
    const score = item.list_status?.score || item.score || 0;
    lines.push(`• *${a.title}* — ${status}${score ? ` ⭐${score}` : ''}`);
  });
  return lines.join('\n');
}

export function userMangaList(data) {
  const list = data?.data || [];
  if (!list.length) return 'Belum ada manga di list.';
  const lines = [`📚 *Manga List* (${list.length} manga)`, ''];
  list.slice(0, 15).forEach((item) => {
    const m = item.node || item;
    const status = item.list_status?.status || item.status || '-';
    const score = item.list_status?.score || item.score || 0;
    lines.push(`• *${m.title}* — ${status}${score ? ` ⭐${score}` : ''}`);
  });
  return lines.join('\n');
}

export function userFavorites(f) {
  const anime = f?.anime || [];
  const manga = f?.manga || [];
  const chars = f?.characters || [];
  const people = f?.people || [];
  const lines = ['❤️ *Favorit*', ''];
  if (anime.length) {
    lines.push(`*Anime* (${anime.length}):`);
    anime.slice(0, 5).forEach((a) => lines.push(`  • ${a.title}`));
  }
  if (manga.length) {
    lines.push(`*Manga* (${manga.length}):`);
    manga.slice(0, 5).forEach((m) => lines.push(`  • ${m.title}`));
  }
  if (chars.length) {
    lines.push(`*Karakter* (${chars.length}):`);
    chars.slice(0, 5).forEach((c) => lines.push(`  • ${c.name}`));
  }
  if (people.length) {
    lines.push(`*Orang* (${people.length}):`);
    people.slice(0, 5).forEach((p) => lines.push(`  • ${p.name}`));
  }
  return lines.join('\n');
}

export function userStatistics(s) {
  const anime = s?.anime || {};
  const manga = s?.manga || {};
  const lines = [
    '📊 *Statistik*',
    '',
    `*Anime:*`,
    `  📺 Total: ${anime.total_entries || 0}`,
    `  ⏱️ Hari nonton: ${anime.days_watched || 0}`,
    `  ⭐ Skor rata-rata: ${anime.mean_score || 0}`,
    `  📊 Status: ${anime.watching || 0} watching, ${anime.completed || 0} completed, ${anime.on_hold || 0} on hold, ${anime.dropped || 0} dropped, ${anime.plan_to_watch || 0} plan to watch`,
    '',
    `*Manga:*`,
    `  📚 Total: ${manga.total_entries || 0}`,
    `  ⏱️ Hari baca: ${manga.days_read || 0}`,
    `  ⭐ Skor rata-rata: ${manga.mean_score || 0}`,
    `  📊 Status: ${manga.reading || 0} reading, ${manga.completed || 0} completed, ${manga.on_hold || 0} on hold, ${manga.dropped || 0} dropped, ${manga.plan_to_read || 0} plan to read`,
  ];
  return lines.join('\n');
}

// ── Random ───────────────────────────────────────────────────────────────────

export function randomAnime(data) {
  const a = data?.data;
  if (!a) return 'Gagal ambil random anime.';
  return animeDetail(a);
}

export function randomManga(data) {
  const m = data?.data;
  if (!m) return 'Gagal ambil random manga.';
  return mangaDetail(m);
}

export function randomCharacter(data) {
  const c = data?.data;
  if (!c) return 'Gagal ambil random karakter.';
  return characterDetail(c);
}

// ── Error ────────────────────────────────────────────────────────────────────

export function errorMessage(err) {
  const msg = String(err?.message || err);
  if (msg.startsWith('RATE_LIMIT:')) {
    const secs = msg.split(':')[1] || '60';
    return `⏳ Rate limit Jikan. Coba lagi dalam *${secs} detik*.`;
  }
  if (msg.includes('HTTP 404')) return 'Data tidak ditemukan di MyAnimeList.';
  if (msg.includes('HTTP 429')) return '⏳ Terlalu banyak request. Coba lagi sebentar.';
  if (msg.includes('HTTP 5')) return '☁️ Server Jikan sedang down. Coba lagi nanti.';
  if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) return '📡 Gagal terhubung ke Jikan. Cek koneksi.';
  return `⚠️ ${msg.slice(0, 100)}`;
}

export default {
  animeSearch, animeDetail, animeEpisodes, animeThemes, animeStreaming,
  animeRecommendations, animeReviews, animeCharacters, animeStaff,
  animeRelations, animePictures,
  mangaSearch, mangaDetail, mangaCharacters,
  characterSearch, characterDetail, characterAnime, characterVoices,
  personSearch, personDetail,
  seasonal, schedule, topAnime, topManga, topCharacters, topPeople,
  userProfile, userAnimeList, userMangaList, userFavorites, userStatistics,
  randomAnime, randomManga, randomCharacter,
  errorMessage,
};