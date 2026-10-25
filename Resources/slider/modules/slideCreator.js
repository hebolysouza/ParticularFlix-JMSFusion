import { getYoutubeEmbedUrl, getProviderUrl, isValidUrl, createTrailerIframe, debounce, getHighResImageUrls, prefetchImages, getHighestQualityBackdropIndex, createImageWarmQueue } from "./utils.js";
import { updateFavoriteStatus, updatePlayedStatus, getSessionInfo, fetchLocalTrailers, pickBestLocalTrailer } from "../../Plugins/JMSFusion/runtime/api.js";
import { getConfig } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";
import { createSlidesContainer, createHorizontalGradientOverlay, createLogoContainer, createStatusContainer, createFormatContainer, createActorSlider, createInfoContainer, createDirectorContainer, createRatingContainer, createLanguageContainer, createMetaContainer, createMainContentContainer, createPlotContainer, createTitleContainer } from "./containerUtils.js";
import { createButtons, createProviderContainer } from './buttons.js';
import { withServer, withServerSrcset } from "./jfUrl.js";
import { createTomatoIconElement } from "./customIcons.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { getWatchlistButtonText } from "./watchlist.js";
import { fetchItemDetailsFromSliderCache } from "./sliderCache.js";
import { applyNewSeasonBadge } from "./newSeasonBadge.js";
import { applySeriesQualityBadges } from "./seriesQuality.js";
import "./layerTrim.js";

const S = (u) => withServer(u);
const config = getConfig();
const LOW_POWER_PEAK = (() => {
  try {
    const ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    const uaMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches === true || navigator.maxTouchPoints > 0;
    const shortestSide = Math.min(
      window.innerWidth || window.screen?.width || 0,
      window.innerHeight || window.screen?.height || 0
    );
    return !!config.peakSlider && coarse && (!!window.ReactNativeWebView || uaMobile || (shortestSide > 0 && shortestSide <= 1280));
  } catch {
    return false;
  }
})();
const settingsBackgroundSlides = [];
const backdropWarmQueue = createImageWarmQueue({ concurrency: LOW_POWER_PEAK ? 1 : 3 });
window.__backdropWarmQueue = backdropWarmQueue;

const BG_HYDRATION_PER_FRAME = LOW_POWER_PEAK ? 4 : 12;
const NEIGHBOR_WARM_COUNT = 2;
const BG_IO_ROOT_MARGIN = LOW_POWER_PEAK ? '240px 0px' : '800px 0px';
const WARM_OBSERVER_ROOT_MARGIN = LOW_POWER_PEAK ? '160px 0px' : '600px 0px';
const PRELOAD_IO_ROOT_MARGIN = LOW_POWER_PEAK ? '220px 0px' : '800px 0px';
const BG_SCROLL_IDLE_MS = LOW_POWER_PEAK ? 160 : 120;
let __bgHydrationQueue = [];
let __bgHydrationRAF = 0;
let __bgScrollActive = false;
let __bgScrollIdleTimer = 0;

export function cleanupSlideCreatorRuntime({ clearWarmQueue = true } = {}) {
  if (__bgHydrationRAF) {
    try { cancelAnimationFrame(__bgHydrationRAF); } catch {}
    __bgHydrationRAF = 0;
  }
  __bgHydrationQueue = [];
  if (__bgScrollIdleTimer) {
    clearTimeout(__bgScrollIdleTimer);
    __bgScrollIdleTimer = 0;
  }
  __bgScrollActive = false;
  if (clearWarmQueue) {
    try { backdropWarmQueue.clear?.({ resetSeen: true }); } catch {}
  }
}

function bgQueueHydration(fn) {
  __bgHydrationQueue.push(fn);
  if (!__bgHydrationRAF) {
    __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
  }
}

function bgFlushHydrationFrame() {
  __bgHydrationRAF = 0;
  if (__bgScrollActive) return;
  let budget = BG_HYDRATION_PER_FRAME;
  while (budget-- > 0 && __bgHydrationQueue.length) {
    const fn = __bgHydrationQueue.shift();
    try { fn && fn(); } catch {}
  }
  if (__bgHydrationQueue.length) {
    __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
  }
}

(function injectBackdropPerfStyles(){
  if (document.getElementById('backdrop-perf-css')) return;
  const st = document.createElement('style');
  st.id = 'backdrop-perf-css';
  st.textContent = `
    .monwui-backdrop {
      opacity: 1;
      transition: opacity .28s ease, filter .34s ease, transform .34s cubic-bezier(.2,.6,.2,1);
    }
    .monwui-backdrop.is-lqip { filter: blur(14px); transform: scale(1.02); }
    .monwui-backdrop.is-hi-pending { opacity: .94; }
    #monwui-slides-container.is-scrolling *,
    #monwui-slides-container.is-scrolling .monwui-backdrop,
    #monwui-slides-container.is-scrolling .monwui-horizontal-gradient-overlay {
      transition: none !important;
      animation: none !important;
    }
  `;
  document.head.appendChild(st);
})();

const __bgIO = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    const img = ent.target;
    if (!ent.isIntersecting) continue;
    if (img.__peakManaged && !isPeakBackdropEligible(img)) continue;
    img.__requestHi?.();
  }
}, { rootMargin: BG_IO_ROOT_MARGIN });

function toNoTagUrl(url) {
  if (!url) return "";
  const s = String(url);
  try {
    const u = new URL(s, window.location?.origin || "http://localhost");
    u.searchParams.delete("tag");
    return u.toString();
  } catch {
    const [base, q = ""] = s.split("?");
    if (!q) return s;
    const rest = q.split("&").filter(Boolean).filter((p) => !/^tag=/i.test(p));
    return rest.length ? `${base}?${rest.join("&")}` : base;
  }
}

function toNoTagSrcset(srcset) {
  if (!srcset || typeof srcset !== "string") return "";
  return srcset
    .split(",")
    .map((part) => {
      const p = part.trim();
      if (!p) return "";
      const m = p.match(/^(\S+)(\s+.+)?$/);
      if (!m) return p;
      return `${toNoTagUrl(m[1])}${m[2] || ""}`;
    })
    .filter(Boolean)
    .join(", ");
}

function isPlaybackCompleted(userData, runtimeTicks = 0) {
  if (!userData || typeof userData !== "object") return false;
  if (userData.Played === true) return true;

  const playedPercentage = Number(userData.PlayedPercentage);
  if (Number.isFinite(playedPercentage) && playedPercentage >= 100) return true;

  const positionTicks = Number(userData.PlaybackPositionTicks || 0);
  const totalTicks = Number(runtimeTicks || 0);
  return positionTicks > 0 && totalTicks > 0 && positionTicks >= totalTicks;
}

function promoteTaglessBackdropData(data) {
  if (!data || data.__taglessPromoted) return data;
  if (data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) data.lqSrc = data.lqSrcNoTag;
  if (data.hqSrcNoTag && data.hqSrcNoTag !== data.hqSrc) data.hqSrc = data.hqSrcNoTag;
  if (data.hqSrcsetNoTag && data.hqSrcsetNoTag !== data.hqSrcset) data.hqSrcset = data.hqSrcsetNoTag;
  data.__taglessPromoted = true;
  return data;
}

