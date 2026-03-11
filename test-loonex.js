const { getStreams } = require("./src/loonex"); (async () => { console.log(await getStreams("tt3718778", "series", 1, 1, { meta: { name: "Over the garden wall" } })); })();
