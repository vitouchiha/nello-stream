const fs = require('fs');
let text = fs.readFileSync('src/streamingcommunity/index.js', 'utf8');
const searchStr =           // We specifically look for Italian audio, not subtitles (TYPE=AUDIO)
          const hasItalian = /#EXT-X-MEDIA:TYPE=AUDIO.*(?:LANGUAGE=\"it\"|LANGUAGE=\"ita\"|NAME=\"Italian\"|NAME=\"Ita\")/i.test(playlistText);

          const detected = checkQualityFromText(playlistText);
          if (detected) quality = detected;

          // Check if original language is Italian - if so, skip Italian audio verification
          const originalLanguageItalian = metadata && (metadata.original_language === 'it' || metadata.original_language === 'ita');

          if (hasItalian || originalLanguageItalian) {
            console.log(\[StreamingCommunity] Verified: Has Italian audio or original language is Italian.\);
          } else {
            console.log(\[StreamingCommunity] No Italian audio found in playlist and original language is not Italian. Skipping.\);
            return [];
          };

const replaceStr =           // We look for Italian audio AND subtitles, since K-Dramas have Italian Subs but Korean Audio
          const hasItalian = /#EXT-X-MEDIA.*(?:LANGUAGE=\"it\"|LANGUAGE=\"ita\"|NAME=\"Italian\"|NAME=\"Ita\"|NAME=\"sub ita\")/i.test(playlistText);

          const detected = checkQualityFromText(playlistText);
          if (detected) quality = detected;

          const originalLanguageItalian = metadata && (metadata.original_language === 'it' || metadata.original_language === 'ita');

          if (hasItalian || originalLanguageItalian) {
            console.log(\[StreamingCommunity] Verified: Has Italian audio/subs or original is Italian.\);
          } else {
            console.log(\[StreamingCommunity] No explicit Italian tags. Allowing it for K-Dramas.\);
          };

text = text.replace(searchStr.replace(/\r\n/g, '\n'), replaceStr.replace(/\r\n/g, '\n'));
// also handle potential \r\n in the file
text = text.replace(searchStr, replaceStr);
fs.writeFileSync('src/streamingcommunity/index.js', text);
console.log(text.includes('No explicit Italian tags') ? 'Success' : 'Failed');
