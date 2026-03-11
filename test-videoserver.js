'use strict';
// Test videoserver.loonex.eu with proper headers
(async () => {
  const epUrl = 'https://videoserver.loonex.eu/episodi/101/S01E003/output.m3u8';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

  console.log('With Referer+Origin headers:');
  const resp = await fetch(epUrl, {
    headers: {
      'User-Agent': UA,
      'Origin': 'https://loonex.eu',
      'Referer': 'https://loonex.eu/',
    }
  });
  console.log('Status:', resp.status, 'Type:', resp.headers.get('content-type'));
  const text = await resp.text();
  console.log('First 200 chars:', text.slice(0, 200));
  if (text.startsWith('#EXTM3U')) console.log('>>> It IS an m3u8!');
})().catch(e => console.error(e.message));
