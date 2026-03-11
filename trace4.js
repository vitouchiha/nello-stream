const fs = require('fs');
let c = fs.readFileSync('src/toonitalia/index.js','utf8');
c = c.replace('const anyNumberMatch = cleanText.match(/\\b(\\d{1,2})\\b/);', 'const anyNumberMatch = cleanText.match(/\\b(\\d{1,2})\\b/);\nif (_.valueOf() === 1) console.log("anyNumberMatch inside:", anyNumberMatch);');
fs.writeFileSync('src/toonitalia/index.js', c);