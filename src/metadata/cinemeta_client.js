// Cinemeta Client Adapter
const fetcher = require('../utils/fetcher');
const BASE_URL = 'https://v3-cinemeta.strem.io';

async function fetchCinemeta(type, id) {
    try {
        const url = `${BASE_URL}/meta/${type}/${id}.json`;
        const response = await fetcher(url); // Assumes JSON returned
        return response.meta;
    } catch (e) {
        console.error('Cinemeta fetch error', e);
        return null;
    }
}

async function find_by_imdb(imdb_id, type = 'movie') {
    return await fetchCinemeta(type, imdb_id);
}

async function find_by_tmdb(tmdb_id, type = 'movie') {
    // Cinemeta prefix tmdb for some items: tmdb:ID
    return await fetchCinemeta(type, `tmdb:${tmdb_id}`);
}

async function fallback_search(title, year, type = 'movie') {
    // Advanced implementations could use search endpoints,
    // For Stremio Cinemeta, there's a catalog search
    try {
        const url = `${BASE_URL}/catalog/${type}/top/search=${encodeURIComponent(title)}.json`;
        const res = await fetcher(url);
        if (res.metas && res.metas.length > 0) {
            // Find best match by year
            return res.metas.find(m => m.year == year) || res.metas[0];
        }
    } catch (e) {
        console.error('Cinemeta search fallback error', e);
    }
    return null;
}

module.exports = {
    find_by_imdb,
    find_by_tmdb,
    fallback_search
};
