import { flagHtmlFor, ensureFlagEmojiFont, FLAG_EMOJI_FONT_STACK } from "./flags.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import { getConfig } from "./config.js";
import { applyContainerStyles } from "./positionUtils.js";
import { fetchItemDetailsFromSliderCache } from "./sliderCache.js";
import { calculateMatchPercentage } from "./hoverTrailerModal.js";
import { withServer } from "./jfUrl.js";
import { getTomatoIconHtml } from "./customIcons.js";

const config = getConfig();
const QUALITY_LABEL_BY_LEVEL = {
  sd: "SD",
  hd: "HD",
  fhd: "FHD",
  "4k": "4K"
};

function escapeMetaHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMetaTextSpan(text, ...classNames) {
  const className = ["monwui-meta-text", ...classNames.filter(Boolean)].join(" ");
  return `<span class="${className}">${escapeMetaHtml(text)}</span>`;
}

export function getMetaVibrantColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const h = Math.abs(hash % 360);
  const isCool = h >= 200 && h <= 280;
  const isWarm = h < 45 || h > 300;
  const s = isCool ? 55 : isWarm ? 65 : 50;

  return `hsl(${h}, ${s}%, 45%)`;
}

function applyMetaIconColors(container, itemSeed = "") {
  if (!container) return;
  if (!config?.metaIconColors) return;

  container.querySelectorAll("i").forEach((icon, index) => {
    const cls = icon.className || "";
    const isHeartIcon =
      cls.includes("fa-heart") ||
      !!icon.closest(".monwui-match-percentage, .monwui-match-rating");

    if (
      isHeartIcon ||
      cls.includes("fa-star") ||
      icon.closest(".monwui-t-rating")
    ) {
      icon.style.removeProperty("color");
      return;
    }

    const seed =
      `${itemSeed}-${icon.closest("span")?.className || ""}-${cls}-${index}`;

    icon.style.color = getMetaVibrantColor(seed);
  });
}

