// Test: Does Browserless.io support --proxy-server as a launch arg?
// If so, the browser's traffic will go through the proxy, and the tokens
// will be bound to the proxy IP.
const puppeteer = require('puppeteer-core');

const BROWSERLESS_TOKEN = '2U5ZUsJBo4unrL5dd8d7724def5cdf80defda1d69f75efb38';
const PROXY = 'http://gmcimwlz:fyegql9qqbxh@198.105.121.200:6462';
const PROXY_HOST = '198.105.121.200';
const PROXY_PORT = '6462';

async function testWithoutProxy() {
  console.log('=== Test 1: Browserless WITHOUT proxy ===');
  const wsUrl = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`;
  const browser = await puppeteer.connect({
    browserWSEndpoint: wsUrl,
    defaultViewport: { width: 1280, height: 720 },
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  
  // Check our IP
  try {
    await page.goto('https://api.ipify.org?format=json', { timeout: 10000 });
    const ipText = await page.evaluate(() => document.body.innerText);
    console.log('Browser IP (no proxy):', ipText);
  } catch(e) { console.log('IP check error:', e.message); }
  
  await browser.close();
}

async function testWithProxy() {
  console.log('\n=== Test 2: Browserless WITH proxy via launch args ===');
  const wsUrl = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--proxy-server=http://${PROXY_HOST}:${PROXY_PORT}`;
  
  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl,
      defaultViewport: { width: 1280, height: 720 },
    });
    
    const page = await browser.newPage();
    
    // Authenticate proxy
    await page.authenticate({
      username: 'gmcimwlz',
      password: 'fyegql9qqbxh',
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    // Check our IP
    try {
      await page.goto('https://api.ipify.org?format=json', { timeout: 15000 });
      const ipText = await page.evaluate(() => document.body.innerText);
      console.log('Browser IP (with proxy):', ipText);
      
      const ipObj = JSON.parse(ipText);
      if (ipObj.ip === PROXY_HOST) {
        console.log('==> PROXY IS WORKING! Browser IP matches proxy IP');
      } else {
        console.log('==> Proxy IP mismatch:', ipObj.ip, 'vs', PROXY_HOST);
        console.log('   (this could mean the proxy is working but has a different exit IP)');
      }
    } catch(e) { console.log('IP check error:', e.message); }
    
    // Now test SuperVideo
    console.log('\nTesting SuperVideo embed page through proxy...');
    let manifestUrl = null;
    
    page.on('response', (response) => {
      const responseUrl = response.url();
      if (!manifestUrl && /master\.m3u8/i.test(responseUrl)) {
        manifestUrl = responseUrl;
        console.log('Captured manifest URL:', responseUrl.substring(0, 150));
      }
    });
    
    try {
      await page.goto('https://supervideo.tv/e/acrqw8up2xdv', {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });
      
      const title = await page.title();
      const html = await page.content();
      console.log('Page title:', title);
      console.log('HTML length:', html.length);
      console.log('Has Cloudflare:', html.includes('Just a moment'));
      
      if (!html.includes('Just a moment')) {
        // Try to play
        await page.evaluate(() => {
          try {
            if (typeof window.jwplayer === 'function') {
              const p = window.jwplayer();
              if (p && typeof p.play === 'function') {
                p.setMute(true);
                p.play();
              }
            }
          } catch {}
        }).catch(() => {});
        
        await new Promise(r => setTimeout(r, 3000));
        
        if (manifestUrl) {
          console.log('\n==> MANIFEST CAPTURED THROUGH PROXY!');
          console.log('URL:', manifestUrl.substring(0, 200));
          // Check if the token has the proxy IP
          const iParam = manifestUrl.match(/[&?]i=([\d.]+)/);
          if (iParam) {
            console.log('Token IP param:', iParam[1]);
          }
        } else {
          console.log('No manifest URL captured');
        }
      }
    } catch(e) { console.log('SuperVideo error:', e.message); }
    
    await browser.close();
  } catch(e) {
    console.log('Browser connect error:', e.message);
  }
}

async function main() {
  await testWithoutProxy();
  await testWithProxy();
}

main().catch(console.error);
