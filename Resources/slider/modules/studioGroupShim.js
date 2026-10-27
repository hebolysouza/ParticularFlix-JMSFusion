// Fork ParticularFlix: a studio hub that groups several studios (Marvel, DC, Paramount...) opens the native list as
// #/list?studioId=a,b,c (the first id is the hub's own studio). Two things then break if nothing adjusts the requests:
// - the native page fetches the "studio" by the whole value (/Items/a,b,c), the server answers 500 and the page spins;
//   that header request goes out with the first id only, while the list of titles is widened to every id of the group;
// - Jellyfin Enhanced reads studioId from the address for its "More from <studio>" (Seerr) section and asks
//   /JellyfinEnhanced/studio/a,b,c, which fails, so the section never appeared on grouped hubs. It gets the first id.
// Loaded by main.js on every page (also when the list is opened straight from its address) and by studioHubs.js.
const MULTI_ID_ITEM_RE = /(\/Items\/)([0-9a-fA-F]{32})(?:(?:,|%2C)[0-9a-fA-F]{32})+(?=$|[/?#])/i;
const MULTI_ID_ENHANCED_STUDIO_RE = /(\/JellyfinEnhanced\/studio\/)([0-9a-fA-F]{32})(?:(?:,|%2C)[0-9a-fA-F]{32})+(?=$|[/?#])/i;
const SINGLE_STUDIOIDS_RE = /([?&]StudioIds=)([0-9a-fA-F]{32})(?=&|#|$)/i;

function getGroupIdsFromHash() {
  try {
    const m = /[?&]studioId=([^&]+)/i.exec(String(location.hash || ""));
    if (!m) return null;
    const ids = decodeURIComponent(m[1]).split(",").map((x) => x.trim()).filter((x) => /^[0-9a-fA-F]{32}$/.test(x));
    return ids.length > 1 ? ids : null;
  } catch { return null; }
}

function rewriteMultiIdUrl(u) {
  try {
    const str = typeof u === "string" ? u : (u && u.url) ? u.url : String(u || "");
    // Cheap exit for the vast majority of requests (no comma-separated id in them).
    if (str.indexOf(",") < 0 && str.indexOf("%2C") < 0 && str.indexOf("%2c") < 0 && !/StudioIds=/i.test(str)) return null;
    let out = str;
    if (MULTI_ID_ITEM_RE.test(out)) out = out.replace(MULTI_ID_ITEM_RE, "$1$2");
    if (MULTI_ID_ENHANCED_STUDIO_RE.test(out)) out = out.replace(MULTI_ID_ENHANCED_STUDIO_RE, "$1$2");
    if (/\/Items\?/i.test(out) && SINGLE_STUDIOIDS_RE.test(out)) {
      const ids = getGroupIdsFromHash();
      const m = SINGLE_STUDIOIDS_RE.exec(out);
      if (ids && m && ids[0].toLowerCase() === m[2].toLowerCase()) {
        out = out.replace(SINGLE_STUDIOIDS_RE, (_all, pre) => pre + ids.join(","));
      }
    }
    return out === str ? null : out;
  } catch { return null; }
}

(function installStudioGroupRequestShim() {
  try {
    if (window.__jmsStudioGroupShim) return;
    window.__jmsStudioGroupShim = true;
    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (input, init) {
        const fixed = rewriteMultiIdUrl(input);
        if (fixed) {
          input = (typeof input === "string") ? fixed : new Request(fixed, input);
        }
        return origFetch.call(this, input, init);
      };
    }
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      const fixed = rewriteMultiIdUrl(url);
      return origOpen.call(this, method, fixed || url, ...rest);
    };
  } catch {}
})();
