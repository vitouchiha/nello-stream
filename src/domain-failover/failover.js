'use strict';

/**
 * Domain Failover Manager
 *
 * Tracks domain health per provider, automatically switches to backup domains
 * when the primary goes down, and recovers when the primary comes back.
 *
 * Architecture:
 *   - Each provider has a primary domain + optional alternatives
 *   - Health is tracked via success/failure counters + response times
 *   - After N consecutive failures, domain is marked DOWN for a cooldown period
 *   - Background health checks revalidate DOWN domains
 *   - Integrates with provider_urls.js (reads existing domain data)
 *   - Scores domains by speed + reliability → prefers the best one
 *
 * Usage:
 *   const failover = require('./domain-failover/failover');
 *   const url = failover.getBestDomain('guardoserie');
 *   // ... make request ...
 *   failover.recordSuccess('guardoserie', url, responseTimeMs);
 *   // or on failure:
 *   failover.recordFailure('guardoserie', url, errorCode);
 */

const { createLogger } = require('../utils/logger');
const sysConfig = require('../config/system');
const { kvWriteAwait, kvRead } = require('../utils/cfWorkerPool');

const log = createLogger('failover');

// ── Domain Health Record ──────────────────────────────────────────────────────

/**
 * @typedef {Object} DomainHealth
 * @property {string} url            Base URL of the domain
 * @property {string} status         'up' | 'down' | 'degraded'
 * @property {number} consecutiveFails  Count of consecutive failures
 * @property {number} totalRequests  Total requests made
 * @property {number} totalSuccess   Total successful requests
 * @property {number} avgResponseMs  Rolling average response time
 * @property {number} lastCheckAt    Timestamp of last check
 * @property {number} downSince      Timestamp when marked down (0 = not down)
 * @property {number} score          Computed priority score (0-100)
 * @property {string} lastError      Last error message
 */

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {Map<string, DomainHealth[]>} provider → array of domain health records */
const _healthMap = new Map();

/** @type {Map<string, string[]>} provider → known alternative domains */
const _alternatives = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function _newHealth(url) {
  return {
    url: url.replace(/\/+$/, ''),
    status: 'up',
    consecutiveFails: 0,
    totalRequests: 0,
    totalSuccess: 0,
    avgResponseMs: 0,
    lastCheckAt: Date.now(),
    downSince: 0,
    score: 50,  // neutral starting score
    lastError: '',
  };
}

function _getOrCreateHealth(provider, url) {
  if (!_healthMap.has(provider)) {
    _healthMap.set(provider, []);
  }
  const list = _healthMap.get(provider);
  const normalized = url.replace(/\/+$/, '');
  let h = list.find(d => d.url === normalized);
  if (!h) {
    h = _newHealth(normalized);
    list.push(h);
  }
  return h;
}

