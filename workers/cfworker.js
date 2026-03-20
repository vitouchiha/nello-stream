/**
 * cfworker.js — Cloudflare Worker proxy for kisskh.co API
 *
 * Bypasses Cloudflare Bot Management on kisskh.co by proxying requests
 * from inside Cloudflare's own network (Workers bypass CF protection on
 * co-hosted sites because the outbound request carries Cloudflare AS
 * headers and is trusted at the network layer).
 *
 * ── Deploy ─────────────────────────────────────────────────────────────────
 *   Option A — Cloudflare Dashboard:
 *     Workers & Pages → Create → "Hello World" → paste this file → Deploy
 *
 *   Option B — Wrangler CLI:
 *     npm i -g wrangler
 *     npx wrangler deploy cfworker.js --name kisskh-proxy --compatibility-date 2024-01-01
 *
 * ── Environment variables (set in Cloudflare Worker settings) ───────────────
 *   AUTH_TOKEN   optional secret; if set, callers must send the same value in
 *                the "x-worker-auth" request header (or ?auth= query param).
 *                Generate with: openssl rand -hex 32
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   GET https://<worker>.workers.dev/?url=<encoded_kisskh_api_url>
 *   GET https://<worker>.workers.dev/?url=<...>&xhr=1          (adds X-Requested-With)
 *   GET https://<worker>.workers.dev/?url=<...>&referer=<url>  (custom Referer)
 *
 * ── StreamFusion Mail config ────────────────────────────────────────────────
 *   Set the following Vercel environment variables:
 *     CF_WORKER_URL  = https://<your-worker>.workers.dev
 *     CF_WORKER_AUTH = <your AUTH_TOKEN value>  (optional, but recommended)
 */

/**
 * Normalize any guardoserie domain variant → .website (canonical KV domain).
 * Regex catches ALL TLDs (.website, .best, .horse, .surf, .bar, .blog, etc.)
 * so a domain change only needs updating ALLOWED_HOSTS + _KV_CACHEABLES, not
 * the normalization logic.
 */
function _normalizeGsUrl(url) {
  return url.replace(/guardoserie\.[a-z]+/gi, 'guardoserie.website');
}