function isPeakBackdropEligible(img) {
  if (!img?.__peakManaged) return true;
  const slide = img.closest?.('.monwui-slide');
  if (!slide) return false;
  return slide.classList.contains('active') || slide.classList.contains('peak-neighbor');
}

function hydrateBackdrop(img, { lqSrc, hqSrc, hqSrcset = '', fallback = '', eager = false, onHiLoaded }) {
  const fb = fallback || lqSrc || '';
  const lqSrcNoTag = toNoTagUrl(lqSrc);
  const hqSrcNoTag = toNoTagUrl(hqSrc);
  const hqSrcsetNoTag = toNoTagSrcset(hqSrcset);
  img.__bgData = { lqSrc, hqSrc, hqSrcset, lqSrcNoTag, hqSrcNoTag, hqSrcsetNoTag, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;
  img.__peakHiTimer = 0;
  img.__fetchPriorityTarget = '';

  img.__clearPeakHiTimer = () => {
    if (!img.__peakHiTimer) return;
    clearTimeout(img.__peakHiTimer);
    img.__peakHiTimer = 0;
  };

  img.__requestHi = ({ eagerLoad = false, fetchPriority = '', immediate = false } = {}) => {
    const data = img.__bgData || {};
    if (!data.hqSrc || !img.isConnected) return;
    if (img.__phase === 'hi' && img.__hiRequested && (!data.hqSrcset || img.srcset === data.hqSrcset) && img.src === data.hqSrc) {
      return;
    }
    img.__clearPeakHiTimer?.();
    img.__hiRequested = true;
    img.__phase = 'hi';
    img.__fetchPriorityTarget = fetchPriority || '';
    img.classList.add('is-hi-pending');
    const applyHiSource = () => {
      if (!img.isConnected) return;
      try {
        if (fetchPriority) img.setAttribute('fetchpriority', fetchPriority);
        else img.removeAttribute('fetchpriority');
      } catch {}
      try { img.loading = eagerLoad ? 'eager' : 'auto'; } catch {}
      try { img.decoding = eagerLoad ? 'auto' : 'async'; } catch {}
      if (data.hqSrcset) img.srcset = data.hqSrcset;
      if (data.hqSrc) img.src = data.hqSrc;
    };
    if (immediate || eagerLoad || fetchPriority === 'high') applyHiSource();
    else bgQueueHydration(applyHiSource);
  };

  img.__requestLq = () => {
    const data = img.__bgData || {};
    const target = data.lqSrc || data.fallback;
    if (!target || !img.isConnected) return;
    if (img.__phase === 'lq' && img.src === target && !img.srcset) return;
    img.__clearPeakHiTimer?.();
    img.__hiRequested = false;
    img.__phase = 'lq';
    img.__fetchPriorityTarget = '';
    bgQueueHydration(() => {
      if (!img.isConnected) return;
      try { img.removeAttribute('srcset'); } catch {}
      try { img.removeAttribute('fetchpriority'); } catch {}
      try { img.loading = 'lazy'; } catch {}
      try { img.decoding = 'async'; } catch {}
      img.classList.add('is-lqip');
      img.classList.remove('is-hi-pending');
      if (img.src !== target) img.src = target;
    });
  };

  try { img.removeAttribute('srcset'); } catch {}
  img.classList.add('is-lqip');
  img.decoding = 'async';
  img.loading = eager ? 'eager' : 'auto';
  img.src = lqSrc || fb || img.src;
  if (!eager) {
    img.style.opacity = '0';
  } else {
    img.style.opacity = '1';
  }

  const onError = () => {
    // Evita laco de erro: depois de algumas falhas seguidas (ex.: 404) para de trocar a fonte.
    img.__errCount = (img.__errCount || 0) + 1;
    if (img.__errCount > 4) return;
    const data = img.__bgData || {};
    if (img.__phase === 'hi') {
      if (!data.__taglessPromoted && data.hqSrcNoTag && data.hqSrcNoTag !== data.hqSrc) {
        promoteTaglessBackdropData(data);
        try { img.removeAttribute('srcset'); } catch {}
        if (data.hqSrcset) img.srcset = data.hqSrcset;
        if (data.hqSrc) img.src = data.hqSrc;
        img.__hiRequested = true;
        return;
      }
      if (!data.__taglessPromoted && data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) {
        promoteTaglessBackdropData(data);
      }
      try { img.removeAttribute('srcset'); } catch {}
      if (data.lqSrc) img.src = data.lqSrc; else if (fb) img.src = fb;
      img.classList.add('is-lqip');
      img.classList.remove('is-hi-pending');
      img.__phase = 'lq';
      img.__hiRequested = false;
      img.__fetchPriorityTarget = '';
    } else {
      if (!data.__taglessPromoted && data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) {
        promoteTaglessBackdropData(data);
        if (data.lqSrc) {
          img.src = data.lqSrc;
          return;
        }
      }
      if (fb) img.src = fb;
    }
  };
  const onLoad = () => {
    img.__errCount = 0;
    if (img.__phase === 'hi') {
      img.classList.remove('is-lqip');
      img.classList.remove('is-hi-pending');
      img.style.opacity = '1';
      img.__hydrated = true;
      try { img.loading = 'eager'; } catch {}
      try { img.decoding = 'auto'; } catch {}
      try {
        if (img.__fetchPriorityTarget) img.setAttribute('fetchpriority', img.__fetchPriorityTarget);
        else img.removeAttribute('fetchpriority');
      } catch {}
      if (typeof onHiLoaded === 'function') { try { onHiLoaded(); } catch {} }
    } else {
      img.style.opacity = '1';
    }
  };

  img.__bgOnErr = onError;
  img.__bgOnLoad = onLoad;
  img.addEventListener('error', onError, { passive: true });
  img.addEventListener('load',  onLoad,  { passive: true });

  __bgIO.observe(img);
  if (eager && hqSrc) {
    img.__requestHi({ eagerLoad: true, fetchPriority: 'high', immediate: true });
  }
}

function unobserveBackdrop(img) {
  try { img.__clearPeakHiTimer?.(); } catch {}
  try { __bgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__bgOnErr); } catch {}
  try { img.removeEventListener('load',  img.__bgOnLoad); } catch {}
  delete img.__bgOnErr;
  delete img.__bgOnLoad;
  try { img.removeAttribute('srcset'); } catch {}
}

function warmImageOnce(url, { timeout = 2500 } = {}) {
  if (!url) return Promise.resolve();
  const LRU_MAX = 500;
  warmImageOnce._set  ??= new Set();
  warmImageOnce._list ??= [];
  if (warmImageOnce._set.has(url)) return Promise.resolve();
  warmImageOnce._set.add(url);
  warmImageOnce._list.push(url);
  if (warmImageOnce._list.length > LRU_MAX) {
    const drop = warmImageOnce._list.splice(0, warmImageOnce._list.length - LRU_MAX);
    for (const u of drop) warmImageOnce._set.delete(u);
  }

  return new Promise((res) => {
    const img = new Image();
    let done = false;
    const finish = () => { if (!done) { done = true; res(); } };
    const t = setTimeout(finish, timeout);
    img.onload = () => { clearTimeout(t); finish(); };
    img.onerror = () => { clearTimeout(t); finish(); };
    img.src = url;
  });
}

