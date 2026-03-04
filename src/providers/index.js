'use strict';

/**
 * Provider aggregator — StreamFusion Mail
 *
 * Routes requests to the correct provider based on ID prefix or catalog type,
 * runs parallel provider calls where applicable, applies configurable timeouts,
 * and merges/deduplicates results.
 *
 * ID prefixes:
 *   "kisskh_*"  → KissKH provider   (type: series)
 *   "rama_*"    → Rama provider     (type: kdrama)
 *
 * Catalog IDs:
 *   "kisskh_catalog"  → KissKH
 *   "rama_catalog"    → Rama
 */

const kisskh = require('./kisskh');
const rama   = require('./rama');
const { withTimeout } = require('../utils/fetcher');
const { createLogger } = require('../utils/logger');

const log = createLogger('aggregator');

// Configurable timeouts (ms)
const CATALOG_TIMEOUT = Number(process.env.CATALOG_TIMEOUT) || 9_000;
const META_TIMEOUT    = Number(process.env.META_TIMEOUT)    || 30_000;
const STREAM_TIMEOUT  = Number(process.env.STREAM_TIMEOUT)  || 45_000;

// ─── Catalog handler ─────────────────────────────────────────────────────────

/**
 * @param {'series'|'kdrama'} type
 * @param {string} catalogId
 * @param {object} extra  { search?, skip? }
 * @param {object} [config]
 * @returns {Promise<{metas: Array}>}
 */
async function handleCatalog(type, catalogId, extra = {}, config = {}) {
  const skip   = Number(extra.skip)   || 0;
  const search = String(extra.search  || '').trim();

  log.info('catalog request', { type, catalogId, skip, search });

  try {
    if (catalogId === 'kisskh_catalog' || type === 'series') {
      const metas = await withTimeout(kisskh.getCatalog(skip, search, config), CATALOG_TIMEOUT, 'kisskh.getCatalog');
      return { metas };
    }

    if (catalogId === 'rama_catalog' || type === 'kdrama') {
      const metas = await withTimeout(rama.getCatalog(skip, search, config), CATALOG_TIMEOUT, 'rama.getCatalog');
      return { metas };
    }
  } catch (err) {
    log.error(`catalog failed: ${err.message}`, { type, catalogId });
  }

  return { metas: [] };
}

// ─── Meta handler ─────────────────────────────────────────────────────────────

/**
 * @param {'series'|'kdrama'} type
 * @param {string} id
 * @param {object} [config]
 * @returns {Promise<{meta: object|null}>}
 */
async function handleMeta(type, id, config = {}) {
  log.info('meta request', { type, id });

  try {
    if (id.startsWith('kisskh_')) {
      const result = await withTimeout(kisskh.getMeta(id, config), META_TIMEOUT, 'kisskh.getMeta');
      return result || { meta: null };
    }

    if (id.startsWith('rama_')) {
      const result = await withTimeout(rama.getMeta(id, config), META_TIMEOUT, 'rama.getMeta');
      return result || { meta: null };
    }
  } catch (err) {
    log.error(`meta failed: ${err.message}`, { type, id });
  }

  return { meta: null };
}

// ─── Stream handler ───────────────────────────────────────────────────────────

/**
 * @param {'series'|'kdrama'} type
 * @param {string} id   May be composite: "kisskh_123:456"
 * @param {object} [config]
 * @returns {Promise<{streams: Array}>}
 */
async function handleStream(type, id, config = {}) {
  log.info('stream request', { type, id });

  const results = await Promise.allSettled([
    _fetchFromProvider(id, type, config),
  ]);

  const streams = results
    .filter(r => r.status === 'fulfilled' && Array.isArray(r.value))
    .flatMap(r => r.value);

  // Deduplicate by URL
  const seen = new Set();
  const unique = streams.filter(s => {
    if (!s.url || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  log.info(`stream: returning ${unique.length} streams`, { id });
  return { streams: unique };
}

async function _fetchFromProvider(id, type, config = {}) {
  // Determine provider by ID prefix
  if (id.startsWith('kisskh_')) {
    return withTimeout(kisskh.getStreams(id, config), STREAM_TIMEOUT, 'kisskh.getStreams');
  }
  if (id.startsWith('rama_')) {
    return withTimeout(rama.getStreams(id, config), STREAM_TIMEOUT, 'rama.getStreams');
  }

  // Unknown prefix — try both providers in parallel and merge
  log.warn('unknown id prefix, trying all providers', { id });
  const [kisskhResult, ramaResult] = await Promise.allSettled([
    withTimeout(kisskh.getStreams(`kisskh_${id}`, config), STREAM_TIMEOUT, 'kisskh.getStreams.fallback'),
    withTimeout(rama.getStreams(`rama_${id}`, config), STREAM_TIMEOUT, 'rama.getStreams.fallback'),
  ]);

  return [
    ...(kisskhResult.status === 'fulfilled' ? kisskhResult.value : []),
    ...(ramaResult.status  === 'fulfilled' ? ramaResult.value  : []),
  ];
}

module.exports = { handleCatalog, handleMeta, handleStream };
