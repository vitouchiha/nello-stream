async function main() {
  console.log('Fetching streams...');
  const resp = await fetch('https://streamfusion-mail.vercel.app/stream/series/tt0460649:7:19.json', {
    signal: AbortSignal.timeout(65000)
  });
  const json = await resp.json();
  const streams = json.streams || [];
  console.log('Total:', streams.length);
  
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    const name = (s.title || '').split('\n')[0];
    const provider = (s.title || '').split('\n').find(l => l.includes('🐾')) || 'unknown';
    console.log(`\n[${i + 1}] ${s.name} - ${name}`);
    console.log(`    provider: ${provider.trim()}`);
    console.log('    type:', s.url ? 'inline' : 'external');
    
    if (s.url && s.url.includes('/proxy/hls/')) {
      // Decode the token to check for proxy URL
      try {
        const tokenParam = new URL(s.url).searchParams.get('token');
        if (tokenParam) {
          const payloadPart = tokenParam.split('.')[0];
          const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
          console.log('    upstream:', (decoded.u || '').substring(0, 120));
          console.log('    has proxy:', !!decoded.p);
          if (decoded.p) console.log('    proxy:', decoded.p.replace(/:[^:@]+@/, ':***@'));
        }
      } catch(e) { console.log('    token decode error:', e.message); }
      
      try {
        const pr = await fetch(s.url, { signal: AbortSignal.timeout(15000) });
        const body = await pr.text();
        const isHls = body.includes('#EXTM3U');
        console.log('    proxy status:', pr.status, '| content-type:', pr.headers.get('content-type'));
        console.log('    valid HLS:', isHls, '| body size:', body.length);
        if (!isHls) console.log('    body:', body.substring(0, 300));
      } catch(e) {
        console.log('    proxy error:', e.message);
      }
    }
  }
}

main().catch(e => console.error(e.message));
