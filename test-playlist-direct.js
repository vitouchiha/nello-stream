// Test: use embed URL token directly with playlist endpoint (skip embed page loading)
async function main() {
  // Get fresh embed URL from AnimeUnity
  const embedResp = await fetch('https://www.animeunity.so/embed-url/105449', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://www.animeunity.so/anime/7397-baki-dou-the-invincible-samurai'
    }
  });
  const embedUrl = (await embedResp.text()).trim();
  console.log('Embed URL:', embedUrl.substring(0, 100));

  // Parse token and expires from embed URL
  const parsed = new URL(embedUrl);
  const scwsId = parsed.pathname.split('/').pop(); // 685928
  const token = parsed.searchParams.get('token');
  const expires = parsed.searchParams.get('expires');
  const canPlayFHD = parsed.searchParams.get('canPlayFHD') === '1';
  console.log('scwsId:', scwsId, 'token:', token, 'expires:', expires, 'FHD:', canPlayFHD);

  // Try direct playlist URL with embed token
  const playlistUrl = `https://vixcloud.co/playlist/${scwsId}?ub=1&token=${token}&expires=${expires}${canPlayFHD ? '&h=1' : ''}`;
  console.log('\nTesting playlist URL:', playlistUrl.substring(0, 100));
  const r = await fetch(playlistUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.animeunity.so/' }
  });
  console.log('Direct playlist status:', r.status);
  const txt = await r.text();
  console.log('First 200 chars:', txt.substring(0, 200));
}
main().catch(console.error);
