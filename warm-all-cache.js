'use strict';

/**
 * warm-all-cache.js — Master script that runs all warm cache scripts sequentially.
 *
 * Generates pre-built .gz catalog files for all supported providers:
 *   - EuroStreaming  → es-cache/page-{N}.json.gz + es-titles-index.json
 *   - GuardoSerie    → gs-cache/page-{N}.json.gz + gs-titles-index.json
 *   - KissKH         → kk-cache/page-{N}.json.gz + kk-titles-index.json
 *   - Rama           → rama-cache/page-{N}.json.gz + rama-titles-index.json
 *   - Loonex         → loonex-cache/catalog.json.gz + loonex-titles-index.json
 *
 * Run from LOCAL MACHINE:
 *   node warm-all-cache.js
 *   node warm-all-cache.js --only=es,kk    (run specific providers)
 */

const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPTS = [
  { name: 'EuroStreaming', file: 'warm-es-cache.js' },
  { name: 'GuardoSerie',  file: 'warm-gs-cache.js' },
  { name: 'KissKH',       file: 'warm-kk-cache.js' },
  { name: 'Rama',         file: 'warm-rama-cache.js' },
  { name: 'Loonex',       file: 'warm-loonex-cache.js' },
];

// Parse --only=es,kk filter
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const onlyFilter = onlyArg ? onlyArg.split('=')[1].split(',').map(s => s.trim().toLowerCase()) : null;

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Warm ALL Provider Caches (.gz)       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const results = [];

  for (const script of SCRIPTS) {
    const shortName = script.file.replace('warm-', '').replace('-cache.js', '');
    if (onlyFilter && !onlyFilter.includes(shortName) && !onlyFilter.includes(script.name.toLowerCase())) {
      console.log(`⏭  Skipping ${script.name} (filtered)\n`);
      continue;
    }

    const scriptPath = path.join(__dirname, script.file);
    console.log(`\n▶ Running ${script.name} (${script.file})...\n${'─'.repeat(50)}`);
    const start = Date.now();

    try {
      execFileSync('node', [scriptPath], {
        stdio: 'inherit',
        cwd: __dirname,
        timeout: 5 * 60 * 1000, // 5 min max per script
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      results.push({ name: script.name, status: '✅', elapsed });
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      results.push({ name: script.name, status: '❌', elapsed, error: e.message?.split('\n')[0] || 'unknown' });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('SUMMARY:');
  for (const r of results) {
    console.log(`  ${r.status} ${r.name.padEnd(16)} ${r.elapsed}s${r.error ? ` — ${r.error}` : ''}`);
  }
  console.log('═'.repeat(50));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
