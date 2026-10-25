// Legacy layout (Jellyfin 12): opening Home on a plugin tab (#/home?tab=2+, e.g. Custom Tabs'
// Catalog / Requests / Calendar) often showed a blank page until a reload:
// - every #/home?... navigation mounts a NEW Home page and hides the old one; the plugin panels stay
//   in the hidden page, and Custom Tabs finds them by id and thinks they are already rendered;
// - the new tab strip only has Home and Favorites when Jellyfin selects ?tab=N (by position), and
//   Custom Tabs only puts its buttons back on pushState/popstate, not on hash links;
// - Jellyfin picks buttons and panels by POSITION, and Custom Tabs inserts its panels in reverse.
// This watcher brings the plugin panels into the visible Home page in index order, asks Custom Tabs
// to rebuild missing buttons, and then selects the requested tab the same way a click would.

// Home can take several seconds to mount on a big library, so the watcher follows DOM changes (and a slow
// tick) for up to WATCH_MS instead of a fixed list of retries.
const WATCH_MS = 12000;
const TICK_MS = 400;
const CUSTOM_TABS_INIT_GAP_MS = 900;
let lastCustomTabsInit = 0;
let stopWatch = null;

let installed = false;
let runId = 0;

function isModernLayout() {
  return !!document.querySelector("header.MuiAppBar-root .MuiToolbar-root");
}

function requestedTab() {
  const raw = String(window.location.hash || "").replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  if (path !== "/home" && path !== "/home.html") return null;
  const tab = new URLSearchParams(query).get("tab");
  if (tab == null || tab === "") return 0;
  if (!/^\d+$/.test(tab)) return null;
  return parseInt(tab, 10);
}

function visibleTabsStrip() {
  const strips = document.querySelectorAll('.headerTabs [is="emby-tabs"], [is="emby-tabs"]');
  for (const el of strips) {
    if (el.querySelector(".emby-tabs-slider")) return el;
  }
  return null;
}

function activeHomePage() {
  const favs = document.querySelectorAll(".tabContent[data-index=\"1\"]");
  for (const fav of favs) {
    const page = pageOf(fav);
    if (page && !page.classList.contains("hide")) return { page, fav };
  }
  return null;
}

function indexOf(el) {
  return parseInt(el.getAttribute("data-index"), 10);
}

// The strip shows panels by POSITION too (the n-th .tabContent of the page). Custom Tabs inserts each
// missing panel right after Favorites, which leaves them in reverse order (4, 3, 2), so ?tab=4 showed
// tab 2. Put the plugin panels (index 2+) back in index order after Favorites; Jellyfin's own Home and
// Favorites panels are never moved.
function sortPluginPanels(fav) {
  const parent = fav.parentElement;
  if (!parent) return;
  const panels = Array.from(parent.children).filter(
    (el) => el.classList.contains("tabContent") && indexOf(el) >= 2
  );
  if (panels.length < 2 && (!panels.length || fav.nextElementSibling === panels[0])) return;
  const sorted = panels.slice().sort((a, b) => indexOf(a) - indexOf(b));
  let ref = fav;
  for (const panel of sorted) {
    if (ref.nextElementSibling !== panel) ref.after(panel);
    ref = panel;
  }
}

function pageOf(el) {
  return el.closest(".mainAnimatedPage, .page");
}

// Move plugin panels (index 2+) left behind in a hidden Home page into the visible one, unless the
// visible page already has its own panel for that index.
function adoptPluginPanels(home) {
  const parent = home.fav.parentElement;
  if (!parent) return;
  const have = new Set();
  home.page.querySelectorAll(".tabContent").forEach((el) => have.add(indexOf(el)));
  document.querySelectorAll(".tabContent").forEach((el) => {
    const idx = indexOf(el);
    if (!(idx >= 2) || have.has(idx)) return;
    const page = pageOf(el);
    if (!page || page === home.page || !page.classList.contains("hide")) return;
    el.classList.remove("is-active");
    parent.appendChild(el);
    have.add(idx);
  });
}

function hasContent(el) {
  return !!el && el.childElementCount > 0;
}

function swapNodes(a, b) {
  const mark = document.createComment("");
  a.replaceWith(mark);
  b.replaceWith(a);
  mark.replaceWith(b);
}

