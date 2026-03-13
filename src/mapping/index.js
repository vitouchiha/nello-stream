"use strict";

/**
 * Internal Anime Mapping Module
 * Replaces external dependency on animemapping.stremio.dpdns.org
 *
 * Provides:
 *   resolve(provider, externalId, options) → mapping payload
 *
 * Supports providers: "kitsu", "tmdb", "imdb"
 * Uses: Kitsu API, TMDB API, provider site search
 */

const { createTimeoutSignal } = require("../fetch_helper.js");
const { getProviderUrl } = require("../provider_urls.js");

const TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_TTL = 10 * 60 * 1000; // 10 min
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) { cache.delete(key); return undefined; }
  return entry.value;
}

function cacheSet(key, value, ttl = CACHE_TTL) {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  if (cache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of cache) { if (v.expiresAt <= now) cache.delete(k); }
  }
  return value;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────
async function fetchJson(url, timeoutMs = 8000) {
  const tc = createTimeoutSignal(timeoutMs);
  try {
    const res = await fetch(url, { signal: tc.signal, headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { if (typeof tc.cleanup === "function") tc.cleanup(); }
}

async function fetchHtml(url, timeoutMs = 8000) {
  const tc = createTimeoutSignal(timeoutMs);
  try {
    const res = await fetch(url, { signal: tc.signal, headers: { "User-Agent": UA } });
    if (!res.ok) return "";
    return await res.text();
  } catch { return ""; }
  finally { if (typeof tc.cleanup === "function") tc.cleanup(); }
}

// ─── Kitsu API ────────────────────────────────────────────────────────────────

async function fetchKitsuAnime(kitsuId) {
  const key = `kitsu:anime:${kitsuId}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const data = await fetchJson(`https://kitsu.io/api/edge/anime/${kitsuId}`);
  if (!data?.data?.attributes) return cacheSet(key, null);

  const attr = data.data.attributes;
  const result = {
    id: String(kitsuId),
    slug: attr.slug || "",
    subtype: (attr.subtype || "TV").toUpperCase(),
    status: attr.status || "unknown",
    canonicalTitle: attr.canonicalTitle || "",
    titles: {
      ...(attr.titles?.en ? { en: attr.titles.en } : {}),
      ...(attr.titles?.en_jp ? { en_jp: attr.titles.en_jp } : {}),
      ...(attr.titles?.en_us ? { en_us: attr.titles.en_us } : {}),
      ...(attr.titles?.ja_jp ? { ja_jp: attr.titles.ja_jp } : {}),
    },
    startDate: attr.startDate || null,
    endDate: attr.endDate || null,
    episodeCount: attr.episodeCount || null,
  };
  return cacheSet(key, result);
}

async function fetchKitsuMappings(kitsuId) {
  const key = `kitsu:mappings:${kitsuId}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const data = await fetchJson(`https://kitsu.io/api/edge/anime/${kitsuId}/mappings`);
  if (!data?.data || !Array.isArray(data.data)) return cacheSet(key, {});

  const ids = {};
  for (const m of data.data) {
    const site = String(m?.attributes?.externalSite || "").toLowerCase();
    const extId = String(m?.attributes?.externalId || "").trim();
    if (!extId) continue;

    if (site.includes("myanimelist")) ids.mal = extId;
    else if (site.includes("anilist")) ids.anilist = extId;
    else if (site === "thetvdb" || site === "thetvdb/series") ids.tvdb = extId;
    else if (site.includes("imdb")) ids.imdb = extId;
    else if (site.includes("anidb")) ids.anidb = extId;
    else if (site.includes("thetvdb")) ids.tvdb = ids.tvdb || extId;
  }
  return cacheSet(key, ids);
}

// ─── Reverse lookups: TMDB/IMDB → Kitsu ──────────────────────────────────────

async function findKitsuIdByExternalId(externalSite, externalId) {
  const key = `reverse:${externalSite}:${externalId}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  // Kitsu mappings filter API
  const sites = [];
  if (externalSite === "imdb") {
    sites.push("imdb/series", "imdb/movie", "imdb");
  } else if (externalSite === "tmdb") {
    // TMDB isn't directly in Kitsu mappings; we use TMDB API to get IMDB/TVDB first
    return cacheSet(key, null);
  } else if (externalSite === "tvdb") {
    sites.push("thetvdb/series", "thetvdb", "thetvdb/movie");
  }

  for (const site of sites) {
    const url = `https://kitsu.io/api/edge/mappings?filter[externalSite]=${encodeURIComponent(site)}&filter[externalId]=${encodeURIComponent(externalId)}&include=item&fields[anime]=id`;
    const data = await fetchJson(url, 10000);
    if (data?.included && Array.isArray(data.included)) {
      for (const item of data.included) {
        if (item?.type === "anime" && item?.id) {
          return cacheSet(key, String(item.id));
        }
      }
    }
    // Also try via relationship link
    if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
      const itemLink = data.data[0]?.relationships?.item?.links?.related;
      if (itemLink) {
        const itemData = await fetchJson(itemLink, 8000);
        if (itemData?.data?.id && itemData?.data?.type === "anime") {
          return cacheSet(key, String(itemData.data.id));
        }
      }
    }
  }
  return cacheSet(key, null);
}

async function resolveKitsuIdFromTmdb(tmdbId) {
  const key = `reverse:tmdb:${tmdbId}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  // First get IMDB/TVDB from TMDB, then look up Kitsu
  const tmdbData = await fetchJson(
    `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
  );

  if (tmdbData) {
    // Try TVDB first (more reliable - Kitsu stores thetvdb/series mappings)
    if (tmdbData.tvdb_id) {
      const kitsuId = await findKitsuIdByExternalId("tvdb", String(tmdbData.tvdb_id));
      if (kitsuId) return cacheSet(key, kitsuId);
    }
    if (tmdbData.imdb_id) {
      const kitsuId = await findKitsuIdByExternalId("imdb", tmdbData.imdb_id);
      if (kitsuId) return cacheSet(key, kitsuId);
    }
  }

  // Also try movie external IDs
  const movieData = await fetchJson(
    `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
  );
  if (movieData?.imdb_id) {
    const kitsuId = await findKitsuIdByExternalId("imdb", movieData.imdb_id);
    if (kitsuId) return cacheSet(key, kitsuId);
  }

  return cacheSet(key, null);
}

// ─── TMDB helpers ─────────────────────────────────────────────────────────────

async function findTmdbIdFromExternal(externalId, source) {
  const key = `tmdb:find:${source}:${externalId}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(externalId)}?api_key=${TMDB_API_KEY}&external_source=${source}`;
  const data = await fetchJson(url);
  if (!data) return cacheSet(key, null);

  const tvResult = data.tv_results?.[0];
  const movieResult = data.movie_results?.[0];
  const result = tvResult?.id || movieResult?.id || null;
  return cacheSet(key, result ? String(result) : null);
}

async function resolveTmdbEpisode(tmdbId, requestedEpisode, requestedSeason) {
  if (!tmdbId || !requestedEpisode) return null;

  const key = `tmdb:ep:${tmdbId}:s${requestedSeason}:e${requestedEpisode}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const season = Number.isInteger(requestedSeason) && requestedSeason >= 0
    ? requestedSeason
    : 1;

  // Try direct season/episode lookup
  const epData = await fetchJson(
    `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${requestedEpisode}?api_key=${TMDB_API_KEY}`
  );

  if (epData && epData.episode_number) {
    const result = {
      id: String(tmdbId),
      season: epData.season_number ?? season,
      episode: epData.episode_number,
      rawEpisodeNumber: requestedEpisode,
      absoluteEpisode: null,
      matchedBy: "season_episode",
      episodeUrl: `https://www.themoviedb.org/tv/${tmdbId}/season/${epData.season_number ?? season}/episode/${epData.episode_number}`,
    };
    return cacheSet(key, result);
  }

  // If direct lookup fails and season = 1, try mapping as absolute episode
  if (season <= 1) {
    const showData = await fetchJson(
      `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=seasons`
    );
    if (showData?.seasons) {
      const seasons = showData.seasons
        .filter(s => s.season_number > 0)
        .sort((a, b) => a.season_number - b.season_number);

      let total = 0;
      for (const s of seasons) {
        if (requestedEpisode <= total + s.episode_count) {
          const resolvedEp = requestedEpisode - total;
          const result = {
            id: String(tmdbId),
            season: s.season_number,
            episode: resolvedEp,
            rawEpisodeNumber: requestedEpisode,
            absoluteEpisode: requestedEpisode,
            matchedBy: "absolute_to_season",
            episodeUrl: `https://www.themoviedb.org/tv/${tmdbId}/season/${s.season_number}/episode/${resolvedEp}`,
          };
          return cacheSet(key, result);
        }
        total += s.episode_count;
      }
    }
  }

  // Fallback: just return what we have
  const fallback = {
    id: String(tmdbId),
    season,
    episode: requestedEpisode,
    rawEpisodeNumber: requestedEpisode,
    absoluteEpisode: null,
    matchedBy: "fallback",
    episodeUrl: `https://www.themoviedb.org/tv/${tmdbId}/season/${season}/episode/${requestedEpisode}`,
  };
  return cacheSet(key, fallback);
}