function getNormalizedDimension(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
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

function hasPartialPlayback(userData, runtimeTicks = 0) {
  if (!userData || typeof userData !== "object") return false;
  if (isPlaybackCompleted(userData, runtimeTicks)) return false;

  const positionTicks = Number(userData.PlaybackPositionTicks || 0);
  if (!(positionTicks > 0)) return false;

  const totalTicks = Number(runtimeTicks || 0);
  return totalTicks > 0 ? positionTicks < totalTicks : true;
}

function getVideoQualityInfo(videoStream) {
  const width = getNormalizedDimension(videoStream?.Width);
  const height = getNormalizedDimension(videoStream?.Height);
  const longerEdge = Math.max(width, height);
  const shorterEdge = Math.min(width, height);

  let baseQuality = "sd";
  if (longerEdge >= 3800 || shorterEdge >= 2160) {
    baseQuality = "4k";
  } else if (longerEdge >= 1900 || shorterEdge >= 1080) {
    baseQuality = "fhd";
  } else if (longerEdge >= 1200 || shorterEdge >= 720) {
    baseQuality = "hd";
  }

  return {
    baseQuality,
    qualityLabel: QUALITY_LABEL_BY_LEVEL[baseQuality] || QUALITY_LABEL_BY_LEVEL.sd
  };
}

function getVideoResolutionLabel(videoStream) {
  const width = getNormalizedDimension(videoStream?.Width);
  const height = getNormalizedDimension(videoStream?.Height);
  const longerEdge = Math.max(width, height);
  const shorterEdge = Math.min(width, height);
  if (!longerEdge) return "";
  if (longerEdge >= 3800 || shorterEdge >= 2160) return "2160p";
  if (longerEdge >= 2500 || shorterEdge >= 1440) return "1440p";
  if (longerEdge >= 1900 || shorterEdge >= 1080) return "1080p";
  if (longerEdge >= 1200 || shorterEdge >= 720) return "720p";
  if (shorterEdge >= 540) return "576p";
  if (shorterEdge >= 400) return "480p";
  return "360p";
}

function getVideoRangeLabel(videoStream) {
  const range = String(videoStream?.VideoRangeType || "").toUpperCase();
  if (!range) return "SDR";
  if (range.includes("DOLBY") || range.includes("DOVI")) return "DV";
  if (range.includes("HLG")) return "HLG";
  if (range.includes("HDR")) return "HDR";
  return "SDR";
}

function getVideoCodecLabel(videoStream) {
  const codec = String(videoStream?.Codec || "").toLowerCase().trim();
  if (!codec) return "";

  if (codec.includes("av1")) return "AV1";
  if (codec.includes("h265") || codec.includes("hevc") || codec.includes("x265")) return "HEVC";
  if (codec.includes("h264") || codec.includes("avc") || codec.includes("x264")) return "AVC";
  if (codec.includes("vp9")) return "VP9";
  if (codec.startsWith("mpeg") || codec.includes("mpeg4")) return "MPEG";

  return codec.replace(/[^a-z0-9]+/g, "").toUpperCase().slice(0, 5);
}

function getVideoBitDepthLabel(videoStream) {
  const depth = Number(videoStream?.BitDepth || 0);
  if (!Number.isFinite(depth) || depth <= 8) return "";
  return `${Math.round(depth)}BIT`;
}

function getPrimaryAudioStream(mediaStreams = []) {
  const audioStreams = Array.isArray(mediaStreams)
    ? mediaStreams.filter(stream => stream?.Type === "Audio")
    : [];

  if (!audioStreams.length) return null;

  return (
    audioStreams.find(stream => stream?.IsDefault) ||
    audioStreams.find(stream => Number(stream?.Index) >= 0) ||
    audioStreams[0]
  );
}

function getAudioCodecLabel(audioStream) {
  if (!audioStream) return "";

  const raw = [
    audioStream.Codec,
    audioStream.DisplayTitle,
    audioStream.Title,
    audioStream.Profile,
    audioStream.CodecTag
  ].filter(Boolean).join(" ").toLowerCase();

  if (!raw) return "";
  if (raw.includes("atmos")) return "ATMOS";
  if (raw.includes("truehd")) return "TRUEHD";
  if (raw.includes("eac3") || raw.includes("dd+")) return "DDP";
  if (raw.includes("ac3") || raw.includes("dolby digital")) return "DD";
  if (raw.includes("dts-hd") || raw.includes("dtshd")) return "DTS-HD";
  if (raw.includes("dts")) return "DTS";
  if (raw.includes("flac")) return "FLAC";
  if (raw.includes("aac")) return "AAC";
  if (raw.includes("opus")) return "OPUS";
  if (raw.includes("mp3")) return "MP3";
  if (raw.includes("pcm") || raw.includes("lpcm")) return "PCM";

  const codec = String(audioStream?.Codec || "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
  return codec.slice(0, 7);
}

function getAudioLayoutLabel(audioStream) {
  if (!audioStream) return "";

  const channels = Number(audioStream?.Channels || 0);
  if (Number.isFinite(channels) && channels > 0) {
    if (channels === 1) return "1.0";
    if (channels === 2) return "2.0";
    if (channels === 6) return "5.1";
    if (channels === 8) return "7.1";
    return `${channels}CH`;
  }

  const layout = String(audioStream?.ChannelLayout || "").toUpperCase().trim();
  if (layout.includes("7.1")) return "7.1";
  if (layout.includes("5.1")) return "5.1";
  if (layout.includes("2.0")) return "2.0";
  return "";
}

function buildQualitySegment(label, part, extra = "") {
  const safeLabel = escapeMetaHtml(String(label || "").trim());
  if (!safeLabel) return "";
  const safePart = escapeMetaHtml(part);
  const extraAttr = extra ? ` data-pf-extra="${escapeMetaHtml(extra)}"` : "";
  return `
    <span class="monwui-quality-segment monwui-quality-segment--${safePart}" data-quality-part="${safePart}"${extraAttr}>
      ${safeLabel}
    </span>
  `.trim();
}

export function ensureVideoQualityBadgeStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("monwui-video-quality-style")) return;

  // Interruptor de emergencia: localStorage.setItem("pf:qualityExtras","off") volta ao rotulo antigo (FHD) e esconde o audio na linha de formato.
  try {
    if (window.localStorage.getItem("pf:qualityExtras") === "off") document.documentElement.setAttribute("data-pf-quality-extras", "off");
  } catch {}

  const style = document.createElement("style");
  style.id = "monwui-video-quality-style";
  style.textContent = `
    html:not([data-pf-quality-extras="off"]) .monwui-format-container .video-quality .monwui-quality-group[data-quality-group="audio"] {
      display: inline-flex !important;
    }
    html:not([data-pf-quality-extras="off"]) .monwui-quality-segment[data-pf-extra="lvl"],
    html[data-pf-quality-extras="off"] .monwui-quality-segment[data-pf-extra="res"] {
      display: none !important;
    }
    .monwui-quality-group {
      --monwui-quality-size: 24px;
      --monwui-quality-gap: 2px;
      --monwui-quality-direction: row;
      --monwui-quality-wrap: wrap;
      align-items: flex-start;
      display: inline-flex;
      flex-direction: var(--monwui-quality-direction);
      flex-wrap: var(--monwui-quality-wrap);
      gap: var(--monwui-quality-gap);
      justify-content: flex-start;
      max-width: 100%;
    }
    .monwui-quality-segment {
      align-items: center;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      box-sizing: border-box;
      color: #fff;
      display: inline-flex;
      font-family: var(--mwui-font-head, "Roboto Condensed", sans-serif);
      font-size: 10px;
      font-weight: 700;
      height: var(--monwui-quality-size);
      justify-content: center;
      letter-spacing: 0.04em;
      line-height: 1;
      min-width: var(--monwui-quality-size);
      padding: 0 4px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .monwui-quality-segment--level {
      background: rgba(37, 99, 235, 0.92);
    }
    .monwui-quality-segment--range {
      background: rgba(234, 88, 12, 0.92);
    }
    .monwui-quality-segment--codec {
      background: rgba(71, 85, 105, 0.92);
    }
    .monwui-quality-segment--bitdepth {
      background: rgba(79, 70, 229, 0.92);
    }
    .monwui-quality-segment--audio {
      background: rgba(5, 150, 105, 0.92);
    }
    .monwui-quality-segment--audio-layout {
      background: rgba(8, 145, 178, 0.92);
    }
    .monwui-dot-quality-badge,
    .mini-quality-inline,
    .monwui-format-container .video-quality,
    .quality-badge .quality-text,
    .jf-notif-item .quality,
    .jf-resume-card .quality {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .quality-badge,
    .monwui-dot-quality-badge {
      --monwui-quality-direction: column;
      --monwui-quality-wrap: nowrap;
    }
    .quality-badge .quality-text {
      align-items: flex-start;
      background: none;
      border-radius: 0;
      padding: 0;
    }
    .quality-badge .monwui-quality-group,
    .monwui-dot-quality-badge .monwui-quality-group {
      align-items: flex-start;
    }
    .jf-resume-card .quality {
      justify-content: center;
    }
  `;
  document.head.appendChild(style);
}

export function createSlidesContainer(indexPage) {
  let slidesContainer = indexPage.querySelector("#monwui-slides-container");
  if (!slidesContainer) {
    slidesContainer = document.createElement("div");
    slidesContainer.id = "monwui-slides-container";
    applyContainerStyles(slidesContainer);
    indexPage.insertBefore(slidesContainer, indexPage.firstChild);
  }
  return slidesContainer;
}

export function createHorizontalGradientOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "monwui-horizontal-gradient-overlay";
  return overlay;
}

export function createLogoContainer() {
  const container = document.createElement("div");
  container.className = "monwui-logo-container";
  applyContainerStyles(container, 'logo');
  return container;
}

