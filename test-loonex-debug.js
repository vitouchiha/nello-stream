'use strict';
// Debug loonex sections and Our Universe
const { fetchWithAxios } = require('./src/utils/fetcher.js');
const cheerio = require('cheerio');

const UA2 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function findOurUniverse() {
  const urls = [
    'https://loonex.eu/?s=Our+Universe',
    'https://loonex.eu/live-action/',
    'https://loonex.eu/serie-tv/',
    'https://loonex.eu/serie/',
  ];
  for (const url of urls) {
    const html = await fetchWithAxios(url, { responseType: 'text', timeout: 8000 });
    if (!html) { console.log(url, '→ no response'); continue; }
    const $ = cheerio.load(html);
    const hits = [];
    $('[data-title], a, h1, h2, h3, .card-title').each((_, el) => {
      const t = ($(el).attr('data-title') || $(el).text()).trim();
      if (/univers/i.test(t)) hits.push(t.slice(0, 80));
    });
    console.log(url, '→', hits.length ? hits : `(${$('[data-title]').length} items, 0 hits)`);
  }
  // Also check home nav
  const home = await fetchWithAxios('https://loonex.eu/', { responseType: 'text' });
  if (home) {
    const $ = cheerio.load(home);
    console.log('\nNav links:');
    $('nav a, header a, footer a').each((_, el) => {
      const h = $(el).attr('href') || '';
      const t = $(el).text().trim();
      if (t && !/^$/.test(t) && !h.includes('cdn') && !h.includes('font')) console.log(' ', t, '->', h.slice(0, 60));
    });
  }
}
findOurUniverse().catch(e => console.error(e.message));

process.exit && setTimeout(() => process.exit(0), 30000);

(async () => {
  // Cerca "Our Universe" su loonex
  const base = 'https://loonex.eu';
  const catUrl = base + '/cartoni/';
  console.log('Fetching catalog...');
  const html = await fetchWithAxios(catUrl, { responseType: 'text' });
  if (!html) { console.log('No HTML from catalog'); return; }
  const $ = cheerio.load(html);

  const results = [];
  $('[data-title]').each((_, el) => {
    const title = ($(el).attr('data-title') || '').trim();
    if (/our universe/i.test(title)) {
      const href = $(el).find('a[href]').attr('href') || '';
      results.push({ title, href });
    }
  });
  console.log('Our Universe results:', results);

  if (!results.length) {
    // Prova ricerca generica
    const allTitles = [];
    $('[data-title]').each((_, el) => {
      allTitles.push(($(el).attr('data-title') || '').trim());
    });
    console.log('All titles (first 20):', allTitles.slice(0, 20));
    return;
  }

  // Visita la pagina della serie
  const seriesUrl = results[0].href.startsWith('http') ? results[0].href : base + results[0].href;
  console.log('Series URL:', seriesUrl);
  const seriesHtml = await fetchWithAxios(seriesUrl, { responseType: 'text' });
  const $s = cheerio.load(seriesHtml);

  // Trova episodi S1E3
  const episodes = [];
  $s('button[data-bs-target]').each((_, btn) => {
    const seasonTitle = $s(btn).text().trim();
    const target = $s(btn).attr('data-bs-target');
    if (!target) return;
    $s(target).find('a[href*="/guarda/"]').each((_, link) => {
      const epTitle = $s(link).text().trim();
      const epUrl = $s(link).attr('href') || '';
      episodes.push({ season: seasonTitle, title: epTitle, url: epUrl });
    });
  });
  console.log('Found episodes:', episodes.length);
  console.log('First 5:', episodes.slice(0, 5));

  // Cerca S01E03
  const ep3 = episodes.find(e => /e03|episodio.?3\b|^3\b/i.test(e.title) || e.url.includes('_1x3') || e.url.includes('S01E03'));
  console.log('S01E03 candidate:', ep3);

  if (ep3) {
    const epAbsUrl = ep3.url.startsWith('http') ? ep3.url : base + ep3.url;
    console.log('\nFetching episode page:', epAbsUrl);
    const epHtml = await fetchWithAxios(epAbsUrl, { responseType: 'text' });
    if (!epHtml) { console.log('No episode HTML'); return; }

    // Cerca encodedStr
    const b64Match = epHtml.match(/var\s+encodedStr\s*=\s*["']([A-Za-z0-9+/=]+)["']/);
    if (b64Match) {
      const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
      console.log('Decoded base64:', decoded.slice(0, 200));
    }

    // Cerca m3u8
    const m3u8Match = epHtml.match(/https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/);
    if (m3u8Match) console.log('Raw m3u8 URL:', m3u8Match[0]);

    // Cerca videoserver.loonex.eu
    const vsMatch = epHtml.match(/videoserver\.loonex[^\s"'<>]+/i);
    if (vsMatch) console.log('Videoserver match:', vsMatch[0]);

    // Mostra snippet HTML rilevante
    const idx = epHtml.indexOf('encodedStr');
    if (idx !== -1) console.log('\nencodedStr context:', epHtml.slice(Math.max(0, idx - 50), idx + 300));
    const idx2 = epHtml.indexOf('videoserver');
    if (idx2 !== -1) console.log('\nvideoserver context:', epHtml.slice(Math.max(0, idx2 - 50), idx2 + 200));
  }
})().catch(e => console.error(e.message, e.stack));
