'use strict';

/**
 * Rama Oriental Fansub provider
 * Source: https://ramaorientalfansub.live
 *
 * Provides:
 *   - getCatalog(skip, search)   → [{id, type, name, poster, ...}]
 *   - getMeta(id)                → {meta}
 *   - getStreams(id)              → [{title, url, behaviorHints}]
 */

const cheerio = require('cheerio');
const { fetchWithCloudscraper } = require('../utils/fetcher');
const { TTLCache } = require('../utils/cache');
const { extractBaseSlug } = require('../utils/titleHelper');
const { wrapStreamUrl } = require('../utils/mediaflow');
const { createLogger } = require('../utils/logger');

const log = createLogger('rama');

const BASE_URL = 'https://ramaorientalfansub.live';
const CATALOG_PATH = '/paese/corea-del-sud/';
const ITEMS_PER_PAGE = 20;
const MAX_PAGES = 35;

const catalogCache = new TTLCache({ ttl: 10 * 60_000, maxSize: 200 });
const metaCache    = new TTLCache({ ttl: 30 * 60_000, maxSize: 500 });
const streamCache  = new TTLCache({ ttl: 60 * 60_000, maxSize: 1000 });

// ─── Catalog ─────────────────────────────────────────────────────────────────

/**
 * @param {number} [skip=0]
 * @param {string} [search='']
 * @returns {Promise<Array>}
 */
async function getCatalog(skip = 0, search = '', config = {}) {
  const cacheKey = `catalog:${skip}:${search}`;
  const cached = catalogCache.get(cacheKey);
  if (cached) {
    log.debug('catalog from cache', { skip, search });
    return cached;
  }

  const items = [];
  const searchQuery = search.trim().toLowerCase();
  const startPage = Math.floor(skip / ITEMS_PER_PAGE) + 1;

  let pageNumber = startPage;
  while (items.length < ITEMS_PER_PAGE && pageNumber <= MAX_PAGES) {
    const url = `${BASE_URL}${CATALOG_PATH}page/${pageNumber}/`;
    log.info(`fetching catalog page ${pageNumber}`, { url });
    const html = await fetchWithCloudscraper(url, { referer: BASE_URL + CATALOG_PATH, proxyUrl: config.proxyUrl });
    if (!html) break;

    const $ = cheerio.load(html);
    const pageItems = [];

    // Cards use class "kira-anime" — title comes from img alt attribute
    $('div.kira-anime').each((_, el) => {
      const $el = $(el);
      // Href is on the parent container's first <a>
      const $card = $el.parent();
      const href = $card.find('a[href*="/drama/"]').first().attr('href')
        || $card.parent().find('a[href*="/drama/"]').first().attr('href')
        || $el.find('a[href*="/drama/"]').first().attr('href')
        || '';

      const img = $el.find('img').first();
      const poster = img.attr('src') || img.attr('data-src') || '';
      // Title from img alt, cleanup " thumbnail" and "(year)"
      const rawTitle = img.attr('alt') || '';
      const title = _cleanTitle(
        rawTitle.replace(/\s*thumbnail\s*$/i, '').replace(/\s*\(\d{4}\)\s*$/, '').trim()
      );

      if (!href || !title) return;

      const slug = href.replace(/\/$/, '').split('/').pop() || '';
      const id = `rama_${slug}`;

      if (searchQuery && !title.toLowerCase().includes(searchQuery) && !slug.includes(searchQuery)) return;

      pageItems.push({
        id,
        type: 'kdrama',
        name: title,
        poster,
        posterShape: 'poster',
      });
    });

    items.push(...pageItems);
    if (pageItems.length < 5) break; // No more results
    pageNumber++;
  }

  const result = items.slice(0, ITEMS_PER_PAGE);
  catalogCache.set(cacheKey, result);
  log.info(`catalog: found ${result.length} items`, { skip, search });
  return result;
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} id  e.g. "rama_my-drama-2023"
 * @returns {Promise<{meta: object}>}
 */
