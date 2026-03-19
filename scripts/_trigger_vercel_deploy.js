// Manual Vercel deploy trigger via API
// Requires VERCEL_TOKEN env var

const https = require('https');

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = 'prj_something'; // Need to find this

if (!VERCEL_TOKEN) {
  console.log('❌ VERCEL_TOKEN env var not set');
  console.log('Set: set VERCEL_TOKEN=your_token');
  console.log('\nAlternatively, manually trigger deploy on https://vercel.com/deployments');
  process.exit(1);
}

console.log('Attempting to trigger Vercel deploy...');
console.log('Note: This requires VERCEL_TOKEN env var to be set');
console.log('\nAlternative: Visit https://vercel.com/dashboard and manually deploy');
