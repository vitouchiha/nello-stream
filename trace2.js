const fs = require('fs');
let c = fs.readFileSync('src/toonitalia/index.js','utf8');
c = c.replace('voeLinks.each((_, el) => {', 'console.log("voeLinks count inside index.js:", voeLinks.length);\nvoeLinks.each((_, el) => {');
fs.writeFileSync('src/toonitalia/index.js', c);