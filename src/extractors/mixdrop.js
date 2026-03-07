const {
  USER_AGENT,
  extractPackedValue,
  getUrlOrigin,
  normalizeExtractorUrl,
} = require('./common');

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

async function extractMixDrop(url, refererBase = 'https://m1xdrop.net/') {
  if (isMixDropDisabled()) return null;

  try {
    url = normalizeExtractorUrl(url);
    if (!url) return null;
    
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
