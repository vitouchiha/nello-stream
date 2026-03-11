const fs=require('fs'); let c=fs.readFileSync('src/loonex/index.js','utf8'); c=c.split('for (const ep of allEpisodes) {')[0] + \or (const ep of allEpisodes) {
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
      name: \\Loonex\\,
      title: \\Loonex - S\\$\\{effectiveSeason\\} E\\$\\{effectiveEpisode\\}\\,
      type: \\direct\\,
      url: m3u8,
      behaviorHints: { notWebReady: true, bingeGroup: \\loonex-\\$\\{serie.normalizedTitle\\}\\ },
      addonBaseUrl: providerContext?.addonBaseUrl
    };
    return [formatStream(stream, \\Loonex\\)].filter(Boolean);
  } catch (error) {
    return [];
  }
}
module.exports = { getStreams };
\; fs.writeFileSync('src/loonex/index.js', c);
