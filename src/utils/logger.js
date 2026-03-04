'use strict';

/**
 * Structured logger for StreamFusion Mail
 * Outputs JSON lines in production, human-readable in dev
 */

const IS_PROD = process.env.NODE_ENV === 'production';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function _emit(level, tag, message, extra) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const ts = new Date().toISOString();
  if (IS_PROD) {
    const line = JSON.stringify({ ts, level, tag, message, ...extra });
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  } else {
    const prefix = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${tag}]`;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (extra && Object.keys(extra).length) {
      fn(prefix, message, extra);
    } else {
      fn(prefix, message);
    }
  }
}

function createLogger(tag) {
  return {
    debug: (msg, extra = {}) => _emit('debug', tag, msg, extra),
    info: (msg, extra = {}) => _emit('info', tag, msg, extra),
    warn: (msg, extra = {}) => _emit('warn', tag, msg, extra),
    error: (msg, extra = {}) => _emit('error', tag, msg, extra),
  };
}

module.exports = { createLogger };
