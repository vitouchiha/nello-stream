'use strict';

/**
 * In-memory TTL cache with optional max size (LRU eviction)
 * Drop-in replacement for simple Map-based caches used across providers
 */

class TTLCache {
  /**
   * @param {object} opts
   * @param {number} [opts.ttl=300000]    Default TTL in ms (5 min)
   * @param {number} [opts.maxSize=500]   Max entries before LRU eviction
   */
  constructor({ ttl = 300_000, maxSize = 500 } = {}) {
    this._ttl = ttl;
    this._maxSize = maxSize;
    /** @type {Map<string, {value: any, expiresAt: number}>} */
    this._store = new Map();
  }

  /** @param {string} key @returns {any|undefined} */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    // Move to end for LRU
    this._store.delete(key);
    this._store.set(key, entry);
    return entry.value;
  }

  /**
   * @param {string} key
   * @param {any} value
   * @param {number} [ttl]  Override default TTL in ms
   */
  set(key, value, ttl) {
    if (this._store.size > this._maxSize) {
      // Evict oldest entry (first in Map = insertion order)
      const oldest = this._store.keys().next().value;
      this._store.delete(oldest);
    }
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this._ttl),
    });
  }

  /** @param {string} key @returns {boolean} */
  has(key) {
    return this.get(key) !== undefined;
  }

  /** @param {string} key */
  delete(key) {
    this._store.delete(key);
  }

  flush() {
    this._store.clear();
  }

  get size() {
    return this._store.size;
  }
}

module.exports = { TTLCache };
