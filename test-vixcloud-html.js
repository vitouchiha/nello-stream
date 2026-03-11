// Script to inspect VixCloud embed HTML structure
async function main() {
  const embedResp = await fetch('https://www.animeunity.so/embed-url/105449', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://www.animeunity.so/anime/7397-baki-dou-the-invincible-samurai'
    }
  });
  const embedUrl = (await embedResp.text()).trim();
  console.log('Embed URL:', embedUrl);

  const vixResp = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://www.animeunity.so/'
    }
  });
  const html = await vixResp.text();
  console.log('VixCloud HTML length:', html.length);

  // Extract larger masterPlaylist block (up to 1000 chars)
  const mpMatch = /masterPlaylist\s*[=:]\s*(\{[\s\S]{0,1000}?\})\s*[;,\n]/i.exec(html);
  if (mpMatch) {
    console.log('masterPlaylist:', mpMatch[1]);
  }
  // Also find any url or m3u8 references
  const lines = html.split('\n').filter(l => l.includes('url') || l.includes('m3u8') || l.includes('playlist'));
  lines.slice(0, 15).forEach(l => console.log('LINE:', l.trim().substring(0, 250)));
}
main().catch(console.error);
