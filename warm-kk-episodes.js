#!/usr/bin/env node
/**
 * warm-kk-episodes.js — Build an episode-metadata cache for KissKH.
 *
 * For each series in kk-titles-index.json:
 *   1. Fetch /api/DramaList/Drama/{serieId}?isq=false
 *   2. Extract episodes array (id, number, title, season)
 *   3. Save mapping: serieId → {title, episodes: [{id, number, title, season}]}
 *
 * Output: kk-episodes-index.json
 *
 * Run from local machine:
 *   node warm-kk-episodes.js [--limit N] [--continue] [--id 1234] [--deploy]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_BASE = 'https://kisskh.do/api';
const API_FALLBACK = 'https://kisskh.co/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json',
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://kisskh.do/',
  'Origin': 'https://kisskh.do',
};

const INDEX_PATH = path.resolve(__dirname, 'kk-titles-index.json');
const OUT_PATH = path.resolve(__dirname, 'kk-episodes-index.json');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = Number(getArg('limit')) || Infinity;
const CONTINUE = hasFlag('continue');
const ONLY_IDS = getArg('id')?.split(',').map(s => s.trim()).filter(Boolean) || null;
const DELAY = Number(getArg('delay')) || 300;
const DEPLOY = hasFlag('deploy');

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchDrama(serieId) {
  const urls = [
    `${API_BASE}/DramaList/Drama/${serieId}?isq=false`,
    `${API_FALLBACK}/DramaList/Drama/${serieId}?isq=false`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (data && data.title) return data;
    } catch { /* try next */ }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error('❌ kk-titles-index.json not found. Run warm-kk-cache.js first.');
    process.exit(1);
  }

  const titlesIndex = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));

  // Collect unique serieIds
  const serieIds = new Map(); // id → title
  for (const [title, entries] of Object.entries(titlesIndex)) {
    for (const e of entries) {
      if (!serieIds.has(String(e.id))) {
        serieIds.set(String(e.id), title);
      }
    }
  }

  let targetIds = ONLY_IDS ? ONLY_IDS : [...serieIds.keys()];
  if (LIMIT < Infinity) targetIds = targetIds.slice(0, LIMIT);

  // Load existing index if --continue
  let episodesIndex = {};
  if (CONTINUE && fs.existsSync(OUT_PATH)) {
    episodesIndex = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'));
    console.log(`📂 Loaded existing index: ${Object.keys(episodesIndex).length} series`);
  }

  console.log(`🔍 Processing ${targetIds.length} series...`);
  let processed = 0;
  let newSeries = 0;
  let totalEpisodes = 0;

  for (const serieId of targetIds) {
    if (CONTINUE && episodesIndex[serieId]) {
      processed++;
      continue;
    }

    try {
      const data = await fetchDrama(serieId);
      if (!data || !Array.isArray(data.episodes) || data.episodes.length === 0) {
        console.log(`  ⚠ ${serieId}: no episodes`);
        processed++;
        await delay(DELAY);
        continue;
      }

      const episodes = data.episodes.map((ep, idx) => ({
        id: ep.id,
        number: Number(ep.number || ep.episode || idx + 1),
        title: ep.title || `Episode ${idx + 1}`,
        season: Number(ep.season) || 1,
      }));

      episodesIndex[serieId] = {
        title: data.title,
        episodeCount: episodes.length,
        episodes,
      };

      newSeries++;
      totalEpisodes += episodes.length;
      processed++;

      console.log(
        `  ✓ ${data.title}: ${episodes.length} eps` +
        ` | ${processed}/${targetIds.length} series, ${newSeries} new`
      );

      // Save every 20 series
      if (processed % 20 === 0) {
        fs.writeFileSync(OUT_PATH, JSON.stringify(episodesIndex));
      }
    } catch (e) {
      console.log(`  ⚠ ${serieId}: ${e.message}`);
      processed++;
    }

    await delay(DELAY);
  }

  // Final save
  fs.writeFileSync(OUT_PATH, JSON.stringify(episodesIndex));
  const sizeKB = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
  console.log(`\n✅ Done! ${Object.keys(episodesIndex).length} series cached (${sizeKB} KB)`);
  console.log(`   New this run: ${newSeries} series, ${totalEpisodes} episodes`);

  return newSeries;
}

// ── Git deploy ───────────────────────────────────────────────────────────────

async function gitDeploy() {
  const cwd = __dirname;
  const run = (cmd) => {
    console.log(`  $ ${cmd}`);
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  };

  const diff = run('git diff --stat kk-episodes-index.json');
  if (!diff) {
    console.log('📦 No changes in kk-episodes-index.json, skipping deploy.');
    return;
  }

  console.log('\n🚀 Deploying updated KK episode cache...');
  run('git add kk-episodes-index.json');

  const count = Object.keys(JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'))).length;
  const msg = `chore: update kk-episodes-index (${count} series)`;
  run(`git commit -m "${msg}"`);

  const pushOut = run('git push origin master');
  console.log(pushOut || '  (pushed)');
  console.log('✅ Deploy complete.');
}

main()
  .then(async (newCount) => {
    if (DEPLOY && newCount > 0) {
      await gitDeploy();
    } else if (DEPLOY) {
      console.log('\n📦 No new series, skipping deploy.');
    }
  })
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
