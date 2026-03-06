'use strict';

/**
 * KissKH subtitle decryption
 * Handles AES-128-CBC encrypted .txt1 / .txt subtitle files from kisskh.co
 *
 * Three known key/IV pairs are tried in sequence until one produces valid text.
 * Also handles base64-encoded line-by-line encryption format and static buffer decryption.
 */

const crypto = require('crypto');

// Known key/IV pairs for kisskh subtitle encryption
const KEYS = [
  { key: Buffer.from('8056483646328763'), iv: Buffer.from('6852612370185273') },
  { key: Buffer.from('AmSmZVcH93UQUezi'), iv: Buffer.from('ReBKWW8cqdjPEnF6') },
  { key: Buffer.from('sWODXX04QRTkHdlZ'), iv: Buffer.from('8pwhapJeC4hrS9hO') },
];

const BASE64_LINE = /^[A-Za-z0-9+/=]{16,}$/;
const TEXT_VALID = /[a-zA-Zà-ÿÀ-Ÿ\s]/;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Decrypt a full SRT text where subtitle-content lines may be base64-AES encoded.
 * @param {string} srtText
 * @returns {string}
 */
function decryptKisskhSubtitleFull(srtText) {
  let result = srtText
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (BASE64_LINE.test(trimmed)) {
        return _decryptLine(trimmed);
      }
      return line;
    })
    .join('\n');

  result = _decodeHtmlEntities(result);
  result = result.replace(/\r?\n/g, '\r\n');
  return result;
}

/**
 * Decrypt a raw Buffer using a specific key/IV (static variant).
 * @param {Buffer} buffer
 * @param {Buffer} key
 * @param {Buffer} iv
 * @returns {string|null}
 */
function decryptKisskhSubtitleStatic(buffer, key, iv) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(buffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    return null;
  }
}

/**
 * Decode HTML entities in a string.
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  return _decodeHtmlEntities(text);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function _decryptLine(line) {
  for (const { key, iv } of KEYS) {
    try {
      const buf = Buffer.from(line, 'base64');
      if (buf.length < 8) continue;
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(true);
      let dec = decipher.update(buf);
      dec = Buffer.concat([dec, decipher.final()]);
      const text = dec.toString('utf8').trim();
      if (TEXT_VALID.test(text)) return text;
    } catch (_) {
      continue;
    }
  }
  return line; // Return original if no key works
}

function _decodeHtmlEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

module.exports = {
  decryptKisskhSubtitleFull,
  decryptKisskhSubtitleStatic,
  decodeHtmlEntities,
};
