const {fetchWithAxios} = require('./src/utils/fetcher.js');
const cheerio = require('cheerio');
fetchWithAxios('https://toonitalia.xyz/guru-guru-il-girotondo-della-magia/', { responseType: 'text' }).then(html => {
    const $ = cheerio.load(html);
    const h3 = $('h3').eq(1);
    console.log("TEXT:", h3.text());
    let curr = h3.next();
    console.log("NEXT:", $.html(curr).substring(0, 100));
    let i = 0;
    while(curr.length && i < 3) {
        console.log("loop", i, $.html(curr).substring(0, 50));
        curr = curr.next();
        i++;
    }
});