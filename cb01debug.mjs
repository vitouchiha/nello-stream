// Quick CB01 movie fetch debug
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const base = 'https://cb01uno.digital';

function normalizeForSearch(title) {
  return String(title || '')
    .replace(/'/g, ' ')
    .replace(/[àá]/g, 'a').replace(/[èé]/g, 'e').replace(/[ìí]/g, 'i')
    .replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u').replace(/\s+/g, '+');
}

async function main() {
  const showname = 'Oppenheimer';
  const year = '2023';
  const query = normalizeForSearch(showname);
  const url = `${base}/?s=${query}`;
  console.log('Searching:', url);
  
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': `${base}/` },
    redirect: 'follow'
  });
  const html = await resp.text();
  console.log('Final URL:', resp.url, '| Status:', resp.status);
  
  const yearPattern = /(19|20)\d{2}/;
  const cardRe = /<div[^>]+class="card-content"[\s\S]*?<h3[^>]+class="card-title"[^>]*>\s*<a[^>]+href="([^"]+)"/gi;
  const cards = [...html.matchAll(cardRe)];
  console.log('Cards found:', cards.length);
  
  for (const m of cards) {
    const href = m[1];
    const slug = href.split('/').filter(Boolean).pop() || href;
    const yearMatch = yearPattern.exec(slug);
    const matchedYear = yearMatch ? yearMatch[0] : null;
    console.log(`  href: ${href.slice(0, 70)}`);
    console.log(`  slug year: ${matchedYear} | looking for: ${year} | match: ${matchedYear === year}`);
  }
  
  // Also check TMDB
  const tmdbResp = await fetch(`https://api.themoviedb.org/3/movie/872585?api_key=68e094699525b18a70bab2f86b1fa706&language=it-IT`);
  const tmdbData = await tmdbResp.json();
  console.log('\nTMDB:', tmdbData.title, '|', tmdbData.release_date);
}
main().catch(console.error);
