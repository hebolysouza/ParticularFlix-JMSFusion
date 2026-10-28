# Changelog

This file tracks the changes of the **ParticularFlix fork** of JMSFusion (Jellyfin-MonWUI-Plugin).
The upstream project by G-grbz was archived on 2026-08-19; this fork keeps it working on Jellyfin 10.11.x,
fixes bugs, closes a security hole and makes the home page lighter. License: GPL-3.0, credits to the
original authors (G-grbz and contributors) are kept.

## 4.0.0.3 (fork build, Jellyfin 12)

Performance release. Same requirements as 4.0.0.2 (Jellyfin 12.x, net10.0). Settings are kept; no setting is renamed or reset.

### Performance
- **Slider, slides that already left the screen**: every slide starts hidden; once shown, the hide that runs when it leaves only swapped a class that had no style, so every slide already visited stayed laid out and painted under the active one (backdrop, gradients with masks, badges). After a few minutes the browser was compositing dozens of full-size slides on every frame of the trailer. In the styles without Peak (Normal, Compact, Cinema, Mosaic) a slide that left the screen is now removed from rendering when its transition ends. Kill switch: `localStorage jmsLayerTrim = "off"`.
- **Trailer downloads prefer H.264**: the trailer sync asked yt-dlp for the best 1080p mp4, and its default codec order picks AV1 when YouTube has it. Browsers without AV1 hardware decoding play those trailers on the CPU, at every slide change. New downloads now prefer H.264 (decoded by the GPU almost everywhere). Trailers already downloaded keep their codec.
- **Animation cleanup**: a page-wide observer walked every element of every subtree removed anywhere in the app (thousands of nodes per page change) to cancel slide animation timers. It now checks only the elements that hold timers, once per frame.
- **Hover previews while scrolling**: cards passing under a still mouse during a scroll could each open their preview (details request and video) only to close it a moment later. No preview opens during a scroll and for 250 ms after it.
- **Dots during the first load**: with the modern dots enabled, the hidden classic dots were still rebuilt while slides were created; they are now left alone.

## 4.0.0.2 (fork build, Jellyfin 12)

Fixes and performance work after 4.0.0.1. Same requirements (Jellyfin 12.x, net10.0). Settings are kept; no setting is renamed or reset. The header script (`extras/particularflix-modern-header.js`) changed too and is deployed separately, like the other brand scripts.

### Fixes
- **Access control, every path**: a blocked profile only hid the Home. The library shortcuts in the header (modern and legacy), the side menus and a typed address still led to the library. Now:
  - the server checks, whenever the client asks for the access status (at start and every minute), that the user's real Jellyfin policy is still the restricted one, and re-applies it if it drifted (edited in the dashboard, a save that failed, an unlock that did not return). At most once every 15 s per user; a value the server keeps normalising is re-applied only once and logged;
  - with every library blocked, the library, favourites and search shortcuts are hidden in the header bars and side menus, and any route other than Home, the user preferences and the login screens returns to Home.
