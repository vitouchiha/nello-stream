# Changelog

All notable changes to **StreamFusion Mail** are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) · Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.3.0] — 2026-03-05

### Added
- **Drammatica.it provider** (`drammatica_` ID prefix, `kdrama` type)
  - Catalog with Cloudflare bypass via cloudscraper
  - Multi-strategy card extraction (5 selector patterns)
  - Auto-detection of catalog path (`/drama/`, `/k-drama/`, `/serie/`, `/`)
  - WordPress search endpoint (`/?s=`) for search queries
  - Meta: poster, background, genres, cast, episode list
  - Multi-strategy episode extraction (URL pattern matching + list selectors)
  - Multi-strategy stream extraction (iframe selectors, `<video>`, data-attrs, script scan)
  - Handles DropLoad, Streamtape, SuperVideo, Vixcloud, MaxStream, direct HLS/MP4
  - Stream card: `🚀 Drammatica` · `🇰🇷 Sub ITA`
- **Guardaserie provider** (`guardaserie_` ID prefix, `kdrama` type)
  - Mirror auto-detection (guardaserie.re → .fm → .cloud → .cx)
  - Catalog path auto-detection with 4 fallback paths
  - Multi-hoster support: DropLoad, Streamtape, SuperVideo, Vixcloud, MaxStream, DoodStream
  - Per-episode multi-stream extraction (all available hosters shown as separate streams)
  - Hoster label in stream name (e.g. `🚀 Guardaserie [DropLoad]`)
  - Tab/data-attribute scan + script scan for embedded URLs
  - Stream card: `🚀 Guardaserie [Hoster]` · `🇰🇷 Sub ITA`
- Both new providers wired into `index.js` aggregator (catalog, meta, stream, IMDB lookup)
- `manifest.json`: 4 catalogs total (`kisskh_catalog`, `rama_catalog`, `drammatica_catalog`, `guardaserie_catalog`)
- `idPrefixes` extended to `["kisskh_", "rama_", "drammatica_", "guardaserie_"]`

### Note
- **Viki (viki.com)** NOT implemented — Widevine DRM (L1/L3) + Rakuten subscription required; stream extraction technically/legally not feasible

---

## [1.2.0] — 2026-03-05

### Added
- **Config encryption (AES-256-GCM)** — `src/utils/config.js` ora cifra il config con AES-256-GCM invece di base64url; proxy URL, MFP key e altri segreti non sono più leggibili in chiaro dalla URL. Imposta `CONFIG_SECRET` env var per personalizzare la chiave. Retrocompatibile con URL base64url esistenti.
- **Timeout middleware globale** — `server.js` ora risponde `504 Gateway Timeout` dopo 50s invece di far morire la funzione Vercel senza risposta. Configurabile via `SERVERLESS_TIMEOUT` env var.
- **Auth debug endpoints** — `/debug/providers`, `/debug/flaresolverr`, `/debug/browser` ora richiedono `?token=` o header `Authorization: Bearer ...` se `DEBUG_TOKEN` env var è impostato (aperto solo in dev).

### Changed
- **Performance: Rama stream fetch parallelo** — `getStreams()` ora fetcha tutti gli URL degli episodi in parallelo con `Promise.all` invece di sequenzialmente. Per serie multi-episodio: ~3x più veloce (15s → 5s per 3 ep).
- **Performance: KissKH catalog search a batch** — `_searchCatalog()` ora fetcha le pagine in batch paralleli da 3 invece di una a volta. Riduce drasticamente il tempo di ricerca.
- **Stream URL validation** — entrambi i provider ora verificano che l'URL inizi con `http` prima di restituirlo; stream malformati vengono scartati con log di warning.
- **Logging stream extraction** — Rama ora logga per ogni episodio se lo stream non viene trovato e perché.

### Fixed
- **Cache LRU off-by-one** — `cache.js`: cambio `>=` → `>` nella condizione di eviction; la cache non supera più di 1 unità il `maxSize`.
- **Season matching** — `index.js _matchEpisode()`: la condizione `if (seasonNum)` era falsy per season=0; sostituita con `if (seasonNum !== null && seasonNum !== undefined)`.
- **Dead code rimosso** — `kisskh.js`: eliminata `_getSubtitles()` (backward-compat wrapper inutilizzato che poteva lanciare browser superflui).

---

## [1.1.3] — 2026-03-05

### Fixed
- **KissKH — Cast**: aggiunta chiamata parallela a `GET /api/DramaList/Cast/{id}` in `getMeta()` per ottenere il cast completo con nome e nome del personaggio (`Nome (Personaggio)`); fallback su `data.artists` se l'endpoint non risponde
- **KissKH — Episode overview**: mappato il campo `overview` su ogni video da `ep.description`, `ep.overview` o `ep.synopsis` (se presenti nella risposta API)
- **Rama — Cast**: rimpiazzato il singolo selettore CSS con 3 strategie progressive:
  1. Link con `href` contenente `/attori/`, `/actor/`, `/cast/`
  2. Parsing testuale di `li.list-none` cercando etichette "Attori:", "Cast:", "Interpreti:" e splittando per virgola/punto e virgola
  3. Elementi con classe contenente `cast` o `actor` come fallback
- **Rama — Episode overview**: aggiunto campo `overview` sui video (vuoto per ora, pronto per espansione futura)

---

## [1.1.2] — 2026-03-05

### Fixed
- **Rama** — `SundefinedEundefined Episodio 1`: il campo `number` nei video è stato rinominato in `episode` (campo richiesto da Stremio per mostrare `S1E1`)
- **Rama** — aggiunto campo `background` (OG image dalla pagina, fallback al poster)
- **Rama** — aggiunta estrazione `genres` e `cast` dallo scraping HTML
- **Rama** — data di rilascio episodi non più epoca Unix (1970): usa l'anno della serie
- **Rama** — thumbnail episodi ora usa l'immagine dello slide del swiper con fallback al poster
- **KissKH** — aggiunto campo `background` (thumbnail della serie)
- **KissKH** — aggiunto mapping `genres` da `data.genres`/`data.subCategory` (se presenti nella risposta API)
- **KissKH** — aggiunto mapping `cast` da `data.artists` (se presente nella risposta API)
- **KissKH** — thumbnail episodi ora usa `ep.thumbnail` con fallback a `data.thumbnail`

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
