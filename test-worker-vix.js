// Test the updated CF Worker with iframe headers for VixCloud
async function main() {
  const embedResp = await fetch('https://www.animeunity.so/embed-url/105449', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://www.animeunity.so/anime/7397-baki-dou-the-invincible-samurai'
    }
  });
  const embedUrl = (await embedResp.text()).trim();
  console.log('Embed URL:', embedUrl.substring(0, 80));

  const proxyUrl = 'https://streamfusion-proxy.vitobsfm.workers.dev';
  const animeRef = 'https://www.animeunity.so/anime/7397-baki-dou-the-invincible-samurai';
  const pUrl = proxyUrl + '?url=' + encodeURIComponent(embedUrl) + '&referer=' + encodeURIComponent(animeRef);

  const r = await fetch(pUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log('Proxy Status:', r.status);
  const txt = await r.text();
  console.log('Has Cloudflare block:', txt.includes('Just a moment'));
  console.log('Length:', txt.length);
  const tokenMatch = txt.match(/'token'\s*:\s*'([^']+)'/);
  console.log('Has masterPlaylist token:', tokenMatch ? 'YES - ' + tokenMatch[1] : 'NO');
}
main().catch(console.error);