- **Trailer controls on the row hero cards**: the large card of the Home rows (recent, directors, recommendations) uses the same trailer preview as the slider and got the pause, volume and fullscreen buttons too, which flashed while the hover trailer started. Those controls belong to the slider only now.
- **Cinema, first trailer**: the first slide after a reload or a return to Home waited 1.2 s and then showed its backdrop, often just before the trailer covered it (a flash of the image). The wait is now 1.8 s and is extended, up to 4.5 s, while the trailer of the active slide is still downloading; a backdrop that does come in fades in.
- **Next slide dots after a reload**: only the first two dots were shown until the other slides had been created in the background (with 70 slides that took a while). The modern dots now count the planned slides from the start: the ones not created yet are dimmed, show their title and image on hover and become clickable as soon as their slide exists. The plugin's own dots follow the slides as they are created (at most one rebuild every 400 ms).
- **Modular Home in the side menu**: Plugin Pages inserts its item as a menu entry of the native user menu (16 px text, its own margins, and the theme styles it differently), so it looked larger and out of line. The header script now hides it and shows a copy built exactly like the other entries (same classes and layout), highlighted when its page is open.
- **Studio collections, "More from <studio>" (Jellyfin Enhanced + Seerr) on grouped hubs** (Marvel, DC and any hub that groups several studios): the list opens as `#/list?studioId=a,b,c` and Jellyfin Enhanced asked its studio endpoint for that whole value, which failed, so the section never appeared. It now receives the hub's own studio. The request adjustment also loads on every page, so a grouped list opened straight from its address works too.
- **Studio collections preview (eye), first hover**: the titles were fetched only when a card came near the screen and the browser was idle, so a mouse that went straight to the eye still waited for the first server query. Every card of the section is now warmed in the background, one query at a time, 1.5 s after the section is built.
- **Side bar arrows (Netflix style)**: the bar was slow to let go of the mouse. The hovered state was a class on `<html>` (each change restyled the whole page) and every mouse move measured the bars. The state now lives on the slider, the bars are measured once per entry (and after a scroll or resize), and the fade is shorter.
- **Jellyfin Enhanced "Only available on ..." icon**: when the configured image does not load, the header script now tries the page's own favicon and then the default Jellyfin favicon before Jellyfin Enhanced hides it.
- **Details page**: a thin separator line between Director, Writers, Studios and Genres (header script; on Jellyfin 12 each group sits in its own wrapper, which the rule now follows).

### Performance
- One shared observer replaces the one or two `MutationObserver`s that every slide and every row hero card kept on the whole page to notice its own removal (about 140 callbacks per DOM change with 70 slides). It looks only at removals, once per frame.
- The modern dots no longer query the page and measure it on every mouse move anywhere in the app; the box and its position are cached.
- The quality hints are applied to each new slide instead of the whole page (70 page-wide scans during the background slide creation); one page-wide pass runs at the end.
- The Seerr item-page bridge stays idle outside item pages (it cleared the page with six document-wide queries on every DOM change and every 1.5 s).
- The Home watcher no longer queries the subtree of every element whose class changes (it ran a page-wide query for each class change on `<html>` or on the slider).
- The player header ratings check runs at most every 200 ms while the page changes (each check reads computed styles).
- The header script ignores DOM changes inside page content (cards, rows, slider), which can never bring the header back.

### Known limitations
- The red hover outline of the cards and the separators of the media info box come from the NetFin theme CSS, not from JMSFusion; they need the theme CSS to be adjusted for the Jellyfin 12 markup.

## 4.0.0.1 (fork build, Jellyfin 12)

Fixes found after the 4.0.0.0 rollout. Same requirements as 4.0.0.0 (Jellyfin 12.x, net10.0). Settings are kept; no setting is renamed or reset.

