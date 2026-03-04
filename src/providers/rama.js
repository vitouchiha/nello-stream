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
async function getCatalog(skip = 0, search = '') {
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
    const html = await fetchWithCloudscraper(url, { referer: BASE_URL + CATALOG_PATH });
    if (!html) break;

    const $ = cheerio.load(html);
    const pageItems = [];

    // Main grid selector — adjust if site restructures
    $('article, .film-item, .grid-item, .latestPost').each((_, el) => {
      const $el = $(el);
      const anchor = $el.find('a').first();
      const href = anchor.attr('href') || '';
      const title = (_cleanTitle(
        $el.find('.entry-title, h2, h3, .title').first().text() || anchor.attr('title') || ''
      ));
      const poster = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '';
      if (!href || !title) return;

      const slug = href.split('/').filter(Boolean).pop() || '';
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
async function getMeta(id) {
  const cached = metaCache.get(id);
  if (cached) {
    log.debug('meta from cache', { id });
    return { meta: cached };
  }

  const baseId = extractBaseSlug(id.replace(/^rama_/, ''));
  const seriesUrl = `${BASE_URL}/drama/${baseId}/`;
  log.info('fetching meta', { id, seriesUrl });

  const html = await fetchWithCloudscraper(seriesUrl, { referer: BASE_URL });
  if (!html) {
    log.warn('meta fetch returned null', { id });
    return { meta: _emptyMeta(id) };
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
    id,
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
  metaCache.set(id, meta);
  return { meta };
}

// ─── Stream ───────────────────────────────────────────────────────────────────

/**
 * @param {string} id  e.g. "rama_my-drama-2023"
 * @returns {Promise<Array>}
 */
async function getStreams(id) {
  const cached = streamCache.get(id);
  if (cached) {
    log.debug('streams from cache', { id });
    return cached;
  }

  const { meta } = await getMeta(id);
  if (!meta || !meta.episodes || !meta.episodes.length) {
    log.warn('no episodes found for streams', { id });
    return [];
  }

  const streams = meta.episodes.flatMap(ep =>
    ep.streams.map(s => ({
      name: 'Rama',
      title: `${ep.title} — ${s.title}`,
      url: s.url,
      behaviorHints: { bingeGroup: `streamfusion-rama-${id}` },
    }))
  );

  streamCache.set(id, streams);
  return streams;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _getEpisodes(seriesUrl, $, seriesId, year) {
  const episodes = [];
  const thumbElements = $('.swiper-slide a div img').toArray();

  for (let i = 0; i < thumbElements.length; i++) {
    const epNum = i + 1;
    const thumbnail = $(thumbElements[i]).attr('src') || '';
    if (!thumbnail) {
      log.warn(`no thumbnail for episode ${epNum}`);
      continue;
    }

    const episodeLink = year
      ? `${BASE_URL}/watch/${seriesId}-${year}-episodio-${epNum}/`
      : `${BASE_URL}/watch/${seriesId}-episodio-${epNum}/`;

    const streamUrl = await _getStreamFromEpisodePage(episodeLink);

    episodes.push({
      id: `episodio-${epNum}`,
      title: `Episodio ${epNum}`,
      thumbnail,
      streams: [{ title: `Episodio ${epNum}`, url: streamUrl || episodeLink }],
    });
  }

  log.info(`fetched ${episodes.length} episodes`, { seriesId });
  return episodes;
}

async function _getStreamFromEpisodePage(episodeLink) {
  const cacheKey = `stream:${episodeLink}`;
  const cached = streamCache.get(cacheKey);
  if (cached) return cached;

  log.debug('fetching episode page', { episodeLink });
  const html = await fetchWithCloudscraper(episodeLink, { referer: BASE_URL, timeout: 15_000 });
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
