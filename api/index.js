'use strict';

/**
 * Vercel serverless entry point
 * Re-exports the Express app from server.js
 * Local dev: use `node server.js` directly
 */

// Pre-load anime mapping list at module init (Vercel cold start)
try { require('../src/mapping/anime_list').ensureLoaded().catch(() => {}); } catch {}

module.exports = require('../server');
