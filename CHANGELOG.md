# Changelog

This file tracks the changes of the **ParticularFlix fork** of JMSFusion (Jellyfin-MonWUI-Plugin).
The upstream project by G-grbz was archived on 2026-08-19; this fork keeps it working on Jellyfin 10.11.x,
fixes bugs, closes a security hole and makes the home page lighter. License: GPL-3.0, credits to the
original authors (G-grbz and contributors) are kept.

## 3.8.2.34 (fork build)

- Coverflow 3D: back to the standard Peak behavior (logos on the neighbor cards, text title on the active card).
- Cinema: the "Up next" card is back (its styles had been lost), smaller and more discreet.
- Cinema and Mosaic: badges, buttons and text no longer overlap (meta badges wrap in their own rows, buttons sit below, shorter plot, extras hidden on short screens).
- Badges: neutral silver sound icon in every look, compact audio badge (no nested white boxes), rating heart and star layers aligned again, glass looks darker with readable text on any card.

## 3.8.2.33 (fork build)

Includes the internal builds 3.8.2.27 to 3.8.2.32, which were never published as releases.

- Badges: bigger, original icon colors kept (rating star, heart, tomato), the "New season" badge stays red in every look, colored quality badges in Minimal and Outline. The audio badge now shows a sound icon and a colored flag per language.
- Coverflow 3D: the focused card shows its logo in place of the text title; neighbor logos are larger. Cinema: smaller, discreet "Up next" card and the text stack can no longer climb over the badges.
- Position settings: Cinema, Mosaic and Coverflow keep their own overrides in separate keys, and the Normal/Peak/Compact positions are never touched (replaces the profile swap of 3.8.2.31/32, with automatic migration).
- Badges: the audio badge (languages, dual audio, channels, codec) now shows on every slider layout, including Peak, Coverflow 3D and Compact, which used to hide it. New badge looks selectable in the slider settings: Minimal (frosted glass, default), Soft color, Outline, and Original.
- New slider layouts: Cinema, Mosaic and Coverflow 3D, selectable in the slider settings. Softer rounded corners, and the text follows the slider style.
- In Cinema, Mosaic and Coverflow the text title is hidden when the film has a logo image (no more logo plus the same name in text).
- Cinema shows an "Up next" card (thumbnail, title and position counter) that jumps to the next film. Mosaic keeps its tile rail.
- In Cinema and Mosaic the trailer fills the whole card instead of opening on half of it.
- One set of previous/next arrows on every layout (theme red on hover). The old dot-strip arrows were removed, and the old brand slider arrows and row arrows are hidden over the slider.
- Slide transition for the new layouts is a separate setting (Animations): default is a smooth crossfade, and any of the existing transitions can be chosen.
- Manual position settings are now kept per layout (Normal/Peak/Compact, Cinema, Mosaic, Coverflow 3D), so tuning one layout no longer breaks another. In Cinema and Mosaic, Top and Left move a block from the layout default. Coverflow starts from a copy of the Peak positions.
- Coverflow 3D: neighbor cards show their logo centered on the visible strip. The blurred logo ghost no longer shows on the focused card while its trailer plays.
- Audio tag on the cards now reflects the real file: languages found in the audio streams (commentary tracks ignored), Dual or Multi audio, channel layout such as 5.1 or 2.0, and the codec.
- Slider boot: only the cards visible at start are resolved before the first paint; the rest load in the background. The number of cards is unchanged.

## 3.8.2.29 (fork build)

Includes the internal builds 3.8.2.27 and 3.8.2.28, which were never published as releases.

- Slider boot: the first slide no longer waits for the details of all 55 cards. Only the cards visible at start are resolved before the first paint; the remaining details are fetched in the background and each remaining slide is created once its data is ready. The number of cards is unchanged.
- New slider layouts, selectable under Slider settings: Cinema (full bleed backdrop, text bottom left), Split (glass info panel next to the backdrop), Mosaic (big highlight plus the next three titles as clickable tiles) and Coverflow 3D (3D tilted neighbors, runs on the Peak engine).
- New previous/next arrows on the sides of the slider, working in every layout (Compact, Normal, Peak and the four new ones). They use the same navigation as keyboard and swipe, so the timer and progress bar stay in sync. Hidden on touch devices, where swipe is used. The old arrows next to the dots (which only scrolled the dot strip) were removed. Arrow hover color follows the theme red.
- Coverflow 3D: the previous and next cards now show the film logo (or title) on the part of the card that peeks out, like the Peak showcase.
- Cinema, Split and Mosaic stack their text blocks in normal flow, so nothing overlaps at any slider size, and they ignore the manual position adjustments (those were tuned for Normal and Peak).