async function getMeta(id, config = {}) {
  // Strip episode part from composite IDs like "rama_my-drama:episodio-1"
  const seriesId = id.includes(':') ? id.split(':')[0] : id;

  const cached = metaCache.get(seriesId);
  if (cached) {
    log.debug('meta from cache', { id: seriesId });
    return { meta: cached };
  }

  const baseId = extractBaseSlug(seriesId.replace(/^rama_/, ''));
  const seriesUrl = `${BASE_URL}/drama/${baseId}/`;
  log.info('fetching meta', { id, seriesUrl });

  const html = await fetchWithCloudscraper(seriesUrl, { referer: BASE_URL, proxyUrl: config.proxyUrl });
  if (!html) {
    log.warn('meta fetch returned null', { id });
    return { meta: _emptyMeta(seriesId) };
  }

  const $ = cheerio.load(html);

  // Series title
  const name = $('a.text-accent, h1.entry-title, h1.series-title').first().text().trim()
    || $('.anime-title, .drama-title').first().text().trim()
    || baseId.replace(/-/g, ' ');

  // Status / episode count
  const status = $('span.font-normal:nth-child(1)').text().trim();
  let show = '';
  let rating = '';
  let adultFlag = '';

  $('li.list-none').each((_, el) => {
    const text = $(el).text().trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
    if (text.includes('Episodi')) show = text;
    if (text.includes('Valutazione')) {
      rating = text;
      if (/18\+|Restricted/i.test(text)) adultFlag = ' 🔞 ';
    }
    if (show && rating) return false;
  });

  const poster = $('.anime-image > img, .series-poster img, .entry-image img').first().attr('src') || '';
  const descBody = $('div.font-light > div:nth-child(1)').text().trim()
    || $('.serie-description, .entry-content').first().text().trim();
  const description = [status && `Stato: ${status}`, show, rating + adultFlag, descBody]
    .filter(Boolean).join('\n');

  // Year from title tag
  let year = null;
  const titleText = $('title').text();
  const yearMatch = titleText.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) year = yearMatch[0];

  const meta = {
    id: seriesId,
    type: 'kdrama',
    name,
    poster,
    description,
    releaseInfo: year || '',
    seriesUrl,
    baseId,
    year,
  };

  // Fetch episodes and embed in meta for stream handler
  meta.episodes = await _getEpisodes(seriesUrl, $, baseId, year);

  // Map to Stremio videos format
  meta.videos = meta.episodes.map((ep, idx) => ({
    id: `${seriesId}:${ep.id}`,
    title: ep.title,
    season: 1,
    number: idx + 1,
    thumbnail: ep.thumbnail || '',
    released: new Date(0).toISOString(),
  }));

  metaCache.set(seriesId, meta);
  return { meta };
}

// ─── Stream ───────────────────────────────────────────────────────────────────

/**
 * @param {string} id  e.g. "rama_my-drama-2023"
 * @returns {Promise<Array>}
 */
