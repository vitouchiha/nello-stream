const fs = require('fs');
let code = fs.readFileSync('src/toonitalia/index.js', 'utf8');
code = code.replace('const anyNumberMatch = cleanText.match(/\\\\b(\\\\d{1,2})\\\\b/);', 'const anyNumberMatch = cleanText.match(/\\\\b(\\\\d{1,2})\\\\b/); console.log(\\'anyNumMatch\\', anyNumberMatch);');
fs.writeFileSync('src/toonitalia/index.js', code);
