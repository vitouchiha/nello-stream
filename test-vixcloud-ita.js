// Test VixCloud ITA stream extraction
const proxyUrl = 'https://streamfusion-proxy.vitobsfm.workers.dev';
const embedUrl = 'https://vixcloud.co/embed/685938?token=9dab9cfee9c555fa0b6efbadce819969&expires=1778254022&canPlayFHD=1';
console.log('Testing JP (685938):');
const proxiedUrl = proxyUrl + '?url=' + encodeURIComponent(embedUrl);

async function main() {
  console.log('Testing proxied VixCloud ITA embed...');
  const r = await fetch(proxiedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://vixcloud.co/' }
  });
  console.log('Status:', r.status);
  const txt = await r.text();
  console.log('Length:', txt.length);
  console.log('Has Cloudflare:', txt.includes('Cloudflare'));
  const m3u8Match = txt.match(/https?:\/\/[^"' <\s]+\.m3u8[^"' <\s]*/);
  console.log('m3u8 URL:', m3u8Match ? m3u8Match[0].substring(0, 80) : 'NOT FOUND');
  const masterMatch = txt.match(/masterPlaylist[^"'<]+/);
  console.log('masterPlaylist:', masterMatch ? masterMatch[0].substring(0, 100) : 'not found');
}

main().catch(console.error);
