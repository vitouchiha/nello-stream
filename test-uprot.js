
async function test() {
  const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0'
  let url = 'https://uprot.net/msf/6npez6v62i37'
  for (let i=0; i<6; i++) {
    const r = await fetch(url, {headers:{'User-Agent':UA}, redirect:'manual'})
    process.stdout.write('Hop'+i+' status='+r.status+' '+url.substring(0,70)+'\n')
    const loc = r.headers.get('location')
    if (!loc) { const html = await r.text(); process.stdout.write('No redirect: '+html.substring(0,200)+'\n'); break; }
    url = new URL(loc, url).href
    process.stdout.write(' -> '+url.substring(0,100)+'\n')
    if (url.includes('maxstream') || url.includes('safego')) break
  }
}
test().catch(e=>process.stderr.write(e.message+'\n'))

