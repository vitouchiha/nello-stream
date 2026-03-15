'use strict';

/**
 * CF Worker Pool — distributes requests across multiple Cloudflare Workers
 * to avoid per-account daily request limits.
 *
 * Config via env vars:
 *   CF_WORKER_URLS  = comma-separated list of worker base URLs
 *   CF_WORKER_AUTHS = comma-separated list of auth tokens (same order as URLs)
 *   POOL_SMART_ROUTING = '1' to enable latency-based routing (default: true)
 *
 * Falls back to single CF_WORKER_URL / CF_WORKER_AUTH if *_URLS not set.
 *
 * Behavior:
 *   getProxyWorker()   → smart-routed or round-robin for proxy operations
 *   getPrimaryWorker() → always first worker (for KV reads that need consistency)
 *   broadcastKvWrite() → fire-and-forget POST to ALL workers (KV data replication)
 *   getWorkerHealth()  → per-worker latency and error tracking
 */

const { createLogger } = require('./logger');
const log = createLogger('cf-pool');

let _workers = null; // [{ url, auth }]
let _rrIndex = 0;

// ── Per-worker health tracking ────────────────────────────────────────────────
/** @type {Map<string, { avgMs: number, errors: number, requests: number, lastError: string, lastCheckAt: number }>} */
const _workerHealth = new Map();

function _getHealth(url) {
  if (!_workerHealth.has(url)) {
    _workerHealth.set(url, { avgMs: 0, errors: 0, requests: 0, lastError: '', lastCheckAt: 0 });
  }
  return _workerHealth.get(url);
}

function _init() {
  if (_workers) return;

  const urlsRaw = (process.env.CF_WORKER_URLS || '').trim();
  const authsRaw = (process.env.CF_WORKER_AUTHS || '').trim();

  if (urlsRaw) {
    const urls = urlsRaw.split(',').map(u => u.trim()).filter(Boolean);
    const auths = authsRaw ? authsRaw.split(',').map(a => a.trim()) : [];
    _workers = urls.map((url, i) => ({
      url: url.replace(/\/$/, ''),
      auth: auths[i] || auths[0] || '',  // fallback to first auth if not enough
    }));
  } else {
    // Fallback to single worker
    const url = (process.env.CF_WORKER_URL || '').trim();
    const auth = (process.env.CF_WORKER_AUTH || '').trim();
    _workers = url ? [{ url: url.replace(/\/$/, ''), auth }] : [];
  }

  if (_workers.length > 1) {
    log.info(`CF Worker pool: ${_workers.length} workers configured`);
  }
}

function _isSmartRoutingEnabled() {
  const v = (process.env.POOL_SMART_ROUTING || '').trim().toLowerCase();
  // Default to true unless explicitly disabled
  return v !== '0' && v !== 'false';
}

/**
 * Pick the best worker based on latency + error rate.
 * Falls back to round-robin if not enough data.
 */
function _smartPick() {
  _init();
  if (_workers.length <= 1) return _workers[0] || null;

  const MIN_SAMPLES = 3;
  const scored = _workers.map(w => {
    const h = _getHealth(w.url);
    if (h.requests < MIN_SAMPLES) return { w, score: -1 }; // not enough data
    const errorRate = h.requests > 0 ? h.errors / h.requests : 0;
    // Score: lower is better. Combines avg latency + error penalty
    const score = h.avgMs + (errorRate * 5000);
    return { w, score };
  });

  // If any worker lacks data, use round-robin to gather samples
  if (scored.some(s => s.score < 0)) {
    return _roundRobin();
  }

  // Pick worker with lowest score
  scored.sort((a, b) => a.score - b.score);
  return scored[0].w;
}

function _roundRobin() {
  _init();
  if (_workers.length === 0) return null;
  const w = _workers[_rrIndex % _workers.length];
  _rrIndex = (_rrIndex + 1) % _workers.length;
  return w;
}

/**
 * Get a proxy worker for the next request.
 * Uses smart routing if enabled and enough data, otherwise round-robin.
 * @returns {{ url: string, auth: string } | null}
 */
function getProxyWorker() {
  _init();
  if (_workers.length === 0) return null;
  if (_isSmartRoutingEnabled()) return _smartPick();
  return _roundRobin();
}

/**
 * Primary worker (first in list) for KV reads that need consistency.
 * @returns {{ url: string, auth: string } | null}
 */
function getPrimaryWorker() {
  _init();
  return _workers.length > 0 ? _workers[0] : null;
}

/**
 * All workers list — for broadcasting KV writes.
 * @returns {Array<{ url: string, auth: string }>}
 */
function getAllWorkers() {
  _init();
  return [..._workers];
}

/**
 * Fire-and-forget POST to ALL workers for KV replication.
 * @param {string} param  Query param name (e.g. 'kk_meta')
 * @param {string} key    Param value (e.g. '6700')
 * @param {*} data        JSON-serializable body
 */
function broadcastKvWrite(param, key, data) {
  _init();
  for (const w of _workers) {
    try {
      const u = new URL(w.url);
      u.searchParams.set(param, key);
      const headers = { 'Content-Type': 'application/json' };
      if (w.auth) headers['x-worker-auth'] = w.auth;
      fetch(u.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {}); // fire-and-forget
    } catch { /* skip invalid worker */ }
  }
}

/** Number of workers in the pool */
function poolSize() {
  _init();
  return _workers.length;
}

/**
 * Record a successful worker response (for smart routing).
 * @param {string} workerUrl
 * @param {number} responseMs
 */
function recordWorkerSuccess(workerUrl, responseMs) {
  const h = _getHealth(workerUrl);
  h.requests++;
  h.lastCheckAt = Date.now();
  if (h.requests === 1) {
    h.avgMs = responseMs;
  } else {
    h.avgMs = Math.round(h.avgMs * 0.7 + responseMs * 0.3);
  }
}

/**
 * Record a failed worker response (for smart routing).
 * @param {string} workerUrl
 * @param {string} [errorMsg]
 */
function recordWorkerFailure(workerUrl, errorMsg = '') {
  const h = _getHealth(workerUrl);
  h.requests++;
  h.errors++;
  h.lastError = errorMsg;
  h.lastCheckAt = Date.now();
}

/**
 * Get health stats for all workers.
 * @returns {Object}
 */
function getWorkerHealth() {
  _init();
  const report = {};
  for (const w of _workers) {
    const h = _getHealth(w.url);
    report[w.url.substring(0, 50)] = {
      avgMs: h.avgMs,
      requests: h.requests,
      errors: h.errors,
      errorRate: h.requests > 0 ? Math.round((h.errors / h.requests) * 100) + '%' : 'N/A',
      lastError: h.lastError || null,
    };
  }
  return report;
}

/** Reset pool (for testing) */
function _resetPool() {
  _workers = null;
  _rrIndex = 0;
  _workerHealth.clear();
}

module.exports = {
  getProxyWorker,
  getPrimaryWorker,
  getAllWorkers,
  broadcastKvWrite,
  poolSize,
  recordWorkerSuccess,
  recordWorkerFailure,
  getWorkerHealth,
  _resetPool,
};
