#!/usr/bin/env node
/**
 * warm-loonex-episodes.js — Build an m3u8-URL cache for Loonex episodes.
 *
 * For each series in loonex-cache/catalog.json.gz:
 *   1. Fetch series page → extract season/episode structure + episode URLs
 *   2. Fetch each episode page → extract m3u8 URL (base64 decode or regex)
 *   3. Save mapping: "slug-SxE" → m3u8 URL
 *
 * Output: loonex-episodes-index.json
 *
 * Run from local machine:
 *   node warm-loonex-episodes.js [--limit N] [--continue] [--slug SLUG] [--deploy]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cheerio = require('cheerio');
const { execSync } = require('child_process');

const BASE_URL = 'https://loonex.eu';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL + '/',
};

const CATALOG_GZ = path.resolve(__dirname, 'loonex-cache', 'catalog.json.gz');
const OUT_PATH = path.resolve(__dirname, 'loonex-episodes-index.json');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = Number(getArg('limit')) || Infinity;
const CONTINUE = hasFlag('continue');
const ONLY_SLUGS = getArg('slug')?.split(',').map(s => s.trim()).filter(Boolean) || null;
const DELAY = Number(getArg('delay')) || 400;
const DEPLOY = hasFlag('deploy');

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchHtml(url) {
  try {
    const r = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!r.ok) return null;
    return r.text();
  } catch { return null; }
}

/**
 * Extract episode URLs from a series page.
 * Returns [{season, episode, episodeUrl, title}]
 */
function extractEpisodesFromSeriesPage(html) {
  const $ = cheerio.load(html);
  const episodes = [];

  $('button[data-bs-target]').each((_, btn) => {
    const $btn = $(btn);
    const seasonTitle = $btn.text().trim().replace(/\s+/g, ' ');
    const target = $btn.attr('data-bs-target');
    if (!target) return;

    // Determine season number
    let seasonNum = null;
    const sm = seasonTitle.toLowerCase().match(/(?:stagione|season)\s*(\d+)/);
    if (sm) seasonNum = parseInt(sm[1]);
    // Skip specials/extras
    if (/extra|special|speciali|hype|bonus/i.test(seasonTitle)) return;

    const $container = $(target);
    $container.find('a[href*="/guarda/"]').each((_, linkEl) => {
      const $link = $(linkEl);
      const episodeUrl = $link.attr('href') || '';
      const episodeTitle = $link.text().trim() ||
        $link.closest('div').find('span').first().text().trim() || 'Episodio';

      if (!episodeUrl) return;

      const absUrl = episodeUrl.startsWith('http')
        ? episodeUrl
        : BASE_URL + (episodeUrl.startsWith('/') ? '' : '/') + episodeUrl;

      // Try to extract episode number from URL pattern _SxE
      let epNum = null;
      const urlMatch = absUrl.match(/_\d+x(\d+)/);
      if (urlMatch) epNum = parseInt(urlMatch[1]);

      // Fallback: parse from title text
      if (epNum === null) {
        const titleMatch = episodeTitle.match(/(?:episodio|ep\.?|puntata)\s*(\d+)/i);
        if (titleMatch) epNum = parseInt(titleMatch[1]);
      }
      if (epNum === null) {
        const numMatch = episodeTitle.match(/^(\d+)(?:\s|$)/);
        if (numMatch) epNum = parseInt(numMatch[1]);
      }
      if (epNum === null) {
        const sxeMatch = episodeTitle.match(/\d+[xX](\d+)/);
        if (sxeMatch) epNum = parseInt(sxeMatch[1]);
      }

      episodes.push({
        season: seasonNum || 1,
        episode: epNum,
        episodeUrl: absUrl,
        title: episodeTitle,
      });
    });
  });

  return episodes;
}

/**
 * Extract m3u8 URL from an episode page.
 */
