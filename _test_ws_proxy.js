// Test: can we access the bare serversicuro URL (without tokens) through a Webshare proxy?
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');

const PROXY = 'http://gmcimwlz:fyegql9qqbxh@31.59.20.176:6754';
// A known serversicuro bare URL pattern (from packed JS extraction)
// Replace with a real one if needed
const BARE_URL = 'https://hfs323.serversicuro.cc/hls2/01/00262/,acrqw8up2xdv_n,.urlset/master.m3u8';

async function test() {
  const agent = new HttpsProxyAgent(PROXY);
  
  console.log('Test 1: Bare URL through proxy');
  try {
    const resp = await axios.get(BARE_URL, {
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false,
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://supervideo.cc/',
      },
    });
    console.log('Status:', resp.status);
    console.log('Content-Type:', resp.headers['content-type']);
    const body = typeof resp.data === 'string' ? resp.data : String(resp.data);
    console.log('Body length:', body.length);
    console.log('Has #EXTM3U:', body.includes('#EXTM3U'));
    console.log('First 300 chars:', body.substring(0, 300));
  } catch (err) {
    console.log('Error:', err.response?.status || err.message);
    if (err.response?.data) {
      const d = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
      console.log('Response body:', d.substring(0, 300));
    }
  }

  console.log('\nTest 2: Fetch SuperVideo embed page through proxy');
  try {
    const embedUrl = 'https://supervideo.tv/e/acrqw8up2xdv';
    const resp = await axios.get(embedUrl, {
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://guardaserie.ceo/',
      },
    });
    console.log('Status:', resp.status);
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    console.log('HTML length:', html.length);
    console.log('Has Cloudflare:', html.includes('Cloudflare') || html.includes('Just a moment'));
    
    // Try to extract direct manifest URL
    const directMatch = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+master\.m3u8[^"']*)["']/i);
    if (directMatch) {
      console.log('FOUND DIRECT MANIFEST:', directMatch[1]);
    } else {
      // Try packed extraction
      const packedMatch = html.match(/}\('(.+?)',.+,'(.+?)'\.split/);
      if (packedMatch) {
        console.log('Found packed JS (terms:', packedMatch[2].split('|').length, ')');
        const terms = packedMatch[2].split('|');
        const hasHfs = terms.some(t => t.includes('hfs'));
        const hasServersicuro = terms.some(t => t === 'serversicuro');
        console.log('Has hfs:', hasHfs, '| Has serversicuro:', hasServersicuro);
      } else {
        console.log('No packed JS found');
        // Check if there's any m3u8 URL at all
        const anyM3u8 = html.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
        if (anyM3u8) console.log('Found m3u8 URL:', anyM3u8[1].substring(0, 150));
        else console.log('No m3u8 URL found in HTML');
      }
    }
  } catch (err) {
    console.log('Error:', err.response?.status || err.message);
  }
}

test();