function shortPreload(url, ms = 1200) {
  if (!url) return;
  const sel = `link[rel="preload"][as="image"][href="${url}"]`;
  if (document.querySelector(sel)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = url;
  document.head.appendChild(link);
  const id = setTimeout(() => {
    try { link.remove(); } catch {}
  }, ms);
  return () => { clearTimeout(id); try { link.remove(); } catch {} };
}

async function createSlide(item, options = {}) {
  const {
    insertAt = null,
    suppressInitialDisplay = false,
    deferPeakReveal = false
  } = options || {};
  const indexPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return;
  const csMark = (name) => { try { if (!window.__jmsFirstSlideReady) performance.mark("jms:cs-" + name); } catch {} };
  csMark("start");

  let parentId = item.Id;
  const itemIdRaw = item.Id;

  if ((item.Type === "Episode" || item.Type === "Season") && item.SeriesId) {
    try {
      const parentItem = await fetchItemDetailsFromSliderCache(item.SeriesId);
      parentId = parentItem.Id;

      const mergeTrailers = (a = [], b = []) => {
      const all = [...a, ...b];
      const seen = new Set();
      return all.filter(t => {
        const key = (t?.Url || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    let effectiveRemoteTrailers = [];
    if (Array.isArray(item.RemoteTrailers) && item.RemoteTrailers.length) {
      effectiveRemoteTrailers = mergeTrailers(item.RemoteTrailers, parentItem.RemoteTrailers);
    } else {
      effectiveRemoteTrailers = parentItem.RemoteTrailers || [];
    }

    item = {
      ...parentItem,
      Id: item.Id,
      Type: item.Type,
      SeriesId: item.SeriesId,
      MediaStreams: item.MediaStreams,
      People: item.People || parentItem.People,
      UserData: item.UserData,
      RunTimeTicks: item.RunTimeTicks,
      RemoteTrailers: effectiveRemoteTrailers,
      ProviderIds: item.ProviderIds || parentItem.ProviderIds,
      ParentIndexNumber: item.ParentIndexNumber,
      IndexNumber: item.IndexNumber,
      Name: item.Name
    };
        } catch (err) {
      console.error("Dizi bilgileri alınamadı:", err);
    }
  }

  const ac = new AbortController();
  const { signal } = ac;
  const perSlideObservers = [];
  const perSlideCleanups = [];
  const slidesContainer = createSlidesContainer(indexPage);
  const existing = slidesContainer.querySelector(`.monwui-slide[data-item-id="${itemIdRaw}"]`);
  (function bindSlidesScrollPerf(){
    const scroller = slidesContainer;
    if (!scroller) return;
    if (scroller.__jmsSlidesScrollPerfBound) return;
    const onScrollPerf = () => {
      __bgScrollActive = true;
      if (__bgScrollIdleTimer) clearTimeout(__bgScrollIdleTimer);
      __bgScrollIdleTimer = setTimeout(() => {
        __bgScrollActive = false;
        if (!__bgHydrationRAF && __bgHydrationQueue.length) {
          __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
        }
      }, BG_SCROLL_IDLE_MS);
    };
    scroller.addEventListener('scroll', onScrollPerf, { passive: true });
    scroller.__jmsSlidesScrollPerfBound = true;
    scroller.__jmsSlidesScrollPerfCleanup = () => {
      try { scroller.removeEventListener('scroll', onScrollPerf); } catch {}
      scroller.__jmsSlidesScrollPerfBound = false;
      scroller.__jmsSlidesScrollPerfCleanup = null;
      if (__bgScrollIdleTimer) {
        clearTimeout(__bgScrollIdleTimer);
        __bgScrollIdleTimer = 0;
      }
      __bgScrollActive = false;
    };
  })();
  if (existing) {
   try { existing.__cleanupSlide?.(); } catch {}
   try { existing.remove(); } catch {}
 }
  if (!slidesContainer.__cleanupMO) {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.removedNodes?.forEach?.(node => {
          if (node && node.__cleanupSlide) {
            try { node.__cleanupSlide(); } catch {}
          }
          node?.querySelectorAll?.('.monwui-slide')?.forEach(el => {
            if (el.__cleanupSlide) { try { el.__cleanupSlide(); } catch {} }
          });
        });
      }
    });
    mo.observe(slidesContainer, { childList:true, subtree:true });
    slidesContainer.__cleanupMO = mo;
  }
  const existingSlides = Array.from(slidesContainer.children).filter((child) => child.classList?.contains("monwui-slide"));
  const isFirstSlide = existingSlides.length === 0;
  const itemId = item.Id;

  const {
    Overview,
    Type: itemType,
    People,
    UserData,
    MediaStreams,
    Name: title,
    RunTimeTicks,
    OriginalTitle,
    Taglines,
    Genres,
    ChildCount,
    ProductionYear,
    ProductionLocations,
    CommunityRating,
    CriticRating,
    OfficialRating,
    RemoteTrailers,
    ProviderIds
  } = item;

  let highestQualityBackdropIndex;
  if (config.manualBackdropSelection || config.indexZeroSelection) {
    highestQualityBackdropIndex = "0";
  } else {
    csMark("backdrop-probe-start");
    highestQualityBackdropIndex = await getHighestQualityBackdropIndex(parentId, { itemDetails: item });
    csMark("backdrop-probe-done");
  }

  function storeBackdropUrl(id, url) {
    try {
      const stored = JSON.parse(localStorage.getItem("backdropUrls")) || [];
      if (!stored.includes(url)) {
        stored.push(url);
        const MAX = 500;
        const trimmed = stored.slice(-MAX);
        localStorage.setItem("backdropUrls", JSON.stringify(trimmed));
      }
    } catch {}
  }

  function buildSlideBackdropUrl(id, index = "0") {
    const idx = Math.max(0, Number(index) || 0);
    const tag = Array.isArray(item?.BackdropImageTags) ? (item.BackdropImageTags[idx] || "") : "";
    const configuredMaxWidth = Number(config.backdropMaxWidth) || 1920;
    const maxWidth = Math.max(1280, Math.min(3840, configuredMaxWidth));
    const qs = new URLSearchParams();
    if (tag) qs.set("tag", tag);
    qs.set("quality", "90");
    qs.set("maxWidth", String(Math.floor(maxWidth)));
    qs.set("format", "webp");
    return S(`/Items/${id}/Images/Backdrop/${idx}?${qs.toString()}`);
  }

  const autoBackdropUrl = buildSlideBackdropUrl(parentId, highestQualityBackdropIndex);
  const landscapeUrl = S(`/Items/${parentId}/Images/Thumb/0`);
  const primaryUrl  = S(`/Items/${parentId}/Images/Primary`);
  // Fork ParticularFlix: o logo aparece com no maximo ~130 px de altura; pede no tamanho certo
  // (o original do Jellyfin chega a 881 KB). logoFullUrl so e usado quando o logo vira a imagem de fundo.
  const logoFullUrl = S(`/Items/${parentId}/Images/Logo`);
  let logoUrl = S(`/Items/${parentId}/Images/Logo?maxHeight=300&quality=90`);
  const bannerUrl = `/Items/${parentId}/Images/Banner`;
  const clearartUrl = S(`/Items/${parentId}/Images/Art`);
  const artUrl = clearartUrl;
  const discUrl = S(`/Items/${parentId}/Images/Disc`);
  const logoExists = true;

  storeBackdropUrl(parentId, autoBackdropUrl);

  const manualBackdropUrl = {
    backdropUrl: buildSlideBackdropUrl(parentId, 0),
    landscapeUrl,
    primaryUrl,
    logoUrl: logoExists ? logoFullUrl : buildSlideBackdropUrl(parentId, 0),
    bannerUrl: S(`/Items/${parentId}/Images/Banner`),
    artUrl: S(`/Items/${parentId}/Images/Art`),
    discUrl: S(`/Items/${parentId}/Images/Disc`),
    none: ""
  }[config.backdropImageType];

  addSlideToSettingsBackground(parentId, autoBackdropUrl);

  const slide = document.createElement("div");
  slide.className = "monwui-slide";
  if (deferPeakReveal && config.peakSlider) {
    slide.classList.add("peak-batch-pending");
  }
  slide.dataset.backdropReady = "0";
  slide.style.position = "absolute";
  slide.style.display = "none";
  slide.dataset.detailUrl = `/web/#/details?id=${itemId}`;
  slide.dataset.itemId = itemId;
  slide.setAttribute('data-media-streams', JSON.stringify(MediaStreams || []));
  slide.dataset.played = isPlaybackCompleted(UserData, RunTimeTicks) ? "true" : "false";

  if (typeof UserData?.PlaybackPositionTicks === "number") {
    slide.dataset.playbackpositionticks = UserData.PlaybackPositionTicks;
  }
  if (typeof RunTimeTicks === "number") {
    slide.dataset.runtimeticks = RunTimeTicks;
  }

  let backdropSyncDone = false;
  let backdropSyncReason = "0";
  let resolveBackdropSync = null;
  const backdropSyncPromise = new Promise((resolve) => {
    resolveBackdropSync = resolve;
  });
  const finishBackdropSync = (reason = "loaded") => {
    if (reason === "loaded") {
      backdropSyncReason = "loaded";
      slide.dataset.backdropReady = "1";
      slide.classList.add("backdrop-ready");
    } else if (!backdropSyncDone) {
      backdropSyncReason = String(reason || "0");
      slide.dataset.backdropReady = backdropSyncReason;
    }
    if (backdropSyncDone) return backdropSyncReason;
    backdropSyncDone = true;
    try { resolveBackdropSync?.(backdropSyncReason); } catch {}
    return backdropSyncReason;
  };

  slide.__waitForBackdropReady = ({ timeoutMs = LOW_POWER_PEAK ? 2400 : 1600 } = {}) => {
    if (backdropSyncDone) return Promise.resolve(backdropSyncReason);
    const safeTimeout = Math.max(350, Number(timeoutMs) || 0);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(finishBackdropSync("timeout"));
      }, safeTimeout);
      backdropSyncPromise.then((reason) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });
  };

  slide.__releasePeakReveal = ({ timeoutMs = LOW_POWER_PEAK ? 2600 : 1800 } = {}) => {
    if (!config.peakSlider || !slide.classList.contains("peak-batch-pending")) return;
    if (slide.__peakRevealArmed) return;
    slide.__peakRevealArmed = true;
    slide.__waitForBackdropReady({ timeoutMs }).finally(() => {
      slide.__peakRevealArmed = false;
      if (!slide.isConnected) return;
      slide.classList.remove("peak-batch-pending");
    });
  };

  slide.dataset.backdropUrl = autoBackdropUrl;
  slide.dataset.landscapeUrl = landscapeUrl;
  slide.dataset.primaryUrl = primaryUrl;
  slide.dataset.logoUrl = logoUrl;
  slide.dataset.bannerUrl = S(`/Items/${parentId}/Images/Banner`);
  slide.dataset.artUrl = clearartUrl;
  slide.dataset.clearartUrl = clearartUrl;
  slide.dataset.discUrl = discUrl;

  const { backdropUrl, placeholderUrl, srcset } = await getHighResImageUrls(
    { ...item, Id: parentId },
    highestQualityBackdropIndex
  );
  csMark("imageurls-done");
  const absBackdrop = config.manualBackdropSelection ? manualBackdropUrl : S(backdropUrl);
  const absPlaceholder = S(placeholderUrl);
  const absSrcset = withServerSrcset(srcset || "");
  const finalBackdropForWarm = absBackdrop;
  const allowPeakWarm = !config.peakSlider || isFirstSlide;
  slide.dataset.background = absBackdrop || S(autoBackdropUrl);

  const backdropImg = document.createElement('img');
  backdropImg.className = 'monwui-backdrop';
  backdropImg.alt = 'Backdrop';
  backdropImg.sizes = '100vw';
  backdropImg.__peakManaged = !!config.peakSlider;
  if (isFirstSlide) backdropImg.setAttribute('fetchpriority', 'high');

  hydrateBackdrop(backdropImg, {
    lqSrc: absPlaceholder,
    hqSrc: absBackdrop,
    hqSrcset: absSrcset,
    eager: isFirstSlide,
    onHiLoaded: () => {
      finishBackdropSync("loaded");
    }
  });

  if ((!LOW_POWER_PEAK || isFirstSlide) && allowPeakWarm) {
    backdropWarmQueue.enqueue(finalBackdropForWarm, { shortPreload: true });
    const warmObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && (!backdropImg.__peakManaged || isPeakBackdropEligible(backdropImg))) {
          shortPreload(finalBackdropForWarm, 1500);
          warmImageOnce(finalBackdropForWarm).catch(() => {});
          obs.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: WARM_OBSERVER_ROOT_MARGIN });
    warmObserver.observe(backdropImg);
    perSlideObservers.push(warmObserver);
  }

  const pinActiveIfNeeded = () => {
    const slideEl = backdropImg.closest('.monwui-slide');
    const active = slideEl?.classList.contains('active');
    if (!active) return;
    try { backdropImg.setAttribute('fetchpriority','high'); } catch {}
    try { backdropImg.loading = 'eager'; } catch {}
  };
  const isHighQualityBackdropReady = () => (
    backdropImg.__hydrated === true ||
    (
      backdropImg.__phase === "hi" &&
      backdropImg.complete &&
      Number(backdropImg.naturalWidth || 0) > 0 &&
      !backdropImg.classList.contains("is-lqip")
    )
  );
  backdropImg.addEventListener('load', () => {
    if (isHighQualityBackdropReady()) {
      finishBackdropSync("loaded");
    }
  }, { passive: true, signal });
  backdropImg.addEventListener('load', pinActiveIfNeeded, { once:true, passive:true, signal });
  requestAnimationFrame(() => {
    if (isHighQualityBackdropReady()) {
      finishBackdropSync("loaded");
    }
  });

  const warmOnHover = () => { warmImageOnce(finalBackdropForWarm).catch(() => {}); };
  if (!LOW_POWER_PEAK) {
    backdropImg.addEventListener('mouseenter',  warmOnHover, { passive: true, signal });
    backdropImg.addEventListener('pointerover', warmOnHover, { passive: true, signal });
  }
  if ((!LOW_POWER_PEAK || isFirstSlide) && allowPeakWarm) {
    const ioPreload = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        if (backdropImg.__peakManaged && !isPeakBackdropEligible(backdropImg)) return;
        const finalBackdrop = config.manualBackdropSelection ? manualBackdropUrl : backdropUrl;
        let preload = document.querySelector(`link[rel="preload"][as="image"][href="${finalBackdrop}"]`);
        if (!preload) {
          preload = document.createElement('link');
          preload.rel = 'preload';
          preload.as = 'image';
          preload.href = finalBackdrop;
          document.head.appendChild(preload);
        }
        const tid = setTimeout(() => { try { if (preload && !preload.__pinned) preload.remove(); } catch {} }, 1500);
        perSlideCleanups.push(() => clearTimeout(tid));
        observer.unobserve(entry.target);
      });
    }, { rootMargin: PRELOAD_IO_ROOT_MARGIN });
    ioPreload.observe(backdropImg);
    perSlideObservers.push(ioPreload);
  }

  backdropImg.addEventListener('click', async (ev) => {
    const slideEl = ev.currentTarget.closest('.monwui-slide');
    const sc = document.querySelector('#monwui-slides-container');
    const isPeak = sc?.classList.contains('peak-mode');
    const isActive = slideEl?.classList.contains('active');
    if (isPeak && !isActive) {
      return;
    }

    // Fork ParticularFlix: nos layouts Cinema e Mosaico a area dos textos nao abre mais o modulo de detalhes
    // (ele abre pelo botao "i" da linha de botoes).
    const layoutMode = document.documentElement.dataset.sliderLayout;
    if (layoutMode === 'cinema' || layoutMode === 'mosaic') {
      const hit = slideEl && Array.from(slideEl.querySelectorAll(
        '.monwui-format-container,.monwui-logo-container,.monwui-title-container,.monwui-meta-container,.monwui-plot-container,.monwui-director-container,.monwui-info-container'
      )).some((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      });
      if (hit) { ev.preventDefault(); ev.stopPropagation(); return; }
    }

    ev.preventDefault();
    ev.stopPropagation();

    const preferBackdropIndex = localStorage.getItem("jms_backdrop_index") || highestQualityBackdropIndex || "0";
    const serverId = getSessionInfo?.()?.serverId || "";
    try {
      await openDetailsModal({
        itemId,
        serverId,
        preferBackdropIndex,
        originEl: ev.currentTarget || slideEl || backdropImg,
      });
    } catch (err) {
      console.warn("openDetailsModal failed (slider click):", err);
    }
  }, { signal });

  const prevTeardown = slide.__cleanupSlide;
  const teardown = () => {
    try { perSlideObservers.forEach(o => o.disconnect()); } catch {}
    try { ac.abort(); } catch {}
    try { backdropImg.removeEventListener('mouseenter', warmOnHover); } catch {}
    try { backdropImg.removeEventListener('pointerover', warmOnHover); } catch {}
    try { unobserveBackdrop(backdropImg); } catch {}
    try { perSlideCleanups.forEach(fn => { try { fn(); } catch {} }); } catch {}
    if (typeof prevTeardown === 'function') { try { prevTeardown(); } catch {} }
  };

  slide.__cleanupSlide = teardown;
  slide.__backdropImg = backdropImg;

  const horizontalGradientOverlay = createHorizontalGradientOverlay();
  const backdropContainer = document.createElement('div');
  backdropContainer.className = 'monwui-bckdrp-cntnr';
  backdropContainer.append(backdropImg, horizontalGradientOverlay);
  slide.__backdropContainer = backdropContainer;
  slide.append(backdropContainer);

  if (!slide.__trailerInit) {
   slide.__trailerInit = true;
   createTrailerIframe({ config, RemoteTrailers, slide, backdropImg, itemId, allowAutoTrailer: true });
 }

  const logoContainer = createLogoContainer();
  const order = config.showDiscOnly
    ? ["disk"]
    : config.showTitleOnly
      ? ["originalTitle"]
      : config.showLogoOrTitle
        ? config.displayOrder.split(",").map(item => item.trim())
        : [];

  function createImageElement({ className, src, fallback, styles = {} }) {
    const img = document.createElement("img");
    img.className = className;
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener('error', () => {
      img.remove();
      fallback?.();
    }, { once: true });
    Object.assign(img.style, styles);
    return img;
  }

  function createClearartElement(fallback) {
    return createImageElement({
      className: "monwui-clearart",
      src: clearartUrl,
      fallback,
      styles: {
        width: "auto",
        maxWidth: "min(420px, 55vw)",
        height: "auto",
        maxHeight: "clamp(80px, 14vh, 160px)",
        objectFit: "contain",
        display: "block"
      }
    });
  }

  function createLogoElement(fallback) {
    const logoImg = document.createElement("img");
    logoImg.className = "monwui-logo";
    logoImg.src = logoUrl;
    logoImg.alt = "";
    logoImg.loading = "lazy";
    logoImg.decoding = "async";
   logoImg.addEventListener('error', () => {
     logoImg.remove();
     fallback?.();
   }, { once:true });
    Object.assign(logoImg.style, {
      width: "auto",
      maxWidth: "min(420px, 55vw)",
      height: "auto",
      maxHeight: "clamp(60px, 12vh, 130px)",
      objectFit: "contain",
      display: "block"
    });
    return logoImg;
  }

  function createDiskElement(fallback) {
    return createImageElement({
      className: "monwui-disk",
      src: discUrl,
      fallback,
      styles: {
        maxWidth: "75%", maxHeight: "75%", width: "auto", objectFit: "contain", borderRadius: "50%", display: "block"
      }
    });
  }

  function createTitleElement() {
    const titleDiv = document.createElement("div");
    titleDiv.className = "monwui-no-logo-container";
    titleDiv.textContent = OriginalTitle;
    Object.assign(titleDiv.style, {
      display: "flex", alignItems: "center", justifyContent: "center"
    });
    return titleDiv;
  }

  function tryDisplayElement(index) {
    if (index >= order.length) return;
    const type = String(order[index] || "").trim().toLowerCase();
    if (type === "clearart" || type === "art") {
      const element = createClearartElement(() => {
        logoContainer.innerHTML = "";
        tryDisplayElement(index + 1);
      });
      logoContainer.appendChild(element);
    } else if (type === "logo") {
      const element = createLogoElement(() => {
        logoContainer.innerHTML = "";
        tryDisplayElement(index + 1);
      });
      logoContainer.appendChild(element);
    } else if (type === "disk") {
      const element = createDiskElement(() => {
        logoContainer.innerHTML = "";
        tryDisplayElement(index + 1);
      });
      logoContainer.appendChild(element);
    } else if (type === "originaltitle") {
      const element = createTitleElement();
      logoContainer.appendChild(element);
    } else {
      tryDisplayElement(index + 1);
    }
  }

  tryDisplayElement(0);

  const buttonContainer = createButtons(slide, config, UserData, itemId, RemoteTrailers, updatePlayedStatus, updateFavoriteStatus, openTrailerModal, item);
  const plotContainer = createPlotContainer(config, Overview, UserData, RunTimeTicks);
  const titleContainer = createTitleContainer({
  config,
  Taglines,
  title,
  OriginalTitle,
  Type: itemType,
  ParentIndexNumber: item.ParentIndexNumber,
  IndexNumber: item.IndexNumber
});

  const metaColorSeed = String(
    item?.Id || item?.Name || item?.BackdropImageTags?.[0] || Date.now()
  );
  slide.dataset.metaColorSeed = metaColorSeed;
  const statusContainer = createStatusContainer(config, UserData, RunTimeTicks);
  const formatContainer = createFormatContainer(itemType, config, ChildCount, MediaStreams, metaColorSeed);
  if (formatContainer && itemType === "Series") applyNewSeasonBadge(formatContainer, item, config.languageLabels);
  if (formatContainer && itemType === "Series") applySeriesQualityBadges(formatContainer, item, config);
  csMark("before-actors");
  const actorSlider = await createActorSlider(People, config, item);
  csMark("actors-done");
  const infoContainer = createInfoContainer({ config, Genres, ProductionYear, ProductionLocations });
  const directorContainer = await createDirectorContainer({ config, People, item });
  csMark("director-done");
  const { container: ratingContainer, ratingExists } = await createRatingContainer({
  config,
  CommunityRating,
  CriticRating,
  OfficialRating,
  UserData,
  item
});
  csMark("rating-done");
  const providerContainer = createProviderContainer({ config, ProviderIds, RemoteTrailers, itemId, slide, item });
  const languageContainer = createLanguageContainer({ config, MediaStreams, itemType });

  const metaContainer = createMetaContainer(metaColorSeed);
  if (statusContainer) metaContainer.appendChild(statusContainer);
  if (ratingExists) metaContainer.appendChild(ratingContainer);
  if (languageContainer) metaContainer.appendChild(languageContainer);
  const mainContentContainer = createMainContentContainer();
  mainContentContainer.append(logoContainer, titleContainer, plotContainer, providerContainer);
  slide.append(...[formatContainer, metaContainer, mainContentContainer, buttonContainer, actorSlider, infoContainer, directorContainer].filter(Boolean));
  const frag = document.createDocumentFragment();
  frag.appendChild(slide);
  const slideChildren = Array.from(slidesContainer.children).filter((child) => child.classList?.contains("monwui-slide"));
  const dotNav = Array.from(slidesContainer.children).find((child) => child.classList?.contains("monwui-dot-navigation-container")) || null;
  const hasExplicitInsertAt = Number.isInteger(insertAt) && insertAt >= 0;
  const refNode = hasExplicitInsertAt && insertAt < slideChildren.length
    ? slideChildren[insertAt]
    : dotNav;
  if (refNode) {
    slidesContainer.insertBefore(frag, refNode);
  } else {
    slidesContainer.appendChild(frag);
  }
  if (!suppressInitialDisplay && slideChildren.length === 0) {
    import("./navigation.js").then(mod => mod.displaySlide(0));
  }
  return slide;
}

