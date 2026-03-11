'use strict';
const { fetchWithAxios } = require('./src/utils/fetcher.js');
const cheerio = require('cheerio');

(async () => {
  const html = await fetchWithAxios('https://loonex.eu/cartoni/', { responseType: 'text' });
  if (!html) { console.log('no response'); return; }
  const $ = cheerio.load(html);
  const items = [];
  $('[data-title]').each(function() {
    const title = $(this).attr('data-title') || '';
    const href = $(this).find('a[href]').attr('href') || '';
    items.push({ title, href });
  });
  console.log('Total items:', items.length);
  console.log('All titles:');
  items.sort((a, b) => a.title.localeCompare(b.title)).forEach(i => {
    console.log(`  "${i.title}" -> ${i.href.slice(0, 80)}`);
  });
})().catch(e => console.error(e.message)).finally(() => process.exit(0));
