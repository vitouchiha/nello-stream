const puppeteer = require('puppeteer-core');
async function r() {
  const b = await puppeteer.connect({ browserWSEndpoint: 'wss://chrome.browserless.io?token=2U5ZUsJBo4unrL5dd8d7724def5cdf80defda1d69f75efb38&--proxy-server=http://sdfmtjis-rotate:y7hpwm1hw1km@p.webshare.io:80' });
  const p = await b.newPage();
  console.log('trying goto');
  try {
    await p.goto('https://kisskh.do', {timeout: 15000});
    console.log('title:', await p.title());
  } catch(e) {
    console.log('Err:', e.message);
  }
  await b.close();
}
r();
