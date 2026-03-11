// Test fetchWithCloudscraper for VixCloud
const { fetchWithCloudscraper } = require('./src/utils/fetcher');

async function main() {
  // Get fresh embed URL
  const embedResp = await fetch('https://www.animeunity.so/embed-url/105449', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://www.animeunity.so/anime/7397-baki-dou-the-invincible-samurai'
    }
  });
  const embedUrl = (await embedResp.text()).trim();
  console.log('Testing cloudscraper on VixCloud embed:', embedUrl.substring(0, 80));

  const html = await fetchWithCloudscraper(embedUrl, {
    retries: 2,
    timeout: 15000,
    referer: 'https://www.animeunity.so/'
  });

  console.log('Result length:', html ? html.length : 'NULL');
  if (html) {
    console.log('Has token:', html.includes("'token'"));
    const tokenMatch = html.match(/'token'\s*:\s*'([^']+)'/);
    console.log('Token:', tokenMatch ? tokenMatch[1] : 'NOT FOUND');
  }
}
main().catch(console.error);