function createTypeSpan(itemType, config, ChildCount) {
  if (itemType && config.showTypeInfo) {
    const typeSpan = document.createElement("span");
    typeSpan.className = "type";
    const typeTranslations = {
      Series: { text: config.languageLabels.dizi, icon: '<i class="fas fa-tv "></i>' },
      Season: { text: config.languageLabels.season, icon: '<i class="fas fa-tv "></i>' },
      Episode: { text: config.languageLabels.episode, icon: '<i class="fas fa-tv "></i>' },
      BoxSet: { text: config.languageLabels.boxset, icon: '<i class="fas fa-film "></i>' },
      Movie: { text: config.languageLabels.film, icon: '<i class="fas fa-film "></i>' }
    };
    const typeInfo = typeTranslations[itemType] || { text: itemType, icon: "" };
    let typeText = typeInfo.text;
    if (itemType === "Series" && ChildCount) {
      typeText += ` (${ChildCount} ${config.languageLabels.sezon})`;
    }
    if (itemType === "BoxSet" && ChildCount) {
      typeText += ` (${ChildCount} ${config.languageLabels.seri})`;
    }
    typeSpan.innerHTML = `${typeInfo.icon}${buildMetaTextSpan(typeText, "monwui-type-text")}`;
    return typeSpan;
  }

  return null;
}

function createQualitySpan(config, MediaStreams) {
  const videoStream = MediaStreams ? MediaStreams.find(s => s.Type === "Video") : null;
  if (videoStream && config.showQualityInfo) {
    // Fork ParticularFlix: "Detalhe de qualidade" desligado mostra so a resolucao (sem HDR, codec e audio).
    const qualityHtml = getVideoQualityText(videoStream, MediaStreams, { detail: config.showQualityDetail !== false });
    if (qualityHtml) {
      const qualitySpan = document.createElement("span");
      qualitySpan.className = "video-quality";
      qualitySpan.innerHTML = qualityHtml;
      return qualitySpan;
    }
  }

  return null;
}

export function createFormatContainer(itemType, config, ChildCount, MediaStreams, itemSeed = "") {
  // Fork ParticularFlix: a chave-mestre "Mostrar informacoes de status" (aba Outros) agora vale de verdade;
  // antes ela so acinzentava as sub-opcoes na tela de ajustes.
  if (config.showStatusInfo === false) return null;
  const formatContainer = document.createElement("div");
  formatContainer.className = "monwui-format-container";
  applyContainerStyles(formatContainer, 'format');

  const typeSpan = createTypeSpan(itemType, config, ChildCount);
  if (typeSpan) formatContainer.appendChild(typeSpan);

  const qualitySpan = createQualitySpan(config, MediaStreams);
  if (qualitySpan) formatContainer.appendChild(qualitySpan);

  if (!formatContainer.childElementCount) return null;
  applyMetaIconColors(formatContainer, itemSeed);
  return formatContainer;
}

export function createStatusContainer(config, UserData, RunTimeTicks) {
  if (config.showStatusInfo === false) return null;
  const statusContainer = document.createElement("div");
  statusContainer.className = "monwui-status-container";
  applyContainerStyles(statusContainer, 'status');
  const hasResumeProgress = !Array.isArray(RunTimeTicks) && hasPartialPlayback(UserData, RunTimeTicks);

  if (UserData && config.showWatchedInfo) {
    const watchedSpan = document.createElement("span");
    watchedSpan.className = "watched-status";
    if (UserData.Played) watchedSpan.dataset.tone = "great";
    const watchedIcon = UserData.Played
      ? `<i class="fa-regular fa-circle-check"></i>`
      : `<i class="fa-regular fa-circle-xmark"></i>`;
    let watchedText = UserData.Played
      ? config.languageLabels.izlendi
      : config.languageLabels.izlenmedi;
    if (UserData.Played && UserData.PlayCount > 0) {
      watchedText += ` (${UserData.PlayCount})`;
    }
    watchedSpan.innerHTML = `${watchedIcon}${buildMetaTextSpan(watchedText, "monwui-watched-text")}`;
    statusContainer.appendChild(watchedSpan);
  }

    if (RunTimeTicks && config.showRuntimeInfo) {
    const runtimeSpan = document.createElement("span");
    runtimeSpan.className = "sure";
    runtimeSpan.dataset.tone = "info";

    const calcRuntime = (ticks) => {
      const totalMinutes = Math.floor(ticks / 600000000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return hours > 0
        ? `${hours}${config.languageLabels.sa} ${minutes}${config.languageLabels.dk}`
        : `${minutes}${config.languageLabels.dk}`;
    };

    const formatEndTimeLocalized = (ticks) => {
      const totalMinutes = Math.floor(ticks / 600000000);
      const end = new Date(Date.now() + totalMinutes * 60 * 1000);
      const locale = String(config?.languageLabels?.timeLocale || "tr-TR").trim() || "tr-TR";

      try {
        return new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit"
        }).format(end);
      } catch {
        const hh = String(end.getHours()).padStart(2, "0");
        const mm = String(end.getMinutes()).padStart(2, "0");
        return `${hh}:${mm}`;
      }
    };

    if (Array.isArray(RunTimeTicks)) {
      runtimeSpan.innerHTML =
        `<i class="fa-solid fa-hourglass-end"></i>` +
        buildMetaTextSpan(
          RunTimeTicks.map(val => calcRuntime(val)).join(", "),
          "monwui-runtime-text"
        );
    } else {
      const remainingTicks =
        hasResumeProgress
          ? Math.max(RunTimeTicks - UserData.PlaybackPositionTicks, 0)
          : RunTimeTicks;
      const endHHMM = formatEndTimeLocalized(remainingTicks);
      const endTimeLabel = String(config?.languageLabels?.endTimeLabel || "").trim();
      runtimeSpan.innerHTML = `
        <i class="fa-solid fa-hourglass-end"></i>
        ${buildMetaTextSpan(calcRuntime(RunTimeTicks), "monwui-runtime-text")}
        <span class="end-time">
          <i class="fa-solid fa-clock"></i>
          ${buildMetaTextSpan(`${endTimeLabel ? `${endTimeLabel} ` : ""}${endHHMM}`, "monwui-end-time-text")}
        </span>
      `.trim();
    }

    statusContainer.appendChild(runtimeSpan);
  }

  return statusContainer.childElementCount ? statusContainer : null;
}