function _computeScore(h) {
  const cfg = sysConfig.scoring;

  // Success rate (0-100)
  const successRate = h.totalRequests > 0
    ? (h.totalSuccess / h.totalRequests) * 100
    : 50;

  // Response time score: 0ms=100, 5000ms=0
  const rtScore = Math.max(0, 100 - (h.avgResponseMs / 50));

  // Freshness: how recently it was checked (decays over time)
  const age = Date.now() - h.lastCheckAt;
  const freshScore = Math.max(0, 100 - (age / cfg.decayPeriodMs) * 100);

  const totalWeight = cfg.responseTimeWeight + cfg.successRateWeight + cfg.freshnessWeight;
  const score = (
    (rtScore * cfg.responseTimeWeight) +
    (successRate * cfg.successRateWeight) +
    (freshScore * cfg.freshnessWeight)
  ) / totalWeight;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register alternative domains for a provider.
 * @param {string} provider  Provider name (e.g. 'guardoserie')
 * @param {string[]} urls    Array of base URLs
 */
function registerAlternatives(provider, urls) {
  const key = provider.toLowerCase();
  const cleaned = urls
    .map(u => u.replace(/\/+$/, ''))
    .filter(Boolean)
    .slice(0, sysConfig.domainFailover.maxAlternatives);
  _alternatives.set(key, cleaned);

  // Initialize health for all alternatives
  for (const url of cleaned) {
    _getOrCreateHealth(key, url);
  }
}

/**
 * Get the best available domain for a provider.
 * Falls back to the primary from provider_urls.js if no healthy alternatives exist.
 *
 * @param {string} provider  Provider name
 * @param {string} [primaryUrl]  Primary URL from provider_urls.js
 * @returns {string}  Best domain URL
 */
function getBestDomain(provider, primaryUrl) {
  const key = provider.toLowerCase();

  // Ensure primary is tracked
  if (primaryUrl) {
    _getOrCreateHealth(key, primaryUrl);
  }

  const list = _healthMap.get(key) || [];
  if (list.length === 0) return primaryUrl || '';

  const now = Date.now();
  const cfg = sysConfig.domainFailover;

  // Recalculate scores
  for (const h of list) {
    h.score = _computeScore(h);

    // Check if down domain can be retried
    if (h.status === 'down' && h.downSince > 0) {
      if (now - h.downSince >= cfg.cooldownMs) {
        h.status = 'degraded'; // allow retry
        h.consecutiveFails = 0;
        log.info('domain cooldown expired, retrying', { provider: key, domain: h.url });
      }
    }
  }

  // Sort by: up > degraded > down, then by score desc
  const statusOrder = { up: 0, degraded: 1, down: 2 };
  const sorted = [...list].sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.score - a.score;
  });

  // Pick first non-down domain
  for (const h of sorted) {
    if (h.status !== 'down') return h.url;
  }

  // All down → return highest-scored anyway (last resort)
  return sorted[0]?.url || primaryUrl || '';
}

/**
 * Record a successful request to a domain.
 * @param {string} provider
 * @param {string} url
 * @param {number} responseMs
 */
function recordSuccess(provider, url, responseMs = 0) {
  const h = _getOrCreateHealth(provider.toLowerCase(), url);
  h.totalRequests++;
  h.totalSuccess++;
  h.consecutiveFails = 0;
  h.lastCheckAt = Date.now();
  h.lastError = '';

  // Rolling average response time
  if (h.totalSuccess === 1) {
    h.avgResponseMs = responseMs;
  } else {
    h.avgResponseMs = Math.round(h.avgResponseMs * 0.8 + responseMs * 0.2);
  }

  if (h.status !== 'up') {
    log.info('domain recovered', { provider: provider.toLowerCase(), domain: url });
    h.status = 'up';
    h.downSince = 0;
  }

  h.score = _computeScore(h);
}

/**
 * Record a failed request to a domain.
 * @param {string} provider
 * @param {string} url
 * @param {string} [errorMsg]
 */
function recordFailure(provider, url, errorMsg = '') {
  const cfg = sysConfig.domainFailover;
  const h = _getOrCreateHealth(provider.toLowerCase(), url);
  h.totalRequests++;
  h.consecutiveFails++;
  h.lastCheckAt = Date.now();
  h.lastError = errorMsg;

  if (h.consecutiveFails >= cfg.maxFailures && h.status !== 'down') {
    h.status = 'down';
    h.downSince = Date.now();
    log.warn('domain marked DOWN', {
      provider: provider.toLowerCase(),
      domain: url,
      fails: h.consecutiveFails,
      error: errorMsg,
    });
  }

  h.score = _computeScore(h);
}

/**
 * Get health status for all tracked domains.
 * @returns {Object}
 */
function getHealthReport() {
  const report = {};
  for (const [provider, list] of _healthMap) {
    report[provider] = list.map(h => ({
      url: h.url,
      status: h.status,
      score: h.score,
      avgMs: h.avgResponseMs,
      successRate: h.totalRequests > 0
        ? Math.round((h.totalSuccess / h.totalRequests) * 100) + '%'
        : 'N/A',
      requests: h.totalRequests,
      consecutiveFails: h.consecutiveFails,
      lastError: h.lastError,
    }));
  }
  return report;
}

