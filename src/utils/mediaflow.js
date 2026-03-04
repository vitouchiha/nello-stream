'use strict';

/**
 * MediaFlow Proxy integration
 * https://github.com/mhdzumair/mediaflow-proxy
 *
 * Wraps stream and subtitle URLs through a self-hosted MediaFlow Proxy instance.
 * This allows:
 *   - Bypassing IP-based geo-restrictions (Vercel/AWS IPs blocked by CDN)
 *   - Proxying HLS/MPD manifests + segments transparently for Stremio
 *   - Forwarding necessary request headers (Referer, Origin)
 *
 * MFP endpoint mapping:
 *   HLS (.m3u8)  → /proxy/hls/manifest.m3u8?d=URL&api_password=KEY
 *   DASH (.mpd)  → /proxy/mpd/manifest.m3u8?d=URL&api_password=KEY
 *   Direct video → /proxy/stream?d=URL&api_password=KEY
 *   Subtitle     → /proxy/stream?d=URL&api_password=KEY
 */

/**
 * Wrap a stream URL through MediaFlow Proxy.
 * @param {string} url           - Original stream URL
 * @param {object} config        - User config { mfpUrl, mfpKey }
 * @param {object} [fwdHeaders]  - Headers to forward (Referer, Origin)
 * @returns {string}             - Proxied URL, or original if MFP not configured
 */
function wrapStreamUrl(url, config, fwdHeaders = {}) {
  if (!config || !config.mfpUrl || !url) return url;

  const base   = config.mfpUrl.replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('d', url);
  if (config.mfpKey) params.set('api_password', config.mfpKey);
  if (fwdHeaders['Referer']) params.set('h_referer', fwdHeaders['Referer']);
  if (fwdHeaders['Origin'])  params.set('h_origin',  fwdHeaders['Origin']);

  if (/\.m3u8(\?|$)/i.test(url) || /\/hls\//i.test(url)) {
    return `${base}/proxy/hls/manifest.m3u8?${params}`;
  }
  if (/\.mpd(\?|$)/i.test(url)) {
    return `${base}/proxy/mpd/manifest.m3u8?${params}`;
  }
  return `${base}/proxy/stream?${params}`;
}

/**
 * Wrap a subtitle URL through MediaFlow Proxy.
 * @param {string} url    - Original subtitle URL (.srt / .vtt / .txt1)
 * @param {object} config - User config { mfpUrl, mfpKey }
 * @returns {string}
 */
function wrapSubUrl(url, config) {
  if (!config || !config.mfpUrl || !url) return url;
  const base   = config.mfpUrl.replace(/\/$/, '');
  const params = new URLSearchParams({ d: url });
  if (config.mfpKey) params.set('api_password', config.mfpKey);
  return `${base}/proxy/stream?${params}`;
}

module.exports = { wrapStreamUrl, wrapSubUrl };