### Fixes
- **Player header (modern layout)**: the movie logo, stars, tomato score and age rating were hidden while playing. The modern header script hid every legacy header, including the player's own header. The player header now shows: back, ParticularFlix logo, movie logo and ratings, like the legacy layout, and the page navigation bar is hidden during playback.
- **Custom tabs on the modern header**: on first load, Custom Tabs could copy the ParticularFlix "Home" pill to build its tabs, so Catalog, Requests and Calendar showed "Home" before their name and stayed red. Those copies are now cleaned up.
- **Legacy layout, plugin tabs** (Catalog, Requests, Calendar): they opened blank on the first click and only worked after a reload. Every Home visit mounts a new page and the plugin panels stayed in the hidden one; Jellyfin also picks tabs and panels by position, and the Watchlist button and the reversed panel order shifted them. The panels are now moved to the visible page in order, the Watchlist button stays last, and the requested tab is selected.
- **Slider buttons on first load**: the slider moved down about 36 px once the modern header became visible, and the Trailer button arrived later than the others (after a queued check) and pushed them sideways. The header is measured from the start, its icon buttons no longer change height while the page loads, and the Trailer button is created with the other buttons when the item reports a local trailer.
- **Cinema**: the backdrop no longer flashes before the trailer or on the slide that is leaving. Items without a playable trailer still show their image.
- **Coverflow 3D with side-bar arrows**: a click on a lit side bar could jump to the card under it (several slides at once), and fast clicks could leave two cards marked as active. Side bars now always move one slide, and only the latest slide change marks the active card (applies to every slider style).
- **Legacy layout parity**: the notification bell has the same hover (no background) and ringing animation as the modern layout. Jellyfin Enhanced pages are only moved by the header script in the modern layout.
- **Legacy layout, back to Home**: Jellyfin keeps two Home pages and alternates between them; a tab change could leave the other page without an active panel, so going back to Home or Favorites showed a blank page. The visible page now always gets its panel back. The plugin-tab watcher also waits for slow Home mounts on large libraries (up to 12 s) instead of a fixed set of retries.
- **Details button (i) in the original look**: it had no background setting of its own and fell back to the blurred backdrop with a gradient, so it looked different from its neighbours. It now follows the "Played" button background setting.
- **Scroll jumped to the top** when opening the details modal from any card (and when opening the settings or the music player): the page was locked by setting `overflow:hidden` on both `html` and `body`, and on Jellyfin 12 that collapses the page to the window height. Only the element that controls the page scroll is locked now, so the page stays where it was.
- **Country flags on Windows**: the info bar showed the letters ("US") instead of the flag, because Windows browsers do not draw flag emoji. When the browser cannot draw them, a small flag-only font is loaded (Twemoji Country Flags, about 78 KB, used only for flag characters). Phones and macOS keep their system emoji.
- **Studio collections**: the preview (eye) button fetched its titles only when hovered, in up to two requests in a row, and only then started its open delay. Now it is one request sorted by rating on the server, cached per studio for 10 minutes, prefetched when the mouse enters the card, and the open delay runs in parallel (120 ms by default). The collection settings requests start when the section starts mounting instead of when its turn comes.
- **Access control**: a profile that blocks every library now blocks the home at once. The status endpoint reports `blocksAll`, the home hides the slider, collections and every section together and shows the notice immediately; the state is remembered per user, so the next visit starts blocked. The notice was redesigned and the lock icon is centred in a badge above the text. The access module now starts at boot instead of after idle.
- **Boot splash**: when the slider has no items (blocked profile, empty library) the "MonWui is starting" screen waited for its 12 s timeout. It is released immediately now.
- **Modern header script**: it re-ran its layout measurements on every change directly under `body` (popovers, dialogs, tooltips of any plugin), forcing a full-page layout each time (about 175 ms on a busy Home). It now reacts only when the header or the drawer actually changes.
- **Slider settings master switches** (sections "Status, rating and quality" and "Genre, year and country"): "Show status information", "Genre, year and country" and "Quality detail" only greyed out their sub-options; the slider ignored them. They now hide the status and format badges, the info bar, and the extra quality details (HDR, codec, audio), respectively.

- **Legacy layout with Custom Tabs, black page**: Custom Tabs puts empty panels for its tabs in every Home page Jellyfin mounts, with the same ids, and fills only the first one in the document (often the hidden page), so Catalog, Requests and Calendar opened black. The empty panel of the visible page is now swapped with the filled one, or filled from the Custom Tabs configuration.
- **Legacy layout, Home from a plugin tab**: going to Home (logo, a Home link, or an address without `?tab=`) while a plugin tab was open kept the plugin tab, since the address did not change. Home is now selected. Back and forward still return to the tab you were on, and its button is marked again.
- **Player logo (modern layout)**: the ParticularFlix logo in the player header is a link to Home again and has the same hover animation as the header logo.
- **Trailer controls** (pause, volume, fullscreen): their position depended on how the trailer started (automatically or by hovering), so on the first load they could appear in a different place, out of line with the offsets saved in the position editor. With the automatic trailer enabled they now always use the same places, and the pause button appears together with the other two (it used to come a moment later when the trailer was started by hovering; it now pauses that preview too).
- **Cinema, dark Home after a reload or a return to Home**: the backdrop was hidden until the trailer played, also on the first slide, so the Home stayed dark while that trailer loaded (longer on remote connections). The first slide after a reload or a return to Home now waits up to 1.2 s for its trailer and then shows its backdrop; a trailer that starts within that time comes in without the image before it. From the first slide change on, only the trailer is shown, as before.
- **Studio collections preview (eye)**: the first hover on every card was slow, since the posters only started downloading after the preview opened and Jellyfin resizes each poster the first time it is asked for. For the cards on screen the list of titles and the posters are now fetched while the browser is idle (posters at low priority), a card the mouse reaches gets them right away, and the entry animation is shorter (0.25 s instead of 0.55 s).
- **Legacy layout, logo from a plugin tab opened by its address** (`#/home?tab=N`): the address kept asking for that tab, so the click on the logo or on Home was undone. The `?tab=` is now dropped from the address before Home is selected.
- **Header script (both layouts)**: PARTICULAR and FLIX in the logo now sit on the same baseline in every state (the legacy CSS raised FLIX by 0.7 px) and the wordmark is centred with the icon by the height of its capital letters (it sat 3 to 4 px above the icon centre, which made the logo look crooked); FLIX gets a 1 px optical correction downwards (red on a dark background reads higher than light grey even when both occupy the same pixel rows; adjustable with `--pf-flix-y` in the theme CSS); the modern-layout logo is 30% larger, the same size as in the legacy layout; and the Jellyfin Oscars badge on the details page is shown without the outline and background it picked up from the theme, as before.
- **Portuguese labels**: "Genre, year and country" settings were half in English.

