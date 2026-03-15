'use strict';

/**
 * Centralized System Configuration
 * All tunable parameters for cache, failover, anti-ban, cron, and scoring.
 * Override any value via environment variables.
 */

function envInt(key, fallback) {
  const v = (process.env[key] || '').trim();
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(key, fallback) {
  const v = (process.env[key] || '').trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key, fallback) {
  const v = (process.env[key] || '').trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return fallback;
}

module.exports = {
  // ── Cache ────────────────────────────────────────────────────────────────
  cache: {
    /** In-memory LRU max entries */
    memoryMaxSize: envInt('CACHE_MEMORY_MAX', 2000),
    /** Default TTL for streams (ms) */
    streamTtl: envInt('CACHE_STREAM_TTL', 15 * 60_000),
    /** Default TTL for catalogs (ms) */
    catalogTtl: envInt('CACHE_CATALOG_TTL', 60 * 60_000),
    /** Default TTL for TMDB metadata (ms) */
    tmdbTtl: envInt('CACHE_TMDB_TTL', 24 * 60 * 60_000),
    /** Default TTL for domain health data (ms) */
    domainHealthTtl: envInt('CACHE_DOMAIN_HEALTH_TTL', 5 * 60_000),
    /** Enable KV persistence layer */
    kvPersistEnabled: envBool('CACHE_KV_PERSIST', true),
    /** Stale-while-revalidate multiplier */
    staleMultiplier: envFloat('CACHE_STALE_MULTIPLIER', 3),
    /** Stale-if-error multiplier */
    staleErrorMultiplier: envFloat('CACHE_STALE_ERROR_MULTIPLIER', 6),
  },

  // ── Domain Failover ──────────────────────────────────────────────────────
  domainFailover: {
    /** Max consecutive failures before marking domain as down */
    maxFailures: envInt('DOMAIN_MAX_FAILURES', 3),
    /** Cooldown period for a failed domain (ms) */
    cooldownMs: envInt('DOMAIN_COOLDOWN_MS', 5 * 60_000),
    /** Timeout for domain health checks (ms) */
    healthCheckTimeoutMs: envInt('DOMAIN_HEALTH_TIMEOUT', 8_000),
    /** Interval between health-check sweeps (ms) */
    healthCheckIntervalMs: envInt('DOMAIN_HEALTH_INTERVAL', 60_000),
    /** Max alternative domains to store per provider */
    maxAlternatives: envInt('DOMAIN_MAX_ALTERNATIVES', 5),
  },

  // ── Anti-Ban ─────────────────────────────────────────────────────────────
  antiBan: {
    /** Min delay between requests to same host (ms) */
    minDelayMs: envInt('ANTIBAN_MIN_DELAY', 200),
    /** Max delay between requests to same host (ms) */
    maxDelayMs: envInt('ANTIBAN_MAX_DELAY', 800),
    /** Back-off multiplier on 429/403 */
    backoffMultiplier: envFloat('ANTIBAN_BACKOFF_MULT', 2.0),
    /** Max back-off delay (ms) */
    maxBackoffMs: envInt('ANTIBAN_MAX_BACKOFF', 30_000),
    /** Enable per-host request throttling */
    throttleEnabled: envBool('ANTIBAN_THROTTLE', true),
    /** Max concurrent requests per host */
    maxConcurrentPerHost: envInt('ANTIBAN_MAX_CONCURRENT', 3),
  },

  // ── Mirror Scanner ──────────────────────────────────────────────────────
  mirrorScanner: {
    /** Interval between full scans (ms) */
    scanIntervalMs: envInt('MIRROR_SCAN_INTERVAL', 30 * 60_000),
    /** Timeout for each mirror check (ms) */
    checkTimeoutMs: envInt('MIRROR_CHECK_TIMEOUT', 5_000),
    /** Max mirrors to check per provider */
    maxMirrorsPerProvider: envInt('MIRROR_MAX_PER_PROVIDER', 3),
  },

  // ── Domain Priority Scoring ─────────────────────────────────────────────
  scoring: {
    /** Weight for response time score (0-1) */
    responseTimeWeight: envFloat('SCORE_RT_WEIGHT', 0.4),
    /** Weight for success rate score (0-1) */
    successRateWeight: envFloat('SCORE_SUCCESS_WEIGHT', 0.4),
    /** Weight for freshness/uptime score (0-1) */
    freshnessWeight: envFloat('SCORE_FRESH_WEIGHT', 0.2),
    /** Min samples before score is reliable */
    minSamples: envInt('SCORE_MIN_SAMPLES', 5),
    /** Score decay period (ms) — older samples weigh less */
    decayPeriodMs: envInt('SCORE_DECAY_MS', 60 * 60_000),
  },

  // ── CF Worker Pool ──────────────────────────────────────────────────────
  workerPool: {
    /** Enable smart routing (prefer faster/healthier workers) */
    smartRouting: envBool('POOL_SMART_ROUTING', true),
    /** Health check interval for workers (ms) */
    healthCheckMs: envInt('POOL_HEALTH_CHECK_MS', 2 * 60_000),
    /** Request timeout for worker calls (ms) */
    workerTimeoutMs: envInt('POOL_WORKER_TIMEOUT', 15_000),
    /** Max retries on worker failure */
    maxRetries: envInt('POOL_MAX_RETRIES', 2),
  },

  // ── Cron ─────────────────────────────────────────────────────────────────
  cron: {
    /** Domain health check cron expression */
    domainHealthCron: process.env.CRON_DOMAIN_HEALTH || '*/5 * * * *',
    /** Mirror scanner cron expression */
    mirrorScanCron: process.env.CRON_MIRROR_SCAN || '*/30 * * * *',
    /** Cache warm-up cron expression */
    cacheWarmCron: process.env.CRON_CACHE_WARM || '*/15 * * * *',
  },

  // ── Vercel ──────────────────────────────────────────────────────────────
  vercel: {
    /** Serverless function timeout (ms) */
    serverlessTimeout: envInt('SERVERLESS_TIMEOUT', 50_000),
    /** Edge cache max-age for catalog results (s) */
    catalogCacheAge: envInt('VERCEL_CATALOG_CACHE_AGE', 300),
    /** Edge cache max-age for stream results (s) */
    streamCacheAge: envInt('VERCEL_STREAM_CACHE_AGE', 120),
    /** Edge cache max-age for meta results (s) */
    metaCacheAge: envInt('VERCEL_META_CACHE_AGE', 1800),
  },
};