function addSlideToSettingsBackground(itemId, backdropUrl) {
  const settingsSlider = document.getElementById("settingsBackgroundSlider");
  if (!settingsSlider) return;
  const existingSlide = settingsSlider.querySelector(`[data-item-id="${itemId}"]`);
  if (existingSlide) return;
  const slide = document.createElement("div");
  slide.className = "monwui-slide";
  slide.dataset.itemId = itemId;
  slide.style.backgroundImage = `url('${backdropUrl}')`;
  const img = new Image();
  img.src = backdropUrl;
  img.onerror = () => {
    if (slide.parentNode) {
      slide.parentNode.removeChild(slide);
    }
  };
  img.onload = () => { img.onload = img.onerror = null; };
  settingsSlider.appendChild(slide);
  if (settingsSlider.children.length === 1) {
    slide.classList.add("active");
  }
}

function buildStarLayer(useSolid) {
  const layer = document.createElement("span");
  layer.className = useSolid ? "monwui-trailer-star-fill" : "monwui-trailer-star-track";

  for (let i = 0; i < 5; i++) {
    const star = document.createElement("i");
    star.className = useSolid ? "fa-solid fa-star" : "fa-regular fa-star";
    layer.appendChild(star);
  }
  return layer;
}

const TRAILER_MODAL_CORE_STYLE_ID = "monwui-trailer-modal-core";
const TRAILER_MODAL_CORE_CSS = `
html body .monwui-trailer-modal-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(8,8,14,.84);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);padding:16px;box-sizing:border-box;transition:opacity .25s ease-in-out}
html body .monwui-trailer-modal{position:relative;display:flex;flex-direction:column;width:min(1100px,94vw);max-width:94vw;max-height:94vh;background:#141420;color:#fff;border-radius:14px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.65);transform:scale(.97);transition:transform .25s ease;outline:none}
html body .monwui-trailer-modal-overlay.is-open .monwui-trailer-modal{transform:scale(1)}
html body .monwui-trailer-modal-header{display:flex;align-items:center;gap:12px;flex:0 0 auto;padding:12px 16px;background:rgba(0,0,0,.55);border-bottom:1px solid rgba(255,255,255,.1)}
html body .monwui-trailer-modal-header h3{flex:1;min-width:0;margin:0 !important;text-align:center;font-size:1rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html body .monwui-trailer-modal-logo{flex:0 0 auto}
html body .monwui-trailer-modal-close{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;margin:0 !important;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:26px;line-height:1;cursor:pointer;transition:background .15s ease}
html body .monwui-trailer-modal-close:hover,html body .monwui-trailer-modal-close:focus-visible{background:rgba(255,255,255,.3);outline:2px solid rgba(255,255,255,.7);outline-offset:2px}
html body .monwui-trailer-video-container{position:relative;flex:0 1 auto;width:100%;height:auto !important;padding-bottom:0 !important;aspect-ratio:16/9;max-height:calc(94vh - 130px);background:#000;overflow:hidden}
html body .monwui-trailer-video-container iframe,html body .monwui-trailer-video-container video{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;object-fit:contain}
html body .monwui-trailer-error{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;opacity:.8}
html body .monwui-trailer-modal-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 20px;flex:0 0 auto;width:100%;box-sizing:border-box;padding:10px 20px;background:rgba(0,0,0,.35)}
html body .monwui-trailer-modal-footer .official-rating{white-space:nowrap}
html body .monwui-trailer-star-rating{display:inline-block;font-size:1.2rem;line-height:1;letter-spacing:1px;white-space:nowrap;color:transparent;-webkit-text-fill-color:transparent;background:linear-gradient(90deg,#ffc107 0,#ffc107 var(--monwui-star-pct,0%),rgba(255,255,255,.3) var(--monwui-star-pct,0%),rgba(255,255,255,.3) 100%);-webkit-background-clip:text;background-clip:text}
html body .monwui-trailer-loading{position:absolute;top:50%;left:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border:5px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:monwui-trailer-spin 1s ease-in-out infinite;z-index:10}
@keyframes monwui-trailer-spin{to{transform:rotate(360deg)}}
@media (max-width:768px){
html body .monwui-trailer-modal-overlay{padding:8px}
html body .monwui-trailer-modal{width:96vw;max-width:96vw}
html body .monwui-trailer-modal-header h3{font-size:.85rem}
html body .monwui-trailer-modal-logo{max-width:110px !important;height:30px !important}
}
`;

