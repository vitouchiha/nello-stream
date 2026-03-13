// Simulates exact getStreams flow for Frieren S2E7 (tt22248376:2:7)
const animeunity = require('./src/animeunity/index');
const animesaturn = require('./src/animesaturn/index');

const providerContext = {
  __requestContext: true,
  idType: 'imdb',
  providerId: 'tt22248376',
  requestedSeason: 2,
  seasonProvided: false,
  kitsuId: '46474',
  tmdbId: '209867',
  imdbId: 'tt22248376',
  addonBaseUrl: '',
  mfpUrl: 'https://easy.koyeb.app/',
  mfpKey: '',
  proxyUrl: '',
  providers: null,
  primaryTitle: 'Frieren: Beyond Journey\'s End',
  titleCandidates: ['Frieren: Beyond Journey\'s End']
};

(async () => {
  console.log('=== AnimeUnity: getStreams("tt22248376", "series", 2, 7) ===');
  try {
    const mapping = require('./src/mapping/index');
    const r = await mapping.resolve('kitsu', '46474', { season: 2, episode: 7 });
    console.log('Mapping animeunity paths:', r?.mappings?.animeunity || 'NONE');
    console.log('Mapping animesaturn paths:', r?.mappings?.animesaturn || 'NONE');
    
    const auStreams = await animeunity.getStreams('tt22248376', 'series', 2, 7, providerContext);
    console.log(`\nAnimeUnity: ${auStreams.length} streams`);
    for (const s of auStreams.slice(0, 5)) {
      console.log(`  ${s.name} | ${(s.title || s.description || '').substring(0, 100)}`);
    }
  } catch(e) { console.error('AnimeUnity ERROR:', e.message); }

  console.log('\n=== AnimeSaturn: getStreams("tt22248376", "series", 2, 7) ===');
  try {
    const asStreams = await animesaturn.getStreams('tt22248376', 'series', 2, 7, providerContext);
    console.log(`AnimeSaturn: ${asStreams.length} streams`);
    for (const s of asStreams.slice(0, 5)) {
      console.log(`  ${s.name} | ${(s.title || s.description || '').substring(0, 100)}`);
    }
  } catch(e) { console.error('AnimeSaturn ERROR:', e.message); }

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