## 3.8.2.26 (fork release)

Includes everything from the internal build 3.8.2.25, which was never published as a release.

- Access control: list caches (slider, recent rows, director rows, recommendations, collections) now carry a per user generation that the server raises on every permission change. Stale pages can no longer write old content back after a lock, unlock or revert (the browser used to flush its in memory cache while reloading, which revived the previous content in the slider), and a page opened with an old generation reloads itself within a minute (never during playback). Replaces the cache file purge of 3.8.2.24.
- Access control: the Home Screen Sections plugin keeps the list of sections already built for each user in memory and reuses it for one hour, renewed on every access. A list built while the user was locked (no visible movies, so no "Because You Watched") kept being served after unlocking, and titles built while unlocked could stay after locking. Every apply, lock, unlock and revert now clears only that user's entries from that cache (by reflection, nothing happens if the plugin is not installed), and policy changes outside the six access fields are logged.
- Home and slider performance: the row scroll buttons of the recommendation rows now measure all rows first and update the buttons afterwards, in a single frame, instead of reading the layout right after another row changed it (the browser console showed frames of 140 to 310 ms and forced reflows of up to 260 ms). The slider layout repair that runs when the window gets focus, becomes visible again or is restored from the cache is now limited to once every 4 seconds, since these events arrive together and each repair took 250 ms or more.
- Home loading (measured in the browser on a cold load): the quality badge priming that ran for every item of every API response (HTML building plus a cache write, all before the browser could paint, 400 to 600 ms) now runs in small idle slices of about 8 ms. The quality cache no longer writes and deletes a test key in the local storage on every save. The five non critical start up tasks (profile chooser, avatars, notifications, quality badges, Seerr integration) ran together in one idle callback of 680 to 1000 ms; each one now runs on its own, yielding to the browser in between.
- The slider layout repair for restored pages no longer runs on a normal page load (pageshow and focus also fire then, and the repair took up to 400 ms of forced layout right when the home opens); it only runs after the page was hidden or restored from the browser cache. Idle tasks of the slider that take more than 80 ms now log a warning with the start of their code, to find the next slow one.
- Access control: with a profile that blocks everything, the "Personalized recommendations" row stayed on screen showing "No suitable content found" (the native Jellyfin message only appears when there are no libraries at all). The empty row is now hidden, and when a locked user ends up with no content cards on the home a notice asks to contact the administrator (it is not shown if Jellyfin already shows its own message, and it disappears after an unlock).
- Home loading, second round (from a browser Performance trace): the subtitle customizer measured the rendering of every font option at start up (about 550 ms of script); the grouping of equal fonts is now computed once and kept for 7 days. The scroll pin that holds the home at the top while the slider mounts read the scroll position of five elements on every frame (about 400 ms, each read forcing a layout); it now reacts only to scroll events. The home section order was reapplied on every class or style change inside the slider; it now reacts only to changes of the direct children of the home container. The first paint preparation of the peak slider no longer forces a layout between two frames (about 90 ms with 55 slides). The Material Icons integrity probe (it creates an element and reads its computed style, about 90 ms on load) now runs again only after a stylesheet really changes, once a check has passed. The slider header offset measurement no longer stacks bursts of timers and checks the scroll position at most once per frame.

## 3.8.2.24 (fork release)

- New "Access Control" tab (administrators only) that edits the NATIVE Jellyfin permissions of each non-administrator user: maximum parental rating, blocking of unrated content, blocked and allowed tags, and which libraries the user can see. Because it uses the server policy, the restriction is enforced by Jellyfin on every app and device, not only in the web client. Templates are provided (Free, Child, Teen, Almost adult). The original policy of each user is stored the first time and can be restored with one click. Administrators can never be restricted.
- Optional temporary unlock: a restricted user sees a small lock button and, with the global parental PIN, gets "full access" or a higher rating for a configurable number of minutes (1 to 480). The server restores the restriction automatically (checked every 20 seconds and at startup), reusing the existing attempt limit and lockout of the PIN. The user can also lock again at any time. The unlock can give full access, a higher rating, or simply restore the original permissions the user had before the plugin changed them (the default for new profiles). The access templates only change rating, unrated blocking and tags and never overwrite the library selection. Applying or reverting an access profile now also clears the server side list caches (slider, recent rows, director rows, recommendations, collections), so rows built while the user had other permissions are not shown anymore. The editor warns when the values equal the current permissions (nothing would be blocked) and allows a profile with no library, after a confirmation.
- Studio Collections settings: the "Other libraries" rows now have one checkbox per row. The "Other libraries" feature used a single switch that turned on three rows per library at once (Recently Added, Continue Watching and Recent Episodes), so a library that can never have anything to continue, such as a Collections (boxsets) library, still showed an empty "Continue Watching" row that appeared while the page loaded and then disappeared. The Studio Collections settings page now has a separate checkbox for each of the three rows (all on by default, so nothing changes for existing setups), each card count field is only shown while its row is on, and the count fields are no longer squeezed by long labels.
- The pause screen debug log is now off by default (it was on unless explicitly turned off, which filled the browser console).
- Missing translations filled in (Portuguese, English and Spanish): the slider list source and cache options, the new preview card size options, and about 25 labels that fell back to Turkish or to a hard coded text (collection, show more genres and directors, system notifications, playlists, statistics and backup messages, music player labels).