// ─── Kitsu episode airdate ────────────────────────────────────────────────────

async function fetchKitsuEpisodeAirdate(kitsuId, episodeNumber) {
  if (!kitsuId || !episodeNumber) return null;

  const key = `kitsu:airdate:${kitsuId}:${episodeNumber}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const url = `https://kitsu.io/api/edge/anime/${kitsuId}/episodes?filter[number]=${episodeNumber}&fields[episodes]=airdate`;
  const data = await fetchJson(url, 6000);
  const airdate = data?.data?.[0]?.attributes?.airdate || null;
  return cacheSet(key, airdate);
}

// ─── Provider path search ─────────────────────────────────────────────────────

function getProviderBase(providerKey) {
  try { return getProviderUrl(providerKey).replace(/\/+$/, ""); }
  catch { return ""; }
}

async function searchAnimeWorld(titles) {
  const base = getProviderBase("animeworld");
  if (!base) return [];

  const allPaths = new Set();
  for (const title of titles.slice(0, 3)) {
    if (!title) continue;
    const key = `aw:search:${title.toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached !== undefined) { cached.forEach(p => allPaths.add(p)); continue; }

    const html = await fetchHtml(`${base}/search?keyword=${encodeURIComponent(title)}`);
    const paths = [];
    const regex = /href="(\/play\/[^"]+)"/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      const p = m[1].split("?")[0];
      if (p && !paths.includes(p)) paths.push(p);
    }
    cacheSet(key, paths);
    paths.forEach(p => allPaths.add(p));
    if (allPaths.size >= 10) break;
  }
  return [...allPaths].slice(0, 20);
}

async function searchAnimeSaturn(titles) {
  const base = getProviderBase("animesaturn");
  if (!base) return [];

  const allPaths = new Set();
  for (const title of titles.slice(0, 3)) {
    if (!title) continue;
    const key = `as:search:${title.toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached !== undefined) { cached.forEach(p => allPaths.add(p)); continue; }

    const html = await fetchHtml(`${base}/animelist?search=${encodeURIComponent(title)}`);
    const paths = [];

    // Extract only links from search result items (inside .anime-card or similar containers)
    // Use a two-pass approach: first try structured results, then fallback with title filtering
    const resultBlockRegex = /class="[^"]*anime-card[^"]*"[\s\S]*?<\/div>/gi;
    const blocks = html.match(resultBlockRegex);
    
    if (blocks && blocks.length > 0) {
      // Parse links from within result blocks only
      for (const block of blocks) {
        const linkMatch = block.match(/href="(?:https?:\/\/[^"]*)?\/anime\/([^"?#]+)"/i);
        if (linkMatch) {
          const slug = linkMatch[1];
          if (!slug.includes("${") && !slug.includes("{{")) {
            const path = `/anime/${slug}`;
            if (!paths.includes(path)) paths.push(path);
          }
        }
      }
    }
    
    // Fallback: get all /anime/ links but filter by title similarity
    if (paths.length === 0) {
      const regex = /href="(?:https?:\/\/[^"]*)?\/anime\/([^"?#]+)"/gi;
      let m;
      const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      while ((m = regex.exec(html)) !== null) {
        const slug = m[1];
        if (slug.includes("${") || slug.includes("{{")) continue;
        // Check if slug matches the searched title (slug uses hyphens as separators)
        const normalizedSlug = slug.toLowerCase().replace(/[-_]+/g, "").replace(/[^a-z0-9]/g, "");
        // Accept if slug contains the normalized title or title contains the slug's main part
        const slugWords = slug.toLowerCase().replace(/[-_]+/g, " ").split(/\s+/).filter(w => w.length > 2);
        const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const matchingWords = titleWords.filter(tw => slugWords.some(sw => sw.includes(tw) || tw.includes(sw)));
        if (normalizedSlug.includes(normalizedTitle) || normalizedTitle.includes(normalizedSlug) || matchingWords.length >= Math.max(1, Math.ceil(titleWords.length * 0.5))) {
          const path = `/anime/${slug}`;
          if (!paths.includes(path)) paths.push(path);
        }
      }
    }

    cacheSet(key, paths);
    paths.forEach(p => allPaths.add(p));
    if (allPaths.size >= 10) break;
  }
  return [...allPaths].slice(0, 20);
}

