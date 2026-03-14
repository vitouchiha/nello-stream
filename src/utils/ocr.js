'use strict';

/**
 * Lightweight OCR for 3-digit captcha images (uprot, safego).
 * Ported from cfworker.js bitmap-template engine.
 * Pure JS — no external dependencies.
 */

const zlib = require('zlib');

// ── Bitmap-based digit templates (calibrated from real captcha images) ────────
const _BITMAP_TEMPLATES = {
  '0': '...##...|..####..|.##..##.|##....##|##....##|##....##|##....##|.##..##.|..####..|...##...',
  '1': '..##|.###|####|..##|..##|..##|..##|..##|..##|####',
  '2': '..####..|.##..##.|##....##|......##|.....##.|....##..|...##...|..##....|.##.....|########',
  '3': '.#####..|##...##.|......##|.....##.|...###..|.....##.|......##|......##|##...##.|.#####..',
  '4': '.....##|....###|...####|..##.##|.##..##|##...##|#######|.....##|.....##|.....##',
  '5': '#######.|##......|##......|##.###..|###..##.|......##|......##|##....##|.##..##.|..####..',
  '6': '..####..|.##..##.|##....#.|##......|##.###..|###..##.|##....##|##....##|.##..##.|..####..',
  '7': '########|......##|......##|.....##.|....##..|...##...|..##....|.##.....|##......|##......',
  '8': '..####..|.##..##.|##....##|.##..##.|..####..|.##..##.|##....##|##....##|.##..##.|..####..',
  '9': '..####..|.##..##.|##....##|##....##|.##..###|..###.##|......##|.#....##|.##..##.|..####..',
};

/**
 * Decode a PNG from Buffer/Uint8Array into { width, height, pixels } (grayscale 0-255).
 */
function decodePngGrayscale(buf) {
  const arr = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
  const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  let offset = 8; // skip PNG magic
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];

  while (offset < arr.length) {
    const chunkLen = view.getUint32(offset); offset += 4;
    const type = String.fromCharCode(arr[offset], arr[offset+1], arr[offset+2], arr[offset+3]); offset += 4;
    const data = arr.slice(offset, offset + chunkLen); offset += chunkLen + 4;
    if (type === 'IHDR') {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(0); height = dv.getUint32(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') break;
  }

  // Concat IDAT chunks
  let idatTotal = 0;
  for (const c of idatChunks) idatTotal += c.length;
  const idat = new Uint8Array(idatTotal);
  let io = 0;
  for (const c of idatChunks) { idat.set(c, io); io += c.length; }

  // Inflate using Node.js zlib
  const raw = new Uint8Array(zlib.inflateSync(Buffer.from(idat)));

  const channels = [0, 0, 3, 0, 2, 0, 4][colorType] || 1;
  const bpp = Math.ceil((bitDepth * channels) / 8);
  const stride = 1 + width * bpp;
  const pixels = new Uint8Array(width * height);
  let prev = new Uint8Array(width * bpp);

  for (let y = 0; y < height; y++) {
    const ft = raw[y * stride];
    const cur = new Uint8Array(width * bpp);
    for (let i = 0; i < width * bpp; i++) {
      const b = raw[y * stride + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const c = (i >= bpp && y > 0) ? prev[i - bpp] : 0;
      const p = prev[i];
      let v;
      if (ft === 0) v = b;
      else if (ft === 1) v = b + a;
      else if (ft === 2) v = b + p;
      else if (ft === 3) v = b + Math.floor((a + p) / 2);
      else { const pa = Math.abs(p - c), pb = Math.abs(a - c), pc = Math.abs(a + p - 2 * c); v = b + (pa <= pb && pa <= pc ? a : pb <= pc ? p : c); }
      cur[i] = v & 0xFF;
    }
    prev = cur;
    for (let x = 0; x < width; x++) {
      const r = cur[x * bpp], g = channels >= 3 ? cur[x * bpp + 1] : r, bv = channels >= 3 ? cur[x * bpp + 2] : r;
      pixels[y * width + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * bv);
    }
  }
  return { width, height, pixels };
}

/**
 * OCR digits from grayscale pixel array using bitmap template matching.
 * Returns digit string (e.g. "482") or null.
 */
function ocrDigitsFromPixels(width, height, pixels, threshold = 128) {
  const colDark = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = 0; y < height; y++) { if (pixels[y * width + x] < threshold) dark++; }
    colDark[x] = dark / height;
  }
  const inDigit = Array.from(colDark, v => v > 0.05);
  const segments = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    if (inDigit[x] && start < 0) start = x;
    else if (!inDigit[x] && start >= 0) { segments.push([start, x - 1]); start = -1; }
  }
  const merged = [];
  for (const seg of segments) {
    if (merged.length && seg[0] - merged[merged.length - 1][1] <= 1) {
      merged[merged.length - 1][1] = seg[1];
    } else merged.push([...seg]);
  }
  const digits = merged.filter(([s, e]) => e - s >= 2);
  if (!digits.length) return null;

  let result = '';
  for (const [s, e] of digits) {
    let top = -1, bot = -1;
    for (let y = 0; y < height; y++) {
      let d = 0; for (let x = s; x <= e; x++) if (pixels[y * width + x] < threshold) d++;
      if (d > 0) { if (top < 0) top = y; bot = y; }
    }
    if (top < 0) continue;
    const rows = [];
    for (let y = top; y <= bot; y++) {
      let row = '';
      for (let x = s; x <= e; x++) row += pixels[y * width + x] < threshold ? '#' : '.';
      rows.push(row);
    }
    const key = rows.join('|');
    let matched = null;
    for (const [ch, tmpl] of Object.entries(_BITMAP_TEMPLATES)) {
      if (tmpl === key) { matched = ch; break; }
    }
    if (!matched) {
      let best = '?', bestDist = Infinity;
      for (const [ch, tmpl] of Object.entries(_BITMAP_TEMPLATES)) {
        const t = tmpl.replace(/\|/g, '');
        const k = key.replace(/\|/g, '');
        if (t.length !== k.length) continue;
        let dist = 0;
        for (let i = 0; i < t.length; i++) if (t[i] !== k[i]) dist++;
        if (dist < bestDist) { bestDist = dist; best = ch; }
      }
      matched = bestDist <= 12 ? best : '?';
    }
    result += matched;
  }
  return result || null;
}

