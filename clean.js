const fs = require('fs'); let code = fs.readFileSync('src/toonitalia/index.js', 'utf8');
const linesToRemove = [
  'console.log(\\'sections:\\', sections.length, sections.map(s=>s.text));',
  'console.log(\\'voeLinks count inside index.js:\\', voeLinks.length);',
  'if (_.valueOf() === 1) console.log(\\'CHARS:\\', cleanText.split(\\'\\').map(c => c.charCodeAt(0)));',
  'if (_.valueOf() === 1) console.log(\\'anyNumberMatch:\\', anyNumberMatch);',
  'console.log(\\'GET STREAMS\\', id);',
  'console.log(\\'seriesName\\', seriesName, \\'contentUrl\\', contentUrl);',
  'console.log(\\'extracting episodes from\\', contentUrl);',
  'console.log(\\'found eps length:\\', episodes.length);'
];
for(let l of linesToRemove) { code = code.split(l).join(''); }
fs.writeFileSync('src/toonitalia/index.js', code);