### Removed
- "Minimum width" and "Minimum pixel count" (Slider settings, backdrop quality): they had no effect, since the backdrop is chosen by file size, and measuring every image would cost extra requests. Both inputs were removed from the settings screen.

### Performance
- The slider asks the server for `LocalTrailerCount` together with the other item fields, so it no longer runs one local-trailer lookup per slide to place the Trailer button. On a home page with 8 slides this cut the trailer lookups from 8 to 2 and the `PlaybackInfo` calls from 7 to 2; with 55 slides the saving is proportionally larger.
- Measured on a test server with 60 ms of simulated latency: first slide visible on a cold load went from 4.5 s to 4.1 s, on a warm load from 1.4 to 1.7 s down to 1.3 s, and all slides ready from 2.5 to 3.0 s down to 1.5 to 2.3 s.

### Known limitations
- Jellyfin 12 itself downloads about 4.5 MB from `/Playback/BitrateTest` a few seconds after the web client opens (it happens without JMSFusion too). It does not block the slider, but it competes for bandwidth on slow remote connections.
- Legacy layout: if you leave a details page for a plugin tab within a fraction of a second, Jellyfin may not rebuild the tab strip; the tab content is shown, the strip comes back on the next navigation.
- Logo alignment in Firefox uses an approximate fallback: Firefox does not support trimming text to its capital letters yet (Edge, Chrome and Safari use the exact alignment).
- The details (i) limitation listed for 4.0.0.0 is fixed; the others still apply.

### Third-party asset
- `Resources/slider/src/fonts/TwemojiCountryFlags.woff2` from the `country-flag-emoji-polyfill` package (code MIT, TalkJS; flag art from Twemoji under CC-BY 4.0). License text in `TwemojiCountryFlags-LICENSE.md` next to the font.

## 4.0.0.0 (fork build, Jellyfin 12)

First build for **Jellyfin 12.x** (net10.0, validated on 12.3). Same plugin GUID. Does not load on Jellyfin 10.11.x: stay on 3.8.2.45 there.
**Version 4.0 is built for Jellyfin 12.x (.NET 10) and was validated on Jellyfin 12.3.** It keeps the same plugin GUID, so it upgrades an existing JMSFusion install in place. It does **not** load on Jellyfin 10.11.x: if you are still on 10.11, stay on **3.8.2.45**, which remains in the catalog.

### Read before upgrading
- Jellyfin 12 migrates the server database on its first start, and that cannot be undone. **Back up your whole Jellyfin config folder (including `data`) with the server stopped before you move to Jellyfin 12.** Rolling back means restoring that backup, not only changing the image.
- Pin your Jellyfin image to a specific 12.x version after the move, and update on purpose, not by accident.
- Plugins that patch the web client (Home Screen Sections, Plugin Pages) must be builds made for Jellyfin 12. The 10.11 builds break the home sections and the Modular Home page on 12.3. Use Home Screen Sections 3.0.3.0 and Plugin Pages 3.0.2.0 compiled with `JellyfinVersion=12.3.0` (the upstream sources already contain the 12.x code paths).
- Settings are kept. No setting is renamed or reset.

