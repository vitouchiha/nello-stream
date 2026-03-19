# 🐶 Nello Stream

<!-- release:meta:start -->
- Release: `v3.2.55`
- Date: `2026-03-19`
- Remote smoke target: `https://nellostream.vercel.app`
<!-- release:meta:end -->

> Addon Stremio italiano all-in-one: **Film, Serie TV, Anime, K-Drama** da 12+ siti, con captcha auto-risolti e zero configurazione manuale.

---

## Indice

1. [Cos'è Nello Stream](#-cosè-nello-stream)
2. [Funzionalità principali](#-funzionalità-principali)
3. [Account e servizi necessari](#-account-e-servizi-necessari)
4. [Deploy su Vercel (consigliato)](#-deploy-su-vercel-consigliato)
5. [Deploy su Render](#-deploy-su-render)
6. [Deploy su Koyeb](#-deploy-su-koyeb)
7. [Deploy su Hugging Face Spaces](#-deploy-su-hugging-face-spaces)
8. [Configurazione Cloudflare Worker](#-configurazione-cloudflare-worker)
9. [Configurazione Proxy (WebShare)](#-configurazione-proxy-webshare)
10. [Configurazione MediaFlow Proxy (opzionale)](#-configurazione-mediaflow-proxy-opzionale)
11. [Chiave TMDB (consigliata)](#-chiave-tmdb-consigliata)
12. [Variabili d'ambiente — riferimento completo](#-variabili-dambiente--riferimento-completo)
13. [Installazione su Stremio](#-installazione-su-stremio)
14. [Struttura del progetto](#-struttura-del-progetto)
15. [Provider supportati](#-provider-supportati)
16. [Architettura tecnica](#-architettura-tecnica)
17. [Sviluppo locale](#-sviluppo-locale)
18. [FAQ / Risoluzione problemi](#-faq--risoluzione-problemi)

---

## 🐶 Cos'è Nello Stream

Nello Stream è un **addon per Stremio** che aggrega link streaming da 12+ siti italiani e internazionali. Funziona come un motore di ricerca: quando cerchi un film o una serie su Stremio, Nello Stream trova automaticamente i link disponibili sui vari provider.

**Cosa fa:**
- Cerca film, serie TV, anime e K-Drama su 12 siti diversi contemporaneamente
- Risolve automaticamente i captcha (nessun intervento manuale)
- Aggiorna i domini dei siti automaticamente quando cambiano
- Cripta la tua configurazione personale (proxy, API key) per proteggere la privacy
- Fornisce sottotitoli italiani per i drama asiatici (KissKH)

**Cosa ti serve per usarlo:**
- Un account hosting gratuito (Vercel, Render, Koyeb o Hugging Face)
- Un Cloudflare Worker gratuito (fa da proxy per i siti protetti)
- Un proxy residenziale (WebShare ha un piano free)
- Stremio installato sul tuo dispositivo

---

## ✨ Funzionalità principali

| Categoria | Dettagli |
|:----------|:---------|
| **Siti italiani** | StreamingCommunity, GuardaHD, GuardaFlix, GuardaSerie, GuardoSerie, Eurostreaming, CB01, ToonItalia, Loonex |
| **Anime** | AnimeUnity, AnimeWorld, AnimeSaturn (ITA) |
| **Drama asiatici** | KissKH (K/C/J/Thai-Drama), Rama (K-Drama sub ITA) |
| **Extractor video** | MixDrop, MaxStream, VixCloud, SuperVideo, Turbovidda, DropLoad, StreamTape, Uqload e altri |
| **Captcha** | Risoluzione automatica Uprot e SafeGo (OCR + AI) |
| **Bypass Cloudflare** | 4 livelli: CF Worker → Cloudscraper → FlareSolverr → Puppeteer |
| **Sottotitoli** | KissKH sub ITA/ENG decriptati automaticamente (AES-128-CBC) |
| **Sicurezza** | Config utente criptata AES-256-GCM, token HLS firmati HMAC-SHA256 |

---

## 🔑 Account e servizi necessari

Prima di fare il deploy, devi creare questi account (tutti gratuiti):

| Servizio | Obbligatorio? | Costo | A cosa serve |
|:---------|:---:|:---:|:-------------|
| **GitHub** | ✅ Sì | Gratis | Ospitare il codice e collegarlo all'hosting |
| **Hosting** (Vercel/Render/Koyeb/HF) | ✅ Sì | Gratis | Far girare l'addon online 24/7 |
| **Cloudflare** | ✅ Sì | Gratis | Worker proxy per bypassare le protezioni dei siti |
| **WebShare** (proxy) | ✅ Sì | Gratis (10 proxy) | Proxy residenziale per evitare blocchi IP datacenter |
| **TMDB** | ⚡ Consigliata | Gratis | Locandine, cast, descrizioni in italiano |
| **MediaFlow Proxy** | ❌ Opzionale | Gratis (self-host) | Necessario solo per StreamingCommunity |

---

## 🚀 Deploy su Vercel (consigliato)

Vercel è la piattaforma consigliata: è gratuita, veloce (server a Francoforte) e supporta cron job integrati.

### Passo 1 — Fork del repository

1. Vai su [GitHub](https://github.com) e accedi (o crea un account)
2. Vai al repository di Nello Stream
3. Clicca **Fork** in alto a destra → crea la tua copia

### Passo 2 — Crea account Vercel

1. Vai su [vercel.com](https://vercel.com) e clicca **Sign Up**
2. Scegli **Continue with GitHub** per collegare il tuo account GitHub
3. Autorizza Vercel ad accedere ai tuoi repository

### Passo 3 — Importa il progetto

1. Nella dashboard Vercel, clicca **Add New → Project**
2. Seleziona il repository forkato dalla lista
3. **Framework Preset:** lascia `Other`
4. **Root Directory:** lascia vuoto (root del repo)
5. Clicca **Deploy** — il primo deploy fallirà, è normale (mancano le variabili)

### Passo 4 — Configura le variabili d'ambiente

1. Vai in **Settings → Environment Variables** del tuo progetto Vercel
2. Aggiungi le variabili **obbligatorie** (vedi sezioni successive per ottenere i valori):

| Nome | Valore | Note |
|:-----|:-------|:-----|
| `CF_WORKER_URL` | `https://tuo-worker.tuoaccount.workers.dev` | URL del tuo CF Worker ([vedi sotto](#-configurazione-cloudflare-worker)) |
| `CF_WORKER_AUTH` | `abc123...` | Token segreto del CF Worker |
| `PROXY_URL` | `http://user:pass@host:port` | Proxy WebShare ([vedi sotto](#-configurazione-proxy-webshare)) |
| `TMDB_API_KEY` | `abc123...` | Chiave API TMDB ([vedi sotto](#-chiave-tmdb-consigliata)) |
| `CONFIG_SECRET` | una stringa casuale lunga | Segreto per criptare la config utente |
| `HLS_PROXY_SECRET` | una stringa casuale lunga | Segreto per firmare i token HLS |

> **Generare i segreti:** puoi usare qualsiasi stringa casuale di almeno 32 caratteri. Su un terminale puoi generarla con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` oppure inventa una stringa lunga e complessa.

3. Clicca **Save** e poi **Deployments → ultimo deploy → Redeploy**

### Passo 5 — Verifica

Apri `https://tuo-progetto.vercel.app/health` nel browser. Se vedi una risposta JSON, funziona.

L'URL per Stremio sarà:
```
https://tuo-progetto.vercel.app/manifest.json
```

---

## 🖥️ Deploy su Render

[Render](https://render.com) è un'alternativa gratuita a Vercel con server sempre attivi.

### Passo 1 — Crea account

1. Vai su [render.com](https://render.com) → **Get Started for Free**
2. Collegati con GitHub

### Passo 2 — Crea un Web Service

1. **Dashboard → New → Web Service**
2. Collega il repository forkato
3. Impostazioni:
   - **Name:** `nello-stream` (o quello che preferisci)
   - **Region:** `Frankfurt (EU Central)` (consigliato per l'Italia)
   - **Branch:** `master`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** `Free`

### Passo 3 — Variabili d'ambiente

Vai in **Environment → Environment Variables** e aggiungi le stesse variabili della tabella Vercel sopra, più:

| Nome | Valore |
|:-----|:-------|
| `PORT` | `10000` (Render usa questa porta) |
| `NODE_ENV` | `production` |

### Passo 4 — Deploy

Clicca **Create Web Service**. Render costruirà e avvierà l'addon.

URL per Stremio:
```
https://nello-stream.onrender.com/manifest.json
```

> **Nota:** Il piano free di Render spegne il servizio dopo 15 minuti di inattività. La prima richiesta dopo lo spegnimento richiede ~30 secondi per il riavvio.

---

## 🪁 Deploy su Koyeb

[Koyeb](https://koyeb.com) offre un piano free con server sempre attivi (no cold start).

### Passo 1 — Crea account

1. Vai su [koyeb.com](https://koyeb.com) → **Get Started**
2. Collegati con GitHub

### Passo 2 — Crea il servizio

1. **Create App → Web Service → GitHub**
2. Seleziona il repository forkato
3. Impostazioni:
   - **Builder:** `Buildpack`
   - **Region:** `Frankfurt` (fra)
   - **Instance type:** `Free` (nano)
   - **Run command:** `node server.js`
   - **Port:** `3000`

### Passo 3 — Variabili d'ambiente

Nella sezione **Environment variables**, aggiungi tutte le variabili obbligatorie (stessa tabella di Vercel) più:

| Nome | Valore |
|:-----|:-------|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |

### Passo 4 — Deploy

Clicca **Deploy**. Koyeb costruirà e avvierà automaticamente.

URL per Stremio:
```
https://nello-stream-tuoaccount.koyeb.app/manifest.json
```

---

## 🤗 Deploy su Hugging Face Spaces

[Hugging Face](https://huggingface.co) Spaces permette di hostare app Node.js gratuitamente.

### Passo 1 — Crea account

1. Vai su [huggingface.co](https://huggingface.co) → **Sign Up**
2. Conferma l'email

### Passo 2 — Crea uno Space

1. **New Space** dalla dashboard
2. Impostazioni:
   - **Space name:** `nello-stream`
   - **SDK:** `Docker`
   - **Hardware:** `CPU basic (Free)`
   - **Visibility:** `Private` (consigliato)

### Passo 3 — Prepara il Dockerfile

Crea un file `Dockerfile` nella root del tuo fork con questo contenuto:

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 7860
ENV PORT=7860 NODE_ENV=production
CMD ["node", "server.js"]
```

### Passo 4 — Variabili d'ambiente

In **Settings → Variables and secrets** dello Space, aggiungi tutte le variabili obbligatorie come **Secrets**.

### Passo 5 — Push

Pusha il codice (con il Dockerfile) al repository dello Space tramite git. HF costruirà il Docker container automaticamente.

URL per Stremio:
```
https://tuoaccount-nello-stream.hf.space/manifest.json
```

> **Nota:** Gli Spaces gratuiti si spengono dopo 48 ore di inattività. Puoi impostarli come "always on" con un piano a pagamento ($5/mese).

---

## ☁️ Configurazione Cloudflare Worker

Il Cloudflare Worker è il componente più importante: fa da proxy per i siti protetti da Cloudflare (KissKH, Eurostreaming, GuardoSerie, ecc.). Le richieste partono dall'interno della rete Cloudflare, quindi non vengono bloccate.

### Perché serve

Molti siti di streaming usano Cloudflare per bloccare le richieste automatiche. Le piattaforme di hosting come Vercel hanno IP conosciuti che vengono bloccati. Il CF Worker fa la richiesta "dall'interno" della rete Cloudflare e non viene bloccato.

### Passo 1 — Crea account Cloudflare

1. Vai su [dash.cloudflare.com](https://dash.cloudflare.com) → **Sign Up**
2. Conferma l'email (non serve aggiungere un dominio, serve solo l'account)

### Passo 2 — Crea il Worker

1. Nel menu sinistro: **Workers & Pages → Overview → Create**
2. Seleziona **Create Worker**
3. Dai un nome: `kisskh-proxy` (o quello che preferisci)
4. Clicca **Deploy** (deployerà il codice "Hello World" di default)
5. Clicca **Edit Code**

### Passo 3 — Incolla il codice

1. Cancella tutto il codice di default
2. Apri il file `workers/cfworker.js` dal repository e copia tutto il contenuto
3. Incollalo nell'editor Cloudflare
4. Clicca **Deploy**

### Passo 4 — Crea il KV Namespace

Il Worker usa un database KV (Key-Value) per la cache.

1. Vai su **Workers & Pages → KV → Create a namespace**
2. Nome: `ES_CACHE` (deve essere esattamente questo)
3. Torna al Worker → **Settings → Variables and Secrets**
4. Nella sezione **KV Namespace Bindings**, clicca **Add binding**:
   - **Variable name:** `ES_CACHE`
   - **KV Namespace:** seleziona `ES_CACHE`
5. Salva

### Passo 5 — Imposta il token di autenticazione

1. Sempre in **Settings → Variables and Secrets**
2. Clicca **Add variable**:
   - **Name:** `AUTH_TOKEN`
   - **Value:** una stringa casuale lunga (es. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - Seleziona **Encrypt** per proteggere il valore
3. Salva

### Passo 6 — Attiva i cron trigger (opzionale)

I cron trigger aggiornano automaticamente i domini e la cache.

1. Vai su **Settings → Triggers**
2. In **Cron Triggers**, aggiungi:
   - `0 */6 * * *` (ogni 6 ore — aggiornamento domini + cache EuroStreaming)

### Riepilogo

Alla fine avrai:

| Dato | Dove metterlo |
|:-----|:-------------|
| URL del Worker (es. `https://kisskh-proxy.tuoaccount.workers.dev`) | Variabile `CF_WORKER_URL` nell'hosting |
| Valore di AUTH_TOKEN | Variabile `CF_WORKER_AUTH` nell'hosting |

---

## 🌐 Configurazione Proxy (WebShare)

Il proxy è necessario perché i siti di streaming bloccano gli IP dei datacenter (Vercel, Render, ecc.). Un proxy residenziale fa sembrare le richieste come se venissero da una connessione domestica.

### Perché serve

Senza proxy, KissKH, RamaOrientalFansub e altri siti mostreranno errore 403 (accesso negato) perché riconoscono gli IP di AWS/Google Cloud/Vercel.

### Passo 1 — Crea account WebShare

1. Vai su [proxy.webshare.io](https://proxy.webshare.io)
2. Clicca **Start for free**
3. Registrati con email e password

### Passo 2 — Ottieni i proxy

1. Nella dashboard, vai su **Proxy → Proxy List**
2. Il piano free include **10 proxy** (IP condivisi ma funzionanti)
3. Clicca sull'icona ⚙️ di un proxy per vedere i dettagli:
   - **IP Address** (es. `185.199.229.156`)
   - **Port** (es. `7492`)
   - **Username** (es. `abcdef`)
   - **Password** (es. `xyz123`)

### Passo 3 — Formatta l'URL del proxy

Il formato è:
```
http://username:password@ip:port
```

Esempio:
```
http://abcdef:xyz123@185.199.229.156:7492
```

### Passo 4 — Imposta la variabile d'ambiente

| Nome | Valore |
|:-----|:-------|
| `PROXY_URL` | `http://abcdef:xyz123@185.199.229.156:7492` |

**Opzionale — lista di proxy multipli:** se vuoi usare più proxy per la rotazione (riduce i blocchi):

| Nome | Valore |
|:-----|:-------|
| `WEBSHARE_PROXIES` | `http://u1:p1@ip1:port1,http://u2:p2@ip2:port2,http://u3:p3@ip3:port3` |

> **Alternativa a WebShare:** vai qualunque provider di proxy residenziali (BrightData, Oxylabs, SmartProxy) oppure imposta un proxy personale su un VPS casalingo.

---

## 📺 Configurazione MediaFlow Proxy (opzionale)

MediaFlow Proxy (MFP) è necessario **solo per StreamingCommunity** e alcuni provider anime (AnimeUnity, AnimeSaturn). Se non ti interessano questi provider, puoi saltare questa sezione.

### Cos'è

MediaFlow Proxy è un server proxy che gestisce stream HLS/DASH con header personalizzati. Alcuni provider richiedono header specifici (Referer, Origin) che il browser di Stremio non può inviare direttamente.

### Opzione A — Usa un'istanza pubblica

Esistono istanze MFP pubbliche gratuite. Cerca "mediaflow proxy public instances" per trovarne una. L'URL sarà qualcosa come:
```
https://mfp.example.com
```

### Opzione B — Self-host su Hugging Face (gratis)

1. Vai su [huggingface.co](https://huggingface.co)
2. **New Space** → SDK: Docker → Hardware: Free CPU
3. Usa il Docker image ufficiale di MediaFlow Proxy
4. In **Settings → Variables**, imposta `API_PASSWORD` (scegli una password)
5. L'URL sarà `https://tuoaccount-mfp.hf.space`

### Opzione C — Self-host su un VPS

```bash
docker run -d -p 8888:8888 -e API_PASSWORD=tua_password mhdzumair/mediaflow-proxy
```

### Variabili d'ambiente

| Nome | Valore |
|:-----|:-------|
| `MFP_URL` | `https://tuo-mfp.hf.space` (URL della tua istanza) |
| `MFP_API_PASSWORD` | La password che hai impostato |

---

## 🎬 Chiave TMDB (consigliata)

TMDB (The Movie Database) fornisce locandine, trame, cast e metadata in italiano. Senza questa chiave l'addon funziona, ma non mostra locandine e info dettagliate per i drama KissKH/Rama.

### Passo 1 — Crea account

1. Vai su [themoviedb.org](https://www.themoviedb.org)
2. Clicca **Join TMDB** e registrati
3. Conferma l'email

### Passo 2 — Richiedi la chiave API

1. Vai su [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
2. Clicca **Request an API Key**
3. Scegli **Developer** → accetta i termini
4. Compila il form (puoi mettere "Personal use" come tipo di utilizzo)
5. Riceverai una **API Key (v3 auth)** — è una stringa tipo `abc123def456...`

### Variabile d'ambiente

| Nome | Valore |
|:-----|:-------|
| `TMDB_API_KEY` | la tua chiave v3 |

---

## 📋 Variabili d'ambiente — riferimento completo

### Obbligatorie

| Variabile | Descrizione | Dove trovarla |
|:----------|:------------|:-------------|
| `CF_WORKER_URL` | URL del Cloudflare Worker | Dashboard Cloudflare (sezione Workers) |
| `CF_WORKER_AUTH` | Token di autenticazione del Worker | Quello che hai impostato come `AUTH_TOKEN` nel Worker |
| `PROXY_URL` | Proxy residenziale (`http://user:pass@ip:port`) | Dashboard WebShare → Proxy List |
| `CONFIG_SECRET` | Segreto per cifratura della config utente | Genera una stringa casuale di 32+ caratteri |
| `HLS_PROXY_SECRET` | Segreto per firmare i token del proxy HLS | Genera una stringa casuale di 32+ caratteri |

### Consigliate

| Variabile | Descrizione |
|:----------|:------------|
| `TMDB_API_KEY` | Chiave API TMDB v3 (metadata in italiano) |

### Opzionali

| Variabile | Descrizione |
|:----------|:------------|
| `CF_WORKER_URLS` | Più CF Worker separati da virgola (load balancing) |
| `CF_WORKER_AUTHS` | Token per ogni CF Worker (stesso ordine di `CF_WORKER_URLS`) |
| `CF_PROXY_URL` | CF Worker dedicato al proxy di `serversicuro.cc` |
| `WEBSHARE_PROXIES` | Lista proxy statici separati da virgola (rotazione smart) |
| `MFP_URL` | URL MediaFlow Proxy (per StreamingCommunity, AnimeUnity) |
| `MFP_API_PASSWORD` | Password API di MediaFlow Proxy |
| `BROWSERLESS_URL` | Chrome remoto Browserless.io (WSS URL) per bypass Cloudflare estremo |
| `FLARESOLVERR_URL` | Endpoint FlareSolverr (`http://host:8191`) per bypass CF alternativo |
| `CRON_SECRET` | Segreto per proteggere gli endpoint cron |
| `DEBUG_TOKEN` | Token per l'endpoint `/debug-stream/` |

### Avanzate (di solito non servono)

| Variabile | Default | Descrizione |
|:----------|:--------|:------------|
| `PORT` | `3000` | Porta del server (cambiare su Render: `10000`) |
| `NODE_ENV` | `development` | Impostare `production` su tutti gli hosting |
| `CATALOG_TIMEOUT` | `9000` | Timeout ricerca catalogo (ms) |
| `META_TIMEOUT` | `30000` | Timeout metadata (ms) |
| `STREAM_TIMEOUT` | `45000` | Timeout ricerca stream (ms) |
| `SERVERLESS_TIMEOUT` | `55000` | Timeout funzione serverless (ms) |

---

## 📱 Installazione su Stremio

### Passo 1 — Installa Stremio

Scarica Stremio dal sito ufficiale: [stremio.com](https://www.stremio.com)

Disponibile per: Windows, macOS, Linux, Android, Android TV, Samsung TV, LG TV.

### Passo 2 — Aggiungi l'addon

1. Apri Stremio
2. Vai su **Addons** (icona puzzle in alto)
3. Nella barra di ricerca in alto, incolla l'URL del tuo addon:
   ```
   https://tuo-progetto.vercel.app/manifest.json
   ```
4. Clicca **Install**

### Passo 3 — Configurazione avanzata (opzionale)

Per personalizzare l'addon (proxy personale, filtro provider, chiave TMDB, ecc.):

1. Apri nel browser: `https://tuo-progetto.vercel.app/configure`
2. Compila i campi desiderati
3. Clicca **Installa** — installerà una versione configurata con le tue impostazioni criptate nell'URL

---

## 📁 Struttura del progetto

```
nello-stream/
├── api/                    # Entry point Vercel serverless
│   └── index.js
├── data/                   # Index JSON dei provider (titoli, episodi)
├── public/                 # Asset statici (logo, immagini)
├── scripts/
│   ├── warm/               # Script di warm-up cache (13 script)
│   ├── cron/               # Scheduler Windows e monitor (.bat, .ps1)
│   ├── update-all.js       # Sync automatica release (README, CHANGELOG, dashboard)
│   └── vercel-smoke.js     # Test smoke remoto Vercel
├── src/
│   ├── config/             # Configurazioni e normalizzazioni
│   ├── cron/               # Handler cron job (warm-uprot, domain-health)
│   ├── eurostreaming/      # Provider Eurostreaming
│   ├── guardoserie/        # Provider GuardoSerie
│   ├── loonex/             # Provider Loonex
│   ├── providers/          # Provider core (kisskh, rama, guardahd, ecc.)
│   ├── extractors/         # Extractor video (mixdrop, supervideo, ecc.)
│   └── utils/              # Utility (proxy, fetcher, cache, HLS proxy, ecc.)
├── web/                    # Landing page /configure
├── workers/                # Cloudflare Worker (cfworker.js, proxy)
├── server.js               # Express app principale
├── package.json            # Dipendenze Node.js
├── manifest.json           # Manifest Stremio (nome, versione, cataloghi)
└── vercel.json             # Configurazione Vercel (routes, crons, region)
```

---

## 🌐 Provider supportati

### Siti italiani (9)

| Provider | Contenuti | Note |
|:---------|:----------|:-----|
| **StreamingCommunity** | Film, Serie | Richiede MediaFlow Proxy |
| **GuardaHD** | Film, Serie | |
| **GuardaFlix** | Film | |
| **GuardaSerie** | Serie | |
| **GuardoSerie** | Film, Serie | Cache su CF Worker KV |
| **Eurostreaming** | Serie (ITA/SUB) | CF Worker bypass |
| **CB01** | Film, Serie | Captcha auto-risolti |
| **ToonItalia** | Cartoni/Anime | |
| **Loonex** | Cartoni | |

### Anime (3)

| Provider | Note |
|:---------|:-----|
| **AnimeUnity** | Mapping AniList/Kitsu/Fribb |
| **AnimeWorld** | Link diretti |
| **AnimeSaturn** | Link diretti |

### Drama asiatici (2)

| Provider | Contenuti | Note |
|:---------|:----------|:-----|
| **KissKH** | K-Drama, C-Drama, J-Drama, Thai | Sub ITA/ENG criptati, catalogo nativo |
| **Rama** | K-Drama (sub ITA) | Metadata TMDB |

---

## ⚙️ Architettura tecnica

### Flusso di una richiesta

```
Utente cerca "Squid Game" su Stremio
    ↓
Stremio chiama GET /stream/series/tt10919420.json
    ↓
server.js → decodifica config → chiama i provider
    ↓
Provider (es. GuardoSerie) → CF Worker → sito target
    ↓
Estrae link embed → Extractor (es. MixDrop) → URL stream
    ↓
Se stream HLS IP-locked → proxy HLS con token firmato HMAC
    ↓
Stremio riceve lista stream → utente sceglie e guarda
```

### Perché il CF Worker

```
[Sito protetto da Cloudflare]
     ↓
[Vercel/Render IP] ──→ ❌ 403 Forbidden (IP datacenter bloccato)
     ↓
[CF Worker IP] ──→ ✅ 200 OK (richiesta dall'interno della rete Cloudflare)
```

### Sistema di cache

| Livello | TTL | Dove |
|:--------|:----|:-----|
| In-memory LRU | 15m–24h | RAM del server |
| CF Worker KV | 48h (ES), 12h (GS), 90d (sub KissKH) | Edge Cloudflare globale |
| Index JSON | permanente (aggiornati via warm script) | `data/` nel deploy |

### Proxy HLS (stream IP-locked)

Alcuni CDN bloccano gli stream se l'IP che richiede il playlist è diverso da quello che richiede i segmenti. Il proxy HLS integrato:

1. Crea un token HMAC-SHA256 firmato con URL + header + scadenza
2. Riscrive gli URL nella playlist M3U8 con URL proxied
3. A ogni richiesta, verifica la firma e fa il fetch upstream con il proxy corretto

---

## 💻 Sviluppo locale

```bash
# Clona il repository
git clone https://github.com/tuoaccount/nello-stream.git
cd nello-stream

# Installa le dipendenze
npm install

# Copia il file d'esempio delle variabili d'ambiente
cp .env.example .env
# Modifica .env con i tuoi valori

# Avvia il server in modalità dev (auto-restart)
npm run dev

# Il server sarà su http://localhost:3000
# Testa: http://localhost:3000/health
# Configura: http://localhost:3000/configure
```

### Script disponibili

| Comando | Descrizione |
|:--------|:------------|
| `npm start` | Avvia il server |
| `npm run dev` | Avvia con auto-restart (watch mode) |
| `npm run release` | Sync versione → README, CHANGELOG, dashboard + smoke test |
| `npm run test:vercel` | Test smoke sul deploy Vercel remoto |

---

## ❓ FAQ / Risoluzione problemi

### L'addon non trova nessuno stream

- **Controlla il proxy:** senza un proxy funzionante, i siti bloccano le richieste. Verifica che `PROXY_URL` sia impostato e il proxy sia attivo.
- **Controlla il CF Worker:** senza il Worker, i siti Cloudflare-protected non rispondono. Verifica `CF_WORKER_URL` e `CF_WORKER_AUTH`.
- **Testa l'health endpoint:** apri `https://tuo-addon.vercel.app/health` e controlla che tutti i servizi risultino OK.

### "403 Forbidden" o "Access Denied"

Il sito target sta bloccando la richiesta. Cause:
- Proxy non funzionante o bloccato → prova un proxy diverso su WebShare
- CF Worker non configurato → verifica che il KV binding `ES_CACHE` sia collegato
- Il sito ha cambiato dominio → il cron del CF Worker lo aggiornerà automaticamente (ogni 6h)

### I K-Drama non mostrano sottotitoli

- I sottotitoli KissKH vengono decriptati e serviti dal CF Worker KV
- Verifica che `CF_WORKER_URL` sia raggiungibile
- I sottotitoli vengono pre-caricati tramite warm script — la prima volta potrebbe servire tempo

### StreamingCommunity non funziona

StreamingCommunity richiede MediaFlow Proxy. Imposta `MFP_URL` e `MFP_API_PASSWORD` ([vedi sopra](#-configurazione-mediaflow-proxy-opzionale)).

### Il deploy Vercel fallisce

- Verifica di aver impostato **tutte** le variabili obbligatorie
- Controlla i log in **Deployments → ultimo deploy → Function Logs**
- Prova un **Redeploy** dopo aver corretto le variabili

### Render/Koyeb è molto lento alla prima richiesta

Il piano free di Render spegne il server dopo 15 min di inattività. La prima richiesta dopo lo sleep richiede ~30 secondi. Koyeb non ha questo problema (piano free sempre attivo).

### Posso usare più CF Worker per load balancing?

Sì. Crea più Worker su account diversi e usa:
- `CF_WORKER_URLS=https://worker1.dev,https://worker2.dev,https://worker3.dev`
- `CF_WORKER_AUTHS=token1,token2,token3`

L'addon distribuirà automaticamente le richieste tra i Worker.

---

## 📝 Licenza

MIT
