// Full end-to-end local test of AnimeUnity ITA stream extraction
process.env.CF_PROXY_URL = 'https://streamfusion-proxy.vitobsfm.workers.dev';

async function main() {
  const { extractVixCloud } = require('./src/extractors/vixcloud');

  // Get fresh embed URL for ITA episode 4 (episodeId 105462, scwsId 685941)
  const animeUrl = 'https://www.animeunity.so/anime/7398-baki-dou-the-invincible-samurai-ita';
  const embedResp = await fetch('https://www.animeunity.so/embed-url/105462', {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': animeUrl
    }
  });
  const embedUrl = (await embedResp.text()).trim();
  console.log('ITA embed URL:', embedUrl.substring(0, 80));

  console.log('\nTesting extractVixCloud for ITA...');
  const start = Date.now();
  const streams = await extractVixCloud(embedUrl, animeUrl);
  console.log('Time:', Date.now() - start, 'ms');
  console.log('Streams:', streams ? streams.length : 0);
  if (streams && streams.length > 0) {
    console.log('URL:', streams[0].url ? streams[0].url.substring(0, 80) : 'none');
    console.log('Quality:', streams[0].quality);
  }
}
main().catch(console.error);
