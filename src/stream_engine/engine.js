const fs = require('fs');

const easystreamsAdapter = require('../scrapers/easystreams_adapter');
const baciasiaticiAdapter = require('../scrapers/baciasiatici_adapter');
const cacheLayer = require('../cache/cache_layer');

const PROVIDERS = {
    easystreams: easystreamsAdapter,
    baciasiatici: baciasiaticiAdapter
};

/**
 * Normalizes multiple results into standard schema, dedupes, and ranks
 */
class StreamDiscoveryEngine {
    constructor() {
        this.cache = cacheLayer;
        // Priorità configurabile se necessaria
        this.langPriority = ['it', 'en'];
        this.qualityPriority = ['4K', '1080p', '720p', 'SD', 'unknown'];
    }

    async discover(query, contentId) {
        const cacheKey = `streams_${contentId}`;
        const cached = await this.cache.get(cacheKey);
        
        if (cached) {
            console.log(`[Engine] Returning cached results for ${contentId}`);
            return cached;
        }

        console.log(`[Engine] Discovering streams for ${query} (${contentId})...`);

        // Esegue le richieste in parallelo con timeout
        const promises = Object.entries(PROVIDERS).map(([name, adapter]) => 
            this.runProviderWithTimeout(name, adapter, query, contentId, 10000)
        );

        const results = await Promise.allSettled(promises);
        
        let allStreams = [];
        for (const res of results) {
            if (res.status === 'fulfilled' && res.value) {
                allStreams.push(...res.value);
            }
        }

        // Deduplication
        const uniqueStreams = this.deduplicate(allStreams);

        // Ranking
        const rankedStreams = this.rank(uniqueStreams);

        // Salva in cache (15 min default TTL definita in cache layer)
        await this.cache.set(cacheKey, rankedStreams, this.cache.TTL_STREAM);

        return rankedStreams;
    }

    async runProviderWithTimeout(name, adapter, query, contentId, ms) {
        return Promise.race([
            adapter.search(query).then(() => adapter.get_links(contentId)).then(links => adapter.parse_page(null)), // Mock chain
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
        ]).catch(e => {
            console.error(`[Engine] Provider ${name} failed: ${e.message}`);
            return [];
        });
    }

    deduplicate(streams) {
        const seenUrls = new Set();
        return streams.filter(s => {
            if (seenUrls.has(s.url)) return false;
            seenUrls.add(s.url);
            return true;
        });
    }

    rank(streams) {
        return streams.sort((a, b) => {
            // Priorità Lingua
            const langA = this.langPriority.indexOf(a.audio_lang) !== -1 ? this.langPriority.indexOf(a.audio_lang) : 99;
            const langB = this.langPriority.indexOf(b.audio_lang) !== -1 ? this.langPriority.indexOf(b.audio_lang) : 99;
            if (langA !== langB) return langA - langB;

            // Priorità Qualità
            const qualA = this.qualityPriority.indexOf(a.quality) !== -1 ? this.qualityPriority.indexOf(a.quality) : 99;
            const qualB = this.qualityPriority.indexOf(b.quality) !== -1 ? this.qualityPriority.indexOf(b.quality) : 99;
            if (qualA !== qualB) return qualA - qualB;

            return 0; // Default fallback
        });
    }
}

module.exports = new StreamDiscoveryEngine();