## 3.8.2.17 (fork release)

- Slider list cache is now an option. The "recent releases" and "recent premieres" slider sources kept their candidate list in the browser for a fixed 30 minutes, so a movie or show added just now could take a long time to show up in the main slider. The Query API page has a new field, "Slider list cache (minutes)", from 1 to 120 and defaulting to 3, used only by those two sources (the custom query keeps its own cache). The cache key was renewed, so lists cached by earlier versions are not reused.
- Bigger, Netflix-style trailer preview card. The popover that opens from the card trailer button is now 500 px wide (it still shrinks to fit narrow screens, 380 px max on phones) with a true 16:9 video area and an automatic height. The action row (Watch, add, match, volume, details) sits just below the video, followed by the title, quality badges, year, rating, duration and genres. The card has rounder corners, a softer shadow and a smoother scale and fade when it opens, and it is positioned using its real height so it no longer leaves the screen. The volume slider opens sideways, to the left of the volume button, and the browser picture-in-picture and cast icons are no longer drawn over the preview video.
- Trailer preview size option. Settings > Hover Trailer has a new "Preview card size" choice: Small (400 px), Medium (500 px, default), Large (600 px) and Extra large (700 px). The whole card scales together (text, buttons, spacing, quality badges), so nothing gets misaligned, and it is automatically limited to fit the window height and width. Phones keep the automatic layout.

## 3.8.2.14 (fork release)

- Home section order no longer needs custom CSS or an external script. The built-in order module now also recognizes the Home Screen Sections rows by their type class (Continue Watching, My Media, Upcoming Movies, Upcoming Shows, Discover, Because You Watched) and by their Portuguese titles ("Filmes em breve", "Séries em breve", "Porque você assistiu"), and any row without a rule, or an empty row slot, now goes to the end of the page (`homeSectionOrderDefault`, `false` disables) instead of jumping to the top when the CSS `order: 999` rule is removed.

## 3.8.2.13 (fork release)

- Home rows snapshot: when you leave the home page, an inert copy of the rows already drawn is kept, and it is put back instantly when you return with the Back button. Each copy disappears as soon as the real row has its cards (or after 12 s), so the page no longer comes back blank or jumps while the rows are rebuilt. Options: `homeSectionSnapshot: false` turns it off, `homeSectionSnapshotMaxAgeMs`, `homeSectionSnapshotTimeoutMs`.
- TRAILER button on slider cards: the check for a local trailer now runs automatically in a small queue, so the button is always visible (no more waiting for the mouse to hover the card), and it is inserted right after the Watch button, the same place as on cards that already had it.

## 3.8.2.12 (fork release)

- Studio hubs now group every studio of the same brand: the Paramount Pictures hub also lists items tagged Paramount+ or Paramount Animation, the Marvel Studios hub includes Marvel Enterprises and so on (Pixar, Lucasfilm, Warner, Columbia, Netflix, DreamWorks and DC too). Configurable with `studioHubGroupTokens`; `studioHubGroupMerge: false` turns it off.
- Rows drawn from the local cache now appear complete in one frame and without the per-card fade-in, so the extra cards no longer pop in one by one after the page returns to the home (`homeRowsInstantCache: false` restores the old behavior). Fresh data from the server keeps the animation.
- Home rows start about 1.5 s sooner: they boot 500 ms after the slider starts instead of waiting for the first slide to finish (`homeRowsEarlyBootMs`, `-1` restores the old behavior), and the eager loading delay dropped from 900 ms to 500 ms.
- Grouped studio hubs: the native list page only used the first studio id for the item list (it takes the id from the header item). On `#/list?studioId=a,b,c` that list request now carries all the ids of the group, so items tagged with any studio of the brand (for example DC Vertigo for the DC hub) show up.
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
