#!/usr/bin/env node
/**
 * warm-kk-subs.js — Pre-warm decrypted Italian subtitles for KissKH episodes.
 *
 * Uses src/providers/kisskh warm helper to fetch/decrypt ITA subtitles and
 * persist them in KV (kk_sub) before user traffic.
 *
 * Input source: kk-episodes-index.json
 * Local progress state: kk-subs-warm-state.json (optional with --continue)
 *
 * Usage:
 *   node warm-kk-subs.js [--continue] [--limit N] [--series ID1,ID2] [--delay MS]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const kisskh = require('./src/providers/kisskh');

const INDEX_PATH = path.resolve(__dirname, 'kk-episodes-index.json');
const STATE_PATH = path.resolve(__dirname, 'kk-subs-warm-state.json');
const LOCAL_CACHE_DIR = path.resolve(__dirname, 'kk-subs-cache');

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const CONTINUE = hasFlag('continue');
const LIMIT = Number(getArg('limit')) || Infinity;
const DELAY = Number(getArg('delay')) || 250;
const ONLY_SERIES = getArg('series')
  ? getArg('series').split(',').map(s => s.trim()).filter(Boolean)
  : null;

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
  fs.writeFileSync(STATE_PATH, JSON.stringify(state));
}

async function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error('ERROR: kk-episodes-index.json not found. Run warm-kk-episodes.js first.');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  let seriesIds = Object.keys(index);
  if (ONLY_SERIES && ONLY_SERIES.length > 0) {
    seriesIds = seriesIds.filter(id => ONLY_SERIES.includes(id));
  }

  const state = loadState();

  let processed = 0;
  let warmed = 0;
  let skipped = 0;
  let noIta = 0;
  let failed = 0;
  let transient = 0;

  console.log(`Loaded ${seriesIds.length} KK series from index.`);
  console.log(`Continue mode: ${CONTINUE ? 'ON' : 'OFF'}`);

  for (const serieId of seriesIds) {
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

      const key = `${serieId}:${episodeId}`;
      if (CONTINUE && state.done[key]) {
        skipped++;
        processed++;
        continue;
      }

      const res = await kisskh.warmSubtitleCacheForEpisode(serieId, episodeId);
      if (res.ok) {
        warmed++;
        state.done[key] = 1;
        // Save subtitles locally (no KV anymore, just GitHub)
        if (Array.isArray(res.subtitles) && res.subtitles.length > 0) {
          if (!saveSubtitleLocally(serieId, episodeId, res.subtitles)) {
            console.warn(`  [SKIP] Local save failed for ${key}`);
          }
        }
      } else if (res.reason === 'no-ita-sub') {
        noIta++;
        state.done[key] = 1;
      } else if (res.reason === 'browser-no-subapi') {
        transient++;
      } else {
        failed++;
      }

      processed++;

      if (processed % 20 === 0) {
        saveState(state);
      }

      if (processed % 10 === 0) {
        console.log(
          `progress: ${processed} | warmed=${warmed} noIta=${noIta} transient=${transient} failed=${failed} skipped=${skipped}`
        );
      }

      await sleep(DELAY);
    }

    if (processed >= LIMIT) break;
  }

  state.lastRunAt = new Date().toISOString();
  state.stats = { processed, warmed, noIta, transient, failed, skipped };
  saveState(state);

  console.log('\nDone.');
  console.log(`processed=${processed}`);
  console.log(`warmed=${warmed}`);
  console.log(`noIta=${noIta}`);
  console.log(`transient=${transient}`);
  console.log(`failed=${failed}`);
  console.log(`skipped=${skipped}`);
}

main().catch(err => {
  console.error('Fatal:', err?.message || err);
  process.exit(1);
});
