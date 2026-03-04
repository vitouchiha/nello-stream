'use strict';

/**
 * User configuration — encode/decode from URL path
 *
 * Config is stored as base64url-encoded JSON in the addon URL:
 *   https://streamfusion-mail.vercel.app/BASE64_CONFIG/manifest.json
 *
 * This lets each user have their own personalised install URL with
 * their MediaFlow Proxy and HTTP proxy settings baked in.
 *
 * Short keys to keep URLs compact:
 *   mfp   → MediaFlow Proxy base URL
 *   mfpk  → MediaFlow Proxy API key
 *   px    → HTTP proxy URL (for catalog/meta requests blocked by Cloudflare)
 */

const DEFAULT_CONFIG = {
  mfpUrl:   '',  // e.g. https://mfp.example.com
  mfpKey:   '',  // e.g. mysecretpassword
  proxyUrl: '',  // e.g. http://user:pass@host:port
};

/**
 * Encode config object to base64url string.
 * @param {object} config
 * @returns {string}
 */
function encodeConfig(config) {
  const obj = {};
  if (config.mfpUrl)   obj.mfp  = config.mfpUrl.trim();
  if (config.mfpKey)   obj.mfpk = config.mfpKey.trim();
  if (config.proxyUrl) obj.px   = config.proxyUrl.trim();
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/**
 * Decode base64url string to config object.
 * @param {string} encoded
 * @returns {object}
 */
function decodeConfig(encoded) {
  if (!encoded) return { ...DEFAULT_CONFIG };
  try {
    const obj = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return {
      mfpUrl:   (obj.mfp  || '').trim(),
      mfpKey:   (obj.mfpk || '').trim(),
      proxyUrl: (obj.px   || '').trim(),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Check if a path segment is a valid config (not a reserved route segment).
 * @param {string} str
 * @returns {boolean}
 */
function isValidConfig(str) {
  if (!str || typeof str !== 'string' || str.length < 4) return false;
  const reserved = ['catalog', 'meta', 'stream', 'manifest.json', 'health', 'debug'];
  if (reserved.includes(str.toLowerCase())) return false;
  // Must decode to valid JSON object
  try {
    const decoded = Buffer.from(str, 'base64url').toString('utf8');
    const obj = JSON.parse(decoded);
    return typeof obj === 'object' && obj !== null;
  } catch {
    return false;
  }
}

module.exports = { encodeConfig, decodeConfig, isValidConfig, DEFAULT_CONFIG };