### Jellyfin 12 compatibility (the main point of this release)
- Rebuilt for **net10.0** against the **Jellyfin 12.3.0** packages. Plugin ABI 12.0.0.0.
- New authentication path: the plugin now talks to the server with the modern `Authorization: MediaBrowser Token=...` header and API keys (the old query-string token style no longer works on 12). A compatibility shim keeps the older call sites working. TMDb calls keep their own `api_key`.
- User listing goes through the server's user accessor, fixing the namespace change in 12.
- **Modern (MUI) header support**: the 12.x web client has a new layout. An optional script (`extras/particularflix-modern-header.js`) draws the ParticularFlix logo, centered navigation pills with a red active state, and keeps every pill by shrinking in steps (compact, flow, icons with tooltip) when the window is narrow.
  - The logo and "Home" always return to the first tab, from every tab (Favorites, Watchlist, Requests, Catalog, Calendar).
  - Hamburger menu in the wide window, with Home, Jellyfin Enhanced entries, Media, Administration (Dashboard, Metadata) and the user section.
  - Notification bell without background glow on hover, with a small ringing animation.
  - Fix for Jellyfin Enhanced category pages (Trending, Upcoming, Popular) that opened invisible under the Custom Tabs content on 12.3.
- Home Screen Sections on 12.3: found and documented the real causes (webpack names changed, and `userSettings.getData` no longer exists in 12). The home sections work again.
- Plugin Pages on 12.3: the Modular Home settings page opens again (the 10.11 route format caused `t[1].map is not a function`).

### New: slider and layout
- **Slider positions per style** (Normal, Peak, Compact, Cinema, Mosaic, Coverflow) with global style adjustments (side and bottom margin, text width, block gap), copy settings from another style, and plot mode (hide, 2/3/4 lines, full).
- **Drag and drop floating editor** with alignment guides, per-change Save, close button, per-block X/Y fields, three move groups (texts and badges, buttons and genre, whole set), outline on the block being edited, and revert of unsaved changes on close.
- **Cinema**: two-zone layout (texts on top, badges below, buttons and genre centered at the bottom), smaller navigation arrows tucked in the side margin, trailer starts with no wait.
- **Buttons**: two new looks (glass pills and round orbs), new Netflix-style translucent side-bar arrows, details button (i), elegant red accent, independent alignment for buttons and info.
- **Indicators**: modern glass dots with click-to-jump, a "next slide" indicator menu (card, modern dots, hidden), dots and movie progress bar as movable blocks, dots above every slide layer, and a **hover image preview on the dots** (the cover of that title, same as the "Up next" card) with an on/off option in Buttons settings.
- **Quality badges**: real resolution (1080p/720p/2160p), HDR, primary audio codec and channels; now also on **series**, taken from the first regular episode, cached for 7 days and non-blocking. Kill switch: `pf:qualityExtras=off`.
- **Trailer delay** setting now applies to automatic start (0 is allowed), with early trailer prefetch for the first slides.
- Series badges no longer race the slide insertion on cache hits; empty results are not cached.

### New: scheduled task
- **Trailer sync** runs at four fixed daily times (every 6 hours). Jellyfin's interval trigger restarted its count on every server restart, so fixed times are more predictable.

### Fixes
- Modern header: invalid nested selector that disabled centering, spacer boxes that made pills fall back to flow mode, overlap on narrow windows, profile caret alignment.
- Home Screen Sections ordering keeps working together with the plugin's own section order.
- Floating editor: ghost box removed, close button and per-change Save, text area click guard covers gaps, favorite icon white with outline only.

### Known limitations
- JMSFusion cannot change clients that do not render the server's `/web/index.html` (native Android TV and similar).
- The Modular Home entry in the hamburger menu is larger than the other items (cosmetic, tracked for a later build).
- In the original slider look, the details (i) button still renders flatter than the other action buttons (cosmetic, tracked for a later build).
- The slider pause, volume and fullscreen icons can occasionally end up in the wrong position after switching quickly between them (cosmetic, tracked for a later build).
- Some third-party plugins are not Jellyfin 12 ready at the time of this release. Check each plugin's own page before upgrading the server.

