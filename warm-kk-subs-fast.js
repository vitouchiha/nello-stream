#!/usr/bin/env node
/**
 * warm-kk-subs-fast.js -- Fast KissKH subtitle warming via browser interception.
 *
 * Strategy:
 *   1. ONE persistent browser session
 *   2. Navigate to each episode page (fast: domcontentloaded + early exit)
 *   3. Intercept the /api/Sub/ XHR response (subtitle list with dynamic kkey)
 *   4. Filter Italian subtitles
 *   5. Download .srt/.txt1 from subtitle CDN (sub.streamsub.top - not CF-protected)
 *   6. Decrypt AES if needed -> save locally
 *
 * ~5-10s per episode vs 45s with full browser wait.
 *
 * Usage:
 *   node warm-kk-subs-fast.js [--limit N] [--continue] [--delay MS]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { launchBrowser, applyStealthEvasions } = require('./src/utils/browser');
const { decryptKisskhSubtitleFull, decryptKisskhSubtitleStatic } = require('./src/utils/subDecrypter');

const INDEX_PATH = path.resolve(__dirname, 'kk-episodes-index.json');
const STATE_PATH = path.resolve(__dirname, 'kk-subs-warm-state.json');
const LOCAL_CACHE_DIR = path.resolve(__dirname, 'kk-subs-cache');

const SITE_BASE = 'https://kisskh.do';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const STATIC_KEY = Buffer.from('AmSmZVcH93UQUezi');
const STATIC_IV  = Buffer.from('ReBKWW8cqdjPEnF6');

// CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) { return args.includes('--' + name); }

const LIMIT = Number(getArg('limit')) || Infinity;
const CONTINUE = hasFlag('continue');
const DELAY = Number(getArg('delay')) || 500;
const NAV_TIMEOUT = Number(getArg('nav-timeout')) || 20000;

// Helpers
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveSubtitleLocally(serieId, episodeId, subtitlesData) {
  try {
    const serieDir = path.join(LOCAL_CACHE_DIR, String(serieId));
    ensureDir(serieDir);
    fs.writeFileSync(path.join(serieDir, episodeId + '.json'), JSON.stringify(subtitlesData, null, 2));
    return true;
  } catch { return false; }
}

function loadState() {
  if (!CONTINUE || !fs.existsSync(STATE_PATH)) return { done: {} };
  try {
    const p = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    return p && p.done ? p : { done: {} };
  } catch { return { done: {} }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state));
}

function resolveSubUrl(s) {
  if (s.src) return s.src;
  if (s.GET && s.GET.host && s.GET.filename) {
    var u = (s.GET.scheme || 'https') + '://' + s.GET.host + s.GET.filename;
    if (s.GET.query && s.GET.query.v) u += '?v=' + s.GET.query.v;
    return u;
  }
  return null;
}

// ---------- Browser ----------

let _browser = null;
let _page = null;

async function initBrowser() {
  console.log('\nLaunching browser...');
  _browser = await launchBrowser({ headless: 'new' });
  _page = await _browser.newPage();
  await _page.setUserAgent(UA);
  if (typeof applyStealthEvasions === 'function') {
    await applyStealthEvasions(_page);
  }

  // Prewarm: visit homepage once
  await _page.goto(SITE_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function(){});
  var title = await _page.title().catch(function(){ return ''; });
  if (title.toLowerCase().includes('just a moment')) {
    console.log('  CF challenge, waiting...');
    var deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await sleep(1500);
      var t2 = await _page.title().catch(function(){ return ''; });
      if (!t2.toLowerCase().includes('just a moment')) break;
    }
  }
  console.log('  Browser ready');
}

async function closeBrowser() {
  try { if (_browser) await _browser.close(); } catch {}
  _browser = null;
  _page = null;
}

/**
 * Navigate to episode page, intercept the /api/Sub/ XHR response.
 * Returns the subtitle list (array) or null.
 */
