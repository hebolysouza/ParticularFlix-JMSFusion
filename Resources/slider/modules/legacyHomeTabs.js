// Legacy layout (Jellyfin 12): opening Home on a plugin tab (#/home?tab=2+, e.g. Custom Tabs'
// Catalog / Requests / Calendar) often showed a blank page until a reload:
// - every #/home?... navigation mounts a NEW Home page and hides the old one; the plugin panels stay
//   in the hidden page, and Custom Tabs finds them by id and thinks they are already rendered;
// - the new tab strip only has Home and Favorites when Jellyfin selects ?tab=N (by position), and
//   Custom Tabs only puts its buttons back on pushState/popstate, not on hash links;
// - Jellyfin picks buttons and panels by POSITION, and Custom Tabs inserts its panels in reverse.
// This watcher brings the plugin panels into the visible Home page in index order, asks Custom Tabs
// to rebuild missing buttons, and then selects the requested tab the same way a click would.

const RETRY_MS = [0, 150, 400, 800, 1400, 2200, 3200];

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
  if (tab == null || !/^\d+$/.test(tab)) return null;
  const n = parseInt(tab, 10);
  return n >= 2 ? n : null;
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

function prepare(home) {
  adoptPluginPanels(home);
  sortPluginPanels(home.fav);
}

function trySelect(index) {
  const tabs = visibleTabsStrip();
  const home = activeHomePage();
  if (!tabs || !home) return false;
  prepare(home);
  const button = tabs.querySelector(`.emby-tabs-slider .emby-tab-button[data-index="${index}"]`);
  const panel = home.page.querySelector(`.tabContent[data-index="${index}"]`);
  if (!button || !panel) {
    // Custom Tabs exposes its plugin object; init() is idempotent (skips tabs that already exist).
    try { window.customTabsPlugin?.init?.(); } catch {}
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

function schedule() {
  if (isModernLayout()) return;
  const index = requestedTab();
  if (index == null) return;
  const id = ++runId;
  RETRY_MS.forEach((ms) => {
    setTimeout(() => {
      if (id !== runId || requestedTab() !== index || isModernLayout()) return;
      if (trySelect(index)) runId++;
    }, ms);
  });
}

// A click on a tab button is resolved by the strip right after this (bubbling phase): order the
// panels first, in the capture phase, so the click shows the panel of the tab that was clicked.
function onTabClickCapture(event) {
  if (isModernLayout()) return;
  const button = event.target?.closest?.(".emby-tabs-slider .emby-tab-button");
  if (!button) return;
  const home = activeHomePage();
  if (home) prepare(home);
}

export function installLegacyHomeTabsFix() {
  if (installed) return;
  installed = true;
  window.addEventListener("hashchange", schedule);
  window.addEventListener("popstate", schedule);
  document.addEventListener("click", onTabClickCapture, true);
  try { window.__jmsLegacyHomeTabs = { installedAt: Date.now(), run: schedule }; } catch {}
  schedule();
}