function ensureTrailerModalCoreStyle() {
  if (document.getElementById(TRAILER_MODAL_CORE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TRAILER_MODAL_CORE_STYLE_ID;
  style.textContent = TRAILER_MODAL_CORE_CSS;
  document.head.appendChild(style);
}

function openTrailerModal(trailerUrl, trailerName, itemName = '', itemType = '', isFavorite = false, itemId = null, updateFavoriteCallback = null, CommunityRating = null, CriticRating = null, OfficialRating = null) {
  document.querySelectorAll(".monwui-trailer-modal-overlay").forEach((el) => { try { el.__jmsClose?.(); } catch {} });
  const embedUrl = getYoutubeEmbedUrl(trailerUrl);
  const sep = embedUrl.includes('?') ? '&' : '?';
  const logoUrl = withServer(`/Items/${itemId}/Images/Logo?maxHeight=200&quality=90`);
  const overlay = document.createElement("div");
  overlay.className = "monwui-trailer-modal-overlay";
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 0.3s ease-in-out";

  const modal = document.createElement("div");
  modal.className = "monwui-trailer-modal";

  const modalHeader = document.createElement("div");
  modalHeader.className = "monwui-trailer-modal-header";

  const logoContainer = document.createElement("div");
  logoContainer.className = "monwui-trailer-modal-logo";
  logoContainer.style.display = "flex";
  logoContainer.style.alignItems = "center";
  logoContainer.style.height = "40px";
  logoContainer.style.maxWidth = "200px";
  logoContainer.style.marginRight = "auto";

  const logoImg = document.createElement("img");
  logoImg.src = logoUrl;
  logoImg.alt = itemName;
  logoImg.style.maxHeight = "100%";
  logoImg.style.maxWidth = "100%";
  logoImg.style.objectFit = "contain";
  logoImg.style.display = "block";

  logoImg.onerror = () => {
    logoContainer.style.display = "none";
  };

  logoContainer.appendChild(logoImg);

  const titleElement = document.createElement("h3");
  const itemDisplayName = itemName ? itemName : 'Bilinmeyen İçerik';
  titleElement.textContent = `${itemDisplayName} - ${config.languageLabels.fragman}`;
  titleElement.style.margin = "0";
  titleElement.style.marginLeft = "15px";
  titleElement.style.flex = "1";
  titleElement.style.textAlign = "center";

  const closeBtn = document.createElement("button");
  closeBtn.className = "monwui-trailer-modal-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.marginLeft = "auto";

  modalHeader.append(logoContainer, titleElement, closeBtn);

  const videoContainer = document.createElement("div");
  videoContainer.className = "monwui-trailer-video-container";

  const loadingSpinner = document.createElement("div");
  loadingSpinner.className = "monwui-trailer-loading";
  videoContainer.appendChild(loadingSpinner);

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const mediaState = { iframe: null, video: null };
  let modalClosed = false;

  const showMediaError = () => {
    loadingSpinner.style.display = "none";
    if (videoContainer.querySelector(".monwui-trailer-error")) return;
    const box = document.createElement("div");
    box.className = "monwui-trailer-error";
    box.textContent = config.languageLabels?.fragman
      ? `${config.languageLabels.fragman}: indisponivel`
      : "Trailer indisponivel";
    videoContainer.appendChild(box);
  };

  const mountYoutube = () => {
    if (modalClosed || mediaState.iframe) return;
    if (!trailerUrl || typeof embedUrl !== "string" || !embedUrl) {
      showMediaError();
      return;
    }
    let finalEmbedUrl = embedUrl;
    try {
      const u = new URL(finalEmbedUrl, window.location.origin);
      u.searchParams.set("autoplay", "1");
      u.searchParams.set("mute", "0");
      u.searchParams.set("playsinline", "1");
      u.searchParams.set("enablejsapi", "1");
      u.searchParams.set("origin", window.location.origin);
      finalEmbedUrl = u.toString();
    } catch {}

    const iframe = document.createElement("iframe");
    iframe.src = finalEmbedUrl;
    iframe.title = trailerName || "";
    iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
    iframe.referrerPolicy = "origin-when-cross-origin";
    iframe.setAttribute("playsinline", "true");
    iframe.onload = () => {
      loadingSpinner.style.display = "none";
      try {
        iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', "*");
      } catch {}
      // O iframe do YouTube captura o teclado; devolve o foco ao botao fechar
      // para que o ESC continue chegando ao documento logo apos o carregamento.
      try { closeBtn.focus({ preventScroll: true }); } catch {}
      if (isMobile) setTimeout(() => {
        try {
          iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', "*");
        } catch {}
      }, 400);
    };
    mediaState.iframe = iframe;
    videoContainer.appendChild(iframe);
  };

  const mountLocalVideo = (src) => {
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("controlsList", "nodownload");
    video.addEventListener("loadeddata", () => {
      loadingSpinner.style.display = "none";
    }, { once: true });
    video.addEventListener("error", () => {
      // Codec sem suporte ou arquivo inacessivel: cai para o player do YouTube.
      try { video.removeAttribute("src"); video.load(); } catch {}
      try { video.remove(); } catch {}
      mediaState.video = null;
      mountYoutube();
    }, { once: true });
    video.src = src;
    mediaState.video = video;
    videoContainer.appendChild(video);
    const p = video.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };

  const buildLocalTrailerSrc = (trailerId) => {
    let token = "";
    try { token = getSessionInfo()?.accessToken || ""; } catch {}
    const q = new URLSearchParams({ static: "true", MediaSourceId: String(trailerId) });
    if (token) q.set("ApiKey", token);
    return withServer(`/Videos/${encodeURIComponent(trailerId)}/stream?${q.toString()}`);
  };

  (async () => {
    try {
      let src = null;
      if (itemId) {
        const list = await fetchLocalTrailers(itemId);
        const best = pickBestLocalTrailer(list);
        if (best?.Id) src = buildLocalTrailerSrc(best.Id);
      }
      if (modalClosed) return;
      if (src) mountLocalVideo(src);
      else mountYoutube();
    } catch {
      mountYoutube();
    }
  })();
  const modalFooter = document.createElement("div");
  modalFooter.className = "monwui-trailer-modal-footer";
  modalFooter.style.display = "flex";
  modalFooter.style.justifyContent = "space-between";
  modalFooter.style.alignItems = "center";
  modalFooter.style.width = "100%";
  modalFooter.style.padding = "10px 20px";
  modalFooter.style.boxSizing = "border-box";

  const infoContainer = document.createElement("div");
  infoContainer.style.display = "flex";
  infoContainer.style.gap = "8px";

  const itemTitleElement = document.createElement("div");
  const contentType = itemType === 'Movie' ? config.languageLabels.film :
                    itemType === 'Series' ? config.languageLabels.dizi :
                    itemType === 'Episode' ? config.languageLabels.dizi :
                    "İçerik: ";
  itemTitleElement.textContent = `${contentType}: ${itemDisplayName}`;
  itemTitleElement.style.fontWeight = "bold";
  infoContainer.appendChild(itemTitleElement);
  const ratingContainer = document.createElement("div");
  ratingContainer.style.display = "flex";
  ratingContainer.style.gap = "15px";
  ratingContainer.style.alignItems = "center";

  if (CommunityRating != null) {
    let rating10 = Array.isArray(CommunityRating)
      ? (CommunityRating.reduce((a, b) => a + b, 0) / CommunityRating.length)
      : CommunityRating;
    rating10 = Math.max(0, Math.min(10, Number(rating10) || 0));

    const rating5 = rating10 / 2;
    const fillPercent = (rating5 / 5) * 100;

    const communityRatingElement = document.createElement("div");
    communityRatingElement.style.display = "flex";
    communityRatingElement.style.alignItems = "center";
    communityRatingElement.style.gap = "8px";

    const starWrap = document.createElement("span");
    starWrap.className = "monwui-trailer-star-rating";
    starWrap.setAttribute("aria-label", `${rating5.toFixed(1)} / 5`);

    // Uma unica camada: o texto das 5 estrelas recebe um gradiente com corte duro
    // na porcentagem da nota. Evita o desalinhamento entre duas camadas de icones.
    starWrap.textContent = "\u2605\u2605\u2605\u2605\u2605";
    starWrap.style.setProperty("--monwui-star-pct", `${fillPercent.toFixed(1)}%`);

    const ratingText = document.createElement("span");
    ratingText.textContent = `${rating5.toFixed(1)} / 5`;

    communityRatingElement.appendChild(starWrap);
    communityRatingElement.appendChild(ratingText);
    ratingContainer.appendChild(communityRatingElement);
  }

  if (CriticRating) {
    const criticRatingElement = document.createElement("div");
    criticRatingElement.style.display = "flex";
    criticRatingElement.style.alignItems = "center";
    criticRatingElement.style.gap = "5px";

    const tomatoIcon = createTomatoIconElement();

    const ratingValue = document.createElement("span");
    ratingValue.textContent = `${CriticRating}%`;

    criticRatingElement.appendChild(tomatoIcon);
    criticRatingElement.appendChild(ratingValue);
    ratingContainer.appendChild(criticRatingElement);
}

  if (OfficialRating) {
    const officialRatingElement = document.createElement("div");
    officialRatingElement.className = "official-rating";
    officialRatingElement.textContent = OfficialRating;
    officialRatingElement.style.padding = "2px 5px";
    officialRatingElement.style.borderRadius = "3px";
    officialRatingElement.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
    officialRatingElement.style.fontSize = "0.9em";
    ratingContainer.appendChild(officialRatingElement);
  }

  if (itemId && updateFavoriteCallback) {
    const favoriteContainer = document.createElement("div");
    favoriteContainer.style.cursor = "pointer";

    const initiallyFav = Boolean(isFavorite);
    const favoriteIcon = document.createElement("i");
    favoriteIcon.className = initiallyFav
      ? "fa-solid fa-heart"
      : "fa-regular fa-heart";
    favoriteIcon.style.color = initiallyFav ? "#FFC107" : "#fff";

    const favoriteText = document.createElement("span");
    favoriteText.textContent = getWatchlistButtonText({ Type: itemType }, initiallyFav);

    favoriteContainer.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!itemId || !updateFavoriteCallback) return;

      const newFavoriteStatus = !favoriteIcon.classList.contains("fa-solid");
      try {
        await updateFavoriteCallback(itemId, newFavoriteStatus, { item: { Id: itemId, Type: itemType, Name: itemName } });
        favoriteIcon.className = newFavoriteStatus
          ? "fa-solid fa-heart"
          : "fa-regular fa-heart";
        favoriteIcon.style.color = newFavoriteStatus ? "#FFC107" : "#fff";
        favoriteText.textContent = getWatchlistButtonText({ Type: itemType }, newFavoriteStatus);
        favoriteIcon.style.transform = "scale(1.2)";
        setTimeout(() => (favoriteIcon.style.transform = ""), 200);
      } catch (err) {
        console.error("Favori durumu güncellenirken hata:", err);
      }
    });

    favoriteContainer.appendChild(favoriteIcon);
    favoriteContainer.appendChild(favoriteText);
    infoContainer.appendChild(favoriteContainer);
  }

  modalFooter.appendChild(infoContainer);
  modalFooter.appendChild(ratingContainer);

  modal.append(modalHeader, videoContainer, modalFooter);
  overlay.appendChild(modal);

  ensureTrailerModalCoreStyle();

  // Pausa o trailer do card e o timer do slider enquanto o modal esta aberto.
  const pausedVideos = [];
  const pausedFrames = [];
  let timerApi = null;
  const pauseBackground = () => {
    try {
      document.querySelectorAll("#monwui-slides-container video").forEach((v) => {
        if (!v.paused) { v.pause(); pausedVideos.push(v); }
      });
      document.querySelectorAll("#monwui-slides-container iframe").forEach((f) => {
        try {
          f.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', "*");
          pausedFrames.push(f);
        } catch {}
      });
    } catch {}
    import("./timer.js").then((m) => {
      timerApi = m;
      if (!modalClosed) { try { m.pauseSlideTimer?.(); } catch {} }
      else { try { m.resumeSlideTimer?.(); } catch {} }
    }).catch(() => {});
  };
  const restoreBackground = () => {
    pausedVideos.forEach((v) => { try { v.play?.()?.catch?.(() => {}); } catch {} });
    pausedFrames.forEach((f) => {
      try { f.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', "*"); } catch {}
    });
    try { timerApi?.resumeSlideTimer?.(); } catch {}
  };

  const escListener = (e) => {
    if (e.key === "Escape" || e.keyCode === 27) {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    }
  };

  const closeModal = () => {
    if (modalClosed) return;
    modalClosed = true;
    window.removeEventListener("keydown", escListener, true);
    overlay.classList.remove("is-open");
    overlay.style.opacity = "0";
    // Para a midia imediatamente (nao espera a transicao).
    try { mediaState.video?.pause(); } catch {}
    try { if (mediaState.video) { mediaState.video.removeAttribute("src"); mediaState.video.load(); } } catch {}
    try { if (mediaState.iframe) mediaState.iframe.src = "about:blank"; } catch {}
    restoreBackground();
    setTimeout(() => {
      try { overlay.remove(); } catch {}
    }, 260);
  };
  overlay.__jmsClose = closeModal;

  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeModal();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.tabIndex = -1;

  // Captura na window: funciona mesmo que outro handler pare a propagacao.
  window.addEventListener("keydown", escListener, true);
  document.body.appendChild(overlay);
  pauseBackground();

  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    overlay.classList.add("is-open");
    try { closeBtn.focus({ preventScroll: true }); } catch {}
  });

  return {
    close: closeModal,
    getIframe: () => mediaState.iframe
  };
}

export { createSlide, openTrailerModal };
