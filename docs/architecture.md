# Architettura Avanzata — StreamFusion Mail v3.1

## Panoramica

Questa architettura migliora velocità, resilienza e scalabilità del sistema attraverso 8 moduli interconnessi che si integrano senza rompere le funzionalità esistenti.

```
┌─────────────────────────────────────────────────────────────────┐
│                        STREMIO CLIENT                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     VERCEL EDGE (fra1)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Manifest │  │ Catalog  │  │  Stream  │  │  HLS Proxy    │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│                      │              │                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  Provider Aggregator                      │  │
│  │  kisskh · rama · guardoserie · eurostreaming · cb01 ...  │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │                                   │
│  ┌──────────┐ ┌────────────┴──────┐ ┌────────────────────┐    │
│  │  Cache   │ │  Domain Failover  │ │     Anti-Ban       │    │
│  │ Manager  │ │  + Mirror Scan    │ │  Throttle + UA     │    │
│  │ (L1+L2)  │ │  + Priority Score │ │  Rotation          │    │
│  └────┬─────┘ └───────────────────┘ └────────────────────┘    │
│       │                                                         │
│  ┌────┴─────────────────────────────────────────────────────┐  │
│  │              CF Worker Pool (5 workers)                   │  │
│  │  Smart Routing · Health Tracking · KV Replication         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Cron Manager                            │  │
│  │  domain-health · mirror-scan · worker-health · cache-stats│  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               Enhanced Logger                             │  │
│  │  Circular buffer · Error summary · Performance timing     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKERS (5 accounts)                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│  │ primary │ │  lilli   │ │  vito   │ │  dino   │ │ pixie   │ │
│  │ 100K/d  │ │  100K/d  │ │  100K/d  │ │  100K/d  │ │  100K/d  │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
│              KV Cache · Proxy · CAPTCHA · Cron                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Moduli Implementati

### 1. Configurazione Centralizzata (`src/config/system.js`)

Tutti i parametri configurabili del sistema in un unico punto.
Override via variabili d'ambiente.

| Sezione | Parametri chiave | Default |
|---------|-----------------|---------|
| `cache` | `memoryMaxSize`, `streamTtl`, `catalogTtl`, `kvPersistEnabled` | 2000, 15min, 1h, true |
| `domainFailover` | `maxFailures`, `cooldownMs`, `healthCheckTimeoutMs` | 3, 5min, 8s |
| `antiBan` | `minDelayMs`, `maxDelayMs`, `maxConcurrentPerHost` | 200, 800, 3 |
| `mirrorScanner` | `scanIntervalMs`, `checkTimeoutMs`, `maxMirrorsPerProvider` | 30min, 10s, 10 |
| `scoring` | `responseTimeWeight`, `successRateWeight`, `freshnessWeight` | 0.4, 0.4, 0.2 |
| `workerPool` | `smartRouting`, `healthCheckMs`, `maxRetries` | true, 2min, 2 |

### 2. Cache Manager (`src/cache/cache_manager.js`)

Cache distribuita multi-tier:

- **L1**: In-memory LRU (2000 entry, configurable)
- **L2**: CF Worker KV (write-through, fire-and-forget)
- **Stale-while-revalidate**: Serve dati stale mentre ricarica in background
- **Stale-if-error**: Serve dati stale se l'upstream fallisce
- **Stats tracking**: hit rate, evictions, KV hits/misses

```javascript
const cache = require('./src/cache/cache_manager');

// Lettura con stale-while-revalidate
const data = await cache.get('streams:tt1234567', {
  kvParam: 'kk_meta',
  kvKey: '1234567',
  revalidate: async () => { /* refresh in background */ }
});

// Scrittura con TTL e write-through KV
cache.set('streams:tt1234567', streams, cache.TTL.STREAM, {
  kvParam: 'kk_meta',
  kvKey: '1234567'
});
```

### 3. Domain Failover (`src/domain-failover/failover.js`)

Gestione automatica dei cambi dominio:

- Traccia salute di ogni dominio per provider
- Dopo N fallimenti consecutivi → marca come DOWN
- Cooldown con auto-recovery
- Background health checks
- Priority scoring basato su velocità + affidabilità

```javascript
const failover = require('./src/domain-failover/failover');

// Registra domini alternativi
failover.registerAlternatives('guardoserie', [
  'https://guardoserie.digital',
  'https://guardoserie.best',
  'https://guardoserie.horse'
]);

// Ottieni il dominio migliore
const bestUrl = failover.getBestDomain('guardoserie', currentPrimary);

// Registra risultato
failover.recordSuccess('guardoserie', bestUrl, responseMs);
failover.recordFailure('guardoserie', bestUrl, 'HTTP 403');
```

### 4. Mirror Scanner (`src/mirror-scanner/scanner.js`)

Scoperta automatica di nuovi mirror per provider con cambio dominio frequente:

- Pattern TLD configurati per ogni provider
- Validazione via fingerprint (contenuto della pagina)
- Rilevamento protezione Cloudflare
- Batch checking (5 candidati in parallelo)
- Integrazione automatica con failover system

**Provider supportati**: guardoserie, eurostreaming, cb01, guardahd, streamingcommunity

### 5. Anti-Ban System (`src/utils/antiban.js`)

Protezione avanzata contro ban e rate-limiting:

- **20+ User-Agent realistici** (Chrome, Firefox, Edge, Safari, Mobile)
- **Per-host throttling**: delay minimo tra richieste allo stesso host
- **Concurrency limiting**: max 3 richieste simultanee per host
- **Exponential back-off**: su 429/403, aumenta delay automaticamente
- **Header randomization**: Accept, Accept-Language, sec-ch-ua variabili
- **Host-consistent UA**: stesso browser per stesso sito (più realistico)

```javascript
const antiban = require('./src/utils/antiban');

