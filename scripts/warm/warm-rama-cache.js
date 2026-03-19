'use strict';

/**
 * warm-rama-cache.js — Pre-populate Rama Oriental Fansub catalog as .gz files.
 *
 * Fetches all paginated catalog pages and saves:
 *   - rama-cache/page-{N}.json.gz  (extracted drama cards per page)
 *   - rama-titles-index.json       (title → [{slug, page}] mapping)
 *
 * Run from LOCAL MACHINE:
 *   node warm-rama-cache.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cheerio = require('cheerio');

const BASE_URL = 'https://ramaorientalfansub.live';
const CATALOG_PATH = '/paese/corea-del-sud/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const CACHE_DIR = path.join(__dirname, '../../rama-cache');
const MAX_PAGES = 40;
const DELAY_MS = 500;

async function fetchPage(pageNum) {
  const url = `${BASE_URL}${CATALOG_PATH}page/${pageNum}/`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'it-IT,it;q=0.9',
      'Referer': BASE_URL + CATALOG_PATH,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) return null;
  return resp.text();
}

function extractCards(html) {
  const $ = cheerio.load(html);
  const cards = [];

  $('.kira-anime').each((_, el) => {
    const $el = $(el);
    const $parent = $el.parent();

    // Get drama link from <a href="...drama/SLUG/"> inside the card or its wrapper
    const href = $el.find('a[href*="/drama/"]').first().attr('href')
      || $parent.find('a[href*="/drama/"]').first().attr('href')
      || '';
    if (!href) return;

    const slug = href.replace(/\/$/, '').split('/').pop() || '';

    // Get poster from <img> inside the kira-anime div
    const img = $el.find('img').first();
    const poster = img.attr('src') || img.attr('data-src') || '';

    // Get title from <span data-en-title> or img alt
    const enTitle = $parent.find('[data-en-title]').first().text().trim();
    const altTitle = (img.attr('alt') || '').replace(/\s*thumbnail\s*$/i, '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
    const title = enTitle || altTitle || slug.replace(/-/g, ' ');

    cards.push({ slug, title, poster, url: href });
  });

  return cards;
}

async function main() {
  console.log('Warming Rama Oriental Fansub catalog cache...\n');

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const start = Date.now();
  const allTitles = {};
  let totalItems = 0;
  let totalBytes = 0;
  let emptyPages = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      process.stdout.write(`  Page ${page}... `);
      const html = await fetchPage(page);
      if (!html) {
        console.log('(HTTP error)');
        emptyPages++;
        if (emptyPages >= 2) break;
        continue;
      }

      const cards = extractCards(html);
      if (cards.length === 0) {
        console.log('(no cards — likely last page)');
        emptyPages++;
        if (emptyPages >= 2) break;
        continue;
      }
      emptyPages = 0;
      totalItems += cards.length;

      // Save batch as gzipped JSON
      const batchJson = JSON.stringify(cards);
      const batchPath = path.join(CACHE_DIR, `page-${page}.json.gz`);
      fs.writeFileSync(batchPath, zlib.gzipSync(batchJson));
      totalBytes += batchJson.length;

      // Build titles index
      for (const card of cards) {
        const key = card.title.toLowerCase().trim();
        if (key) {
          if (!allTitles[key]) allTitles[key] = [];
          allTitles[key].push({ slug: card.slug, page });
        }
      }

      console.log(`${cards.length} cards (${(batchJson.length / 1024).toFixed(0)} KB)`);

      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      break;
    }
  }

  // Save titles index
  const indexPath = path.join(__dirname, '../../data/rama-titles-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(allTitles));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Done in ${elapsed}s — ${totalItems} items, ${Object.keys(allTitles).length} unique titles`);
  console.log(`   Cache dir: ${CACHE_DIR}`);
  console.log(`   Index: ${indexPath}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
