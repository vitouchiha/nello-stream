const {fetchWithAxios}=require('./src/utils/fetcher.js');
const cheerio=require('cheerio');
fetchWithAxios('https://toonitalia.xyz/?s=guru+guru+il+girotondo+della+magia', {responseType:'text'}).then(d=>{
const $ = cheerio.load(d);
article h2.entry-title a.each((_,el)=>console.log(.text(), .attr('href')));
});
