/**
 * warm-gs-cache.js — Build the GuardoSerie titles index.
 *
 * Scrapes ALL /serie/page/N/ listing pages from guardoserie.website,
 * extracting { title, slug, url } for each series.
 * Saves as gs-titles-index.json (title → slug mapping).
 *
 * Run from local machine (residential Italian IP) — CF blocks cloud IPs.
 *
 *   node warm-gs-cache.js
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://guardoserie.website';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
};
const DELAY_MS = 300;
const MAX_PAGES = 200; // safety limit

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8230;/g, '…');
}

async function fetchPage(pageNum) {
  const url = `${BASE}/serie/page/${pageNum}/`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!r.ok) return null;
  return r.text();
}

function extractSerieLinks(html) {
  const results = new Map();

  // Pattern 1: <a href="...serie/SLUG/" title="TITLE">
  const regex1 = /<a[^>]+href="(https?:\/\/[^"]*\/serie\/([^/"]+)\/?)"[^>]*title="([^"]+)"/g;
  let m;
  while ((m = regex1.exec(html)) !== null) {
    const url = m[1].replace(/\/$/, '') + '/';
    const slug = m[2];
    const title = decodeEntities(m[3]);
    if (!results.has(slug)) results.set(slug, { slug, title, url });
  }

  // Pattern 2: <a href="...serie/SLUG/"> without title attr (fallback)
  const regex2 = /<a[^>]+href="(https?:\/\/[^"]*\/serie\/([^/"]+)\/?)"[^>]*>/g;
  while ((m = regex2.exec(html)) !== null) {
    const slug = m[2];
    if (slug === 'page' || slug === 'feed') continue;
    if (!results.has(slug)) {
      const url = m[1].replace(/\/$/, '') + '/';
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      results.set(slug, { slug, title, url });
    }
  }

  return [...results.values()];
}

async function main() {
  console.log('🔍 Building GuardoSerie titles index...');
  console.log(`   Base: ${BASE}`);

  const allSeries = new Map();
  let page = 1;
  let emptyPages = 0;

  while (page <= MAX_PAGES) {
    try {
      const html = await fetchPage(page);
      if (!html) {
        console.log(`   Page ${page}: HTTP error or empty, stopping.`);
        break;
      }

      const links = extractSerieLinks(html);
      const newCount = links.filter(l => !allSeries.has(l.slug)).length;

      for (const link of links) {
        if (!allSeries.has(link.slug)) allSeries.set(link.slug, link);
      }

      console.log(`   Page ${page}: ${links.length} links (${newCount} new) — total: ${allSeries.size}`);

      if (newCount === 0) {
        emptyPages++;
        if (emptyPages >= 2) { console.log('   2 consecutive empty pages, stopping.'); break; }
      } else {
        emptyPages = 0;
      }

      page++;
      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (e) {
      console.log(`   Page ${page}: error: ${e.message}`);
      break;
    }
  }

  console.log(`\n✅ Scraped ${page - 1} pages, found ${allSeries.size} unique series.`);

  // Build index: lowercase title → { slug, url }
  // Also add slug-as-title for matching  
  const index = {};
  for (const entry of allSeries.values()) {
    const key = entry.title.toLowerCase().trim();
    if (!index[key]) index[key] = [];
    index[key].push({ slug: entry.slug, url: entry.url });

    // Also index by slug (with dashes replaced by spaces)
    const slugTitle = entry.slug.replace(/-/g, ' ').toLowerCase();
    if (slugTitle !== key) {
      if (!index[slugTitle]) index[slugTitle] = [];
      if (!index[slugTitle].some(e => e.slug === entry.slug)) {
        index[slugTitle].push({ slug: entry.slug, url: entry.url });
      }
    }
  }

  const outPath = path.resolve(__dirname, 'gs-titles-index.json');
  fs.writeFileSync(outPath, JSON.stringify(index, null, 0));
  const fileSizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`📦 Saved ${outPath} (${Object.keys(index).length} entries, ${fileSizeKB} KB)`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
