/**
 * api/kk-subtitles.js
 * Serve decrypted KissKH Italian subtitles from local cache (GitHub-tracked files)
 * 
 * Usage:
 *   GET /api/kk-subtitles?id={serieId}:{episodeId}
 *   → returns JSON array of subtitle objects
 */

const fs = require('fs');
const path = require('path');

// Map to the kk-subs-cache directory in the repo
const CACHE_DIR = path.resolve(__dirname, '..', 'kk-subs-cache');

module.exports = (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing id parameter (format: serieId:episodeId)' });
    }

    const [serieId, episodeId] = id.split(':');
    if (!serieId || !episodeId) {
      return res.status(400).json({ error: 'Invalid id format (expected serieId:episodeId)' });
    }

    // Build path to the cached subtitle file
    const filePath = path.join(CACHE_DIR, String(serieId), `${episodeId}.json`);

    // Prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(path.normalize(CACHE_DIR))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Subtitles not found for ${id}` });
    }

    // Read and return the cached subtitles
    const subtitles = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.status(200).json(subtitles);
  } catch (error) {
    console.error('[KK-SUBS] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
