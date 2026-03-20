#!/usr/bin/env node
/**
 * discover-domains.js — TLD brute-force domain discovery for all providers.
 *
 * For each provider, extracts the base domain name and tries ~80 common TLDs.
 * Validates each candidate with HTTP probe + HTML marker fingerprinting.
 *
 * Actions:
 *  1. If a provider's current domain is dead → switch to first working alternative
 *  2. New working domains found → added to _KNOWN_DOMAINS in cfworker.js
 *  3. If any change → bumps version in package.json + manifest.json
 *
 * Usage:
 *   node scripts/discover-domains.js            — run full scan
 *   node scripts/discover-domains.js --dry-run   — probe only, no file changes
 *
 * Exit codes:
 *   0 = changes written (or dry-run found changes)
 *   1 = no changes needed
 *   2 = error
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROVIDER_URLS_PATH = path.join(ROOT, 'data', 'provider_urls.json');
const CFWORKER_PATH = path.join(ROOT, 'workers', 'cfworker.js');
const PKG_PATH = path.join(ROOT, 'package.json');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

const DRY_RUN = process.argv.includes('--dry-run');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Provider definitions ─────────────────────────────────────────────────────
// bases: domain name patterns (without TLD) to try
// markers: HTML substrings that identify the real site
// minMarkers: how many markers must match (default 2) — prevents false positives
// testPath: optional path to probe instead of root (e.g. guardahd root is fake)
const PROVIDERS = {
  guardaflix:           { bases: ['guardaplay'],                         markers: ['guardaflix', 'guardaplay', 'film'],     minMarkers: 2 },
  guardaserie:          { bases: ['guardaserietv'],                     markers: ['guardaserie', 'stagion', 'serie-tv'],   minMarkers: 2 },
  guardoserie:          { bases: ['guardoserie'],                       markers: ['guardoserie', 'stagion', 'serie-tv'],   minMarkers: 2 },
  guardahd:             { bases: ['guardahd', 'mostraguarda'],          markers: ['guardahd', 'mostraguarda', 'set-movie'], minMarkers: 1, testPath: '/set-movie-a/tt9218128' },
  cb01:                 { bases: ['cb01uno', 'cb01'],                   markers: ['cb01', 'film-', 'genere'],              minMarkers: 2 },
  eurostreaming:        { bases: ['eurostream', 'eurostreamings', 'eurostreaming'], markers: ['eurostreaming', 'serie-tv', 'wp-content'], minMarkers: 2 },
  toonitalia:           { bases: ['toonitalia'],                        markers: ['toonitalia', 'cartoon', 'anime'],        minMarkers: 2 },
  animeunity:           { bases: ['www.animeunity'],                    markers: ['animeunity', 'episodi'],                 minMarkers: 2 },
  animeworld:           { bases: ['www.animeworld'],                    markers: ['animeworld', 'episodi'],                 minMarkers: 2 },
  animesaturn:          { bases: ['www.animesaturn'],                   markers: ['animesaturn', 'episod'],                 minMarkers: 2 },
  loonex:               { bases: ['loonex'],                            markers: ['loonex', 'stream'],                      minMarkers: 2 },
  streamingcommunity:   { bases: ['streamingcommunity', 'vixsrc'],      markers: ['sliders-title', '/titles/'],             minMarkers: 2 },
  kisskh:               { bases: ['kisskh'],                            markers: ['kisskh', 'dramalist', 'episode'],        minMarkers: 2 },
  rama:                 { bases: ['ramaorientalfansub'],                markers: ['ramaorientalfansub', 'fansub', 'drama'], minMarkers: 2 },
};

// Hostnames that are domain marketplaces / parking services — always reject
const BLOCKED_HOSTNAMES = [
  'expireddomains.com', 'sedo.com', 'hugedomains.com', 'godaddy.com',
  'afternic.com', 'dan.com', 'namecheap.com', 'bodis.com', 'parkingcrew.net',
  'above.com', 'domainmarket.com', 'undeveloped.com', 'domainlore.co.uk',
  'dynadot.com', 'porkbun.com',
];

// Common TLDs used by Italian streaming sites (sorted by frequency of use)
const COMMON_TLDS = [
  // Most seen on these sites
  'stream', 'click', 'life', 'xyz', 'space', 'blog', 'bar', 'beer',
  'run', 'skin', 'surf', 'best', 'digital', 'cfd', 'autos', 'asia',
  'uno', 'ing', 'cx', 'dev', 'ac', 'so', 'to', 'website', 'online',
  'site', 'fun', 'icu', 'top', 'bond', 'computer', 'rest', 'lol',
  // Generic
  'com', 'net', 'org', 'io', 'co', 'tv', 'me', 'info',
  // Country codes
  'it', 'eu', 'uk', 'us', 'de', 'fr', 'es', 'nl', 'ch',
  // New gTLDs
  'app', 'win', 'vip', 'pro', 'work', 'tech', 'store', 'club',
  'link', 'pw', 'buzz', 'lat', 'monster', 'sbs', 'world', 'today',
  'moe', 'cam', 'cc', 'ws', 'nu', 'gd', 'pm', 'wf', 'tf',
  'art', 'biz', 'rocks', 'live', 'tube', 'media', 'mov', 'film',
  'watch', 'show', 'casa', 'black', 'blue', 'date', 'cloud', 'zone',
];

// Community sources (same as CF Worker)
const COMMUNITY_SOURCES = [
  {
    name: 'easystreams',
    url: 'https://raw.githubusercontent.com/realbestia1/easystreams/refs/heads/main/provider_urls.json',
    parse: (data) => data,
  },
  {
    name: 'mammamia',
    url: 'https://raw.githubusercontent.com/UrloMythus/MammaMia/main/config.json',
    parse: (data) => {
      const siti = data?.Siti || {};
      const map = {
        StreamingCommunity: 'streamingcommunity', AnimeSaturn: 'animesaturn',
        AnimeWorld: 'animeworld', AnimeUnity: 'animeunity', CB01: 'cb01',
        Guardaserie: 'guardaserie', GuardoSerie: 'guardoserie', Guardoserie: 'guardoserie',
        GuardaHD: 'guardahd', Eurostreaming: 'eurostreaming', ToonItalia: 'toonitalia',
        Toonitalia: 'toonitalia', Guardaflix: 'guardaflix',
      };
      const out = {};
      for (const [name, info] of Object.entries(siti)) {
        const key = map[name];
        if (key && info?.url) out[key] = info.url;
      }
      return out;
    },
  },
];

// ── HTTP probe ───────────────────────────────────────────────────────────────

/**
 * Probe a URL: fetch, check markers, reject parking/WAF.
 * @param {string} url        URL to probe
 * @param {string[]} markers  HTML markers to check
 * @param {number} minMarkers Minimum markers that must match (default 2)
 * @param {string} expectedBase  Expected base hostname (e.g. 'guardaplay') — rejects redirects to unrelated domains
 * @returns {string|null} Origin URL if valid, null otherwise
 */
