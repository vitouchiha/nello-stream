const fs = require('fs');
let c = fs.readFileSync('src/toonitalia/index.js','utf8');
c = c.replace('return;', '/*return*/;');
c = c.replace('const cleanText = textBeforeLink.replace(/<[^>]*>/g, " ").trim();', 'const cleanText = textBeforeLink.replace(/<[^>]*>/g, " ").trim();\nif (_.valueOf() === 1) console.log("cleanText inside:", cleanText);');
fs.writeFileSync('src/toonitalia/index.js', c);