const to = require('./src/toonitalia/index.js');
(async () => {
    try {
        const res = await to.getStreams('tt0330592', 'series', 1, 1);
        console.dir(res, {depth: null});
    } catch(e) { console.error('E:', e); }
})();
