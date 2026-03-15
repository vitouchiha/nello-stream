'use strict';
/**
 * QA Vercel Test Script
 * Tests all providers and problematic titles against the live Vercel deployment.
 */

const BASE = 'https://streamfusion-mail.vercel.app';
const TIMEOUT = 55000;

const TITLES = {
  // Series
  'Will & Grace':       { id: 'tt0157246', type: 'series', s: 1, e: 1 },
  'Mercoledì':          { id: 'tt13443470', type: 'series', s: 1, e: 1 },
  'Snowpiercer':        { id: 'tt6156584', type: 'series', s: 1, e: 1 },
  'Frieren':            { id: 'tt22248376', type: 'series', s: 1, e: 1 },
  'HIMYM':              { id: 'tt0460649', type: 'series', s: 1, e: 1 },
  'Mare Fuori':         { id: 'tt6864602', type: 'series', s: 1, e: 1 },
  'One Piece':          { id: 'tt0388629', type: 'series', s: 1, e: 1 },
  'Scrubs':             { id: 'tt0285403', type: 'series', s: 1, e: 1 },
  // Movie
  'Gladiatore 2':       { id: 'tt9218128', type: 'movie' },
};

const PROVIDERS = [
  'kisskh', 'rama',
  'streamingcommunity', 'guardahd', 'guardaserie-easystreams', 'guardoserie',
  'animeunity', 'animeworld', 'animesaturn',
];

async function fetchJson(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    const d = await r.json();
    return { data: d, ms: Date.now() - t0, ok: true };
  } catch (e) {
    return { error: e.message, ms: Date.now() - t0, ok: false };
  }
}

async function testPerProvider(title, info) {
  const composite = info.type === 'movie' ? info.id : `${info.id}:${info.s}:${info.e}`;
  const url = `${BASE}/debug/providers-stream?id=${composite}&type=${info.type}&timeout=45000`;
  const { data, ms, ok, error } = await fetchJson(url);
  if (!ok) return { title, error, ms };
  return {
    title,
    ms,
    titleResolution: data.titleResolution,
    summary: data.summary,
    results: data.results?.map(r => ({
      provider: r.provider,
      status: r.status,
      count: r.count,
      ms: r.ms,
      error: r.error || null,
      errorKind: r.errorKind || null,
      sampleNames: r.sampleNames || [],
    })),
  };
}

async function testFullStream(title, info) {
  const composite = info.type === 'movie' ? info.id : `${info.id}:${info.s}:${info.e}`;
  const url = `${BASE}/debug-stream/${info.type}/${composite}.json`;
  const { data, ms, ok, error } = await fetchJson(url);
  if (!ok) return { title, error, ms, streamCount: 0 };
  const streams = data.streams || [];
  return {
    title,
    ms,
    streamCount: streams.length,
    streams: streams.map(s => ({
      name: s.name,
      title: (s.title || '').split('\n')[0],
      hasUrl: !!(s.url || s.externalUrl),
      url: (s.url || s.externalUrl || '').substring(0, 100),
      debug: s._debug || {},
    })),
  };
}

async function main() {
  console.log('=== Health Check ===');
  const health = await fetchJson(`${BASE}/health`);
  console.log(JSON.stringify(health.data, null, 2));

  console.log('\n=== Per-Provider Tests (debug/providers-stream) ===');
  // Test key titles with per-provider breakdown
  for (const [name, info] of Object.entries(TITLES)) {
    console.log(`\n--- ${name} (${info.id}) ---`);
    const result = await testPerProvider(name, info);
    if (result.error) {
      console.log('  ERROR:', result.error, `(${result.ms}ms)`);
      continue;
    }
    console.log(`  Title: ${result.titleResolution?.title} (${result.titleResolution?.source})`);
    console.log(`  Summary: ${result.summary?.ok} ok, ${result.summary?.noMatch} no_match, ${result.summary?.timeout} timeout, ${result.summary?.error} error, ${result.summary?.streamTotal} total streams`);
    for (const r of (result.results || [])) {
      const icon = r.status === 'ok' ? '✓' : r.status === 'timeout' ? '⏱' : r.status === 'no_match' ? '∅' : '✗';
      console.log(`  ${icon} ${r.provider}: ${r.status} (${r.count} streams, ${r.ms}ms)${r.error ? ' ERR: ' + r.error.substring(0, 80) : ''}`);
    }
  }

  console.log('\n=== Full Stream Tests (debug-stream) ===');
  for (const [name, info] of Object.entries(TITLES)) {
    console.log(`\n--- ${name} ---`);
    const result = await testFullStream(name, info);
    if (result.error) {
      console.log('  ERROR:', result.error, `(${result.ms}ms)`);
      continue;
    }
    console.log(`  ${result.streamCount} streams in ${result.ms}ms`);
    for (const s of result.streams) {
      console.log(`  - ${s.name} | ${s.title} | ${s.hasUrl ? 'URL' : 'NO_URL'}`);
    }
  }
}

main().catch(e => console.error('Fatal:', e));
