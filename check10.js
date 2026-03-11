const to = require('./src/toonitalia/index.js');
(async () => {
    // Let's modify index.js locally again with some console.logs to spy sections
    const fs = require('fs');
    let c = fs.readFileSync('src/toonitalia/index.js', 'utf8');
    // I can just replace the function body of extractEpisodes temporarily to see
    // wait I'll do this in memory
})();