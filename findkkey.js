const axios = require('axios');
const files = [
  'main.c582432abad915cc.js',
  'runtime.0f885fc17bc534b3.js',
  'polyfills.4e511b8c5c09b071.js',
  'scripts.075605d76f7d5f68.js',
  'common.js'
];
async function run() {
  for (const f of files) {
    let url = \https://kisskh.do/\\;
    try {
      const {data: text} = await axios.get(url);
      const hex = text.match(/['"][A-Fa-f0-9]{50,}['"]/g);
      if (hex) console.log(f, 'Hex:', hex);
      const b64 = text.match(/['"][A-Za-z0-9\+\/]{100,}={0,2}['"]/g);
      if (b64) console.log(f, 'B64:', b64);
    } catch(e) {}
  }
}
run();
