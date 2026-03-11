'use strict';

/**
 * Test script: decode safego captcha image (tiny PNG) and OCR digits
 * using pure Node.js (no external packages, just zlib + Buffer)
 */

const zlib = require('zlib');

/**
 * Decode a raw PNG Buffer into { width, height, pixels[] } where
 * pixels is a flat array of grayscale values (0=black, 255=white).
 */
function decodePng(buf) {
  // Skip PNG magic (8 bytes)
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];

  while (offset < buf.length) {
    const chunkLen = buf.readUInt32BE(offset); offset += 4;
    const chunkType = buf.slice(offset, offset + 4).toString('ascii'); offset += 4;
    const chunkData = buf.slice(offset, offset + chunkLen); offset += chunkLen;
    offset += 4; // skip CRC

    if (chunkType === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
      console.log(`PNG dims: ${width}x${height}, bitDepth=${bitDepth}, colorType=${colorType}`);
    } else if (chunkType === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (chunkType === 'IEND') {
      break;
    }
  }

  const idatData = zlib.inflateSync(Buffer.concat(idatChunks));
  // colorType 0 = grayscale, 2 = RGB, 4 = grayscale+alpha, 6 = RGBA
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  let bytesPerPixel = Math.ceil((bitDepth * channels) / 8);

  // Each scanline starts with a filter byte
  const pixels = new Uint8Array(width * height);
  let prev = new Uint8Array(width * bytesPerPixel);

  for (let y = 0; y < height; y++) {
    const filterType = idatData[y * (1 + width * bytesPerPixel)];
    const raw = new Uint8Array(width * bytesPerPixel);

    for (let x = 0; x < width * bytesPerPixel; x++) {
      const rawByte = idatData[y * (1 + width * bytesPerPixel) + 1 + x];
      const prevByte = prev[x] || 0;
      let val;
      if (filterType === 0) val = rawByte;
      else if (filterType === 1) val = rawByte + (x >= bytesPerPixel ? raw[x - bytesPerPixel] : 0);
      else if (filterType === 2) val = rawByte + prevByte;
      else if (filterType === 3) val = rawByte + Math.floor(((x >= bytesPerPixel ? raw[x - bytesPerPixel] : 0) + prevByte) / 2);
      else val = rawByte; // simplified paeth
      raw[x] = val & 0xFF;
    }
    prev = raw;

    for (let x = 0; x < width; x++) {
      // Convert to grayscale
      let gray;
      if (channels === 1) gray = raw[x];
      else if (channels === 3) gray = Math.round(0.299 * raw[x*3] + 0.587 * raw[x*3+1] + 0.114 * raw[x*3+2]);
      else if (channels === 4) gray = Math.round(0.299 * raw[x*4] + 0.587 * raw[x*4+1] + 0.114 * raw[x*4+2]);
      else gray = raw[x];
      pixels[y * width + x] = gray;
    }
  }

  return { width, height, pixels };
}

/**
 * Print the image as ASCII art for visual inspection
 */
function asciiArt(width, height, pixels, threshold = 128) {
  const lines = [];
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) {
      line += pixels[y * width + x] < threshold ? '#' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

async function main() {
  const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0';
  // Use a fresh safego URL
  const safego = 'https://safego.cc/safe.php?url=YmZ2RlNqRHMwckM0YU1XdVpoQWMxSEJQeEEwM21WcGpvRkIrYWJvZ09kTllMLzBxN0wrU3U1NUVoWGVXblQ0Q0FrbTFJOGhlTWFmVGdyeThGSkR3UVE9PQ==';

  const r = await fetch(safego, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie') || '';
  const phpsessid = (setCookie.match(/PHPSESSID=([^;]+)/) || [])[1] || '';
  console.log('PHPSESSID:', phpsessid);

  const html = await r.text();
  const imgMatch = html.match(/src="(data:image\/png;base64,([^"]+))"/i);
  if (!imgMatch) { console.log('No captcha image found'); return; }

  const b64data = imgMatch[2];
  console.log('Image b64 length:', b64data.length);

  const imgBuf = Buffer.from(b64data, 'base64');
  const { width, height, pixels } = decodePng(imgBuf);

  console.log('\nASCII Art of captcha:');
  console.log(asciiArt(width, height, pixels));
}

main().catch(e => console.error('ERROR:', e.message, e.stack));
