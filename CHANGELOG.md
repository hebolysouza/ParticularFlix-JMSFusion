# Changelog

This file tracks the changes of the **ParticularFlix fork** of JMSFusion (Jellyfin-MonWUI-Plugin).
The upstream project by G-grbz was archived on 2026-08-19; this fork keeps it working on Jellyfin 10.11.x,
fixes bugs, closes a security hole and makes the home page lighter. License: GPL-3.0, credits to the
original authors (G-grbz and contributors) are kept.

## 3.7.1.0 (fork release, based on upstream 3.7.0.0)

Same plugin GUID as upstream (`c0b4a5e0-2f6a-4e70-9c5f-1e7c2d0b7f12`), so it replaces the upstream plugin in place.
Requires Jellyfin 10.11.x (`targetAbi` 10.11.0.0, net9.0). Auto update is off; updates come from this repository.

### Upgrade notes (read first)

- **Your settings are kept.** Plugin configuration and stored snapshots live in Jellyfin's plugin configuration
  folder, outside the versioned plugin folder, so a version change does not touch them.
- **Every new option defaults to the old behavior.** Nothing changes until you turn it on, except the items listed
  under "On by default".
- **Docker Desktop on Windows:** do not load the 60+ MB plugin DLL from a bind mount. The .NET runtime can read wrong
  memory pages from that kind of mount and the embedded web files arrive corrupted (settings panel does not open,
  `SyntaxError` in `settingsPage.js`). Keep the plugin folder in a local Docker volume, or on a native Linux
  filesystem. After any DLL swap, compare the hash of a large served file (for example `/slider/modules/settingsPage.js`)
  with the repository copy.
- Restart Jellyfin after updating and hard refresh the browser (Ctrl + F5).

### On by default

- "New season" badge on series slides (see below). Disable with `localStorage.setItem('showNewSeasonBadge', 'false')`.
- Gzip/Brotli compression of the `/slider` modules.
- Layer trim: inactive slides, card logos and hidden card buttons no longer keep permanent compositor effects.
  Disable with `localStorage.setItem('jmsLayerTrim', 'off')`.
- Stricter access control on configuration endpoints (see Security).

### New features

- **Slider list sources** (Settings > Slider > Query API > "Slider list source"):
  - "Current releases": titles released recently, ordered by the date they were added to the library.
  - "Recent premieres": a new season counts as a release (so a new season of an old series shows up).
  - Time window in months (default 6). The default source stays the custom query, as before.
- **"New season" badge**: inside the series type chip. If the latest season (2 or higher) premiered in the last 60 days,
  the chip says "New season" in red; older series keep "Series (N Seasons)". Translated in 9 languages.
  Optional keys: `showNewSeasonBadge`, `newSeasonBadgeDays`.
- **Independent settings per Jellyfin profile**: one snapshot per user, and desktop and mobile are separate profiles
  (mobile means touch or a narrow window with a mobile user agent). With "force global user settings" on, only the
  admin writes the global snapshot.
- **Hover trailer controls** (new "Hover" tab): open mode (hover, click only, off), open delay (200 to 3000 ms),
  an "i" details button on cards, a trailer button on cards, button position (8 places) and icon (clapperboard,
  film reel, screen, camera or "Trailer" text). In click-only mode the release applies only to the clicked card.
- **Notification bell**: choose whether the panel opens on hover or only on click.
- **Studio hubs**: studio alias lookups run in parallel and "studio not found" answers are cached for 6 hours.

### Security

- Upstream 3.7.0.0 answered `/JMSFusion/config` without login with the whole plugin configuration, and writes were
  possible without login. In this fork configuration endpoints return a version without secrets to non-admins, and
  saving configuration, patch, unpatch, environment, trailers and lyrics actions require an administrator.
- The user identity is read only from the Jellyfin authentication claims. The forgeable `X-Emby-UserId` header is no longer
  trusted.

### Performance

Measured with Chrome DevTools on a real library, all changes are about keeping the main thread free during scrolling:

- Module compression: JavaScript served by the plugin went from about 5.2 MB to about 2.5 MB.
- `getConfig()` is cached for up to 1 s with invalidation on storage changes (about 4.1 s down to about 0.4 s of JS per capture).
- Slider header offset: CSS lengths cached, sync at most every 120 ms.
- Home scroll tracker: reuses the scrollable element list, groups mutations, limits checks to one per 100 ms.
- Many MutationObservers that re-read the whole configuration now run once per 120 to 250 ms.
- Rows render in smaller slices and use idle time; subtitle customizer does nothing outside the player.
- Trailer modal: heavy DOM cleanup on close runs in idle time, and the stylesheet scan for `will-change`
  (about 0.8 s of JS in one trace) now runs once per sheet.
- Slider logos are requested at the size they are displayed (`maxHeight=300`) instead of the full original (up to 881 KB each).
- Fewer composited layers: inactive slides and card logo shadows no longer create permanent layers.
- Mobile: media query results used for the low power check are cached for 10 s.
- Seerr search bridge only looks for the search field on the search route.

### Fixes

- Slider: the freshly built list is no longer compacted by the cache (it lost its dates on reload) and the image
  filter is applied while the list is built.
- Click-only hover mode no longer opens other covers by itself right after using a trailer.

### Known limitations

- The loader still depends on Jellyfin web internals; compatibility with Jellyfin 10.12 or newer is not tested.
- Rows below the fold load progressively while scrolling (on purpose, to keep scrolling smooth).
