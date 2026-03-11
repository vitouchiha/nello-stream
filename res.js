const fs=require('fs'); let c=fs.readFileSync('src/loonex/index.js','utf16le'); fs.writeFileSync('src/loonex/index.js', c.trim().replace(/^|^\uFEFF/, ''), 'utf8');
