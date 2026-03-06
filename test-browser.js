const puppeteer = require('puppeteer-core');

async function run() {
  const wsUrl = 'wss://chrome.browserless.io?token=2U5ZUsJBo4unrL5dd8d7724def5cdf80defda1d69f75efb38';
  console.log('Connecting...');
  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  
  let streamCount = 0;
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (u.includes('.m3u8')) {
        console.log('INTERCEPTED M3U8:', u);
        streamCount++;
    }
    req.continue();
  });
  
  console.log('Navigating...');
  await page.goto('https://kisskh.do/Drama/Our-Universe/Episode-1?id=8044&ep=204528', { waitUntil: 'domcontentloaded' });
  console.log('Title:', await page.title());
  
  for(let i=0; i<15; i++) {
     await new Promise(r => setTimeout(r, 1000));
     const t = await page.title();
     console.log('Title:', t);
     if (t && t.includes('Just a moment')) {
       console.log('Cloudflare Turnstile active...');
     } else if (!t.includes('moment')) {
       break;
     }
  }

  // try click play
  try {
     await page.evaluate(() => {
        let el = document.querySelector('.vjs-big-play-button') || document.querySelector('video');
        if (el) el.click();
     });
     console.log('Clicked play!');
  } catch(e) {}
  
  for(let i=0; i<10; i++) {
     await new Promise(r => setTimeout(r, 1000));
     if (streamCount > 0) break;
  }
  
  console.log('Done.');
  await browser.close();
}
run().catch(console.error);
