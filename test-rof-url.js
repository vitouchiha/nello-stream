'use strict';
// Test if server1.streamingrof.online ROF url is accessible
(async () => {
  const url = 'https://server1.streamingrof.online/02-DRAMACOREANI/Our%20Universe%20(2026)/Our%20Universe%20-%20S01E03%20%5BROF%5D%5BHDTV-720p%5D%5Bx264%5D.mp4';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  console.log('Testing URL:', url);
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA, 'Range': 'bytes=0-0' },
      redirect: 'follow',
    });
    console.log('Status:', resp.status);
    console.log('Content-Type:', resp.headers.get('content-type'));
    console.log('Content-Length:', resp.headers.get('content-length'));
    console.log('Accept-Ranges:', resp.headers.get('accept-ranges'));
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Also test if the base dir exists
  const dirUrl = 'https://server1.streamingrof.online/02-DRAMACOREANI/';
  console.log('\nTesting dir:', dirUrl);
  try {
    const resp2 = await fetch(dirUrl, { method: 'HEAD', headers: { 'User-Agent': UA } });
    console.log('Dir status:', resp2.status);
  } catch (e) {
    console.log('Dir error:', e.message);
  }
})();
