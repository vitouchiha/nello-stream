'use strict';

/**
 * Anti-Ban Module
 *
 * Prevents bans and rate-limiting from streaming providers by:
 *   - Per-host request throttling with configurable delays
 *   - Concurrency limiting per host
 *   - Extended User-Agent rotation (20+ realistic UAs)
 *   - Exponential back-off on 429/403 responses
 *   - Request fingerprint randomization (header ordering, accept variants)
 *   - Integration with domain failover on persistent blocks
 */

const { createLogger } = require('../utils/logger');
const sysConfig = require('../config/system');

const log = createLogger('anti-ban');

// ── Extended User-Agent Pool ──────────────────────────────────────────────────
// Realistic desktop + mobile UAs, updated to 2024/2025 versions
const USER_AGENTS = [
  // Chrome Desktop
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Firefox Desktop
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  // Edge Desktop
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  // Safari Desktop
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  // Chrome Mobile
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  // Safari Mobile
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  // Opera
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0',
];

// ── Per-Host State ────────────────────────────────────────────────────────────

/** @type {Map<string, { lastRequestAt: number, backoffMs: number, concurrent: number, queue: Function[] }>} */
const _hostState = new Map();

function _getHostState(host) {
  if (!_hostState.has(host)) {
    _hostState.set(host, {
      lastRequestAt: 0,
      backoffMs: 0,
      concurrent: 0,
      queue: [],
    });
  }
  return _hostState.get(host);
}

function _extractHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

// ── Throttling ────────────────────────────────────────────────────────────────

/**
 * Wait for the appropriate delay before making a request to a host.
 * Implements per-host throttling + concurrency limiting.
 *
 * @param {string} url  Target URL
 * @returns {Promise<void>}
 */
async function throttle(url) {
  if (!sysConfig.antiBan.throttleEnabled) return;

  const host = _extractHost(url);
  const state = _getHostState(host);
  const cfg = sysConfig.antiBan;

  // Concurrency check
  if (state.concurrent >= cfg.maxConcurrentPerHost) {
    await new Promise(resolve => {
      state.queue.push(resolve);
    });
  }

  // Delay check
  const now = Date.now();
  const minGap = cfg.minDelayMs + state.backoffMs;
  const elapsed = now - state.lastRequestAt;

  if (elapsed < minGap) {
    const jitter = Math.random() * (cfg.maxDelayMs - cfg.minDelayMs);
    const delay = Math.min(minGap - elapsed + jitter, cfg.maxBackoffMs);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  state.lastRequestAt = Date.now();
  state.concurrent++;
}

/**
 * Signal that a request to a host has completed.
 * @param {string} url
 */
function release(url) {
  const host = _extractHost(url);
  const state = _getHostState(host);
  state.concurrent = Math.max(0, state.concurrent - 1);

  // Process queue
  if (state.queue.length > 0) {
    const next = state.queue.shift();
    next();
  }
}

/**
 * Handle a ban-inducing response (429, 403).
 * Increases back-off for the host.
 * @param {string} url
 * @param {number} statusCode
 */
function handleBanResponse(url, statusCode) {
  const host = _extractHost(url);
  const state = _getHostState(host);
  const cfg = sysConfig.antiBan;

  if (statusCode === 429 || statusCode === 403) {
    state.backoffMs = Math.min(
      (state.backoffMs || cfg.minDelayMs) * cfg.backoffMultiplier,
      cfg.maxBackoffMs
    );
    log.warn('ban response — increasing backoff', {
      host,
      status: statusCode,
      backoffMs: state.backoffMs,
    });
  }
}

/**
 * Reset back-off for a host after successful requests.
 * @param {string} url
 */
function resetBackoff(url) {
  const host = _extractHost(url);
  const state = _getHostState(host);
  if (state.backoffMs > 0) {
    state.backoffMs = Math.max(0, state.backoffMs / 2);
  }
}

// ── UA Rotation ───────────────────────────────────────────────────────────────

let _uaIndex = Math.floor(Math.random() * USER_AGENTS.length);

/**
 * Get a random User-Agent string.
 * Uses round-robin with randomized start to distribute evenly.
 * @returns {string}
 */
function getRandomUA() {
  const ua = USER_AGENTS[_uaIndex % USER_AGENTS.length];
  _uaIndex++;
  return ua;
}

/**
 * Get a UA that's consistent for a given host within the same invocation.
 * Makes request fingerprint more realistic (same browser for same site).
 * @param {string} host
 * @returns {string}
 */
const _hostUAMap = new Map();
function getConsistentUA(host) {
  if (_hostUAMap.has(host)) return _hostUAMap.get(host);
  const ua = getRandomUA();
  _hostUAMap.set(host, ua);
  return ua;
}

// ── Header Randomization ──────────────────────────────────────────────────────

const ACCEPT_VARIANTS = [
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
];

const ACCEPT_LANGUAGE_VARIANTS = [
  'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  'it-IT,it;q=0.9,en;q=0.8',
  'it;q=0.9,en-US;q=0.8,en;q=0.7',
  'it-IT,it;q=0.8,en-US;q=0.5,en;q=0.3',
];

/**
 * Generate randomized browser-like headers.
 * @param {string} [url]  Target URL for host-consistent UA
 * @returns {object}
 */
function getRandomHeaders(url) {
  const host = url ? _extractHost(url) : '';
  const ua = host ? getConsistentUA(host) : getRandomUA();

  return {
    'User-Agent': ua,
    'Accept': ACCEPT_VARIANTS[Math.floor(Math.random() * ACCEPT_VARIANTS.length)],
    'Accept-Language': ACCEPT_LANGUAGE_VARIANTS[Math.floor(Math.random() * ACCEPT_LANGUAGE_VARIANTS.length)],
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'sec-ch-ua': `"Chromium";v="12${4 + Math.floor(Math.random() * 2)}", "Not-A.Brand";v="99"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Wrap a fetch call with anti-ban protections:
 * throttle → execute → handle response → release.
 *
 * @param {string} url
 * @param {Function} fetchFn  async () => response
 * @returns {Promise<any>}
 */
async function protectedFetch(url, fetchFn) {
  await throttle(url);
  try {
    const result = await fetchFn();
    const status = result?.status || result?.statusCode || 200;
    if (status === 429 || status === 403) {
      handleBanResponse(url, status);
    } else if (status >= 200 && status < 400) {
      resetBackoff(url);
    }
    return result;
  } finally {
    release(url);
  }
}

/**
 * Get current throttle state for monitoring.
 */
function getThrottleStats() {
  const stats = {};
  for (const [host, state] of _hostState) {
    stats[host] = {
      backoffMs: state.backoffMs,
      concurrent: state.concurrent,
      queued: state.queue.length,
      lastRequestAt: state.lastRequestAt ? new Date(state.lastRequestAt).toISOString() : null,
    };
  }
  return stats;
}

module.exports = {
  throttle,
  release,
  handleBanResponse,
  resetBackoff,
  getRandomUA,
  getConsistentUA,
  getRandomHeaders,
  protectedFetch,
  getThrottleStats,
  USER_AGENTS,
};
