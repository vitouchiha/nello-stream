const {
  USER_AGENT,
  extractPackedValue,
  getRefererBase,
  normalizeExtractorUrl,
} = require('./common');

async function extractUpstream(url, refererBase = 'https://upstream.to/') {
  try {
    url = normalizeExtractorUrl(url);
    if (!url) return null;
    if (!refererBase) refererBase = getRefererBase(url, 'https://upstream.to/');
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": refererBase
      }
    });
    if (!response.ok) return null;
    const html = await response.text();

    const packed = extractPackedValue(html, [
      /file\s*:\s*"([^"]+)"/i,
      /file\s*:\s*'([^']+)'/i,
      /sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i,
    ]);

    if (packed && packed.value) {
      const streamUrl = normalizeExtractorUrl(packed.value, url);
      if (!streamUrl) return null;

      return {
        url: streamUrl,
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": refererBase
        }
      };
    }
    return null;
  } catch (e) {
    console.error("[Extractors] Upstream extraction error:", e);
    return null;
  }
}

module.exports = { extractUpstream };