function getPeopleArray(value) {
  return Array.isArray(value) ? value : [];
}

async function resolvePeopleForItem(People, item) {
  const directPeople = getPeopleArray(People);
  if (directPeople.length) return directPeople;

  const embeddedSeriesPeople = getPeopleArray(item?.SeriesData?.People);
  if (embeddedSeriesPeople.length) return embeddedSeriesPeople;

  if (
    (item?.Type === "Episode" || item?.Type === "Season") &&
    item?.SeriesId
  ) {
    try {
      const parent = await fetchItemDetailsFromSliderCache(item.SeriesId);
      const parentPeople = getPeopleArray(parent?.People);
      if (parentPeople.length) return parentPeople;
    } catch (e) {
      console.warn("Ana dizi bilgileri alınamadı:", e);
    }
  }

  return directPeople;
}

export async function createActorSlider(People, config, item) {
  if (config.showActorAll) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.display = "none";
    return emptyDiv;
  }

  const actualPeople = await resolvePeopleForItem(People, item);

  const allActors = (actualPeople || []).filter(p => p.Type === "Actor");
  const actorsForSlide = allActors.slice(0, config.artistLimit || 9);

  if (actorsForSlide.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.display = "none";
    return emptyDiv;
  }

  const sliderWrapper = document.createElement("div");
  sliderWrapper.className = "monwui-slider-wrapper monwui-artist-menu";
  if (!config.showActorImg) {
    sliderWrapper.classList.add("monwui-artist-menu--no-images");
  }

  const actorToggle = document.createElement("button");
  actorToggle.type = "button";
  actorToggle.className = "monwui-artist-toggle";
  actorToggle.setAttribute("aria-expanded", "false");
  actorToggle.setAttribute(
    "aria-label",
    `${config.languageLabels?.showActorInfo || "Actors"} (${actorsForSlide.length})`
  );
  actorToggle.innerHTML = `
    <i class="fa-solid fa-users"></i>
    <span class="monwui-artist-count">${actorsForSlide.length}</span>
  `.trim();

  const actorPanel = document.createElement("div");
  actorPanel.className = "monwui-artist-popover";
  const panelIdSeed = `${item?.Id || "unknown"}-${Math.random().toString(36).slice(2, 8)}`;
  actorPanel.id = `monwui-artist-popover-${panelIdSeed.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  actorPanel.setAttribute("role", "region");
  actorPanel.setAttribute("aria-label", config.languageLabels?.showActorInfo || "Actors");
  actorToggle.setAttribute("aria-controls", actorPanel.id);

  const actorPanelBody = document.createElement("div");
  actorPanelBody.className = "monwui-artist-popover-body";

  const actorContainer = document.createElement("div");
  actorContainer.className = "monwui-artist-container";

  const leftArrow = document.createElement("button");
  leftArrow.type = "button";
  leftArrow.className = "monwui-slider-arrow left hidden";
  leftArrow.setAttribute("aria-label", "Previous actors");
  leftArrow.innerHTML = `<i class="fa-solid fa-chevron-left"></i>`;

  const rightArrow = document.createElement("button");
  rightArrow.type = "button";
  rightArrow.className = "monwui-slider-arrow right hidden";
  rightArrow.setAttribute("aria-label", "Next actors");
  rightArrow.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;

  actorPanelBody.appendChild(leftArrow);
  actorPanelBody.appendChild(actorContainer);
  actorPanelBody.appendChild(rightArrow);
  actorPanel.appendChild(actorPanelBody);
  sliderWrapper.appendChild(actorToggle);
  sliderWrapper.appendChild(actorPanel);

  let hoverCloseTimer = 0;
  const clearHoverCloseTimer = () => {
    if (!hoverCloseTimer) return;
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = 0;
  };
  const setExpanded = (expanded) => {
    actorToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  };
  const blurFocusedArrow = () => {
    const activeElement = document.activeElement;
    if (
      activeElement &&
      sliderWrapper.contains(activeElement) &&
      activeElement.classList?.contains("monwui-slider-arrow")
    ) {
      activeElement.blur();
    }
  };
  [leftArrow, rightArrow].forEach((arrow) => {
    arrow.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    arrow.addEventListener("click", () => {
      setTimeout(() => {
        if (!sliderWrapper.matches(":hover")) {
          arrow.blur();
          setExpanded(false);
        }
      }, 0);
    });
  });
  sliderWrapper.addEventListener("mouseenter", () => {
    clearHoverCloseTimer();
    setExpanded(true);
  });
  sliderWrapper.addEventListener("mouseleave", () => {
    if (sliderWrapper.classList.contains("is-open")) return;
    blurFocusedArrow();
    clearHoverCloseTimer();
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = 0;
      if (!sliderWrapper.matches(":hover") && !sliderWrapper.matches(":focus-within")) {
        setExpanded(false);
      }
    }, 180);
  });
  sliderWrapper.addEventListener("focusin", () => {
    clearHoverCloseTimer();
    setExpanded(true);
  });
  sliderWrapper.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!sliderWrapper.matches(":focus-within")) {
        sliderWrapper.classList.remove("is-open");
        setExpanded(false);
      }
    }, 0);
  });
  actorToggle.addEventListener("click", (event) => {
    event.preventDefault();
    clearHoverCloseTimer();
    const nextOpen = !sliderWrapper.classList.contains("is-open");
    sliderWrapper.classList.toggle("is-open", nextOpen);
    setExpanded(nextOpen);
    if (!nextOpen) actorToggle.blur();
  });

  actorsForSlide.forEach(actor => {
    const actorDiv = document.createElement("div");
    actorDiv.className = "monwui-actor-item";

    const actorContent = document.createElement("div");
    actorContent.className = "monwui-actor-content";

    const actorLink = document.createElement("a");
    actorLink.href = `#/details?id=${actor.Id}${config?.serverId ? `&serverId=${encodeURIComponent(config.serverId)}` : ""}`;
    actorLink.target = "_blank";
    actorLink.style.textDecoration = "none";

    if (config.showActorImg) {
      const actorImg = document.createElement("img");
      actorImg.className = "monwui-actor-image";
      actorImg.loading = "lazy";
      if (actor.PrimaryImageTag) {
        actorImg.src = withServer(`/Items/${actor.Id}/Images/Primary?fillHeight=320&fillWidth=320&quality=80&tag=${actor.PrimaryImageTag}`);
        actorImg.alt = actor.Name;
      } else {
        actorImg.src = "./slider/src/images/nofoto.png";
        actorImg.alt = "No Image";
      }
      actorImg.onerror = () => {
        actorImg.src = "./slider/src/images/nofoto.png";
      };
      actorLink.appendChild(actorImg);
      actorContent.appendChild(actorLink);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "monwui-actor-name";
    nameSpan.textContent = config.showActorInfo ? actor.Name || "" : "";
    actorContent.appendChild(nameSpan);

    const roleSpan = document.createElement("span");
    roleSpan.className = "monwui-actor-role";
    roleSpan.textContent = config.showActorRole ? actor.Role || "" : "";
    actorContent.appendChild(roleSpan);

    actorDiv.appendChild(actorContent);
    actorContainer.appendChild(actorDiv);
  });

  return sliderWrapper;
}

