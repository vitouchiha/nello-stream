'use strict';
const zlib = require('zlib');

const SAFEGO_URL = 'https://safego.cc/safe.php?url=YmZ2RlNqRHMwckM0YU1XdVpoQWMxSEJQeEEwM21WcGpvRkIrYWJvZ09kTllMLzBxN0wrU3U1NUVoWGVXblQ0Q0FrbTFJOGhlTWFmVGdyeThGSkR3UVE9PQ==';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0';

async function run() {
  const r = await fetch(SAFEGO_URL, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'manual',
  });
  const sc = r.headers.get('set-cookie') || '';
  const sessid = (sc.match(/PHPSESSID=([^;]+)/) || [])[1];
  console.log('PHPSESSID:', sessid);
  const html = await r.text();
  const m = html.match(/src="data:image\/png;base64,([^"]+)"/i);
  if (!m) { console.log('No PNG found'); return; }
  const b64 = m[1].replace(/\s/g, '');
  console.log('PNG base64 length:', b64.length);
  const buf = Buffer.from(b64, 'base64');

  // Decode PNG
  let off = 8, w = 0, h = 0, bt = 0, ct = 0;
  const idatBufs = [];
  while (off < buf.length) {
    const clen = buf.readUInt32BE(off); off += 4;
    const type = buf.slice(off, off + 4).toString('ascii'); off += 4;
    const data = buf.slice(off, off + clen); off += clen + 4;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bt = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idatBufs.push(data);
    else if (type === 'IEND') break;
  }
  console.log(`PNG: ${w}x${h} bitDepth=${bt} colorType=${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idatBufs));
  const channels = [0, 0, 3, 0, 2, 0, 4][ct] || 1;
  const bpp = Math.ceil(bt * channels / 8);
  const stride = 1 + w * bpp;
  const gray = new Uint8Array(w * h);
  let prev = new Uint8Array(w * bpp);

  for (let y = 0; y < h; y++) {
    const ft = raw[y * stride];
    const cur = new Uint8Array(w * bpp);
    for (let i = 0; i < w * bpp; i++) {
      const b = raw[y * stride + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const c = (i >= bpp && y > 0) ? prev[i - bpp] : 0;
      const p = prev[i];
      let v;
      if (ft === 0) v = b;
      else if (ft === 1) v = b + a;
      else if (ft === 2) v = b + p;
      else if (ft === 3) v = b + Math.floor((a + p) / 2);
      else {
        const pa = Math.abs(p - c), pb = Math.abs(a - c), pc = Math.abs(a + p - 2 * c);
        v = b + (pa <= pb && pa <= pc ? a : pb <= pc ? p : c);
      }
      cur[i] = v & 0xFF;
    }
    prev = cur;
    for (let x = 0; x < w; x++) {
      const ri = cur[x * bpp];
      const gi = channels >= 3 ? cur[x * bpp + 1] : ri;
      const bv = channels >= 3 ? cur[x * bpp + 2] : ri;
      gray[y * w + x] = Math.round(0.299 * ri + 0.587 * gi + 0.114 * bv);
    }
  }

  // Row darkness profile
  console.log('\nRow darkness profile (dark = pixel < 128):');
  for (let y = 0; y < h; y++) {
    let d = 0;
    for (let x = 0; x < w; x++) if (gray[y * w + x] < 128) d++;
    const bar = '#'.repeat(Math.round(d / w * 40));
    console.log(`row${String(y).padStart(2, '0')} (${String(d).padStart(2)}/${w}): ${bar}`);
  }

  // Col darkness profile
  console.log('\nCol darkness (each col, dark count):');
  const colDark = [];
  for (let x = 0; x < w; x++) {
    let d = 0;
    for (let y = 0; y < h; y++) if (gray[y * w + x] < 128) d++;
    colDark.push(d);
  }
  console.log(colDark.join(','));

  // ASCII art of full image
  console.log('\nASCII art (threshold=128):');
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += gray[y * w + x] < 128 ? '#' : ' ';
    console.log(`${String(y).padStart(2,'0')}|${row}|`);
  }

  // RGB values of first 3 pixels of each row (to understand color encoding)
  console.log('\nFirst 3 pixels RGB each row:');
  for (let y = 0; y < h; y++) {
    const off2 = y * stride + 1;
    const pixels = [];
    for (let i = 0; i < 3; i++) {
      const ri = raw[off2 + i * bpp] || 0;
      const gi = channels >= 3 ? (raw[off2 + i * bpp + 1] || 0) : ri;
      const bv = channels >= 3 ? (raw[off2 + i * bpp + 2] || 0) : ri;
      pixels.push(`(${ri},${gi},${bv})`);
    }
    console.log(`row${y}: ${pixels.join(' ')}`);
  }
}

run().catch(console.error);
