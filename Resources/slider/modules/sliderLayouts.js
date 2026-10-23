import { changeSlide } from "./navigation.js";

/*
 * Slider layouts (Cinema, Split, Mosaic, Coverflow) + on-screen previous/next arrows.
 * - The layout name lives in html[data-slider-layout] (set by main.js from the saved cssVariant).
 * - The arrows work on every layout (including Compact, Normal and Peak) and call the same
 *   changeSlide() used by keyboard, swipe and neighbor click, so timers/progress stay in sync.
 * - Mosaic builds a small rail with the next titles; clicking a tile jumps to it.
 */

const ARROWS_ID = "jms-nav-arrows";
const RAIL_CLASS = "jms-mosaic-rail";
const STYLE_ID = "jms-nav-arrows-css";

export function readSliderLayout(cfg) {
  if (cfg && typeof cfg.sliderLayout === "string") return cfg.sliderLayout;
  let raw = "";
  try { raw = String(localStorage.getItem("cssVariant") || "").toLowerCase(); } catch {}
  if (raw.includes("coverflow")) return "coverflow";
  if (raw.includes("cinema")) return "cinema";
  if (raw.includes("split")) return "split";
  if (raw.includes("mosaic")) return "mosaic";
  return "";
}

let observer = null;
let observedContainer = null;
let rafId = 0;
let installed = false;

const NAV_CSS = `
#${ARROWS_ID}{position:absolute;inset:0;pointer-events:none;z-index:120}
#${ARROWS_ID} .jms-nav-arrow{position:absolute;top:50%;margin-top:-20px;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.22);
  background:rgba(10,14,22,.55);color:#fff;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;
  pointer-events:auto;opacity:0;transform:scale(.92);transition:opacity .25s ease,transform .25s ease,background .2s ease;
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);padding:0}
#${ARROWS_ID} .jms-nav-arrow.prev{left:10px}
#${ARROWS_ID} .jms-nav-arrow.next{right:10px}
#monwui-slides-container:hover #${ARROWS_ID} .jms-nav-arrow,#${ARROWS_ID} .jms-nav-arrow:focus-visible{opacity:.9;transform:scale(1)}
#${ARROWS_ID} .jms-nav-arrow:hover,#${ARROWS_ID} .jms-nav-arrow:focus-visible{background:#cc0000;border-color:#ff4d4d;opacity:1;outline:0}
@media (hover:none){#${ARROWS_ID}{display:none}}
html[data-slider-layout=mosaic] #${ARROWS_ID} .jms-nav-arrow.next{right:calc(var(--jms-rail-w, 27%) + 14px)}
html[data-slider-layout=coverflow] #${ARROWS_ID} .jms-nav-arrow{width:46px;height:46px;margin-top:-23px}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = NAV_CSS;
  document.head.appendChild(st);
}

function getContainer() {
  return document.querySelector("#monwui-slides-container");
}

function ensureArrows(container) {
  let wrap = container.querySelector(`:scope > #${ARROWS_ID}`);
  if (wrap) return wrap;
  wrap = document.createElement("div");
  wrap.id = ARROWS_ID;
  const mk = (cls, label, glyph, dir) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `jms-nav-arrow ${cls}`;
    b.setAttribute("aria-label", label);
    b.textContent = glyph;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { changeSlide(dir); } catch {}
    });
    return b;
  };
  wrap.append(mk("prev", "Previous slide", "‹", -1), mk("next", "Next slide", "›", 1));
  container.appendChild(wrap);
  return wrap;
}

function tileTitle(slide) {
  const el = slide.querySelector(".monwui-baslik, .baslik, .monwui-no-logo-container");
  return (el?.textContent || "").trim();
}

function tileImage(slide) {
  return slide.dataset.landscapeUrl || slide.dataset.background || slide.dataset.backdropUrl || slide.dataset.primaryUrl || "";
}

function removeRail(container) {
  container?.querySelectorAll?.(`:scope > .${RAIL_CLASS}`).forEach((n) => n.remove());
}

function renderRail(container) {
  const slides = Array.from(container.querySelectorAll(":scope > .monwui-slide"));
  if (slides.length < 2) { removeRail(container); return; }
  let active = slides.findIndex((s) => s.classList.contains("active"));
  if (active < 0) active = 0;

  let rail = container.querySelector(`:scope > .${RAIL_CLASS}`);
  if (!rail) {
    rail = document.createElement("div");
    rail.className = RAIL_CLASS;
    container.appendChild(rail);
  }
  const count = Math.min(3, slides.length - 1);
  const key = [active, slides.length].join(":");
  if (rail.dataset.key === key) return;
  rail.dataset.key = key;
  rail.textContent = "";
  for (let step = 1; step <= count; step++) {
    const slide = slides[(active + step) % slides.length];
    const tile = document.createElement("div");
    tile.className = "jms-mosaic-tile";
    tile.setAttribute("role", "button");
    tile.tabIndex = 0;
    const img = tileImage(slide);
    if (img) tile.style.backgroundImage = `url("${img.replace(/"/g, "%22")}")`;
    const label = document.createElement("span");
    label.textContent = tileTitle(slide);
    tile.appendChild(label);
    const go = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { changeSlide(step); } catch {}
    };
    tile.addEventListener("click", go);
    tile.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
    rail.appendChild(tile);
  }
}

function currentLayout() {
  return document.documentElement.dataset.sliderLayout || "";
}

function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    refreshSliderLayouts();
  });
}

function disconnect() {
  try { observer?.disconnect(); } catch {}
  observer = null;
  observedContainer = null;
}

export function refreshSliderLayouts() {
  const container = getContainer();
  if (!container) { disconnect(); return; }
  ensureStyle();
  ensureArrows(container);

  if (currentLayout() === "mosaic") {
    renderRail(container);
    if (observedContainer !== container) {
      disconnect();
      observedContainer = container;
      observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "childList") {
            const touched = [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && n.classList?.contains("monwui-slide"));
            if (touched) { scheduleRender(); return; }
          } else if (r.target?.classList?.contains("monwui-slide")) {
            scheduleRender();
            return;
          }
        }
      });
      observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    }
  } else {
    removeRail(container);
    disconnect();
  }
}

export function installSliderLayouts() {
  if (installed) { scheduleRender(); return; }
  installed = true;
  document.addEventListener("jms:first-slide-ready", scheduleRender);
  document.addEventListener("jms:slide-enter", scheduleRender, true);
  window.addEventListener("hashchange", () => setTimeout(scheduleRender, 400));
  window.addEventListener("pageshow", scheduleRender);
  scheduleRender();
}
