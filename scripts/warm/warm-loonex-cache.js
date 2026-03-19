'use strict';

/**
 * warm-loonex-cache.js — Pre-populate Loonex catalog as a single .gz file.
 *
 * Loonex has a single catalog page at /cartoni/ with [data-title] elements.
 * Saves:
 *   - loonex-cache/catalog.json.gz  (all series entries)
 *   - loonex-titles-index.json      (title → [{slug, url}] mapping)
 *
 * Run from LOCAL MACHINE:
 *   node warm-loonex-cache.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cheerio = require('cheerio');

const BASE_URL = 'https://loonex.eu';
const CATALOG_URL = BASE_URL + '/cartoni/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const CACHE_DIR = path.join(__dirname, '../../loonex-cache');

async function main() {
  console.log('Warming Loonex catalog cache...\n');

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const start = Date.now();

  process.stdout.write('  Fetching catalog page... ');
  const resp = await fetch(CATALOG_URL, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'it-IT,it;q=0.9',
      'Referer': BASE_URL + '/',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) {
    console.log(`ERROR: HTTP ${resp.status}`);
    process.exit(1);
  }
  const html = await resp.text();
  console.log(`${(html.length / 1024).toFixed(0)} KB`);

  const $ = cheerio.load(html);
  const series = [];
  const allTitles = {};

  $('[data-title]').each((_, el) => {
    const $item = $(el);
    const title = ($item.attr('data-title') || '').trim();
    const rawHref = $item.find('a[href]').attr('href') || '';
    const poster = $item.find('img').attr('src') || $item.find('img').attr('data-src') || '';
    if (!title || !rawHref) return;

    let href;
    if (rawHref.startsWith('http')) href = rawHref;
    else if (rawHref.startsWith('?')) href = CATALOG_URL + rawHref;
    else href = BASE_URL + (rawHref.startsWith('/') ? '' : '/') + rawHref;

    // Extract slug from URL
    const slugMatch = href.match(/\/([^/]+)\/?(?:\?.*)?$/);
    const slug = slugMatch ? slugMatch[1] : title.toLowerCase().replace(/\s+/g, '-');

    series.push({ title, slug, url: href, poster });

    // Build titles index
    const key = title.toLowerCase().trim();
    if (key) {
      if (!allTitles[key]) allTitles[key] = [];
      allTitles[key].push({ slug, url: href });
    }
  });

  console.log(`  Found ${series.length} series\n`);

  // Save catalog as gzipped JSON
  const catalogJson = JSON.stringify(series);
  const catalogPath = path.join(CACHE_DIR, 'catalog.json.gz');
  fs.writeFileSync(catalogPath, zlib.gzipSync(catalogJson));

  // Save titles index
  const indexPath = path.join(__dirname, '../../data/loonex-titles-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(allTitles));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ Done in ${elapsed}s — ${series.length} series, ${Object.keys(allTitles).length} unique titles`);
  console.log(`   Cache: ${catalogPath} (${(catalogJson.length / 1024).toFixed(1)} KB raw)`);
  console.log(`   Index: ${indexPath}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
