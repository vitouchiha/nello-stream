'use strict';
const zlib = require('zlib');
// Copy of the decode+OCR logic from turbovidda.js for debugging

const SAFEGO_URL = 'https://safego.cc/safe.php?url=YmZ2RlNqRHMwckM0YU1XdVpoQWMxSEJQeEEwM21WcGpvRkIrYWJvZ09kTllMLzBxN0wrU3U1NUVoWGVXblQ0Q0FrbTFJOGhlTWFmVGdyeThGSkR3UVE9PQ==';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0';

function decodePng(buf) {
  let off = 8, w = 0, h = 0, bt = 0, ct = 0;
  const idats = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); off += 4;
    const type = buf.slice(off, off+4).toString('ascii'); off += 4;
    const d = buf.slice(off, off+len); off += len + 4;
    if (type === 'IHDR') { w=d.readUInt32BE(0); h=d.readUInt32BE(4); bt=d[8]; ct=d[9]; }
    else if (type === 'IDAT') idats.push(d);
    else if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const ch = [0,0,3,0,2,0,4][ct]||1;
  const bpp = Math.ceil(bt*ch/8);
  const stride = 1+w*bpp;
  const px = new Uint8Array(w*h);
  let prev = new Uint8Array(w*bpp);
  for (let y=0;y<h;y++) {
    const ft=raw[y*stride]; const cur=new Uint8Array(w*bpp);
    for (let i=0;i<w*bpp;i++) {
      const b=raw[y*stride+1+i],a=i>=bpp?cur[i-bpp]:0,c=(i>=bpp&&y>0)?prev[i-bpp]:0,p=prev[i];
      let v;
      if(ft===0)v=b;else if(ft===1)v=b+a;else if(ft===2)v=b+p;else if(ft===3)v=b+Math.floor((a+p)/2);
      else{const pa=Math.abs(p-c),pb=Math.abs(a-c),pc=Math.abs(a+p-2*c);v=b+(pa<=pb&&pa<=pc?a:pb<=pc?p:c);}
      cur[i]=v&0xFF;
    }
    prev=cur;
    for(let x=0;x<w;x++){const r=cur[x*bpp],g=ch>=3?cur[x*bpp+1]:r,bv=ch>=3?cur[x*bpp+2]:r;px[y*w+x]=Math.round(0.299*r+0.587*g+0.114*bv);}
  }
  return {w,h,px};
}

function analyzeDigit(px, w, s, e, threshold=128) {
  const dw = e-s+1;
  const rowDark = new Float32Array(30);
  for (let y=0;y<30;y++){let d=0;for(let x=s;x<=e;x++) if(px[y*w+x]<threshold)d++;rowDark[y]=d/dw;}
  let top=0,bot=29;
  for(let y=0;y<30;y++){if(rowDark[y]>0.1){top=y;break;}}
  for(let y=29;y>=0;y--){if(rowDark[y]>0.1){bot=y;break;}}
  const dh=bot-top+1;
  const t1=top+Math.floor(dh/3),t2=top+Math.floor(2*dh/3);
  const mid=Math.floor((s+e)/2);
  const profile={};
  for(const [zi,[ya,yb]] of [['T',[top,t1]],['M',[t1+1,t2]],['B',[t2+1,bot]]]){
    let L=0,R=0,cnt=0;
    for(let y=ya;y<=yb;y++){for(let x=s;x<=e;x++){if(px[y*w+x]<threshold){if(x<=mid)L++;else R++;}cnt++;}}
    profile[zi+'L']=L/(cnt/2+0.01);
    profile[zi+'R']=R/(cnt/2+0.01);
  }
  profile.top=top; profile.bot=bot; profile.dh=dh; profile.dw=dw;
  return profile;
}

async function run() {
  const r = await fetch(SAFEGO_URL, { headers: {'User-Agent':UA, Accept:'text/html'}, redirect:'manual' });
  const html = await r.text();
  const m = html.match(/src="data:image\/png;base64,([^"]+)"/i);
  if (!m) { console.log('no PNG'); return; }
  const {w,h,px} = decodePng(Buffer.from(m[1].replace(/\s/g,''),'base64'));
  
  // Col darkness
  const colDark = [];
  for(let x=0;x<w;x++){let d=0;for(let y=0;y<h;y++)if(px[y*w+x]<128)d++;colDark.push(d);}
  console.log('Col darkness:', colDark.join(','));
  
  // Find segments (same logic as turbovidda.js)
  const inDigit = colDark.map(v=>v/h>0.05);
  const segments=[]; let start=-1;
  for(let x=0;x<=w;x++){
    if(x<w&&inDigit[x]&&start<0)start=x;
    else if((x===w||!inDigit[x])&&start>=0){segments.push([start,x-1]);start=-1;}
  }
  const merged=[];
  for(const seg of segments){
    if(merged.length&&seg[0]-merged[merged.length-1][1]<=1)merged[merged.length-1][1]=seg[1];
    else merged.push([...seg]);
  }
  const digits=merged.filter(([s,e])=>e-s>=2);
  console.log('Digit segments:', digits);
  
  for(const [s,e] of digits){
    const p=analyzeDigit(px,w,s,e);
    console.log(`\nDigit [${s}-${e}] (w=${p.dw}, rows=${p.top}-${p.bot}, h=${p.dh}):`);
    console.log(`  TL=${p.TL.toFixed(3)} TR=${p.TR.toFixed(3)}`);
    console.log(`  ML=${p.ML.toFixed(3)} MR=${p.MR.toFixed(3)}`);
    console.log(`  BL=${p.BL.toFixed(3)} BR=${p.BR.toFixed(3)}`);
    
    // Print ASCII of just this digit
    console.log('  ASCII:');
    for(let y=p.top;y<=p.bot;y++){let row='';for(let x=s;x<=e;x++)row+=px[y*w+x]<128?'#':' ';console.log('  '+String(y).padStart(2)+' |'+row+'|');}
  }
}
run().catch(console.error);