export default {
  // ── Scheduled cron: auto-refresh Eurostreaming cache + domain updates + uprot + GuardoSerie ──
  async scheduled(event, env, ctx) {
    ctx.waitUntil(_handleScheduledWarm(env));
    ctx.waitUntil(_handleScheduledDomainUpdate(env));
    ctx.waitUntil(_handleScheduledUprotRefresh(env));
    ctx.waitUntil(_handleScheduledGsWarm(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'x-worker-auth, content-type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ── Provider URLs: public endpoint (no auth needed) ───────────────────
    if (url.searchParams.get('provider_urls') === '1') {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      try {
        const data = await env.ES_CACHE.get('domains:urls', 'json');
        if (!data) return _json({ error: 'No domain data yet — cron not run' }, 404);
        return _json(data);
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── Auth check (skip if AUTH_TOKEN not set) ─────────────────────────────
    const authToken = (env.AUTH_TOKEN || '').trim();
    if (authToken) {
      const provided = (
        request.headers.get('x-worker-auth') ||
        url.searchParams.get('auth') ||
        ''
      ).trim();
      if (provided !== authToken) {
        return _json({ error: 'Unauthorized' }, 401);
      }
    }

    // ── Parse target URL ────────────────────────────────────────────────────
    const targetUrl = url.searchParams.get('url');

    // ── GuardoSerie push: accept locally-scraped pages and store in KV ─────
    if (url.searchParams.get('gs_push') === '1' && request.method === 'POST') {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      try {
        const body = await request.json();
        const pages = Array.isArray(body) ? body : [body];
        let stored = 0;
        for (const { url: pageUrl, html } of pages) {
          if (!pageUrl || !html) continue;
          // Normalize to .digital for consistency with provider's _cfWorkerFetch
          const normUrl = _normalizeGsUrl(pageUrl);
          const kvKey = `p:${normUrl}`;
          const kvVal = JSON.stringify({ b: html, s: 200, l: '', ck: '', ct: 'text/html; charset=UTF-8', t: Date.now() });
          await env.ES_CACHE.put(kvKey, kvVal, { expirationTtl: 172800 }); // 48h
          stored++;
        }
        return _json({ ok: true, stored, total: pages.length });
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── GuardoSerie titles index: serve from KV (GET) or accept push (POST) ──
    if (url.searchParams.get('gs_titles') === '1') {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
            return _json({ error: 'Empty index' }, 400);
          }
          await env.ES_CACHE.put('gs:titles', JSON.stringify(body), { expirationTtl: 172800 });
          return _json({ ok: true, entries: Object.keys(body).length });
        } catch (e) { return _json({ error: e.message }, 500); }
      }
      try {
        const index = await env.ES_CACHE.get('gs:titles', 'json');
        if (index) return _json(index);
        return _json({ error: 'Index not built yet' }, 404);
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── KissKH meta KV cache ─────────────────────────────────────────────
    // GET  ?kk_meta={dramaId}         → read meta from KV
    // POST ?kk_meta={dramaId} + body  → store meta in KV (7 days TTL)
    if (url.searchParams.get('kk_meta')) {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      const kid = url.searchParams.get('kk_meta');
      const kvKey = `kk:meta:${kid}`;
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          await env.ES_CACHE.put(kvKey, JSON.stringify(body), { expirationTtl: 604800 });
          return _json({ ok: true });
        } catch (e) { return _json({ error: e.message }, 500); }
      }
      try {
        const data = await env.ES_CACHE.get(kvKey, 'json');
        if (data) return _json(data);
        return _json(null, 404);
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── KissKH subtitle KV cache ─────────────────────────────────────────
    // GET  ?kk_sub={serieId}:{episodeId}         → read subs from KV
    // POST ?kk_sub={serieId}:{episodeId} + body  → store subs in KV (90 days TTL - subtitles are immutable)
    if (url.searchParams.get('kk_sub')) {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      const subKey = url.searchParams.get('kk_sub');
      const kvKey = `kk:sub:${subKey}`;
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          await env.ES_CACHE.put(kvKey, JSON.stringify(body), { expirationTtl: 7776000 });
          return _json({ ok: true });
        } catch (e) { return _json({ error: e.message }, 500); }
      }
      try {
        const data = await env.ES_CACHE.get(kvKey, 'json');
        if (data) return _json(data);
        return _json(null, 404);
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── Generic page cache KV (used by cache_manager auto-persist) ───────
    // GET  ?pc={cacheKey}         → read page from KV
    // POST ?pc={cacheKey} + body  → store page in KV (1h TTL)
    if (url.searchParams.get('pc')) {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      const pcKey = url.searchParams.get('pc');
      const kvKey = `pc:${pcKey}`;
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          await env.ES_CACHE.put(kvKey, JSON.stringify(body), { expirationTtl: 3600 });
          return _json({ ok: true });
        } catch (e) { return _json({ error: e.message }, 500); }
      }
      try {
        const data = await env.ES_CACHE.get(kvKey, 'json');
        if (data) return _json(data);
        return _json(null, 404);
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── SFM state persistence: mirrors, health, scan-index ──────────────
    // GET  ?sfm_state={key}         → read state from KV  (keys: mirrors, health, scan_index)
    // POST ?sfm_state={key} + body  → write state to KV   (no TTL — persists forever)
    if (url.searchParams.get('sfm_state')) {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      const stateKey = url.searchParams.get('sfm_state');
      const allowed = ['mirrors', 'health', 'scan_index'];
      if (!allowed.includes(stateKey)) return _json({ error: `Invalid state key. Allowed: ${allowed.join(', ')}` }, 400);
      const kvKey = `sfm:${stateKey}`;
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          await env.ES_CACHE.put(kvKey, JSON.stringify(body));
          return _json({ ok: true, key: kvKey });
        } catch (e) { return _json({ error: e.message }, 500); }
      }
      try {
        const data = await env.ES_CACHE.get(kvKey, 'json');
        if (data) return _json(data);
        return _json(null, 404);
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── GuardoSerie warm-up: fetch + cache list of URLs in KV ─────────────
    if (url.searchParams.get('gs_warm') === '1') {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      const urls = url.searchParams.getAll('u');
      if (!urls.length) return _json({ error: 'Pass ?u=URL1&u=URL2 to warm' }, 400);
      const results = [];
      for (const u of urls.slice(0, 20)) { // max 20 URLs per call
        const normU = _normalizeGsUrl(u);
        const kvKey = `p:${normU}`;
        try {
          // Check if already cached and fresh
          const existing = await env.ES_CACHE.get(kvKey, 'json');
          if (existing && existing.t && (Date.now() - existing.t < 43200000)) { // 12h fresh
            results.push({ url: u, status: 'cached', age: Math.round((Date.now() - existing.t) / 1000) });
            continue;
          }
          const resp = await fetch(u, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
          });
          const body = await resp.text();
          const isCf = body.includes('Just a moment') || body.includes('Checking your browser');
          if (resp.ok && !isCf) {
            const kvVal = JSON.stringify({ b: body, s: resp.status, l: '', ck: '', ct: resp.headers.get('Content-Type') || 'text/html', t: Date.now() });
            await env.ES_CACHE.put(kvKey, kvVal, { expirationTtl: 86400 });
            results.push({ url: u, status: 'ok', size: body.length, hasIframes: body.includes('iframe') });
          } else {
            results.push({ url: u, status: 'blocked', httpStatus: resp.status, cf: isCf });
          }
        } catch (e) { results.push({ url: u, status: 'error', msg: e.message }); }
      }
      return _json({ warmed: results.filter(r => r.status === 'ok').length, cached: results.filter(r => r.status === 'cached').length, total: results.length, results });
    }

    // ── GuardoSerie fetch test: test various fetch approaches ─────────────
    if (url.searchParams.get('gs_test') === '1') {
      const gsUrl = url.searchParams.get('gs_url') || 'https://guardoserie.digital/?s=breaking+bad';
      const results = {};
      
      // Approach 1: minimal headers
      try {
        const t0 = Date.now();
        const r1 = await fetch(gsUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html, */*' } });
        const b1 = await r1.text();
        results.minimal = { status: r1.status, ms: Date.now()-t0, len: b1.length, cf: b1.includes('Just a moment'), serie: b1.includes('/serie/') };
      } catch (e) { results.minimal = { error: e.message }; }
      
      // Approach 2: full browser headers  
      try {
        const t0 = Date.now();
        const r2 = await fetch(gsUrl, { headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
        }});
        const b2 = await r2.text();
        results.browser = { status: r2.status, ms: Date.now()-t0, len: b2.length, cf: b2.includes('Just a moment'), serie: b2.includes('/serie/') };
      } catch (e) { results.browser = { error: e.message }; }

      // Approach 3: with CDN cache enabled
      try {
        const t0 = Date.now();
        const r3 = await fetch(gsUrl, { 
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
          },
          cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 86400, '400-599': 0 } }
        });
        const b3 = await r3.text();
        results.cdnCache = { status: r3.status, ms: Date.now()-t0, len: b3.length, cf: b3.includes('Just a moment'), serie: b3.includes('/serie/'), cfCache: r3.headers.get('CF-Cache-Status') };
      } catch (e) { results.cdnCache = { error: e.message }; }

      // Info: CF POP location
      results.cfPop = url.searchParams.get('_cf_pop') || 'unknown';

      return _json(results);
    }

    // ── Force domain update (manual trigger) ─────────────────────────────
    if (url.searchParams.get('update_domains') === '1') {
      if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);
      const result = await _resolveDomains(env);
      return _json(result);
    }

    // ── KV test endpoint ────────────────────────────────────────────────────
    if (url.searchParams.get('kv_test') === '1') {
      try {
        if (!env?.ES_CACHE) return _json({ error: 'ES_CACHE binding not found' });
        await env.ES_CACHE.put('_test_key', JSON.stringify({ ok: true, ts: Date.now() }), { expirationTtl: 300 });
        const read = await env.ES_CACHE.get('_test_key', 'json');
        return _json({ written: true, read });
      } catch (e) {
        return _json({ error: e.message, stack: e.stack });
      }
    }

    // ── Eurostreaming KV index: return cached titles index ──────────────────
    if (url.searchParams.get('es_titles') === '1') {
      if (!env?.ES_CACHE) return _json({ error: 'ES_CACHE binding not found' });
      try {
        const idx = await env.ES_CACHE.get('es:titles', 'json');
        if (!idx) return _json({ error: 'No titles index — run warm_es first' }, 404);
        return _json(idx);
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── Eurostreaming KV post data: return post content from batch page ─────
    if (url.searchParams.get('es_post_data')) {
      const postId = url.searchParams.get('es_post_data');
      const pageNum = url.searchParams.get('es_page');
      if (!env?.ES_CACHE) return _json({ error: 'ES_CACHE binding not found' });
      if (!/^\d+$/.test(postId)) return _json({ error: 'Invalid post ID' }, 400);
      if (!pageNum || !/^\d+$/.test(pageNum)) return _json({ error: 'Missing or invalid es_page param' }, 400);
      try {
        const batch = await env.ES_CACHE.get(`es:page:${pageNum}`, 'json');
        if (!batch || !Array.isArray(batch)) return _json({ error: 'Page not cached' }, 404);
        const post = batch.find(p => p.id === parseInt(postId, 10));
        if (!post) return _json({ error: 'Post not found in page' }, 404);
        return _json(post);
      } catch (e) { return _json({ error: e.message }, 500); }
    }

    // ── Eurostreaming KV warm-up: fetch all posts and cache in KV ───────────
    if (url.searchParams.get('warm_es') === '1') {
      if (!env?.ES_CACHE) return _json({ error: 'ES_CACHE binding not found' });

      // POST with JSON body = store titles index
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          if (body && typeof body === 'object') {
            await env.ES_CACHE.put('es:titles', JSON.stringify(body), { expirationTtl: _ES_KV_TTL });
            return _json({ ok: true, action: 'index_stored', entries: Object.keys(body).length });
          }
          return _json({ error: 'Invalid body' }, 400);
        } catch (e) { return _json({ error: `Index store failed: ${e.message}` }, 500); }
      }

      return _handleWarmEs(url, env);
    }

    // ── Uprot diagnostic: fetch captcha page and return raw analysis ──
    if (url.searchParams.get('uprot_diag') === '1') {
      return _handleUprotDiag(env);
    }

    // ── Uprot KV cookie cache: get/set cookies from external callers ──
    if (url.searchParams.get('uprot_kv') === '1') {
      return _handleUprotKv(request, env);
    }

    // ── Uprot solve only: solve captcha and cache cookies (no url needed) ──
    if (url.searchParams.get('uprot_solve') === '1') {
      return _handleUprotSolve(env);
    }

    // ── KissKH subtitle warming: full flow fetch+decrypt via CF Worker ──
    // Usage: POST ?kk_subs_warm=1 with JSON body: {episodeId}  (or {episodeId, subUrl})
    // Worker does: Sub API → filter ITA → fetch .txt1 → decrypt → return JSON
    if (url.searchParams.get('kk_subs_warm') === '1') {
      if (request.method !== 'POST') {
        return _json({ error: 'POST required' }, 405);
      }
      return _handleKkSubsWarm(request, env);
    }

    // ── OCR digits: accept base64 image, return recognized digits ──
    if (url.searchParams.get('ocr_digits') === '1' && request.method === 'POST') {
      return _handleOcrDigits(request, env);
    }

    if (!targetUrl) {
      return _json({ error: 'Missing required ?url= parameter' }, 400);
    }

    // ── Security: only proxy allowed hosts ──────────────────────────────────
    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return _json({ error: 'Invalid url parameter' }, 400);
    }

    const ALLOWED_HOSTS = new Set([
      'kisskh.do', 'www.kisskh.do', 'kisskh.co', 'www.kisskh.co',
      'eurostream.ing', 'www.eurostream.ing',
      'eurostreamings.life', 'www.eurostreamings.life',
      'clicka.cc', 'www.clicka.cc',
      'safego.cc', 'www.safego.cc',
      'deltabit.co', 'www.deltabit.co',
      'turbovid.me', 'www.turbovid.me',
      'uprot.net', 'www.uprot.net',
      'uprots.me', 'www.uprots.me',
      'maxstream.video', 'www.maxstream.video',
      'animeunity.so', 'www.animeunity.so',
    ]);
    // guardoserie.* — any TLD is auto-allowed (domain changes frequently)
    const hostBare = parsedTarget.hostname.replace(/^www\./, '');
    const isAllowed = ALLOWED_HOSTS.has(parsedTarget.hostname) || /^guardoserie\.[a-z]+$/i.test(hostBare);
    if (!isAllowed) {
      return _json({ error: `Host ${parsedTarget.hostname} is not proxied by this Worker` }, 403);
    }

    // ── AnimeUnity search: full session + CSRF + POST search ─────────────
    // CF Worker handles the full flow since AnimeUnity CF-blocks Vercel IPs.
    // Usage: ?au_search=1&title=Frieren[&anilist_id=182255]
    if (url.searchParams.get('au_search') === '1') {
      return _handleAuSearch(url, request);
    }

    // ── ES Stream: full clicka→safego→captcha→deltabit→video extraction ────
    // Stremio calls this URL directly; Worker runs at player's edge (not Vercel's).
    // Returns 302 redirect to the final video MP4/M3U8 URL.
    // Usage: ?es_stream=1&url=https://clicka.cc/delta/xxx
    if (url.searchParams.get('es_stream') === '1') {
      return _handleEsStream(targetUrl, url, env);
    }

    // ── ES Resolve: full clicka→safego→captcha→deltabit chain in one shot ──
    // Usage: ?es_resolve=1&url=https://clicka.cc/delta/xxx
    // Returns: { url: 'https://deltabit.co/xxx', cached: bool }
    if (url.searchParams.get('es_resolve') === '1' && parsedTarget.hostname.includes('clicka')) {
      return _handleEsResolve(targetUrl, url, env);
    }

    // ── Uprot captcha solver + MaxStream extractor ──────────────────────────
    // Solves uprot captcha, follows redirects to maxstream, extracts video URL.
    // Usage: ?uprot=1&url=https://uprot.net/msf/xxx[&extract=1]
    if (url.searchParams.get('uprot') === '1' && parsedTarget.hostname.includes('uprot')) {
      return _handleUprot(targetUrl, url, env);
    }

    // ── Safego captcha solver mode ──────────────────────────────────────────
    // All requests happen in one Worker invocation (same outbound IP).
    if (url.searchParams.get('safego') === '1' && parsedTarget.hostname.includes('safego')) {
      return _handleSafego(targetUrl, url, env);
    }

    // ── Safego diagnostic: fetch captcha and return OCR analysis ─────────────
    if (url.searchParams.get('safego_diag') === '1' && parsedTarget.hostname.includes('safego')) {
      return _handleSafegoDiag(targetUrl);
    }

    // ── nofollow mode: return redirect info without following ────────────────
    const nofollow = url.searchParams.get('nofollow') === '1';

    // ── Build outbound headers ──────────────────────────────────────────────
    const isXhr    = url.searchParams.get('xhr') === '1';
    const isKissKH = parsedTarget.hostname.includes('kisskh');
    const isEurostream = parsedTarget.hostname.includes('eurostream');
    const isClicka = parsedTarget.hostname.includes('clicka');
    const isSafego = parsedTarget.hostname.includes('safego');
    const isDeltabit = parsedTarget.hostname.includes('deltabit');
    const isTurbovid = parsedTarget.hostname.includes('turbovid');

    const referer  = url.searchParams.get('referer') ||
      (isKissKH ? 'https://kisskh.co/' :
       isEurostream ? 'https://eurostream.ing/' :
       isClicka ? 'https://eurostream.ing/' :
       isSafego ? 'https://safego.cc/' :
       isDeltabit ? 'https://safego.cc/' :
       isTurbovid ? 'https://safego.cc/' : '/');

    const origin  = isKissKH ? 'https://kisskh.co' :
                    isEurostream ? 'https://eurostream.ing' :
                    isClicka ? 'https://clicka.cc' :
                    isSafego ? 'https://safego.cc' :
                    isDeltabit ? parsedTarget.origin :
                    isTurbovid ? parsedTarget.origin : parsedTarget.origin;

    const isEpisodeApi = parsedTarget.pathname.includes('/DramaList/Episode/');
    const isGuardoserie = parsedTarget.hostname.includes('guardoserie');
    const cookie = url.searchParams.get('cookie') || '';

    const headers = {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          isEurostream ? 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8' : isGuardoserie ? 'text/html, */*' : 'application/json, text/plain, */*',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer':         referer,
      'Origin':          origin,
    };
    // Full browser headers for Cloudflare-protected sites (eurostream, clicka, guardoserie)
    if (isEurostream || isClicka || isGuardoserie) {
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
      headers['Accept-Encoding'] = 'gzip, deflate, br';
      headers['Cache-Control'] = 'no-cache';
      headers['Pragma'] = 'no-cache';
      headers['Sec-Fetch-Dest'] = 'document';
      headers['Sec-Fetch-Mode'] = 'navigate';
      headers['Sec-Fetch-Site'] = 'none';
      headers['Sec-Fetch-User'] = '?1';
      headers['Upgrade-Insecure-Requests'] = '1';
      headers['sec-ch-ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"Windows"';
      delete headers['Origin']; // Browsers don't send Origin on navigation
    }
    if (cookie) headers['Cookie'] = cookie;
    // Custom Content-Type for POST requests (e.g. guardoserie WP AJAX)
    const contentType = url.searchParams.get('contentType');
    if (contentType) headers['Content-Type'] = contentType;

    // Episode API and XHR-mode requests need X-Requested-With
    if (isXhr || isEpisodeApi) {
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }

    // ── KV cache: domains where responses are cached globally ──────────────
    const _KV_CACHEABLES = { 'eurostream.ing': 86400, 'eurostreamings.life': 86400, 'clicka.cc': 86400, 'deltabit.co': 3600 };
    const hostNorm = parsedTarget.hostname.replace(/^www\./, '');
    // guardoserie.* — any TLD gets 86400 TTL automatically
    const kvTtl = _KV_CACHEABLES[hostNorm] || (/^guardoserie\.[a-z]+$/i.test(hostNorm) ? 86400 : 0);
    const isPost = url.searchParams.get('method') === 'POST';
    // Only cache GET requests (POST = captcha submissions, form posts)
    const kvKey = kvTtl && !isPost ? `p:${targetUrl}` : null;

    // ── Proxy request ───────────────────────────────────────────────────────
    try {
      // For guardoserie: enable CDN edge cache for 200s (survives across Worker invocations at the same POP)
      const cfOpts = isGuardoserie
        ? { cacheEverything: true, cacheTtlByStatus: { '200-299': 86400, '300-399': 0, '400-599': 0 } }
        : { cacheEverything: false };

      const resp = await fetch(targetUrl, {
        method: isPost ? 'POST' : 'GET',
        headers,
        body: isPost ? (url.searchParams.get('body') || '') : undefined,
        redirect: nofollow ? 'manual' : 'follow',
        cf: cfOpts,
      });

      // Read response once
      const bodyBuf = await resp.arrayBuffer();
      const bodyText = new TextDecoder().decode(bodyBuf);
      const status = resp.status;
      const location = resp.headers.get('Location') || resp.headers.get('location') || '';
      const setCk = resp.headers.get('Set-Cookie') || '';
      const ct = resp.headers.get('Content-Type') || 'application/json; charset=utf-8';

      // Detect Cloudflare block
      const isCfBlock = status === 403 && (bodyText.includes('Just a moment') || bodyText.includes('Checking your browser'));

      // If blocked and cacheable → fall back to KV
      if (isCfBlock && kvKey && env?.ES_CACHE) {
        try {
          const cached = await env.ES_CACHE.get(kvKey, 'json');
          if (cached && cached.b) {
            return _proxyResponse(cached.b, cached.s || 200, cached.l || '', cached.ck || '', cached.ct || ct, nofollow, url.searchParams.get('wantCookie') === '1', true);
          }
        } catch { /* KV read error */ }
      }

      // If success and cacheable → store in KV (skip if already cached and fresh)
      if (!isCfBlock && status >= 200 && status < 400 && kvKey && env?.ES_CACHE) {
        try {
          const existing = await env.ES_CACHE.get(kvKey, 'json');
          const isFresh = existing && existing.t && (Date.now() - existing.t < kvTtl * 500); // refresh at half TTL
          if (!isFresh) {
            const kvVal = JSON.stringify({ b: bodyText, s: status, l: location, ck: setCk, ct, t: Date.now() });
            await env.ES_CACHE.put(kvKey, kvVal, { expirationTtl: Math.max(kvTtl, 60) });
          }
        } catch (kvErr) { /* KV write error — silently ignore */ }
      }

      return _proxyResponse(bodyText, status, location, setCk, ct, nofollow, url.searchParams.get('wantCookie') === '1', false);
    } catch (err) {
      // Fetch error → try KV as last resort
      if (kvKey && env?.ES_CACHE) {
        try {
          const cached = await env.ES_CACHE.get(kvKey, 'json');
          if (cached && cached.b) {
            return _proxyResponse(cached.b, cached.s || 200, cached.l || '', cached.ck || '', cached.ct || 'text/html', nofollow, url.searchParams.get('wantCookie') === '1', true);
          }
        } catch { /* KV read error */ }
      }
      return _json({ error: `Proxy fetch failed: ${err.message}` }, 502);
    }
  },
};

// ─── Eurostreaming KV warm-up ──────────────────────────────────────────────────

const _ES_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const _ES_KV_TTL = 172800; // 48h — warm-up data is long-lived

async function _esWarmFetch(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': _ES_UA,
      'Accept': 'application/json,text/html,*/*',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua': '"Chromium";v="125", "Google Chrome";v="125", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  const body = await resp.text();
  if (!resp.ok || body.includes('Just a moment')) return null;
  return body;
}

async function _handleAuSearch(reqUrl, request) {
  const title = reqUrl.searchParams.get('title') || '';
  const anilistId = reqUrl.searchParams.get('anilist_id') || '';
  if (!title && !anilistId) return _json({ error: 'title or anilist_id required' }, 400);

  const AU_BASE = 'https://www.animeunity.so';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // Step 1: GET main page to establish session + CSRF
  let csrf = null;
  let sessionCookies = '';
  try {
    const mainResp = await fetch(AU_BASE, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!mainResp.ok) return _json({ error: 'AU main page fetch failed', status: mainResp.status }, 502);
    const html = await mainResp.text();
    csrf = (html.match(/name="csrf-token"\s+content="([^"]+)"/) || [])[1] || null;
    const setCookies = mainResp.headers.getAll?.('Set-Cookie') || [];
    sessionCookies = setCookies.map(c => c.split(';')[0]).join('; ');
    if (!csrf) return _json({ error: 'No CSRF token found on AU page', htmlLen: html.length }, 502);
  } catch (e) {
    return _json({ error: 'AU session failed: ' + e.message }, 502);
  }

  // Step 2: POST search using CSRF + session cookies
  const searchTitle = title || 'Frieren';
  try {
    const searchResp = await fetch(`${AU_BASE}/archivio/get-animes`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': csrf,
        'Cookie': sessionCookies,
        'Referer': AU_BASE + '/archivio',
      },
      body: JSON.stringify({ title: searchTitle }),
      signal: AbortSignal.timeout(10000),
    });
    if (!searchResp.ok) {
      const errText = await searchResp.text().catch(() => '');
      return _json({ error: 'AU search failed', status: searchResp.status, body: errText.substring(0, 200) }, 502);
    }
    const data = await searchResp.json();
    const records = data.records || data.data || data || [];
    if (!Array.isArray(records)) return _json({ records: [], title: searchTitle });

    // Step 3: Build paths (matching by anilist_id if available, else title)
    const paths = [];
    if (anilistId) {
      const match = records.find(r => r.anilist_id === Number(anilistId));
      if (match && match.id && match.slug) {
        paths.push(`/anime/${match.id}-${match.slug}`);
      }
    }
    const normTitle = searchTitle.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (normTitle) {
      for (const r of records) {
        if (!r.id || !r.slug) continue;
        for (const c of [r.title, r.title_eng, r.title_it].filter(Boolean)) {
          const norm = c.toLowerCase().replace(/[^a-z0-9]+/g, '');
          if (norm.includes(normTitle) || normTitle.includes(norm)) {
            const path = `/anime/${r.id}-${r.slug}`;
            if (!paths.includes(path)) paths.push(path);
            break;
          }
        }
        if (paths.length >= 5) break;
      }
    }
    return _json({ paths, title: searchTitle, recordCount: records.length });
  } catch (e) {
    return _json({ error: 'AU POST failed: ' + e.message }, 502);
  }
}

async function _handleWarmEs(url, env) {
  const baseUrl = (url.searchParams.get('base') || 'https://eurostream.ing').replace(/\/+$/, '');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const perPage = 100;

  // Fetch one page of posts and cache the WHOLE page as one KV entry
  const errors = [];
  let totalPosts = 0;
  const pageTitles = {}; // title → [{id, page}]

  try {
    const listUrl = `${baseUrl}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&_fields=id,title,content`;
    const body = await _esWarmFetch(listUrl);
    if (!body) return _json({ ok: false, error: 'blocked or failed', page });

    let posts;
    try { posts = JSON.parse(body); } catch { return _json({ ok: false, error: 'invalid JSON', page }); }
    if (!Array.isArray(posts)) return _json({ ok: false, error: 'not an array', page });

    // Build batch array and titles index
    const batch = [];
    for (const post of posts) {
      totalPosts++;
      const postId = post.id;
      const title = post.title?.rendered || '';
      const content = post.content?.rendered || '';
      if (!postId || !content) continue;

      batch.push({ id: postId, title: { rendered: title }, content: { rendered: content } });

      // Build page-level titles
      const cleanTitle = (title || '').replace(/&#\d+;/g, (m) => String.fromCharCode(parseInt(m.slice(2, -1), 10)))
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      if (cleanTitle) {
        const key = cleanTitle.toLowerCase();
        if (!pageTitles[key]) pageTitles[key] = [];
        pageTitles[key].push({ id: postId, page });
      }
    }

    // Store entire page as ONE KV entry (instead of 100 individual writes)
    try {
      await env.ES_CACHE.put(`es:page:${page}`, JSON.stringify(batch), { expirationTtl: _ES_KV_TTL });
    } catch (e) { errors.push(`Batch write: ${e.message}`); }

  } catch (e) {
    errors.push(`Fetch: ${e.message}`);
  }

  return _json({
    ok: true, page, totalPosts, totalCached: totalPosts,
    titles: pageTitles,
    hasMore: totalPosts >= perPage,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ─── Scheduled auto-refresh for Eurostreaming ──────────────────────────────────

const _WARM_PAGES_PER_RUN = 10;
const _WARM_COOLDOWN_MS = 24 * 3600 * 1000; // 24h between full refreshes
const _WARM_STATE_CACHE_KEY = 'https://internal.worker/es-warm-state'; // Cache API key (fake URL)

// KV for cooldown state (globally consistent across PoPs — Cache API is PoP-local and lost with smart placement)
// Progress (nextPage, titles) stays in Cache API — losing it just means restart from page 1, not a bandwidth problem
async function _getWarmState(env) {
  // Read cooldown from KV (globally consistent)
  let lastComplete = 0;
  if (env?.ES_CACHE) {
    try {
      const kv = await env.ES_CACHE.get('sfm:es:cooldown', 'json');
      lastComplete = kv?.lastComplete || 0;
    } catch {}
  }
  // Read progress from Cache API (PoP-local — loss means restart from page 1, acceptable)
  try {
    const cache = caches.default;
    const resp = await cache.match(_WARM_STATE_CACHE_KEY);
    if (resp) {
      const s = await resp.json();
      return { ...s, lastComplete }; // override lastComplete with KV value
    }
  } catch { /* cache miss */ }
  return { nextPage: 1, titles: {}, lastComplete };
}

async function _putWarmState(state, env) {
  // Persist cooldown in KV when completing a full cycle (globally consistent)
  if (state.lastComplete && env?.ES_CACHE) {
    try {
      await env.ES_CACHE.put('sfm:es:cooldown', JSON.stringify({ lastComplete: state.lastComplete }), { expirationTtl: 172800 });
    } catch {}
  }
  // Also persist progress in Cache API
  try {
    const cache = caches.default;
    const resp = new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=172800' }, // 48h
    });
    await cache.put(_WARM_STATE_CACHE_KEY, resp);
  } catch { /* ignore */ }
}

async function _handleScheduledWarm(env) {
  if (!env?.ES_CACHE) return;

  const state = await _getWarmState(env);

  // Don't refresh more often than every 24h
  if (state.lastComplete && Date.now() - state.lastComplete < _WARM_COOLDOWN_MS) return;

  // Read active domain from KV (auto-updated by _handleScheduledDomainUpdate)
  let baseUrl = 'https://eurostream.ing';
  try {
    const domainData = await env.ES_CACHE.get('domains:urls', 'json');
    if (domainData?.eurostreaming) baseUrl = domainData.eurostreaming.replace(/\/$/, '');
  } catch { /* fallback to default */ }
  let { nextPage, titles } = state;
  if (!titles || typeof titles !== 'object') titles = {};

  for (let i = 0; i < _WARM_PAGES_PER_RUN; i++) {
    let posts;
    try {
      const listUrl = `${baseUrl}/wp-json/wp/v2/posts?per_page=100&page=${nextPage}&_fields=id,title,content`;
      const body = await _esWarmFetch(listUrl);
      if (!body) { /* blocked — save progress and retry next cron */
        await _putWarmState({ nextPage, titles, lastComplete: 0 }, env);
        return;
      }
      posts = JSON.parse(body);
    } catch { break; }
    if (!Array.isArray(posts) || posts.length === 0) { posts = []; }

    // Store batch in KV (skip if already cached and fresh)
    if (posts.length > 0) {
      const batch = posts.map(p => ({
        id: p.id,
        title: { rendered: p.title?.rendered || '' },
        content: { rendered: p.content?.rendered || '' },
      }));
      try {
        const existing = await env.ES_CACHE.get(`es:page:${nextPage}`, 'json');
        if (!existing || !Array.isArray(existing) || existing.length !== batch.length) {
          await env.ES_CACHE.put(`es:page:${nextPage}`, JSON.stringify(batch), { expirationTtl: _ES_KV_TTL });
        }
      } catch { /* KV write failed — continue */ }

      // Accumulate titles
      for (const post of posts) {
        const raw = (post.title?.rendered || '')
          .replace(/&#\d+;/g, m => String.fromCharCode(parseInt(m.slice(2, -1), 10)))
          .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
        if (raw) {
          const key = raw.toLowerCase();
          if (!titles[key]) titles[key] = [];
          titles[key].push({ id: post.id, page: nextPage });
        }
      }
    }

    // Last page reached
    if (posts.length < 100) {
      try { await env.ES_CACHE.put('es:titles', JSON.stringify(titles), { expirationTtl: _ES_KV_TTL }); } catch {}
      await _putWarmState({ nextPage: 1, titles: {}, lastComplete: Date.now() }, env);
      return;
    }
    nextPage++;
  }

  // More pages remain — save progress (in Cache API, not KV)
  await _putWarmState({ nextPage, titles, lastComplete: 0 }, env);
}

// ─── GuardoSerie index warm: scrape /serie/ listing pages ────────────────────
const _GS_WARM_STATE_KEY = new Request('https://gs.internal/warm-state');
const _GS_PAGES_PER_RUN = 30;
const _GS_COOLDOWN_MS = 24 * 3600_000;

async function _handleScheduledGsWarm(env) {
  if (!env?.ES_CACHE) return;

  // Check cooldown from KV (globally consistent across PoPs)
  try {
    const kv = await env.ES_CACHE.get('sfm:gs:cooldown', 'json');
    if (kv?.lastComplete && Date.now() - kv.lastComplete < _GS_COOLDOWN_MS) return;
  } catch {}

  const cache = caches.default;
  let state = { nextPage: 1, titles: {}, lastComplete: 0 };
  try {
    const cached = await cache.match(_GS_WARM_STATE_KEY);
    if (cached) state = await cached.json();
  } catch { /* start fresh */ }

  // Read active domain from KV (auto-updated by _handleScheduledDomainUpdate)
  let BASE = 'https://guardoserie.website';
  try {
    const domainData = await env.ES_CACHE.get('domains:urls', 'json');
    if (domainData?.guardoserie) BASE = domainData.guardoserie.replace(/\/$/, '');
  } catch { /* fallback to default */ }
  let { nextPage, titles } = state;
  if (!titles || typeof titles !== 'object') titles = {};

  for (let i = 0; i < _GS_PAGES_PER_RUN; i++) {
    let html;
    try {
      const r = await fetch(`${BASE}/serie/page/${nextPage}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'it-IT,it;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) break;
      html = await r.text();
      if (html.includes('Just a moment')) break;
    } catch { break; }

    // Extract serie links
    const regex = /<a[^>]+href="(https?:\/\/[^"]*\/serie\/([^/"]+)\/?)"[^>]*title="([^"]+)"/g;
    let m, count = 0;
    while ((m = regex.exec(html)) !== null) {
      const slug = m[2];
      const rawTitle = m[3]
        .replace(/&#\d+;/g, c => String.fromCharCode(parseInt(c.slice(2, -1), 10)))
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      const key = rawTitle.toLowerCase();
      if (!titles[key]) titles[key] = [];
      if (!titles[key].some(e => e.slug === slug)) {
        titles[key].push({ slug });
        count++;
      }
      // Also index by slug
      const slugKey = slug.replace(/-/g, ' ');
      if (slugKey !== key) {
        if (!titles[slugKey]) titles[slugKey] = [];
        if (!titles[slugKey].some(e => e.slug === slug)) titles[slugKey].push({ slug });
      }
    }

    if (count === 0 && Object.keys(titles).length > 0) {
      // Likely past last page — store and finish
      try { await env.ES_CACHE.put('gs:titles', JSON.stringify(titles), { expirationTtl: 172800 }); } catch {}
      // Write cooldown to KV (globally consistent)
      try { await env.ES_CACHE.put('sfm:gs:cooldown', JSON.stringify({ lastComplete: Date.now() }), { expirationTtl: 172800 }); } catch {}
      const resp = new Response(JSON.stringify({ nextPage: 1, titles: {}, lastComplete: Date.now() }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=172800' },
      });
      await cache.put(_GS_WARM_STATE_KEY, resp);
      return;
    }
    nextPage++;
  }

  // Store titles so far
  if (Object.keys(titles).length > 0) {
    try { await env.ES_CACHE.put('gs:titles', JSON.stringify(titles), { expirationTtl: 172800 }); } catch {}
  }

  // Save progress
  try {
    const resp = new Response(JSON.stringify({ nextPage, titles, lastComplete: 0 }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=172800' },
    });
    await cache.put(_GS_WARM_STATE_KEY, resp);
  } catch { /* ignore */ }
}

/** Format proxy response for all modes (nofollow, wantCookie, passthrough). */
function _proxyResponse(bodyText, status, location, setCookie, contentType, nofollow, wantCookie, fromCache) {
  const cacheHdr = fromCache ? { 'X-KV-Cache': 'hit' } : {};
  if (nofollow) {
    const json = { status, location, setCookie };
    if (wantCookie) json.body = bodyText;
    if (fromCache) json.kvCache = true;
    return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...cacheHdr } });
  }
  if (wantCookie) {
    const json = { status, setCookie, location, body: bodyText };
    if (fromCache) json.kvCache = true;
    return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...cacheHdr } });
  }
  return new Response(bodyText, {
    status,
    headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'X-Worker-Upstream-Status': String(status), ...cacheHdr },
  });
}

function _json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type':                'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Safego captcha solver — runs GET → OCR → POST → redirect in one Worker
 * invocation so all outbound requests share the same IP.
 */

// ─── AI Vision OCR helper (majority-voting across multiple prompts) ──────────

/**
 * Run AI OCR on a captcha image using two approaches:
 * 1. Vision model (Llama 3.2 / LLaVA) with varied prompts
 * 2. ASCII art + text model (binarize image → text → Llama text model)
 * Majority-votes among all answers that match expected digit count.
 * @param {object} env  CF Worker environment (needs env.AI)
 * @param {Uint8Array} imageBytes  raw PNG bytes
 * @param {number} [expectedDigits=3]  expected digit count
 * @returns {Promise<string|null>}  recognised digits or null
 */
async function _aiOcrDigits(env, imageBytes, expectedDigits = 3) {
  if (!env?.AI) return null;

  const allAnswers = [];
  const imageArr = [...imageBytes];

  // ── Approach 1: Vision model with raw image (3 varied prompts) ──
  const visionPrompts = [
    `This CAPTCHA image contains exactly ${expectedDigits} digits drawn over noise lines. Read the digits from left to right. Reply with ONLY those ${expectedDigits} digits.`,
    `Look at this captcha. It shows a ${expectedDigits}-digit number with crosshatch lines as noise. What is the number? Answer with just the digits, nothing else.`,
    `What ${expectedDigits}-digit code is shown in this captcha? Ignore background lines. Reply digits only.`,
  ];

  const _runVision = async (prompt) => {
    try {
      const resp = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        messages: [{ role: 'user', content: prompt }],
        image: imageArr,
        max_tokens: 20,
      });
      return (resp?.response || '').replace(/\D/g, '');
    } catch {
      try {
        const resp = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
          image: imageArr, prompt, max_tokens: 20,
        });
        return (resp?.description || resp?.response || '').replace(/\D/g, '');
      } catch { /* format 2 failed */ }
    }
    try {
      const resp = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
        image: imageArr, prompt, max_tokens: 20,
      });
      return (resp?.description || resp?.response || '').replace(/\D/g, '');
    } catch { return ''; }
  };

  const visionResults = await Promise.allSettled(visionPrompts.map(_runVision));
  for (const r of visionResults) {
    if (r.status === 'fulfilled' && r.value) allAnswers.push(r.value);
  }

  // ── Approach 2: ASCII art + text model ──
  // Binarize the image and convert to ASCII art, then use a text model
  try {
    const { width, height, pixels } = await _decodePngGrayscale(new Uint8Array(imageArr));
    // Try multiple thresholds for the ASCII art
    for (const thresh of [70, 90]) {
      const lines = [];
      for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
          row += pixels[y * width + x] < thresh ? '#' : '.';
        }
        lines.push(row);
      }
      const ascii = lines.join('\n');
      try {
        const resp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: `You read digits from ASCII art captcha images. The image shows exactly ${expectedDigits} digits rendered in '#' characters on a '.' background. Respond with ONLY the ${expectedDigits} digits, nothing else.` },
            { role: 'user', content: ascii },
          ],
          max_tokens: 20,
        });
        const digits = (resp?.response || '').replace(/\D/g, '');
        if (digits) allAnswers.push(digits);
      } catch { /* text model failed */ }
    }
  } catch { /* PNG decode failed */ }

  // ── Majority vote ──
  if (!allAnswers.length) return null;

  // Prefer answers with exactly expectedDigits digits
  const exact = allAnswers.filter(a => a.length === expectedDigits);
  if (exact.length) {
    const freq = {};
    for (const a of exact) freq[a] = (freq[a] || 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  }
  // Fallback: any 2-5 digit answer
  const any = allAnswers.filter(a => a.length >= 2 && a.length <= 5);
  if (any.length) {
    const freq = {};
    for (const a of any) freq[a] = (freq[a] || 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  }
  return null;
}

// ─── Pixel OCR engine (no external API dependencies) ─────────────────────────

/** Decompress zlib-wrapped data using Web Streams API (CF Workers). */
async function _inflate(data) {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
}

/** Decode a PNG from Uint8Array into { width, height, pixels[] } (grayscale 0-255). */
async function _decodePngGrayscale(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 8; // skip PNG magic
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];
  while (offset < buf.length) {
    const chunkLen = view.getUint32(offset); offset += 4;
    const type = String.fromCharCode(buf[offset], buf[offset+1], buf[offset+2], buf[offset+3]); offset += 4;
    const data = buf.slice(offset, offset + chunkLen); offset += chunkLen + 4; // +4 for CRC
    if (type === 'IHDR') {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(0); height = dv.getUint32(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') break;
  }
  // Concat IDAT chunks
  let idatTotal = 0;
  for (const c of idatChunks) idatTotal += c.length;
  const idat = new Uint8Array(idatTotal);
  let io = 0;
  for (const c of idatChunks) { idat.set(c, io); io += c.length; }

  const raw = await _inflate(idat);
  const channels = [0, 0, 3, 0, 2, 0, 4][colorType] || 1;
  const bpp = Math.ceil((bitDepth * channels) / 8);
  const stride = 1 + width * bpp;
  const pixels = new Uint8Array(width * height);
  let prev = new Uint8Array(width * bpp);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * stride];
    const cur = new Uint8Array(width * bpp);
    for (let i = 0; i < width * bpp; i++) {
      const b = raw[y * stride + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const c = (i >= bpp && y > 0) ? prev[i - bpp] : 0;
      const p = prev[i];
      let v;
      if (ft === 0) v = b;
      else if (ft === 1) v = b + a;
      else if (ft === 2) v = b + p;
      else if (ft === 3) v = b + Math.floor((a + p) / 2);
      else { const pa = Math.abs(p - c), pb = Math.abs(a - c), pc = Math.abs(a + p - 2 * c); v = b + (pa <= pb && pa <= pc ? a : pb <= pc ? p : c); }
      cur[i] = v & 0xFF;
    }
    prev = cur;
    for (let x = 0; x < width; x++) {
      const r = cur[x * bpp], g = channels >= 3 ? cur[x * bpp + 1] : r, bv = channels >= 3 ? cur[x * bpp + 2] : r;
      pixels[y * width + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * bv);
    }
  }
  return { width, height, pixels };
}

// ─── Bitmap-based digit templates (calibrated from real safego captchas) ──────
const _BITMAP_TEMPLATES = {
  '0': '...##...|..####..|.##..##.|##....##|##....##|##....##|##....##|.##..##.|..####..|...##...',
  '1': '..##|.###|####|..##|..##|..##|..##|..##|..##|####',
  '2': '..####..|.##..##.|##....##|......##|.....##.|....##..|...##...|..##....|.##.....|########',
  '3': '.#####..|##...##.|......##|.....##.|...###..|.....##.|......##|......##|##...##.|.#####..',
  '4': '.....##|....###|...####|..##.##|.##..##|##...##|#######|.....##|.....##|.....##',
  '5': '#######.|##......|##......|##.###..|###..##.|......##|......##|##....##|.##..##.|..####..',
  '6': '..####..|.##..##.|##....#.|##......|##.###..|###..##.|##....##|##....##|.##..##.|..####..',
  '7': '########|......##|......##|.....##.|....##..|...##...|..##....|.##.....|##......|##......',
  '8': '..####..|.##..##.|##....##|.##..##.|..####..|.##..##.|##....##|##....##|.##..##.|..####..',
  '9': '..####..|.##..##.|##....##|##....##|.##..###|..###.##|......##|.#....##|.##..##.|..####..',
};

function _ocrDigitsFromPixels(width, height, pixels, threshold = 128) {
  // 1. Column darkness → segment digits
  const colDark = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = 0; y < height; y++) { if (pixels[y * width + x] < threshold) dark++; }
    colDark[x] = dark / height;
  }
  const inDigit = Array.from(colDark, v => v > 0.05);
  const segments = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    if (inDigit[x] && start < 0) start = x;
    else if (!inDigit[x] && start >= 0) { segments.push([start, x - 1]); start = -1; }
  }
  const merged = [];
  for (const seg of segments) {
    if (merged.length && seg[0] - merged[merged.length - 1][1] <= 1) {
      merged[merged.length - 1][1] = seg[1];
    } else merged.push([...seg]);
  }
  const digits = merged.filter(([s, e]) => e - s >= 2);
  if (!digits.length) return null;

  // 2. Extract each digit bitmap and match against templates
  let result = '';
  for (const [s, e] of digits) {
    // Find vertical bounds
    let top = -1, bot = -1;
    for (let y = 0; y < height; y++) {
      let d = 0; for (let x = s; x <= e; x++) if (pixels[y * width + x] < threshold) d++;
      if (d > 0) { if (top < 0) top = y; bot = y; }
    }
    if (top < 0) continue;
    // Build bitmap rows
    const rows = [];
    for (let y = top; y <= bot; y++) {
      let row = '';
      for (let x = s; x <= e; x++) row += pixels[y * width + x] < threshold ? '#' : '.';
      rows.push(row);
    }
    const key = rows.join('|');
    // Exact match first
    let matched = null;
    for (const [ch, tmpl] of Object.entries(_BITMAP_TEMPLATES)) {
      if (tmpl === key) { matched = ch; break; }
    }
    // Hamming distance fallback (same-width templates only)
    if (!matched) {
      let best = '?', bestDist = Infinity;
      for (const [ch, tmpl] of Object.entries(_BITMAP_TEMPLATES)) {
        const t = tmpl.replace(/\|/g, '');
        const k = key.replace(/\|/g, '');
        if (t.length !== k.length) continue;
        let dist = 0;
        for (let i = 0; i < t.length; i++) if (t[i] !== k[i]) dist++;
        if (dist < bestDist) { bestDist = dist; best = ch; }
      }
      matched = bestDist <= 12 ? best : '?';
    }
    result += matched;
  }
  return result || null;
}

// ─── Safego diagnostic (returns OCR analysis without POSTing) ────────────────
async function _handleSafegoDiag(safegoUrl) {
  const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0';
  try {
    const r1 = await fetch(safegoUrl, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    const html1 = await r1.text();
    const imgMatch = html1.match(/data:image\/png;base64,([^"]+)"/i);
    if (!imgMatch) return _json({ error: 'no captcha' });
    const b64 = imgMatch[1].replace(/\s/g, '');
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const { width, height, pixels } = await _decodePngGrayscale(raw);
    // Build ASCII art
    const ascii = [];
    for (let y = 0; y < height; y++) {
      let line = '';
      for (let x = 0; x < width; x++) line += pixels[y * width + x] < 128 ? '#' : '.';
      ascii.push(line);
    }
    const answer = _ocrDigitsFromPixels(width, height, pixels);
    return _json({ width, height, answer, b64len: b64.length, ascii });
  } catch (err) {
    return _json({ error: err.message });
  }
}

// ─── Safego captcha solver ───────────────────────────────────────────────────

async function _handleSafego(safegoUrl, reqUrl, env) {
  const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0';
  const hdrs = (extra = {}) => ({
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://safego.cc/',
    ...extra,
  });

  try {
    const MAX_ATTEMPTS = 3;
    const attempts = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // 1. GET safego page → PHPSESSID + captcha image
      const r1 = await fetch(safegoUrl, { headers: hdrs(), redirect: 'manual' });
      const sessid = ((r1.headers.get('Set-Cookie') || '').match(/PHPSESSID=([^;,\s]+)/) || [])[1];
      if (!sessid) { attempts.push({ attempt, error: 'no PHPSESSID' }); continue; }
      const html1 = await r1.text();
      const cField = (html1.match(/name="(captch[45])"/) || [])[1] || 'captch5';
      const imgMatch = html1.match(/data:image\/png;base64,([^"]+)"/i);
      if (!imgMatch) { attempts.push({ attempt, error: 'no captcha image' }); continue; }
      const b64 = imgMatch[1].replace(/\s/g, '');

      // 2. Decode PNG
      let width, height, pixels;
      try {
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        ({ width, height, pixels } = await _decodePngGrayscale(raw));
      } catch (ocrErr) {
        attempts.push({ attempt, error: `decode: ${ocrErr.message}` });
        continue;
      }

      // 3. OCR — bitmap template matching (primary), AI fallback
      let answer = null;
      let ocrMethod = '';

      // 3a. Pixel OCR with bitmap templates (very accurate for this captcha font)
      const pxAnswer = _ocrDigitsFromPixels(width, height, pixels);
      if (pxAnswer && !pxAnswer.includes('?') && pxAnswer.length >= 2 && pxAnswer.length <= 5) {
        answer = pxAnswer; ocrMethod = 'pixel';
      }

      // 3b. AI vision fallback (only if pixel OCR failed)
      if (!answer) {
        try {
          const imageBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const aiText = await _aiOcrDigits(env, imageBytes, 3);
          if (aiText) { answer = aiText; ocrMethod = 'ai'; }
        } catch { /* AI failed */ }
      }

      if (!answer) {
        attempts.push({ attempt, error: 'ocr failed' });
        continue;
      }

      // 4. POST the answer
      const rPost = await fetch(safegoUrl, {
        method: 'POST',
        headers: hdrs({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': `PHPSESSID=${sessid}`,
          'Origin': 'https://safego.cc',
          'Referer': safegoUrl,
        }),
        body: `${cField}=${answer}`,
        redirect: 'manual',
      });

      // Safego returns 200 + <a href="URL"> on success (NOT a 302 redirect)
      const postBody = await rPost.text();
      const linkMatch = /<a\b[^>]+href="(https?:\/\/[^"]+)"/.exec(postBody);
      let resultUrl = linkMatch ? linkMatch[1] : null;

      // Fallback: 302 redirect (some versions may use this)
      if (!resultUrl) {
        const postLoc = rPost.headers.get('Location');
        if (postLoc) resultUrl = new URL(postLoc, safegoUrl).href;
      }

      if (resultUrl) {
        // followAll: follow redirect chain to final destination (deltabit/turbovid/mixdrop)
        // This solves the problem of clicka.cc/adelta being blocked from some edges
        const followAll = reqUrl.searchParams.get('followAll') === '1';
        let finalUrl = resultUrl;
        if (followAll) {
          for (let hop = 0; hop < 8; hop++) {
            if (/deltabit|turbovid|mixdrop|m1xdrop|maxstream/i.test(finalUrl)) break;
            try {
              const redir = await fetch(finalUrl, {
                headers: { 'User-Agent': UA, 'Accept': '*/*' },
                redirect: 'manual',
              });
              const loc = redir.headers.get('Location') || redir.headers.get('location');
              if (!loc) break;
              finalUrl = new URL(loc, finalUrl).href;
            } catch { break; }
          }
          // Cache the delta→final mapping in KV for future use
          if (env?.ES_CACHE && /deltabit|turbovid|mixdrop|m1xdrop/i.test(finalUrl)) {
            // Extract original delta slug from the safego URL's referrer chain
            const deltaUrl = reqUrl.searchParams.get('deltaUrl');
            if (deltaUrl) {
              try {
                await env.ES_CACHE.put(`resolve:${deltaUrl}`, JSON.stringify({ url: finalUrl, t: Date.now() }), { expirationTtl: 86400 });
              } catch { /* ignore */ }
            }
          }
        }
        return _json({ url: followAll ? finalUrl : resultUrl, attempt, answer, ocrMethod, ...(followAll && finalUrl !== resultUrl ? { intermediateUrl: resultUrl } : {}) });
      }

      const errSnippet = postBody.substring(0, 200);
      attempts.push({ attempt, answer, ocrMethod, postStatus: rPost.status, errSnippet });
    }

    return _json({ error: `Captcha unsolved after ${MAX_ATTEMPTS} attempts`, attempts }, 502);
  } catch (err) {
    return _json({ error: `Safego solver error: ${err.message}` }, 502);
  }
}

// ─── ES Resolve: clicka.cc/delta → safego → captcha → deltabit in one shot ──

async function _handleEsResolve(deltaUrl, reqUrl, env) {
  const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0';

  // 1. Check KV cache for resolved URL
  if (env?.ES_CACHE) {
    try {
      const cached = await env.ES_CACHE.get(`resolve:${deltaUrl}`, 'json');
      if (cached && cached.url && Date.now() - cached.t < 86400000) {
        return _json({ url: cached.url, cached: true });
      }
    } catch { /* ignore */ }
  }

  try {
    let current = deltaUrl;

    // 2. Follow redirects until we hit safego or a final host
    for (let hop = 0; hop < 8; hop++) {
      if (/deltabit|turbovid|mixdrop|m1xdrop|maxstream/i.test(current)) {
        // Cache the successful resolution
        if (env?.ES_CACHE) {
          try { await env.ES_CACHE.put(`resolve:${deltaUrl}`, JSON.stringify({ url: current, t: Date.now() }), { expirationTtl: 86400 }); } catch {}
        }
        return _json({ url: current, cached: false });
      }

      if (current.includes('safego')) {
        // Solve captcha with followAll to get the final URL
        const fakeReqUrl = new URL('https://dummy/?followAll=1&deltaUrl=' + encodeURIComponent(deltaUrl));
        const safegoResp = await _handleSafego(current, fakeReqUrl, env);
        const safegoResult = await safegoResp.json();
        if (safegoResult.url) {
          return _json({ url: safegoResult.url, cached: false, captchaSolved: true, attempt: safegoResult.attempt });
        }
        return _json({ error: 'Captcha solve failed', details: safegoResult }, 502);
      }

      // Follow redirect
      const resp = await fetch(current, {
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
        redirect: 'manual',
      });
      const loc = resp.headers.get('Location') || resp.headers.get('location');
      if (!loc) {
        // Check KV for redirect location
        if (env?.ES_CACHE) {
          try {
            const cachedRedir = await env.ES_CACHE.get(`p:${current}`, 'json');
            if (cachedRedir && cachedRedir.l) {
              current = new URL(cachedRedir.l, current).href;
              continue;
            }
          } catch {}
        }
        return _json({ error: 'No redirect location', url: current, status: resp.status }, 502);
      }
      current = new URL(loc, current).href;
    }

    return _json({ error: 'Max hops reached', url: current }, 502);
  } catch (err) {
    return _json({ error: `ES resolve error: ${err.message}` }, 502);
  }
}

// ─── ES Stream: full video extraction from clicka.cc/delta → MP4 URL ────────

// p.a.c.k.e.r unpacker (ported from extractors/common.js)
const _PACKER_RE = [
  /}\('(.*)',\s*(\d+|\[\]),\s*(\d+),\s*'(.*)'\.split\('\|'\),\s*(\d+),\s*(.*)\)\)/s,
  /}\('(.*)',\s*(\d+|\[\]),\s*(\d+),\s*'(.*)'\.split\('\|'\)/s,
];
function _unPack(p, a, c, k) {
  const e = (c2) => (c2 < a ? '' : e(Math.floor(c2 / a))) + ((c2 = c2 % a) > 35 ? String.fromCharCode(c2 + 29) : c2.toString(36));
  const d = {};
  while (c--) { d[e(c)] = k[c] || e(c); }
  return p.replace(/\b\w+\b/g, (m) => d[m] || m);
}
function _replaceLookupStrings(src) {
  const m = /var\s*(_\w+)\s*=\s*\["(.*?)"\];/s.exec(src);
  if (!m) return src;
  const vals = m[2].split('","');
  let out = src;
  for (let i = 0; i < vals.length; i++) out = out.replaceAll(`${m[1]}[${i}]`, `"${vals[i]}"`);
  return out.slice(m.index + m[0].length);
}
function _unpackPacker(html) {
  if (!html.includes('eval(function(p,a,c,k,e,d)')) return null;
  for (const re of _PACKER_RE) {
    const m = re.exec(html);
    if (!m) continue;
    const payload = String(m[1]).replace(/\\\\/g, '\\').replace(/\\'/g, "'");
    const radix = m[2] === '[]' ? 62 : parseInt(m[2], 10);
    const count = parseInt(m[3], 10);
    const symtab = String(m[4]).split('|');
    if (!Number.isInteger(radix) || !Number.isInteger(count) || symtab.length < count) continue;
    try { return _replaceLookupStrings(_unPack(payload, radix, count, symtab)); } catch { continue; }
  }
  return null;
}

async function _handleEsStream(deltaUrl, reqUrl, env) {
  const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0';

  // Check KV for cached video URL (short TTL — tokens may expire)
  if (env?.ES_CACHE) {
    try {
      const cached = await env.ES_CACHE.get(`video:${deltaUrl}`, 'json');
      if (cached && cached.url && Date.now() - cached.t < 1800000) { // 30 min
        return new Response(null, { status: 302, headers: { 'Location': cached.url, 'Access-Control-Allow-Origin': '*' } });
      }
    } catch {}
  }

  try {
    // Phase 1: Resolve delta → deltabit URL
    let deltabitUrl = null;

    // Check KV for cached resolution
    if (env?.ES_CACHE) {
      try {
        const cached = await env.ES_CACHE.get(`resolve:${deltaUrl}`, 'json');
        if (cached && cached.url) deltabitUrl = cached.url;
      } catch {}
    }

    if (!deltabitUrl) {
      // Resolve live: clicka → safego → captcha → deltabit
      const resolveResp = await _handleEsResolve(deltaUrl, reqUrl, env);
      const resolved = await resolveResp.json();
      if (!resolved.url || resolved.error) {
        return _json({ error: 'Failed to resolve delta URL', details: resolved }, 502);
      }
      deltabitUrl = resolved.url;
    }

    // Phase 2: Follow redirects to final deltabit page
    let pageUrl = deltabitUrl;
    for (let i = 0; i < 5; i++) {
      const rr = await fetch(pageUrl, {
        headers: { 'User-Agent': UA, 'Referer': 'https://safego.cc/' },
        redirect: 'manual',
      });
      const loc = rr.headers.get('Location');
      if (!loc) break;
      pageUrl = new URL(loc, pageUrl).href;
    }

    // Phase 3: GET deltabit page
    const pageResp = await fetch(pageUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://safego.cc/',
        'Accept': 'text/html,*/*',
      },
    });
    if (!pageResp.ok) return _json({ error: 'Deltabit page fetch failed', status: pageResp.status }, 502);
    const pageHtml = await pageResp.text();

    // Phase 4: Parse form
    const formData = {};
    for (const m of pageHtml.matchAll(/<input\b([^>]*)>/gi)) {
      const nameM = /\bname="([^"]+)"/.exec(m[1]);
      const valM = /\bvalue="([^"]*)"/.exec(m[1]);
      if (nameM) formData[nameM[1]] = valM ? valM[1] : '';
    }
    formData['imhuman'] = '';
    formData['referer'] = pageUrl;

    // Phase 5: Wait (deltabit enforces a JS timer)
    await new Promise(r => setTimeout(r, 4500));

    // Phase 6: POST the form
    const postResp = await fetch(pageUrl, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Referer': pageUrl,
        'Origin': new URL(pageUrl).origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(formData).toString(),
    });
    if (!postResp.ok) return _json({ error: 'Deltabit POST failed', status: postResp.status }, 502);
    const postHtml = await postResp.text();

    // Phase 7: Unpack p.a.c.k.e.r → extract video URL
    const unpacked = _unpackPacker(postHtml) || postHtml;
    const urlMatch = /sources\s*:\s*\[\s*["']([^"']+)["']\s*\]/.exec(unpacked)
      || /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/.exec(unpacked)
      || /file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/.exec(unpacked);

    if (urlMatch && urlMatch[1] && urlMatch[1].startsWith('http')) {
      const videoUrl = urlMatch[1];
      // Cache video URL (short TTL)
      if (env?.ES_CACHE) {
        try { await env.ES_CACHE.put(`video:${deltaUrl}`, JSON.stringify({ url: videoUrl, t: Date.now() }), { expirationTtl: 1800 }); } catch {}
      }
      return new Response(null, { status: 302, headers: { 'Location': videoUrl, 'Access-Control-Allow-Origin': '*' } });
    }

    return _json({ error: 'Video URL not found in response', htmlPreview: postHtml.substring(0, 500) }, 502);
  } catch (err) {
    return _json({ error: `ES stream error: ${err.message}` }, 502);
  }
}

// ─── Domain Auto-Update System ──────────────────────────────────────────────

const _DOMAIN_COOLDOWN_MS = 24 * 3600 * 1000; // 24h between full checks
const _DOMAIN_STATE_CACHE_KEY = 'https://internal.worker/domain-state';
const _DOMAIN_KV_KEY = 'domains:urls';
const _DOMAIN_KV_TTL = 172800; // 48h expiry in KV (safety net)

// ── GitHub auto-sync (push domain changes to repo on detection) ─────────────
const _GITHUB_REPO = 'vitouchiha/nello-stream';
const _GITHUB_BRANCH = 'master';
const _GITHUB_PROVIDER_URLS_PATH = 'data/provider_urls.json';

const _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Community sources ────────────────────────────────────────────────────────
const _COMMUNITY_SOURCES = [
  {
    name: 'easystreams',
    url: 'https://raw.githubusercontent.com/realbestia1/easystreams/refs/heads/main/provider_urls.json',
    parse(data) { return data; }, // already { key: url }
  },
  {
    name: 'mammamia',
    url: 'https://raw.githubusercontent.com/UrloMythus/MammaMia/main/config.json',
    parse(data) {
      const siti = data?.Siti || {};
      const KEY_MAP = {
        StreamingCommunity: 'streamingcommunity',
        AnimeSaturn: 'animesaturn',
        AnimeWorld: 'animeworld',
        AnimeUnity: 'animeunity',
        CB01: 'cb01',
        Guardaserie: 'guardaserie',
        GuardoSerie: 'guardoserie',
        Guardoserie: 'guardoserie',
        GuardaHD: 'guardahd',
        Eurostreaming: 'eurostreaming',
        ToonItalia: 'toonitalia',
        Toonitalia: 'toonitalia',
        Guardaflix: 'guardaflix',
      };
      const out = {};
      for (const [name, info] of Object.entries(siti)) {
        const key = KEY_MAP[name];
        if (key && info?.url) out[key] = info.url;
      }
      return out;
    },
  },
];

// ── Known alternate domains per provider (fallback probing) ──────────────────
const _KNOWN_DOMAINS = {
  streamingcommunity: ['streamingcommunity.computer', 'vixsrc.to', 'streamingcommunity.bond'],
  cb01:              ['cb01uno.digital', 'cb01uno.life', 'cb01.uno', 'cb01uno.uno', 'cb01uno.click', 'cb01.stream'],
  guardaserie:       ['guardaserietv.bar', 'guardaserietv.skin', 'guardaserietv.autos', 'guardaserietv.asia', 'guardaserie.cfd'],
  guardoserie:       ['guardoserie.best', 'guardoserie.digital', 'guardoserie.surf', 'guardoserie.bar', 'guardoserie.blog'],
  eurostreaming:     ['eurostream.ing', 'eurostreamings.life', 'eurostreamings.buzz', 'www.eurostreaming.net'],
  toonitalia:        ['toonitalia.xyz', 'toonitalia.co'],
  animeunity:        ['www.animeunity.so', 'www.animeunity.to', 'www.animeunity.click', 'animeunity.site', 'animeunity.top', 'animeunity.ch', 'animeunity.click', 'www.animeunity.club', 'www.animeunity.sbs'],
  animeworld:        ['www.animeworld.ac', 'www.animeworld.so', 'www.animeworld.tv'],
  animesaturn:       ['www.animesaturn.cx', 'www.animesaturn.dev', 'www.animesaturn.click', 'animesaturn.site', 'www.animesaturn.lol', 'www.animesaturn.me', 'www.animesaturn.app', 'www.animesaturn.sbs'],
  guardahd:          ['mostraguarda.stream', 'guardahd.stream'],
  guardaflix:        ['guardaplay.space', 'guardaplay.blog', 'guardaplay.beer', 'guardaplay.com'],
  loonex:            ['loonex.eu'],
};

// ── HTML markers to fingerprint each provider (avoids parking pages) ─────────
const _SITE_MARKERS = {
  streamingcommunity: ['sliders-title', '/titles/', 'StreamingCommunity'],
  cb01:              ['cb01', 'film-', 'genere'],
  guardaserie:       ['guardaserie', '/serie/', 'stagion'],
  guardoserie:       ['guardoserie', '/serie/', 'stagion'],
  eurostreaming:     ['eurostream', 'wp-content', 'serie-tv'],
  toonitalia:        ['toonitalia', 'cartoon', 'anime'],
  animeunity:        ['animeunity', 'anime', 'episodi'],
  animeworld:        ['animeworld', 'anime', 'episodi'],
  animesaturn:       ['animesaturn', 'anime', 'episod'],
  guardahd:          ['guardahd', 'mostraguarda', 'film'],
  guardaflix:        ['guardaflix', 'guardaplay', 'film'],
  loonex:            ['loonex', 'stream'],
};

/** Validate a domain: HEAD→follow redirects, check HTML markers */
async function _domainProbe(url, provider) {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': _UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7',
      },
      signal: AbortSignal.timeout(10000),
    });
    // Status 200 or 403 (CF challenge but domain alive)
    if (!resp.ok && resp.status !== 403) return null;

    const finalUrl = new URL(resp.url);
    const origin = `${finalUrl.protocol}//${finalUrl.host}`;

    const html = await resp.text();
    const lower = html.toLowerCase();

    // Reject permanent CF blocks (WAF deny, suspended, captcha wall)
    // "Attention Required" = WAF block, "Access denied" = IP/geo block
    // These are NOT bypassable — domain is effectively dead
    if (lower.includes('attention required') || lower.includes('access denied') ||
        lower.includes('this website is using a security service') ||
        lower.includes('suspended') || lower.includes('parked')) {
      return null;
    }

    // On 403: only accept "Just a moment" (JS challenge = domain alive, bypassable)
    if (resp.status === 403) {
      if (!lower.includes('just a moment')) return null;
      return origin; // CF challenge page — domain is alive
    }

    // On 200: verify HTML markers to catch parking/expired pages
    const markers = _SITE_MARKERS[provider] || [];
    if (markers.length > 0 && !markers.some(m => lower.includes(m.toLowerCase()))) {
      return null;
    }
    return origin;
  } catch { /* DNS fail, timeout, etc. */ }
  return null;
}

/** Fetch all community sources, merge into { provider: [url1, url2, ...] } */
async function _fetchAllCommunitySources() {
  const merged = {};
  const fetches = _COMMUNITY_SOURCES.map(async (src) => {
    try {
      const resp = await fetch(src.url, {
        headers: { 'Accept': 'application/json', 'User-Agent': _UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const parsed = src.parse(data);
      if (!parsed || typeof parsed !== 'object') return;
      for (const [k, v] of Object.entries(parsed)) {
        const key = k.toLowerCase().trim();
        const val = String(v || '').trim().replace(/\/+$/, '');
        if (!key || !val || key === 'mapping_api') continue;
        if (!merged[key]) merged[key] = [];
        if (!merged[key].includes(val)) merged[key].push(val);
      }
    } catch { /* source failed — continue */ }
  });
  await Promise.all(fetches);
  return merged;
}

/** Main resolver: community sources + redirect following + domain probing */
async function _resolveDomains(env) {
  const community = await _fetchAllCommunitySources();
  const resolved = {};
  const details = {};

  // Merge all providers we know about
  const providers = new Set([
    ...Object.keys(community),
    ...Object.keys(_KNOWN_DOMAINS),
  ]);

  // Load previous results from KV as baseline
  let previous = {};
  if (env?.ES_CACHE) {
    try { previous = (await env.ES_CACHE.get(_DOMAIN_KV_KEY, 'json')) || {}; } catch {}
  }

  for (const provider of providers) {
    // Build candidate list: community URLs first, then known alternates
    const candidates = [];
    if (community[provider]) candidates.push(...community[provider]);
    if (_KNOWN_DOMAINS[provider]) {
      for (const d of _KNOWN_DOMAINS[provider]) {
        const u = d.startsWith('http') ? d : `https://${d}`;
        if (!candidates.includes(u)) candidates.push(u);
      }
    }
    // Also add the previously resolved domain if not already in the list
    if (previous[provider] && !candidates.includes(previous[provider])) {
      candidates.push(previous[provider]);
    }

    // If all community sources agree, trust them without probing
    const uniqueUrls = [...new Set(candidates)];
    if (uniqueUrls.length === 1) {
      resolved[provider] = uniqueUrls[0];
      details[provider] = { url: uniqueUrls[0], method: 'consensus' };
      continue;
    }

    // Multiple candidates — validate the community favorite first, then others
    let found = false;
    for (const candidate of candidates) {
      const validUrl = await _domainProbe(candidate, provider);
      if (validUrl) {
        resolved[provider] = validUrl;
        details[provider] = { url: validUrl, method: 'validated', from: candidate };
        found = true;
        break;
      }
    }

    // Fallback: use community first choice even without validation
    if (!found && candidates.length > 0) {
      resolved[provider] = candidates[0];
      details[provider] = { url: candidates[0], method: 'fallback' };
    }
  }

  // Store in KV
  const result = { ...resolved, _updated: new Date().toISOString(), _details: details };
  if (env?.ES_CACHE) {
    try {
      await env.ES_CACHE.put(_DOMAIN_KV_KEY, JSON.stringify(result), { expirationTtl: _DOMAIN_KV_TTL });
    } catch { /* KV write failed */ }
  }

  return result;
}

// ── Scheduled domain update (24h cooldown) ───────────────────────────────────
async function _getDomainState(env) {
  // Read cooldown from KV (globally consistent across PoPs)
  if (env?.ES_CACHE) {
    try {
      const kv = await env.ES_CACHE.get('sfm:domain:cooldown', 'json');
      if (kv) return kv;
    } catch {}
  }
  return { lastComplete: 0 };
}

async function _putDomainState(state, env) {
  if (env?.ES_CACHE) {
    try {
      await env.ES_CACHE.put('sfm:domain:cooldown', JSON.stringify(state), { expirationTtl: 172800 });
    } catch {}
  }
  try {
    const cache = caches.default;
    const resp = new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=172800' },
    });
    await cache.put(_DOMAIN_STATE_CACHE_KEY, resp);
  } catch {}
}

/** Push updated provider_urls.json to GitHub when domains change */
async function _pushProviderUrlsToGitHub(env, newDomains, changes) {
  const token = env.GITHUB_TOKEN;
  if (!token) return;

  const apiBase = `https://api.github.com/repos/${_GITHUB_REPO}/contents`;
  const ghHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'SFM-Worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // 1. Get current file from GitHub (SHA needed for update + merge existing keys)
    const getResp = await fetch(
      `${apiBase}/${_GITHUB_PROVIDER_URLS_PATH}?ref=${_GITHUB_BRANCH}`,
      { headers: ghHeaders, signal: AbortSignal.timeout(15000) }
    );

    let sha = null;
    let existing = {};
    if (getResp.ok) {
      const data = await getResp.json();
      sha = data.sha;
      try { existing = JSON.parse(atob(data.content.replace(/\s/g, ''))); } catch {}
    }

    // 2. Merge: keep non-domain keys (mapping_api etc), overwrite domain URLs
    const merged = { ...existing };
    for (const [k, v] of Object.entries(newDomains)) {
      merged[k] = v;
    }

    // 3. Build commit message with change summary
    const changeDesc = Object.entries(changes)
      .map(([p, c]) => `${p}: ${c.from} → ${c.to}`)
      .join(', ');

    const body = {
      message: `fix(auto-domain): ${changeDesc}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(merged, null, 2) + '\n'))),
      branch: _GITHUB_BRANCH,
    };
    if (sha) body.sha = sha;

    // 4. Push update
    const putResp = await fetch(
      `${apiBase}/${_GITHUB_PROVIDER_URLS_PATH}`,
      {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!putResp.ok) {
      const err = await putResp.text();
      console.log(`GitHub push failed (${putResp.status}): ${err}`);
    } else {
      console.log(`GitHub push OK — domains updated: ${changeDesc}`);
    }
  } catch (e) {
    console.log(`GitHub push error: ${e.message}`);
  }
}

async function _handleScheduledDomainUpdate(env) {
  if (!env?.ES_CACHE) return;

  const state = await _getDomainState(env);
  if (state.lastComplete && Date.now() - state.lastComplete < _DOMAIN_COOLDOWN_MS) return;

  // Snapshot current domains before resolve (for change detection)
  let prevDomains = {};
  try {
    const prev = await env.ES_CACHE.get(_DOMAIN_KV_KEY, 'json');
    if (prev) {
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith('_')) prevDomains[k] = v;
      }
    }
  } catch {}

  try {
    const result = await _resolveDomains(env);
    await _putDomainState({ lastComplete: Date.now() }, env);

    // Detect domain changes → push to GitHub
    if (env.GITHUB_TOKEN) {
      const newDomains = {};
      const changes = {};
      for (const [k, v] of Object.entries(result)) {
        if (k.startsWith('_')) continue;
        newDomains[k] = v;
        if (prevDomains[k] !== v) {
          changes[k] = { from: prevDomains[k] || '(new)', to: v };
        }
      }
      if (Object.keys(changes).length > 0) {
        await _pushProviderUrlsToGitHub(env, newDomains, changes);
      }
    }
  } catch { /* resolve failed — try next cron run */ }
}

// ─── Uprot Captcha Auto-Solver ──────────────────────────────────────────────

const _UPROT_INIT_URL = 'https://uprot.net/msf/r4hcq47tarq8';
const _UPROT_COOKIES_KEY = 'uprot:cookies';
const _UPROT_COOKIES_TTL = 82800; // 23h
const _UPROT_COOLDOWN_MS = 20 * 3600 * 1000; // 20h between auto-solves
const _UPROT_STATE_CACHE_KEY = 'https://internal.worker/uprot-state';
const _UPROT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

function _uprotHeaders(referer) {
  return {
    'User-Agent': _UPROT_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://uprot.net',
    'Referer': referer || 'https://uprot.net/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
  };
}

/**
 * Solve the uprot captcha fresh: GET page → OCR → POST answer → store cookies in KV.
 * Returns { cookies, captchaData, answer, method } or null.
 */
async function _uprotSolveFresh(env) {
  const MAX_ATTEMPTS = 3;
  const attempts = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // 1. GET the uprot page to get PHPSESSID + captcha image
      const getHeaders = { ..._uprotHeaders(_UPROT_INIT_URL) };
      delete getHeaders['Content-Type'];
      const r1 = await fetch(_UPROT_INIT_URL, {
        method: 'GET',
        headers: getHeaders,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });

      // Extract PHPSESSID from Set-Cookie
      const setCookie1 = r1.headers.getAll ? r1.headers.getAll('Set-Cookie').join('; ') : (r1.headers.get('Set-Cookie') || '');
      const sessMatch = setCookie1.match(/PHPSESSID=([^;,\s]+)/);
      if (!sessMatch) { attempts.push({ attempt, error: 'no PHPSESSID', status: r1.status, setCookie: setCookie1.substring(0, 200) }); continue; }
      const sessid = sessMatch[1];

      const html1 = await r1.text();

      // Extract base64 captcha image
      const imgMatch = html1.match(/(?:src|data-src)=["'](data:image\/png;base64,([^"']+))["']/i)
        || html1.match(/data:image\/png;base64,([^"']+)/i);
      if (!imgMatch) { attempts.push({ attempt, error: 'no captcha image', htmlSnippet: html1.substring(0, 500) }); continue; }
      const b64 = (imgMatch[2] || imgMatch[1]).replace(/\s/g, '');

      // 2. Decode PNG → grayscale pixels
      let width, height, pixels;
      try {
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        ({ width, height, pixels } = await _decodePngGrayscale(raw));
      } catch (ocrErr) {
        attempts.push({ attempt, error: `decode: ${ocrErr.message}` });
        continue;
      }

      // 3. OCR — reuse the same bitmap template engine from safego
      let answer = null;
      let ocrMethod = '';

      // 3a. Pixel OCR (primary)
      const pxAnswer = _ocrDigitsFromPixels(width, height, pixels);
      if (pxAnswer && !pxAnswer.includes('?') && pxAnswer.length >= 2 && pxAnswer.length <= 5) {
        answer = pxAnswer;
        ocrMethod = 'pixel';
      }

      // 3b. AI vision fallback
      if (!answer) {
        try {
          const imageBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const aiText = await _aiOcrDigits(env, imageBytes, 3);
          if (aiText) { answer = aiText; ocrMethod = 'ai'; }
        } catch { /* AI failed */ }
      }

      if (!answer) {
        attempts.push({ attempt, error: 'ocr failed', pxAnswer });
        continue;
      }

      // 4. POST the captcha answer
      const cookies1 = `PHPSESSID=${sessid}`;
      const r2 = await fetch(_UPROT_INIT_URL, {
        method: 'POST',
        headers: {
          ..._uprotHeaders(_UPROT_INIT_URL),
          'Cookie': cookies1,
        },
        body: `captcha=${answer}`,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });

      // Extract updated cookies
      const setCookie2 = r2.headers.get('Set-Cookie') || '';
      const sessMatch2 = setCookie2.match(/PHPSESSID=([^;,\s]+)/);
      const captchaMatch = setCookie2.match(/captcha=([^;,\s]+)/);

      const cookieObj = { PHPSESSID: sessMatch2 ? sessMatch2[1] : sessid };
      if (captchaMatch) cookieObj.captcha = captchaMatch[1];

      const captchaData = { captcha: answer };
      const r2Body = await r2.text();

      // Check if solve was successful by looking for a CONTINUE link
      // or if we got back the captcha form (failure)
      const hasContinue = /C\s*O\s*N\s*T\s*I\s*N\s*U\s*E/i.test(r2Body);
      const hasCaptchaForm = /data:image\/png;base64/i.test(r2Body);

      if (hasCaptchaForm && !hasContinue) {
        attempts.push({ attempt, answer, ocrMethod, error: 'wrong answer (captcha form returned)' });
        continue;
      }

      // Store in KV
      const kvData = { cookies: cookieObj, data: captchaData, answer, method: ocrMethod, t: Date.now() };
      if (env?.ES_CACHE) {
        try {
          await env.ES_CACHE.put(_UPROT_COOKIES_KEY, JSON.stringify(kvData), { expirationTtl: _UPROT_COOKIES_TTL });
        } catch { /* KV write failed */ }
      }

      return { ...kvData, attempts };
    } catch (err) {
      attempts.push({ attempt, error: err.message });
    }
  }

  return { failed: true, attempts };
}

/**
 * Bypass an uprot link using cached cookies.
 * POST to the uprot URL with saved cookies+captcha → extract CONTINUE → follow to maxstream.
 */
async function _uprotBypassWithCookies(uprotUrl, cookies, captchaData, env) {
  try {
    // Build cookie string
    const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

    const resp = await fetch(uprotUrl, {
      method: 'POST',
      headers: {
        ..._uprotHeaders(uprotUrl),
        'Cookie': cookieStr,
      },
      body: new URLSearchParams(captchaData).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });

    const rawBody = await resp.text();

    // Strip honeypots: display:none blocks and HTML comments
    const body = rawBody
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<div[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

    // Find the REAL redirect link (buttok button or CONTINUE text)
    let maxstreamUrl = null;

    // Primary: <a href="..."><button id="buttok">C O N T I N U E</button></a>
    const buttokMatch = body.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*<button[^>]*id=["']buttok["'][^>]*>\s*C\s*O\s*N\s*T\s*I\s*N\s*U\s*E/i);
    if (buttokMatch) maxstreamUrl = buttokMatch[1];

    // Fallback: <a href="..."><button>C o n t i n u e</button></a>
    if (!maxstreamUrl) {
      const contMatch = body.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*<button[^>]*>\s*C\s+[oO]\s+[nN]\s+[tT]\s+[iI]\s+[nN]\s+[uU]\s+[eE]\s*<\/button>/i);
      if (contMatch) maxstreamUrl = contMatch[1];
    }

    // Last resort: unique uprots/uprotem URL
    if (!maxstreamUrl) {
      const allUprots = [...body.matchAll(/href=["'](https?:\/\/[^"']*uprot(?:s|em)\/[^"']+)["']/gi)].map(m => m[1]);
      const counts = {};
      for (const u of allUprots) counts[u] = (counts[u] || 0) + 1;
      maxstreamUrl = allUprots.find(u => counts[u] === 1) || null;
    }

    if (!maxstreamUrl) return null;

    // Follow redirects from uprots/uprotem domain to maxstream
    if (maxstreamUrl.includes('uprots') || maxstreamUrl.includes('uprotem')) {
      for (let hop = 0; hop < 10; hop++) {
        const redir = await fetch(maxstreamUrl, {
          headers: { 'User-Agent': _UPROT_UA },
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
        });
        const loc = redir.headers.get('Location') || redir.headers.get('location');
        if (!loc) {
          // Try following with redirect: 'follow'
          const followResp = await fetch(maxstreamUrl, {
            headers: { 'User-Agent': _UPROT_UA },
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
          });
          maxstreamUrl = followResp.url;
          break;
        }
        maxstreamUrl = new URL(loc, maxstreamUrl).href;
        if (!maxstreamUrl.includes('uprots') && !maxstreamUrl.includes('uprotem')) break;
      }
    }

    // Convert watchfree URL to maxstream embed
    if (maxstreamUrl.includes('watchfree/') || maxstreamUrl.includes('watchfree.')) {
      const parts = maxstreamUrl.split('watchfree/');
      if (parts[1]) {
        const segments = parts[1].split('/').filter(Boolean);
        if (segments.length >= 2) {
          maxstreamUrl = `https://maxstream.video/emvvv/${segments[1]}`;
        }
      }
    }

    return maxstreamUrl;
  } catch {
    return null;
  }
}

/**
 * Extract a video URL from a MaxStream page.
 */
async function _extractMaxstreamVideo(maxstreamUrl) {
  try {
    const resp = await fetch(maxstreamUrl, {
      headers: {
        'User-Agent': _UPROT_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://maxstream.video/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Try packed source first
    const unpacked = _unpackPacker(html) || html;

    const urlMatch = /sources\W+src\W+(https?:\/\/[^"']+)["']/i.exec(unpacked)
      || /sources\W+src\W+["'](https?:\/\/[^"']+)["']/i.exec(unpacked)
      || /file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i.exec(unpacked);

    if (urlMatch && urlMatch[1]) return urlMatch[1].trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * Main uprot handler: solve/bypass + get maxstream URL.
 * ?uprot=1&url=https://uprot.net/msf/xxx[&extract=1]
 */
async function _handleUprot(uprotUrl, reqUrl, env) {
  let link = uprotUrl;
  if (link.includes('/mse/')) link = link.replace('/mse/', '/msf/');

  try {
    let maxstreamUrl = null;

    // Strategy 1: Try cached cookies first (fast path)
    if (env?.ES_CACHE) {
      try {
        const cached = await env.ES_CACHE.get(_UPROT_COOKIES_KEY, 'json');
        if (cached && cached.cookies && cached.data && Date.now() - cached.t < 82800000) {
          maxstreamUrl = await _uprotBypassWithCookies(link, cached.cookies, cached.data, env);
          if (maxstreamUrl) {
            // Also extract video if requested
            if (reqUrl.searchParams.get('extract') === '1' && maxstreamUrl.includes('maxstream')) {
              const videoUrl = await _extractMaxstreamVideo(maxstreamUrl);
              if (videoUrl) return _json({ url: videoUrl, maxstream: maxstreamUrl, method: 'cached_cookies' });
            }
            return _json({ url: maxstreamUrl, method: 'cached_cookies' });
          }
        }
      } catch { /* KV read/parse failed */ }
    }

    // Strategy 2: Fresh captcha solve (same IP guarantees consistency)
    const solved = await _uprotSolveFresh(env);
    if (!solved || solved.failed) return _json({ error: 'Uprot captcha solve failed', attempts: solved?.attempts }, 502);

    // Now bypass with fresh cookies
    maxstreamUrl = await _uprotBypassWithCookies(link, solved.cookies, solved.data, env);
    if (!maxstreamUrl) {
      return _json({ error: 'Uprot bypass failed after solving captcha', solved: { answer: solved.answer, method: solved.method } }, 502);
    }

    // Extract video if requested
    if (reqUrl.searchParams.get('extract') === '1' && maxstreamUrl.includes('maxstream')) {
      const videoUrl = await _extractMaxstreamVideo(maxstreamUrl);
      if (videoUrl) return _json({ url: videoUrl, maxstream: maxstreamUrl, method: 'fresh_solve', ocrMethod: solved.method });
    }

    return _json({ url: maxstreamUrl, method: 'fresh_solve', ocrMethod: solved.method });
  } catch (err) {
    return _json({ error: `Uprot error: ${err.message}` }, 502);
  }
}

/**
 * Manual trigger: just solve the captcha and cache cookies.
 * ?uprot_solve=1
 */
async function _handleUprotSolve(env) {
  const solved = await _uprotSolveFresh(env);
  if (solved) return _json({ ok: true, answer: solved.answer, method: solved.method, cookies: solved.cookies, attempts: solved.attempts });
  return _json({ error: 'Captcha solve failed', attempts: solved?.attempts || [] }, 502);
}

/**
 * KV cookie cache: allow external callers (Vercel) to get/set uprot cookies.
 * GET  ?uprot_kv=1  → read cookies from KV
 * POST ?uprot_kv=1  → write cookies to KV (body: JSON with cookies, data, t)
 */
async function _handleUprotKv(request, env) {
  if (!env?.ES_CACHE) return _json({ error: 'KV not available' }, 500);

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.cookies || !body.data) return _json({ error: 'Missing cookies or data' }, 400);
      const kvData = { cookies: body.cookies, data: body.data, t: body.t || Date.now() };
      await env.ES_CACHE.put(_UPROT_COOKIES_KEY, JSON.stringify(kvData), { expirationTtl: 86400 });
      return _json({ ok: true, stored: true });
    } catch (e) {
      return _json({ error: `KV write failed: ${e.message}` }, 500);
    }
  }

  // GET → read
  try {
    const cached = await env.ES_CACHE.get(_UPROT_COOKIES_KEY, 'json');
    if (!cached) return _json({ cookies: null });
    return _json(cached);
  } catch (e) {
    return _json({ error: `KV read failed: ${e.message}` }, 500);
  }
}

/**
 * Diagnostic: fetch the uprot page, return raw HTML analysis without solving.
 */
async function _handleUprotDiag(env) {
  try {
    const getHeaders = { ..._uprotHeaders(_UPROT_INIT_URL) };
    delete getHeaders['Content-Type'];
    const r = await fetch(_UPROT_INIT_URL, {
      method: 'GET',
      headers: getHeaders,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    const setCookie = r.headers.getAll ? r.headers.getAll('Set-Cookie').join('; ') : (r.headers.get('Set-Cookie') || '');
    const html = await r.text();
    const hasImage = /data:image\/png;base64/.test(html);
    const hasCaptchaForm = /captcha/i.test(html);
    const imgMatch = html.match(/(?:src|data-src)=["'](data:image\/png;base64,([^"']+))["']/i)
      || html.match(/data:image\/png;base64,([^"']+)/i);
    const b64 = imgMatch ? (imgMatch[2] || imgMatch[1]).replace(/\s/g, '') : null;

    let ocrResult = null;
    if (b64) {
      try {
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const { width, height, pixels } = await _decodePngGrayscale(raw);
        const pxAnswer = _ocrDigitsFromPixels(width, height, pixels);
        ocrResult = { width, height, pxAnswer };
      } catch (e) { ocrResult = { error: e.message }; }
    }

    // Check KV for existing cookies
    let kvData = null;
    if (env?.ES_CACHE) {
      try {
        const kv = await env.ES_CACHE.get(_UPROT_COOKIES_KEY);
        if (kv) kvData = JSON.parse(kv);
      } catch {}
    }

    return _json({
      status: r.status,
      setCookie: setCookie.substring(0, 300),
      htmlLength: html.length,
      htmlSnippet: html.substring(0, 800),
      hasImage,
      hasCaptchaForm,
      b64Length: b64 ? b64.length : 0,
      ocrResult,
      kvCookies: kvData,
    });
  } catch (e) {
    return _json({ error: e.message }, 500);
  }
}

/**
 * OCR endpoint: accept base64 image via POST body, return recognized digits.
 * Used as AI fallback when local bitmap OCR fails.
 */
async function _handleOcrDigits(request, env) {
  try {
    const body = await request.json();
    const b64 = body?.image;
    if (!b64) return _json({ error: 'Missing image field' }, 400);

    let answer = null;
    let pxErr = null;
    let aiErr = null;

    // 1. Try pixel OCR
    try {
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const { width, height, pixels } = await _decodePngGrayscale(raw);
      const pxAnswer = _ocrDigitsFromPixels(width, height, pixels);
      if (pxAnswer && !pxAnswer.includes('?') && pxAnswer.length >= 2 && pxAnswer.length <= 5) {
        answer = pxAnswer;
        return _json({ answer, method: 'pixel' });
      }
      pxErr = 'no match: ' + (pxAnswer || 'null');
    } catch (e) { pxErr = e.message; }

    // 2. AI vision fallback (majority-voting with Llama 3.2 Vision)
    const expectedDigits = body?.expectedDigits || 3;
    try {
      const imageBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const aiText = await _aiOcrDigits(env, imageBytes, expectedDigits);
      if (aiText) return _json({ answer: aiText, method: 'ai' });
      aiErr = 'returned null';
    } catch (e) { aiErr = e.message; }

    return _json({ error: 'OCR failed', pxErr, aiErr, hasAI: !!env?.AI }, 422);
  } catch (e) {
    return _json({ error: e.message }, 500);
  }
}

// ── Uprot cron (auto-solve captcha every 20h) ─────────────────────────────────
async function _getUprotState(env) {
  // Read cooldown from KV (globally consistent across PoPs)
  if (env?.ES_CACHE) {
    try {
      const kv = await env.ES_CACHE.get('sfm:uprot:cooldown', 'json');
      if (kv) return kv;
    } catch {}
  }
  return { lastComplete: 0 };
}

async function _putUprotState(state, env) {
  if (env?.ES_CACHE) {
    try {
      await env.ES_CACHE.put('sfm:uprot:cooldown', JSON.stringify(state), { expirationTtl: 172800 });
    } catch {}
  }
  try {
    const cache = caches.default;
    const resp = new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=172800' },
    });
    await cache.put(_UPROT_STATE_CACHE_KEY, resp);
  } catch {}
}

async function _handleScheduledUprotRefresh(env) {
  if (!env?.ES_CACHE) return;

  const state = await _getUprotState(env);
  if (state.lastComplete && Date.now() - state.lastComplete < _UPROT_COOLDOWN_MS) return;

  try {
    const solved = await _uprotSolveFresh(env);
    if (solved && !solved.failed) {
      await _putUprotState({ lastComplete: Date.now(), answer: solved.answer, method: solved.method }, env);
    }
  } catch { /* try next cron run */ }
}

/**
 * ─── KissKH Subtitle Warming via CF Worker ─────────────────────────────────
 * Full flow: Sub API → filter Italian → fetch .txt1 → AES decrypt → return
 */

const _KK_API_BASE = 'https://kisskh.do/api';
const _KK_SUB_KKEY = '43B832ED7618A14320177D239448E8189AAC2F524A0CE644F80C476A5A3F43BB031BAD3AFA35E58F9507DE22A4FB2CC4FC069410DF0AD1AF514B2FC3C95F256916A05B8620570ECAE389037A88887266F4E6CA6A305C33E45B2F62D488DB3E72E6578BAEB2CD39ED30F2E29E13A3590E5872E3EAA36C73EB5438871F3AB8A700';
const _KK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// base64-encoded key/IV pairs
const _KK_CRYPTO_KEYS = [
  { key: 'ODA1NjQ4MzY0NjMyODc2Mw==', iv: 'Njg1MjYxMjM3MDE4NTI3Mw==' },       // 8056483646328763 / 6852612370185273
  { key: 'QW1TbVpWY0g5M1VRVWV6aQ==', iv: 'UmVCS1dXOGNxZGpQRW5GNg==' },       // AmSmZVcH93UQUezi / ReBKWW8cqdjPEnF6
  { key: 'c1dPRFhYMDRRUlRrSGRsWg==', iv: 'OHB3aGFwSmVDNGhyUzloTw==' },       // sWODXX04QRTkHdlZ / 8pwhapJeC4hrS9hO
];

function _b64ToUint8(str) {
  const binary = atob(str);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

function _textToUint8(str) {
  return new TextEncoder().encode(str);
}

async function _kkDecryptLineAsync(line) {
  let buf;
  try { buf = _b64ToUint8(line); } catch { return line; }
  if (buf.length < 8) return line;

  for (const { key: keyB64, iv: ivB64 } of _KK_CRYPTO_KEYS) {
    try {
      const keyRaw = _b64ToUint8(keyB64);
      const ivRaw = _b64ToUint8(ivB64);
      const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-CBC' }, false, ['decrypt']);
      const decBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivRaw }, key, buf);
      const text = new TextDecoder().decode(decBuf).trim();
      if (/[a-zA-Zà-ÿÀ-Ÿ\s]/.test(text)) return text;
    } catch {}
  }
  return line;
}

async function _kkDecryptFullAsync(srtText) {
  const lines = srtText.split('\n');
  const results = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[A-Za-z0-9+\/=]{16,}$/.test(trimmed)) {
      results.push(await _kkDecryptLineAsync(trimmed));
    } else {
      results.push(line);
    }
  }
  let result = results.join('\n');
  result = result
    .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  result = result.replace(/\r?\n/g, '\r\n');
  return result;
}

async function _kkDecryptBufferAsync(arrayBuf, keyB64, ivB64) {
  try {
    const keyRaw = _b64ToUint8(keyB64);
    const ivRaw = _b64ToUint8(ivB64);
    const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-CBC' }, false, ['decrypt']);
    const decBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivRaw }, key, arrayBuf);
    return new TextDecoder().decode(decBuf).trim();
  } catch { return null; }
}

function _resolveKkSubUrl(sub) {
  if (sub.src) return sub.src;
  if (sub.GET && sub.GET.host && sub.GET.filename) {
    let u = `${sub.GET.scheme || 'https'}://${sub.GET.host}${sub.GET.filename}`;
    if (sub.GET.query && sub.GET.query.v) u += `?v=${sub.GET.query.v}`;
    return u;
  }
  return null;
}

/**
 * Full KissKH subtitle extraction via CF Worker.
 * POST body: { episodeId, [serieId] }
 *
 * Steps:
 *  1. GET /api/Sub/{episodeId}?kkey=... → subtitle list
 *  2. Filter Italian subtitles (language + .it. URL pattern)
 *  3. Fetch encrypted .txt1 file
 *  4. Decrypt AES-128-CBC (3 key/IV pairs)
 *  5. Return decrypted SRT/WEBVTT
 */
async function _handleKkSubsWarm(request, env) {
  const t0 = Date.now();
  try {
    const body = await request.json();
    const episodeId = body.episodeId;
    const serieId = body.serieId || '';

    if (!episodeId) {
      return _json({ error: 'episodeId required' }, 400);
    }

    // ── Step 1: Fetch subtitle list from KissKH API ──
    const subApiUrl = `${_KK_API_BASE}/Sub/${episodeId}?kkey=${_KK_SUB_KKEY}`;
    let subtitleList;
    try {
      const resp = await fetch(subApiUrl, {
        headers: {
          'User-Agent': _KK_UA,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://kisskh.do/',
          'Origin': 'https://kisskh.do',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        return _json({ ok: false, error: `Sub API HTTP ${resp.status}`, episodeId, ms: Date.now() - t0 });
      }
      const data = await resp.json();
      subtitleList = Array.isArray(data) ? data : [data];
    } catch (err) {
      return _json({ ok: false, error: `Sub API failed: ${err.message}`, episodeId, ms: Date.now() - t0 });
    }

    // ── Step 2: Filter Italian subtitles ──
    const ITA_URL = /^https?:\/\/.*\.it\.(srt|vtt|txt1|txt)$/i;
    const itSubs = subtitleList.filter(s => {
      const lang = (s.land || s.label || s.lang || s.language || s.name || '').toLowerCase().trim();
      const isItaLang = ['it', 'ita', 'italian', 'italiano', 'it-it', 'itit'].includes(lang);
      const src = _resolveKkSubUrl(s);
      return isItaLang || (src && ITA_URL.test(src));
    });

    if (itSubs.length === 0) {
      return _json({ ok: false, reason: 'no-ita-sub', totalSubs: subtitleList.length, episodeId, serieId, ms: Date.now() - t0 });
    }

    // ── Step 3 + 4: Fetch + Decrypt each Italian subtitle ──
    for (const sub of itSubs) {
      const subUrl = _resolveKkSubUrl(sub);
      if (!subUrl) continue;

      try {
        const sresp = await fetch(subUrl, {
          headers: { 'User-Agent': _KK_UA, 'Accept': '*/*', 'Referer': 'https://kisskh.do/' },
          signal: AbortSignal.timeout(10000),
        });
        if (!sresp.ok) continue;

        const arrayBuf = await sresp.arrayBuffer();
        const asText = new TextDecoder().decode(arrayBuf).trim();

        const isEncrypted = /\.(txt1|txt)$/i.test(subUrl);
        let decrypted = null;

        if (isEncrypted) {
          if (asText.startsWith('1') || asText.startsWith('WEBVTT') || /^[A-Za-z0-9+\/=]{16,}/.test(asText.split('\n')[0])) {
            decrypted = await _kkDecryptFullAsync(asText);
          } else {
            for (const { key: kb, iv: ib } of _KK_CRYPTO_KEYS) {
              const attempt = await _kkDecryptBufferAsync(arrayBuf, kb, ib);
              if (attempt && /[a-zA-Zà-ÿÀ-Ÿ\s]/.test(attempt)) {
                decrypted = attempt;
                break;
              }
            }
          }
        } else {
          decrypted = asText;
        }

        if (!decrypted) continue;

        // Validate SRT/WEBVTT
        const isValid = decrypted.match(/^\d+\r?\n\d{2}:\d{2}:\d{2}/) || decrypted.startsWith('WEBVTT');
        if (!isValid) continue;

        // ── Step 5: Store in KV if available ──
        if (env?.ES_CACHE && serieId) {
          const kvKey = `kk:sub:${serieId}:${episodeId}`;
          const format = decrypted.startsWith('WEBVTT') ? 'vtt' : 'srt';
          const mime = format === 'vtt' ? 'text/vtt' : 'application/x-subrip';
          const b64 = btoa(unescape(encodeURIComponent(decrypted)));
          const subData = [{ lang: 'it', label: 'Italiano', url: `data:${mime};base64,${b64}` }];
          await env.ES_CACHE.put(kvKey, JSON.stringify(subData), { expirationTtl: 7776000 }).catch(() => {});
        }

        return _json({
          ok: true,
          decrypted,
          lang: 'it',
          episodeId,
          serieId,
          subUrl: subUrl.substring(0, 80),
          format: decrypted.startsWith('WEBVTT') ? 'webvtt' : 'srt',
          size: decrypted.length,
          ms: Date.now() - t0,
        });
      } catch {}
    }

    return _json({ ok: false, reason: 'decrypt-failed', itSubCount: itSubs.length, episodeId, serieId, ms: Date.now() - t0 });
  } catch (err) {
    return _json({ ok: false, error: err.message, ms: Date.now() - t0 }, 500);
  }
}
