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

// ── Express Route Factory ─────────────────────────────────────────────────────

/**
 * Create Express middleware for cron authentication.
 */
function cronAuth(req, res, next) {
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
  cronAuth,
};
