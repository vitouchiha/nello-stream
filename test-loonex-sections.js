'use strict';
// Debug: cerca "Our Universe" su varie sezioni di Loonex
const { fetchWithAxios } = require('./src/utils/fetcher.js');
const cheerio = require('cheerio');

const BASE = 'https://loonex.eu';

async function trySection(path) {
  const url = BASE + path;
  console.log('Fetching:', url);
  const html = await fetchWithAxios(url, { responseType: 'text' });
  if (!html) { console.log('  No response'); return; }
  const $ = cheerio.load(html);
  const found = [];
  $('[data-title]').each((_, el) => {
    const t = ($(el).attr('data-title') || '').trim();
    if (/univers|our|universe/i.test(t)) found.push(t);
  });
  if (found.length) console.log('  Found:', found);
  else console.log(`  Not found (total items: ${$('[data-title]').length})`);
}

(async () => {
  // Try various Loonex sections
  await trySection('/');
  await trySection('/cartoni/');
  await trySection('/serie/');
  await trySection('/documentari/');
  await trySection('/film/');

  // Also try direct search API if any
  const searchHtml = await fetchWithAxios(BASE + '/?s=Our+Universe', { responseType: 'text' });
  if (searchHtml) {
    console.log('\nSearch results for "Our Universe":');
    const $ = cheerio.load(searchHtml);
    const items = [];
    $('[data-title], .entry-title, h2, h3').each((_, el) => {
      const t = $(el).text().trim();
      if (t && /univers|our|universe/i.test(t)) items.push(t.slice(0, 80));
    });
    console.log(items.length ? items : 'Nothing found');
    // Also check hrefs
    const hrefs = [];
    $('a[href]').each((_, el) => {
      const h = $(el).attr('href') || '';
      if (/univers|universe/i.test(h)) hrefs.push(h.slice(0, 100));
    });
    if (hrefs.length) console.log('Hrefs:', hrefs);
  }

  // Try direct episode URL guess
  const epUrl = 'https://videoserver.loonex.eu/episodi/101/S01E003/output.m3u8';
  console.log('\nTesting direct episode URL:', epUrl);
  try {
    const ep = await fetchWithAxios(epUrl, { responseType: 'text', timeout: 5000 });
    if (ep) console.log('  Response length:', ep.length, 'First line:', ep.slice(0, 50));
    else console.log('  No response / not accessible');
  } catch (e) {
    console.log('  Error:', e.message);
  }
})().catch(e => console.error(e.message));