module.exports = { decodePngGrayscale, ocrDigitsFromPixels, encodePngGrayscale, preprocessCaptcha };

/**
 * Encode grayscale pixel data back to PNG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels  grayscale values 0-255 (length = width*height)
 * @returns {Buffer}  PNG file
 */
function encodePngGrayscale(width, height, pixels) {
  // Build filtered scanlines (filter type 0 = None)
  const filtered = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + width)] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      filtered[y * (1 + width) + 1 + x] = pixels[y * width + x];
    }
  }
  const compressed = zlib.deflateSync(filtered);

  // CRC32
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }
  function pngChunk(type, data) {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy ? data.copy(buf, 8) : Buffer.from(data).copy(buf, 8);
    buf.writeUInt32BE(crc32(buf.subarray(4, 8 + data.length)), 8 + data.length);
    return buf;
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 0; // grayscale

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Preprocess a captcha image for better OCR:
 * 1. Binarize (strong threshold to keep only darkest pixels = digits)
 * 2. Remove isolated noise pixels (require ≥2 dark neighbors)
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels  grayscale 0-255
 * @param {number} [threshold=80]
 * @returns {Uint8Array}  cleaned pixels (0=black, 255=white)
 */
function preprocessCaptcha(width, height, pixels, threshold = 80) {
  const out = new Uint8Array(width * height).fill(255);
  // Binarize
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i] < threshold) out[i] = 0;
  }
  // Remove isolated pixels (dark pixels with < 2 dark 8-neighbors)
  const cleaned = new Uint8Array(out);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (out[y * width + x] !== 0) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue;
          if (out[(y + dy) * width + (x + dx)] === 0) n++;
        }
      }
      if (n < 2) cleaned[y * width + x] = 255;
    }
  }
  return cleaned;
}
