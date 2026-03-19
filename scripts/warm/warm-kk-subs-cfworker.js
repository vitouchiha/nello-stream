#!/usr/bin/env node
/**
 * warm-kk-subs-cfworker.js — Warm KissKH Italian subtitles using CF Worker
 * 
 * Bypasses rate limiting by leveraging Cloudflare Workers trusted network.
 * The CF Worker can fetch/decrypt from KissKH without 429 throttling.
 *
 * Usage:
 *   node warm-kk-subs-cfworker.js [--limit N] [--continue]
 *                                 [--concurrency C] [--batch-size B]
 *
 * Features:
 *   - Bypasses KissKH rate limiting (CF Worker is trusted)
 *   - Parallel/concurrent requests (10 concurrent by default)
 *   - Batch progress tracking
 *   - Local cache + KV persistence
 *
 * Strategy: Much faster than Puppeteer (45s/ep) since CF Worker fetch is ~1-2s
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const INDEX_PATH = path.resolve(__dirname, '../../data/kk-episodes-index.json');
const STATE_PATH = path.resolve(__dirname, '../../kk-cf-subs-state.json');
const LOCAL_CACHE_DIR = path.resolve(__dirname, '../../kk-subs-cache');

// Config
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://kisskh-proxy.vitobsfm.workers.dev';
const CF_WORKER_AUTH = process.env.CF_WORKER_AUTH;
if (!CF_WORKER_AUTH) { console.error('CF_WORKER_AUTH env var required'); process.exit(1); }

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const LIMIT = Number(getArg('limit')) || Infinity;
const CONTINUE = hasFlag('continue');
const CONCURRENCY = Number(getArg('concurrency')) || 10;
const BATCH_SIZE = Number(getArg('batch-size')) || 100;
const DRY_RUN = hasFlag('dry-run');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureCacheDir() {
  if (!fs.existsSync(LOCAL_CACHE_DIR)) {
    fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
  }
}

function saveSubtitleLocally(serieId, episodeId, subtitlesData) {
  try {
    ensureCacheDir();
    const serieDir = path.join(LOCAL_CACHE_DIR, String(serieId));
    if (!fs.existsSync(serieDir)) {
      fs.mkdirSync(serieDir, { recursive: true });
    }
    const filePath = path.join(serieDir, `${episodeId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(subtitlesData, null, 2));
    return true;
  } catch (err) {
    console.warn(`[LOCAL] Failed to save subtitle for ${serieId}:${episodeId}: ${err.message}`);
    return false;
  }
}

function loadState() {
  if (!CONTINUE || !fs.existsSync(STATE_PATH)) return { done: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    if (parsed && parsed.done && typeof parsed.done === 'object') return parsed;
  } catch {}
  return { done: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Call CF Worker endpoint to fetch + decrypt KissKH subtitle
 * Returns: { ok: true, decrypted: "...", lang: "it" } or { ok: false, error: "..." }
 */
