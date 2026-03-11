'use strict';
const { getProviderUrl } = require('./src/provider_urls.js');
const base = getProviderUrl('guardahd');
fetch(base + '/set-movie-a/tt9218128', {
  headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Referer': base }
}).then(async r => {
  const html = await r.text();
  const iframe = /<iframe[^>]+id=["']_player["'][^>]+src=["']([^"']+)["']/.exec(html);
  const dataLinks = [...html.matchAll(/data-link=["']([^"']+)["']/g)].map(m => m[1]);
  console.log('Status:', r.status);
  console.log('iframe src:', iframe ? iframe[1] : 'none found');
  console.log('data-links:', dataLinks.length > 0 ? dataLinks : 'none found');
}).catch(e => console.error('ERR:', e.message));
