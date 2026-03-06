'use strict';

/**
 * Title processing utilities
 * Used by providers for search matching and ID normalization
 */

/**
 * Normalize a title for search comparison (lowercase, strip specials, collapse spaces).
 * Preserves Korean (Hangul), Chinese (CJK), and Japanese (Hiragana/Katakana) characters.
 * @param {string} title
 * @returns {string}
 */
function cleanTitleForSearch(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^\w\s\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute similarity score [0.0 – 1.0] between two titles.
 * Uses substring containment + word overlap + Levenshtein fallback.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function titleSimilarity(a, b) {
  const ca = cleanTitleForSearch(a);
  const cb = cleanTitleForSearch(b);

  if (ca === cb) return 1.0;
  if (ca.includes(cb) || cb.includes(ca)) return 0.85;

  const wordsA = ca.split(' ').filter(w => w.length > 2);
  const wordsB = cb.split(' ').filter(w => w.length > 2);
  if (!wordsA.length || !wordsB.length) return 0;

  // Word overlap
  const overlap = wordsA.filter(w => wordsB.includes(w)).length;
  const overlapScore = overlap / Math.max(wordsA.length, wordsB.length);
  if (overlapScore > 0) return overlapScore;

  // Levenshtein on full clean strings
  return (Math.max(ca.length, cb.length) - _levenshtein(ca, cb)) / Math.max(ca.length, cb.length);
}

/**
 * Extract a clean slug-style base ID from a complex Stremio ID string.
 * Strips year suffix (e.g. "-2023") and normalizes separators.
 * @param {string} id
 * @returns {string}
 */
function extractBaseSlug(id) {
  return id
    .replace(/,/g, '-')
    .toLowerCase()
    .replace(/-\d{4}$/, '')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Extract numeric episode or series ID component from composite Stremio IDs
 * like "kisskh_123:456" → "456"
 * @param {string} episodeId
 * @returns {string}
 */
function extractEpisodeNumericId(episodeId) {
  if (typeof episodeId === 'number') return String(episodeId);
  if (episodeId && episodeId.includes(':')) {
    return episodeId.split(':')[1];
  }
  return episodeId;
}

// ─── Internal ────────────────────────────────────────────────────────────────

function _levenshtein(a, b) {
  const la = a.length;
  const lb = b.length;
  const dp = Array.from({ length: la + 1 }, (_, i) => {
    const row = Array(lb + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

module.exports = { cleanTitleForSearch, titleSimilarity, extractBaseSlug, extractEpisodeNumericId };
