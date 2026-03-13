"use strict";

/**
 * Anime ID List — Offline cross-reference index from Fribb/anime-lists.
 *
 * Downloads ~7 MB JSON once, builds in-memory indexes keyed by every ID type,
 * then refreshes every 24 h (ETag-aware, only re-downloads if changed).
 *
 * Usage:
 *   const animeList = require("./anime_list");
 *   await animeList.ensureLoaded();           // warm-up (called once at start)
 *   animeList.findByImdb("tt0409591");        // → { kitsu_id, themoviedb_id, … }
 *   animeList.findByKitsu(12);                // → { imdb_id, themoviedb_id, … }
 */

const LIST_URL =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 h

// ─── In-memory indexes ────────────────────────────────────────────────────────
let byKitsu   = new Map(); // kitsu_id (number)  → entry
let byMal     = new Map(); // mal_id   (number)  → entry
let byAnilist = new Map(); // anilist_id (number) → entry
let byImdb    = new Map(); // imdb_id  (string)  → entry[]  (can have dupes)
let byTmdb    = new Map(); // themoviedb_id (num) → entry[]
let byTvdb    = new Map(); // tvdb_id  (number)   → entry[]
let byAnidb   = new Map(); // anidb_id (number)   → entry

let loaded   = false;
let loading  = null;   // dedup promise
let lastEtag = null;
let refreshTimer = null;

// ─── Build / rebuild indexes ──────────────────────────────────────────────────
function buildIndexes(list) {
  const _byKitsu = new Map(), _byMal = new Map(), _byAnilist = new Map();
  const _byImdb  = new Map(), _byTmdb = new Map(), _byTvdb = new Map();
  const _byAnidb = new Map();

  for (const entry of list) {
    if (entry.kitsu_id)        _byKitsu.set(entry.kitsu_id, entry);
    if (entry.mal_id)          _byMal.set(entry.mal_id, entry);
    if (entry.anilist_id)      _byAnilist.set(entry.anilist_id, entry);
    if (entry.anidb_id)        _byAnidb.set(entry.anidb_id, entry);

    if (entry.imdb_id) {
      const arr = _byImdb.get(entry.imdb_id) || [];
      arr.push(entry); _byImdb.set(entry.imdb_id, arr);
    }
    if (entry.themoviedb_id) {
      const arr = _byTmdb.get(entry.themoviedb_id) || [];
      arr.push(entry); _byTmdb.set(entry.themoviedb_id, arr);
    }
    if (entry.tvdb_id) {
      const arr = _byTvdb.get(entry.tvdb_id) || [];
      arr.push(entry); _byTvdb.set(entry.tvdb_id, arr);
    }
  }

  byKitsu = _byKitsu; byMal = _byMal; byAnilist = _byAnilist;
  byImdb = _byImdb;   byTmdb = _byTmdb; byTvdb = _byTvdb;
  byAnidb = _byAnidb;
}

// ─── Download & refresh ───────────────────────────────────────────────────────
async function download() {
  try {
    const headers = {};
    if (lastEtag) headers["If-None-Match"] = lastEtag;

    const res = await fetch(LIST_URL, { headers });

    if (res.status === 304) {
      console.log("[AnimeList] Not modified (ETag match), skip reload.");
      return false;
    }
    if (!res.ok) {
      console.error("[AnimeList] Download failed:", res.status);
      return false;
    }

    const etag = res.headers.get("etag") || null;
    const list = await res.json();

    if (!Array.isArray(list) || list.length < 1000) {
      console.error("[AnimeList] Invalid data (length", list?.length, ")");
      return false;
    }

    buildIndexes(list);
    lastEtag = etag;
    loaded = true;
    console.log(`[AnimeList] Loaded ${list.length} entries, indexes built. ETag: ${etag || "none"}`);
    return true;
  } catch (err) {
    console.error("[AnimeList] Download error:", err.message);
    return false;
  }
}

async function ensureLoaded() {
  if (loaded) return;
  if (loading) return loading;
  loading = download().finally(() => { loading = null; });

  // Schedule periodic refresh
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      download().catch(() => {});
    }, REFRESH_MS);
    if (refreshTimer.unref) refreshTimer.unref(); // don't keep process alive
  }

  return loading;
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/** @returns {object|null} single entry */
function findByKitsu(id)   { return byKitsu.get(Number(id)) || null; }
function findByMal(id)     { return byMal.get(Number(id)) || null; }
function findByAnilist(id) { return byAnilist.get(Number(id)) || null; }
function findByAnidb(id)   { return byAnidb.get(Number(id)) || null; }

/** @returns {object|null} first matching entry */
function findByImdb(id)  { return (byImdb.get(String(id)) || [])[0] || null; }
function findByTmdb(id)  { return (byTmdb.get(Number(id)) || [])[0] || null; }
function findByTvdb(id)  { return (byTvdb.get(Number(id)) || [])[0] || null; }

/** @returns {object[]} all entries sharing same IMDB */
function findAllByImdb(id) { return byImdb.get(String(id)) || []; }
function findAllByTmdb(id) { return byTmdb.get(Number(id)) || []; }
function findAllByTvdb(id) { return byTvdb.get(Number(id)) || []; }

/** Universal lookup: given any ID type, find the entry */
function findByAny(provider, id) {
  const n = Number(id);
  const s = String(id);
  switch (String(provider).toLowerCase()) {
    case "kitsu":   return findByKitsu(n);
    case "mal":     return findByMal(n);
    case "anilist": return findByAnilist(n);
    case "anidb":   return findByAnidb(n);
    case "imdb":    return findByImdb(s);
    case "tmdb":    return findByTmdb(n);
    case "tvdb":    return findByTvdb(n);
    default:        return null;
  }
}

/** Get status info */
function stats() {
  return {
    loaded,
    kitsu: byKitsu.size,
    mal: byMal.size,
    anilist: byAnilist.size,
    imdb: byImdb.size,
    tmdb: byTmdb.size,
    tvdb: byTvdb.size,
    anidb: byAnidb.size,
    etag: lastEtag,
  };
}

module.exports = {
  ensureLoaded,
  findByKitsu, findByMal, findByAnilist, findByAnidb,
  findByImdb, findByTmdb, findByTvdb,
  findAllByImdb, findAllByTmdb, findAllByTvdb,
  findByAny,
  stats,
};
