// Test: What does SuperVideo HTML contain when fetched through the proxy?
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');

const PROXY = 'http://gmcimwlz:fyegql9qqbxh@31.59.20.176:6754';

async function test() {
  const agent = new HttpsProxyAgent(PROXY);
  
  // First, find the SuperVideo embed URL from Guardaserie
  // We know the embed URL pattern from earlier extractions
  const embedUrl = 'https://supervideo.tv/e/acrqw8up2xdv';
  
  console.log('Fetching SuperVideo page through proxy...');
  try {
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
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    console.log('Status:', resp.status);
    console.log('HTML length:', html.length);
    console.log('Has Cloudflare:', html.includes('Cloudflare') || html.includes('Just a moment'));
    
    // Check for direct manifest
    const directMatch = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (directMatch) {
      console.log('\nDIRECT MANIFEST FOUND:', directMatch[1].substring(0, 200));
    }
    
    // Check for any m3u8 URL
    const anyM3u8 = html.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
    if (anyM3u8) {
      console.log('\nM3U8 URL IN HTML:', anyM3u8[1].substring(0, 200));
    }
    
    // Check for packed JS
    const packedMatch = html.match(/}\('(.+?)',.+,'(.+?)'\.split/);
    if (packedMatch) {
      const terms = packedMatch[2].split('|');
      console.log('\nPacked JS found! Terms:', terms.length);
      
      // Build the URL from packed data
      const fileIndex = terms.indexOf('file');
      let hfs = '';
      for (let i = fileIndex; i < terms.length; i++) {
        if (terms[i].includes('hfs')) { hfs = terms[i]; break; }
      }
      const urlsetIndex = terms.indexOf('urlset');
      const hlsIndex = terms.indexOf('hls2') !== -1 ? terms.indexOf('hls2') : terms.indexOf('hls');
      
      console.log('file index:', fileIndex, '| hfs:', hfs, '| urlset:', urlsetIndex, '| hls:', hlsIndex);
      
      if (urlsetIndex !== -1 && hlsIndex !== -1) {
        const reversed = terms.slice(urlsetIndex + 1, hlsIndex).reverse();
        const pathParts = reversed.slice(0, -1);
        const tailPart = reversed[reversed.length - 1];
        const bareUrl = `https://${hfs}.serversicuro.cc/${terms[hlsIndex]}/${pathParts.length ? pathParts.join('/') + '/' : ''},${tailPart},.urlset/master.m3u8`;
        console.log('Built bare URL:', bareUrl);
        
        // Now try to access this bare URL through the same proxy
        console.log('\nAccessing bare URL through proxy...');
        try {
          const bareResp = await axios.get(bareUrl, {
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false,
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': 'https://supervideo.cc/',
            },
          });
          console.log('Bare URL status:', bareResp.status);
          const body = typeof bareResp.data === 'string' ? bareResp.data : String(bareResp.data);
          console.log('Body length:', body.length);
          console.log('Has #EXTM3U:', body.includes('#EXTM3U'));
          console.log('First 300:', body.substring(0, 300));
        } catch (err) {
          console.log('Bare URL error:', err.response?.status || err.message);
        }
      }
    } else {
      console.log('\nNo packed JS found');
      console.log('HTML preview:', html.substring(0, 500));
    }
  } catch (err) {
    console.log('Error:', err.response?.status || err.message);
  }
}

test();
