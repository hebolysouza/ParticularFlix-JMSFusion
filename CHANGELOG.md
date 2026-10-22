# Changelog

This file tracks the changes of the **ParticularFlix fork** of JMSFusion (Jellyfin-MonWUI-Plugin).
The upstream project by G-grbz was archived on 2026-08-19; this fork keeps it working on Jellyfin 10.11.x,
fixes bugs, closes a security hole and makes the home page lighter. License: GPL-3.0, credits to the
original authors (G-grbz and contributors) are kept.

## 3.8.2.9 (fork release)

- Studio hubs now group every studio of the same brand: the Paramount Pictures hub also lists items tagged Paramount+ or Paramount Animation, the Marvel Studios hub includes Marvel Enterprises and so on (Pixar, Lucasfilm, Warner, Columbia, Netflix, DreamWorks and DC too). Configurable with `studioHubGroupTokens`; `studioHubGroupMerge: false` turns it off.
- Opening a grouped studio hub no longer hangs: the native list page asked the server for the studio header with all ids at once (HTTP 500); that one request now uses only the first id.
- Home rows start sooner: once the rows are in eager mode the render queue waits at most 300 ms for a section to finish before starting the next one (it used to wait for the full completion, network included). Setting `homeRowsEagerHandoffMs` changes the wait; `0` restores the old behavior.
- Studio hub preview ("Top picks") no longer hides items below the minimum rating or without a rating: when fewer than 5 pass, it is completed with the best remaining items. Hubs whose only items have low ratings are no longer removed.
- The studio list request now asks for up to 2000 studios (was 300).

## 3.8.2.4 (fork release)

- Collections row: when the library is a Collections (BoxSet) library, the recent items query now asks only for BoxSet items instead of scanning everything below it, so the row loads faster.
- Recent rows: when a row is re-rendered with fresh data, the hero card is kept if it is still in the list, which removes the visible image swap ("flick") after scrolling to the row.

## 3.8.2.3 (fork release)

Home-page behaviour fixes (3.8.2.0 to 3.8.2.2 were internal test builds and were never published). Same plugin GUID, no setting changes, nothing to reconfigure.

### Changes

- **Trailer button rebuilt.** The slider's TRAILER button now opens a cinema-style window that plays the item's local trailer in a native video player (YouTube is only the fallback when no local trailer exists or the file cannot be played). It always carries its own styling, so it no longer breaks with the peakslider variant (stars and ratings floating in the middle of the screen). It closes with the X button, ESC (captured on the window, so it works even right after the YouTube frame loads) or a click outside, the rating stars line up, and it pauses the card trailer and the slide timer while open.
- **Slider no longer appears above the visible area after pressing Back.** The browser restores the old scroll position before the slider exists and something re-applies it for about a second, so the slider was mounted far above the viewport and the page only slid back to the top later. The page is now held at the top, frame by frame, during the mount window (it stops as soon as you scroll, click or press a key, or leave the home page), and the header offset is measured as soon as the scroll reaches the top instead of on the next timer burst.
- **TRAILER button also for local-only trailers.** Items that only have a local trailer (no remote URL on the item) now get the button too; it is checked once, on the first hover, reusing the same trailer cache the card preview uses, so slide creation makes no extra requests.
- **Header offset measured at the right time.** The header offset is no longer measured while a page transition (scale or animation) is still running.
- **Slider no longer blurred or cut at the top after navigating (legacy entry).** The header offset is no longer measured while a page transition (scale or animation) is still running, which used to store a wrong offset until a later measurement fixed it.
- **Slider survives tab changes on the home page.** Switching between home tabs (Requests, Calendar, Catalog...) no longer tears down and rebuilds the slider; a health watchdog rebuilds it only if it comes back empty. The "home init pending" flag now expires by itself, so an interrupted start can no longer block every later return to the home page until a reload.
- **Home rows load ahead of scrolling.** The plugin rows (recent movies and series, collections, TMDb, Top 10, upcoming releases, studio hubs) used to fetch their data only when they were about to scroll into view, so they were often still empty when you scrolled. About 0.9 s after the home sections start, all the viewport gates now open and the render queue delivers the rows one at a time, in order, in the background. Turn it off with `homeRowsEagerLoad: false`, or change the delay with `homeRowsEagerDelayMs`.
- **Home section order inside the plugin.** New built-in module that keeps the home sections in the configured order (Continue Watching, Next Up, My Media, ...), re-binding to the current container after every navigation and reacting when another plugin rewrites an inline `order`. The Next Up row is matched by its localized titles too ("Next Up", "Próximo", "A seguir"). Defaults match the ParticularFlix layout; disable with `enforceHomeSectionOrder: false`, customise with `homeSectionOrderSelectors` and `homeSectionOrderTitles`.

