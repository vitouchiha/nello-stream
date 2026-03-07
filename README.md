<div align="center">
  <img src="https://i.imgur.com/i7VdVv7.png" alt="Logo" width="100"/>
  <h1>?? StreamFusion Asian Drama</h1>
  <p><b>L'aggregatore definitivo di Drama Asiatici e Coreani per Stremio con Sottotitoli in Italiano.</b></p>
  <p>Ottimizzato per l'esecuzione gratuita su Serverless (Vercel, Koyeb) o VPS privata.</p>
</div>

---

## ? Features
* ???? Integra nativamente cataloghi da **KissKH** e **Rama Oriental Fansub**.
* ?? Scraping Intelligente in Background: converte le release HTML in JSON compatibile Stremio on-the-fly.
* ?? Aggancio TMDB: Popola dinamicamente le locandine, gli attori e i metadati.
* ?? Cloudflare Bypass: Opzioni integrate per gestire Node-Fetch tramite Proxy esterni o FlareSolverr.
* ?? Pieno supporto a MediaFlow Proxy per il rilancio dei flussi HLS.

---

## ?? Guida al Deploy (Hosting Gratuito su Vercel)

Vercel è la soluzione consigliata: garantisce enormi velocità e assenza di manutenzione.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvitouchiha%2Fstreamfusion-mail&project-name=streamfusion-addon&repository-name=streamfusion-addon)

### Come fare:
1. Clicca sul pulsante qui sopra.
2. Collega il tuo account GitHub e premi Deploy.
3. Attendi la spunta di fine compilazione (circa 15 secondi).
4. Apri l'URL che ti è stato assegnato da Vercel (es. `https://nome-server.vercel.app`) per visualizzare l'interfaccia di configurazione!

---

## ?? Variabili d'Ambiente (Opzionali)

Puoi potenziare il tuo server proteggendolo dai blocchi IP usando le **Environment Variables**:

| Variabile | Descrizione |
|-----------|-------------|
| `PROXY_URL` | Un proxy nel formato `http://user:pass@host:port` usato dal server per aggirare blocchi geolocalizzati Cloudflare. |
| `FLARESOLVERR_URL` | L'URL del tuo endpoint FlareSolverr per bypassare i Captcha bot (Es: `https://flaresolverr.tuo-server.com`). |

---

### ?? Deploy in Locale o VPS (Docker)
Per usare l'addon nel proprio computer, è incluso il `docker-compose.yml`.

```bash
git clone https://github.com/vitouchiha/streamfusion-mail.git
cd streamfusion-mail
docker compose up -d
```

