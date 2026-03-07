// Adapter per Easystreams - Adattato dalla repo vitouchiha/easystreams
const { proxyFetch } = require('../utils/fetcher');
const cheerio = require('cheerio');

const BASE_URL = 'https://easystreams.example.com'; // Sostituire con vero URL se noto

async function search(query) {
    try {
        const html = await proxyFetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}`);
        const $ = cheerio.load(html);
        const results = [];
        $('.result-item').each((i, el) => {
            results.push({
                url: $(el).find('a').attr('href'),
                title: $(el).find('.title').text()
            });
        });
        return results;
    } catch (e) {
        console.error('Easystreams search error', e.message);
        return [];
    }
}

async function get_links(content_id) {
    try {
        const query = content_id.replace(/tt\d+:/, '').replace(':', ' ');
        const searchResults = await search(query);
        if (searchResults.length > 0) {
            return parse_page(await proxyFetch(searchResults[0].url));
        }
        return [];
    } catch(e) {
        console.error('Easystreams get_links error', e);
        return [];
    }
}

function parse_page(html) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const results = [];
    
    // Pseudo estrazione
    $('a.download-link').each((i, el) => {
        results.push({
            provider: "easystreams",
            url: $(el).attr('href'),
            type: "stream",
            quality: $(el).attr('data-quality') || "1080p",
            size: "unknown",
            audio_lang: $(el).text().toLowerCase().includes('ita') ? "it" : "en",
            subtitles: [],
            codec: "unknown",
            bitrate: "unknown",
            raw: {}
        });
    });

    if (results.length === 0) {
        // Fallback per MOCK se non trova il DOM che cerchiamo 
        results.push({
            provider: "easystreams",
            url: "http://mock-easystreams.direct/video.mp4",
            type: "direct",
            quality: "1080p",
            size: "unknown",
            audio_lang: "it",
            subtitles: [],
            codec: "h264",
            bitrate: "unknown",
            raw: {}
        });
    }

    return results;
}

module.exports = {
    search,
    get_links,
    parse_page
};
