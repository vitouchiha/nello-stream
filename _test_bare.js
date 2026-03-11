// Test: Does the bare serversicuro URL redirect to a tokenized version through proxy?
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');

const PROXY = 'http://gmcimwlz:fyegql9qqbxh@198.105.121.200:6462';

async function test() {
  const agent = new HttpsProxyAgent(PROXY);
  
  // Bare URL format from packed JS
  const bareUrl = 'https://hfs323.serversicuro.cc/hls2/01/00262/,acrqw8up2xdv_n,.urlset/master.m3u8';
  
  console.log('Test 1: Bare URL with maxRedirects=0 (check for redirect)');
  try {
    const resp = await axios.get(bareUrl, {
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false,
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://supervideo.cc/',
      },
    });
    console.log('Status:', resp.status);
    console.log('Location:', resp.headers.location || 'none');
    if (resp.headers.location) {
      console.log('Redirect URL has tokens:', /[?&]t=/.test(resp.headers.location));
    }
    const body = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    if (body.length < 500) console.log('Body:', body);
    else console.log('Body length:', body.length, '| preview:', body.substring(0, 200));
  } catch (err) {
    console.log('Error:', err.message);
  }

  console.log('\nTest 2: Bare URL with redirects followed');
  try {
    const resp = await axios.get(bareUrl, {
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
    console.log('Final status:', resp.status);
    const body = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    console.log('Body length:', body.length);
    console.log('Has #EXTM3U:', body.includes('#EXTM3U'));
    if (body.includes('#EXTM3U')) {
      console.log('PREVIEW:', body.substring(0, 300));
    }
  } catch (err) {
    console.log('Error:', err.response?.status || err.message);
    if (err.response?.data) {
      const d = typeof err.response.data === 'string' ? err.response.data : '';
      console.log('Body:', d.substring(0, 200));
    }
  }

  console.log('\nTest 3: Bare URL without proxy (direct)');
  try {
    const resp = await axios.get(bareUrl, {
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://supervideo.cc/',
      },
    });
    console.log('Status:', resp.status);
    console.log('Location:', resp.headers.location || 'none');
  } catch (err) {
    console.log('Error:', err.message);
  }
}

test();
