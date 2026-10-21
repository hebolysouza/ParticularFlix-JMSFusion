import { getConfig } from "./config.js";
import {
  fetchItemDetails,
  getIntroVideoUrl,
  getVideoStreamUrl,
  fetchLocalTrailers,
  pickBestLocalTrailer,
  getAuthHeader,
  playNow,
} from "../../Plugins/JMSFusion/runtime/api.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { withServer, withServerSrcset, invalidateServerBaseCache, resolveServerBase } from "./jfUrl.js";

const config = getConfig();
const PLAYBACK_START_REQUESTED_EVENT = "jms:playback-start-requested";
const AUTO_TRAILER_BLOCKED_FLAG = "__JMS_AUTO_TRAILER_PLAYBACK_BLOCKED";
const S = (u) => {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return withServer(u);
};

function ensureAudioPreviewCssOnce() {
  if (document.getElementById("jms-audio-preview-css")) return;
  const style = document.createElement("style");
  style.id = "jms-audio-preview-css";
  style.textContent = `
    .jms-audio-preview-overlay {
      align-items: flex-end;
      background:
        radial-gradient(circle at 76% 22%, rgba(255,255,255,.14), transparent 24%),
        linear-gradient(180deg, rgba(6,10,18,.12), rgba(6,10,18,.58));
      display: none;
      inset: 0;
      justify-content: flex-start;
      pointer-events: none;
      position: absolute;
      z-index: 3;
    }
    .jms-audio-preview-overlay__panel {
      backdrop-filter: blur(6px);
      background: linear-gradient(135deg, rgba(10,18,26,.78), rgba(19,31,43,.56));
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 16px;
      box-shadow: 0 18px 36px rgba(0,0,0,.24);
      color: #f5f8fb;
      display: flex;
      gap: 10px;
      margin: 18px;
      padding: 14px 16px;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      max-width: min(360px, calc(100% - 36px));
  }
    .jms-audio-preview-overlay__eyebrow {
      align-items: center;
      color: rgba(235,244,255,.72);
      display: inline-flex;
      font-size: 11px;
      font-weight: 700;
      gap: 8px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .jms-audio-preview-overlay__title {
      display: -webkit-box;
      font-size: 20px;
      font-weight: 700;
      line-height: 1.08;
      margin: 0;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .jms-audio-preview-overlay__subtitle {
      color: rgba(232,241,247,.78);
      display: -webkit-box;
      font-size: 13px;
      line-height: 1.35;
      margin: 0;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .jms-audio-preview-overlay__bars {
      align-items: end;
      display: flex;
      gap: 5px;
      height: 22px;
    }
    .jms-audio-preview-overlay__bars span {
      animation: jms-audio-preview-bars 1.4s ease-in-out infinite;
      background: linear-gradient(180deg, rgba(255,255,255,.94), rgba(94,214,177,.86));
      border-radius: 999px;
      display: block;
      height: 100%;
      transform-origin: center bottom;
      width: 4px;
    }
    .jms-audio-preview-overlay__bars span:nth-child(2) { animation-delay: .16s; }
    .jms-audio-preview-overlay__bars span:nth-child(3) { animation-delay: .32s; }
    .jms-audio-preview-overlay__bars span:nth-child(4) { animation-delay: .48s; }
    @keyframes jms-audio-preview-bars {
      0%, 100% { transform: scaleY(.38); opacity: .62; }
      45% { transform: scaleY(1); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .jms-audio-preview-overlay__bars span { animation: none; transform: scaleY(.72); }
    }
    .monwui-auto-trailer-toggle {
      align-items: center;
      background: rgba(8,12,18,.64);
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 999px;
      color: #fff;
      cursor: pointer;
      display: none;
      height: 42px;
      justify-content: center;
      position: absolute;
      right: 14px;
      top: 48px;
      width: 42px;
      z-index: 8;
      backdrop-filter: blur(8px);
      box-shadow: 0 10px 24px rgba(0,0,0,.28);
    }
    .monwui-auto-trailer-toggle:hover {
      background: rgba(18,24,34,.78);
      transform: translateY(-1px);
    }
    .monwui-auto-trailer-toggle i {
      font-size: 14px;
      line-height: 1;
    }
    .monwui-preview-volume-control {
      display: none;
      position: absolute;
      right: 14px;
      top: 48px;
      z-index: 8;
    }
    .monwui-preview-volume-toggle {
      align-items: center;
      background: rgba(8,12,18,.64);
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 999px;
      color: #fff;
      cursor: pointer;
      display: flex;
      height: 42px;
      justify-content: center;
      position: relative;
      width: 42px;
      backdrop-filter: blur(8px);
      box-shadow: 0 10px 24px rgba(0,0,0,.28);
    }
    .monwui-preview-volume-toggle:hover {
      background: rgba(18,24,34,.78);
      transform: translateY(-1px);
    }
    .monwui-preview-volume-toggle i {
      font-size: 14px;
      line-height: 1;
    }
    .monwui-preview-volume-panel {
      align-items: center;
      background: rgba(8,12,18,.72);
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 999px;
      box-shadow: 0 10px 24px rgba(0,0,0,.28);
      display: none;
      height: 42px;
      padding: 0 12px;
      position: absolute;
      right: 42px;
      top: 0;
      width: 148px;
      backdrop-filter: blur(8px);
    }
    .monwui-preview-volume-control:hover .monwui-preview-volume-panel {
      display: flex;
    }
    .monwui-preview-volume-range {
      accent-color: #fff;
      cursor: pointer;
      width: 124px;
    }
    .monwui-preview-fullscreen-toggle {
      align-items: center;
      background: rgba(8,12,18,.5);
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 999px;
      box-shadow: 0 8px 20px rgba(0,0,0,.24);
      color: #fff;
      cursor: pointer;
      display: none;
      height: 34px;
      justify-content: center;
      opacity: .75;
      position: absolute;
      top: 96px;
      transition: opacity .15s ease;
      width: 34px;
      z-index: 8;
      backdrop-filter: blur(8px);
    }
    .monwui-preview-fullscreen-toggle:hover {
      opacity: 1;
    }
    .monwui-preview-fullscreen-toggle i {
      font-size: 12px;
      line-height: 1;
    }
    .intro-video-container:fullscreen {
      border-radius: 0 !important;
      height: 100% !important;
      inset: 0 !important;
      mask-image: none !important;
      -webkit-mask-image: none !important;
      width: 100% !important;
    }
    .intro-video-container:-webkit-full-screen {
      border-radius: 0 !important;
      height: 100% !important;
      inset: 0 !important;
      mask-image: none !important;
      -webkit-mask-image: none !important;
      width: 100% !important;
    }
    .monwui-slide .intro-video-container:fullscreen video {
      height: 100% !important;
      min-height: 0 !important;
      min-width: 0 !important;
      object-fit: contain !important;
      width: 100% !important;
    }
    .monwui-slide .intro-video-container:-webkit-full-screen video {
      height: 100% !important;
      min-height: 0 !important;
      min-width: 0 !important;
      object-fit: contain !important;
      width: 100% !important;
    }
  `;
  document.head.appendChild(style);
}

function isAutoTrailerPlaybackBlocked() {
  try {
    return window[AUTO_TRAILER_BLOCKED_FLAG] === true;
  } catch {
    return false;
  }
}

function blockAutoTrailerPlayback() {
  try {
    window[AUTO_TRAILER_BLOCKED_FLAG] = true;
  } catch {}
}

function readBoolConfigValue(sourceConfig, key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return raw === "true";
  } catch {}
  const value = sourceConfig?.[key];
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function readPercentConfigValue(sourceConfig, key, fallback = 50) {
  let raw = sourceConfig?.[key];
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null && stored !== "") raw = stored;
  } catch {}
  const parsed = Number.parseFloat(String(raw ?? fallback).replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

export function getPreviewTrailerAudioState({
  config: sourceConfig = null,
  soundOn = true,
  mutedByDevice = false,
  ignoreStartMuted = false,
} = {}) {
  const cfg = sourceConfig || getConfig() || {};
  const startMuted = readBoolConfigValue(cfg, "previewTrailerStartMuted", false);
  const volumeLimitEnabled = readBoolConfigValue(cfg, "previewTrailerVolumeLimit", false);
  const volumePercent = readPercentConfigValue(cfg, "previewTrailerVolumePercent", 50);
  const effectivePercent = volumeLimitEnabled ? volumePercent : 100;
  const muted =
    mutedByDevice === true ||
    soundOn === false ||
    (!ignoreStartMuted && startMuted) ||
    effectivePercent <= 0;

  return {
    startMuted,
    volumeLimitEnabled,
    volumePercent,
    effectivePercent,
    volume: muted ? 0 : effectivePercent / 100,
    muted,
  };
}

export function applyPreviewTrailerAudioToVideo(video, opts = {}) {
  const audioState = getPreviewTrailerAudioState(opts);
  if (!video) return audioState;
  try {
    video.muted = audioState.muted;
    video.volume = audioState.muted ? 0 : audioState.volume;
  } catch {}
  return audioState;
}

export function setYouTubeUrlPreviewAudio(url, opts = {}) {
  const audioState = getPreviewTrailerAudioState(opts);
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set("mute", audioState.muted ? "1" : "0");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function applyPreviewTrailerAudioToYouTubePlayer(player, opts = {}) {
  const audioState = getPreviewTrailerAudioState(opts);
  if (!player) return audioState;
  try {
    if (audioState.muted) {
      player.mute?.();
    } else {
      player.unMute?.();
      player.setVolume?.(Math.round(audioState.effectivePercent));
    }
  } catch {}
  return audioState;
}

export function postPreviewTrailerAudioToYouTubeIframe(iframe, opts = {}) {
  const audioState = getPreviewTrailerAudioState(opts);
  try {
    const post = (func, args = []) => {
      iframe?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "*"
      );
    };
    if (audioState.muted) {
      post("mute");
    } else {
      post("unMute");
      post("setVolume", [Math.round(audioState.effectivePercent)]);
    }
  } catch {}
  return audioState;
}

export function getYoutubeEmbedUrl(input) {
  if (!input || typeof input !== "string") return input;

  const canUseOriginAndJSAPI = (() => {
    try {
      const origin = window.location?.origin || "";
      return /^https?:\/\//i.test(origin);
    } catch {
      return false;
    }
  })();

  if (/^[a-zA-Z0-9_-]{10,}$/.test(input) && !/youtu\.?be|youtube\.com/i.test(input)) {
    const params = new URLSearchParams({
      autoplay: "1",
      rel: "0",
      modestbranding: "1",
      iv_load_policy: "3",
      enablejsapi: canUseOriginAndJSAPI ? "1" : "0",
      playsinline: "1",
      mute: "0",
      controls: "1",
    });

    try {
      const orig = window.location?.origin || "";
        if (canUseOriginAndJSAPI && orig && /^https?:\/\//i.test(orig)) {
          params.set("origin", orig);
        }
      } catch {}
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(input)}?${params.toString()}`;
  }

  const isMobile = (() => {
    try {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
             (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 1024);
    } catch { return false; }
  })();

  const parseYouTubeTime = (t) => {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!m) return 0;
    const h = parseInt(m[1] || "0", 10);
    const min = parseInt(m[2] || "0", 10);
    const s = parseInt(m[3] || "0", 10);
    return h * 3600 + min * 60 + s;
  };

  const ensureUrl = (raw) => {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    const lower = raw.toLowerCase();
    const isYT = /\b(youtu\.be|youtube\.com)\b/.test(lower);
    const scheme = (() => {
      try { return window.location.protocol === "https:" ? "https:" : "http:"; } catch { return "http:"; }
    })();
    return `${scheme}//${raw}`;
  };

  let parsed;
  try {
    parsed = new URL(ensureUrl(input));
  } catch {
    return input;
  }

  const ytHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube = ytHost === "youtu.be" || ytHost.endsWith("youtube.com");
  if (!isYouTube) return input;

  let videoId = "";
  if (ytHost === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else {
    if (parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/").filter(Boolean)[1] || "";
    } else if (parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.split("/").filter(Boolean)[1] || "";
    } else {
      videoId = parsed.searchParams.get("v") || "";
    }
  }
  if (!videoId) return input;

  const startParam = parsed.searchParams.get("start");
  const tParam = parsed.searchParams.get("t");
  const start = startParam ? parseInt(startParam, 10) : parseYouTubeTime(tParam);

  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
    enablejsapi: canUseOriginAndJSAPI ? "1" : "0",
    playsinline: "1",
    mute: "0",
    controls: "1",
  });
  try {
    const orig = (typeof window !== "undefined" && window.location?.origin) || "";
    if (canUseOriginAndJSAPI && orig && /^https?:\/\//i.test(orig)) {
      params.set("origin", orig);
    }
  } catch {}

  if (Number.isFinite(start) && start > 0) params.set("start", String(start));

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
    videoId
  )}?${params.toString()}`;
}

export function getProviderUrl(provider, id, slug = "") {
  if (!provider || !id) return "#";

  const normalizedProvider = provider.toString().trim().toLowerCase();
  const cleanId = id.toString().trim();
  const cleanSlug = slug.toString().trim();

  switch (normalizedProvider) {
    case "imdb":
      return `https://www.imdb.com/title/${cleanId}/`;
    case "tmdb":
      return `https://www.themoviedb.org/movie/${cleanId}`;
    case "tvdb": {
      const pathSegment = cleanSlug || cleanId;
      const isSeries = /series/i.test(pathSegment) || /^series[-_]/i.test(pathSegment);
      return `https://www.thetvdb.com/${isSeries ? "series" : "movies"}/${pathSegment}`;
    }
    default:
      return "#";
  }
}

