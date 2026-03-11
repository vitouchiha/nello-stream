const {fetchWithAxios}=require('./src/utils/fetcher.js');
const cheerio=require('cheerio');
fetchWithAxios('https://toonitalia.xyz/?s=Guru+Guru', {responseType:'text'}).then(d=>{
const $ = cheerio.load(d);
$('article h2.entry-title a').each((_,el)=>console.log($(el).text(), $(el).attr('href')));
});