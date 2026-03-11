const { buildProxyUrl, isHlsProxyPlaybackUrl } = require('./utils/hlsProxy');

function isMp4Url(rawUrl, depth = 0) {
    const url = String(rawUrl || '').trim();
    if (!url) return false;

    const directMatch = (value) => /\.mp4(?:[?#].*)?$/i.test(String(value || '').trim());
    if (directMatch(url)) return true;
    if (depth >= 1) return false;

    try {
        const parsed = new URL(url);
        if (String(parsed.pathname || '').toLowerCase().endsWith('.mp4')) return true;

        // Handle proxy URLs that carry the real media URL in query params
        const nestedKeys = ['url', 'src', 'file', 'link', 'stream'];
        for (const key of nestedKeys) {
            const nested = parsed.searchParams.get(key);
            if (!nested) continue;

            let decoded = nested;
            try {
                decoded = decodeURIComponent(nested);
            } catch (_) {
                decoded = nested;
            }
            if (isMp4Url(decoded, depth + 1)) return true;
        }
        return false;
    } catch {
        return directMatch(url);
    }
}

function shouldSetNotWebReady(url, headers, behaviorHints = {}) {
    if (behaviorHints.notWebReady === false) return false;
    if (behaviorHints.notWebReady === true && !isMp4Url(url)) return true;
    if (isHlsProxyPlaybackUrl(url)) return false;
    // MP4 URLs that require custom headers (e.g. Referer/Origin for MixDrop)
    // MUST be notWebReady so Stremio applies proxyHeaders.
    if (isMp4Url(url)) {
        const proxyHeaders = behaviorHints.proxyHeaders && behaviorHints.proxyHeaders.request;
        if (proxyHeaders && Object.keys(proxyHeaders).length > 0) return true;
        if (headers && Object.keys(headers).length > 0) return true;
        return false;
    }
    const proxyHeaders = behaviorHints.proxyHeaders && behaviorHints.proxyHeaders.request;
    if (proxyHeaders && Object.keys(proxyHeaders).length > 0) return true;
    if (headers && Object.keys(headers).length > 0) return true;
    return true;
}

function cloneBehaviorHints(behaviorHints = {}) {
    const next = { ...behaviorHints };
    if (behaviorHints.proxyHeaders && typeof behaviorHints.proxyHeaders === 'object') {
        next.proxyHeaders = { ...behaviorHints.proxyHeaders };
        if (behaviorHints.proxyHeaders.request && typeof behaviorHints.proxyHeaders.request === 'object') {
            next.proxyHeaders.request = { ...behaviorHints.proxyHeaders.request };
        }
    }
    return next;
}

function hasHeaders(headers) {
    return !!(headers && typeof headers === 'object' && Object.keys(headers).length > 0);
}

function shouldProxyForWebPlayback(stream, url, headers, addonBaseUrl) {
    if (!addonBaseUrl) return false;
    if (isHlsProxyPlaybackUrl(url)) return false;
    if (stream.isExternal) return false; // Non proxare le pagine web esterne
    if (stream.behaviorHints && stream.behaviorHints.proxyPlaybackDisabled) return false;
    return !isMp4Url(url);
}

function formatStream(stream, providerName) {
    // ─── Quality badge ────────────────────────────────────────────────────
    let qualityBadge = '';
    const rawQ = String(stream.quality || '').toLowerCase();
    if (rawQ === '2160p' || rawQ === '4k')       qualityBadge = '4K';
    else if (rawQ === '1440p')                    qualityBadge = '1440p';
    else if (rawQ === '1080p' || rawQ === 'fhd')  qualityBadge = '1080p';
    else if (rawQ === '720p' || rawQ === 'hd')    qualityBadge = '720p';
    else if (['576p','480p','360p','240p','sd'].includes(rawQ)) qualityBadge = rawQ.toUpperCase();

    // ─── Language detection ─────────────────────────────────────────────
    let langLabel = '';
    const lang = stream.language || '';
    const titleLower = String(stream.title || '').toLowerCase();
    const nameLower  = String(stream.name || '').toLowerCase();
    if (lang.includes('SUB') || nameLower.includes('sub ita') || titleLower.includes('sub ita') || titleLower.includes('sub'))
      langLabel = '🇰🇷 SUB ITA';
    else if (lang.includes('🇮🇹') || nameLower.includes('ita') || titleLower.includes('[ita]'))
      langLabel = '🇮🇹 [ITA]';
    else
      langLabel = '🇮🇹 [ITA]';

    // ─── Provider label (StreamVix-style) ───────────────────────────────
    let pName = stream.name || stream.server || providerName;
    if (pName) {
        pName = pName
            .replace(/\s*\[?\(?\s*SUB\s*ITA\s*\)?\]?/i, '')
            .replace(/\s*\[?\(?\s*ITA\s*\)?\]?/i, '')
            .replace(/\s*\[?\(?\s*SUB\s*\)?\]?/i, '')
            .replace(/\(\s*\)/g, '')
            .replace(/\[\s*\]/g, '')
            .trim();
    }
    if (!pName || pName === providerName) {
        pName = typeof providerName === 'string'
            ? providerName.charAt(0).toUpperCase() + providerName.slice(1)
            : 'Provider';
    }

    const providerEmojis = {
        'streamingcommunity': '🤌 StreamingCommunity 🍿',
        'cb01': '🤌 CB01 🎞️',
        'guardaserie': '🤌 GuardaSerie 🎥',
        'guardoserie': '🤌 Guardoserie 📼',
        'guardahd': '🤌 GuardaHD 🎬',
        'eurostreaming': '🤌 Eurostreaming 🇪🇺',
        'loonex': '🤌 Loonex 🎬',
        'toonitalia': '🤌 ToonItalia 🎨',
        'animeunity': '🤌 AnimeUnity ⛩️',
        'animeworld': '🤌 AnimeWorld 🌍',
        'animesaturn': '🤌 AnimeSaturn 🪐',
        'kisskh': '🤌 KissKH 💋',
        'rama': '🤌 Rama 🌺',
    };
    const pKey = String(providerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const providerLabel = providerEmojis[pKey] || `🤌 ${pName}`;

    // ─── Size info ──────────────────────────────────────────────────────
    let sizeLabel = '';
    if (stream.size) sizeLabel = `💾 ${stream.size}`;

    // ─── Player / extractor name ────────────────────────────────────────
    let playerLabel = '';
    if (stream.server && stream.server !== pName) playerLabel = `▶️ ${stream.server}`;
    else if (stream.extractor) playerLabel = `▶️ ${stream.extractor}`;

    // ─── Extra details (codec, bitrate) ─────────────────────────────────
    let extras = [];
    if (stream.videoCodec) extras.push(stream.videoCodec);
    if (stream.audioCodec) extras.push(stream.audioCodec);
    if (stream.bitrate) extras.push(stream.bitrate);
    if (stream.fps) extras.push(`${stream.fps}fps`);

    // ─── Proxy status ───────────────────────────────────────────────────
    const hasProxy = !!(process.env.PROXY_URL || process.env.PROXY);
    const proxyLabel = `🌐 Proxy (${hasProxy ? 'ON' : 'OFF'})`;

    // ─── Build NAME field (left column in Stremio) ──────────────────────
    //  StreamVix style: provider name + quality badge on left
    let nameLines = [];
    if (qualityBadge) nameLines.push(qualityBadge);
    nameLines.push(pName);
    const finalName = nameLines.join('\n');

    // ─── Build TITLE field (right column in Stremio, multi-line) ────────
    let titleLines = [];
    titleLines.push(`🎬 ${stream.title || 'Stream'}`);
    titleLines.push(`🗣 ${langLabel}`);
    if (qualityBadge) titleLines.push(`📺 ${qualityBadge}`);
    if (sizeLabel) titleLines.push(sizeLabel);
    if (playerLabel) titleLines.push(playerLabel);
    if (extras.length) titleLines.push(`📊 ${extras.join(' | ')}`);
    titleLines.push(proxyLabel);
    titleLines.push(providerLabel);
    const finalTitle = titleLines.join('\n');

    // ─── Behavior hints / proxy / headers (unchanged logic) ─────────────

    // Move headers to behaviorHints if present, but keep original for compatibility
    const behaviorHints = cloneBehaviorHints(stream.behaviorHints || {});
    const addonBaseUrl = String(stream.addonBaseUrl || stream.providerContext?.addonBaseUrl || '').trim();
    let finalHeaders = stream.headers;
    let finalUrl = stream.url;

    if (behaviorHints.proxyHeaders && behaviorHints.proxyHeaders.request) {
        finalHeaders = behaviorHints.proxyHeaders.request;
    } else if (behaviorHints.headers) {
        finalHeaders = behaviorHints.headers;
    }

    if (shouldProxyForWebPlayback(stream, finalUrl, finalHeaders, addonBaseUrl)) {
        const proxiedUrl = buildProxyUrl(addonBaseUrl, finalUrl, finalHeaders, undefined, stream.proxyUrl, stream.manifestBody);
        if (proxiedUrl) {
            finalUrl = proxiedUrl;
            finalHeaders = null;
            delete behaviorHints.proxyHeaders;
            delete behaviorHints.headers;
            behaviorHints.notWebReady = false;
        }
    }

    if (finalHeaders) {
        behaviorHints.proxyHeaders = behaviorHints.proxyHeaders || {};
        behaviorHints.proxyHeaders.request = finalHeaders;
        behaviorHints.headers = finalHeaders;
    } else {
        delete behaviorHints.proxyHeaders;
        delete behaviorHints.headers;
    }

    behaviorHints.notWebReady = shouldSetNotWebReady(finalUrl, finalHeaders, behaviorHints);

    const responseStream = {
        name: finalName,
        title: finalTitle,
        behaviorHints: behaviorHints,
    };

    if (stream.isExternal) {
        responseStream.externalUrl = finalUrl;
    } else {
        responseStream.url = finalUrl;
    }

    if (stream.subtitles) {
        responseStream.subtitles = stream.subtitles;
    }
    if (stream.description) {
        responseStream.description = stream.description;
    }

    return responseStream;
}

module.exports = { formatStream };
