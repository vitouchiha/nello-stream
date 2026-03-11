// Quick CB01 test script
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function main() {
  const base = 'https://cb01uno.digital';
  const resp = await fetch(`${base}/?s=Oppenheimer`, {
    headers: { 'User-Agent': UA, 'Referer': `${base}/` },
    redirect: 'follow'
  });
  const html = await resp.text();
  console.log('Final URL:', resp.url);
  console.log('HTML length:', html.length);
  
  // Card parsing
  const cardRe = /<div[^>]+class="card-content"[\s\S]*?<h3[^>]+class="card-title"[^>]*>\s*<a[^>]+href="([^"]+)"/gi;
  const cards = [...html.matchAll(cardRe)];
  console.log('Cards found:', cards.length);
  cards.slice(0, 5).forEach(m => {
    const slug = m[1].split('/').filter(Boolean).pop() || '';
    const year = /(19|20)\d{2}/.exec(slug);
    console.log('  slug:', slug.slice(0, 60), '| year:', year ? year[0] : 'none');
  });
}
main().catch(console.error);
