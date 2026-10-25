import { changeSlide } from "./navigation.js";
import { getConfig } from "./config.js";

/*
 * Slider layouts (Cinema, Mosaic, Coverflow) + on-screen previous/next arrows.
 * - The layout name lives in html[data-slider-layout] (set by main.js from the saved cssVariant).
 * - The arrows work on every layout (including Compact, Normal and Peak) and call the same
 *   changeSlide() used by keyboard, swipe and neighbor click, so timers/progress stay in sync.
 * - Mosaic builds a small rail with the next titles; clicking a tile jumps to it.
 */

const ARROWS_ID = "jms-nav-arrows";
const RAIL_CLASS = "jms-mosaic-rail";
const NEXT_CLASS = "jms-nextup";
const STYLE_ID = "jms-nav-arrows-css";

export function readSliderLayout(cfg) {
  if (cfg && typeof cfg.sliderLayout === "string") return cfg.sliderLayout;
  let raw = "";
  try { raw = String(localStorage.getItem("cssVariant") || "").toLowerCase(); } catch {}
  if (raw.includes("coverflow")) return "coverflow";
  if (raw.includes("cinema")) return "cinema";
  if (raw.includes("trailer")) return "cinema";
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
/* the brand script row arrows (.pf-row-arrow) must not double the slider arrows */
#monwui-slides-container .pf-row-arrow,.pf-slider-arrow,.emby-scroller:has(#monwui-slides-container)>.pf-row-arrow,.pf-row-arrow:has(~ #monwui-slides-container){display:none!important}
html[data-slider-layout=mosaic] #${ARROWS_ID} .jms-nav-arrow.next{right:calc(var(--jms-rail-w, 27%) + var(--lay-inset, 12px) + 22px)}
/* Side bar style (Netflix like): no visible button; the hovered side gets a translucent bar over the full slide height and any click on it changes the slide */
#${ARROWS_ID} .jms-bar{position:absolute;top:0;bottom:0;width:clamp(48px,4.6vw,88px);display:none;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity .22s ease;color:#fff}
html[data-arrow-style=bar] #${ARROWS_ID} .jms-bar{display:flex}
html[data-arrow-style=bar] #${ARROWS_ID} .jms-nav-arrow{display:none!important}
#${ARROWS_ID} .jms-bar.prev{left:0;border-radius:var(--lay-radius,24px) 0 0 var(--lay-radius,24px);background:linear-gradient(90deg,rgba(6,9,15,.66),rgba(6,9,15,.3) 55%,rgba(6,9,15,0))}
#${ARROWS_ID} .jms-bar.next{right:0;border-radius:0 var(--lay-radius,24px) var(--lay-radius,24px) 0;background:linear-gradient(270deg,rgba(6,9,15,.66),rgba(6,9,15,.3) 55%,rgba(6,9,15,0))}
html[data-jms-corners=none] #${ARROWS_ID} .jms-bar{border-radius:0}
html[data-slider-layout=mosaic] #${ARROWS_ID} .jms-bar.next{right:calc(var(--jms-rail-w, 27%) + var(--lay-inset, 12px) + 22px);border-radius:0}
#${ARROWS_ID} .jms-bar.hot{opacity:1}
#${ARROWS_ID} .jms-bar svg{width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 2px 6px rgba(0,0,0,.65));transition:transform .2s ease}
#${ARROWS_ID} .jms-bar.hot svg{transform:scale(1.2)}
html.jms-bar-hot #monwui-slides-container,html.jms-bar-hot #monwui-slides-container *{cursor:pointer!important}
@media (hover:none){#${ARROWS_ID} .jms-bar{display:none!important}}
/* Modern dots (Next slide indicator = dots): a glass capsule with a sliding window of dots, the active one is a wine pill. Replaces the plugin's own dots while active. */
html[data-next-style=dots] .monwui-dot-navigation-container{display:none!important}
#monwui-slides-container>.jms-dots{position:absolute;left:50%;bottom:clamp(14px,2.2vh,26px);transform:translateX(-50%);z-index:1100;pointer-events:auto;isolation:isolate;display:flex;align-items:center;gap:10px;
  padding:7px 14px;border-radius:999px;background:rgba(10,14,22,.5);border:1px solid rgba(255,255,255,.1);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  box-shadow:0 8px 22px rgba(0,0,0,.35);max-width:calc(100% - 24px)}
.jms-dots-track{display:flex;align-items:center;gap:7px}
.jms-dot{appearance:none;border:0;padding:0;margin:0;cursor:pointer;width:7px;height:7px;border-radius:999px;background:rgba(255,255,255,.34);transition:width .35s cubic-bezier(.2,.8,.2,1),background .25s ease,transform .25s ease,opacity .25s ease;flex:none}
.jms-dot:hover{background:rgba(255,255,255,.8);transform:scale(1.35)}
.jms-dot.edge{transform:scale(.62);opacity:.55}
.jms-dot.near{background:rgba(255,255,255,.5)}
.jms-dot.active{width:30px;background:linear-gradient(90deg,#b3151d,#d4343c);box-shadow:0 0 10px rgba(179,21,29,.6);transform:none;opacity:1;cursor:default}
.jms-dot:focus-visible{outline:2px solid #fff;outline-offset:2px}
.jms-dots-count{font:600 11px/1 system-ui,sans-serif;color:rgba(255,255,255,.72);letter-spacing:.04em;white-space:nowrap;padding-left:2px;font-variant-numeric:tabular-nums}
@media (max-width:700px){.jms-dots-count{display:none}}
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
  const bar = (cls, d) => {
    const el = document.createElement("div");
    el.className = `jms-bar ${cls}`;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
    return el;
  };
  wrap.append(bar("prev", "M15 4 7 12l8 8"), bar("next", "M9 4l8 8-8 8"));
  container.appendChild(wrap);
  installBarHandlers(container, wrap);
  return wrap;
}

/* Side bar arrows: the bars never take the mouse (pointer-events:none), so buttons, links and trailer controls under them keep working.
   The container decides by position which bar is hot and turns a click on it into previous/next. */
const BAR_SKIP = "button,a,input,select,textarea,label,[role=button],.monwui-main-button-container,.monwui-provider-container,.monwui-preview-volume-control,.monwui-preview-fullscreen-toggle,.monwui-auto-trailer-toggle,.jms-nextup,.jms-mosaic-tile,.jms-mosaic-rail,.monwui-dot-navigation-container,.monwui-artist-popover-body";
function barAt(wrap, ev) {
  if (document.documentElement.dataset.arrowStyle !== "bar") return null;
  if (ev.pointerType === "touch") return null;
  const t = ev.target;
  if (t && t.closest && t.closest(BAR_SKIP)) return null;
  const bars = wrap.querySelectorAll(".jms-bar");
  for (const b of bars) {
    const r = b.getBoundingClientRect();
    if (r.width && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return b;
  }
  return null;
}
function installBarHandlers(container, wrap) {
  if (container.__jmsBarInstalled) return;
  container.__jmsBarInstalled = true;
  const setHot = (hot) => {
    wrap.querySelectorAll(".jms-bar").forEach((b) => b.classList.toggle("hot", b === hot));
    document.documentElement.classList.toggle("jms-bar-hot", !!hot);
  };
  container.addEventListener("pointermove", (ev) => setHot(barAt(wrap, ev)), { passive: true });
  container.addEventListener("pointerleave", () => setHot(null), { passive: true });
  container.addEventListener("click", (ev) => {
    const hot = barAt(wrap, ev);
    if (!hot) return;
    ev.preventDefault();
    ev.stopPropagation();
    try { changeSlide(hot.classList.contains("prev") ? -1 : 1); } catch {}
  }, true);
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

function removeNext(container) {
  container?.querySelectorAll?.(`:scope > .${NEXT_CLASS}`).forEach((n) => n.remove());
}

function renderNext(container) {
  const slides = Array.from(container.querySelectorAll(":scope > .monwui-slide"));
  if (slides.length < 2) { removeNext(container); return; }
  let active = slides.findIndex((s) => s.classList.contains("active"));
  if (active < 0) active = 0;
  const key = [active, slides.length].join(":");
  let card = container.querySelector(`:scope > .${NEXT_CLASS}`);
  if (card && card.dataset.key === key) return;
  if (!card) {
    card = document.createElement("div");
    card.className = NEXT_CLASS;
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    const go = (e) => { e.preventDefault(); e.stopPropagation(); try { changeSlide(1); } catch {} };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
    container.appendChild(card);
  }
  card.dataset.key = key;
  const next = slides[(active + 1) % slides.length];
  const img = tileImage(next);
  card.style.backgroundImage = img ? `url("${img.replace(/"/g, "%22")}")` : "";
  let word = "Up next";
  try { word = getConfig()?.languageLabels?.nextUp || word; } catch {}
  card.textContent = "";
  const tag = document.createElement("div");
  tag.className = "jms-nextup-tag";
  const b = document.createElement("b");
  b.textContent = word;
  const i = document.createElement("i");
  i.textContent = `${active + 1} / ${slides.length}`;
  tag.append(b, i);
  const title = document.createElement("div");
  title.className = "jms-nextup-title";
  title.textContent = tileTitle(next);
  card.append(tag, title);
}


const DOTS_CLASS = "jms-dots";
const DOTS_WINDOW = 9;

function removeDots(container) {
  container?.querySelectorAll?.(`:scope > .${DOTS_CLASS}`).forEach((n) => n.remove());
}

function renderDots(container) {
  const slides = Array.from(container.querySelectorAll(":scope > .monwui-slide"));
  if (slides.length < 2) { removeDots(container); return; }
  let active = slides.findIndex((s) => s.classList.contains("active"));
  if (active < 0) active = 0;
  const n = slides.length;
  const key = [active, n].join(":");
  let box = container.querySelector(`:scope > .${DOTS_CLASS}`);
  if (box && box.dataset.key === key) return;
  if (!box) {
    box = document.createElement("div");
    box.className = DOTS_CLASS;
    box.setAttribute("role", "tablist");
    container.appendChild(box);
  }
  box.dataset.key = key;
  box.textContent = "";
  const win = Math.min(n, DOTS_WINDOW);
  const start = Math.max(0, Math.min(active - Math.floor(win / 2), n - win));
  const track = document.createElement("div");
  track.className = "jms-dots-track";
  for (let i = start; i < start + win; i++) {
    const d = document.createElement("button");
    d.type = "button";
    d.className = "jms-dot";
    d.setAttribute("role", "tab");
    const title = tileTitle(slides[i]);
    d.setAttribute("aria-label", title ? `${i + 1}: ${title}` : String(i + 1));
    if (title) d.title = title;
    if (i === active) { d.classList.add("active"); d.setAttribute("aria-selected", "true"); }
    else if (Math.abs(i - active) === 1) d.classList.add("near");
    if (win < n && ((i === start && start > 0) || (i === start + win - 1 && start + win < n))) d.classList.add("edge");
    d.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (i !== active) { try { changeSlide(i - active); } catch {} }
    });
    track.appendChild(d);
  }
  const count = document.createElement("span");
  count.className = "jms-dots-count";
  count.textContent = `${active + 1} / ${n}`;
  box.append(track, count);
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

function nextStyle() {
  const v = document.documentElement.dataset.nextStyle;
  return v === "dots" || v === "none" ? v : "card";
}

export function refreshSliderLayouts() {
  const container = getContainer();
  if (!container) { disconnect(); return; }
  ensureStyle();
  ensureArrows(container);

  const layout = currentLayout();
  const style = nextStyle();
  const wantCard = layout === "cinema" && style === "card";
  const wantDots = !!layout && style === "dots";
  if (wantCard) renderNext(container); else removeNext(container);
  if (wantDots) renderDots(container); else removeDots(container);
  if (layout === "mosaic") renderRail(container); else removeRail(container);

  if (wantCard || wantDots || layout === "mosaic") {
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