## 3.8.1.1 (fork release)

Includes everything that was in the unpublished 3.7.4.0, 3.8.0.0 and 3.8.1.0 builds. Same plugin GUID, no setting changes, nothing to reconfigure.

### Changes

- **Upcoming releases row fixed.** The "Coming soon" / "In theaters" badge is now decided by the release date first, so films already released no longer show as upcoming; the "TMDb 0.0" chip is hidden when there is no score; fallback labels are in English instead of Turkish.
- **Top rank loads faster.** The ranking queries (one per sort mode plus the genre profile) now run in parallel instead of one after another.
- **Fewer requests per slide.** The slider no longer fetches the full details of every slide just to look for a trailer when the item already carries its trailer list.
- **Home rows load in parallel.** Up to three rows (recent movies, recent series, episodes...) now fetch their data at the same time instead of one after another, while still appearing in the planned order. The studio hubs fetch their manual collections, visibility and hover videos concurrently, and the settings publish no longer competes with the first slide for the server.
- **Timing marks per row** (`jms:row:*`, `jms:studio:*`) so slow rows can be measured in production.
- **Automatic native trailers (replaces the external Windows script and its scheduled task).** One scheduled task, "JMSFusion: sincronizar trailers", runs every 6 hours and fills in every movie or series folder that has no trailer; a watcher also runs it 3 minutes after a new movie or series is added to the library. Rules: official Brazilian trailer from TMDb first, then YouTube search in Portuguese (dubbed, then subtitled), official Portuguese trailer from another country, official English trailer, IMDb, YouTube search in English, always validating title, year and channel, refusing store and rental channels, and downloading nothing when no candidate passes. yt-dlp is updated before each run, trailers are written with fast start, folders that already have a trailer are never touched, read-only folders are skipped, a failed title is retried after 5 hours, the YouTube cookies file is only read (a temporary copy is used), and logs go to the Jellyfin log only (prefix `[JMS trailers]`). The adult library is always skipped.
- **Custom scripts and styles.** Any `.js` or `.css` file placed in the plugin's `custom` folder (`<plugin configurations>/JMSFusion/custom`) is injected into the Jellyfin web page together with JMSFusion, in alphabetical order, with a version taken from the file date so edits show up without clearing the cache. This replaces boot-time `sed` patching of `index.html` by external init scripts. Only simple file names (letters, digits, dot, dash, underscore) are served.
- **Trailers tab cleaned up.** The settings tab no longer shows the options of the old manual downloader (enable downloader, URL in NFO, Jellyfin address, languages, parallel downloads, min/max resolution, overwrite policy and the "Run now" button), since trailers are now handled by the scheduled task. It keeps the TMDb note and the theme link options, and shows a short text, translated into every plugin language, explaining the automatic task, that the Brazilian Portuguese trailer is the main preference with the English trailer as the background fallback, and the optional cookies file. The old downloader code is still on the server side but nothing in the page calls it.
- **Backdrop image errors no longer loop.** When a slide backdrop fails to load (for example a 404), the slider stops swapping sources after 4 consecutive errors instead of retrying forever.
- **Translations.** Keyboard-shortcut help of the player, several settings texts and server messages were hardcoded in Turkish and now use translation keys or English; Portuguese (pt-BR) got the missing keys and four Turkish leftovers were translated.

## 3.7.3.0 (fork release)

Speed release on top of 3.7.2.0. Same plugin GUID, no setting changes, nothing to reconfigure.

