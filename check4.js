const to = require('./src/toonitalia/index.js');
const {fetchWithAxios} = require('./src/utils/fetcher.js');
const cheerio = require('cheerio');
(async () => {
    const normalizeForMatch = (str) => {
      return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
    };
    const searchQuery = 'guru guru il girotondo della magia';
    const html = await fetchWithAxios('https://toonitalia.xyz/?s=guru+guru+il+girotondo+della+magia', { responseType: 'text' });
    const $ = cheerio.load(html);
    const articles = \article.post;
    console.log('articles count: ', articles.length);
    for (let i = 0; i < articles.length; i++) {
        const article = articles.eq(i);
        const titleLink = article.find('.entry-title a');
        const title = titleLink.text().trim();
        const titleNormalized = normalizeForMatch(title);
        const searchNormalized = normalizeForMatch(searchQuery);
        console.log(title, '||', titleNormalized, '||', searchNormalized);
        if (titleNormalized.includes(searchNormalized)) {
            console.log('MATCH!');
        }
    }
})();
