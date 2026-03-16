'use strict';

/**
 * Cron Job Manager
 *
 * Unified orchestrator for all periodic tasks.
 * Each job runs independently, logs its execution, and reports status.
 *
 * Jobs:
 *   1. Domain health checks — verify provider domains, failover if needed
 *   2. Mirror scanning — discover new domain mirrors
 *   3. Cache warm-up — pre-populate popular catalog/stream caches
 *   4. Worker health — verify CF Worker pool health
 *
 * Exposed as Express routes mounted by server.js:
 *   GET /api/cron/domain-health
 *   GET /api/cron/mirror-scan
 *   GET /api/cron/cache-warm
 *   GET /api/cron/worker-health
 *   GET /api/cron/status
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('cron');

// ── Job Registry ──────────────────────────────────────────────────────────────

/** @type {Map<string, { name: string, handler: Function, lastRun: number, lastResult: any, lastDurationMs: number, runCount: number, errorCount: number }>} */
const _jobs = new Map();

/**
 * Register a cron job.
 * @param {string} name
 * @param {Function} handler  async () => { status, ... }
 */
function registerJob(name, handler) {
  _jobs.set(name, {
    name,
    handler,
    lastRun: 0,
    lastResult: null,
    lastDurationMs: 0,
    runCount: 0,
    errorCount: 0,
  });
}

/**
 * Execute a registered job.
 * @param {string} name
 * @returns {Promise<Object>}
 */
async function runJob(name) {
  const job = _jobs.get(name);
  if (!job) return { error: `Job '${name}' not found` };

  const t0 = Date.now();
  try {
    log.info(`cron job starting: ${name}`);
    const result = await job.handler();
    const ms = Date.now() - t0;
    job.lastRun = Date.now();
    job.lastResult = result;
    job.lastDurationMs = ms;
    job.runCount++;
    log.info(`cron job completed: ${name}`, { ms, status: result?.status || 'ok' });
    return { job: name, status: 'ok', ms, result };
  } catch (err) {
    const ms = Date.now() - t0;
    job.lastRun = Date.now();
    job.lastResult = { error: err.message };
    job.lastDurationMs = ms;
    job.runCount++;
    job.errorCount++;
    log.error(`cron job failed: ${name}`, { ms, error: err.message });
    return { job: name, status: 'error', ms, error: err.message };
  }
}

/**
 * Get status of all registered jobs.
 * @returns {Object}
 */
function getStatus() {
  const status = {};
  for (const [name, job] of _jobs) {
    status[name] = {
      lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : 'never',
      lastDurationMs: job.lastDurationMs,
      runCount: job.runCount,
      errorCount: job.errorCount,
      lastResult: job.lastResult,
    };
  }
  return status;
}

// ── Built-in Jobs ─────────────────────────────────────────────────────────────

// Domain Health Check
registerJob('domain-health', async () => {
  const failover = require('../domain-failover/failover');
  const results = await failover.runHealthChecks();
  const report = failover.getHealthReport();
  // Persist health data to KV after each check
  await failover.persistToKv();
  return {
    status: 'ok',
    checksRun: Object.keys(results).length,
    report,
  };
});

// Mirror Scanner
registerJob('mirror-scan', async () => {
  const scanner = require('../mirror-scanner/scanner');
  const results = await scanner.scanAll();
  return {
    status: 'ok',
    providers: Object.keys(results).length,
    totalMirrors: Object.values(results).reduce((acc, m) => acc + m.length, 0),
    results: Object.fromEntries(
      Object.entries(results).map(([k, v]) => [k, v.length])
    ),
  };
});