// Fetch protetto con throttling automatico
const result = await antiban.protectedFetch(url, async () => {
  return await fetch(url, { headers: antiban.getRandomHeaders(url) });
});
```

### 6. Cron Job Manager (`src/cron/cron_manager.js`)

Orchestratore unificato per tutti i job periodici:

| Job | Endpoint | Schedule | Descrizione |
|-----|----------|----------|-------------|
| `domain-health` | `/api/cron/domain-health` | ogni 5 min | Verifica salute domini down/degraded |
| `mirror-scan` | `/api/cron/mirror-scan` | ogni 6 ore | Scansione mirror alternativi |
| `worker-health` | `/api/cron/worker-health` | ogni 10 min | Verifica salute pool CF Workers |
| `cache-stats` | `/api/cron/cache-stats` | ogni ora | Report statistiche cache |
| `warm-uprot` | `/api/cron/warm-uprot` | ogni 4 ore | Refresh cookie uprot |

Status di tutti i job: `GET /api/cron/status`

### 7. CF Worker Pool Ottimizzato (`src/utils/cfWorkerPool.js`)

Miglioramenti al pool esistente:

- **Smart Routing**: sceglie il worker più veloce/affidabile basandosi su latenza media ed error rate
- **Health Tracking**: per-worker `avgMs`, `errors`, `requests`, `errorRate`
- **Automatic fallback**: se il worker preferito fallisce, passa al prossimo
- **Data gathering**: primi N richieste in round-robin per raccogliere dati

### 8. Enhanced Logger (`src/utils/logger.js`)

Miglioramenti al logger esistente:

- **Circular buffer**: ultimi 500 log in memoria per debug
- **Performance timing**: `log.time('label')` → `endFn({ extra })` con ms
- **Error summary**: conteggi errori/warning per tag nelle ultime N minuti
- **API endpoint**: `GET /api/system/status` mostra stato completo

---

## Monitoring Dashboard

Tutti i dati sono accessibili via l'endpoint unificato:

```
GET /api/system/status?token=DEBUG_TOKEN
```

Risposta:
```json
{
  "ts": "2025-01-15T12:00:00Z",
  "version": "3.1.0",
  "cache": { "hits": 1234, "misses": 56, "hitRate": "95.6%", "l1Size": 890 },
  "domainHealth": { "guardoserie": [{ "url": "...", "status": "up", "score": 85 }] },
  "workerPool": { "size": 5, "health": { ... } },
  "throttle": { "guardoserie.digital": { "backoffMs": 0, "concurrent": 1 } },
  "mirrors": { "guardoserie": { "count": 3, "lastScanAt": "..." } },
  "cron": { "domain-health": { "lastRun": "...", "runCount": 12 } }
}
```

---

## Variabili d'Ambiente (Nuove)

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `CACHE_MEMORY_MAX` | 2000 | Max entry cache in-memory |
| `CACHE_STREAM_TTL` | 900000 | TTL stream (ms) |
| `CACHE_KV_PERSIST` | true | Abilita persistenza KV |
| `DOMAIN_MAX_FAILURES` | 3 | Fallimenti prima di DOWN |
| `DOMAIN_COOLDOWN_MS` | 300000 | Cooldown dominio DOWN |
| `ANTIBAN_THROTTLE` | true | Abilita throttling |
| `ANTIBAN_MAX_CONCURRENT` | 3 | Max richieste concorrenti/host |
| `POOL_SMART_ROUTING` | true | Smart routing CF Workers |
| `CRON_SECRET` | - | Segreto per auth cron endpoints |
| `DEBUG_TOKEN` | - | Token per endpoint debug/monitoring |

---

## Non-Breaking Compatibility

Tutti i moduli sono **additivi** e non modificano il comportamento esistente:

1. `cache_manager.js` NON sostituisce `cache_layer.js` — coesistono
2. `failover.js` NON modifica `provider_urls.js` — si integra opzionalmente
3. `antiban.js` NON sostituisce `fetcher.js` — offre `protectedFetch()` wrapper
4. `cfWorkerPool.js` mantiene la stessa API pubblica (`getProxyWorker`, `getPrimaryWorker`, etc.)
5. `logger.js` mantiene la stessa API (`createLogger`) — aggiunge solo nuove funzioni
6. `cron_manager.js` aggiunge nuove route senza toccare le esistenti
7. `system.js` è un modulo nuovo indipendente

Per adottare i moduli nei provider esistenti, basta importarli gradualmente:
```javascript
// In qualsiasi provider:
const failover = require('../domain-failover/failover');
const antiban = require('../utils/antiban');

// Usa il dominio migliore
const baseUrl = failover.getBestDomain('guardoserie', getGuardoserieBaseUrl());

// Fetch con protezione anti-ban
const html = await antiban.protectedFetch(url, () => fetch(url, { headers: antiban.getRandomHeaders(url) }));
```
