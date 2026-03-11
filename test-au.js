const au = require('./src/animeunity/index'); au.getStreams('tt3909224:1:1', 'series', 1, 1).then(s => console.log(JSON.stringify(s, null, 2))).catch(console.error);
