'use strict';

/**
 * StreamFusion Mail — Entry point
 *
 * Boots an Express server with Stremio-compatible routing.
 * Compatible with:
 *   - Local development:  node server.js
 *   - Vercel serverless:  exports `module.exports` as Express app
 *   - Docker:             node server.js (PORT env var)
 */

require('dotenv').config();

const express             = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const manifest            = require('./manifest.json');
const { handleCatalog, handleMeta, handleStream } = require('./src/providers/index');
const { createLogger }    = require('./src/utils/logger');

const log = createLogger('server');

// ─── Stremio Addon Builder ────────────────────────────────────────────────────

const builder = new addonBuilder(manifest);

// ── Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  log.info('catalog', { type, id, extra });
  try {
    return await handleCatalog(type, id, extra);
  } catch (err) {
    log.error(`catalogHandler: ${err.message}`, { type, id });
    return { metas: [] };
  }
});

// ── Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
  log.info('meta', { type, id });
  try {
    return await handleMeta(type, id);
  } catch (err) {
    log.error(`metaHandler: ${err.message}`, { type, id });
    return { meta: null };
  }
});

// ── Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  log.info('stream', { type, id });
  try {
    return await handleStream(type, id);
  } catch (err) {
    log.error(`streamHandler: ${err.message}`, { type, id });
    return { streams: [] };
  }
});

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

// CORS — required for Stremio clients
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Stremio SDK router
const addonRouter = getRouter(builder.getInterface());
app.use(addonRouter);

// Root landing page
app.get('/', (req, res) => {
  const host = req.protocol + '://' + req.get('host');
  const manifestUrl = encodeURIComponent(`${host}/manifest.json`);
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${manifest.name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f0f13;color:#eee;font-family:'Segoe UI',Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;padding:20px}
    h1{font-size:2rem;color:#7c6cfc}
    p{opacity:.75;max-width:500px;text-align:center;line-height:1.6}
    .badge{background:#7c6cfc;color:#fff;border-radius:6px;padding:4px 12px;font-size:.9rem}
    a.btn{display:inline-block;margin-top:10px;padding:12px 28px;border-radius:8px;background:#7c6cfc;color:#fff;text-decoration:none;font-weight:600;transition:opacity .2s}
    a.btn:hover{opacity:.85}
    code{background:#1c1c26;padding:6px 12px;border-radius:6px;font-size:.85rem;word-break:break-all;max-width:90vw;display:block;text-align:center}
  </style>
</head>
<body>
  <h1>🎬 ${manifest.name}</h1>
  <span class="badge">v${manifest.version}</span>
  <p>${manifest.description}</p>
  <code>${host}/manifest.json</code>
  <a class="btn" href="stremio://${req.get('host')}/manifest.json">Install on Stremio</a>
  <a class="btn" href="https://web.stremio.com/#/addons?addon=${manifestUrl}" style="background:#444">Install via Web</a>
  <p style="font-size:.8rem;margin-top:10px">Providers: Korean Drama (Rama) · Asian Drama (KissKH)</p>
</body>
</html>`);
});

// Health check endpoint (useful for Vercel / uptime monitors)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: manifest.version, ts: new Date().toISOString() });
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, _next) => {
  log.error(`Express error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;

// When run directly (node server.js) → bind to port
// When required as module (Vercel) → export the app
if (require.main === module) {
  app.listen(PORT, () => {
    log.info(`StreamFusion Mail running`, { port: PORT, manifest: `http://localhost:${PORT}/manifest.json` });
    console.log(`\n  ✅  StreamFusion Mail v${manifest.version}`);
    console.log(`  📡  http://localhost:${PORT}/manifest.json\n`);
  });
}

module.exports = app;
