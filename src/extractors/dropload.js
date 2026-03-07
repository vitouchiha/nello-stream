const {
  USER_AGENT,
  extractPackedValue,
  getRefererBase,
  getUrlOrigin,
  normalizeExtractorUrl,
} = require('./common');

async function extractDropLoad(url, refererBase = null) {
  try {
    url = normalizeExtractorUrl(url);
    if (!url) return null;
    if (!refererBase) refererBase = getRefererBase(url);
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": refererBase
      }
    });
    if (!response.ok) return null;
    const html = await response.text();

    const packed = extractPackedValue(html, [
      /sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/i,
      /file\s*:\s*"([^"]+)"/i,
      /file\s*:\s*'([^']+)'/i,
    ]);

    if (packed && packed.value) {
      const streamUrl = normalizeExtractorUrl(packed.value, url);
      if (!streamUrl) return null;

      return {
        url: streamUrl,
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": url,
          "Origin": getUrlOrigin(url)
        }
      };
    }
    return null;
  } catch (e) {
    console.error("[Extractors] DropLoad extraction error:", e);
    return null;
  }
}

module.exports = { extractDropLoad };
