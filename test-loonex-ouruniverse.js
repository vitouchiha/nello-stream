'use strict';
const { fetchWithAxios } = require('./src/utils/fetcher.js');

(async () => {
  const BASE = 'https://loonex.eu/guarda/';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  // Try different ID patterns for Our Universe
  const idCandidates = [
    'ouruniverse_1x01',
    'our-universe_1x01',
    'our_universe_1x01',
    'ouruniverse_s1e001',
    'ouruniverse_1x03',  // S01E03 directly
    '101_1x01',
    '101_s1e001',
    'our-universe_s1e001',
  ];

  for (const id of idCandidates) {
    const url = `${BASE}?id=${id}`;
    const html = await fetchWithAxios(url, { responseType: 'text', timeout: 5000 });
    if (!html) { console.log(`${id} → no response`); continue; }
    
    const hasVideo = html.includes('encodedStr') || html.includes('videoserver') || html.includes('.m3u8');
    const isBlank = html.includes('1-second-blank-video') || html.includes('nontrovato');
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    
    if (hasVideo && !isBlank) {
      const b64 = html.match(/var\s+encodedStr\s*=\s*["']([A-Za-z0-9+/=]+)["']/);
      let decoded = '';
      if (b64) {
        const raw = Buffer.from(b64[1], 'base64').toString('utf-8');
        decoded = raw.includes('%3A') ? decodeURIComponent(raw) : raw;
      }
      console.log(`✅ ${id} → title="${title}", video="${decoded.slice(0, 80)}"`);
    } else {
      console.log(`❌ ${id} → title="${title}", blank=${isBlank}, has_video=${hasVideo}`);
    }
  }
})().catch(e => console.error(e.message)).finally(() => process.exit(0));