### Changes

- **The plugin's JavaScript is now cached by the browser for good.** Every module URL carries the plugin version (`?v=...`), which only changes when the plugin changes, and is served with `Cache-Control: public, max-age=31536000, immutable`. A normal refresh no longer asks the server for the ~100 plugin files at all (before, each one was revalidated on every load, which is slow over a VPN such as Tailscale).
- **Modules are requested in parallel.** The page now carries an import map plus `modulepreload` hints, so the browser fetches the whole module tree at once instead of discovering it level by level.
- **No more blocking request at page start.** The splash screen used to make a synchronous plugin check on every load; it is now skipped when the plugin answered in the last 10 minutes (the plugin still confirms its presence asynchronously).
- **Trailers start sooner.** The trailer lookup and its stream URL are resolved ahead of time for the active slide and its neighbours (two ahead, one behind), the automatic start no longer waits the hover delay (120 ms instead of 500 ms), and arrow navigation finds the next trailer ready.
- **Timing marks for diagnostics.** The browser resource-timing buffer is enlarged and the plugin leaves cheap `performance` marks (`jms:boot`, `jms:main-eval`, `jms:slidesInit`, `jms:items-ready`, `jms:first-slide-created`, `jms:first-slide-ready`, `jms:splash-hide`) so slow loads can be measured in production.

### Upgrade notes

- The plugin folder is now named `JMSFusion_3.7.3.0`. If you mount the plugin folder as a Docker volume (recommended on Docker Desktop for Windows), update the mount path to the new folder name.
- Restart Jellyfin and hard refresh the browser (Ctrl + F5) once after upgrading.

## 3.7.2.0 (fork release)

Minor release on top of 3.7.1.1. Same plugin GUID, no setting changes, nothing to reconfigure.

### Changes

- **The local trailer no longer looks like a separate player.** The browser's own controls (seek bar, volume,
  download menu, picture-in-picture, right-click menu) are hidden. Pause and volume stay with the plugin's own
  buttons.
- **Discreet fullscreen button** under the volume button. In fullscreen the plugin's pause and volume buttons come
  along, a click on the picture pauses or resumes, and Esc (or the same button) leaves fullscreen.
- **Unmuting restores your volume.** Muting and unmuting used to jump back to 100% (or the configured maximum);
  now it returns to the last volume you set with the slider.
- **Slider arrows no longer lose the automatic trailer.** If the mouse was resting over the next card when you clicked an arrow, the hover took over and the automatic start was dropped, so the trailer only played after moving the mouse. The automatic start is now remembered and handed over when the mouse leaves, and an in-flight start is no longer restarted (no repeated delay).
- New label `previewTrailerFullscreen` in all 9 languages.

### Upgrade notes

- The plugin folder is now named `JMSFusion_3.7.2.0`. If you mount the plugin folder as a Docker volume
  (recommended on Docker Desktop for Windows, see the 3.7.1.0 notes), update the mount path to the new folder name.
- Restart Jellyfin and hard refresh the browser (Ctrl + F5).

## 3.7.1.1 (fork release)

Patch release on top of 3.7.1.0. Same plugin GUID, no setting changes, nothing to reconfigure.

### Fixes

- **About panel shows the real version.** In 3.7.1.0 it was stuck at `v3.7.0`, so "Check for updates" (and the
  background update check) reported the current release as a newer one.
- **About panel links point to this fork.** The original project link is kept as credit; the original author's
  e-mail address was removed, because fork issues do not belong in his inbox.
- **Update check compares four version numbers**, so patch releases like 3.7.1.x are detected as updates.

### Upgrade notes

- The plugin folder is now named `JMSFusion_3.7.1.1`. If you mount the plugin folder as a Docker volume
  (recommended on Docker Desktop for Windows, see the 3.7.1.0 notes), update the mount path to the new folder name.
- Restart Jellyfin and hard refresh the browser (Ctrl + F5).

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

- Upstream 3.7.0.0 answered `/JMSFusion/config` without login with the whole plugin configuration, and the code
  also allowed saving configuration without login. In this fork configuration endpoints return a version without secrets to non-admins, and
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