export function createInfoContainer({ config, Genres, ProductionYear, ProductionLocations }) {
  const container = document.createElement("div");
  container.className = "monwui-info-container";
  applyContainerStyles(container, "info");
  // Fork ParticularFlix: chave-mestre "Genero, ano e pais" (aba Outros) respeitada no slide.
  if (config.showInfo === false) return null;

  const normalizeKey = (str) => str?.toString().toLowerCase().replace(/\s+/g, "");

  const parts = [];

  if (Array.isArray(Genres) && Genres.length && config.showGenresInfo) {
    const translated = Genres.map((genre) => {
      const key = normalizeKey(genre);
      const matchedEntry = Object.entries(config.languageLabels.turler || {}).find(
        ([labelKey]) => normalizeKey(labelKey) === key
      );
      return matchedEntry ? matchedEntry[1] : genre;
    }).join(", ");

    parts.push(`<span class="genres"><i class="fa-solid fa-masks-theater"></i> ${translated}</span>`);
  }

  if (ProductionYear && config.showYearInfo) {
    const yearText = Array.isArray(ProductionYear) ? ProductionYear.join(", ") : ProductionYear;
    parts.push(`<span class="yil"><i class="fa-solid fa-calendar"></i> ${yearText}</span>`);
  }

  if (ProductionLocations && config.showCountryInfo) {
    ensureFlagEmojiFont(resolveSliderAssetHref("/slider/src/fonts/TwemojiCountryFlags.woff2"));
    const getFlagEmoji = (code) => {
      const cc = String(code || "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) return "";
      const emoji = cc.split("").map((char) => String.fromCodePoint(127397 + char.charCodeAt(0))).join("");
      return `<span class="jms-flag-emoji" style='font-family:${FLAG_EMOJI_FONT_STACK};font-style:normal'>${emoji}</span>`;
    };

    const getCountryInfo = (countryRaw) => {
      const key = normalizeKey(countryRaw);
      const matchedEntry = Object.entries(config.languageLabels.ulke || {}).find(
        ([labelKey]) => normalizeKey(labelKey) === key
      );
      return matchedEntry
        ? matchedEntry[1]
        : { code: countryRaw.slice(0, 2).toUpperCase(), name: countryRaw };
    };

    const countryText = Array.isArray(ProductionLocations)
      ? ProductionLocations.map((c) => {
          const info = getCountryInfo(c);
          return `${getFlagEmoji(info.code)} ${info.name}`;
        }).join("&nbsp;&nbsp;◦&nbsp;&nbsp;")
      : (() => {
          const info = getCountryInfo(ProductionLocations);
          return `${getFlagEmoji(info.code)} ${info.name}`;
        })();

    parts.push(`<span class="ulke"><i class="fa-solid fa-location-dot"></i> ${countryText}</span>`);
  }

  container.innerHTML = parts.join(` <span class="info-sep">✧</span> `);

  if (!parts.length) container.style.display = "none";

  return container;
}

export async function createDirectorContainer({ config, People, item }) {
  const container = document.createElement("div");
  container.className = "monwui-director-container";
  applyContainerStyles(container, 'director');

  const actualPeople = await resolvePeopleForItem(People, item);

  if (actualPeople && actualPeople.length > 0 && config.showDirectorWriter) {
    if (config.showDirector) {
      const directors = actualPeople.filter(p => p.Type?.toLowerCase() === "director");
      if (directors.length) {
        const directorNames = directors.map(d => d.Name).join(", ");
        const directorSpan = document.createElement("span");
        directorSpan.className = "monwui-yonetmen";
        directorSpan.textContent = `${config.languageLabels.yonetmen}: ${directorNames}`;
        container.appendChild(directorSpan);
      }
    }

    if (config.showWriter) {
      const writers = actualPeople.filter(p => p.Type?.toLowerCase() === "writer");
      const allow = (config.allowedWriters || [])
        .map(x => x?.toLowerCase?.())
        .filter(Boolean);
      const matchingWriters = writers.filter(w =>
        w?.Name && allow.includes(w.Name.toLowerCase())
      );
      if (matchingWriters.length) {
        const writerNames = matchingWriters.map(w => w.Name).join(", ");
        const writerSpan = document.createElement("span");
        writerSpan.className = "writer";
        writerSpan.textContent = `${writerNames} ${config.languageLabels.yazar} ...`;
        container.appendChild(writerSpan);
      }
    }
  }

  return container;
}


// Fork ParticularFlix: tom de cor de cada selo de nota (usado por badges.css via data-tone / data-age)
function toneFromPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n >= 85) return "great";
  if (n >= 70) return "good";
  if (n >= 50) return "average";
  if (n >= 30) return "poor";
  return "bad";
}