async function probe(url, markers, minMarkers = 2, expectedBase = '') {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok && resp.status !== 403) return null;

    const finalHost = new URL(resp.url).hostname.toLowerCase();
    const origin = new URL(resp.url).origin;

    // Reject known domain marketplaces / parking services
    if (BLOCKED_HOSTNAMES.some(bh => finalHost === bh || finalHost.endsWith('.' + bh))) return null;

    // Reject if redirected to a completely different domain (parking redirect)
    if (expectedBase && !finalHost.includes(expectedBase.replace('www.', ''))) return null;

    const html = await resp.text();
    const lower = html.toLowerCase();

    // Reject WAF blocks, parked/suspended pages
    if (lower.includes('attention required') || lower.includes('access denied') ||
        lower.includes('this website is using a security service') ||
        lower.includes('suspended') || lower.includes('parked free') ||
        lower.includes('buy this domain') || lower.includes('domain for sale') ||
        lower.includes('domain is for sale') || lower.includes('this domain') && lower.includes('sale') ||
        lower.includes('registrar') && lower.includes('whois')) {
      return null;
    }

    // On 403: only accept CF JS challenge
    if (resp.status === 403) {
      return lower.includes('just a moment') ? origin : null;
    }

    // Verify HTML markers — need at least minMarkers to match
    const matched = markers.filter(m => lower.includes(m.toLowerCase())).length;
    if (markers.length > 0 && matched < minMarkers) return null;

    return origin;
  } catch {
    return null;
  }
}

