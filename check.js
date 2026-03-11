const {fetchWithAxios}=require('./src/utils/fetcher.js');
const cheerio=require('cheerio');
fetchWithAxios('https://toonitalia.xyz/?s=Guru+Guru', {responseType:'text'}).then(d=>{
const $ = cheerio.load(d);
.each((_,el)=>console.log(.text(), .attr('href')));
});