// Debug movie page structure
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function main() {
  const resp = await fetch('https://cb01uno.digital/oppenheimer-hd-2023/', {
    headers: { 'User-Agent': UA },
    redirect: 'follow'
  });
  const html = await resp.text();
  console.log('Status:', resp.status, '| URL:', resp.url);
  
  // Check for iframen2 (primary MixDrop link)
  const m2 = /id="iframen2"[^>]+data-src="([^"]+)"/.exec(html)
    || /data-src="([^"]+)"[^>]+id="iframen2"/.exec(html);
  const m1 = /id="iframen1"[^>]+data-src="([^"]+)"/.exec(html)
    || /data-src="([^"]+)"[^>]+id="iframen1"/.exec(html);
  
  console.log('iframen2 (expected MixDrop):', m2 ? m2[1].slice(0, 80) : 'NOT FOUND');
  console.log('iframen1 (expected MaxStream):', m1 ? m1[1].slice(0, 80) : 'NOT FOUND');
  
  // Show all data-src attributes
  const allDataSrc = [...html.matchAll(/data-src="([^"]+)"/gi)];
  console.log('\nAll data-src:', allDataSrc.map(m => m[1].slice(0, 80)));
  
  // Show any iframe src
  const allSrc = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)];
  console.log('Iframe src:', allSrc.map(m => m[1].slice(0, 80)));
  
  // Look for stayonline
  if (html.includes('stayonline')) {
    const stays = [...html.matchAll(/stayonline[^"']+["']/gi)];
    console.log('stayonline refs:', stays.slice(0,3).map(m => m[0]));
  } else {
    console.log('NO stayonline found in page');
  }
  
  // Check any div with iframen
  const divs = [...html.matchAll(/<div[^>]*id="iframen\d+"[^>]*>/gi)];
  console.log('iframen divs:', divs.map(m => m[0].slice(0, 100)));
}
main().catch(console.error);