function toneFromCritic(value) {
  const first = Array.isArray(value) ? value[0] : value;
  const n = parseFloat(String(first ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return "";
  const pct = n <= 10 ? n * 10 : n;
  if (pct >= 75) return "great";
  if (pct >= 60) return "good";
  if (pct >= 40) return "average";
  if (pct >= 25) return "poor";
  return "bad";
}

function ageFromOfficialRating(value) {
  const raw = String(Array.isArray(value) ? value[0] : value ?? "").trim().toUpperCase();
  if (!raw) return "";
  const named = {
    L: "0", LIVRE: "0", G: "0", "TV-Y": "0", "TV-G": "0", ALL: "0", "0": "0",
    PG: "10", "TV-PG": "10", "TV-Y7": "10",
    "PG-13": "12", "TV-14": "14",
    R: "16", "NC-17": "18", "TV-MA": "18", X: "18"
  };
  const bare = raw.replace(/^[A-Z]{2,3}[-_: ]/, "");
  if (named[raw]) return named[raw];
  if (named[bare]) return named[bare];
  const m = bare.match(/(\d{1,2})\s*\+?$/);
  if (!m) return "";
  const age = Number(m[1]);
  if (age <= 0) return "0";
  if (age <= 10) return "10";
  if (age <= 12) return "12";
  if (age <= 14) return "14";
  if (age <= 17) return "16";
  return "18";
}

export async function createRatingContainer({
  config,
  CommunityRating,
  CriticRating,
  OfficialRating,
  UserData,
  item
}) {
  const container = document.createElement("div");
  container.className = "monwui-rating-container";
  applyContainerStyles(container, 'rating');

  let ratingExists = false;

  if (config.showRatingInfo) {
    if (config.showMatchPercentage && UserData && item) {
      const buildMatchSpan = (matchPercentage) => {
        const matchSpan = document.createElement("span");
        matchSpan.className = "monwui-match-percentage";
        const matchTone = toneFromPercent(matchPercentage);
        if (matchTone) matchSpan.dataset.tone = matchTone;
        matchSpan.innerHTML = `
  <span class="monwui-match-rating">
    <i class="fa-regular fa-heart fa-lg"></i>
      <span class="monwui-heart-filled" style="clip-path: inset(${100 - matchPercentage}% 0 0 0);">
      <i class="fa-solid fa-heart fa-lg"></i>
    </span>
  </span>
  ${buildMetaTextSpan(`${matchPercentage}%`, "monwui-percentage-text")}`;
        return matchSpan;
      };
      // Fork ParticularFlix 3.8.2.45: o calculo precisa dos generos favoritos do usuario, que numa
      // partida sem cache (uma vez por dia) levava segundos e segurava o primeiro slide. Agora espera
      // no maximo 350 ms; se ainda nao chegou, o slide sai sem o percentual e ele entra assim que
      // o calculo terminar. localStorage jms:fastStart = "off" mantem a espera completa.
      const matchPromise = calculateMatchPercentage(UserData, item);
      let fastMatch = true;
      try { fastMatch = localStorage.getItem("jms:fastStart") !== "off"; } catch {}
      let matchPercentage = null;
      if (fastMatch) {
        const TIMED_OUT = Symbol("match-timeout");
        let timer = 0;
        const raced = await Promise.race([
          matchPromise,
          new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), 350); })
        ]);
        clearTimeout(timer);
        if (raced === TIMED_OUT) {
          ratingExists = true; // o container entra no slide agora e recebe o percentual depois
          matchPromise.then((late) => {
            try {
              if (container.querySelector(".monwui-match-percentage")) return;
              container.insertBefore(buildMatchSpan(late), container.firstChild);
            } catch {}
          }).catch(() => {});
        } else {
          matchPercentage = raced;
        }
      } else {
        matchPercentage = await matchPromise;
      }
      if (matchPercentage != null) {
        container.appendChild(buildMatchSpan(matchPercentage));
        ratingExists = true;
      }
    }

    if (config.showCommunityRating && CommunityRating) {
    let ratingValue = Array.isArray(CommunityRating)
    ? Math.round((CommunityRating.reduce((a, b) => a + b, 0) / CommunityRating.length) * 10) / 10
    : Math.round(CommunityRating * 10) / 10;

  let ratingClass = "monwui-rating-default";
  if (ratingValue >= 9) ratingClass = "monwui-rating-excellent";
  else if (ratingValue >= 7.5) ratingClass = "monwui-rating-good";
  else if (ratingValue >= 6) ratingClass = "monwui-rating-average";
  else if (ratingValue >= 4) ratingClass = "monwui-rating-poor";
  else ratingClass = "monwui-rating-bad";

  const ratingPercentage = ratingValue * 10;
  const ratingSpan = document.createElement("span");
  ratingSpan.className = `monwui-rating ${ratingClass}`;
  ratingSpan.dataset.tone = ratingClass.replace("monwui-rating-", "").replace("excellent", "great");
  ratingSpan.innerHTML = `
    <span class="monwui-star-rating">
      <i class="fa-regular fa-star fa-lg"></i>
      <span class="monwui-star-filled" style="clip-path: inset(${100 - ratingPercentage}% 0 0 0);">
        <i class="fa-solid fa-star fa-lg" style="display: block;"></i>
      </span>
    </span>
    ${buildMetaTextSpan(ratingValue, "monwui-rating-text")}`;
  container.appendChild(ratingSpan);
  ratingExists = true;
}

    if (config.showCriticRating && CriticRating) {
      const criticSpan = document.createElement("span");
      criticSpan.className = "monwui-t-rating";
      const criticTone = toneFromCritic(CriticRating);
      if (criticTone) criticSpan.dataset.tone = criticTone;
      criticSpan.innerHTML =
        `${getTomatoIconHtml()}` +
        buildMetaTextSpan(
          Array.isArray(CriticRating) ? CriticRating.join(", ") : CriticRating,
          "monwui-critic-rating-text"
        );
      container.appendChild(criticSpan);
      ratingExists = true;
    }

    if (config.showOfficialRating && OfficialRating) {
      const officialRatingSpan = document.createElement("span");
      officialRatingSpan.className = "monwui-officialrating";
      const ageTone = ageFromOfficialRating(OfficialRating);
      if (ageTone) officialRatingSpan.dataset.age = ageTone;
      officialRatingSpan.innerHTML =
        `<i class="fa-solid fa-user-group"></i>` +
        buildMetaTextSpan(
          Array.isArray(OfficialRating) ? OfficialRating.join(", ") : OfficialRating,
          "monwui-officialrating-text"
        );
      container.appendChild(officialRatingSpan);
      ratingExists = true;
    }
  }

  return { container, ratingExists };
}