// Worker Health Check
registerJob('worker-health', async () => {
  const { getAllWorkers } = require('../utils/cfWorkerPool');
  const workers = getAllWorkers();
  const results = [];

  for (const w of workers) {
    const t0 = Date.now();
    try {
      const u = new URL(w.url);
      u.searchParams.set('kv_test', '1');
      const headers = {};
      if (w.auth) headers['x-worker-auth'] = w.auth;
      const resp = await fetch(u.toString(), {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      const data = await resp.json();
      results.push({
        url: w.url.substring(0, 50),
        status: resp.ok ? 'healthy' : 'degraded',
        ms: Date.now() - t0,
        kvOk: !!data?.read?.ok,
      });
    } catch (err) {
      results.push({
        url: w.url.substring(0, 50),
        status: 'down',
        ms: Date.now() - t0,
        error: err.message,
      });
    }
  }

  return {
    status: 'ok',
    workers: results.length,
    healthy: results.filter(r => r.status === 'healthy').length,
    results,
  };
});

// Cache Stats Report
registerJob('cache-stats', async () => {
  const cacheManager = require('../cache/cache_manager');
  return {
    status: 'ok',
    cache: cacheManager.getStats(),
  };
});

// Warm Uprot Cookies (captcha solve + KV persist)
registerJob('warm-uprot', async () => {
  const { getPrimaryWorker } = require('../utils/cfWorkerPool');
  const w = getPrimaryWorker();
  if (!w) return { status: 'skip', reason: 'no worker' };

  // Check if KV cookies are still valid
  try {
    const headers = {};
    if (w.auth) headers['x-worker-auth'] = w.auth;
    const kvResp = await fetch(`${w.url}/?uprot_kv=1&auth=${encodeURIComponent(w.auth || '')}`, {
      headers, signal: AbortSignal.timeout(8000),
    });
    if (kvResp.ok) {
      const kvData = await kvResp.json();
      const kvAge = kvData.t ? Math.round((Date.now() - kvData.t) / 60000) : null;
      if (kvData.cookies?.PHPSESSID && kvAge !== null && kvAge < 18 * 60) {
        return { status: 'skip', reason: 'cookies still valid', ageMin: kvAge };
      }
    }
  } catch { /* KV check failed, proceed to solve */ }

  // Solve fresh captcha
  const { extractUprot } = require('../extractors/uprot');
  const start = Date.now();
  const result = await extractUprot('https://uprot.net/msf/r4hcq47tarq8');
  const elapsed = Math.round((Date.now() - start) / 1000);

  if (result && result.url) {
    return { status: 'ok', elapsed, url: result.url.substring(0, 60) };
  }
  throw new Error('captcha solve failed');
});

// Catalog Warm-up: pre-warm popular catalog pages for all providers
registerJob('catalog-warm', async () => {
  const cacheManager = require('../cache/cache_manager');
  const stats = { providers: 0, cached: 0, errors: 0 };

  // Trigger getCatalog(0) for each provider that has .gz — this loads
  // the .gz cache into RAM and populates L1/L2 cache layers.
  const providers = [
    { name: 'kisskh', mod: () => require('../providers/kisskh') },
    { name: 'rama', mod: () => require('../providers/rama') },
  ];

  for (const p of providers) {
    try {
      const m = p.mod();
      if (m.getCatalog) {
        await m.getCatalog(0, '');
        stats.providers++;
        stats.cached++;
      }
    } catch (err) {
      stats.errors++;
      log.warn(`catalog-warm ${p.name} failed: ${err.message}`);
    }
  }

  return { status: 'ok', ...stats };
});

// ── GuardoSerie: push static titles index to CF Worker KV ─────────────────────
// The CF Worker cron can't scrape guardoserie.website (CF-to-CF 403), so Vercel
// pushes the pre-built gs-titles-index.json to all CF Workers instead.
registerJob('gs-index-push', async () => {
  const fs = require('fs');
  const path = require('path');
  const { getAllWorkers } = require('../utils/cfWorkerPool');

  const indexPath = path.resolve(__dirname, '..', '..', 'gs-titles-index.json');
  if (!fs.existsSync(indexPath)) return { status: 'skip', reason: 'no static index file' };

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const entries = Object.keys(index).length;
  if (entries === 0) return { status: 'skip', reason: 'empty index' };

  const workers = getAllWorkers();
  if (!workers || workers.length === 0) return { status: 'skip', reason: 'no CF Workers' };

  let pushed = 0;
  const body = JSON.stringify(index);
  for (const w of workers) {
    try {
      const u = new URL(w.url);
      u.searchParams.set('gs_titles', '1');
      const headers = { 'Content-Type': 'application/json' };
      if (w.auth) headers['x-worker-auth'] = w.auth;
      const resp = await fetch(u.toString(), {
        method: 'POST', headers, body,
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) pushed++;
    } catch { /* skip failed worker */ }
  }

  log.info(`gs-index-push: ${pushed}/${workers.length} workers updated (${entries} entries)`);
  return { status: 'ok', entries, pushed, total: workers.length };
});

// ── Internal Timers (Vercel Free: solo 2 cron, il resto gira con setInterval) ─

const _timers = [];

/**
 * Internal timer schedule — these jobs run via setInterval inside the process.
 * Vercel crons handle only warm-uprot (daily) and domain-health (daily).
 * All other jobs run internally at the intervals below.
 * External services (cron-job.org) can also call the HTTP endpoints as backup.
 */
const INTERNAL_SCHEDULE = [
  { name: 'domain-health',  intervalMs: 10 * 60 * 1000 },   // every 10 min
  { name: 'worker-health',  intervalMs: 30 * 60 * 1000 },   // every 30 min
  { name: 'cache-stats',    intervalMs: 3 * 60 * 60 * 1000 }, // every 3 hours
  { name: 'mirror-scan',    intervalMs: 6 * 60 * 60 * 1000 }, // every 6 hours
  { name: 'catalog-warm',   intervalMs: 2 * 60 * 60 * 1000 }, // every 2 hours
  { name: 'gs-index-push',  intervalMs: 24 * 60 * 60 * 1000 }, // every 24 hours
];

/**
 * Start internal timers for jobs not covered by Vercel crons.
 * Call once from server.js after app is ready.
 */
function startTimers() {
  if (_timers.length > 0) return; // already started

  for (const { name, intervalMs } of INTERNAL_SCHEDULE) {
    if (!_jobs.has(name)) continue;
    const id = setInterval(() => {
      runJob(name).catch(err => log.error(`timer ${name} error:`, err.message));
    }, intervalMs);
    id.unref(); // don't prevent process exit
    _timers.push({ name, id, intervalMs });
    log.info(`internal timer started: ${name} every ${Math.round(intervalMs / 60000)}min`);
  }

  // Load persisted state from KV, then run domain-health
  loadStateFromKv()
    .then(() => runJob('domain-health'))
    .catch(err => log.warn('boot KV load or health check failed:', err.message));
}

/**
 * Load mirrors + health data from CF Worker KV on cold start.
 * Should run before first health check so we start with known state.
 */
async function loadStateFromKv() {
  const failover = require('../domain-failover/failover');
  const scanner = require('../mirror-scanner/scanner');

  const t0 = Date.now();
  const [healthOk, mirrorsOk] = await Promise.all([
    failover.loadFromKv(),
    scanner.loadFromKv(),
  ]);
  const ms = Date.now() - t0;

  log.info('KV state loaded on boot', { healthOk, mirrorsOk, ms });
  return { healthOk, mirrorsOk, ms };
}

// ── Express Route Factory ─────────────────────────────────────────────────────

/**
 * Create Express middleware for cron authentication.
 */
function cronAuth(req, res, next) {
  // Vercel Cron adds this header on scheduled invocations.
  // Allow it so platform-triggered jobs work without exposing CRON_SECRET in URL.
  const vercelCron = String(req.get('x-vercel-cron') || '').trim();
  if (vercelCron === '1') return next();

  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (cronSecret) {
    const provided = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const queryToken = (req.query.token || '').trim();
    if (provided !== cronSecret && queryToken !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
}

/**
 * Mount cron routes onto an Express app.
 * @param {import('express').Application} app
 */
function mountRoutes(app) {
  // Individual job triggers
  for (const name of _jobs.keys()) {
    app.get(`/api/cron/${name}`, cronAuth, async (req, res) => {
      const result = await runJob(name);
      const status = result.status === 'error' ? 500 : 200;
      res.status(status).json(result);
    });
  }

  // Status overview
  app.get('/api/cron/status', cronAuth, (req, res) => {
    res.json({
      jobs: getStatus(),
      ts: new Date().toISOString(),
    });
  });

  log.info(`cron routes mounted: ${[..._jobs.keys()].join(', ')}`);
}

module.exports = {
  registerJob,
  runJob,
  getStatus,
  mountRoutes,
  startTimers,
  cronAuth,
};
