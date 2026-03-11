const fs = require('fs');
let c = fs.readFileSync('src/toonitalia/index.js','utf8');
c = c.replace('async function getStreams(id, type, season, episode, providerContext = null) {', 'async function getStreams(id, type, season, episode, providerContext = null) {\nconsole.log(\'GET STREAMS\', id);');
c = c.replace('if (!contentUrl) {', 'console.log(\'seriesName\', seriesName, \'contentUrl\', contentUrl);\nif (!contentUrl) {');
c = c.replace('const episodes = await extractEpisodes(contentUrl, tmdbSeasonCount, preferredSection);', 'console.log(\'extracting episodes from\', contentUrl);\nconst episodes = await extractEpisodes(contentUrl, tmdbSeasonCount, preferredSection);\nconsole.log(\'found eps length:\', episodes.length);');
c = c.replace('if (!episodes || episodes.length === 0) return [];', 'if (!episodes || episodes.length === 0) { console.log(\'NO EPS RETURNED\'); return []; }');
fs.writeFileSync('src/toonitalia/index.js', c);