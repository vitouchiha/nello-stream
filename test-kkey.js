const axios = require('axios');

async function run() {
  try {
    const { data: html } = await axios.get('https://kisskh.do');
    const jsMatches = [...html.matchAll(/src="([^"]+\.js(?:\?v=\d+)?)"/g)];
    for (const match of jsMatches) {
      const jsUrl = match[1].startsWith('http') ? match[1] : ('https://kisskh.do/' + match[1]);
      if (jsUrl.includes('google') || jsUrl.includes('cloudflare')) continue;
      console.log('Downloading JS:', jsUrl);
      try {
        const { data: jsCode } = await axios.get(jsUrl);
        const kkeyMatch = jsCode.match(/kkey\s*:\s*(?:'|")([^'"]{50,})(?:'|")/);
        if (kkeyMatch) {
           console.log('FOUND NEW KKEY:', kkeyMatch[1]);
        }
      } catch (e) {
        console.error('Err downloading JS', e.message);
      }
    }
  } catch (err) {
    console.error(err.message);
  }
}
run();
