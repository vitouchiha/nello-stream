const au = require('./src/animeunity/index'); au.getStreams('tt3909224:1:1', 'series', '1', '1', {imdbId: 'tt3909224', tmdbId: '62104'}).then(s => console.log('Final:', s)).catch(console.error);