async function getStreams(id, config = {}) {
  // id can be 'rama_my-drama' (series) or 'rama_my-drama:episodio-3' (specific episode)
  const colonIdx = id.indexOf(':');
  const seriesId  = colonIdx !== -1 ? id.slice(0, colonIdx) : id;
  const episodeId = colonIdx !== -1 ? id.slice(colonIdx + 1) : null;

  // Cache key includes episode so different episodes don't collide
  const cacheKey = episodeId ? `${seriesId}:${episodeId}` : seriesId;
  const cached = streamCache.get(cacheKey);
  if (cached) {
    log.debug('streams from cache', { cacheKey });
    return cached.map(s => ({ ...s, url: wrapStreamUrl(s.url, config) }));
  }

  const { meta } = await getMeta(seriesId, config);
  if (!meta || !meta.episodes || !meta.episodes.length) {
    log.warn('no episodes found for streams', { id });
    return [];
  }

  // Find the specific episode requested (if episodeId given)
  const episodes = episodeId
    ? meta.episodes.filter(ep => ep.id === episodeId)
    : meta.episodes;

  if (!episodes.length) {
    log.warn('episode not found in meta', { episodeId, available: meta.episodes.map(e => e.id) });
    return [];
  }

  // Fetch stream URLs lazily — only for the episode(s) we need
  const rawStreams = [];
  for (const ep of episodes) {
    const streamUrl = await _getStreamFromEpisodePage(ep.link);
    if (streamUrl) {
      rawStreams.push({
        name: '🚀 Rama',
        description: `📁 ${meta.name} - ${ep.title}\n👤 Rama Oriental Fansub\n🇮🇹`,
        url: streamUrl,
        behaviorHints: { bingeGroup: `streamfusion-rama-${seriesId}` },
      });
    }
  }

  if (!rawStreams.length) {
    log.warn('no stream URLs found', { id });
    return [];
  }

  streamCache.set(cacheKey, rawStreams);
  return rawStreams.map(s => ({ ...s, url: wrapStreamUrl(s.url, config) }));
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _getEpisodes(seriesUrl, $, seriesId, year) {
  // Extract episode links directly from swiper — MUCH more reliable than constructing URLs.
  // Slides are in reverse order (newest first), so we reverse to get ep1 first.
  const slides = [];

  $('.swiper-slide').each((_, el) => {
    const $slide = $(el);
    const anchor = $slide.find('a[href*="/watch/"]').first();
    const link = anchor.attr('href') || '';
    if (!link) return;
    const img = $slide.find('img').first();
    const thumbnail = img.attr('src') || img.attr('data-src') || '';
    // Extract episode number from URL like /watch/.../episodio-16/
    const epMatch = link.match(/episodio-(\d+)/i);
    const epNum = epMatch ? parseInt(epMatch[1], 10) : slides.length + 1;
    slides.push({ epNum, link, thumbnail });
  });

  // Sort by episode number ascending and deduplicate
  slides.sort((a, b) => a.epNum - b.epNum);

  const episodes = slides.map(s => ({
    id: `episodio-${s.epNum}`,
    title: `Episodio ${s.epNum}`,
    thumbnail: s.thumbnail,
    link: s.link,
  }));

  log.info(`fetched ${episodes.length} episodes`, { seriesId });
  return episodes;
}

async function _getStreamFromEpisodePage(episodeLink) {
  const cacheKey = `stream:${episodeLink}`;
  const cached = streamCache.get(cacheKey);
  if (cached) return cached;

  log.debug('fetching episode page', { episodeLink });
  const html = await fetchWithCloudscraper(episodeLink, { referer: BASE_URL, timeout: 15_000, proxyUrl: undefined });
  if (!html) return null;

  const $ = cheerio.load(html);
  let url = null;

  // Priority 1 — iframe inside episode player box
  const iframe = $('div.episode-player-box iframe');
  if (iframe.length) {
    url = iframe.attr('src') || iframe.attr('data-src');
  }

  // Priority 2 — <video> source tag
  if (!url) {
    const source = $('video[name="media"] source, video source');
    if (source.length) url = source.attr('src');
  }

  // Priority 3 — direct stream link anchor
  if (!url) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (/\.(m3u8|mp4)/i.test(href) || href.includes('streamingrof')) {
        url = href;
        return false;
      }
    });
  }

  // Priority 4 — scan page source for m3u8/mp4
  if (!url) {
    const match = html.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/);
    if (match) url = match[1];
  }

  if (url) {
    url = decodeURI(url);
    streamCache.set(cacheKey, url, 2 * 60 * 60_000); // 2h TTL for individual streams
    log.info('stream found', { episodeLink, url: url.slice(0, 60) });
  } else {
    log.warn('no stream found', { episodeLink });
  }

  return url;
}

function _cleanTitle(raw) {
  const words = raw.trim().split(/\s+/);
  const seen = new Set();
  return words.filter(w => { if (seen.has(w)) return false; seen.add(w); return true; }).join(' ');
}

function _emptyMeta(id) {
  return { id, type: 'kdrama', name: id.replace(/^rama_/, '').replace(/-/g, ' '), episodes: [] };
}

module.exports = { getCatalog, getMeta, getStreams };
