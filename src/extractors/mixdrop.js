const {
  USER_AGENT,
  extractPackedValue,
  getUrlOrigin,
  normalizeExtractorUrl,
} = require('./common');
const { extractViaMfp } = require('../utils/mediaflow');

function isMixDropDisabled() {
  if (typeof global !== 'undefined' && global && global.DISABLE_MIXDROP === true) {
    return true;
  }

  const rawEnv =
    typeof process !== 'undefined' &&
    process &&
    process.env &&
    typeof process.env.DISABLE_MIXDROP === 'string'
      ? process.env.DISABLE_MIXDROP.trim().toLowerCase()
      : '';

  return ['1', 'true', 'yes', 'on'].includes(rawEnv);
}

async function extractMixDrop(url, refererBase = 'https://m1xdrop.net/', providerContext = null) {
  if (isMixDropDisabled()) return null;

  try {
    url = normalizeExtractorUrl(url);
    if (!url) return null;

    // Try MFP extractor first (handles new MixDrop obfuscation)
    // Resolve server-side to get a direct /proxy/stream URL — the
    // /extractor/video endpoint returns 302 without CORS headers,
    // which Stremio's player cannot follow.
    const mfpConfig = providerContext || {};
    if (mfpConfig.mfpUrl) {
      // MFP only works with m1xdrop.net/e/ — normalize other domains/paths
      const mfpUrl = url
        .replace(/^(https?:\/\/)(?:mixdrop\.(?:vip|ag|co|to|club|sx|ps|nu|click|vc|bz|gl)|m1xdrop\.(?:net|com))/i, '$1m1xdrop.net')
        .replace(/\/(emb|f)\//i, '/e/');
      const proxyUrl = await extractViaMfp(mfpUrl, 'Mixdrop', mfpConfig, true);
      if (proxyUrl) {
        return {
          url: proxyUrl,
          headers: null,
          mfpHandled: true,
        };
      }
      // Fall through to local extraction if MFP fails
    }

    // Fallback: local p.a.c.k.e.r extraction (old MixDrop format)
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": refererBase
      }
    });
    if (!response.ok) return null;
    const html = await response.text();

    const packed = extractPackedValue(html, [
      /MDCore\.wurl\s*=\s*"([^"]+)"/i,
      /MDCore\.wurl\s*=\s*'([^']+)'/i,
      /wurl\s*=\s*"([^"]+)"/i,
    ]);

    if (packed && packed.value) {
      const streamUrl = normalizeExtractorUrl(packed.value, url);
      if (!streamUrl) return null;

      const origin = getUrlOrigin(url) || 'https://m1xdrop.net';
      return {
        url: streamUrl,
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': `${origin}/`,
          'Origin': origin
        }
      };
    }
    return null;
  } catch (e) {
    console.error("[Extractors] MixDrop extraction error:", e);
    return null;
  }
}

module.exports = { extractMixDrop };