// With Custom Tabs installed, every Home page Jellyfin mounts gets its OWN empty panels (customTab_0, 1, 2...)
// from the served template, so the ids repeat. Custom Tabs fills the panel it finds by id, which is the one of
// the FIRST page in the document, often the hidden one: the visible page kept an empty panel (black page).
// An empty panel of the visible page is swapped with the filled one of the hidden page; when no copy is filled
// yet, it is filled from the Custom Tabs config the same way the plugin does it.
function fillPluginPanels(home) {
  home.page.querySelectorAll(".tabContent").forEach((panel) => {
    const idx = indexOf(panel);
    if (!(idx >= 2) || hasContent(panel)) return;
    let filled = null;
    document.querySelectorAll(`.tabContent[data-index="${idx}"]`).forEach((el) => {
      if (filled || el === panel || home.page.contains(el) || !hasContent(el)) return;
      if (panel.id && el.id && el.id !== panel.id) return;
      filled = el;
    });
    if (filled) {
      const wasActive = panel.classList.contains("is-active");
      swapNodes(panel, filled);
      panel.classList.remove("is-active");
      filled.classList.toggle("is-active", wasActive);
      return;
    }
    const plugin = window.customTabsPlugin;
    const config = plugin?.tabConfigs?.[panel.id] || plugin?.configs?.[idx - 2];
    if (!config || typeof plugin.setInnerHTMLWithScripts !== "function") return;
    try {
      plugin.setInnerHTMLWithScripts(panel, config.ContentHtml || "");
      plugin.renderedTabs?.add?.(panel);
    } catch {}
  });
}

function prepare(home) {
  adoptPluginPanels(home);
  fillPluginPanels(home);
  sortPluginPanels(home.fav);
}

// Jellyfin keeps two Home pages and alternates between them. A tab change made while one of them is
// shown can be applied to the panels of the other (hidden) one, which then comes back on the next
// visit to Home with no active panel (blank page). For Home (0) and Favorites (1) the panel of the
// visible page is simply made active again; their content is already loaded by Jellyfin.
function ensureNativePanel(tabs, home, index, force) {
  const panel = home.page.querySelector(`.tabContent[data-index="${index}"]`);
  if (!panel) return false;
  const button = tabs.querySelector(`.emby-tabs-slider .emby-tab-button[data-index="${index}"]`);
  if (force && button && !button.classList.contains("emby-tab-button-active")) {
    // The address asks for Home/Favorites but the strip is still on another tab (same route, so Jellyfin kept
    // it): a real click lets the strip and Jellyfin's tab controller do the switch.
    try { button.click(); } catch {}
  }
  if (panel.classList.contains("is-active")) return true;
  const other = home.page.querySelector(".tabContent.is-active:not([data-index='" + index + "'])");
  if (!force && other && indexOf(other) >= 2) {
    // Back/forward to a Home page that was left on a plugin tab: Jellyfin shows that panel again but marks
    // the first button. Keep the tab the user was on and mark its button.
    const own = tabs.querySelector(`.emby-tabs-slider .emby-tab-button[data-index="${indexOf(other)}"]`);
    if (own && !own.classList.contains("emby-tab-button-active")) {
      tabs.querySelectorAll(".emby-tabs-slider .emby-tab-button-active").forEach((el) => el.classList.remove("emby-tab-button-active"));
      own.classList.add("emby-tab-button-active");
      try { tabs.selectedTabIndex = indexOf(other); } catch {}
    }
    fillPluginPanels(home);
    return true;
  }
  if (!force && other) {
    // Another panel is legitimately active (the user is on that tab): leave it.
    const btnActive = tabs.querySelector(".emby-tabs-slider .emby-tab-button-active");
    if (btnActive && btnActive.getAttribute("data-index") !== String(index)) return true;
  }
  home.page.querySelectorAll(".tabContent.is-active").forEach((el) => el.classList.remove("is-active"));
  panel.classList.add("is-active");
  if (button && !button.classList.contains("emby-tab-button-active")) {
    tabs.querySelectorAll(".emby-tabs-slider .emby-tab-button-active").forEach((el) => el.classList.remove("emby-tab-button-active"));
    button.classList.add("emby-tab-button-active");
  }
  try { tabs.selectedTabIndex = index; } catch {}
  return true;
}

function trySelect(index, force) {
  const tabs = visibleTabsStrip();
  const home = activeHomePage();
  if (!tabs || !home) return false;
  if (index < 2) return ensureNativePanel(tabs, home, index, force);
  prepare(home);
  const button = tabs.querySelector(`.emby-tabs-slider .emby-tab-button[data-index="${index}"]`);
  const panel = home.page.querySelector(`.tabContent[data-index="${index}"]`);
  if (!button || !panel) {
    // Custom Tabs exposes its plugin object; init() is idempotent (skips tabs that already exist), but each
    // call may fetch its config, so it is spaced out.
    const now = Date.now();
    if (now - lastCustomTabsInit >= CUSTOM_TABS_INIT_GAP_MS) {
      lastCustomTabsInit = now;
      try { window.customTabsPlugin?.init?.(); } catch {}
    }
    return false;
  }
  if (button.classList.contains("emby-tab-button-active") && panel.classList.contains("is-active")) return true;

  if (!button.classList.contains("emby-tab-button-active")) {
    // A real click goes through the strip's own handler, which reads data-index from the button.
    try { button.click(); } catch {}
    return false;
  }

  // The button is already marked (Jellyfin selected it by position) but its panel was never shown:
  // show it the same way the strip does on a tab change.
  home.page.querySelectorAll(".tabContent.is-active").forEach((el) => {
    if (el !== panel) el.classList.remove("is-active");
  });
  panel.classList.add("is-active");
  try { tabs.selectedTabIndex = index; } catch {}
  try { tabs.dispatchEvent(new CustomEvent("tabchange", { detail: { selectedTabIndex: index } })); } catch {}
  return true;
}

