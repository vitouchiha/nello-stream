const {fetchWithAxios} = require('./src/utils/fetcher.js');
const cheerio = require('cheerio');
(async () => {
    const html = await fetchWithAxios('https://toonitalia.xyz/guru-guru-il-girotondo-della-magia/', { responseType: 'text' });
    const $ = cheerio.load(html);
    const entryContent = $('.entry-content');
    
    let voeLinks = entryContent.find('a[href*="voe.sx"], a[href*="voe."], a[href*="chuckle-tube.com"]');
    console.log('VOE Links Found:', voeLinks.length);

    voeLinks.each((_, el) => {
        const voeUrl = $(el).attr('href');
        const parent = $(el).parent();
        const parentHtml = parent.html() || "";
        const linkHrefIndex = parentHtml.indexOf(`href="${voeUrl}"`);
        const startIndex = Math.max(0, linkHrefIndex - 200);
        const textBeforeLink = parentHtml.substring(startIndex, linkHrefIndex);
        const cleanText = textBeforeLink.replace(/<[^>]*>/g, " ").trim();
        console.log('cleanText:', cleanText);
    });

})();