export function createLanguageContainer({ config, MediaStreams, itemType }) {
  const container = document.createElement("div");
  container.className = "monwui-language-container";

  if (
    !config.showLanguageInfo ||
    !MediaStreams ||
    MediaStreams.length === 0 ||
    String(itemType || "").toLowerCase() === "series"
  ) {
    return container;
  }

  const subtitleCodecs = ["srt", "ass", "vtt", "subrip", "pgssub", "dvdsub", "dvbsub"];

  // Fork ParticularFlix: o rotulo agora reflete exatamente as faixas de audio do arquivo
  // (antes mostrava sempre "English Audio" quando existia qualquer faixa no idioma padrao).
  const hasTypes = MediaStreams.some((stream) => stream?.Type);
  const audioCodecs = ["ac3", "eac3", "aac", "mp3", "flac", "dts", "truehd", "opus", "vorbis", "pcm_s16le", "pcm_s24le"];
  const allAudio = MediaStreams.filter((stream) => hasTypes
    ? String(stream?.Type || "").toLowerCase() === "audio"
    : (stream?.Codec && audioCodecs.includes(String(stream.Codec).toLowerCase())));
  const mainAudio = allAudio.filter((stream) => !/comment|descri|coment/i.test(String(stream?.Title || "")));
  const audioStreams = mainAudio.length ? mainAudio : allAudio;
  const subtitleStreams = MediaStreams.filter(
    stream => hasTypes
      ? String(stream?.Type || "").toLowerCase() === "subtitle"
      : (stream.Codec && subtitleCodecs.includes(String(stream.Codec).toLowerCase()))
  );

  const hasDefaultSubtitle = subtitleStreams.some(
    stream => stream.Language?.toLowerCase() === config.defaultLanguage
  );
  const hasDefaultAudio = audioStreams.some(
    stream => stream.Language?.toLowerCase() === config.defaultLanguage
  );

  const uiLang = (document.documentElement?.lang || navigator.language || "en").trim() || "en";
  let displayNames = null;
  try { displayNames = new Intl.DisplayNames([uiLang], { type: "language" }); } catch {}
  const capitalize = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  const langName = (stream) => {
    const code = String(stream?.Language || "").trim().toLowerCase();
    if (!code || code === "und" || code === "unk") {
      return config.languageLabels?.audioUnknown || "?";
    }
    let name = "";
    try { name = displayNames?.of(code) || ""; } catch {}
    if (!name || name.toLowerCase() === code || name.toLowerCase() === "root") {
      name = String(stream?.DisplayLanguage || "").replace(/\s*\(.*\)\s*$/, "").trim() || code.toUpperCase();
    }
    return capitalize(name);
  };
  const channelText = (stream) => {
    const layout = String(stream?.ChannelLayout || "");
    const m = layout.match(/(\d)\.(\d)/);
    if (m) return `${m[1]}.${m[2]}`;
    const ch = Number(stream?.Channels) || 0;
    if (!ch) return "";
    if (ch === 1) return "1.0";
    if (ch === 2) return "2.0";
    if (ch === 3) return "2.1";
    if (ch === 6) return "5.1";
    if (ch === 7) return "6.1";
    if (ch === 8) return "7.1";
    return `${ch}ch`;
  };

  // uma entrada por idioma (mantem a ordem do arquivo); em empate vence a faixa com mais canais
  const byLang = new Map();
  for (const stream of audioStreams) {
    const key = langName(stream);
    const prev = byLang.get(key);
    if (!prev || (Number(stream.Channels) || 0) > (Number(prev.Channels) || 0)) {
      byLang.set(key, stream);
    }
  }
  const langEntries = Array.from(byLang.entries());
  const labels = config.languageLabels || {};

  let audioLabel = "";
  let subtitleLabel = "";

  if (langEntries.length) {
    const headText = langEntries.length === 1
      ? (labels.audioSingle || "Audio")
      : langEntries.length === 2
        ? (labels.audioDual || "Dual Audio")
        : (labels.audioMulti || "Multi Audio");
    audioLabel =
      `<i class="fa-solid fa-volume-high"></i>` +
      buildMetaTextSpan(headText, "monwui-audio-label-text");

    const detailsHtml = langEntries
      .map(([name, stream]) => {
        const text = [name, channelText(stream)].filter(Boolean).join(" ");
        return `<span class="monwui-audio-lang">${flagHtmlFor(stream?.Language)}` +
          buildMetaTextSpan(text, "monwui-audio-details-text") + `</span>`;
      })
      .join("");
    if (detailsHtml) audioLabel += `<span class="monwui-audio-langs">${detailsHtml}</span>`;

    const codecs = [];
    for (const [, stream] of langEntries) {
      const c = stream.Codec ? String(stream.Codec).toUpperCase() : "";
      if (c && !codecs.includes(c)) codecs.push(c);
    }
    if (codecs.length) {
      audioLabel +=
        `<i class="fa-solid fa-microchip"></i>` +
        buildMetaTextSpan(codecs.join(" \u00B7 "), "monwui-audio-codec-text");
    }
  }

  if (!hasDefaultAudio && hasDefaultSubtitle) {
    subtitleLabel =
      `<i class="fa-solid fa-closed-captioning"></i>` +
      buildMetaTextSpan(labels.subtitle, "monwui-subtitle-text");
  }

  if (audioLabel) {
    const audioSpan = document.createElement("span");
    audioSpan.className = "audio-label";
    audioSpan.innerHTML = audioLabel;
    container.appendChild(audioSpan);
  }

  if (subtitleLabel) {
    const subtitleSpan = document.createElement("span");
    subtitleSpan.className = "subtitle-label";
    subtitleSpan.innerHTML = subtitleLabel;
    container.appendChild(subtitleSpan);
  }

  return container;
}