export function debounce(func, wait = 300, immediate = false) {
  let timeout;
  return function (...args) {
    const context = this;
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

export function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function __jmsIsHoverDesktop() {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
  } catch { return false; }
}

export function ensureJmsDetailsOverlay({
  hostEl,
  itemId,
  serverId,
  detailsHref,
  onDetails,
  onPlay,
  showPlay = true,
} = {}) {
  if (!hostEl || !itemId) return null;

  const _detailsHref =
    detailsHref ||
    (itemId && serverId ? `#/details?id=${itemId}&serverId=${encodeURIComponent(serverId)}` : null);

  try {
    const cs = getComputedStyle(hostEl);
    if (cs.position === "static") hostEl.style.position = "relative";
  } catch {}

  let wrap = hostEl.querySelector(".jms-details-overlay");
  if (wrap) return wrap;

  const isHoverDesktop = __jmsIsHoverDesktop();

  wrap = document.createElement("div");
  wrap.className = "jms-details-overlay";
  Object.assign(wrap.style, {
    position: "absolute",
    left: "clamp(10px, 1vw, 22px)",
    bottom: "clamp(10px, 1vw, 22px)",
    pointerEvents: "none",
    display: "flex",
    gap: "10px",
    alignItems: "center",
  });

  if (isHoverDesktop) {
    wrap.dataset.hoverOnly = "1";
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jms-details-btn";
  btn.setAttribute("aria-label", "Ayrıntılar");

  const arrowIcon = document.createElement("span");
  arrowIcon.className = "jms-details-arrow";
  arrowIcon.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 5v14M5 12l7 7 7-7"/>
    </svg>
  `;
  btn.appendChild(arrowIcon);

  Object.assign(btn.style, {
    pointerEvents: "auto",
    cursor: "pointer",
    borderRadius: "50%",
    padding: "16px",
    border: "2px solid rgba(255,255,255,0.25)",
    background: "rgba(15,23,42)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  });

  if (isHoverDesktop) {
    btn.style.opacity = "0";
    btn.style.transform = "translateY(4px)";
    btn.style.pointerEvents = "none";
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (typeof onDetails === "function") {
      try { await onDetails(e); return; } catch {}
    }

    if (_detailsHref) {
      try { window.location.hash = String(_detailsHref).replace(/^#/, ""); }
      catch { window.location.href = _detailsHref; }
    }
  });

  wrap.appendChild(btn);

  if (showPlay) {
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "jms-play-btn";
    playBtn.setAttribute("aria-label", "Şimdi Oynat");
    playBtn.innerHTML = `
      <span class="jms-play-icon" style="display:flex;align-items:center;justify-content:center;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z"></path>
        </svg>
      </span>
    `;
    Object.assign(playBtn.style, {
      pointerEvents: "auto",
      cursor: "pointer",
      borderRadius: "50%",
      padding: "16px",
      border: "2px solid rgba(255,255,255,0.25)",
      background: "rgba(15,23,42)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "26px",
      height: "26px",
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    });

    if (isHoverDesktop) {
      playBtn.style.opacity = "0";
      playBtn.style.transform = "translateY(4px)";
      playBtn.style.pointerEvents = "none";
    }

    playBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onPlay === "function") {
        try { await onPlay(); } catch {}
      }
    });

  wrap.appendChild(playBtn);
  }

  hostEl.appendChild(wrap);

  if (isHoverDesktop) {
    const show = () => wrap.classList.add("is-hover");
    const hide = () => wrap.classList.remove("is-hover");
    hostEl.addEventListener("mouseenter", show, { passive: true });
    hostEl.addEventListener("mouseleave", hide, { passive: true });
    try {
      if (hostEl.matches(":hover")) show();
    } catch {}
  }
  return wrap;
}

export function createTrailerIframe({
  config,
  RemoteTrailers,
  slide,
  backdropImg,
  itemId,
  previewItemId = null,
  serverId,
  detailsUrl,
  detailsText,
  showDetailsOverlay = true,
  allowAutoTrailer = false,
}) {
  const normalizePreviewPlaybackMode = (value) => (
    value === "trailer" ||
    value === "video" ||
    value === "trailerThenVideo" ||
    value === "none"
  ) ? value : null;

  const liveMode = normalizePreviewPlaybackMode(localStorage.getItem("previewPlaybackMode"));

  if (config?.disableAllPlayback === true || liveMode === "none") {
    try {
      slide?.classList.remove("video-active", "intro-active", "trailer-active");
      if (backdropImg) backdropImg.style.opacity = "1";
    } catch {}
    return;
  }

  try {
    const cs = getComputedStyle(slide);
    if (cs.position === "static") slide.style.position = "relative";
  } catch {}
  ensureAudioPreviewCssOnce();

  const _detailsHref =
  detailsUrl ||
  (itemId && serverId ? `#/details?id=${itemId}&serverId=${encodeURIComponent(serverId)}` : null);

  const previewMediaItemId = previewItemId || itemId;

  let arrowIntervalId = null;

  function ensureDetailsOverlay() {
    if (!showDetailsOverlay) return null;
    if (!_detailsHref || !slide) return null;
    const wrap = ensureJmsDetailsOverlay({
      hostEl: slide,
      itemId,
      serverId,
      detailsHref: _detailsHref,
      onDetails: async (e) => {
  try {
    isMouseOver = false;
    latestHoverId++;
    abortController?.abort?.("details-modal");
    abortController = new AbortController();
    if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
    try { fullCleanup(); } catch {}
    const backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
    const origin = backdropImg || slide;

    await openDetailsModal({
      itemId,
      serverId,
      preferBackdropIndex: backdropIndex,
      originEl: origin
    });
  } catch (err) {
    console.error("openDetailsModal error:", err);
    navigateToDetails();
  }
},
      onPlay: async () => {
        try {
          isMouseOver = false;
          latestHoverId++;
          abortController?.abort?.("playnow");
          abortController = new AbortController();
          if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
          try { fullCleanup(); } catch {}
          await playNow(itemId);
        } catch (err) {
          console.error("PlayNow click error:", err);
          if (typeof window.showMessage === "function") {
            window.showMessage("PlayNow çalıştırılırken hata oluştu", "error");
          }
        }
      },
      showPlay: true,
    });
    return wrap;
  }

    function navigateToDetails() {
    try {
      isMouseOver = false;
      latestHoverId++;
      abortController?.abort?.("navigate");
      abortController = new AbortController();
      if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
    } catch {}

    try { fullCleanup(); } catch {}
    try { detachGuards?.(); } catch {}
    try { classObserver?.disconnect(); } catch {}

    try {
      window.location.hash = String(_detailsHref || "").replace(/^#/, "");
    } catch {
      window.location.href = _detailsHref;
    }
  }

  function showDetailsOverlay() {
    const wrap = ensureDetailsOverlay();
    if (wrap) wrap.style.display = "flex";
  }

  function hideDetailsOverlay() {
    const wrap = slide?.querySelector?.(".jms-details-overlay");
    if (wrap) wrap.style.display = "none";
  }

  const isActiveSlide = () => slide?.classList?.contains('active');
  const mode =
    normalizePreviewPlaybackMode(liveMode) ||
    normalizePreviewPlaybackMode(config?.previewPlaybackMode) ||
    (config?.enableTrailerPlayback
      ? "trailer"
      : config?.enableTrailerThenVideo
      ? "trailerThenVideo"
      : "video");

  if (!itemId) return;

  const videoContainer = document.createElement("div");
  videoContainer.className = "intro-video-container";
  videoContainer.style.display = "none";

  const videoElement = document.createElement("video");
  videoElement.controls = false;
  videoElement.controlsList = "nodownload nofullscreen noremoteplayback noplaybackrate";
  videoElement.disablePictureInPicture = true;
  videoElement.disableRemotePlayback = true;
  videoElement.addEventListener("contextmenu", (event) => event.preventDefault());
  videoElement.dataset.jmsPreview = "1";
  videoElement.dataset.jmsIgnorePauseOverlay = "1";
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.style.width = "100%";
  videoElement.style.height = "100%";
  videoElement.style.transition = "opacity 0.2s ease-in-out";
  videoElement.style.opacity = "0";
  applyPreviewTrailerAudioToVideo(videoElement, { config });

  videoContainer.appendChild(videoElement);

  const audioOverlay = document.createElement("div");
  audioOverlay.className = "jms-audio-preview-overlay";
  audioOverlay.innerHTML = `
    <div class="jms-audio-preview-overlay__panel">
      <div class="jms-audio-preview-overlay__eyebrow">
        <i class="fa-solid fa-wave-square"></i>
        <span>${config?.languageLabels?.track || "Parça"}</span>
      </div>
      <div class="jms-audio-preview-overlay__title"></div>
      <div class="jms-audio-preview-overlay__subtitle"></div>
      <div class="jms-audio-preview-overlay__bars" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  videoContainer.appendChild(audioOverlay);

  const backdropContainer = slide?.__backdropContainer || slide?.querySelector?.(".bckdrp-cntnr");
  (backdropContainer || slide).appendChild(videoContainer);

  function setPreviewPlaybackFlag(kind, itemId) {
  try {
    window.__JMS_PREVIEW_PLAYBACK = {
      active: true,
      kind,
      itemId: itemId || null,
      startedAt: Date.now()
    };
  } catch {}
}

function clearPreviewPlaybackFlag() {
  try {
    const cur = window.__JMS_PREVIEW_PLAYBACK;
    if (cur) window.__JMS_PREVIEW_PLAYBACK = { active: false };
  } catch {}
}

  let ytIframe = null;
  let playingKind = null;
  let isMouseOver = false;
  let latestHoverId = 0;
  let abortController = new AbortController();
  let enterTimeout = null;
  let detachGuards = null;
  let ytRevealTimer = null;
  let videoHideTimer = null;
  let autoPreviewActive = false;
  let autoPreviewEnded = false;
  let autoTrailerPaused = false;
  let autoTrailerUserPaused = false;
  let autoTrailerSuspended = false;
  let autoTrailerResumeTimer = null;
  const autoTrailerSuspendReasons = new Set();
  let autoCompletionTimer = null;
  let autoToggleButton = null;
  let previewVolumeWrap = null;
  let previewVolumeButton = null;
  let fullscreenButton = null;
  let previewVolumeRange = null;
  let ytPlayer = null;
  let ytMuted = getPreviewTrailerAudioState({ config }).muted;
  let autoPreviewPending = false;
  let autoAdvanceWaiting = false;
  let autoSlideVisible = true;
  let autoTrailerPlaybackBlocked = isAutoTrailerPlaybackBlocked();
  let runtimePreviewVolumePercent = getPreviewTrailerAudioState({
    config,
    soundOn: true,
    ignoreStartMuted: true
  }).effectivePercent;
  let lastAudiblePercent = runtimePreviewVolumePercent > 0 ? runtimePreviewVolumePercent : 100;

  const clearYtRevealTimer = () => {
    if (!ytRevealTimer) return;
    clearTimeout(ytRevealTimer);
    ytRevealTimer = null;
  };

  const clearVideoHideTimer = () => {
    if (!videoHideTimer) return;
    clearTimeout(videoHideTimer);
    videoHideTimer = null;
  };

  const showBackdrop = () => {
    try {
      if (backdropImg) backdropImg.style.opacity = "1";
    } catch {}
  };

  const hideBackdrop = () => {
    try {
      if (backdropImg) backdropImg.style.opacity = "0";
    } catch {}
  };

  const isAudioLikeItem = (it) => {
    const type = String(it?.Type || "");
    const mediaType = String(it?.MediaType || "");
    return type === "Audio" || type === "MusicVideo" || mediaType === "Audio";
  };

  const setAudioOverlayState = (active, itemDetails = null) => {
    if (!audioOverlay) return;

    if (!active) {
      audioOverlay.style.display = "none";
      slide.classList.remove("jms-audio-preview-active");
      videoElement.style.display = "block";
      videoElement.style.opacity = "0";
      return;
    }

    const titleEl = audioOverlay.querySelector(".jms-audio-preview-overlay__title");
    const subtitleEl = audioOverlay.querySelector(".jms-audio-preview-overlay__subtitle");
    const titleText = itemDetails?.Name || "";
    const artistText =
      (Array.isArray(itemDetails?.Artists) && itemDetails.Artists.filter(Boolean).join(", ")) ||
      itemDetails?.AlbumArtist ||
      itemDetails?.Album ||
      "";

    if (titleEl) titleEl.textContent = titleText;
    if (subtitleEl) subtitleEl.textContent = artistText;

    audioOverlay.style.display = "flex";
    slide.classList.add("jms-audio-preview-active");
    videoElement.style.display = "none";
    videoElement.style.opacity = "0";
    showBackdrop();
  };

  videoElement.addEventListener("ended", () => {
    const endedKind = playingKind;
    clearVideoHideTimer();
    clearPreviewPlaybackFlag();
    setAudioOverlayState(false);
    try { videoElement.style.opacity = "0"; } catch {}
    showBackdrop();
    slide.classList.remove("video-active", "intro-active", "trailer-active");
    setTimeout(() => {
      try {
        if (videoElement.ended || videoElement.paused) videoContainer.style.display = "none";
      } catch {}
    }, 200);
    playingKind = null;
    setPreviewVolumeVisible(false);
    setAutoToggleVisible(false);
    if (autoPreviewActive && endedKind === "localTrailer") {
      markAutoTrailerEnded({ advance: true });
    }
  });

  const _detailsCache = new Map();

  async function getDetailsCached(id, { signal } = {}) {
    if (!id) return null;
    if (_detailsCache.has(id)) return _detailsCache.get(id);
    try {
      const d = await fetchItemDetails(id, { signal });
      _detailsCache.set(id, d || null);
      return d || null;
    } catch {
      _detailsCache.set(id, null);
      return null;
    }
  }

  function ticksToSeconds(ticks) {
    const n = Number(ticks) || 0;
    return n > 0 ? (n / 10_000_000) : 0;
  }

  async function getSmartStartSeconds(id, { signal } = {}) {
    const LEGACY = 600;
    const d = await getDetailsCached(id, { signal });
    const type = (d?.Type || "").toString();

    if (type === "Audio" || type === "MusicAlbum" || type === "AudioBook") return 0;

    const durSec =
      ticksToSeconds(d?.RunTimeTicks) ||
      ticksToSeconds(d?.CumulativeRunTimeTicks) ||
      0;

    if (durSec > 0 && durSec < 12 * 60) return 0;
    if (durSec > 0) return Math.max(0, Math.min(LEGACY, Math.max(0, durSec - 30)));

    return LEGACY;
  }

  const delayRaw = config && (config.gecikmeSure ?? config.gecikmesure);
  const delay = Number.isFinite(+delayRaw) ? +delayRaw : 500;

  const canUseYTApiPostMessage = (() => {
    try {
      const origin = window.location?.origin || "";
      return /^https?:\/\//i.test(origin);
    } catch { return false; }
  })();

  const isSliderAutoTrailerEnabled = () => {
    if (!allowAutoTrailer) return false;
    try {
      const stored = localStorage.getItem("sliderAutoTrailerPlayback");
      if (stored !== null) return stored === "true";
    } catch {}
    return config?.sliderAutoTrailerPlayback === true;
  };

  const isAutoSlideRectVisible = () => {
    if (!allowAutoTrailer) return false;
    try {
      if (!slide?.isConnected) return false;
      const rect = slide.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      if (!rect.width || !rect.height || !vh || !vw) return false;
      const visibleW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
      const visibleH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      const visibleRatio = (visibleW * visibleH) / (rect.width * rect.height);
      return visibleRatio >= 0.35;
    } catch {
      return false;
    }
  };

  const isAutoSlideVisible = () => allowAutoTrailer && autoSlideVisible && isAutoSlideRectVisible();

  const shouldKeepPreviewAlive = (hoverId) => (
    (isMouseOver || autoPreviewActive) &&
    hoverId === latestHoverId &&
    isActiveSlide() &&
    (!autoPreviewActive || isAutoSlideVisible() || autoTrailerSuspended)
  );

  const clearAutoCompletionTimer = () => {
    if (!autoCompletionTimer) return;
    clearTimeout(autoCompletionTimer);
    autoCompletionTimer = null;
  };

  const clearAutoTrailerResumeTimer = () => {
    if (!autoTrailerResumeTimer) return;
    clearTimeout(autoTrailerResumeTimer);
    autoTrailerResumeTimer = null;
  };

  function ensureAutoToggleButton() {
    if (!isSliderAutoTrailerEnabled()) return null;
    if (autoToggleButton) return autoToggleButton;
    const labels = config?.languageLabels || {};
    autoToggleButton = document.createElement("button");
    autoToggleButton.type = "button";
    autoToggleButton.className = "monwui-auto-trailer-toggle";
    autoToggleButton.setAttribute("aria-label", labels.sliderAutoTrailerPause || "Fragmanı duraklat");
    autoToggleButton.title = labels.sliderAutoTrailerPause || "Fragmanı duraklat";
    autoToggleButton.innerHTML = '<i class="fa-solid fa-pause"></i>';
    autoToggleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleAutoTrailerPlayback();
    });
    (backdropContainer || slide).appendChild(autoToggleButton);
    return autoToggleButton;
  }

  function setAutoToggleVisible(visible) {
    const btn = visible ? ensureAutoToggleButton() : autoToggleButton;
    if (btn) btn.style.display = visible ? "flex" : "none";
  }

  function syncAutoToggleButton() {
    if (!autoToggleButton) return;
    const labels = config?.languageLabels || {};
    autoToggleButton.innerHTML = autoTrailerPaused
      ? '<i class="fa-solid fa-play"></i>'
      : '<i class="fa-solid fa-pause"></i>';
    const title = autoTrailerPaused
      ? (labels.sliderAutoTrailerResume || "Fragmanı devam ettir")
      : (labels.sliderAutoTrailerPause || "Fragmanı duraklat");
    autoToggleButton.title = title;
    autoToggleButton.setAttribute("aria-label", title);
  }

  function ensurePreviewVolumeButton() {
    if (previewVolumeButton) return previewVolumeButton;
    const labels = config?.languageLabels || {};
    previewVolumeWrap = document.createElement("div");
    previewVolumeWrap.className = "monwui-preview-volume-control";

    previewVolumeButton = document.createElement("button");
    previewVolumeButton.type = "button";
    previewVolumeButton.className = "monwui-preview-volume-toggle";
    previewVolumeButton.setAttribute("aria-label", labels.previewTrailerVolumeToggle || "Fragman sesini aç/kapat");
    previewVolumeButton.title = labels.previewTrailerVolumeToggle || "Fragman sesini aç/kapat";
    previewVolumeButton.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    previewVolumeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePreviewVolume();
    });

    const panel = document.createElement("div");
    panel.className = "monwui-preview-volume-panel";
    previewVolumeRange = document.createElement("input");
    previewVolumeRange.type = "range";
    previewVolumeRange.className = "monwui-preview-volume-range";
    previewVolumeRange.min = "0";
    previewVolumeRange.max = "100";
    previewVolumeRange.step = "1";
    previewVolumeRange.value = String(Math.round(runtimePreviewVolumePercent));
    previewVolumeRange.setAttribute("aria-label", labels.previewTrailerVolumePercent || "Fragman başlangıç ses seviyesi (%)");
    previewVolumeRange.addEventListener("input", (event) => {
      event.stopPropagation();
      setPreviewVolumePercent(Number(event.target.value), { unmute: true });
    });
    previewVolumeRange.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    panel.appendChild(previewVolumeRange);
    previewVolumeWrap.append(panel, previewVolumeButton);
    (backdropContainer || slide).appendChild(previewVolumeWrap);
    return previewVolumeButton;
  }

  function setPreviewVolumeVisible(visible) {
    if (visible) ensurePreviewVolumeButton();
    const wrap = previewVolumeWrap;
    if (wrap) {
      const alignWithAutoToggle = autoPreviewActive && isSliderAutoTrailerEnabled();
      wrap.style.top = "48px";
      wrap.style.right = alignWithAutoToggle ? "64px" : "48px";
      wrap.style.display = visible ? "block" : "none";
    }
    syncFullscreenButtonVisibility(visible, wrap ? wrap.style.right : "48px");
  }

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function isPreviewFullscreen() {
    return getFullscreenElement() === videoContainer;
  }

  function ensureFullscreenButton() {
    if (fullscreenButton) return fullscreenButton;
    const labels = config?.languageLabels || {};
    const label = labels.previewTrailerFullscreen || "Fullscreen";
    fullscreenButton = document.createElement("button");
    fullscreenButton.type = "button";
    fullscreenButton.className = "monwui-preview-fullscreen-toggle";
    fullscreenButton.setAttribute("aria-label", label);
    fullscreenButton.title = label;
    fullscreenButton.innerHTML = '<i class="fa-solid fa-expand"></i>';
    fullscreenButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePreviewFullscreen();
    });
    (backdropContainer || slide).appendChild(fullscreenButton);
    return fullscreenButton;
  }

  function syncFullscreenButtonVisibility(visible, right) {
    const canFullscreen = visible && playingKind !== "remoteTrailer" &&
      typeof videoContainer.requestFullscreen === "function";
    const btn = canFullscreen ? ensureFullscreenButton() : fullscreenButton;
    if (!btn) return;
    btn.style.right = right || "48px";
    btn.style.display = canFullscreen ? "flex" : "none";
  }

  function syncFullscreenButtonIcon() {
    if (!fullscreenButton) return;
    fullscreenButton.innerHTML = isPreviewFullscreen()
      ? '<i class="fa-solid fa-compress"></i>'
      : '<i class="fa-solid fa-expand"></i>';
  }

  // While the trailer is fullscreen only videoContainer is visible, so the plugin controls
  // (pause, volume, fullscreen) are moved inside it and moved back on exit.
  function relocatePreviewControls() {
    const host = isPreviewFullscreen() ? videoContainer : (backdropContainer || slide);
    [previewVolumeWrap, autoToggleButton, fullscreenButton].forEach((el) => {
      if (el && el.parentNode !== host) host.appendChild(el);
    });
    syncFullscreenButtonIcon();
  }

  function onPreviewFullscreenChange() {
    relocatePreviewControls();
    if (!isPreviewFullscreen()) {
      document.removeEventListener("fullscreenchange", onPreviewFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onPreviewFullscreenChange);
    }
  }

  async function togglePreviewFullscreen() {
    try {
      if (isPreviewFullscreen()) {
        await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      document.addEventListener("fullscreenchange", onPreviewFullscreenChange);
      document.addEventListener("webkitfullscreenchange", onPreviewFullscreenChange);
      await (videoContainer.requestFullscreen || videoContainer.webkitRequestFullscreen).call(videoContainer);
    } catch {
      document.removeEventListener("fullscreenchange", onPreviewFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onPreviewFullscreenChange);
    }
  }

  function leavePreviewFullscreen() {
    try {
      if (isPreviewFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch {}
    document.removeEventListener("fullscreenchange", onPreviewFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", onPreviewFullscreenChange);
    relocatePreviewControls();
  }

  // In fullscreen a click on the picture pauses/resumes (the native controls are hidden).
  videoElement.addEventListener("click", (event) => {
    if (!isPreviewFullscreen()) return;
    event.preventDefault();
    event.stopPropagation();
    if (autoPreviewActive && isSliderAutoTrailerEnabled()) {
      toggleAutoTrailerPlayback();
      return;
    }
    try {
      if (videoElement.paused) videoElement.play();
      else videoElement.pause();
    } catch {}
  });

  function syncPreviewVolumeButton(muted = null) {
    const btn = previewVolumeButton;
    if (!btn) return;
    const isMuted = muted === null ? getCurrentPreviewMuted() : muted;
    btn.innerHTML = isMuted
      ? '<i class="fa-solid fa-volume-xmark"></i>'
      : '<i class="fa-solid fa-volume-high"></i>';
    if (previewVolumeRange) {
      previewVolumeRange.value = String(Math.round(getCurrentPreviewVolumePercent()));
    }
  }

  function postYoutubeCommand(func, args = []) {
    try {
      ytIframe?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "*"
      );
    } catch {}
  }

  function getCurrentPreviewMuted() {
    if (playingKind === "remoteTrailer") return ytMuted;
    try {
      return !!videoElement.muted || Number(videoElement.volume) <= 0;
    } catch {
      return true;
    }
  }

  function getCurrentPreviewVolumePercent() {
    if (playingKind === "remoteTrailer") {
      try {
        const n = ytPlayer?.getVolume?.();
        if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
      } catch {}
      return runtimePreviewVolumePercent;
    }
    try {
      return Math.round(Math.max(0, Math.min(1, Number(videoElement.volume) || 0)) * 100);
    } catch {
      return runtimePreviewVolumePercent;
    }
  }

  function setPreviewVolumePercent(percent, { unmute = true } = {}) {
    const value = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : runtimePreviewVolumePercent));
    runtimePreviewVolumePercent = value;
    if (value > 0) lastAudiblePercent = value;
    if (previewVolumeRange) previewVolumeRange.value = String(Math.round(value));
    const muted = value <= 0 || !unmute;

    if (playingKind === "remoteTrailer") {
      ytMuted = muted;
      if (muted) {
        try { ytPlayer?.mute?.(); } catch {}
        postYoutubeCommand("mute");
      } else {
        try {
          ytPlayer?.unMute?.();
          ytPlayer?.setVolume?.(Math.round(value));
        } catch {}
        postYoutubeCommand("unMute");
        postYoutubeCommand("setVolume", [Math.round(value)]);
      }
      syncPreviewVolumeButton(ytMuted);
      return;
    }

    try {
      videoElement.muted = muted;
      videoElement.volume = muted ? 0 : value / 100;
    } catch {}
    syncPreviewVolumeButton(muted);
  }

  function rememberAudibleVolume() {
    try {
      const current = getCurrentPreviewVolumePercent();
      if (Number.isFinite(current) && current > 0) lastAudiblePercent = current;
    } catch {}
  }

  function setPreviewVolumeMuted(muted) {
    if (muted) rememberAudibleVolume();
    const restorePercent = Math.max(
      1,
      Math.min(100, Math.round(lastAudiblePercent > 0 ? lastAudiblePercent : (runtimePreviewVolumePercent || 100)))
    );

    if (playingKind === "remoteTrailer") {
      ytMuted = !!muted;
      if (ytMuted) {
        try { ytPlayer?.mute?.(); } catch {}
        postYoutubeCommand("mute");
      } else {
        try {
          ytPlayer?.unMute?.();
          ytPlayer?.setVolume?.(restorePercent);
        } catch {}
        postYoutubeCommand("unMute");
        postYoutubeCommand("setVolume", [restorePercent]);
        runtimePreviewVolumePercent = restorePercent;
      }
      syncPreviewVolumeButton(ytMuted);
      return;
    }

    if (muted) {
      try {
        videoElement.muted = true;
        videoElement.volume = 0;
      } catch {}
      syncPreviewVolumeButton(true);
      return;
    }

    try {
      videoElement.muted = false;
      videoElement.volume = restorePercent / 100;
    } catch {}
    runtimePreviewVolumePercent = restorePercent;
    syncPreviewVolumeButton(false);
  }

  function togglePreviewVolume() {
    setPreviewVolumeMuted(!getCurrentPreviewMuted());
  }

  function setCurrentAutoTrailerPaused(paused) {
    autoTrailerPaused = !!paused;
    if (playingKind === "localTrailer") {
      try {
        if (autoTrailerPaused) {
          videoElement.pause();
        } else {
          const playPromise = videoElement.play();
          if (playPromise?.catch) playPromise.catch(() => {});
        }
      } catch {}
    } else if (playingKind === "remoteTrailer") {
      if (ytPlayer) {
        try {
          if (autoTrailerPaused) ytPlayer.pauseVideo?.();
          else ytPlayer.playVideo?.();
        } catch {}
      } else {
        postYoutubeCommand(autoTrailerPaused ? "pauseVideo" : "playVideo");
      }
    }
    syncAutoToggleButton();
  }

  function isAutoTrailerForegroundReady() {
    try {
      if (document.hidden) return false;
      if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
    } catch {}
    return true;
  }

  function canResumeAutoTrailerPlayback() {
    return (
      isSliderAutoTrailerEnabled() &&
      isActiveSlide() &&
      isAutoSlideVisible() &&
      !autoTrailerPlaybackBlocked &&
      !isAutoTrailerPlaybackBlocked() &&
      isAutoTrailerForegroundReady()
    );
  }

  function resetAutoTrailerSuspension() {
    autoTrailerSuspended = false;
    autoTrailerSuspendReasons.clear();
    clearAutoTrailerResumeTimer();
  }

  function suspendAutoTrailerPlayback(reason = "system", { hideControls = false } = {}) {
    if (!autoPreviewActive && !autoPreviewPending) return false;

    if (reason) autoTrailerSuspendReasons.add(reason);
    autoTrailerSuspended = autoTrailerSuspendReasons.size > 0;
    clearAutoTrailerResumeTimer();
    clearAutoCompletionTimer();

    if (enterTimeout) {
      clearTimeout(enterTimeout);
      enterTimeout = null;
      autoPreviewPending = true;
    }

    setCurrentAutoTrailerPaused(true);
    if (hideControls) {
      setAutoToggleVisible(false);
      setPreviewVolumeVisible(false);
    }
    return true;
  }

  function queueAutoTrailerResume() {
    clearAutoTrailerResumeTimer();
    autoTrailerResumeTimer = setTimeout(() => {
      autoTrailerResumeTimer = null;
      resumeAutoTrailerPlayback();
    }, 120);
  }

  function releaseAutoTrailerSuspension(reason = "system") {
    if (reason) {
      autoTrailerSuspendReasons.delete(reason);
    } else {
      autoTrailerSuspendReasons.clear();
    }
    autoTrailerSuspended = autoTrailerSuspendReasons.size > 0;
    if (!autoTrailerSuspended && autoTrailerUserPaused && autoPreviewActive && playingKind && canResumeAutoTrailerPlayback()) {
      setAutoToggleVisible(true);
      setPreviewVolumeVisible(true);
      syncAutoToggleButton();
      return;
    }
    if (!autoTrailerSuspended) queueAutoTrailerResume();
  }

  function resumeAutoTrailerPlayback() {
    if (autoTrailerSuspended || autoTrailerUserPaused) return false;
    if (!canResumeAutoTrailerPlayback()) return false;

    if (!autoPreviewActive && !autoPreviewPending) {
      maybeStartAutoTrailer();
      return true;
    }

    if (!playingKind) {
      const keepAdvanceWaiting = autoAdvanceWaiting;
      autoPreviewActive = false;
      autoPreviewPending = false;
      autoTrailerPaused = false;
      setAutoToggleVisible(false);
      setPreviewVolumeVisible(false);
      startPreview({ auto: true });
      autoAdvanceWaiting = keepAdvanceWaiting;
      return true;
    }

    autoPreviewActive = true;
    autoPreviewEnded = false;
    autoPreviewPending = false;

    showDetailsOverlay();
    setAutoToggleVisible(true);
    setPreviewVolumeVisible(true);

    if (playingKind === "localTrailer") {
      try {
        videoContainer.style.display = "block";
        slide.classList.add("video-active", "intro-active", "trailer-active");
        videoElement.style.display = "block";
        videoElement.style.opacity = "1";
        hideBackdrop();
      } catch {}
    } else if (playingKind === "remoteTrailer") {
      if (!ytIframe) {
        playingKind = null;
        const keepAdvanceWaiting = autoAdvanceWaiting;
        autoPreviewActive = false;
        autoPreviewPending = false;
        startPreview({ auto: true });
        autoAdvanceWaiting = keepAdvanceWaiting;
        return true;
      }
      try {
        ytIframe.style.display = "block";
        slide.classList.add("trailer-active");
        hideBackdrop();
      } catch {}
      postPreviewTrailerAudioToYouTubeIframe(ytIframe, { config });
      clearAutoCompletionTimer();
      autoCompletionTimer = setTimeout(() => {
        markAutoTrailerEnded({ advance: true });
      }, 180000);
    }

    setCurrentAutoTrailerPaused(false);
    return true;
  }

  function throwIfAutoTrailerSuspended() {
    if (!autoPreviewActive || !autoTrailerSuspended) return;
    autoPreviewPending = true;
    throw new Error("AutoTrailerSuspended");
  }

  function toggleAutoTrailerPlayback() {
    if (!autoPreviewActive || !playingKind) return;
    const nextPaused = !autoTrailerPaused;
    autoTrailerUserPaused = nextPaused;
    if (!nextPaused) {
      resetAutoTrailerSuspension();
    }
    setCurrentAutoTrailerPaused(nextPaused);
  }

  async function advanceAfterAutoTrailer() {
    if (!isSliderAutoTrailerEnabled() || !isActiveSlide()) return;
    try {
      const nav = await import("./navigation.js");
      if (isActiveSlide()) nav.changeSlide?.(1);
    } catch {}
  }

  function markAutoTrailerEnded({ advance = true } = {}) {
    if (!autoPreviewActive) return;
    autoPreviewEnded = true;
    autoPreviewActive = false;
    autoTrailerPaused = false;
    autoTrailerUserPaused = false;
    resetAutoTrailerSuspension();
    autoPreviewPending = false;
    autoAdvanceWaiting = false;
    clearAutoCompletionTimer();
    setAutoToggleVisible(false);
    if (advance) {
      setTimeout(() => advanceAfterAutoTrailer(), 0);
    }
  }

  function finishAutoPreviewWithoutPlayback() {
    const shouldAdvance = autoAdvanceWaiting;
    autoPreviewEnded = true;
    autoPreviewActive = false;
    autoTrailerPaused = false;
    autoTrailerUserPaused = false;
    resetAutoTrailerSuspension();
    autoPreviewPending = false;
    autoAdvanceWaiting = false;
    clearAutoCompletionTimer();
    setAutoToggleVisible(false);
    setPreviewVolumeVisible(false);
    if (shouldAdvance) {
      setTimeout(() => advanceAfterAutoTrailer(), 0);
    }
  }

  function ensureSliderYTAPI() {
    if (typeof YT !== "undefined" && typeof YT.Player === "function") return Promise.resolve(true);
    if (window.__jmsSliderYTApiLoading) {
      return new Promise((resolve) => {
        const iv = setInterval(() => {
          if (typeof YT !== "undefined" && typeof YT.Player === "function") {
            clearInterval(iv);
            resolve(true);
          }
        }, 100);
        setTimeout(() => {
          clearInterval(iv);
          resolve(typeof YT !== "undefined" && typeof YT.Player === "function");
        }, 3500);
      });
    }
    window.__jmsSliderYTApiLoading = true;
    return new Promise((resolve) => {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      tag.onload = () => {};
      document.head.appendChild(tag);
      const startedAt = Date.now();
      const iv = setInterval(() => {
        const ready = typeof YT !== "undefined" && typeof YT.Player === "function";
        if (ready || Date.now() - startedAt > 3500) {
          clearInterval(iv);
          window.__jmsSliderYTApiLoading = false;
          resolve(ready);
        }
      }, 100);
    });
  }

  function installSliderYTPlayer() {
    if (!ytIframe || !autoPreviewActive || !canUseYTApiPostMessage) return;
    ensureSliderYTAPI().then((ready) => {
      if (!ready || !ytIframe || !autoPreviewActive) return;
      try {
        ytPlayer = new YT.Player(ytIframe, {
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            origin: window.location.origin
          },
          events: {
            onReady: (event) => {
              if (ytMuted || runtimePreviewVolumePercent <= 0) {
                ytMuted = true;
                try { event.target.mute?.(); } catch {}
              } else {
                ytMuted = false;
                try {
                  event.target.unMute?.();
                  event.target.setVolume?.(Math.round(runtimePreviewVolumePercent));
                } catch {}
              }
              syncPreviewVolumeButton(ytMuted);
              const shouldPlay = !autoTrailerSuspended && !autoTrailerUserPaused && canResumeAutoTrailerPlayback();
              autoTrailerPaused = !shouldPlay;
              syncAutoToggleButton();
              try {
                if (shouldPlay) event.target.playVideo?.();
                else event.target.pauseVideo?.();
              } catch {}
            },
            onStateChange: (event) => {
              if (!autoPreviewActive) return;
              if (event.data === YT.PlayerState.ENDED) {
                markAutoTrailerEnded({ advance: true });
              } else if (event.data === YT.PlayerState.PAUSED) {
                autoTrailerPaused = true;
                syncAutoToggleButton();
              } else if (event.data === YT.PlayerState.PLAYING) {
                if (autoTrailerSuspended || autoTrailerUserPaused || !canResumeAutoTrailerPlayback()) {
                  setCurrentAutoTrailerPaused(true);
                  return;
                }
                autoTrailerPaused = false;
                syncAutoToggleButton();
              }
            }
          }
        });
      } catch {}
    });
  }

  const stopYoutube = (iframe) => {
    try {
      if (!canUseYTApiPostMessage) return;
      if (!iframe) return;
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "stopVideo", args: [] }),
        "*"
      );
    } catch {}
  };

  const hardStopVideo = ({ immediate = false } = {}) => {
    clearPreviewPlaybackFlag();
    clearVideoHideTimer();
    setAudioOverlayState(false);
    try { videoElement.pause(); } catch {}

    const finalize = () => {
      try {
        videoElement.removeAttribute("src");
        videoElement.load();
      } catch {}
      videoContainer.style.display = "none";
      videoElement.style.opacity = "0";
      slide.classList.remove("video-active", "intro-active", "trailer-active");
    };

    const shouldFadeOut = !immediate && videoContainer.style.display !== "none";
    if (!shouldFadeOut) {
      finalize();
      return;
    }

    try { videoElement.style.opacity = "0"; } catch {}
    videoHideTimer = setTimeout(() => {
      videoHideTimer = null;
      finalize();
    }, 220);
  };

  const hardStopIframe = () => {
    clearPreviewPlaybackFlag();
    clearYtRevealTimer();
    setAudioOverlayState(false);
    clearAutoCompletionTimer();
    if (ytPlayer) {
      try { ytPlayer.stopVideo?.(); ytPlayer.destroy?.(); } catch {}
      ytPlayer = null;
    }
    if (ytIframe) {
      try { stopYoutube(ytIframe); } catch {}
      try { ytIframe.src = "about:blank"; } catch {}
      try { ytIframe.remove(); } catch {}
      ytIframe = null;
    }
    slide.classList.remove("trailer-active");
  };

  const fullCleanup = () => {
    clearPreviewPlaybackFlag();
    setAudioOverlayState(false);
    hideDetailsOverlay();
    showBackdrop();
    autoTrailerPaused = false;
    autoTrailerUserPaused = false;
    resetAutoTrailerSuspension();
    clearAutoTrailerResumeTimer();
    clearAutoCompletionTimer();
    leavePreviewFullscreen();
    setAutoToggleVisible(false);
    setPreviewVolumeVisible(false);
    hardStopVideo({ immediate: false });
    hardStopIframe();
    if (arrowIntervalId) { clearInterval(arrowIntervalId); arrowIntervalId = null; }
    playingKind = null;
  };

  async function loadStreamFor(itemIdToPlay, hoverId, startSeconds = 0, { previewDetails = null } = {}) {
    const introUrl = await getVideoStreamUrl(
      itemIdToPlay,
      1920,
      0,
      null,
      ["h264"],
      ["aac"],
      false,
      false,
      { signal: abortController.signal }
    );
    if (!shouldKeepPreviewAlive(hoverId)) throw new Error("HoverAbortError");
    if (!introUrl || introUrl === "null") return false;
    const audioPreview = isAudioLikeItem(previewDetails);
    if (audioPreview) {
      try { videoElement.style.opacity = "0"; } catch {}
      showBackdrop();
    }

    videoElement.src = introUrl;
    const audioState = applyPreviewTrailerAudioToVideo(videoElement, { config });
    runtimePreviewVolumePercent = audioState.effectivePercent;
    if (audioState.effectivePercent > 0) lastAudiblePercent = audioState.effectivePercent;
    videoElement.load();
    const onMeta = () => {
      videoElement.removeEventListener("loadedmetadata", onMeta);
      if (!shouldKeepPreviewAlive(hoverId)) {
        fullCleanup();
        return;
      }
      if (autoPreviewActive && autoTrailerSuspended) {
        autoPreviewPending = true;
        try { videoElement.pause(); } catch {}
        return;
      }
      videoElement.currentTime = startSeconds;
      videoElement
        .play()
        .then(() => {
          if (audioPreview) {
            setAudioOverlayState(true, previewDetails);
          } else {
            videoElement.style.display = "block";
            videoElement.style.opacity = "1";
            hideBackdrop();
          }
        })
        .catch(() => {});
    };
    videoElement.addEventListener("loadedmetadata", onMeta, { once: true });
    return true;
  }

  async function tryPlayLocalTrailer(hoverId) {
    if (!isActiveSlide()) return false;
    const locals = await fetchLocalTrailers(previewMediaItemId, { signal: abortController.signal });
    if (!shouldKeepPreviewAlive(hoverId)) throw new Error("HoverAbortError");
    throwIfAutoTrailerSuspended();
    const best = pickBestLocalTrailer(locals);
    if (!best?.Id) return false;

    if (!isActiveSlide()) return false;
    hardStopIframe();
    clearVideoHideTimer();
    videoContainer.style.display = "block";
    showDetailsOverlay();
    slide.classList.add("video-active", "intro-active", "trailer-active");
    playingKind = "localTrailer";
    autoPreviewPending = false;
    autoTrailerPaused = false;
    autoTrailerUserPaused = false;
    setPreviewVolumeVisible(true);
    syncPreviewVolumeButton();
    if (autoPreviewActive) {
      autoPreviewEnded = false;
      setAutoToggleVisible(true);
      syncAutoToggleButton();
    }
    setPreviewPlaybackFlag("localTrailer", best.Id);
    await loadStreamFor(best.Id, hoverId, 0);
    return true;
  }

  async function tryPlayRemoteTrailer(hoverId, { onlyYouTube = false } = {}) {
    if (!isActiveSlide()) return false;
    const trailer = Array.isArray(RemoteTrailers) && RemoteTrailers.length ? RemoteTrailers[0] : null;
    if (!trailer?.Url) return false;
    throwIfAutoTrailerSuspended();

    let url = getYoutubeEmbedUrl(trailer.Url);
    const isYoutubeEmbed = /youtube(?:-nocookie)?\.com\/embed\//i.test(String(url || ""));
    if (onlyYouTube && !isYoutubeEmbed) return false;
    const audioState = getPreviewTrailerAudioState({ config });
    runtimePreviewVolumePercent = audioState.effectivePercent;
    url = setYouTubeUrlPreviewAudio(url, { config });
    if (!isValidUrl(url) || !isActiveSlide()) return false;

    hardStopVideo({ immediate: true });

    if (!ytIframe) {
      ytIframe = document.createElement("iframe");
      ytIframe.dataset.jmsPreview = "1";
      ytIframe.dataset.jmsIgnorePauseOverlay = "1";
      ytIframe.allow = "autoplay; encrypted-media; clipboard-write; accelerometer; gyroscope; picture-in-picture";
      ytIframe.referrerPolicy = "origin-when-cross-origin";
      "autoplay; encrypted-media; clipboard-write; accelerometer; gyroscope; picture-in-picture";
      ytIframe.setAttribute("playsinline", "");
      ytIframe.allowFullscreen = true;
      Object.assign(ytIframe.style, {
        width: "70%",
        height: "100%",
        border: "none",
        display: "none",
        position: "absolute",
        top: "0%",
        right: "0%",
        bottom: "0",
      });
      const backdropContainer = slide?.__backdropContainer || slide?.querySelector?.(".bckdrp-cntnr");
      (backdropContainer || slide).appendChild(ytIframe);
    }

    if (!isActiveSlide()) return false;
    clearYtRevealTimer();
    ytIframe.onload = () => {
      clearYtRevealTimer();
      if (!shouldKeepPreviewAlive(hoverId)) return;
      postPreviewTrailerAudioToYouTubeIframe(ytIframe, { config });
      if (autoTrailerSuspended) {
        postYoutubeCommand("pauseVideo");
        return;
      }
      hideBackdrop();
    };
    ytRevealTimer = setTimeout(() => {
      ytRevealTimer = null;
      if (!shouldKeepPreviewAlive(hoverId)) return;
      postPreviewTrailerAudioToYouTubeIframe(ytIframe, { config });
      if (autoTrailerSuspended) {
        postYoutubeCommand("pauseVideo");
        return;
      }
      hideBackdrop();
    }, 900);
    ytIframe.style.display = "block";
    ytIframe.src = url;
    showDetailsOverlay();
    slide.classList.add("trailer-active");
    playingKind = "remoteTrailer";
    autoPreviewPending = false;
    ytMuted = audioState.muted;
    setPreviewVolumeVisible(true);
    syncPreviewVolumeButton(ytMuted);
    autoTrailerPaused = false;
    autoTrailerUserPaused = false;
    if (autoPreviewActive) {
      autoPreviewEnded = false;
      setAutoToggleVisible(true);
      syncAutoToggleButton();
      clearAutoCompletionTimer();
      autoCompletionTimer = setTimeout(() => {
        markAutoTrailerEnded({ advance: true });
      }, 180000);
    }
    installSliderYTPlayer();
    setPreviewPlaybackFlag("remoteTrailer", itemId);
    return true;
  }

  async function playMainVideo(hoverId) {
    if (!isActiveSlide()) return false;
    const previewDetails = await getDetailsCached(previewMediaItemId, { signal: abortController.signal });
    if (!shouldKeepPreviewAlive(hoverId)) throw new Error("HoverAbortError");
    hardStopIframe();
    clearVideoHideTimer();
    videoContainer.style.display = "block";
    showDetailsOverlay();
    slide.classList.add("video-active", "intro-active", "trailer-active");
    playingKind = "video";
    setPreviewVolumeVisible(true);
    syncPreviewVolumeButton();
    setPreviewPlaybackFlag("videoPreview", previewMediaItemId);
    const startSeconds = await getSmartStartSeconds(previewMediaItemId, { signal: abortController.signal });
    const ok = await loadStreamFor(previewMediaItemId, hoverId, startSeconds, { previewDetails });
    if (!ok) {
      fullCleanup();
      return false;
    }
    return true;
  }

  const startPreview = ({ auto = false } = {}) => {
    if (!isActiveSlide()) return;
    if (auto && !isSliderAutoTrailerEnabled()) return;
    if (auto && (autoTrailerPlaybackBlocked || isAutoTrailerPlaybackBlocked())) return;
    if (auto && !isAutoSlideVisible()) return;
    if (!auto && autoPreviewActive && isSliderAutoTrailerEnabled()) return;

    if (auto) {
      autoPreviewActive = true;
      autoPreviewEnded = false;
      autoTrailerPaused = false;
      autoPreviewPending = true;
      autoAdvanceWaiting = false;
    } else {
      isMouseOver = true;
    }
    showDetailsOverlay();
    latestHoverId++;
    const thisHoverId = latestHoverId;
    abortController.abort("hover-cancel");
    abortController = new AbortController();

    if (enterTimeout) {
      clearTimeout(enterTimeout);
      enterTimeout = null;
    }

    enterTimeout = setTimeout(async () => {
      if (!shouldKeepPreviewAlive(thisHoverId)) return;
      try {
        if (auto) {
          throwIfAutoTrailerSuspended();
          if (await tryPlayLocalTrailer(thisHoverId)) return;
          if (await tryPlayRemoteTrailer(thisHoverId, { onlyYouTube: true })) return;
          fullCleanup();
          finishAutoPreviewWithoutPlayback();
        } else if (mode === "video") {
          if (await playMainVideo(thisHoverId)) return;
        } else {
          if (await tryPlayLocalTrailer(thisHoverId)) return;
          if (await tryPlayRemoteTrailer(thisHoverId)) return;
          if (mode === "trailerThenVideo") {
            if (await playMainVideo(thisHoverId)) return;
          } else {
            fullCleanup();
          }
        }
      } catch (e) {
        if (e.name === "AbortError" || e.message === "HoverAbortError" || e.message === "AutoTrailerSuspended") return;
        console.error("Hover/play error:", e);
        autoPreviewPending = false;
        fullCleanup();
        if (auto) {
          finishAutoPreviewWithoutPlayback();
        }
      }
    }, delay);
  };

  const stopPreview = ({ force = false, markAutoEnded = false } = {}) => {
    const shouldAdvanceStoppedAuto = markAutoEnded && autoAdvanceWaiting;
    isMouseOver = false;
    autoPreviewActive = false;
    autoPreviewEnded = markAutoEnded;
    autoTrailerPaused = false;
    autoTrailerUserPaused = false;
    resetAutoTrailerSuspension();
    autoPreviewPending = false;
    if (markAutoEnded) autoAdvanceWaiting = false;
    latestHoverId++;
    abortController.abort("hover-cancel");
    abortController = new AbortController();
    if (enterTimeout) {
      clearTimeout(enterTimeout);
      enterTimeout = null;
    }
    fullCleanup();
    if (shouldAdvanceStoppedAuto) {
      setTimeout(() => advanceAfterAutoTrailer(), 0);
    }
  };

  const handleEnter = () => startPreview({ auto: false });

  const handleLeave = () => {
    if (autoPreviewActive && !isMouseOver && !document.hidden && isActiveSlide() && isSliderAutoTrailerEnabled()) {
      return;
    }
    stopPreview({ force: true });
  };

  const maybeStartAutoTrailer = () => {
    if (!isSliderAutoTrailerEnabled() || !isActiveSlide()) return;
    if (autoTrailerPlaybackBlocked || isAutoTrailerPlaybackBlocked()) return;
    if (autoTrailerSuspended || !isAutoTrailerForegroundReady()) return;
    if (!isAutoSlideVisible()) return;
    if (autoPreviewActive || playingKind || enterTimeout) return;
    startPreview({ auto: true });
  };

  function attachAutoCleanupGuards(slideEl) {
    const cleanups = [];

    const viewport =
      slideEl.closest(".swiper") ||
      slideEl.closest(".splide__track") ||
      slideEl.closest(".embla__viewport") ||
      slideEl.closest(".flickity-viewport") ||
      slideEl.closest("[data-slider-viewport]") ||
      null;

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === slideEl) {
              const visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
              autoSlideVisible = visible;
              if (!visible) {
                if (!suspendAutoTrailerPlayback("viewport", { hideControls: true })) {
                  stopPreview({ force: true, markAutoEnded: true });
                }
              } else {
                releaseAutoTrailerSuspension("viewport");
                if (!autoPreviewActive && !autoPreviewPending) maybeStartAutoTrailer();
              }
            }
          }
        },
        { root: viewport || null, threshold: [0, 0.5, 1] }
      );
      io.observe(slideEl);
      cleanups.push(() => io.disconnect());
    }

    if (allowAutoTrailer) {
      let viewportCheckRaf = 0;
      const runViewportVisibilityCheck = () => {
        viewportCheckRaf = 0;
        if (!isActiveSlide() && !autoPreviewActive && !autoPreviewPending) return;
        if (isAutoSlideRectVisible()) {
          releaseAutoTrailerSuspension("viewport-scroll");
          if (!autoPreviewActive && !autoPreviewPending) maybeStartAutoTrailer();
        } else {
          if (!suspendAutoTrailerPlayback("viewport-scroll", { hideControls: true })) {
            stopPreview({ force: true, markAutoEnded: true });
          }
        }
      };
      // Fork ParticularFlix: durante a rolagem o evento dispara a cada quadro; a checagem
      // (getBoundingClientRect) agora roda no maximo a cada 150 ms e so no slide ativo.
      let viewportCheckTimer = 0;
      const queueViewportVisibilityCheck = () => {
        if (viewportCheckRaf || viewportCheckTimer) return;
        if (!isActiveSlide() && !autoPreviewActive && !autoPreviewPending) return;
        viewportCheckTimer = window.setTimeout(() => {
          viewportCheckTimer = 0;
          if (viewportCheckRaf) return;
          viewportCheckRaf = requestAnimationFrame(runViewportVisibilityCheck);
        }, 150);
      };
      window.addEventListener("scroll", queueViewportVisibilityCheck, { passive: true, capture: true });
      window.addEventListener("resize", queueViewportVisibilityCheck, { passive: true });
      cleanups.push(() => {
        if (viewportCheckTimer) {
          try { clearTimeout(viewportCheckTimer); } catch {}
          viewportCheckTimer = 0;
        }
        if (viewportCheckRaf) {
          try { cancelAnimationFrame(viewportCheckRaf); } catch {}
          viewportCheckRaf = 0;
        }
        window.removeEventListener("scroll", queueViewportVisibilityCheck, true);
        window.removeEventListener("resize", queueViewportVisibilityCheck);
      });
    }

    const mo = new MutationObserver(() => {
      if (!document.body.contains(slideEl)) {
        try {
          stopPreview({ force: true });
        } catch {}
        cleanups.forEach((fn) => {
          try {
            fn();
          } catch {}
        });
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    cleanups.push(() => mo.disconnect());

    const onVis = () => {
      if (document.hidden) {
        if (!suspendAutoTrailerPlayback("visibility", { hideControls: true })) {
          stopPreview({ force: true, markAutoEnded: true });
        }
      } else {
        releaseAutoTrailerSuspension("visibility");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVis));
    const onWindowBlur = () => {
      setTimeout(() => {
        if (document.hidden) return;
        try {
          if (typeof document.hasFocus === "function" && document.hasFocus()) return;
        } catch {}
        suspendAutoTrailerPlayback("focus");
      }, 80);
    };
    const onWindowFocus = () => releaseAutoTrailerSuspension("focus");
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    cleanups.push(() => {
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    });
    const onPageHide = () => {
      if (!suspendAutoTrailerPlayback("pagehide", { hideControls: true })) {
        stopPreview({ force: true, markAutoEnded: true });
      }
    };
    const onPageShow = () => releaseAutoTrailerSuspension("pagehide");
    const onBeforeUnload = () => stopPreview({ force: true, markAutoEnded: true });
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanups.push(() => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
    });

    const swiperHost = slideEl.closest(".swiper");
    const swiperInst = swiperHost && swiperHost.swiper;
    if (swiperInst?.on && swiperInst?.off) {
      const onSwiperChange = () => stopPreview({ force: true });
      swiperInst.on("slideChangeTransitionStart", onSwiperChange);
      swiperInst.on("slideChange", onSwiperChange);
      swiperInst.on("transitionStart", onSwiperChange);
      cleanups.push(() => {
        try {
          swiperInst.off("slideChangeTransitionStart", onSwiperChange);
        } catch {}
        try {
          swiperInst.off("slideChange", onSwiperChange);
        } catch {}
        try {
          swiperInst.off("transitionStart", onSwiperChange);
        } catch {}
      });
    }

    const splideRoot = slideEl.closest(".splide");
    const splideInst = splideRoot && (splideRoot.__splide || window.splide);
    if (splideInst?.on && splideInst?.off) {
      const onMove = () => stopPreview({ force: true });
      splideInst.on("move", onMove);
      splideInst.on("moved", onMove);
      cleanups.push(() => {
        try {
          splideInst.off("move", onMove);
        } catch {}
        try {
          splideInst.off("moved", onMove);
        } catch {}
      });
    }

    const flktyRoot = slideEl.closest(".flickity-enabled");
    const flktyInst = flktyRoot && flktyRoot.flickity;
    if (flktyInst?.on && flktyInst?.off) {
      const onChange = () => stopPreview({ force: true });
      flktyInst.on("change", onChange);
      flktyInst.on("select", onChange);
      cleanups.push(() => {
        try {
          flktyInst.off("change", onChange);
        } catch {}
        try {
          flktyInst.off("select", onChange);
        } catch {}
      });
    }

    const emblaViewport = slideEl.closest(".embla__viewport");
    const emblaInst = emblaViewport && emblaViewport.__embla;
    if (emblaInst?.on) {
      const onSelect = () => stopPreview({ force: true });
      const onReInit = () => stopPreview({ force: true });
      emblaInst.on("select", onSelect);
      emblaInst.on("reInit", onReInit);
      cleanups.push(() => {
        try {
          emblaInst.off("select", onSelect);
        } catch {}
        try {
          emblaInst.off("reInit", onReInit);
        } catch {}
      });
    }

    return () => cleanups.forEach((fn) => { try { fn(); } catch {} });
  }

  let lastActive = isActiveSlide();
  let leavingLock = false;
  detachGuards = attachAutoCleanupGuards(slide);

  const classObserver = new MutationObserver(() => {
    const nowActive = isActiveSlide();

    if (lastActive && !nowActive && !leavingLock) {
      leavingLock = true;
      (typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn))(() => {
        try { stopPreview({ force: true }); } finally { leavingLock = false; }
      });
    }

    if (!lastActive && nowActive) {
      (typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn))(() => {
        maybeStartAutoTrailer();
      });
    }

    lastActive = nowActive;
  });

  classObserver.observe(slide, { attributes: true, attributeFilter: ['class'] });

  const hoverTarget = slide;
  hoverTarget.addEventListener("mouseenter", handleEnter, { passive: true });
  hoverTarget.addEventListener("mouseleave", handleLeave, { passive: true });

  const onSlideActive = () => {
    maybeStartAutoTrailer();
  };
  slide.addEventListener("slideActive", onSlideActive);

  const onPerSlideComplete = (event) => {
    if (!isSliderAutoTrailerEnabled() || !isActiveSlide()) return;
    const suspendedAutoTrailer = autoPreviewActive && autoTrailerSuspended;
    if (!isAutoSlideVisible() && !suspendedAutoTrailer) return;
    const hasAutoTrailerWork =
      autoPreviewPending ||
      suspendedAutoTrailer ||
      (autoPreviewActive && (playingKind === "localTrailer" || playingKind === "remoteTrailer")) ||
      (autoPreviewActive && !!enterTimeout);

    if (hasAutoTrailerWork) {
      event.preventDefault();
      autoAdvanceWaiting = true;
      return;
    }
  };
  document.addEventListener("jms:per-slide-complete", onPerSlideComplete);

  const onPlaybackStartRequested = () => {
    autoTrailerPlaybackBlocked = true;
    blockAutoTrailerPlayback();
    autoAdvanceWaiting = false;
    stopPreview({ force: true });
  };
  window.addEventListener(PLAYBACK_START_REQUESTED_EVENT, onPlaybackStartRequested, { passive: true });

  if (isActiveSlide()) {
    setTimeout(() => maybeStartAutoTrailer(), 0);
  }

  const mo = new MutationObserver(() => {
    if (!document.body.contains(slide)) {
      try { hoverTarget.removeEventListener("mouseenter", handleEnter); } catch {}
      try { hoverTarget.removeEventListener("mouseleave", handleLeave); } catch {}
      try { slide.removeEventListener("slideActive", onSlideActive); } catch {}
      try { document.removeEventListener("jms:per-slide-complete", onPerSlideComplete); } catch {}
      try { window.removeEventListener(PLAYBACK_START_REQUESTED_EVENT, onPlaybackStartRequested); } catch {}
      try { detachGuards?.(); } catch {}
      try { classObserver.disconnect(); } catch {}
      try { stopPreview({ force: true }); } catch {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

const _bestBackdropCache = new Map();
const BEST_BACKDROP_STORE_KEY = "jms_best_backdrop_idx_v1";
let _bestBackdropStore = null;

function getBackdropSignature(details) {
  const tags = Array.isArray(details?.BackdropImageTags) ? details.BackdropImageTags : [];
  return tags.join("|");
}

function loadBestBackdropStore() {
  if (_bestBackdropStore) return _bestBackdropStore;
  try {
    const raw = localStorage.getItem(BEST_BACKDROP_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    _bestBackdropStore = (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    _bestBackdropStore = {};
  }
  return _bestBackdropStore;
}

function saveBestBackdropStore(store) {
  try {
    const entries = Object.entries(store || {});
    const MAX = 2000;
    if (entries.length > MAX) {
      entries.sort((a, b) => (Number(a[1]?.ts) || 0) - (Number(b[1]?.ts) || 0));
      const trimmed = Object.fromEntries(entries.slice(entries.length - MAX));
      _bestBackdropStore = trimmed;
    } else {
      _bestBackdropStore = store || {};
    }
    localStorage.setItem(BEST_BACKDROP_STORE_KEY, JSON.stringify(_bestBackdropStore));
  } catch {}
}

function readBestBackdropFromStore(itemId, signature = "") {
  if (!itemId) return null;
  const store = loadBestBackdropStore();
  const rec = store?.[itemId];
  if (!rec) return null;
  if (signature && rec.sig !== signature) return null;
  const idx = rec.idx;
  if (idx == null) return null;
  return String(idx);
}

function writeBestBackdropToStore(itemId, signature = "", idx = "0") {
  if (!itemId) return;
  const store = loadBestBackdropStore();
  store[itemId] = { idx: String(idx), sig: signature || "", ts: Date.now() };
  saveBestBackdropStore(store);
}

export function ensureImagePreconnect() {
  let host = "";
  try {
    host = new URL(S("/")).origin;
  } catch {
    host = window.location?.origin || "";
  }
  if (!host) return;
  if (document.querySelector(`link[rel="preconnect"][href="${host}"]`)) return;
  const l = document.createElement("link");
  l.rel = "preconnect";
  l.href = host;
  l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}

let _supportsWebP;
export function supportsWebP() {
  if (_supportsWebP != null) return _supportsWebP;
  try {
    _supportsWebP = document.createElement("canvas").toDataURL("image/webp").includes("webp");
  } catch {
    _supportsWebP = false;
  }
  return _supportsWebP;
}

export function warmImageOnce(url) {
  if (!url) return;
  const abs = S(url);
  if (document.querySelector(`link[rel="preload"][as="image"][href="${abs}"]`)) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = abs;
  try { link.fetchPriority = "high"; } catch {}
  document.head.appendChild(link);
}

export function idleWarmImages(urls = []) {
  const doWarm = () => urls.forEach((u) => warmImageOnce(u));
  const ric = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  ric(doWarm, { timeout: 800 });
}

export function buildBackdropResponsive(item, index = "0", cfg = getConfig()) {
  const configuredMaxWidth = Number(cfg.backdropMaxWidth) || 1920;
  const maxTarget = Math.max(1280, Math.min(3840, configuredMaxWidth));
  const fmt = supportsWebP() ? "&format=webp" : "";
  const indexNum = Math.max(0, Number(index) || 0);
  const tag = (
    (Array.isArray(item?.BackdropImageTags) && item.BackdropImageTags[indexNum]) ||
    (Array.isArray(item?.ImageTags?.Backdrop) && item.ImageTags.Backdrop[indexNum]) ||
    (typeof item?.ImageTags?.Backdrop === "string" ? item.ImageTags.Backdrop : "")
  ).toString();
  const id = item.Id;

  const widths = [1280, 1920, 2560, 3840].filter((w) => w <= 1.25 * maxTarget);

  const src = S(`/Items/${id}/Images/Backdrop/${indexNum}?tag=${tag}&quality=90&maxWidth=${Math.floor(
     maxTarget
  )}${fmt}`);
  const srcset = withServerSrcset(
  widths
    .map(
      (w) =>
        `/Items/${id}/Images/Backdrop/${indexNum}?tag=${tag}&quality=90&maxWidth=${w}${fmt} ${w}w`
    )
    .join(", ")
);

   return { src, srcset, sizes: "100vw" };
 }

export async function getHighestQualityBackdropIndex(itemId, { signal, itemDetails = null } = {}) {
  const cfg = getConfig();
  if (cfg.indexZeroSelection) return "0";
  if (cfg.manualBackdropSelection) return "0";
  if (_bestBackdropCache.has(itemId)) return _bestBackdropCache.get(itemId);

  let details = itemDetails;
  const hasBackdropTags = Array.isArray(details?.BackdropImageTags);
  if (!hasBackdropTags) {
    try {
      details = await fetchItemDetails(itemId, { signal });
    } catch {
      return "0";
    }
  }

  const tags = details?.BackdropImageTags || [];
  if (!tags.length) return "0";
  const signature = getBackdropSignature(details);

  const persisted = readBestBackdropFromStore(itemId, signature);
  if (persisted != null) {
    _bestBackdropCache.set(itemId, persisted);
    return persisted;
  }

  if (tags.length <= 1) {
    _bestBackdropCache.set(itemId, "0");
    writeBestBackdropToStore(itemId, signature, "0");
    return "0";
  }

  const maxProbe = Number(cfg.limit ?? 6);
  const idxList = Array.from({ length: Math.min(maxProbe, tags.length) }, (_, i) => String(i));
  const results = [];
  const conc = 3;
  for (let i = 0; i < idxList.length; i += conc) {
    const batch = idxList.slice(i, i + conc);
    await Promise.all(
      batch.map(async (idxStr) => {
        const url = S(`/Items/${itemId}/Images/Backdrop/${idxStr}`);
        const bytes = await getImageSizeInBytes(url, { signal }).catch(() => NaN);
        if (Number.isFinite(bytes)) {
          results.push({ index: idxStr, kb: bytes / 1024 });
        }
      })
    );
  }

  if (!results.length) {
    _bestBackdropCache.set(itemId, "0");
    writeBestBackdropToStore(itemId, signature, "0");
    return "0";
  }
  const useSizeFilter = Boolean(cfg.enableImageSizeFilter ?? false);
  const minKB = Number(cfg.minImageSizeKB ?? 800);
  const maxKB = Number(cfg.maxImageSizeKB ?? 1500);

  let best;
  if (useSizeFilter) {
    const inRange = results.filter((r) => r.kb >= minKB && r.kb <= maxKB);
    if (inRange.length) {
      best = inRange.reduce((a, b) => (b.kb > a.kb ? b : a));
    } else {
      best = results.reduce((a, b) => (b.kb > a.kb ? b : a));
    }
  } else {
    best = results.reduce((a, b) => (b.kb > a.kb ? b : a));
  }

  const chosen = best?.index ?? "0";
  _bestBackdropCache.set(itemId, chosen);
  writeBestBackdropToStore(itemId, signature, chosen);
  return chosen;
}

async function kbInRange(url, minKB, maxKB) {
  const bytes = await getImageSizeInBytes(url).catch(() => NaN);
  if (!Number.isFinite(bytes)) return false;
  const kb = bytes / 1024;
  return kb >= minKB && kb <= maxKB;
}

async function getImageSizeInBytes(url, { signal } = {}) {
  try {
    const res = await fetch(S(url), {
      method: "HEAD",
      headers: { Authorization: getAuthHeader() },
      signal,
    });
    const size = res.headers.get("Content-Length") || res.headers.get("content-length");
    if (!size) throw new Error("Content-Length yok");
    const n = parseInt(size, 10);
    if (!Number.isFinite(n)) throw new Error("Content-Length parse edilemedi");
    return n;
  } catch {
    return NaN;
  }
}

export function prefetchImages(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  window.addEventListener(
    "load",
    () => {
      urls.forEach((url) => {
        if (!url) return;
        const abs = S(url);
        if (document.querySelector(`link[rel="prefetch"][href="${abs}"]`)) return;
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.href = abs;
        document.head.appendChild(link);
      });
    },
    { once: true }
  );
}

const OFFICIAL_RATING_CANONICAL_MAP = new Map([
  ["TVMA", "TV-MA"],
  ["TV14", "TV-14"],
  ["TVPG", "TV-PG"],
  ["TVG", "TV-G"],
  ["TVY7", "TV-Y7"],
  ["TVY10", "TV-Y10"],
  ["TVY", "TV-Y"],
  ["PG13", "PG-13"],
  ["NC17", "NC-17"],
  ["FSK0", "FSK 0"],
  ["FSK6", "FSK 6"],
  ["FSK12", "FSK 12"],
  ["FSK16", "FSK 16"],
  ["FSK18", "FSK 18"],
  ["PEGI3", "PEGI 3"],
  ["PEGI7", "PEGI 7"],
  ["PEGI12", "PEGI 12"],
  ["PEGI16", "PEGI 16"],
  ["PEGI18", "PEGI 18"],
]);

export function formatOfficialRatingLabel(rating) {
  if (rating == null) return null;

  const text = String(rating)
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  const upper = text.toUpperCase();
  if (/^(?:N\/A|NA|NONE|NULL|UNDEFINED|UNKNOWN)$/.test(upper)) return null;

  const compact = upper.replace(/[\s._/\\-]+/g, "");
  const canonical = OFFICIAL_RATING_CANONICAL_MAP.get(compact);
  if (canonical) return canonical;

  const leadingPlusMatch = upper.match(/^\+\s*(\d{1,2})$/);
  if (leadingPlusMatch) return `${leadingPlusMatch[1]}+`;

  const trailingPlusMatch = upper.match(/^(\d{1,2})\s*\+$/);
  if (trailingPlusMatch) return `${trailingPlusMatch[1]}+`;

  if (/^[A-Za-z0-9+/-]{1,12}$/.test(text)) return upper;

  if (!/[a-z]/.test(text)) return upper;

  return text;
}

export async function getHighResImageUrls(item, backdropIndex) {
  const itemId = item.Id;
  const logoTag = item.ImageTags?.Logo || "";
  const pixelRatio = Math.max(1, Math.min(2, Number(window.devicePixelRatio) || 1));
  const logoHeight = Math.floor(720 * pixelRatio);
  const fmtValue = supportsWebP() ? "webp" : "";
  const index = backdropIndex !== undefined ? backdropIndex : "0";
  const indexNum = Math.max(0, Number(index) || 0);
  const configuredBackdropMaxWidth = Number(config.backdropMaxWidth) || 1920;
  const backdropMaxWidth = Math.max(1280, Math.min(3840, configuredBackdropMaxWidth));
  const backdropTags = Array.isArray(item?.BackdropImageTags) ? item.BackdropImageTags : [];
  const backdropTagFromImageTags = Array.isArray(item?.ImageTags?.Backdrop)
    ? item.ImageTags.Backdrop[indexNum]
    : (indexNum === 0 ? item?.ImageTags?.Backdrop : "");
  const backdropTag = backdropTags[indexNum] || backdropTagFromImageTags || "";
  const thumbTag = item?.ImageTags?.Thumb || "";
  const primaryTag = item?.ImageTags?.Primary || item?.PrimaryImageTag || "";
  const albumPrimaryTag = item?.AlbumPrimaryImageTag || "";
  const fallbackPrimaryTag = primaryTag || albumPrimaryTag || "";
  const fallbackPrimaryItemId = primaryTag
    ? itemId
    : (albumPrimaryTag && item?.AlbumId ? item.AlbumId : itemId);

  const backdropQs = new URLSearchParams();
  backdropQs.set("quality", "90");
  backdropQs.set("maxWidth", String(Math.floor(backdropMaxWidth)));
  if (fmtValue) backdropQs.set("format", fmtValue);
  let backdropUrl = "";
  let backdropPath = "";
  if (backdropTag) {
    backdropQs.set("tag", backdropTag);
    backdropPath = `/Items/${itemId}/Images/Backdrop/${index}`;
    backdropUrl = S(`${backdropPath}?${backdropQs.toString()}`);
  } else if (thumbTag) {
    backdropQs.set("tag", thumbTag);
    backdropPath = `/Items/${itemId}/Images/Thumb`;
    backdropUrl = S(`${backdropPath}?${backdropQs.toString()}`);
  } else if (fallbackPrimaryTag) {
    backdropQs.set("tag", fallbackPrimaryTag);
    backdropPath = `/Items/${fallbackPrimaryItemId}/Images/Primary`;
    backdropUrl = S(`${backdropPath}?${backdropQs.toString()}`);
  } else {
    backdropPath = `/Items/${itemId}/Images/Primary`;
    backdropUrl = S(`${backdropPath}?${backdropQs.toString()}`);
  }

  const srcsetWidths = [1280, 1920, 2560, 3840].filter((w) => w <= 1.25 * backdropMaxWidth);
  const srcset = withServerSrcset(
    srcsetWidths
      .map((width) => {
        const qs = new URLSearchParams(backdropQs.toString());
        qs.set("maxWidth", String(width));
        return `${backdropPath}?${qs.toString()} ${width}w`;
      })
      .join(", ")
  );

  const placeholderQs = new URLSearchParams();
  placeholderQs.set("quality", "20");
  placeholderQs.set("maxWidth", String(Math.max(96, Math.floor(160 * pixelRatio))));
  placeholderQs.set("blur", "15");
  if (fmtValue) placeholderQs.set("format", fmtValue);
  let placeholderUrl = "";
  if (backdropTag) {
    placeholderQs.set("tag", backdropTag);
    placeholderUrl = S(`/Items/${itemId}/Images/Backdrop/${index}?${placeholderQs.toString()}`);
  } else if (thumbTag) {
    placeholderQs.set("tag", thumbTag);
    placeholderUrl = S(`/Items/${itemId}/Images/Thumb?${placeholderQs.toString()}`);
  } else if (fallbackPrimaryTag) {
    placeholderQs.set("tag", fallbackPrimaryTag);
    placeholderQs.set("maxHeight", "50");
    placeholderUrl = S(`/Items/${fallbackPrimaryItemId}/Images/Primary?${placeholderQs.toString()}`);
  } else {
    placeholderQs.set("maxHeight", "50");
    placeholderUrl = S(`/Items/${itemId}/Images/Primary?${placeholderQs.toString()}`);
  }

  const logoQs = new URLSearchParams();
  if (logoTag) logoQs.set("tag", logoTag);
  logoQs.set("quality", "90");
  logoQs.set("maxHeight", String(logoHeight));
  if (fmtValue) logoQs.set("format", fmtValue);
  const logoUrl = S(`/Items/${itemId}/Images/Logo?${logoQs.toString()}`);

  return { backdropUrl, placeholderUrl, logoUrl, srcset };
}

export function createImageWarmQueue({ concurrency = 3 } = {}) {
  const q = [];
  const timers = new Set();
  let active = 0;

  const runNext = () => {
    if (!q.length || active >= concurrency) return;
    const job = q.shift();
    active++;
    (async () => {
      try {
        if (job.shortPreload) {
          const link = document.createElement('link');
          link.rel = 'preload';
          link.as = 'image';
          try { link.fetchPriority = 'low'; } catch {}
          link.href = S(job.url);
          document.head.appendChild(link);
          const removeTimer = setTimeout(() => {
            timers.delete(removeTimer);
            try { link.remove(); } catch {}
          }, 1500);
          timers.add(removeTimer);
        }
        await new Promise((res) => {
          const img = new Image();
          img.decoding = 'async';
          img.loading = 'eager';
          const done = () => {
            img.onload = null;
            img.onerror = null;
            try { img.src = ""; } catch {}
            res();
          };
          img.onload = async () => {
            try { await img.decode?.(); } catch {}
            done();
          };
          img.onerror = () => done();
          img.src = S(job.url);
        });
      } finally {
        active--;
        runNext();
      }
    })();
  };
  const ric = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));

  function enqueue(url, { shortPreload = true } = {}) {
    if (!url) return;
    enqueue._seen ||= new Set();
    if (enqueue._seen.has(url)) return;
    enqueue._seen.add(url);
    q.push({ url, shortPreload });
    ric(runNext, { timeout: 1000 });
  }
  function clear({ resetSeen = true } = {}) {
    q.length = 0;
    for (const id of timers) {
      try { clearTimeout(id); } catch {}
    }
    timers.clear();
    if (resetSeen) {
      try { enqueue._seen?.clear?.(); } catch {}
    }
  }
  return { enqueue, clear };
}
