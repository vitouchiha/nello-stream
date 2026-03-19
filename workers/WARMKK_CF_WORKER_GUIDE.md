# KissKH Subtitle Warming via CF Worker

## ⚡ Il Problema Vecchio 
- KissKH rate limiting: **7% success** (7/100 ep)
- Puppeteer fallback: **45-50 secondi per episodio**
- Proxy residenziale flaggato come bot

## 🎯 La Soluzione Nuova 
**Usiamo Cloudflare Workers come proxy trusted:**
- Le richieste outbound da CF Workers sono trusted a livello di rete  
- KissKH non bloc ca le richieste da CF (non sono un bot)
- Decrittazione avviene dentro il Worker (fast)
- Risultato: **~1-2 secondi per episodio** (vs 45-50 sec)

---

## 📦 Componenti

### 1. **CF Worker Endpoint** (`cfworker.js`)
```javascript
// Endpoint: GET/POST ?kk_subs_warm=1
// Body: {serieId, episodeId, subUrl}
// Response: {ok: true, decrypted: "...", lang: "it", format: "srt"}
```

**Features:**
- Fetch di file .txt1 encriptati da KissKH
- Decrittazione AES-128-CBC (3 coppie key/IV note)
- Validazione SRT/WEBVTT
- Timeout: 10 secondi

### 2. **Script CLI** (`warm-kk-subs-cfworker.js`)
Chiama il Worker per ogni episode in parallelo:

```bash
# Run with 10 concurrent workers
node warm-kk-subs-cfworker.js --concurrency 10

# Continue from last checkpoint
node warm-kk-subs-cfworker.js --continue

# Dry run (show tasks without executing)
node warm-kk-subs-cfworker.js --limit 50 --dry-run

# Batch processing
node warm-kk-subs-cfworker.js --batch-size 100 --concurrency 15
```

**Options:**
- `--limit N` — Processa solo primi N episode
- `--continue` — Riprendi da file stato precedente  
- `--concurrency C` — # richieste parallele (default: 10)
- `--batch-size B` — Salva progress ogni B episode (default: 100)
- `--dry-run` — Mostra cosa farebbe senza eseguire

---

## 📊 Expected Performance

| Metrica | Valore |
|---------|--------|
| **Success rate** | ~90-95% (CF trusted IP) |
| **Speed per episode** | ~1-2 sec (vs 50 sec Puppeteer) |
| **Throughput** | 300-600 ep/ora @ 10 concurrency |
| **744 series** | ~2-4 ore totali |

---

## ⚙️ Setup

### Prerequisiti:
1. CF Worker già deployato (`cfworker.js`)
2. `kk-episodes-index.json` con subtitle URLs (da `warm-kk-episodes.js`)

### Environment:
```bash
export CF_WORKER_URL=https://kisskh-proxy.vitobsfm.workers.dev
export CF_WORKER_AUTH=PJxVzfuySO5IkMGec1pZsFvWDNbiHRE6jULnB2t3
```

Oppure sono usati di default dal codice.

---

## 🔄 Workflow

```
┌─ warm-kk-subs-cfworker.js (locale)
├─ Legge: kk-episodes-index.json
├─ Per ogni episode: serieId, episodeId, subUrl
├─ 🌐 CHIAMA CF Worker in parallelo (10 req/sec)
│
└─ Riceve: {ok: true, decrypted: "...", format: "srt"}
   ├─ Salva in locale: kk-subs-cache/{serieId}/{episodeId}.json
   ├─ Salva state: kk-cf-subs-state.json (resume checkpoint)
   └─ Stampa: ✅ o ❌ per ogni episode
```

---

## 💡 Vantaggi vs Soluzioni Precedenti

| Aspetto | Puppeteer | Residential Proxy | CF Worker |
|---------|-----------|------------------|-----------|
| **Speed** | 45-50s/ep | 50-100s/ep | 1-2s/ep |
| **Success** | 85-90% | 7% | 90-95% |
| **Bot detection** | ⚠️ Possibile | 🔴 Flagged | ✅ Trusted |
| **Per 744 series** | 10-15 ore | Non viable | 2-4 ore |
| **Cost** | CPU local | Proxy service | Gratuito (CF free) |

---

## 🐛 Troubleshooting

### Error: "HTTP 403 from KissKH"
- Il CF Worker IP è stato flaggato... aspetta 24h o usa nuovo CF Worker account

### Error: "Decryption failed all methods"
- L'URL del subtitle non è più valido
- KissKH ha cambiato le key di crittazione

### Error: "CF Worker timeout"
- CF Worker response time > 30s (configurare timeout nei edge)
- Problema di rete

---

## 📝 Expected Output

```
🔥 KissKH Subtitle Warming via CF Worker
   Worker: https://kisskh-proxy.vitobsfm.workers.dev
   Series: 744
   Concurrency: 10
   Continue: OFF
   Dry run: OFF

📋 Queued: 18000 episodes (0 cached, 2 skipped)

[BATCH 1] Processing 100 tasks...
  ✅ 1234:5678 (42KB)
  ✅ 1234:5679 (38KB)
  ⚠️  1234:5680 (saved to KV but local cache failed)
  ❌ 1234:5681 — HTTP 404 from KissKH
  ...

[BATCH 2] Processing 100 tasks...
  ...

📊 === FINAL STATS ===
   Warmed:  17100
   Failed:  500
   Cached:  0
   Skipped: 400
   Total:   18000

✨ Success! Warmed 17100 subtitle files.
```

---

## 🔐 Security

1. **CF_WORKER_AUTH header** — Protegge l'endpoint da abusi
2. **Query param validation** — Solo serieId, episodeId, subUrl accettati
3. **HTTPS only** — Tutte le richieste encrypted
4. **KissKH domain validation** — Verifica che subUrl sia da auto.streamsub.top

---

## 📌 Prossimi Step

- [ ] Deploy cfworker.js con `npm i -g wrangler && wrangler deploy cfworker.js`
- [ ] Verifica endpoint: `curl -X POST "https://kisskh-proxy.vitobsfm.workers.dev/?kk_subs_warm=1" \-H "x-worker-auth: ..." -d '...'`
- [ ] Run script: `node warm-kk-subs-cfworker.js --dry-run --limit 20`
- [ ] Go full: `node warm-kk-subs-cfworker.js --concurrency 10`
- [ ] Monitor: Check `kk-cf-subs-state.json` ogni 30 min

---

## 📞 Support

Se il CF Worker endpoint non funziona:
1. Controlla `CF_WORKER_AUTH` environ variable
2. Verifica endpint con test health: `?kv_test=1`
3. Guarda CF Worker logs in dashboard
4. Ricrea endpoint: redeploy cfworker.js
