const to = require('./src/toonitalia/index.js');
(async () => {
    try {
        const res = await to.getStreams('tt0330592', 'series', 1, 1);
        console.log(JSON.stringify(res, null, 2));
    } catch(e) { console.error(e); }
})();