/**
 * Get health data for a specific provider.
 * @param {string} provider
 * @returns {DomainHealth[]|null}
 */
function getProviderHealth(provider) {
  return _healthMap.get(provider.toLowerCase()) || null;
}

/**
 * Run a health check on a specific URL.
 * @param {string} provider
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function healthCheck(provider, url) {
  const timeout = sysConfig.domainFailover.healthCheckTimeoutMs;
  const t0 = Date.now();

  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
    });
    const ms = Date.now() - t0;

    if (resp.ok || resp.status === 301 || resp.status === 302) {
      recordSuccess(provider, url, ms);
      return true;
    }
    recordFailure(provider, url, `HTTP ${resp.status}`);
    return false;
  } catch (err) {
    recordFailure(provider, url, err.message);
    return false;
  }
}

/**
 * Run health checks on all tracked down/degraded domains.
 * @returns {Promise<Object>}
 */
async function runHealthChecks() {
  const results = {};
  for (const [provider, list] of _healthMap) {
    for (const h of list) {
      if (h.status === 'down' || h.status === 'degraded') {
        const ok = await healthCheck(provider, h.url);
        results[`${provider}:${h.url}`] = ok;
      }
    }
  }
  return results;
}

// ── KV Persistence ────────────────────────────────────────────────────────────

/** Persist health data + alternatives to CF Worker KV (awaitable) */
async function persistToKv() {
  try {
    const data = { health: {}, alternatives: {} };

    for (const [provider, list] of _healthMap) {
      data.health[provider] = list.map(h => ({
        url: h.url, status: h.status, consecutiveFails: h.consecutiveFails,
        totalRequests: h.totalRequests, totalSuccess: h.totalSuccess,
        avgResponseMs: h.avgResponseMs, lastCheckAt: h.lastCheckAt,
        downSince: h.downSince, score: h.score, lastError: h.lastError,
      }));
    }

    for (const [provider, urls] of _alternatives) {
      data.alternatives[provider] = urls;
    }

    const ok = await kvWriteAwait('sfm_state', 'health', data);
    log.info('persisted health to KV', { providers: Object.keys(data.health).length, writesOk: ok });
  } catch (e) {
    log.warn('KV persist health failed', { error: e.message });
  }
}

/**
 * Load health data + alternatives from KV on cold start.
 * @returns {Promise<boolean>}
 */
async function loadFromKv() {
  try {
    const data = await kvRead('sfm_state', 'health');
    if (!data || typeof data !== 'object') return false;

    let loaded = 0;

    // Restore alternatives first
    if (data.alternatives) {
      for (const [provider, urls] of Object.entries(data.alternatives)) {
        if (Array.isArray(urls) && urls.length > 0) {
          _alternatives.set(provider, urls);
        }
      }
    }

    // Restore health records
    if (data.health) {
      for (const [provider, list] of Object.entries(data.health)) {
        if (!Array.isArray(list)) continue;
        const restored = [];
        for (const h of list) {
          if (!h.url) continue;
          restored.push({
            url: h.url, status: h.status || 'up',
            consecutiveFails: h.consecutiveFails || 0,
            totalRequests: h.totalRequests || 0,
            totalSuccess: h.totalSuccess || 0,
            avgResponseMs: h.avgResponseMs || 0,
            lastCheckAt: h.lastCheckAt || 0,
            downSince: h.downSince || 0,
            score: h.score || 50,
            lastError: h.lastError || '',
          });
        }
        if (restored.length > 0) {
          _healthMap.set(provider, restored);
          loaded++;
        }
      }
    }

    log.info('loaded health from KV', { providers: loaded, alternatives: _alternatives.size });
    return loaded > 0;
  } catch (e) {
    log.warn('KV load health failed', { error: e.message });
    return false;
  }
}

module.exports = {
  registerAlternatives,
  getBestDomain,
  recordSuccess,
  recordFailure,
  getHealthReport,
  getProviderHealth,
  healthCheck,
  runHealthChecks,
  persistToKv,
  loadFromKv,
};
