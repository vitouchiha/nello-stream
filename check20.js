const gs = require('./src/guardaserie/index.js');
(async () => {
    try {
        const res = await gs.getStreams('tt0330592', 'series', 1, 1);
        console.dir(res, {depth: null});
    } catch(e) { console.error('E:', e); }
})();
