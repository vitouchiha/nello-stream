
import io

with open('src/loonex/index.js', 'r', encoding='utf-8', errors='ignore') as f:
    c = f.read()

c = c.split('for (const ep of allEpisodes) {')[0]

c += '''for (const ep of allEpisodes) {
      let epNum = extractEpisodeNumber(ep.title);
      if (epNum === null) {
        const m = ep.episodeUrl.match(/_\\\\d+x(\\\\d+)/);
        if (m) epNum = parseInt(m[1], 10);
      }
      if (epNum === effectiveEpisode) {
        if (!hasSeasons) {
          target = ep;
          break;
        }
        const sNum = extractSeasonNumber(ep.seasonTitle);
        if (sNum === effectiveSeason) {
          target = ep;
          break;
        }
      }
    }
    if (!target) { return []; }
    const m3u8 = await getM3U8Url(target.episodeUrl);
    if (!m3u8) return [];

    const stream = {
      name: \Loonex\,
      title: \Loonex - S\ E\\,
      type: \direct\,
      url: m3u8,
      behaviorHints: { notWebReady: true, bingeGroup: \loonex-\\ },
      addonBaseUrl: providerContext?.addonBaseUrl
    };
    return [formatStream(stream, \Loonex\)].filter(Boolean);
  } catch (error) {
    return [];
  }
}
module.exports = { getStreams };
'''

with open('src/loonex/index.js', 'w', encoding='utf-8') as f:
    f.write(c)


