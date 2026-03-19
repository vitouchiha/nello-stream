/**
 * cfworker-proxy.js — Generic Cloudflare Worker proxy
 *
 * Proxies requests to allowed domains so they bypass Cloudflare Bot Management.
 * Cloudflare Workers are trusted by other CF-protected sites because the outbound
 * request carries Cloudflare AS headers.
 *
 * ── Deploy ───────────────────────────────────────────────────────────────────
 *   wrangler deploy cfworker-proxy.js --name streamfusion-proxy --config wrangler-proxy.toml
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   GET https://<worker>.workers.dev/?url=<encoded_target_url>
 *   GET https://<worker>.workers.dev/?url=<embed_url>&mode=sv_extract
 *       → extracts SuperVideo manifest URL & body in a single invocation
 *
 * ── Vercel env vars ──────────────────────────────────────────────────────────
 *   CF_PROXY_URL = https://<your-worker>.workers.dev
 */

// Domains allowed to be proxied (add more as needed)
const ALLOWED_HOSTS = new Set([
  'supervideo.tv',
  'supervideo.cc',
  'www.supervideo.tv',
  'www.supervideo.cc',
  'vixcloud.co',
  'www.vixcloud.co',
  'guardaserietv.bond',
  'www.guardaserietv.bond',
  'guardaserie.bond',
  'streamingcommunity.computer',
  'streamingcommunity.show',
]);

// Domains matched by suffix (for wildcard subdomains like hfs309.serversicuro.cc)
const ALLOWED_SUFFIXES = ['.serversicuro.cc', '.serversicuro.com'];

function isHostAllowed(hostname) {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  return ALLOWED_SUFFIXES.some(suffix => hostname.endsWith(suffix));
}

function _json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// ── p.a.c.k.e.r unpacker (ported from extractors/common.js) ─────────────────

const PACKER_PATTERNS = [
  /}\('(.*)',\s*(\d+|\[\]),\s*(\d+),\s*'(.*)'\.split\('\|'\),\s*(\d+),\s*(.*)\)\)/s,
  /}\('(.*)',\s*(\d+|\[\]),\s*(\d+),\s*'(.*)'\.split\('\|'\)/s,
];

function unPack(p, a, c, k, e, d) {
  e = function (c2) {
    return (c2 < a ? '' : e(parseInt(c2 / a))) +
      ((c2 = c2 % a) > 35 ? String.fromCharCode(c2 + 29) : c2.toString(36));
  };
  if (!''.replace(/^/, String)) {
    while (c--) { d[e(c)] = k[c] || e(c); }
    k = [function (e2) { return d[e2] || e2; }];
    e = function () { return '\\w+'; };
    c = 1;
  }
  while (c--) {
    if (k[c]) { p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]); }
  }
  return p;
}

function unpackPackedSource(source) {
  const text = String(source || '');
  if (!text.includes('eval(function(p,a,c,k,e,d)')) return null;
  for (const pattern of PACKER_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const payload = String(match[1] || '').replace(/\\\\/g, '\\').replace(/\\'/g, "'");
    const radix = match[2] === '[]' ? 62 : parseInt(match[2], 10);
    const count = parseInt(match[3], 10);
    const symtab = String(match[4] || '').split('|');
    if (!Number.isInteger(radix) || !Number.isInteger(count) || symtab.length < count) continue;
    try { return unPack(payload, radix, count, symtab, null, {}); } catch { continue; }
  }
  return null;
}

function extractM3u8FromHtml(html) {
  // Strategy 1: direct m3u8 in sources
  const directMatch = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.m3u8[^"']*)/i);
  if (directMatch) return directMatch[1];

  // Strategy 2: unpack p.a.c.k.e.r
  const scriptBlocks = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) { if (m[1]) scriptBlocks.push(m[1]); }

  for (const source of [html, ...scriptBlocks]) {
    const unpacked = unpackPackedSource(source);
    if (!unpacked) continue;
    const fileMatch = unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)/i);
    if (fileMatch) return fileMatch[1];
  }

  // Strategy 3: raw regex for any m3u8 URL
  const rawMatch = html.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
  if (rawMatch) return rawMatch[1];

  return null;
}

