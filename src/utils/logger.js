'use strict';

/**
 * Enhanced Structured Logger for StreamFusion Mail
 *
 * Features:
 *   - JSON lines in production, human-readable in dev
 *   - Configurable log level via LOG_LEVEL env var
 *   - Request correlation via optional requestId
 *   - Performance timing helpers
 *   - Rotating in-memory log buffer for /api/system/logs endpoint
 *   - Error categorization for alerts
 */

const IS_PROD = process.env.NODE_ENV === 'production';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

// ── In-memory circular buffer for recent logs ─────────────────────────────────
const LOG_BUFFER_MAX = 500;
const _logBuffer = [];

function _pushBuffer(entry) {
  _logBuffer.push(entry);
  if (_logBuffer.length > LOG_BUFFER_MAX) _logBuffer.shift();
}

function _emit(level, tag, message, extra) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const ts = new Date().toISOString();
  const entry = { ts, level, tag, message, ...extra };

  _pushBuffer(entry);

  if (IS_PROD) {
    const line = JSON.stringify(entry);
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
    /**
     * Start a performance timer. Returns a function to call when done.
     * @param {string} label
     * @returns {Function}  Call with optional extra data to log elapsed time.
     */
    time: (label) => {
      const t0 = Date.now();
      return (extra = {}) => {
        const ms = Date.now() - t0;
        _emit('info', tag, `${label} completed`, { ...extra, ms });
        return ms;
      };
    },
  };
}

/**
 * Get recent log entries from the circular buffer.
 * @param {object} [opts]
 * @param {string} [opts.level]  Filter by minimum level
 * @param {string} [opts.tag]    Filter by tag
 * @param {number} [opts.limit]  Max entries to return (default: 100)
 * @returns {object[]}
 */
function getRecentLogs(opts = {}) {
  let logs = [..._logBuffer];

  if (opts.level && LEVELS[opts.level] != null) {
    const minLvl = LEVELS[opts.level];
    logs = logs.filter(e => LEVELS[e.level] >= minLvl);
  }
  if (opts.tag) {
    logs = logs.filter(e => e.tag === opts.tag);
  }

  const limit = opts.limit || 100;
  return logs.slice(-limit);
}

/**
 * Get error summary — count of errors/warns in the last N minutes.
 * @param {number} [minutesBack=60]
 * @returns {{ errors: number, warnings: number, topTags: Object }}
 */
function getErrorSummary(minutesBack = 60) {
  const cutoff = Date.now() - minutesBack * 60_000;
  const recent = _logBuffer.filter(e => new Date(e.ts).getTime() >= cutoff);

  const errors = recent.filter(e => e.level === 'error').length;
  const warnings = recent.filter(e => e.level === 'warn').length;

  const tagCounts = {};
  for (const e of recent.filter(e => e.level === 'error' || e.level === 'warn')) {
    tagCounts[e.tag] = (tagCounts[e.tag] || 0) + 1;
  }

  return { errors, warnings, topTags: tagCounts };
}

module.exports = { createLogger, getRecentLogs, getErrorSummary };
