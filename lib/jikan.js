/**
 * Jikan API v4 Client
 *
 * Rate limits: 60 req/min, 3 req/sec
 * Cache: 24h on Jikan side, we add local in-memory cache
 * No API key required
 */
import crypto from 'node:crypto';

/**
 * Base URL Jikan API v4. Bisa di-override lewat env `JIKAN_BASE` (mis. proxy
 * sendiri/herokuapp) kalau ISP atau jaringan panel memblokir api.jikan.moe.
 */
const BASE_URL = (process.env.JIKAN_BASE || 'https://api.jikan.moe/v4').replace(/\/+$/, '');

// Rate limiter: 3 requests/second, 60/minute
class RateLimiter {
  constructor() {
    this.requests = [];
    this.minuteRequests = [];
    this.queue = [];
    this.processing = false;
  }

  async acquire() {
    const now = Date.now();

    // Clean old entries
    this.requests = this.requests.filter(t => now - t < 1000);
    this.minuteRequests = this.minuteRequests.filter(t => now - t < 60000);

    // Check limits
    if (this.requests.length >= 3 || this.minuteRequests.length >= 60) {
      return new Promise(resolve => {
        this.queue.push(resolve);
      });
    }

    this.requests.push(now);
    this.minuteRequests.push(now);
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      setTimeout(() => next(), 350); // ~3 req/sec
    }
  }
}

const limiter = new RateLimiter();

// Simple in-memory cache with TTL
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

function cacheKey(url, params = {}) {
  const str = url + JSON.stringify(params);
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 16);
}

async function fetchWithCache(url, options = {}) {
  const key = cacheKey(url, options);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.data;
  }

  await limiter.acquire();
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'RTXZY-Clean (WhatsApp Bot; Jikan API)',
        'Accept': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(30000),
      ...options,
    });

    limiter.release();

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || '60';
      throw new Error(`RATE_LIMIT:${retryAfter}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    limiter.release();
    throw err;
  }
}

// Helper: build query string
function buildQuery(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach(v => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

// ===== ANIME =====
export async function searchAnime(params = {}) {
  const query = buildQuery({
    q: params.q,
    type: params.type,
    status: params.status,
    rating: params.rating,
    genre: params.genre,
    sfw: params.sfw,
    order_by: params.order_by,
    sort: params.sort,
    limit: params.limit,
    page: params.page,
  });
  return fetchWithCache(`${BASE_URL}/anime${query}`);
}

export async function getAnime(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}`);
}

export async function getAnimeFull(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/full`);
}

export async function getAnimeCharacters(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/characters`);
}

export async function getAnimeStaff(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/staff`);
}

export async function getAnimeEpisodes(id, page = 1) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/episodes?page=${page}`);
}

export async function getAnimeEpisode(id, episode) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/episodes/${episode}`);
}

export async function getAnimeThemes(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/themes`);
}

export async function getAnimeStreaming(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/streaming`);
}

export async function getAnimeRecommendations(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/recommendations`);
}

export async function getAnimeReviews(id, page = 1) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/reviews?page=${page}`);
}

export async function getAnimeRelations(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/relations`);
}