// ── SuperVideo extraction endpoint ───────────────────────────────────────────
// Fetches embed page + manifest in a SINGLE Worker invocation (same outbound IP).
// serversicuro.cc tokens are IP-locked, so this ensures extraction IP = playback IP.
async function handleSuperVideoExtract(embedUrl) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // Step 1: Fetch embed page
  const embedResp = await fetch(embedUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://supervideo.tv/',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    redirect: 'follow',
  });

  if (!embedResp.ok) {
    return _json({ error: `Embed page returned ${embedResp.status}` }, embedResp.status);
  }

  const html = await embedResp.text();
  const manifestUrl = extractM3u8FromHtml(html);
  if (!manifestUrl) {
    return _json({ error: 'No m3u8 URL found in embed page' }, 404);
  }

  // Step 2: Fetch manifest (same Worker invocation → same outbound IP)
  const manifestResp = await fetch(manifestUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://supervideo.tv/', 'Accept': '*/*' },
    redirect: 'follow',
  });

  if (!manifestResp.ok) {
    // Return the URL anyway in case the caller wants to try an alternative proxy
    return _json({
      manifestUrl,
      manifestBody: null,
      error: `Manifest fetch returned ${manifestResp.status}`,
    }, 200);
  }

  const manifestBody = await manifestResp.text();
  return _json({ manifestUrl, manifestBody }, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'x-worker-auth',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ── Parse target URL ────────────────────────────────────────────────────
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return _json({ error: 'Missing required ?url= parameter' }, 400);
    }

    // ── SuperVideo extraction mode ──────────────────────────────────────────
    // Extracts embed page + fetches manifest in a single Worker invocation
    // (same outbound IP) to match IP-locked serversicuro.cc tokens.
    if (url.searchParams.get('mode') === 'sv_extract') {
      return handleSuperVideoExtract(targetUrl);
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return _json({ error: 'Invalid url parameter' }, 400);
    }

    // ── Security: only proxy allowed hosts ──────────────────────────────────
    if (!isHostAllowed(parsedTarget.hostname)) {
      return _json({ error: `Host not allowed: ${parsedTarget.hostname}` }, 403);
    }

    // ── Get optional Referer from query param ───────────────────────────────
    const referer = url.searchParams.get('referer') || `https://${parsedTarget.hostname}/`;
    // Detect if this is a cross-origin embed request (e.g. VixCloud loaded from AnimeUnity)
    const isCrossOrigin = !referer.includes(parsedTarget.hostname);

    // ── Build outbound request ──────────────────────────────────────────────
    // For HLS/media requests, use lighter headers
    const isMedia = /\.(m3u8|ts|mp4|aac|vtt)([?#]|$)/i.test(parsedTarget.pathname);

    const outboundHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': referer,
      ...(isMedia ? {} : { 'Origin': referer.replace(/\/$/, '').replace(/(\/[^/]+)+$/, '') }),
      'Accept': isMedia ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...(isMedia ? {} : {
        'Sec-Fetch-Dest': isCrossOrigin ? 'iframe' : 'document',
        'Sec-Fetch-Mode': isCrossOrigin ? 'navigate' : 'navigate',
        'Sec-Fetch-Site': isCrossOrigin ? 'cross-site' : 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      }),
    };

    try {
      const upstream = await fetch(targetUrl, {
        method: 'GET',
        headers: outboundHeaders,
        redirect: 'follow',
      });

      // Forward the body as-is with CORS headers added
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      // Remove CSP headers that could block usage
      responseHeaders.delete('Content-Security-Policy');
      responseHeaders.delete('X-Frame-Options');

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return _json({ error: `Upstream fetch failed: ${err.message}` }, 502);
    }
  },
};