export function createMetaContainer(itemSeed = "") {
  const container = document.createElement("div");
  container.className = "monwui-meta-container";
  applyContainerStyles(container, 'meta');
  const originalAppend = container.appendChild.bind(container);
  container.appendChild = (child) => {
    const res = originalAppend(child);
    applyMetaIconColors(container, itemSeed);
    return res;
  };

  return container;
}

export function createMainContentContainer() {
  const container = document.createElement("div");
  container.className = "monwui-main-content-container";
  return container;
}

export function createPlotContainer(config, Overview, UserData, RunTimeTicks) {
  const container = document.createElement("div");
  container.className = "monwui-plot-container";
  applyContainerStyles(container, 'plot');
  const hasResumeProgress = hasPartialPlayback(UserData, RunTimeTicks);

  if (config.showDescriptions && config.showPlotInfo && Overview) {
    const plotSpan = document.createElement("span");
    plotSpan.className = "monwui-plot";
    plotSpan.textContent = Overview;
    container.appendChild(plotSpan);
  }

  if (
    config.showPlaybackProgress &&
    hasResumeProgress &&
    typeof UserData?.PlaybackPositionTicks === "number" &&
    typeof RunTimeTicks === "number"
  ) {
    const progressContainer = document.createElement("div");
    progressContainer.className = "monwui-playing-progress-container";

    const barWrapper = document.createElement("div");
    barWrapper.className = "monwui-duration-bar-wrapper";

    const bar = document.createElement("div");
    bar.className = "monwui-duration-bar";

    const percentage = Math.min(
      (UserData.PlaybackPositionTicks / RunTimeTicks) * 100,
      100
    );
    bar.style.width = `${percentage.toFixed(1)}%`;

    const remainingMinutes = Math.round(
      (RunTimeTicks - UserData.PlaybackPositionTicks) / 600000000
    );
    const text = document.createElement("span");
    text.className = "monwui-duration-remaining";
    text.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> ${remainingMinutes} ${config.languageLabels.dakika} ${config.languageLabels.kaldi}`;

    barWrapper.appendChild(bar);
    progressContainer.appendChild(barWrapper);
    progressContainer.appendChild(text);
    container.appendChild(progressContainer);
  }

  return container;
}

export function createTitleContainer({ config, Taglines, title, OriginalTitle, Type, ParentIndexNumber, IndexNumber }) {
  const container = document.createElement("div");
  container.className = "monwui-title-container";
  applyContainerStyles(container, 'title');

  if (config.showDescriptions && config.showTitleInfo) {
    const titleSpan = document.createElement("span");
    titleSpan.className = "monwui-baslik";

    if (Type === "Episode" && typeof ParentIndexNumber === "number" && typeof IndexNumber === "number") {
      titleSpan.textContent = `S${ParentIndexNumber} B${IndexNumber}: ${title}`;
    } else {
      titleSpan.textContent = title;
    }

    container.appendChild(titleSpan);
  }

  if (Taglines && Taglines.length && config.showDescriptions && config.showSloganInfo) {
    const sloganSpan = document.createElement("span");
    sloganSpan.className = "monwui-slogan";
    sloganSpan.innerHTML = `“ ${Taglines.join(
      ' <i class="fa-solid fa-star fa-2xs" style="color: #ffffff;"></i> '
    )} ”`;
    container.appendChild(sloganSpan);
  }

  if (config.showDescriptions && config.showOriginalTitleInfo && OriginalTitle) {
    if (!config.hideOriginalTitleIfSame || title !== OriginalTitle) {
      const originalTitleSpan = document.createElement("span");
      originalTitleSpan.className = "monwui-o-baslik";
      originalTitleSpan.textContent = OriginalTitle;
      container.appendChild(originalTitleSpan);
    }
  }

  return container;
}

export function getVideoQualityText(videoStream, mediaStreams = null, { detail = true } = {}) {
  if (!videoStream) return "";
  ensureVideoQualityBadgeStyles();

  const { qualityLabel } = getVideoQualityInfo(videoStream);
  const rangeLabel = getVideoRangeLabel(videoStream);
  const codecLabel = getVideoCodecLabel(videoStream);
  const bitDepthLabel = getVideoBitDepthLabel(videoStream);

  const videoParts = [
    buildQualitySegment(qualityLabel, "level", "lvl"),
    buildQualitySegment(getVideoResolutionLabel(videoStream), "level", "res"),
    detail ? buildQualitySegment(rangeLabel, "range") : "",
    detail ? buildQualitySegment(codecLabel, "codec") : "",
    detail ? buildQualitySegment(bitDepthLabel, "bitdepth") : ""
  ].filter(Boolean);

  const audioStream = detail ? getPrimaryAudioStream(mediaStreams) : null;
  const audioParts = [
    buildQualitySegment(getAudioCodecLabel(audioStream), "audio"),
    buildQualitySegment(getAudioLayoutLabel(audioStream), "audio-layout")
  ].filter(Boolean);

  const groups = [];
  if (videoParts.length) {
    groups.push(`
      <span class="monwui-quality-group" data-quality-group="video">
        ${videoParts.join("")}
      </span>
    `.trim());
  }
  if (audioParts.length) {
    groups.push(`
      <span class="monwui-quality-group" data-quality-group="audio">
        ${audioParts.join("")}
      </span>
    `.trim());
  }

  if (!groups.length) return "";

  return groups.join("");
}
