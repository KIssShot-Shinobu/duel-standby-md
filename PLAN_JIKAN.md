# Jikan API v4 Integration - Implementation Plan

## Overview
Implement complete Jikan API v4 integration for WhatsApp bot with all endpoints mapped to user-friendly commands.

## Phase 1: Core Infrastructure
- [ ] Create `lib/jikan.js` - HTTP client with rate limiting, caching, error handling
- [ ] Add Jikan config to `config.js` (base URL, timeout, rate limit handling)
- [ ] Create response formatters in `lib/jikan-format.js` - natural Indonesian messages

## Phase 2: Anime Commands (Plugin: `jikan-anime.js`)
- [ ] `.anime <query>` - Search anime
- [ ] `.animeinfo <id>` - Full anime detail (from `/anime/{id}/full`)
- [ ] `.eps <id> [page]` - Episode list
- [ ] `.themes <id>` - OP/ED with artists
- [ ] `.streaming <id>` - Legal streaming platforms
- [ ] `.recs <id>` - Recommendations
- [ ] `.reviews <id>` - Reviews
- [ ] `.chars <id>` - Characters + VAs
- [ ] `.staff <id>` - Production staff
- [ ] `.relations <id>` - Sequels/prequels/spin-offs
- [ ] `.pics <id>` - Posters/backgrounds

## Phase 3: Manga Commands (Plugin: `jikan-manga.js`)
- [ ] `.manga <query>` - Search manga
- [ ] `.mangainfo <id>` - Full manga detail
- [ ] `.mangachars <id>` - Characters
- [ ] `.mangarecs <id>` - Recommendations
- [ ] `.mangareviews <id>` - Reviews

## Phase 4: Character & People Commands (Plugin: `jikan-char.js`)
- [ ] `.char <query>` - Search character
- [ ] `.charinfo <id>` - Character detail + anime/manga/voices
- [ ] `.va <query>` - Search voice actor
- [ ] `.vainfo <id>` - VA detail + roles

## Phase 5: Discovery & Seasonal (Plugin: `jikan-discover.js`)
- [ ] `.seasonal now` - Currently airing
- [ ] `.seasonal upcoming` - Upcoming season
- [ ] `.seasonal <year> <season>` - Historical (winter/spring/summer/fall)
- [ ] `.jadwal` - Weekly schedule (Mon-Sun)
- [ ] `.top anime [filter]` - Top anime (airing, upcoming, tv, movie, ova, bypopularity, byfavorites)
- [ ] `.top manga [filter]` - Top manga (manga, novels, manhwa, manhua, bypopularity, byfavorites)
- [ ] `.top chars` - Top characters
- [ ] `.top people` - Top people
- [ ] `.random anime` - Random anime
- [ ] `.random manga` - Random manga
- [ ] `.random char` - Random character

## Phase 6: User Features (Plugin: `jikan-user.js`)
- [ ] `.maluser <username>` - Profile
- [ ] `.animelist <user> [status]` - Anime list (watching/completed/onhold/dropped/plantowatch)
- [ ] `.mangalist <user> [status]` - Manga list
- [ ] `.malfav <user>` - Favorites (anime/manga/characters/people)
- [ ] `.malstats <user>` - Statistics (days watched, mean score, etc.)

## Phase 7: Search Commands (Plugin: `jikan-search.js`)
- [ ] `.searchanime <query>` - Advanced search (genre, status, rating, type, year, season)
- [ ] `.searchmanga <query>` - Advanced manga search
- [ ] `.searchchar <query>` - Character search
- [ ] `.searchpeople <query>` - People search
- [ ] `.searchuser <query>` - User search

## Technical Details

### Rate Limiting
- Jikan: 60 req/min, 3 req/sec
- Implement local rate limiter with queue
- Respect `Retry-After` headers
- Cache responses 24h (Jikan already caches, but local cache prevents duplicate requests)

### Error Handling
- Friendly Indonesian messages for all error codes
- No raw JSON errors to users
- Fallback messages when API unavailable

### Response Format
- Natural Indonesian language
- WhatsApp formatting (*bold*, _italic_)
- Proper emoji usage
- Mention users where appropriate

### Commands Summary (≈45 commands)
| Category | Commands |
|---|---|
| Anime | anime, animeinfo, eps, themes, streaming, recs, reviews, chars, staff, relations, pics |
| Manga | manga, mangainfo, mangachars, mangarecs, mangareviews |
| Character/VA | char, charinfo, va, vainfo |
| Discovery | seasonal, jadwal, top, random |
| User | maluser, animelist, mangalist, malfav, malstats |
| Search | searchanime, searchmanga, searchchar, searchpeople, searchuser |

Total: ~45 commands across 6 plugins