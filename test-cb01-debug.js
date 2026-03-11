const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const base = 'https://cb01uno.uno';

async function main() {
  // Test movie search
  let res = await fetch(base + '/?s=The+Batman', {
    headers: { 'User-Agent': UA, 'Referer': base + '/' },
    redirect: 'follow'
  });
  console.log('Movie search status:', res.status, 'Final URL:', res.url);
  let html = await res.text();
  
  // Check what cards look like
  const cardMatches = [...html.matchAll(/href="([^"]+\/\d{4}[^"]*)"[^>]*>([^<]+)<\/a>/gi)];
  console.log('Year-slug hrefs found:', cardMatches.length);
  cardMatches.slice(0, 5).forEach(m => console.log(m[1], '->', m[2].trim()));
  
  // Raw check around card-content
  const idx = html.indexOf('card-content');
  if (idx > 0) {
    console.log('\nFirst card-content snippet:\n', html.substring(idx - 50, idx + 500));
  } else {
    console.log('card-content NOT found in HTML!');
    console.log('First 1000 chars:', html.substring(0, 1000));
  }
}
main().catch(console.error);
