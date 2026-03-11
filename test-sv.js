

async function testSV() {
try {
  let html = await fetch('https://supervideo.tv/e/05jfivnr5hiw', {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.7,en;q=0.6',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    }
  }).then(r=>r.text());
  
  const m = html.match(/}\('(.+?)',.+,'(.+?)'\.split/);
  if (!m) return console.log('no match', html.length, html.includes('Cloudflare') ? 'cloudflare' : '');
  const terms = m[2].split('|');
  const fileIndex = terms.indexOf('file'); if (fileIndex === -1) return console.log('no file');
  let hfs = ''; for (let i = fileIndex; i < terms.length; i++) { if (terms[i].includes('hfs')) { hfs = terms[i]; break; } }
  if (!hfs) return console.log('no hfs');
  const urlsetIndex = terms.indexOf('urlset'); 
  const hlsIndex = terms.indexOf('hls2') !== -1 ? terms.indexOf('hls2') : terms.indexOf('hls');
  if (urlsetIndex === -1 || hlsIndex === -1 || hlsIndex <= urlsetIndex) return console.log('no urlset/hls idx', urlsetIndex, hlsIndex);
  const slice = terms.slice(urlsetIndex + 1, hlsIndex).reverse();
  let base = 'https://' + hfs + '.serversicuro.cc/' + terms[hlsIndex] + '/';
  if (slice.length === 1) return console.log('Result:', base + ',' + slice[0] + '.urlset/master.m3u8');
  slice.forEach((el, idx) => { base += el + ',' + (idx === slice.length - 1 ? '.urlset/master.m3u8' : ''); });
  console.log('Result:', base);
} catch (e) { console.error(e); }
}

testSV();