async function searchAnimeUnity(titles, anilistId) {
  const base = getProviderBase("animeunity");
  if (!base) return [];

  // AnimeUnity is JS-rendered, standard HTML scraping doesn't work.
  // Try fetching by known AniList ID pattern if available.
  if (anilistId) {
    const key = `au:anilist:${anilistId}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    // Try common AnimeUnity URL patterns using their internal search
    // AnimeUnity's URL format: /anime/{internal_id}-{slug}
    // We can't derive internal_id from AniList ID directly.
    // As fallback, return empty - the provider already handles this gracefully.
    return cacheSet(key, []);
  }

  return [];
}

// ─── Main resolution ──────────────────────────────────────────────────────────

async function resolveByKitsu(kitsuId, options = {}) {
  const id = String(kitsuId).replace(/^kitsu:/i, "").trim();
  if (!id || !/^\d+$/.test(id)) return { ok: false, error: "invalid_kitsu_id" };

  const cacheKey = `resolve:kitsu:${id}:ep${options.episode || ""}:s${options.season ?? ""}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  // Parallel: Fetch Kitsu anime details + mappings
  const [kitsuAnime, externalIds] = await Promise.all([
    fetchKitsuAnime(id),
    fetchKitsuMappings(id),
  ]);

  if (!kitsuAnime) return cacheSet(cacheKey, { ok: false, error: "not_found" });

  // Resolve TMDB ID from mappings
  let tmdbId = null;
  let imdbId = externalIds.imdb || null;

  if (externalIds.tvdb) {
    tmdbId = await findTmdbIdFromExternal(externalIds.tvdb, "tvdb_id");
  }
  if (!tmdbId && imdbId) {
    tmdbId = await findTmdbIdFromExternal(imdbId, "imdb_id");
  }
  if (!tmdbId && externalIds.tvdb) {
    // Try series lookup
    tmdbId = await findTmdbIdFromExternal(externalIds.tvdb, "tvdb_id");
  }

  // If still no TMDB, try title search
  if (!tmdbId) {
    tmdbId = await searchTmdbByTitles(kitsuAnime, externalIds);
  }

  // If we found TMDB but no IMDB, get IMDB from TMDB external IDs
  if (tmdbId && !imdbId) {
    const extIds = await fetchJson(
      `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
    );
    if (extIds?.imdb_id) imdbId = extIds.imdb_id;
  }

  const ids = {
    ...(externalIds.mal ? { mal: externalIds.mal } : {}),
    ...(externalIds.anilist ? { anilist: externalIds.anilist } : {}),
    ...(imdbId ? { imdb: imdbId } : {}),
    ...(tmdbId ? { tmdb: tmdbId } : {}),
    ...(externalIds.tvdb ? { tvdb: externalIds.tvdb } : {}),
    ...(externalIds.anidb ? { anidb: externalIds.anidb } : {}),
  };

  // Build episode data
  const requestedEpisode = parseInt(String(options.episode || ""), 10) || null;
  const requestedSeason = Number.isInteger(parseInt(String(options.season ?? ""), 10))
    ? parseInt(String(options.season), 10)
    : null;

  // Episode airdate
  let episodeAirdate = null;
  if (requestedEpisode) {
    episodeAirdate = await fetchKitsuEpisodeAirdate(id, requestedEpisode);
  }

  // TMDB episode mapping
  let tmdbEpisode = null;
  if (tmdbId && requestedEpisode) {
    tmdbEpisode = await resolveTmdbEpisode(tmdbId, requestedEpisode, requestedSeason);
  }

  // Provider path search (parallel)
  const searchTitles = buildSearchTitles(kitsuAnime);
  const [animeWorldPaths, animeSaturnPaths, animeUnityPaths] = await Promise.all([
    searchAnimeWorld(searchTitles),
    searchAnimeSaturn(searchTitles),
    searchAnimeUnity(searchTitles, externalIds.anilist),
  ]);

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    requested: {
      id: `kitsu:${id}`,
      numericId: id,
      ...(requestedEpisode ? { episode: requestedEpisode } : {}),
    },
    kitsu: {
      ...kitsuAnime,
      episode_airdate: episodeAirdate,
      ...(requestedEpisode ? { episode: requestedEpisode } : {}),
    },
    mappings: {
      ids,
      ...(animeWorldPaths.length > 0 ? { animeworld: animeWorldPaths } : {}),
      ...(animeSaturnPaths.length > 0 ? { animesaturn: animeSaturnPaths } : {}),
      ...(animeUnityPaths.length > 0 ? { animeunity: animeUnityPaths } : {}),
      ...(tmdbEpisode ? { tmdb_episode: tmdbEpisode } : {}),
    },
  };

  return cacheSet(cacheKey, payload);
}

async function searchTmdbByTitles(kitsuAnime, externalIds) {
  const titles = buildSearchTitles(kitsuAnime);
  const type = kitsuAnime.subtype === "MOVIE" ? "movie" : "tv";
  const year = kitsuAnime.startDate ? kitsuAnime.startDate.substring(0, 4) : null;

  for (const title of titles.slice(0, 4)) {
    if (!title) continue;

    let yearParam = "";
    if (year) {
      yearParam = type === "movie" ? `&primary_release_year=${year}` : `&first_air_date_year=${year}`;
    }

    // Try with year first
    let data = null;
    if (year) {
      data = await fetchJson(
        `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(title)}&api_key=${TMDB_API_KEY}${yearParam}`
      );
    }

    // Without year if no results
    if (!data?.results?.length) {
      data = await fetchJson(
        `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(title)}&api_key=${TMDB_API_KEY}`
      );
    }

    if (data?.results?.length > 0) {
      // Prefer year-matched result
      if (year) {
        const match = data.results.find(r => {
          const date = type === "movie" ? r.release_date : r.first_air_date;
          return date && date.startsWith(year);
        });
        if (match) return String(match.id);
      }
      return String(data.results[0].id);
    }
  }
  return null;
}

function buildSearchTitles(kitsuAnime) {
  if (!kitsuAnime) return [];
  const titles = new Set();
  if (kitsuAnime.titles?.en) titles.add(kitsuAnime.titles.en);
  if (kitsuAnime.titles?.en_jp) titles.add(kitsuAnime.titles.en_jp);
  if (kitsuAnime.canonicalTitle) titles.add(kitsuAnime.canonicalTitle);
  if (kitsuAnime.titles?.en_us) titles.add(kitsuAnime.titles.en_us);
  if (kitsuAnime.titles?.ja_jp) titles.add(kitsuAnime.titles.ja_jp);
  return [...titles].filter(Boolean);
}

async function resolveByTmdb(tmdbId, options = {}) {
  const id = String(tmdbId).replace(/^tmdb:/i, "").trim();
  if (!id || !/^\d+$/.test(id)) return { ok: false, error: "invalid_tmdb_id" };

  const kitsuId = await resolveKitsuIdFromTmdb(id);
  if (kitsuId) {
    const result = await resolveByKitsu(kitsuId, options);
    if (result?.ok) {
      result.requested = {
        provider: "tmdb",
        externalId: id,
        id: `tmdb:${id}`,
        resolvedKitsuId: kitsuId,
        ...(options.episode ? { episode: parseInt(String(options.episode), 10) } : {}),
      };
      return result;
    }
  }

  // Fallback: build minimal response with TMDB data only
  return buildMinimalTmdbResponse(id, options);
}

async function resolveByImdb(imdbId, options = {}) {
  const id = String(imdbId).trim();
  if (!id || !/^tt\d+$/i.test(id)) return { ok: false, error: "invalid_imdb_id" };

  // Try direct Kitsu IMDB lookup (rarely works - Kitsu seldom stores IMDB mappings)
  let kitsuId = await findKitsuIdByExternalId("imdb", id);

  // If direct fails, chain: IMDB → TMDB → TVDB → Kitsu
  if (!kitsuId) {
    const tmdbId = await findTmdbIdFromExternal(id, "imdb_id");
    if (tmdbId) {
      // Get TVDB from TMDB external_ids
      const extIds = await fetchJson(
        `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
      );
      if (extIds?.tvdb_id) {
        kitsuId = await findKitsuIdByExternalId("tvdb", String(extIds.tvdb_id));
      }
      // If still no Kitsu, try movie external_ids
      if (!kitsuId) {
        const movieExt = await fetchJson(
          `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
        );
        if (movieExt?.tvdb_id) {
          kitsuId = await findKitsuIdByExternalId("tvdb", String(movieExt.tvdb_id));
        }
      }
    }
  }

  if (kitsuId) {
    const result = await resolveByKitsu(kitsuId, options);
    if (result?.ok) {
      result.requested = {
        provider: "imdb",
        externalId: id,
        id: `imdb:${id}`,
        resolvedKitsuId: kitsuId,
        ...(options.episode ? { episode: parseInt(String(options.episode), 10) } : {}),
      };
      return result;
    }
  }

  // Fallback: get TMDB from IMDB, build minimal response
  const tmdbId = await findTmdbIdFromExternal(id, "imdb_id");
  if (tmdbId) {
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      requested: { provider: "imdb", externalId: id, id: `imdb:${id}`, resolvedKitsuId: null },
      kitsu: null,
      mappings: { ids: { imdb: id, tmdb: tmdbId } },
    };
  }

  return { ok: false, error: "not_found" };
}

async function buildMinimalTmdbResponse(tmdbId, options = {}) {
  // Get external IDs from TMDB
  const extIds = await fetchJson(
    `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
  );

  const ids = { tmdb: tmdbId };
  if (extIds?.imdb_id) ids.imdb = extIds.imdb_id;
  if (extIds?.tvdb_id) ids.tvdb = String(extIds.tvdb_id);

  const requestedEpisode = parseInt(String(options.episode || ""), 10) || null;
  const requestedSeason = Number.isInteger(parseInt(String(options.season ?? ""), 10))
    ? parseInt(String(options.season), 10)
    : null;

  let tmdbEpisode = null;
  if (requestedEpisode) {
    tmdbEpisode = await resolveTmdbEpisode(tmdbId, requestedEpisode, requestedSeason);
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    requested: {
      provider: "tmdb",
      externalId: tmdbId,
      id: `tmdb:${tmdbId}`,
      resolvedKitsuId: null,
      ...(requestedEpisode ? { episode: requestedEpisode } : {}),
    },
    kitsu: null,
    mappings: {
      ids,
      ...(tmdbEpisode ? { tmdb_episode: tmdbEpisode } : {}),
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Main entry point. Resolves anime mapping by provider type and external ID.
 *
 * @param {string} provider - "kitsu", "tmdb", or "imdb"
 * @param {string} externalId - The external ID (e.g., "12", "tt0388629", "37854")
 * @param {object} options - { episode?: number, season?: number }
 * @returns {Promise<object>} Mapping payload compatible with external API format
 */
async function resolve(provider, externalId, options = {}) {
  const p = String(provider || "").trim().toLowerCase();
  const id = String(externalId || "").trim();
  if (!id) return { ok: false, error: "missing_id" };

  switch (p) {
    case "kitsu": return resolveByKitsu(id, options);
    case "tmdb": return resolveByTmdb(id, options);
    case "imdb": return resolveByImdb(id, options);
    default: return { ok: false, error: "unsupported_provider" };
  }
}

/**
 * Resolve for the /mapping/{kitsuId} route used by tmdb_helper.js.
 * Returns a simplified format: { tmdbId, season, imdbId, source, seasonName, titleHints, ... }
 */
async function resolveForTmdbHelper(kitsuId) {
  const result = await resolveByKitsu(kitsuId, {});
  if (!result?.ok || !result.mappings?.ids) return null;

  const ids = result.mappings.ids;
  const kitsu = result.kitsu;

  // Build title hints from Kitsu titles
  const titleHints = buildSearchTitles(kitsu);

  // Determine season heuristically from title
  let season = null;
  const title = kitsu?.titles?.en || kitsu?.titles?.en_jp || kitsu?.canonicalTitle || "";
  if (title) {
    const seasonMatch = title.match(/Season\s*(\d+)/i) || title.match(/(\d+)(?:st|nd|rd|th)\s*Season/i);
    if (seasonMatch) season = parseInt(seasonMatch[1]);
    else if (title.match(/\s(\d+)$/)) season = parseInt(title.match(/\s(\d+)$/)[1]);
    else if (title.match(/\sII$/)) season = 2;
    else if (title.match(/\sIII$/)) season = 3;
    else if (title.match(/\sIV$/)) season = 4;
    else if (title.match(/\sV$/)) season = 5;
    else if (title.match(/\sVI$/)) season = 6;
    if (/\b(special|recap|ova|oav)\b/i.test(title)) season = 0;
  }

  return {
    tmdbId: ids.tmdb || null,
    season,
    imdbId: ids.imdb || null,
    source: "internal",
    seasonName: null,
    titleHints,
    longSeries: false,
    episodeMode: null,
    mappedSeasons: [],
    seriesSeasonCount: null,
  };
}

module.exports = { resolve, resolveForTmdbHelper, resolveByKitsu, resolveByTmdb, resolveByImdb };