function schedule(opts) {
  const forceNative = opts?.force !== false;
  try { stopWatch?.(); } catch {}
  stopWatch = null;
  if (isModernLayout()) return;
  const index = requestedTab();
  if (index == null) return;
  const id = ++runId;
  const startedAt = Date.now();
  let queued = false;
  let observer = null;
  let tick = 0;
  // Only the first successful pass may force Home/Favorites; after that a tab the user picks is respected.
  let forced = !forceNative;
  const stop = () => {
    queued = true;
    try { observer?.disconnect(); } catch {}
    if (tick) clearInterval(tick);
    tick = 0;
    if (stopWatch === stop) stopWatch = null;
  };
  const attempt = () => {
    queued = false;
    if (id !== runId || requestedTab() !== index || isModernLayout() || Date.now() - startedAt > WATCH_MS) {
      stop();
      return;
    }
    // Success is only final once the panel stayed active; keep watching briefly in case the page is
    // swapped again right after (Jellyfin remounts Home on some transitions).
    const ok = trySelect(index, !forced);
    if (ok) forced = true;
    if (ok && Date.now() - startedAt > 1500) stop();
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(attempt);
  };
  observer = new MutationObserver(queue);
  try { observer.observe(document.body, { childList: true, subtree: true }); } catch {}
  tick = setInterval(queue, TICK_MS);
  stopWatch = stop;
  attempt();
}

// A click on a tab button is resolved by the strip right after this (bubbling phase): order the
// panels first, in the capture phase, so the click shows the panel of the tab that was clicked.
// "#/home", "#/home.html", "#/home?..." without a plugin tab, or "#/" (a bare "#" is a button, not Home).
function isHomeHref(href) {
  const i = href.indexOf("#");
  if (i < 0) return false;
  const [path, query = ""] = href.slice(i + 1).split("?");
  if (path !== "/" && path !== "/home" && path !== "/home.html") return false;
  const tab = new URLSearchParams(query).get("tab");
  return tab == null || tab === "" || tab === "0";
}

function onTabClickCapture(event) {
  if (isModernLayout()) return;
  const target = event.target;
  const button = target?.closest?.(".emby-tabs-slider .emby-tab-button");
  if (button) {
    const home = activeHomePage();
    if (home) prepare(home);
    // The strip shows the panel, but Custom Tabs may fill it a moment later: check again shortly.
    if (indexOf(button) >= 2) setTimeout(() => { const h = activeHomePage(); if (h) fillPluginPanels(h); }, 120);
    return;
  }
  // A link to Home clicked while the address already is #/home (the logo, a Home link) changes nothing in the
  // address, so no hashchange arrives and Jellyfin stays on the current tab: select Home here.
  const link = target?.closest?.("a[href], .headerHomeButton, .pageTitleWithLogo, .pf-logo, .pf-logo-modern");
  if (!link) return;
  const href = link.getAttribute?.("href");
  if (href != null && !isHomeHref(href)) return;
  // Still on #/home?tab=N (a plugin tab opened by its address): the address keeps asking for that tab, so a
  // click on Home was undone. Drop ?tab= from the address (no navigation) and select Home.
  const tab = requestedTab();
  if (tab != null && tab > 0) {
    try { history.replaceState(history.state, "", window.location.href.replace(/#.*$/, "#/home")); } catch {}
  }
  setTimeout(() => { if (requestedTab() === 0) schedule(); }, 0);
}

export function installLegacyHomeTabsFix() {
  if (installed) return;
  installed = true;
  // Back/forward (popstate, followed by a hashchange) returns to the tab the user was on: never forced.
  // A new address without ?tab= (link, typed address) means Home.
  let lastPopAt = 0;
  window.addEventListener("popstate", () => { lastPopAt = Date.now(); schedule({ force: false }); });
  window.addEventListener("hashchange", () => schedule({ force: Date.now() - lastPopAt > 150 }));
  document.addEventListener("click", onTabClickCapture, true);
  try { window.__jmsLegacyHomeTabs = { installedAt: Date.now(), run: schedule }; } catch {}
  // First load: Jellyfin already selected the tab of the address; nothing to force.
  schedule({ force: false });
}