function extractM3u8FromHtml(html) {
  // Method 1: Base64 encoded
  const b64Match = html.match(/var\s+encodedStr\s*=\s*["']([A-Za-z0-9+/=]+)["']/);
  if (b64Match) {
    try {
      let decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
      if (decoded.includes('%3A') || decoded.includes('%2F')) {
        try { decoded = decodeURIComponent(decoded); } catch {}
      }
      if (decoded && decoded.startsWith('http') && !decoded.includes('nontrovato')) {
        return decoded.split('/').map((seg, i) => (i < 3 ? seg : encodeURIComponent(seg))).join('/');
      }
    } catch {}
  }

  // Method 2: Cheerio source elements
  const $ = cheerio.load(html);
  let m3u8Url = $('#video-source').attr('src') ||
    $('source[type="application/x-mpegURL"]').attr('src') ||
    $('source').filter((_, el) => ($(el).attr('src') || '').includes('.m3u8')).attr('src');
  if (m3u8Url && !m3u8Url.includes('1-second-blank-video')) return m3u8Url;

  // Method 3: Raw regex
  const rawMatch = html.match(/https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/);
  if (rawMatch && !rawMatch[0].includes('1-second-blank-video')) return rawMatch[0];

  return null;
}

/**
 * Extract a slug key from the series URL for index keys.
 * e.g. "https://loonex.eu/cartoni/?cartone=bluey-1772757005" → "bluey"
 */
function seriesSlugFromUrl(url) {
  try {
    const u = new URL(url);
    const cartone = u.searchParams.get('cartone');
    if (cartone) {
      // Remove trailing numeric ID: "bluey-1772757005" → "bluey"
      return cartone.replace(/-\d{8,}$/, '');
    }
    // Fallback: last path segment
    const parts = u.pathname.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CATALOG_GZ)) {
    console.error('❌ loonex-cache/catalog.json.gz not found. Run warm-loonex-cache.js first.');
    process.exit(1);
  }

  const catalog = JSON.parse(zlib.gunzipSync(fs.readFileSync(CATALOG_GZ)));
  console.log(`📚 Loaded catalog: ${catalog.length} series`);

  let targetSeries = ONLY_SLUGS
    ? catalog.filter(s => {
        const slug = seriesSlugFromUrl(s.url);
        return ONLY_SLUGS.includes(slug) || ONLY_SLUGS.includes(s.title?.toLowerCase());
      })
    : catalog;
  if (LIMIT < Infinity) targetSeries = targetSeries.slice(0, LIMIT);

  // Load existing index if --continue
  let episodesIndex = {};
  if (CONTINUE && fs.existsSync(OUT_PATH)) {
    episodesIndex = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'));
    console.log(`📂 Loaded existing index: ${Object.keys(episodesIndex).length} episodes`);
  }

  // Track cached series slugs
  const cachedSlugs = new Set();
  if (CONTINUE) {
    for (const key of Object.keys(episodesIndex)) {
      const serieSlug = key.replace(/-\d+x\d+$/, '');
      cachedSlugs.add(serieSlug);
    }
  }

  console.log(`🔍 Processing ${targetSeries.length} series...`);
  let processedSeries = 0;
  let newEpisodes = 0;

  for (const serie of targetSeries) {
    const slug = seriesSlugFromUrl(serie.url);

    if (CONTINUE && cachedSlugs.has(slug)) {
      processedSeries++;
      continue;
    }

    try {
      const seriesHtml = await fetchHtml(serie.url);
      if (!seriesHtml) {
        console.log(`  ⚠ ${slug}: HTTP error`);
        processedSeries++;
        await delay(DELAY);
        continue;
      }

      const episodes = extractEpisodesFromSeriesPage(seriesHtml);
      if (episodes.length === 0) {
        console.log(`  ⚠ ${slug}: no episodes found`);
        processedSeries++;
        await delay(DELAY);
        continue;
      }

      let serieNewEps = 0;
      for (const ep of episodes) {
        if (ep.episode === null) continue; // skip unparseable episode numbers

        const key = `${slug}-${ep.season}x${ep.episode}`;
        if (episodesIndex[key]) continue; // already cached

        await delay(DELAY);
        try {
          const epHtml = await fetchHtml(ep.episodeUrl);
          if (!epHtml) continue;

          const m3u8 = extractM3u8FromHtml(epHtml);
          if (m3u8) {
            episodesIndex[key] = m3u8;
            serieNewEps++;
            newEpisodes++;
          }
        } catch { /* skip failed episode */ }
      }

      processedSeries++;
      console.log(
        `  ✓ ${slug} (${serie.title}): ${episodes.length} eps, ${serieNewEps} new` +
        ` | ${processedSeries}/${targetSeries.length} series, ${newEpisodes} new eps`
      );

      // Save every 10 series
      if (processedSeries % 10 === 0) {
        fs.writeFileSync(OUT_PATH, JSON.stringify(episodesIndex));
      }
    } catch (e) {
      console.log(`  ⚠ ${slug}: ${e.message}`);
      processedSeries++;
    }

    await delay(DELAY);
  }

  // Final save
  fs.writeFileSync(OUT_PATH, JSON.stringify(episodesIndex));
  const sizeKB = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
  console.log(`\n✅ Done! ${Object.keys(episodesIndex).length} episodes cached (${sizeKB} KB)`);
  console.log(`   New episodes this run: ${newEpisodes}`);

  return newEpisodes;
}

// ── Git deploy ───────────────────────────────────────────────────────────────

async function gitDeploy() {
  const cwd = __dirname;
  const run = (cmd) => {
    console.log(`  $ ${cmd}`);
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  };

  const diff = run('git diff --stat loonex-episodes-index.json');
  if (!diff) {
    console.log('📦 No changes in loonex-episodes-index.json, skipping deploy.');
    return;
  }

  console.log('\n🚀 Deploying updated Loonex episode cache...');
  run('git add loonex-episodes-index.json');

  const count = Object.keys(JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'))).length;
  const msg = `chore: update loonex-episodes-index (${count} episodes)`;
  run(`git commit -m "${msg}"`);

  const pushOut = run('git push origin master');
  console.log(pushOut || '  (pushed)');
  console.log('✅ Deploy complete.');
}

main()
  .then(async (newEps) => {
    if (DEPLOY && newEps > 0) {
      await gitDeploy();
    } else if (DEPLOY) {
      console.log('\n📦 No new episodes, skipping deploy.');
    }
  })
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
