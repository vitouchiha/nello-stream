'use strict';

/**
 * warm-kk-cache.js — Pre-populate KissKH catalog pages as .gz files.
 *
 * Fetches the paginated DramaList API (Korea-only) and saves:
 *   - kk-cache/page-{N}.json.gz   (one per API page, ~20-30 items each)
 *   - kk-titles-index.json        (title → [{id, page}] mapping)
 *
 * Run from LOCAL MACHINE:
 *   node warm-kk-cache.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const API_BASE = 'https://kisskh.do/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const CACHE_DIR = path.join(__dirname, '../../kk-cache');
const PAGE_SIZE = 30;
const MAX_PAGES = 25;
const DELAY_MS = 500;

async function fetchPage(page) {
  const url = `${API_BASE}/DramaList/List?page=${page}&type=1&sub=0&country=2&status=0&order=3&pageSize=${PAGE_SIZE}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://kisskh.do/', 'Origin': 'https://kisskh.do' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function main() {
  console.log('Warming KissKH catalog cache...\n');

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const start = Date.now();
  const allTitles = {};
  let totalItems = 0;
  let totalBytes = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      process.stdout.write(`  Page ${page}... `);
      const data = await fetchPage(page);
      if (!data || !data.data || !data.data.length) {
        console.log('(empty — last page)');
        break;
      }

      const items = data.data;
      totalItems += items.length;

      // Save batch as gzipped JSON
      const batchJson = JSON.stringify(items);
      const batchPath = path.join(CACHE_DIR, `page-${page}.json.gz`);
      fs.writeFileSync(batchPath, zlib.gzipSync(batchJson));
      totalBytes += batchJson.length;

      // Build titles index
      for (const item of items) {
        const title = (item.title || '').trim();
        if (title) {
          const key = title.toLowerCase();
          if (!allTitles[key]) allTitles[key] = [];
          allTitles[key].push({ id: item.id, page });
        }
      }

      console.log(`${items.length} items (${(batchJson.length / 1024).toFixed(0)} KB)`);

      if (items.length < PAGE_SIZE) {
        console.log('  (last page)');
        break;
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      break;
    }
  }

  // Save titles index
  const indexPath = path.join(__dirname, '../../data/kk-titles-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(allTitles));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Done in ${elapsed}s — ${totalItems} items, ${Object.keys(allTitles).length} unique titles`);
  console.log(`   Cache dir: ${CACHE_DIR}`);
  console.log(`   Index: ${indexPath}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
