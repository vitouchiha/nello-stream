// Test all Webshare proxies against SuperVideo embed page
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');

const PROXIES = [
  'http://gmcimwlz:fyegql9qqbxh@31.59.20.176:6754',
  'http://gmcimwlz:fyegql9qqbxh@23.95.150.145:6114',
  'http://gmcimwlz:fyegql9qqbxh@198.23.239.134:6540',
  'http://gmcimwlz:fyegql9qqbxh@45.38.107.97:6014',
  'http://gmcimwlz:fyegql9qqbxh@107.172.163.27:6543',
  'http://gmcimwlz:fyegql9qqbxh@198.105.121.200:6462',
  'http://gmcimwlz:fyegql9qqbxh@64.137.96.74:6641',
  'http://gmcimwlz:fyegql9qqbxh@216.10.27.159:6837',
  'http://gmcimwlz:fyegql9qqbxh@142.111.67.146:5611',
  'http://gmcimwlz:fyegql9qqbxh@191.96.254.138:6185',
];

const embedUrl = 'https://supervideo.tv/e/acrqw8up2xdv';

async function testProxy(proxyUrl) {
  const ip = proxyUrl.match(/@([\d.]+):/)?.[1] || 'unknown';
  const agent = new HttpsProxyAgent(proxyUrl);
  try {
    const resp = await axios.get(embedUrl, {
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false,
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://guardaserie.ceo/',
      },
    });
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    const isCF = html.includes('Cloudflare') || html.includes('Just a moment');
    const hasPacked = /}\('/.test(html);
    const hasDirect = /sources\s*:\s*\[/.test(html);
    const hasM3u8 = /\.m3u8/i.test(html);
    console.log(`${ip}: ${resp.status} | CF:${isCF} packed:${hasPacked} direct:${hasDirect} m3u8:${hasM3u8} len:${html.length}`);
    if (!isCF && hasM3u8) {
      const m = html.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
      if (m) console.log(`  => URL: ${m[1].substring(0, 120)}`);
    }
    return { ip, status: resp.status, cf: isCF, packed: hasPacked, direct: hasDirect, m3u8: hasM3u8 };
  } catch (err) {
    console.log(`${ip}: ERROR ${err.response?.status || err.message}`);
    return { ip, status: err.response?.status || 0, error: true };
  }
}

async function main() {
  console.log(`Testing ${PROXIES.length} proxies against ${embedUrl}\n`);
  const results = [];
  // Test sequentially to avoid rate limiting
  for (const proxy of PROXIES) {
    results.push(await testProxy(proxy));
  }
  
  const working = results.filter(r => !r.cf && !r.error);
  console.log(`\n${working.length}/${results.length} proxies bypass Cloudflare`);
}

main();