## 3.8.2.45 (fork build)

Much faster first load of the slider on a cold start. Rolls up the test-only builds 3.8.2.41 to 3.8.2.44.

- Slider, cold start: with the "current releases" source, the plugin used to fetch the full details of about 80 candidates before choosing the slides (4.5 to 8.5 s in our measurements). When the slider requires images (logo and backdrop), one light request now returns only the image tags of all candidates; the selection and its order are identical. The full details of the first slides are loaded right after and the rest in the background, as before. If the light request fails, the previous path is used.
- Home rows (Studio Hubs, TMDb, recent, director, personal recommendations) now wait for the first slide (6 s at most) before they start loading. On a cold start they were competing with the slider list queries (one took 6.4 s instead of about 0.3 s measured alone).
- First slide: the "match percentage" needs the user's favorite genres, cached for 24 h in `localStorage`. When that cache is empty (first load of the day, new browser profile) computing it took 4.6 s and held the whole first slide. The slide now waits at most 350 ms for it; if it is not ready, the slide appears without the percentage and the percentage is added as soon as it is computed.
- Settings save on page hide: the managed storage snapshot was also sent with `keepalive`, which browsers refuse above 64 KB ("Failed to fetch" in the console). Large payloads now use a normal request.
- New performance marks for finding where a load spends its time: `jms:source-queries-done`, `jms:data-done`, `jms:create-slide-start/done` and `jms:cs-*` (inside the first slide creation).
- Measured in a cold tab on a test server: first slide ready 25.7 s before, 4.7 s after. Results on other setups will vary.
- `localStorage jms:fastStart = "off"` restores the previous behavior of the start-up changes in this and the 3.8.2.37 to 3.8.2.40 entries.

## 3.8.2.40 (fork build)

Rolls up the test-only builds 3.8.2.38 and 3.8.2.39.

- Slider, cold start: with the "current releases" source, the plugin used to fetch the details of every candidate (about 80 items) one request at a time, four at a time. On a cold start (new tab, empty cache) this took 13 to 18 seconds in our measurements. The details are now requested in bulk (two requests instead of about 80), and bulk batches run up to three at a time. Simulated with 150 ms per single request: 3026 ms before, 258 ms after.
- Slider first paint: the watched/favorite/resume data of the first slides used to be fetched on every reload (the persisted cache drops it on purpose). A small per-user copy is now kept in `localStorage`, used only when it is at most 2 h old, and confirmed from the server about 1.2 s later (the slide is patched only if something changed). Details and watched data are requested at the same time.
- Cache save: saving the slider cache blocked the page for 90 to 110 ms right when the first slide appears. During the first 15 s of a page, the save now waits for the first slide to be ready (8 s at most); closing or hiding the tab still saves immediately.
- Cache save on page hide: browsers refuse `keepalive` requests above 64 KB ("Failed to fetch" for a ~680 KB cache). Large payloads now use a normal request.
- Home rows (Studio Hubs, TMDb, recent rows) start when the slider item list arrives, or after 4 s at most, instead of a fixed 500 ms after the slider begins.
- New performance marks: `jms:home-init`, `jms:auth-wait-done`, `jms:head-details-items`, `jms:head-userdata`.
- `localStorage jms:fastStart = "off"` restores the previous behavior of all the items above except the keepalive fix.

## 3.8.2.39 (fork build, test only)

Rolled into 3.8.2.40.

- Slider first paint: the watched/favorite/resume data of the first slides used to be fetched on every reload (the persisted cache drops it on purpose), adding 300 to 700 ms before the first slide. A small per-user copy is now kept in `localStorage`, used only when it is at most 2 h old, and confirmed from the server about 1.2 s later (the slide is patched only if something changed). The details and the watched data are now requested at the same time. `localStorage jms:fastStart = "off"` restores the previous behavior.
- Cache save: the page-hide flush sent the slider cache with `keepalive`, which browsers refuse above 64 KB ("Failed to fetch" for a ~680 KB cache). Large payloads now use a normal request.
- Home rows (Studio Hubs, TMDb, recent rows) start when the slider item list arrives, or after 4 s at most, instead of a fixed 500 ms after the slider begins.
- New performance marks: `jms:home-init`, `jms:auth-wait-done`, `jms:head-details-items`, `jms:head-userdata` (plus the existing `jms:*` marks).

