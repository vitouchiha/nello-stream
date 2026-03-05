# StreamFusion Mail

![Version](https://img.shields.io/badge/version-1.3.4-blue?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D18-green?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvitouchiha%2Fstreamfusion-mail)
[![Vercel Status](https://img.shields.io/badge/vercel-deployed-brightgreen?style=flat-square&logo=vercel)](https://streamfusion-mail.vercel.app)

> Aggregatore flussi streaming multi-provider per [Stremio](https://www.stremio.com/)
> Korean Drama & Asian Drama con sub ITA — **KissKH · Rama**
>
> 🔗 **Live:** https://streamfusion-mail.vercel.app
> 📦 **GitHub:** https://github.com/vitouchiha/streamfusion-mail
> 📡 **Manifest:** https://streamfusion-mail.vercel.app/manifest.json

---

## Provider attivi

| Provider | Sito | Tipo | Sub | Tecnica |
|----------|------|------|-----|---------|
| **KissKH** | `kisskh.co` | Asian Drama | ITA | Axios REST API + FlareSolverr + direct axios fallback |
| **Rama** | `ramaorientalfansub.live` | Korean Drama | ITA | cloudscraper + cheerio + iframe/MP4 |

---

## Architettura

```
StreamFusion Mail
├── server.js                  ← Entry point (Express, routing Stremio protocol)
├── manifest.json              ← Stremio manifest (id, version, catalogs, resources)
├── src/
│   ├── providers/
│   │   ├── index.js           ← Aggregatore: routing, timeout, deduplication, IMDB lookup
│   │   ├── kisskh.js          ← Provider KissKH (API + FlareSolverr + direct axios fallback)
│   │   └── rama.js            ← Provider Rama Oriental Fansub
│   └── utils/
│       ├── logger.js          ← Logger strutturato (JSON prod / human dev)
│       ├── cache.js           ← TTL cache LRU in-memory
│       ├── fetcher.js         ← HTTP: cloudscraper + axios + timeout wrapper
│       ├── flaresolverr.js    ← FlareSolverr client (session/primer per KissKH)
│       ├── mediaflow.js       ← MediaFlow Proxy URL wrapper
│       ├── tmdb.js            ← TMDB enrichment (poster, cast, rating)
│       ├── subDecrypter.js    ← Decrittazione sottotitoli KissKH (AES-128-CBC)
│       ├── config.js          ← Config decode/encode (AES-256-GCM in URL)
│       └── titleHelper.js     ← Similarity, slug, ID normalization
```

---

## Flusso logico

```
Stremio Client
      │
      ▼
  GET /manifest.json
  GET /catalog/:type/:id.json?extra=…
  GET /meta/:type/:id.json
  GET /stream/:type/:id.json
      │
      ▼
  server.js (Express) — timeout 50s guard
      │
      ├─ type=series  / id=kisskh_*   ──► kisskh.js
      │                                     └─ 1. FlareSolverr (max 25s) → episodio API
      │                                     └─ 2. axios diretto via proxy (fallback)
      │                                     └─ 3. CF clearance cookie (fallback)
      │                                     └─ subtitle decrypt (AES-128-CBC)
      │
      ├─ type=kdrama  / id=rama_*     ──► rama.js
      │                                     └─ cloudscraper + proxy
      │                                     └─ iframe / .mp4 extraction + URL encode
      │
      └─ id=tt* (IMDB)  ──► Cinemeta lookup → title search su tutti i provider
```

---

## Catalog disponibili

| Catalog ID | Tipo | Provider |
|-----------|------|----------|
| `kisskh_catalog` | `series` | KissKH — Asian Drama (EN + ITA sub) |
| `rama_catalog` | `kdrama` | Rama — Korean Drama sub ITA |

---

## Endpoint

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `GET` | `/` | Landing page con configurazione addon |
| `GET` | `/:config/manifest.json` | Manifest Stremio (con config utente) |
| `GET` | `/health` | Health check JSON |
| `GET` | `/catalog/:type/:id.json` | Lista serie (con `?search=` e `?skip=`) |
| `GET` | `/meta/:type/:id.json` | Dettaglio serie + episodi + TMDB enrichment |
| `GET` | `/stream/:type/:id.json` | Stream per episodio (MP4/HLS) |
| `GET` | `/debug/providers` | Reachability check — richiede `DEBUG_TOKEN` |
| `GET` | `/debug/flaresolverr` | FlareSolverr health + KissKH stream test |

---

## Esempio risposta stream JSON

```json
{
  "streams": [
    {
      "name": "720p",
      "description": "🚀 Rama · 📁 In Your Radiant Season - Episodio 1\n🇰🇷 Sub ITA",
      "url": "https://server1.streamingrof.online/02-DRAMACOREANI/In%20Your%20Radiant%20Season.mp4",
      "behaviorHints": { "bingeGroup": "streamfusion-rama-rama_in-your-radiant-season" }
    },
    {
      "name": "🚀 KissKH",
      "description": "📁 Crash Landing on You - Episode 3\n🇰🇷 Sub ITA",
      "url": "https://cdn.kisskh.co/stream/abc123.m3u8",
      "behaviorHints": { "notWebReady": false, "bingeGroup": "streamfusion-kisskh-kisskh_1234" }
    }
  ]
}
```

---

## Configurazione utente

La landing page genera un URL personalizzato con config AES-256-GCM encoded:

```
https://streamfusion-mail.vercel.app/BASE64_CONFIG/manifest.json
```

| Opzione | Descrizione |
|---------|-------------|
| **MediaFlow Proxy URL + Key** | Rerouta HLS/DASH attraverso il tuo proxy |
| **HTTP/SOCKS5 Proxy** | Proxy residenziale per bypassare blocchi IP Cloudflare |
| **TMDB API Key** | Poster HD, cast, generi, rating dei drama |
| **RPDB API Key** | Poster con rating IMDb sovrimpresso (richiede TMDB) |
| **Provider attivi** | Scegli KissKH, Rama, o entrambi |
| **Nascondi cataloghi** | Rimuove catalog dalla home Stremio |
| **Stream da Cinemeta/IMDB** | Risponde anche a ID `tt*` da Cinemeta |

---

## Sviluppo locale

```bash
git clone https://github.com/vitouchiha/streamfusion-mail.git
cd streamfusion-mail
npm install
npm start
# watch mode:
npm run dev
```

Server su `http://localhost:3000`
Installa su Stremio: `stremio://localhost:3000/manifest.json`

---

## Deploy su Vercel

```bash
npm i -g vercel
vercel login
vercel --prod
```

**Variabili d'ambiente da configurare:**

| Variabile | Descrizione |
|-----------|-------------|
| `PROXY_URL` | Proxy HTTP/SOCKS5 residenziale (es. `http://user:pass@host:port`) |
| `FLARESOLVERR_URL` | URL FlareSolverr per KissKH (es. `https://fs.koyeb.app`) |
| `TMDB_API_KEY` | API key TMDB v3 |
| `DEBUG_TOKEN` | Token segreto per endpoint `/debug/*` |
| `NODE_ENV` | `production` |

---

## Variabili d'ambiente

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `PORT` | `3000` | Porta server HTTP (locale) |
| `NODE_ENV` | `development` | `production` abilita JSON logging |
| `LOG_LEVEL` | `info` | `debug` · `info` · `warn` · `error` |
| `PROXY_URL` | — | Proxy HTTP/SOCKS5 per cloudscraper |
| `FLARESOLVERR_URL` | — | URL FlareSolverr per KissKH |
| `CF_CLEARANCE_KISSKH` | — | Cookie CF clearance KissKH (fallback) |
| `CATALOG_TIMEOUT` | `25000` | Timeout catalog handler (ms) |
| `META_TIMEOUT` | `30000` | Timeout meta handler (ms) |
| `STREAM_TIMEOUT` | `45000` | Timeout stream handler (ms) |
| `SERVERLESS_TIMEOUT` | `50000` | Timeout globale serverless guard (ms) |
| `DEBUG_TOKEN` | — | Token auth per endpoint `/debug/*` |
| `CONFIG_SECRET` | _(interno)_ | Chiave AES-256-GCM per encrypt config in URL |

---

## Licenza

MIT

---

> ℹ️ Questo addon accede a contenuti pubblicamente disponibili su internet.
> Non ospita né distribuisce alcun contenuto multimediale.
