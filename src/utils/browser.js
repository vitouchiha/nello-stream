'use strict';

/**
 * Shared Puppeteer browser launcher — Vercel-compatible
 *
 * On Vercel / serverless:
 *   - Uses @sparticuz/chromium (pre-built ~45MB Chromium for Lambda/Edge)
 *   - puppeteer-core links to that binary
 *
 * Locally / Docker:
 *   - Uses PUPPETEER_EXECUTABLE_PATH env var if set
 *   - Falls back to auto-detected system/bundled Chromium
 *
 * Usage:
 *   const { launchBrowser } = require('./browser');
 *   const browser = await launchBrowser();
 *   // ... use browser
 *   await browser.close();
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin  = require('puppeteer-extra-plugin-stealth');
const { createLogger } = require('./logger');

puppeteerExtra.use(StealthPlugin());

const log = createLogger('browser');

const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY
);

/**
 * Launch a Puppeteer browser instance configured for the current environment.
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function launchBrowser() {
  const args = _baseArgs();
  let executablePath;

  if (IS_SERVERLESS) {
    // ── Vercel / Lambda: use @sparticuz/chromium ──────────────────────────────
    log.info('launching chromium via @sparticuz/chromium (serverless)');
    const chromium = require('@sparticuz/chromium');

    // Chromium needs to decompress itself on first call — this may take a second
    executablePath = await chromium.executablePath();

    // chromium.args already includes all required serverless flags
    args.push(...chromium.args);
  } else if (process.env.PUPPETEER_EXECUTABLE_PATH && process.env.PUPPETEER_EXECUTABLE_PATH.length > 1) {
    // ── Custom path (Docker / Linux with pre-installed Chromium) ─────────────
    log.info(`launching chromium from PUPPETEER_EXECUTABLE_PATH`);
    executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    // ── Local dev: let puppeteer-core auto-detect or use system Chrome ────────
    log.info('launching chromium (local auto-detect)');
    // On local dev, try common macOS/Linux/Windows paths
    executablePath = _detectLocalChrome();
  }

  const launchOpts = {
    headless: true,
    args,
    ...(executablePath ? { executablePath } : {}),
    defaultViewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  };

  try {
    const browser = await puppeteerExtra.launch(launchOpts);
    log.debug('browser launched');
    return browser;
  } catch (err) {
    log.error(`browser launch failed: ${err.message}`);
    throw err;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _baseArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--mute-audio',
    '--safebrowsing-disable-auto-update',
  ];
}

function _detectLocalChrome() {
  const { platform } = process;
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].find(p => { try { require('fs').accessSync(p); return true; } catch { return false; } }) || undefined;
  }
  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  // Linux
  return '/usr/bin/chromium-browser' || '/usr/bin/chromium' || '/usr/bin/google-chrome' || undefined;
}

module.exports = { launchBrowser };