## 3.8.2.38 (fork build, test only)

Measurement and cold-start follow-up to 3.8.2.37, rolled into 3.8.2.39.

- Cache save: the page-hide flush sent the slider cache with `keepalive`, which browsers refuse above 64 KB, so it failed with "Failed to fetch" for a ~680 KB cache. Large payloads now use a normal request (small ones keep `keepalive`).
- Home rows (Studio Hubs, TMDb, recent rows) no longer start 500 ms after the slider begins; they start as soon as the slider item list arrives, or after 4 s at most, so they stop competing with the first slide on a cold server. `localStorage jms:fastStart = "off"` restores the previous timing.
- New performance marks for finding where the first paint spends its time: `jms:home-init`, `jms:auth-wait-done` and `jms:head-details-items` (plus the existing `jms:*` marks). Read them with `performance.getEntriesByType("mark")`.

## 3.8.2.37 (fork build)

Faster first paint of the slider and a leaner details window.

- Slider, cold start: the first slide no longer waits for fresh data when a recent copy exists. The items pool, the head slide details and the watched/resume state are served from the local cache right away (up to 12 h old for the pool and 2 h for watched state) and refreshed in the background a couple of seconds later; the slide is patched only if something changed. The resume list and the pool are requested in parallel. Add `localStorage jms:fastStart = "off"` to go back to the previous behavior. Browser performance marks named `jms:*` were added to measure each phase.
- Details window: when opening takes longer than about 140 ms it now shows a skeleton that expands from the card instead of staying blank. Seasons, parent series and series details are requested in parallel, the parent series is reused for Seerr lookups, and the "missing episodes" from Seerr/Sonarr are loaded in the background and added to the list when ready. Reviews (TMDb), local comments and the side lists start loading only when they are about to be seen or during the opening animation.
- Language: missing labels added (Parental PIN tab title in English and Spanish, Studio Hubs default library name, writers placeholder).

## 3.8.2.36 (fork build)

Rolls up the unpublished internal build 3.8.2.35.

- Cinema and Mosaic: the director line was still hidden while a trailer played (the native slider CSS hides it with `.trailer-active ... display:none`, and these layouts always play a trailer). It is now shown on the active slide, and the Director position fields work. On very short windows (under 780 px tall) it stays hidden by design; set "Display type" to Flex in the Director block to force it.
- Position editor: the floating editor no longer sits on top of what you are moving. It opens on the opposite side of the item, can be dragged by its title, outlines the edited item with a yellow dashed line, and tells you when the item is hidden or outside the visible area.
- Rating badges: the grey blob behind the match heart and the community star is gone, and every rating badge now takes the color of its value like the audio badge (match %, community rating, critic score, and Brazilian age classification colors L, 10, 12, 14, 16, 18). "Watched" is green and the runtime is blue. Works in the Minimal, Tinted and Outline looks; Classic is unchanged.
- Position settings rewritten for clarity (descriptions, units, direction hints), editor freeze mitigations, provider box trail fix and background option, positionable provider icons and Format badges block (from 3.8.2.35).

## 3.8.2.35 (fork build)

- Position settings rewritten for clarity: every block now says what it is and what it moves, every field says its unit and direction (positive moves down or right, empty means default), and a short "how to use" note sits at the top.
- Position editor performance: live preview is batched into one frame, header measurements pause while you edit, and the quick editor no longer hides the whole settings window with display:none, which caused the multi-second freeze. Spinner arrows no longer open the quick editor on every click.
- Cinema and Mosaic: the director line now stays visible on the active slide (it was being faded out by the legacy hide animation) and sits right below the plot.
- Plugin settings button (provider box): moving it horizontally or vertically no longer stretches the box, which was leaving a trailing background. The box background can now be removed with a new "Box background" option, and the icons inside the box can be positioned on their own.
- New position block for the Format badges (type and quality). Classic layout positions and existing settings are untouched.

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
