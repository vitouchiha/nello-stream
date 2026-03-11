const {fetchWithAxios} = require('./src/utils/fetcher.js');
const cheerio = require('cheerio');
(async () => {
    const html = await fetchWithAxios('https://toonitalia.xyz/guru-guru-il-girotondo-della-magia/', { responseType: 'text' });
    const $ = cheerio.load(html);
    const entryContent = $('.entry-content');
    console.log("HTML:", entryContent.html().substring(0, 1000));
    const voeLinks = entryContent.find('a[href*="voe.sx"], a[href*="voe."], a[href*="chuckle-tube.com"]');
    console.log('VOE Links Found:', voeLinks.length);
})();