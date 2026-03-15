'use strict';

/**
 * Shared HTTP fetcher utilities
 * Provides:
 *   - fetchWithCloudscraper(): for sites behind Cloudflare (ramaorientalfansub.live)
 *   - fetchWithAxios():        for plain HTTPS endpoints (kisskh.co API)
 *   - withTimeout():           generic promise timeout wrapper
 *   - getProxyAgent():         returns HttpsProxyAgent if PROXY_URL env is set
 *
 * Proxy support:
 *   Set PROXY_URL env variable to a proxy URL, e.g.:
 *   - http://user:pass@host:port
 *   - socks5://user:pass@host:port
 *   This is required when deploying on Vercel/AWS (IPs blocked by Cloudflare on target sites).
 */

const cloudscraper = require('cloudscraper');
const axios = require('axios');
const { createLogger } = require('./logger');

const log = createLogger('fetcher');

// Lazy-load to avoid circular deps
let _antiban = null;
function _getAntiban() {
  if (!_antiban) { try { _antiban = require('./antiban'); } catch { _antiban = null; } }
  return _antiban;
}
let _failover = null;
function _getFailover() {
  if (!_failover) { try { _failover = require('../domain-failover/failover'); } catch { _failover = null; } }
  return _failover;
}

function _extractHost(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// ─── Proxy support ────────────────────────────────────────────────────────────

const _agentCache = new Map();

/**
 * Create (or retrieve cached) HttpsProxyAgent for any given proxy URL.
 * Used for per-request proxy (from user config) or env-var proxy.
 * @param {string} proxyUrl
 * @returns {object|null}
 */
function makeProxyAgent(proxyUrl) {
  const url = (proxyUrl || '').trim();
  if (!url) return null;
  if (_agentCache.has(url)) return _agentCache.get(url);
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const agent = new HttpsProxyAgent(url);
    _agentCache.set(url, agent);
    log.info('Proxy agent created', { url: url.replace(/:[^:@]+@/, ':***@') });
    return agent;
  } catch (e) {
    log.warn('https-proxy-agent not available');
    return null;
  }
}

/** Proxy agent from PROXY_URL env var (legacy fallback). */
function getProxyAgent() {
  return makeProxyAgent((process.env.PROXY_URL || '').trim());
}

// ─── User agents ─────────────────────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; SM-S928U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Fetch HTML via cloudscraper (bypasses basic Cloudflare JS challenges).
 * @param {string} url
 * @param {object}  [opts]
 * @param {number}  [opts.retries=3]
 * @param {number}  [opts.timeout=12000]   Per-attempt timeout ms
 * @param {number}  [opts.retryDelay=2000]
 * @param {string}  [opts.referer]
 * @returns {Promise<string|null>}
 */
async function fetchWithCloudscraper(url, { retries = 3, timeout = 12_000, retryDelay = 2_000, referer, proxyUrl, clientIp } = {}) {
  // Per-request proxyUrl overrides env var
  const effectiveProxy = (proxyUrl || process.env.PROXY_URL || '').trim() || null;
  const antiban = _getAntiban();
  const failover = _getFailover();
  const host = _extractHost(url);

  // Use antiban headers if available
  const antibanHeaders = antiban ? antiban.getRandomHeaders(url) : {};

  for (let attempt = 1; attempt <= retries; attempt++) {
    // Anti-ban throttle (per-host delay)
    if (antiban) await antiban.throttle(url);

    const startMs = Date.now();
    try {
      log.debug(`Attempt ${attempt}/${retries} — ${url}`);
      const reqOpts = {
        uri: url,
        headers: {
          ...antibanHeaders,
          'Referer': referer || url,
          ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
        },
        followAllRedirects: true,
        maxRedirects: 3,
        timeout,
        resolveWithFullResponse: true,
      };
      if (effectiveProxy) reqOpts.proxy = effectiveProxy;

      const response = await cloudscraper.get(reqOpts);

      if (response.statusCode === 404) {
        log.warn(`404 not found — ${url}`);
        if (antiban) antiban.release(url);
        return null;
      }
      if (response.statusCode >= 200 && response.statusCode < 300) {
        log.debug(`OK ${response.statusCode} — ${url}`);
        if (failover && host) failover.recordSuccess(host, url, Date.now() - startMs);
        if (antiban) { antiban.resetBackoff(url); antiban.release(url); }
        return response.body;
      }
      // Ban detection (429/403)
      if (antiban && (response.statusCode === 429 || response.statusCode === 403)) {
        antiban.handleBanResponse(url, response.statusCode);
      }
      if (failover && host) failover.recordFailure(host, url, `HTTP ${response.statusCode}`);
      log.warn(`HTTP ${response.statusCode} — ${url}, retrying`);
      if (antiban) antiban.release(url);
      await _sleep(retryDelay);
    } catch (err) {
      if (failover && host) failover.recordFailure(host, url, err.message);
      if (antiban) antiban.release(url);
      log.warn(`Error attempt ${attempt}/${retries}: ${err.message}`, { url });
      const delay = err.message.toLowerCase().includes('cloudflare') ? 10_000 : retryDelay;
      if (attempt < retries) await _sleep(delay);
    }
  }
  log.error(`All ${retries} attempts failed — ${url}`);
  return null;
}

/**
 * Fetch JSON / text via axios (proxy-aware).
 * @param {string} url
 * @param {object} [opts]
 * @param {object} [opts.headers]
 * @param {number} [opts.timeout=10000]
 * @param {'json'|'text'|'arraybuffer'} [opts.responseType='json']
 * @param {number} [opts.retries=2]
 * @returns {Promise<any|null>}
 */
async function fetchWithAxios(url, { headers = {}, timeout = 10_000, responseType = 'json', retries = 2, proxyUrl, clientIp } = {}) {
  const antiban = _getAntiban();
  const failover = _getFailover();
  const host = _extractHost(url);
  const antibanHeaders = antiban ? antiban.getRandomHeaders(url) : {};

  const mergedHeaders = {
    ...antibanHeaders,
    'Accept': 'application/json, text/plain, */*',
    ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
    ...headers,
  };
  // Per-request proxyUrl overrides env var
  const proxyAgent = proxyUrl ? makeProxyAgent(proxyUrl) : getProxyAgent();
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (antiban) await antiban.throttle(url);
    const startMs = Date.now();
    try {
      const { data } = await axios.get(url, {
        headers: mergedHeaders,
        timeout,
        responseType,
        ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent, proxy: false } : {}),
      });
      if (failover && host) failover.recordSuccess(host, url, Date.now() - startMs);
      if (antiban) { antiban.resetBackoff(url); antiban.release(url); }
      return data;
    } catch (err) {
      if (failover && host) failover.recordFailure(host, url, err.message);
      if (antiban) {
        const status = err.response?.status;
        if (status === 429 || status === 403) antiban.handleBanResponse(url, status);
        antiban.release(url);
      }
      log.warn(`axios attempt ${attempt}/${retries}: ${err.message}`, { url });
      if (attempt < retries) await _sleep(2_000);
    }
  }
  log.error(`axios failed after ${retries} attempts — ${url}`);
  return null;
}

/**
 * Wrap a promise with a timeout.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [label]
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label = 'operation') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms — ${label}`)), ms);
    promise
      .then(v => { clearTimeout(timer); resolve(v); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { fetchWithCloudscraper, fetchWithAxios, withTimeout, randomUA, getProxyAgent, makeProxyAgent };
