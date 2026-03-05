# Changelog

All notable changes to **StreamFusion Mail** are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) · Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.1.1] — 2026-03-05

### Fixed
- **Rama** — titolo troncato in Stremio: rimosso l'anno `(YYYY)` da `meta.name` nella riga descrizione (rimane nel meta, non nella card dello stream)
- **Rama** — flag corretto da 🇮🇹 a 🇰🇷: il contenuto è coreano con sottotitoli italiani, non italiano
- **KissKH** — stessa pulizia anno da `seriesTitle` nella descrizione stream
- Aggiunto `Sub ITA` in terza riga per entrambi i provider, al posto del solo flag

---

## [1.1.0] — 2026-03-05

### Changed
- **Stream display format** — entrambi i provider ora espongono le informazioni dello stream in un formato visivo unificato e leggibile su Stremio:
  - `name` → emoji + nome provider (es. `🚀 KissKH`, `🚀 Rama`)
  - `description` → 3 righe: `📁 Titolo serie - Episodio`, `👤 Sorgente`, `🇰🇷` / `🇮🇹`
  - Rimosso campo `title` (sostituito da `description` multi-riga)
- `src/providers/kisskh.js` — aggiunta chiamata `getMeta()` (istantanea via cache) in `getStreams()` per recuperare il titolo della serie da mostrare nella descrizione
- `src/providers/rama.js` — usato `meta.name` già disponibile in `getStreams()` per la stessa finalità
- `src/utils/cloudflare.js` — rimosso percorso FlareSolverr+proxy per il recupero del cookie `cf_clearance` (semplificazione, il path Puppeteer diretto è sufficiente); rimossa dipendenza `flareSolverrGetCookies`

---

## [1.0.3] — 2026-03-04

### Fixed
- `vercel.json` — added `api/index.js` wrapper to satisfy Vercel `builds` convention
- `vercel.json` — reverted to `builds`-only format (no `functions` block, no conflict)
- Memory limit adjusted to comply with Hobby plan (1024 MB cap)

---

## [1.0.2] — 2026-03-04

### Fixed
- `vercel.json` — removed `builds` + `functions` conflict; switched to `functions`-only format

---

## [1.0.1] — 2026-03-04

### Added
- `src/utils/browser.js` — unified Puppeteer launcher with `@sparticuz/chromium` for serverless
  (auto-detects Vercel/Lambda, custom path, or local Chrome)
- `api/index.js` — Vercel serverless entry point (thin wrapper over `server.js`)

### Changed
- `package.json` — replaced `puppeteer` with `puppeteer-core` + `@sparticuz/chromium`
- `src/utils/cloudflare.js` — uses shared `launchBrowser()` instead of inline Puppeteer launch
- `src/providers/kisskh.js` — uses shared `launchBrowser()`, removes redundant `_launchBrowser()`
- `vercel.json` — `builds` pointing to `api/index.js`, no more conflict
- `.vercelignore` — added to reduce deploy bundle size

---

## [1.0.0] — 2026-03-04

### Added
- Initial release of StreamFusion Mail
- **KissKH provider** (`kisskh_*` IDs)
  - API-based catalog and meta retrieval from `kisskh.co`
  - Puppeteer + stealth stream extraction (intercepts `.m3u8` with `v` param)
  - Italian subtitle decryption (AES-128-CBC, 3 key rotation)
  - Automatic Cloudflare bypass via `cf_clearance` cookie persistence
- **Rama Oriental Fansub provider** (`rama_*` IDs)
  - Cloudscraper-based catalog scraping from `ramaorientalfansub.live`
  - Series meta parsing (poster, description, status, episode count, year)
  - Episode stream extraction (iframe, `<video>`, direct link, regex fallback)
- **Aggregator** (`src/providers/index.js`)
  - ID-prefix based routing (zero ambiguity)
  - `Promise.allSettled` parallel execution with configurable timeouts
  - URL-level stream deduplication
  - Automatic fallback for unknown ID prefixes
- **Utilities**
  - `TTLCache` — in-memory LRU cache with configurable TTL and max size
  - `fetchWithCloudscraper` / `fetchWithAxios` — shared HTTP layer with retries
  - `getCloudflareCookie` — Puppeteer-based CF bypass with disk persistence
  - `decryptKisskhSubtitleFull` / `decryptKisskhSubtitleStatic` — subtitle decryption
  - `titleSimilarity` / `cleanTitleForSearch` / `extractBaseSlug` — title helpers
  - Structured JSON logger (production) / human-readable (development)
- **Server** (`server.js`)
  - Express + `stremio-addon-sdk` router
  - CORS headers for all Stremio clients
  - HTML landing page with direct install buttons
  - `/health` endpoint for uptime monitoring
  - Dual mode: `node server.js` (local) or `module.exports` (Vercel)
- **Deploy**
  - `vercel.json` — Vercel serverless (Node 18+)
  - `.env.example` — documented environment variables
  - `.gitignore` — excludes secrets, data, and build artifacts

---

## Unreleased

_Next planned improvements:_

- [ ] TMDB poster/backdrop enrichment for Rama series
- [ ] Episode thumbnail caching layer
- [ ] Rate-limiting middleware
- [ ] GitHub Actions workflow for semver bump + GitHub Release on push
