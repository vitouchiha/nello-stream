'use strict';

/**
 * CF Worker Pool — distributes requests across multiple Cloudflare Workers
 * to avoid per-account daily request limits.
 *
 * Config via env vars:
 *   CF_WORKER_URLS  = comma-separated list of worker base URLs
 *   CF_WORKER_AUTHS = comma-separated list of auth tokens (same order as URLs)
 *
 * Falls back to single CF_WORKER_URL / CF_WORKER_AUTH if *_URLS not set.
 *
 * Behavior:
 *   getProxyWorker()   → round-robin for proxy fetch operations (bulk traffic)
 *   getPrimaryWorker() → always first worker (for KV reads that need consistency)
 *   broadcastKvWrite() → fire-and-forget POST to ALL workers (KV data replication)
 */

const { createLogger } = require('./logger');
const log = createLogger('cf-pool');

let _workers = null; // [{ url, auth }]
let _rrIndex = 0;

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

/**
 * Round-robin worker for proxy operations (the bulk of traffic).
 * @returns {{ url: string, auth: string } | null}
 */
function getProxyWorker() {
  _init();
  if (_workers.length === 0) return null;
  const w = _workers[_rrIndex % _workers.length];
  _rrIndex = (_rrIndex + 1) % _workers.length;
  return w;
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

/** Reset pool (for testing) */
function _resetPool() {
  _workers = null;
  _rrIndex = 0;
}

module.exports = {
  getProxyWorker,
  getPrimaryWorker,
  getAllWorkers,
  broadcastKvWrite,
  poolSize,
  _resetPool,
};
