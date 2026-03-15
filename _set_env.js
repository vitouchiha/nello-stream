const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const vars = {
  CF_WORKER_URLS: [
    'https://kisskh-proxy.vitobsfm.workers.dev',
    'https://kisskh-proxy.lillisuzz-sfm.workers.dev',
    'https://kisskh-proxy.vitospagnulo-sfm.workers.dev',
    'https://kisskh-proxy.dinospagnulo-sfm.workers.dev',
    'https://kisskh-proxy.pixiepaxa-sfm.workers.dev'
  ].join(','),
  CF_WORKER_AUTHS: [
    'PJxVzfuySO5IkMGec1pZsFvWDNbiHRE6jULnB2t3',
    'gY5bQfubimk6wWEUGH-CKQG6iVSMwFuvxmQV-avJ',
    'UXujNf_i9eHd0i1JwYmJycWZM96IfPAiA9jtJQ',
    'olrMZDJd1Yz0tuF0-KtEmiLqean0QtIlbzzvlw',
    'nJ0yrMcclqkcYEMTMF5C-jGq9RseMk6FAcJQow'
  ].join(',')
};

for (const [name, value] of Object.entries(vars)) {
  const tmpFile = path.join(os.tmpdir(), `vercel_env_${name}.txt`);
  fs.writeFileSync(tmpFile, value);
  try {
    execSync(`vercel env add ${name} production --force < "${tmpFile}"`, { encoding: 'utf8', shell: true });
    console.log(`✅ ${name}: ${value.split(',').length} entries`);
  } catch (e) {
    console.error(`❌ ${name}:`, e.stderr || e.message);
  }
  fs.unlinkSync(tmpFile);
}