export async function getAnimePictures(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/pictures`);
}

export async function getAnimeStatistics(id) {
  return fetchWithCache(`${BASE_URL}/anime/${id}/statistics`);
}

// ===== MANGA =====
export async function searchManga(params = {}) {
  const query = buildQuery({
    q: params.q,
    type: params.type,
    status: params.status,
    rating: params.rating,
    genre: params.genre,
    sfw: params.sfw,
    order_by: params.order_by,
    sort: params.sort,
    limit: params.limit,
    page: params.page,
  });
  return fetchWithCache(`${BASE_URL}/manga${query}`);
}

export async function getManga(id) {
  return fetchWithCache(`${BASE_URL}/manga/${id}`);
}

export async function getMangaFull(id) {
  return fetchWithCache(`${BASE_URL}/manga/${id}/full`);
}

export async function getMangaCharacters(id) {
  return fetchWithCache(`${BASE_URL}/manga/${id}/characters`);
}

export async function getMangaRecommendations(id) {
  return fetchWithCache(`${BASE_URL}/manga/${id}/recommendations`);
}

export async function getMangaReviews(id, page = 1) {
  return fetchWithCache(`${BASE_URL}/manga/${id}/reviews?page=${page}`);
}

// ===== CHARACTERS =====
export async function searchCharacters(params = {}) {
  const query = buildQuery({ q: params.q, limit: params.limit, page: params.page });
  return fetchWithCache(`${BASE_URL}/characters${query}`);
}

export async function getCharacter(id) {
  return fetchWithCache(`${BASE_URL}/characters/${id}`);
}

export async function getCharacterFull(id) {
  return fetchWithCache(`${BASE_URL}/characters/${id}/full`);
}

export async function getCharacterAnime(id) {
  return fetchWithCache(`${BASE_URL}/characters/${id}/anime`);
}

export async function getCharacterManga(id) {
  return fetchWithCache(`${BASE_URL}/characters/${id}/manga`);
}

export async function getCharacterVoices(id) {
  return fetchWithCache(`${BASE_URL}/characters/${id}/voices`);
}

// ===== PEOPLE =====
export async function searchPeople(params = {}) {
  const query = buildQuery({ q: params.q, limit: params.limit, page: params.page });
  return fetchWithCache(`${BASE_URL}/people${query}`);
}

export async function getPerson(id) {
  return fetchWithCache(`${BASE_URL}/people/${id}`);
}

export async function getPersonFull(id) {
  return fetchWithCache(`${BASE_URL}/people/${id}/full`);
}

export async function getPersonAnime(id) {
  return fetchWithCache(`${BASE_URL}/people/${id}/anime`);
}

export async function getPersonVoices(id) {
  return fetchWithCache(`${BASE_URL}/people/${id}/voices`);
}

// ===== SEARCH (GENERIC) =====
export async function searchUsers(params = {}) {
  const query = buildQuery({ q: params.q, limit: params.limit, page: params.page });
  return fetchWithCache(`${BASE_URL}/users${query}`);
}

// ===== SEASONAL =====
export async function getSeasonNow() {
  return fetchWithCache(`${BASE_URL}/seasons/now`);
}

export async function getSeasonUpcoming() {
  return fetchWithCache(`${BASE_URL}/seasons/upcoming`);
}

export async function getSeason(year, season) {
  return fetchWithCache(`${BASE_URL}/seasons/${year}/${season}`);
}

export async function getSchedules() {
  return fetchWithCache(`${BASE_URL}/schedules`);
}

// ===== TOP =====
export async function getTopAnime(params = {}) {
  const query = buildQuery({
    filter: params.filter,
    page: params.page,
    limit: params.limit,
  });
  return fetchWithCache(`${BASE_URL}/top/anime${query}`);
}

export async function getTopManga(params = {}) {
  const query = buildQuery({
    filter: params.filter,
    page: params.page,
    limit: params.limit,
  });
  return fetchWithCache(`${BASE_URL}/top/manga${query}`);
}

export async function getTopCharacters(page = 1) {
  return fetchWithCache(`${BASE_URL}/top/characters?page=${page}`);
}

export async function getTopPeople(page = 1) {
  return fetchWithCache(`${BASE_URL}/top/people?page=${page}`);
}

// ===== RANDOM =====
export async function getRandomAnime() {
  return fetchWithCache(`${BASE_URL}/random/anime`);
}

export async function getRandomManga() {
  return fetchWithCache(`${BASE_URL}/random/manga`);
}

export async function getRandomCharacter() {
  return fetchWithCache(`${BASE_URL}/random/characters`);
}

// ===== USER =====
export async function getUser(username) {
  return fetchWithCache(`${BASE_URL}/users/${encodeURIComponent(username)}`);
}

export async function getUserFull(username) {
  return fetchWithCache(`${BASE_URL}/users/${encodeURIComponent(username)}/full`);
}

export async function getUserAnimeList(username, params = {}) {
  const query = buildQuery({
    status: params.status,
    sort: params.sort,
    limit: params.limit,
    page: params.page,
  });
  return fetchWithCache(`${BASE_URL}/users/${encodeURIComponent(username)}/animelist${query}`);
}

export async function getUserMangaList(username, params = {}) {
  const query = buildQuery({
    status: params.status,
    sort: params.sort,
    limit: params.limit,
    page: params.page,
  });
  return fetchWithCache(`${BASE_URL}/users/${encodeURIComponent(username)}/mangalist${query}`);
}

export async function getUserFavorites(username) {
  return fetchWithCache(`${BASE_URL}/users/${encodeURIComponent(username)}/favorites`);
}

export async function getUserStatistics(username) {
  return fetchWithCache(`${BASE_URL}/users/${encodeURIComponent(username)}/statistics`);
}

// ===== UTILITIES =====
export function clearCache() {
  cache.clear();
}

export function getCacheStats() {
  return { size: cache.size, keys: [...cache.keys()] };
}