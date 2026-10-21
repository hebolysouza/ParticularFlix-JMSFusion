import { getSerrAccess, searchJellyfinByTmdbId } from "./api.js";
import { ensureSerrStyles } from "./styles.js";
import { openSerrSearchModal } from "./ui.js";
import { getConfig } from "../config.js";

const BRIDGE_ID = "monwui-serr-search-bridge";
const SCAN_MS = 900;
let observer = null;
let intervalId = 0;
let lastQuery = "";
let booted = false;
let lastAccess = null;
const localTmdbCache = new Map();

function placeBridgeUnderSearchBar(bridge) {
  const searchFields = document.querySelector(".searchFields");

  if (!searchFields) return false;

  if (bridge.parentElement === searchFields && bridge === searchFields.lastElementChild) {
    return true;
  }

  searchFields.appendChild(bridge);
  return true;
}

function labels() {
  try { return getConfig()?.languageLabels || {}; } catch { return {}; }
}

function moduleEnabled() {
  try { return getConfig()?.enableSerrArrIntegrationModule !== false; } catch { return true; }
}

function L(key, fallback) {
  const value = labels()?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function text(value) {
  return String(value ?? "").trim();
}

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const style = window.getComputedStyle?.(el);
  if (style?.display === "none" || style?.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect?.();
  return !rect || (rect.width > 0 && rect.height > 0);
}

function currentSearchQuery() {
  const active = Array.from(document.querySelectorAll([
    "input[type='search']",
    "input.searchInput",
    "input[name='searchTerm']",
    "#searchText",
    ".searchFields input"
  ].join(","))).find((input) => isVisible(input) && text(input.value).length >= 2);

  if (active) return text(active.value);

  try {
    const hash = new URL(window.location.hash.replace(/^#/, ""), window.location.origin);
    return text(hash.searchParams.get("query") || hash.searchParams.get("searchTerm") || hash.searchParams.get("search"));
  } catch {
    return "";
  }
}

function searchHost() {
  return (
    document.querySelector("#searchPage:not(.hide)") ||
    document.querySelector(".searchPage:not(.hide)") ||
    document.querySelector("[data-role='searchresults']:not(.hide)") ||
    document.querySelector(".searchResults:not(.hide)") ||
    document.querySelector(".itemsContainer") ||
    document.body
  );
}

function hasResultCards(host) {
  if (!host) return false;
  return !!host.querySelector([
    ".card[data-id]",
    ".card[data-itemid]",
    ".cardImageContainer",
    ".listItem[data-id]",
    ".itemsContainer .card"
  ].join(","));
}

function hasEmptyHint(host) {
  if (!host) return false;
  const haystack = text(host.textContent).toLowerCase();
  return [
    "no results",
    "nothing found",
    "bulunamad",
    "sonuç yok",
    "keine ergebnisse",
    "aucun résultat",
    "sin resultados",
    "ничего не найден"
  ].some((needle) => haystack.includes(needle));
}

function parseTmdbSearch(value) {
  const clean = text(value);
  if (!clean) return null;
  const match = clean.match(/^(?:https?:\/\/(?:www\.)?themoviedb\.org\/(?:movie|tv)\/|tmdb\s*[:#-]?\s*)?(\d{1,10})(?:[-/?#].*)?$/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

function serverIdSafe() {
  try {
    return window.ApiClient?.serverId?.() ||
      window.ApiClient?._serverInfo?.Id ||
      window.ApiClient?._serverInfo?.id ||
      "";
  } catch {
    return "";
  }
}

function detailsHref(item) {
  const id = encodeURIComponent(text(item?.Id || item?.id));
  if (!id) return "#";
  const serverId = serverIdSafe();
  return `#/details?id=${id}${serverId ? `&serverId=${encodeURIComponent(serverId)}` : ""}`;
}

function localItemTypeLabel(item) {
  const type = text(item?.Type || item?.type).toLowerCase();
  if (type.includes("series")) return L("serrTv", "Dizi");
  if (type.includes("movie")) return L("serrMovie", "Film");
  return text(item?.Type || item?.type, L("content", "İçerik"));
}

function renderLocalMatches(bridge, items, tmdbId) {
  const host = bridge.querySelector("[data-serr-local-matches]");
  if (!host) return;
  const list = Array.isArray(items) ? items : [];
  if (!tmdbId || !list.length) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }

  host.hidden = false;
  host.innerHTML = `
    <div class="monwui-serr-local-title">${L("serrTmdbLocalMatches", "TMDb ID ile Jellyfin eşleşmeleri")}</div>
    <div class="monwui-serr-local-list">
      ${list.slice(0, 8).map((item) => {
        const title = text(item?.Name || item?.name, L("serrUntitled", "İçerik"));
        const year = text(item?.ProductionYear || item?.productionYear);
        const meta = [localItemTypeLabel(item), year, `TMDb ${tmdbId}`].filter(Boolean).join(" • ");
        return `
          <a class="monwui-serr-local-item" href="${detailsHref(item)}">
            <span class="material-icons search" aria-hidden="true"></span>
            <span>
              <b>${escapeHtml(title)}</b>
              <small>${escapeHtml(meta)}</small>
            </span>
          </a>
        `;
      }).join("")}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[m]));
}

function isSearchRoute() {
  const hash = String(window.location.hash || "").toLowerCase();
  const path = String(window.location.pathname || "").toLowerCase();
  return hash.includes("search") || path.includes("search") || !!document.querySelector("#searchPage:not(.hide), .searchPage:not(.hide)");
}

function removeBridge() {
  document.getElementById(BRIDGE_ID)?.remove();
}

function searchResultAnchor(host) {
  if (!host) return null;
  if (host.id === BRIDGE_ID || host.closest?.(`#${BRIDGE_ID}`)) return null;

  const selectors = [
    ".searchResults:not(.hide)",
    "[data-role='searchresults']:not(.hide)",
    ".itemsContainer:not(.hide)",
    ".noItemsMessage:not(.hide)",
    ".empty:not(.hide)",
    ".verticalSection:not(.hide)"
  ];
  const candidates = Array.from(host.querySelectorAll?.(selectors.join(",")) || [])
    .filter((node) => node?.id !== BRIDGE_ID && !node.closest?.(`#${BRIDGE_ID}`) && isVisible(node));

  return candidates.find((node) => node.matches?.(".searchResults, [data-role='searchresults']")) ||
    candidates.find((node) => node.matches?.(".itemsContainer")) ||
    candidates.find((node) => node.matches?.(".noItemsMessage, .empty")) ||
    candidates.find((node) => node.matches?.(".verticalSection")) ||
    host;
}

function placeBridgeBelow(host, bridge) {
  const anchor = searchResultAnchor(host) || host;
  if (!anchor || anchor === document.body || anchor === document.documentElement) {
    if (bridge.parentElement !== host || bridge !== host.lastElementChild) {
      host.appendChild(bridge);
    }
    return;
  }

  const parent = anchor === host
    ? (host.parentElement || host)
    : (anchor.parentElement || host);
  const reference = anchor === host ? host.nextSibling : anchor.nextSibling;
  if (bridge.parentElement !== parent || reference !== bridge) {
    try { parent.insertBefore(bridge, reference); } catch { parent.appendChild(bridge); }
  }
}

function mountBridge(host, query, localItems = [], tmdbId = null) {
  ensureSerrStyles();
  let bridge = document.getElementById(BRIDGE_ID);
  if (!bridge) {
    bridge = document.createElement("div");
    bridge.id = BRIDGE_ID;
    bridge.className = "monwui-serr-search-bridge";
    bridge.innerHTML = `
      <div class="monwui-serr-search-bridge-actions">
        <button type="button" class="monwui-serr-search-bridge-btn">
          <i class="fas fa-clapperboard" aria-hidden="true"></i>
          <span></span>
        </button>
      </div>
      <div class="monwui-serr-local-results" data-serr-local-matches hidden></div>
    `;
    bridge.querySelector("button")?.addEventListener("click", () => {
      openSerrSearchModal(lastQuery || currentSearchQuery(), { source: "jellyfin-search" });
    });
  }

  lastQuery = query;
  const span = bridge.querySelector("span");
  if (span) {
    const arrOnly = lastAccess?.serrEnabled === false && lastAccess?.arrEnabled === true;
    span.textContent = tmdbId
      ? (arrOnly ? L("arrSearchTmdbInArr", "Arr'da TMDb ID ile ara") : L("serrSearchTmdbInSeerr", "Seerr'de TMDb ID ile ara"))
      : (arrOnly ? L("arrSearchInArr", "Arr'da ara") : L("serrSearchInSeerr", "Seerr'de ara"));
  }
  renderLocalMatches(bridge, localItems, tmdbId);

  if (!placeBridgeUnderSearchBar(bridge)) {
    placeBridgeBelow(host, bridge);
  }
}

async function getLocalTmdbMatches(tmdbId) {
  if (!tmdbId) return [];
  if (localTmdbCache.has(tmdbId)) return localTmdbCache.get(tmdbId);
  const data = await searchJellyfinByTmdbId(tmdbId).catch(() => null);
  const items = Array.isArray(data?.items) ? data.items : [];
  localTmdbCache.set(tmdbId, items);
  return items;
}

async function scan() {
  if (!moduleEnabled()) {
    removeBridge();
    return;
  }
  // Fork ParticularFlix: confere a rota (barato) antes de procurar o campo de busca
  // (getComputedStyle + getBoundingClientRect, forcava layout a cada mutacao do DOM).
  if (!isSearchRoute()) {
    removeBridge();
    return;
  }
  const query = currentSearchQuery();
  if (!query || query.length < 2) {
    removeBridge();
    return;
  }

  const access = await getSerrAccess().catch(() => null);
  lastAccess = access;
  if (!access?.enabled || access?.settings?.showMissingSearchButton === false) {
    removeBridge();
    return;
  }

  const host = searchHost();
  if (!host) return;

  const tmdbId = parseTmdbSearch(query);
  const localItems = tmdbId ? await getLocalTmdbMatches(tmdbId) : [];
  mountBridge(host, query, localItems, tmdbId);
}

function scheduleScan() {
  clearTimeout(scheduleScan.timer);
  scheduleScan.timer = setTimeout(() => scan().catch(() => {}), 220);
}

export function initSerrSearchBridge() {
  if (!moduleEnabled()) return null;
  if (booted) return;
  booted = true;

  scheduleScan();
  intervalId = window.setInterval(scheduleScan, SCAN_MS);

  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("hashchange", scheduleScan);
  window.addEventListener("popstate", scheduleScan);
  window.addEventListener("monwui:serr-requests-changed", scheduleScan);

  return () => {
    booted = false;
    observer?.disconnect?.();
    observer = null;
    clearInterval(intervalId);
    intervalId = 0;
    removeBridge();
  };
}
