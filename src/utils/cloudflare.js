'use strict';

/**
 * Cloudflare bypass helper — obtains cf_clearance cookie for kisskh.co
 * Uses puppeteer-extra + stealth plugin.
 * Cookie is cached in memory (configurable TTL) and optionally persisted to
 * data/cf_cookie.json for reuse across cold starts.
 */

const { launchBrowser } = require('./browser');
const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('./logger');

const log = createLogger('cloudflare');

const KISSKH_TARGET = 'https://kisskh.co/';
const COOKIE_FILE = path.join(process.cwd(), 'data', 'cf_cookie.json');
const COOKIE_TTL = Number(process.env.CF_COOKIE_MAX_AGE) || 3_600_000;    // 1 h
const MAX_RETRIES = Number(process.env.CF_MAX_RETRY) || 3;
const RETRY_DELAY = Number(process.env.CF_RETRY_DELAY) || 5_000;

/** @type {Map<string, {value: string, ts: number}>} */
const _memCache = new Map();

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns "cf_clearance=<value>" string for kisskh.co.
 * Falls back to empty string (not all kisskh endpoints require it).
 *
 * Priority:
 *   1. CF_CLEARANCE_KISSKH env var (set manually from a real browser session)
 *   2. Memory cache
 *   3. Disk cache
 *   4. Puppeteer fetch (may fail if CF blocks Browserless datacenter IP)
 *
 * To get a valid cookie:
 *   - Open https://kisskh.co in your real browser
 *   - Open DevTools → Application → Cookies → kisskh.co
 *   - Copy the value of the "cf_clearance" cookie
 *   - Set it as CF_CLEARANCE_KISSKH env var on Vercel
 *   - CF clearance cookies typically last 30+ days
 *
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<string>}
 */
async function getCloudflareCookie(forceRefresh = false) {
  // 0. Manual env var — use directly, skip all browser logic
  const manualClearance = (process.env.CF_CLEARANCE_KISSKH || '').trim();
  if (manualClearance && !forceRefresh) {
    const cookieStr = manualClearance.startsWith('cf_clearance=')
      ? manualClearance
      : `cf_clearance=${manualClearance}`;
    log.debug('using CF_CLEARANCE_KISSKH from env');
    // Warm the memory cache so repeated calls are instant
    if (!_isCachedValid()) {
      _memCache.set('cf', { value: cookieStr, ts: Date.now() });
    }
    return cookieStr;
  }

  // 1. Memory cache
  if (!forceRefresh && _isCachedValid()) {
    log.debug('cookie from memory cache');
    return _memCache.get('cf').value;
  }

  // 2. Disk cache
  if (!forceRefresh) {
    const diskValue = await _loadFromDisk();
    if (diskValue) {
      _memCache.set('cf', { value: diskValue, ts: Date.now() });
      return diskValue;
    }
  }

  // 3. Fetch via Puppeteer with retry
  let lastErr;
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      const value = await _fetchCookie();
      _memCache.set('cf', { value, ts: Date.now() });
      await _saveToDisk(value);
      return value;
    } catch (err) {
      lastErr = err;
      log.warn(`CF cookie attempt ${i}/${MAX_RETRIES} failed: ${err.message}`);
      if (i < MAX_RETRIES) await _sleep(RETRY_DELAY * Math.pow(2, i - 1));
    }
  }

  log.error(`All CF cookie attempts failed: ${lastErr.message}`);
  return '';   // Return empty instead of throwing — some endpoints work without cookie
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function _isCachedValid() {
  const entry = _memCache.get('cf');
  return entry && (Date.now() - entry.ts) < COOKIE_TTL;
}

async function _loadFromDisk() {
  try {
    const raw = await fs.readFile(COOKIE_FILE, 'utf8');
    const { cf_clearance, timestamp } = JSON.parse(raw);
    if (cf_clearance && cf_clearance !== 'placeholder_value' && (Date.now() - Number(timestamp)) < COOKIE_TTL) {
      log.info('cookie loaded from disk');
      return `cf_clearance=${cf_clearance}`;
    }
    log.debug('disk cookie expired or invalid');
  } catch (_) {
    // No file or invalid JSON — expected on first run
  }
  return null;
}

async function _saveToDisk(cookieString) {
  try {
    const cf_clearance = cookieString.replace(/^cf_clearance=/, '');
    await fs.mkdir(path.dirname(COOKIE_FILE), { recursive: true });
    await fs.writeFile(COOKIE_FILE, JSON.stringify({ cf_clearance, timestamp: Date.now() }));
    log.debug('cookie saved to disk');
  } catch (err) {
    log.warn(`Could not save cookie to disk: ${err.message}`);
  }
}

async function _fetchCookie() {
  log.info('launching browser to fetch CF cookie');
  const browser = await launchBrowser();
  let cfValue = null;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // Navigate to target — Cloudflare challenge should auto-solve via stealth
    await page.goto(KISSKH_TARGET, { waitUntil: 'networkidle2', timeout: 60_000 });
    await _sleep(3_000);

    const cookies = await page.cookies();
    const cfCookie = cookies.find(c => c.name === 'cf_clearance');
    if (cfCookie) {
      cfValue = `cf_clearance=${cfCookie.value}`;
      log.info(`CF cookie obtained: ${cfCookie.value.slice(0, 12)}...`);
    } else {
      log.warn('cf_clearance cookie not found after navigation');
    }
  } finally {
    await browser.close();
  }

  if (!cfValue) throw new Error('cf_clearance cookie not found');
  return cfValue;
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { getCloudflareCookie };
