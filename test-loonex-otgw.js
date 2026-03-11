'use strict';
const { fetchWithAxios } = require('./src/utils/fetcher.js');
const cheerio = require('cheerio');

(async () => {
  // Over the Garden Wall series page
  const BASE = 'https://loonex.eu';
  const catUrl = BASE + '/cartoni/';
  const html = await fetchWithAxios(catUrl, { responseType: 'text' });
  const $ = cheerio.load(html);

  // Find OTGW URL
  let otgwHref = null;
  $('[data-title]').each(function() {
    const title = $(this).attr('data-title') || '';
    if (/over.the.garden/i.test(title)) {
      const rawHref = $(this).find('a[href]').attr('href') || '';
      otgwHref = rawHref.startsWith('?') ? catUrl + rawHref : rawHref;
      console.log('OTGW title:', title, 'url:', otgwHref);
    }
  });
  if (!otgwHref) { console.log('OTGW not found'); return; }

  // Fetch OTGW series page
  const sHtml = await fetchWithAxios(otgwHref, { responseType: 'text' });
  const $s = cheerio.load(sHtml);
  const episodes = [];
  $s('button[data-bs-target]').each(function() {
    const seasonTitle = $s(this).text().trim();
    const target = $s(this).attr('data-bs-target');
    if (!target) return;
    $s(target).find('a[href*="/guarda/"]').each(function() {
      const epUrl = $s(this).attr('href') || '';
      const epTitle = $s(this).text().trim();
      const absUrl = epUrl.startsWith('http') ? epUrl : BASE + epUrl;
      episodes.push({ season: seasonTitle, title: epTitle, url: absUrl });
    });
  });
  console.log('Episodes:', episodes.length);
  if (!episodes.length) return;
  const ep1 = episodes[0];
  console.log('First episode:', JSON.stringify(ep1));

  // Fetch episode page
  const epHtml = await fetchWithAxios(ep1.url, { responseType: 'text' });
  if (!epHtml) { console.log('No ep HTML'); return; }

  // Decode base64
  const b64 = epHtml.match(/var\s+encodedStr\s*=\s*["']([A-Za-z0-9+/=]+)["']/);
  if (b64) {
    const decoded = Buffer.from(b64[1], 'base64').toString('utf-8');
    console.log('Base64 decoded:', decoded.slice(0, 200));
    // Check URL-encoded
    if (decoded.includes('%3A') || decoded.includes('%2F')) {
      const decoded2 = decodeURIComponent(decoded);
      console.log('After URI decode:', decoded2.slice(0, 200));
    }
  } else {
    console.log('No encodedStr found in HTML');
    // Look for any m3u8 or videoserver
    const m3u8 = epHtml.match(/videoserver\.loonex[^\s"'<]{0,100}/);
    if (m3u8) console.log('Videoserver match:', m3u8[0]);
    const raw = epHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
    if (raw) console.log('Raw m3u8:', raw[0]);
  }
})().catch(e => console.error(e.message)).finally(() => process.exit(0));
