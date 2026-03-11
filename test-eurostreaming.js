'use strict';
const { getProviderUrl } = require('./src/provider_urls.js');
const base = getProviderUrl('eurostreaming');
console.log('Eurostreaming base:', base);
fetch(base + '/?s=Scrubs', {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': base }
}).then(async r => {
  const html = await r.text();
  console.log('Status:', r.status, 'HTML length:', html.length);
  // Find series links
  const linkRe = /href="([^"]+)"[^>]*>([^<]*Scrubs[^<]*)</gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    console.log(m[1], '->', m[2].trim());
  }
  // Print snippet
  const idx = html.toLowerCase().indexOf('scrubs');
  if (idx >= 0) console.log('Snippet:', html.substring(Math.max(0, idx-100), idx+200));
}).catch(e => console.error('ERR:', e.message));