function callCfWorkerSubs(serieId, episodeId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ serieId, episodeId });
    const workerUrl = new URL(CF_WORKER_URL);
    workerUrl.searchParams.set('kk_subs_warm', '1');
    
    const options = {
      hostname: workerUrl.hostname,
      path: workerUrl.pathname + workerUrl.search,
      port: workerUrl.port || 443,
      method: 'POST',
      headers: {
        'x-worker-auth': CF_WORKER_AUTH,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          resolve({ ok: false, error: `Invalid JSON response: ${err.message}` });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: `Request error: ${err.message}` });
    });

    req.on('timeout', () => {
      req.abort();
      resolve({ ok: false, error: 'CF Worker timeout' });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Process a queue of episodes concurrently
 */
async function processQueue(queue, concurrency = 10) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const task = queue[index++];
      try {
        const result = await task();
        results.push(result);
      } catch (err) {
        results.push({ error: err.message });
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error('ERROR: kk-episodes-index.json not found. Run warm-kk-episodes.js first.');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  const seriesIds = Object.keys(index);
  const state = loadState();

  let processed = 0;
  let warmed = 0;
  let failed = 0;
  let skipped = 0;
  let cached = 0;

  console.log(`\n🔥 KissKH Subtitle Warming via CF Worker`);
  console.log(`   Worker: ${CF_WORKER_URL}`);
  console.log(`   Series: ${seriesIds.length}`);
  console.log(`   Concurrency: ${CONCURRENCY}`);
  console.log(`   Continue: ${CONTINUE ? 'ON' : 'OFF'}`);
  console.log(`   Dry run: ${DRY_RUN ? 'ON' : 'OFF'}\n`);

  // Collect all episodes into queue
  const queue = [];
  for (const serieId of seriesIds) {
    if (processed >= LIMIT) break;

    const series = index[serieId];
    const episodes = Array.isArray(series?.episodes) ? series.episodes : [];

    for (const ep of episodes) {
      if (processed >= LIMIT) break;

      const episodeId = ep?.id;
      if (!episodeId) {
        skipped++;
        processed++;
        continue;
      }

      const kvKey = `${serieId}:${episodeId}`;
      if (CONTINUE && state.done[kvKey]) {
        cached++;
        processed++;
        continue;
      }

      queue.push(async () => {
        if (DRY_RUN) {
          console.log(`  [DRY] ${serieId}:${episodeId}`);
          return { ok: true, serieId, episodeId, dryRun: true };
        }

        const result = await callCfWorkerSubs(serieId, episodeId);
        
        if (result.ok && result.decrypted) {
          // Save locally
          const fmt = result.format === 'webvtt' ? 'vtt' : 'srt';
          const subData = [{ lang: 'it', label: 'Italiano', url: `data:text/${fmt};base64,${Buffer.from(result.decrypted, 'utf8').toString('base64')}` }];
          if (saveSubtitleLocally(serieId, episodeId, subData)) {
            state.done[kvKey] = 1;
            warmed++;
            console.log(`  ✅ ${serieId}:${episodeId} (${Math.ceil(result.decrypted.length / 1024)}KB, ${result.ms || '?'}ms)`);
          } else {
            console.warn(`  ⚠️  ${serieId}:${episodeId} (saved to KV but local cache failed)`);
            warmed++;
          }
        } else {
          const reason = result.reason || result.error || 'unknown error';
          if (result.reason === 'no-ita-sub') {
            skipped++;
            state.done[kvKey] = 'no-ita';
          } else {
            failed++;
          }
          console.warn(`  ❌ ${serieId}:${episodeId} — ${reason}`);
        }

        return { ok: result.ok, serieId, episodeId, error: result.error };
      });

      processed++;
    }
  }

  console.log(`\n📋 Queued: ${queue.length} episodes (${cached} cached, ${skipped} skipped)\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Showing first 20 tasks (use --no-dry to actually run):\n');
    for (const task of queue.slice(0, 20)) {
      await task();
    }
    console.log('\n[DRY RUN] Done. Run without --dry-run flag to process all episodes.');
    process.exit(0);
  }

  // Process in batches with concurrency
  let batchStart = 0;
  while (batchStart < queue.length) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, queue.length);
    const batchQueue = queue.slice(batchStart, batchEnd);
    
    console.log(`\n[BATCH ${Math.floor(batchStart / BATCH_SIZE) + 1}] Processing ${batchQueue.length} tasks...`);
    await processQueue(batchQueue, CONCURRENCY);
    
    // Save progress every batch
    saveState(state);
    batchStart = batchEnd;
  }

  // Final stats
  console.log(`\n📊 === FINAL STATS ===`);
  console.log(`   Warmed:  ${warmed}`);
  console.log(`   Failed:  ${failed}`);
  console.log(`   Cached:  ${cached}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total:   ${processed}\n`);

  if (warmed > 0) {
    console.log(`✨ Success! Warmed ${warmed} subtitle files.`);
  }

  saveState(state);
}

main().catch(console.error);