// ── Concurrency limiter ──────────────────────────────────────────────────────

async function parallelLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ── Community sources fetcher ────────────────────────────────────────────────

async function fetchCommunitySources() {
  const merged = {};
  const results = await Promise.allSettled(
    COMMUNITY_SOURCES.map(async (src) => {
      const resp = await fetch(src.url, {
        headers: { 'Accept': 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return {};
      return src.parse(await resp.json()) || {};
    })
  );
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      for (const [k, v] of Object.entries(r.value)) {
        const key = k.toLowerCase().trim();
        const val = String(v || '').trim().replace(/\/+$/, '');
        if (key && val && key !== 'mapping_api') merged[key] = val;
      }
    }
  }
  return merged;
}

// ── Read _KNOWN_DOMAINS from cfworker.js ────────────────────────────────────

function readKnownDomains() {
  const code = fs.readFileSync(CFWORKER_PATH, 'utf8');
  const match = code.match(/const _KNOWN_DOMAINS\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) return {};

  const result = {};
  const block = match[1];
  const lineRe = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = lineRe.exec(block))) {
    const provider = m[1];
    const domains = m[2].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
    result[provider] = domains;
  }
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Domain Discovery — TLD brute-force scan\n');

  // Load current state
  const providerUrls = JSON.parse(fs.readFileSync(PROVIDER_URLS_PATH, 'utf8'));
  const knownDomains = readKnownDomains();
  const community = await fetchCommunitySources();

  console.log('📡 Community sources:', Object.keys(community).length, 'providers');
  for (const [k, v] of Object.entries(community)) {
    console.log(`   ${k}: ${v}`);
  }
  console.log();

  const urlChanges = {};       // provider → { from, to }
  const knownAdditions = {};   // provider → [new hostnames]
  let totalProbes = 0;

  for (const [provider, config] of Object.entries(PROVIDERS)) {
    const currentUrl = providerUrls[provider];
    const known = knownDomains[provider] || [];

    // Build candidate set (deduplicated)
    const candidates = new Set();

    // 1. Community URL
    if (community[provider]) {
      const u = community[provider].replace(/\/+$/, '');
      candidates.add(u.startsWith('http') ? u : `https://${u}`);
    }

    // 2. Known domains
    for (const d of known) {
      candidates.add(d.startsWith('http') ? d : `https://${d}`);
    }

    // 3. TLD brute-force
    for (const base of config.bases) {
      for (const tld of COMMON_TLDS) {
        candidates.add(`https://${base}.${tld}`);
      }
    }

    // Remove current URL from candidates (we probe it separately first)
    if (currentUrl) candidates.delete(currentUrl);

    const minMarkers = config.minMarkers ?? 2;

    // --- Phase 1: Check if current domain is alive ---
    let currentAlive = false;
    if (currentUrl) {
      totalProbes++;
      // For providers with testPath, probe the specific path instead of root
      const probeUrl = config.testPath ? currentUrl + config.testPath : currentUrl;
      const result = await probe(probeUrl, config.markers, minMarkers);
      currentAlive = !!result;
      console.log(`${currentAlive ? '✅' : '💀'} ${provider}: current ${currentUrl}`);
    } else {
      console.log(`⚠️  ${provider}: no current URL in provider_urls.json`);
    }

    // --- Phase 2: Probe all TLD candidates in parallel ---
    const candidateList = [...candidates];
    const tasks = candidateList.map(url => {
      // Determine expected base for redirect detection
      let expectedBase = '';
      try { expectedBase = new URL(url).hostname.split('.').slice(0, -1).join('.'); } catch {}
      // Use testPath for providers that need it
      const probeUrl = config.testPath ? url + config.testPath : url;
      return () => probe(probeUrl, config.markers, minMarkers, expectedBase).then(r => r ? { url, origin: r } : null);
    });
    totalProbes += tasks.length;

    const results = await parallelLimit(tasks, 20);
    const alive = results.filter(Boolean);

    // Collect all working hostnames for _KNOWN_DOMAINS update
    const currentHostname = currentUrl ? (() => { try { return new URL(currentUrl).hostname; } catch { return ''; } })() : '';
    const allAliveHostnames = new Set();
    if (currentAlive && currentHostname) allAliveHostnames.add(currentHostname);
    for (const { origin } of alive) {
      try { allAliveHostnames.add(new URL(origin).hostname); } catch {}
    }

    // Find new hostnames not in _KNOWN_DOMAINS AND not the current hostname
    const newHostnames = [...allAliveHostnames].filter(h => !known.includes(h) && h !== currentHostname);
    if (newHostnames.length > 0) {
      knownAdditions[provider] = newHostnames;
      console.log(`   🆕 New domains found: ${newHostnames.join(', ')}`);
    }

    // If current domain is dead, switch to the best alternative
    if (!currentAlive && alive.length > 0) {
      const best = alive[0].origin;
      urlChanges[provider] = { from: currentUrl || '(none)', to: best };
      console.log(`   🔄 Switching to: ${best}`);
    }

    if (alive.length > 0) {
      console.log(`   📋 All alive: ${alive.map(a => new URL(a.origin).hostname).join(', ')}`);
    } else if (!currentAlive) {
      console.log(`   ❌ No working domain found!`);
    }
  }

  console.log(`\n📊 Total probes: ${totalProbes}`);

  // ── Summary ──────────────────────────────────────────────────────────────
  const hasUrlChanges = Object.keys(urlChanges).length > 0;
  const hasKnownAdditions = Object.keys(knownAdditions).length > 0;

  if (!hasUrlChanges && !hasKnownAdditions) {
    console.log('\n✅ All domains up to date — no changes needed.');
    process.exit(1);
  }

  console.log('\n📝 Changes to apply:');
  if (hasUrlChanges) {
    console.log('  provider_urls.json:');
    for (const [p, c] of Object.entries(urlChanges)) {
      console.log(`    ${p}: ${c.from} → ${c.to}`);
    }
  }
  if (hasKnownAdditions) {
    console.log('  cfworker.js _KNOWN_DOMAINS:');
    for (const [p, hosts] of Object.entries(knownAdditions)) {
      console.log(`    ${p}: +${hosts.join(', +')}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n🏁 Dry run — no files modified.');
    process.exit(0);
  }

  // ── Apply changes ────────────────────────────────────────────────────────

  // 1. Update provider_urls.json
  if (hasUrlChanges) {
    for (const [p, c] of Object.entries(urlChanges)) {
      providerUrls[p] = c.to;
    }
    fs.writeFileSync(PROVIDER_URLS_PATH, JSON.stringify(providerUrls, null, 2) + '\n');
    console.log('\n✏️  Updated data/provider_urls.json');
  }

  // 2. Update _KNOWN_DOMAINS in cfworker.js
  if (hasKnownAdditions) {
    let code = fs.readFileSync(CFWORKER_PATH, 'utf8');
    for (const [provider, hostnames] of Object.entries(knownAdditions)) {
      for (const hostname of hostnames) {
        if (code.includes(`'${hostname}'`)) continue; // already there

        // Find the provider's array line and append
        const re = new RegExp(`(${provider}:\\s*\\[)([^\\]]+)(\\])`);
        const match = code.match(re);
        if (match) {
          const newEntry = match[2].trimEnd() + `, '${hostname}'`;
          code = code.replace(re, `$1${newEntry}$3`);
        }
      }
    }
    fs.writeFileSync(CFWORKER_PATH, code);
    console.log('✏️  Updated workers/cfworker.js _KNOWN_DOMAINS');
  }

  // 3. Bump version
  for (const filePath of [PKG_PATH, MANIFEST_PATH]) {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const parts = json.version.split('.');
    parts[2] = String(parseInt(parts[2]) + 1);
    json.version = parts.join('.');
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
    console.log(`✏️  ${path.basename(filePath)} → v${json.version}`);
  }

  // 4. Build commit message
  const desc = [
    ...Object.entries(urlChanges).map(([p, c]) => `${p}: ${c.from} → ${c.to}`),
    ...Object.entries(knownAdditions).map(([p, h]) => `${p}: +${h.join(',+')}`),
  ].join('; ');
  console.log(`\n🏁 Done! Commit message suggestion:`);
  console.log(`   fix(domain-discovery): ${desc}`);
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
