# ── StreamFusion Mail — Dockerfile ──────────────────────────────────────────
# Node 18 LTS su Debian Bookworm (slim) con Chromium per Puppeteer.
# Usato principalmente via docker-compose.yml con Gluetun VPN.

FROM node:18-bookworm-slim

# ── Chromium + dipendenze audio/grafica per headless ─────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-freefont-ttf \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libc6 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libgcc1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libstdc++6 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      ca-certificates \
      dumb-init \
      wget \
    && rm -rf /var/lib/apt/lists/*

# ── Utente non-root per sicurezza ─────────────────────────────────────────────
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads /app/data /app/cache \
    && chown -R appuser:appuser /home/appuser /app

# ── Cartella di lavoro ────────────────────────────────────────────────────────
WORKDIR /app

# ── Installa dipendenze (separato per cache layer) ────────────────────────────
COPY --chown=appuser:appuser package.json ./
RUN npm install --omit=dev --ignore-scripts 2>&1 | tail -5

# ── Copia codice sorgente ─────────────────────────────────────────────────────
COPY --chown=appuser:appuser . .

# ── Variabili d'ambiente ──────────────────────────────────────────────────────
ENV NODE_ENV=production \
    PORT=3000 \
    # Usa il Chromium di sistema (installato sopra)
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    # Necessario per Puppeteer senza sandbox in container
    CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer"

# ── Espone la porta dell'addon ────────────────────────────────────────────────
EXPOSE 3000

# ── Avvio con dumb-init (gestione segnali corretta) ──────────────────────────
USER appuser
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]

# ── Health check ─────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
