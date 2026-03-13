'use strict';

// Simulate Vercel environment — force Worker path
process.env.CF_WORKER_URL = 'https://kisskh-proxy.vitobsfm.workers.dev';
process.env.CF_WORKER_AUTH = 'PJxVzfuySO5IkMGec1pZsFvWDNbiHRE6jULnB2t3';

const eurostreaming = require('./src/eurostreaming');

async function test() {
  const tests = [
    { name: 'The Witcher S1E1', imdb: 'tt5180504', tmdb: '71912', title: 'The Witcher', s: 1, e: 1 },
    { name: 'Breaking Bad S1E1', imdb: 'tt0903747', tmdb: '1396', title: 'Breaking Bad', s: 1, e: 1 },
    { name: 'Stranger Things S1E1', imdb: 'tt4574334', tmdb: '66732', title: 'Stranger Things', s: 1, e: 1 },
  ];

  for (const t of tests) {
    const start = Date.now();
    console.log(`\n=== ${t.name} ===`);
    const ctx = { __requestContext: true, idType: 'imdb', imdbId: t.imdb, tmdbId: t.tmdb,
      primaryTitle: t.title, titleCandidates: [t.title], mfpUrl: 'https://easy.koyeb.app/', addonBaseUrl: '' };
    try {
      const streams = await eurostreaming.getStreams(t.imdb, 'series', t.s, t.e, ctx);
      console.log(`Result: ${streams.length} streams in ${Date.now() - start}ms`);
      for (const s of streams) console.log(`  - ${s.name} | ${(s.title || '').substring(0, 60)}`);
    } catch (err) { console.error('Error:', err.message); }
  }
}

test();
