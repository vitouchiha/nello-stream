async function test() {
  const UA = "Mozilla/5.0";
  const base = "https://eurostream.ing";
  const postResp = await fetch(base + "/wp-json/wp/v2/posts/132934?_fields=content,title", {headers:{"User-Agent":UA}});
  const postData = await postResp.json();
  const description = postData.content.rendered;
  const yearMatch = /(?<![\/\-])(19|20)\d{2}(?![\/\-])/.exec(description);
  console.log("Year found:", yearMatch ? yearMatch[0] : "none");
  const season = 1, ep = "01";
  const reStr = "\\b" + season + "&#215;" + ep + "\\s*(.*?)(?=<br\\s*/?>)";
  const re = new RegExp(reStr, "gis");
  const matches = [...description.matchAll(re)];
  console.log("Episode matches:", matches.length);
  if (matches.length > 0) {
    const matchText = matches[0][1] || "";
    const parts = matchText.split(/\s*[–\-]\s*/u);
    const atag = parts.length > 1 ? parts.slice(1).join(" – ") : matchText;
    console.log("atag snippet:", atag.substring(0, 500));
    console.log("hasDeltaBit:", /DeltaBit/i.test(atag));
    console.log("hasMixDrop:", /MixDrop/i.test(atag));
    console.log("hasMaxStream:", /MaxStream/i.test(atag));
    const hrere = new RegExp('<a\\s[^>]*href="([^"]+)"[^>]*>\\s*DeltaBit\\s*<\\/a>', "i");
    const hm = hrere.exec(atag);
    console.log("DeltaBit href:", hm ? hm[1] : "NOT FOUND");
    const hreremix = new RegExp('<a\\s[^>]*href="([^"]+)"[^>]*>\\s*MixDrop\\s*<\\/a>', "i");
    const hmix = hreremix.exec(atag);
    console.log("MixDrop href:", hmix ? hmix[1] : "NOT FOUND");

    // Now test resolveHostLink logic
    if (hm) {
      console.log("\n--- Testing redirect chain for DeltaBit link ---");
      let current = hm[1];
      for (let i = 0; i < 6; i++) {
        if (/turbovid|deltabit|mixdrop|m1xdrop|maxstream/i.test(current)) {
          console.log("Recognized host at hop", i, ":", current);
          break;
        }
        if (/safego/i.test(current)) { console.log("Safego at hop", i, ":", current); break; }
        try {
          const r = await fetch(current, { headers: { "User-Agent": UA, "Range": "bytes=0-0" }, redirect: "manual" });
          console.log("Hop", i, "status:", r.status, "location:", r.headers.get("location"));
          const loc = r.headers.get("location");
          if (!loc) { console.log("No redirect, final:", current); break; }
          current = new URL(loc, current).href;
          console.log("Hop", i, "→", current);
        } catch(e) { console.log("Hop error:", e.message); break; }
      }
    }
  }
}
test().catch(e => console.error(e.message));