async function interceptSubApi(serieId, episodeId) {
  return new Promise(async function(resolve) {
    var subList = null;
    var done = false;
    var timeout = null;

    function finish(result) {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    }

    // Set up response interception
    var responseHandler = async function(res) {
      if (done) return;
      var u = res.url();
      if (!u.includes('/api/Sub/')) return;
      try {
        var status = res.status();
        if (status !== 200) {
          finish(null);
          return;
        }
        var text = await res.text();
        var data = JSON.parse(text);
        subList = Array.isArray(data) ? data : [data];
        finish(subList);
      } catch (e) {
        // ignore parse errors
      }
    };

    _page.on('response', responseHandler);

    // Timeout: if no Sub API response in NAV_TIMEOUT, give up
    timeout = setTimeout(function() {
      _page.off('response', responseHandler);
      finish(null);
    }, NAV_TIMEOUT);

    // Navigate to episode page
    var epUrl = SITE_BASE + '/Drama/Any/Episode-Any?id=' + serieId + '&ep=' + episodeId;
    try {
      await _page.goto(epUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } catch (e) {
      // Navigation timeout is OK - we might already have intercepted
    }

    // If not yet resolved, wait a bit more
    if (!done) {
      await sleep(5000);
      if (!done) {
        _page.off('response', responseHandler);
        finish(subList); // might still be null
      }
    } else {
      _page.off('response', responseHandler);
    }
  });
}

/**
 * Download a subtitle file via Node.js HTTP (subtitle CDN is not CF-protected).
 * Falls back to browser fetch if direct fails.
 */
async function downloadSubFile(subUrl) {
  // Try direct Node.js first (fast, no browser overhead)
  try {
    var resp = await axios.get(subUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': UA, 'Accept': '*/*' }
    });
    return Buffer.from(resp.data);
  } catch (e) {
    // Fallback: download via browser
    try {
      var result = await _page.evaluate(async function(url) {
        try {
          var r = await fetch(url, { credentials: 'omit' });
          if (!r.ok) return null;
          var buf = await r.arrayBuffer();
          return Array.from(new Uint8Array(buf));
        } catch (e) { return null; }
      }, subUrl);
      if (result) return Buffer.from(result);
    } catch {}
  }
  return null;
}

/**
 * Process a single episode: intercept Sub API -> filter Italian -> download -> decrypt -> save
 */
async function processEpisode(serieId, episodeId) {
  var ITA_URL = /^https?:\/\/.*\.it\.(srt|vtt|txt1|txt)$/i;
  var ITA_LANGS = ['it', 'ita', 'italian', 'italiano', 'itit'];

  // 1) Intercept subtitle list
  var subtitleList = await interceptSubApi(serieId, episodeId);
  if (!subtitleList) {
    return { ok: false, reason: 'no-sub-api' };
  }

  // 2) Filter Italian
  var itSubs = subtitleList.filter(function(s) {
    var lang = (s.land || s.label || s.lang || s.language || s.name || '').toLowerCase().replace(/[^a-z]/g, '');
    var src = resolveSubUrl(s);
    return ITA_LANGS.indexOf(lang) >= 0 || (src && ITA_URL.test(src));
  });

  if (itSubs.length === 0) {
    return { ok: false, reason: 'no-ita-sub', totalSubs: subtitleList.length };
  }

  // 3) Download + decrypt
  for (var i = 0; i < itSubs.length; i++) {
    var sub = itSubs[i];
    var subUrl = resolveSubUrl(sub);
    if (!subUrl) continue;

    try {
      var buf = await downloadSubFile(subUrl);
      if (!buf || buf.length < 10) continue;

      var isEncrypted = /\.(txt1|txt)$/i.test(subUrl);
      var content;

      if (isEncrypted) {
        var asText = buf.toString('utf8').trim();
        content = (asText.startsWith('1') || asText.startsWith('WEBVTT'))
          ? decryptKisskhSubtitleFull(asText)
          : decryptKisskhSubtitleStatic(buf, STATIC_KEY, STATIC_IV);
      } else {
        content = buf.toString('utf8');
      }

      // Validate
      var trimmed = (content || '').trim();
      var isValid = /^\d+\r?\n\d{2}:\d{2}:\d{2}/.test(trimmed) || trimmed.startsWith('WEBVTT');
      if (!isValid) continue;

      var ext = trimmed.startsWith('WEBVTT') ? 'vtt' : 'srt';
      var mime = ext === 'vtt' ? 'text/vtt' : 'application/x-subrip';
      var b64 = Buffer.from(content, 'utf8').toString('base64');
      var subDataArr = [{ lang: 'it', label: 'Italiano', url: 'data:' + mime + ';base64,' + b64 }];

      saveSubtitleLocally(serieId, episodeId, subDataArr);
      return { ok: true, size: content.length, format: ext, subUrl: subUrl.slice(0, 60) };
    } catch (e) { /* try next sub */ }
  }

  return { ok: false, reason: 'decrypt-failed', itSubCount: itSubs.length };
}

// ---------- Main ----------

async function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error('ERROR: kk-episodes-index.json not found.');
    process.exit(1);
  }

  ensureDir(LOCAL_CACHE_DIR);
  var index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  var seriesIds = Object.keys(index);
  var state = loadState();

  await initBrowser();

  var processed = 0, warmed = 0, noIta = 0, noSub = 0, failed = 0, skipped = 0;
  var consecutive_noSub = 0;
  var startTime = Date.now();

  console.log('\nKissKH Fast Subtitle Warming (browser intercept)');
  console.log('  Series: ' + seriesIds.length + ', Limit: ' + (LIMIT === Infinity ? 'ALL' : LIMIT));
  console.log('  Continue: ' + (CONTINUE ? 'ON' : 'OFF') + ', Delay: ' + DELAY + 'ms\n');

  for (var si = 0; si < seriesIds.length; si++) {
    if (processed >= LIMIT) break;
    var serieId = seriesIds[si];
    var series = index[serieId];
    var episodes = Array.isArray(series && series.episodes) ? series.episodes : [];

    for (var ei = 0; ei < episodes.length; ei++) {
      if (processed >= LIMIT) break;
      var ep = episodes[ei];
      var episodeId = ep && ep.id;
      if (!episodeId) { skipped++; processed++; continue; }

      var key = serieId + ':' + episodeId;
      if (CONTINUE && state.done[key]) { skipped++; processed++; continue; }

      try {
        var result = await processEpisode(serieId, episodeId);

        if (result.ok) {
          warmed++;
          state.done[key] = 1;
          consecutive_noSub = 0;
          console.log('  OK ' + key + ' (' + Math.ceil(result.size / 1024) + 'KB ' + result.format + ')');
        } else if (result.reason === 'no-ita-sub') {
          noIta++;
          state.done[key] = 'no-ita';
          consecutive_noSub = 0;
        } else if (result.reason === 'no-sub-api') {
          noSub++;
          consecutive_noSub++;
          console.warn('  NOSUB ' + key);
          if (consecutive_noSub >= 5) {
            console.log('\n  5 consecutive no-sub-api -- restarting browser...');
            await closeBrowser();
            await sleep(3000);
            await initBrowser();
            consecutive_noSub = 0;
          }
        } else {
          failed++;
          console.warn('  FAIL ' + key + ' -- ' + result.reason);
        }
      } catch (err) {
        failed++;
        console.error('  ERR ' + key + ' -- ' + err.message);
      }

      processed++;

      if (processed % 10 === 0) {
        saveState(state);
        var elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        var rate = (processed / (elapsed || 1)).toFixed(1);
        console.log('  [' + processed + '] warmed=' + warmed + ' noIta=' + noIta + ' noSub=' + noSub + ' fail=' + failed + ' skip=' + skipped + ' (' + elapsed + 's, ' + rate + '/s)');
      }

      await sleep(DELAY);
    }
  }

  await closeBrowser();

  state.lastRunAt = new Date().toISOString();
  state.stats = { processed: processed, warmed: warmed, noIta: noIta, noSub: noSub, failed: failed, skipped: skipped };
  saveState(state);

  var totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('\n=== FINAL STATS ===');
  console.log('  Warmed:  ' + warmed);
  console.log('  No ITA:  ' + noIta);
  console.log('  No Sub:  ' + noSub);
  console.log('  Failed:  ' + failed);
  console.log('  Skipped: ' + skipped);
  console.log('  Total:   ' + processed);
  console.log('  Time:    ' + totalTime + 's\n');
}

main().catch(console.error);
