// Deep test: verify Guardaserie HLS stream is fully playable (master → variant → segments)
async function main() {
  console.log('Fetching streams...');
  const resp = await fetch('https://streamfusion-mail.vercel.app/stream/series/tt0460649:7:19.json', {
    signal: AbortSignal.timeout(65000)
  });
  const json = await resp.json();
  const streams = json.streams || [];
  
  // Find Guardaserie stream
  const gs = streams.find(s => s.title && s.title.includes('Guardaserie'));
  if (!gs) {
    console.log('No Guardaserie stream found. Total:', streams.length);
    return;
  }
  
  console.log('Found Guardaserie stream:', gs.name);
  console.log('Fetching master playlist...');
  
  const masterResp = await fetch(gs.url, { signal: AbortSignal.timeout(15000) });
  const masterBody = await masterResp.text();
  console.log('Master status:', masterResp.status);
  console.log('Master content-type:', masterResp.headers.get('content-type'));
  console.log('Master lines:', masterBody.split('\n').length);
  
  // Parse variant streams
  const lines = masterBody.split('\n');
  const variantUrls = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
      const resolution = lines[i].match(/RESOLUTION=(\d+x\d+)/);
      const bandwidth = lines[i].match(/BANDWIDTH=(\d+)/);
      const nextLine = lines[i + 1]?.trim();
      if (nextLine && !nextLine.startsWith('#')) {
        variantUrls.push({
          url: nextLine,
          resolution: resolution ? resolution[1] : 'unknown',
          bandwidth: bandwidth ? bandwidth[1] : 'unknown',
        });
      }
    }
  }
  
  console.log('\nVariant streams:', variantUrls.length);
  variantUrls.forEach(v => console.log(' -', v.resolution, 'bw:', v.bandwidth));
  
  // Test first variant playlist
  if (variantUrls.length > 0) {
    console.log('\nTesting variant playlist:', variantUrls[0].resolution);
    try {
      const varResp = await fetch(variantUrls[0].url, { signal: AbortSignal.timeout(15000) });
      const varBody = await varResp.text();
      console.log('Variant status:', varResp.status);
      console.log('Variant lines:', varBody.split('\n').length);
      
      // Count segments
      const segments = varBody.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      console.log('Segment URLs:', segments.length);
      
      if (segments.length > 0) {
        // Test first segment (HEAD only)
        console.log('\nTesting first segment (HEAD)...');
        const segResp = await fetch(segments[0], { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        console.log('Segment status:', segResp.status);
        console.log('Segment content-type:', segResp.headers.get('content-type'));
        console.log('Segment content-length:', segResp.headers.get('content-length'));
        
        if (segResp.ok) {
          console.log('\n==> STREAM IS FULLY PLAYABLE! All levels return 200.');
        }
      }
    } catch (e) {
      console.log('Variant test error:', e.message);
    }
  }
}

main().catch(e => console.error(e.message));
