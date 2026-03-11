const to = require('./src/toonitalia/index.js');
(async () => {
    try {
        let ogGetStreams = to.getStreams;
        const res = await to.getStreams('tt0330592', 'series', 1, 1);
        console.log('RES:', res.length);
    } catch(e) { console.error('E:', e); }
})();
