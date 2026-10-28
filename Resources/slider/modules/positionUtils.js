import { getConfig } from "./config.js";
import { forceHomeSectionsTop } from './positionOverrides.js';

const HEADER_OFFSET_VAR = '--jms-slider-header-offset-px';
const HEADER_REFERENCE_TOP_VAR = '--jms-slider-header-reference-top';
const VISUAL_TOP_VAR = '--jms-slider-visual-top';

let sliderHeaderResizeObserver = null;
let sliderHeaderObservedEl = null;
let sliderHeaderLifecycleBound = false;
let sliderHeaderRafId = 0;
let sliderHeaderMutationObserver = null;

// Fork ParticularFlix 4.0.0.5: 'style' left the filter. Inline styles change all the time (slide transitions, trailer
// fades, previews, other plugins) and each record went through the selector test below; this module was the top script
// of the Home in a CPU profile while trailers played. The header size is still followed by the ResizeObserver, and
// pages and the header still switch by class or hidden.
const SLIDER_HEADER_OBSERVER_OPTIONS = {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['class', 'hidden']
};

const SLIDER_HEADER_RELEVANT_SELECTOR = [
  '.skinHeader',
  'header.MuiAppBar-root',
  '.mainDrawer',
  '.mainDrawerButton',
  '#monwui-slides-container',
  '#indexPage',
  '#homePage',
  "[data-role='page']",
].join(', ');

function normalizeSliderVariant(value) {
  const variant = String(value ?? '').trim().toLowerCase();
  if (!variant) return 'normalslider';
  if (variant.includes('full')) return 'normalslider';
  if (variant.includes('peak')) return 'peakslider';
  if (variant.includes('normal')) return 'normalslider';
  if (variant.includes('slider')) return 'slider';
  return 'normalslider';
}

function getActiveSliderVariant(config = getConfig()) {
  return normalizeSliderVariant(
    config?.cssVariant ??
    document.documentElement?.dataset?.cssVariant ??
    window.__cssVariant ??
    'normalslider'
  );
}

function usesDynamicHeaderOffset(variant = getActiveSliderVariant()) {
  return variant === 'slider' || variant === 'normalslider' || variant === 'peakslider';
}

function hasExplicitSlideTop(config = getConfig()) {
  const value = Number(config?.slideTop);
  return Number.isFinite(value) && value !== 0;
}

function findActiveSlidesContainer() {
  return document.querySelector(
    '#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container, #monwui-slides-container'
  );
}

function getActivePageScrollTop() {
  const activePage = document.querySelector(
    '#indexPage:not(.hide), #homePage:not(.hide), [data-role="page"]:not(.hide)'
  );

  const candidates = [
    window.scrollY,
    window.pageYOffset,
    document.scrollingElement?.scrollTop,
    document.documentElement?.scrollTop,
    document.body?.scrollTop,
    activePage?.scrollTop,
  ];

  let maxScrollTop = 0;
  for (const value of candidates) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > maxScrollTop) {
      maxScrollTop = numericValue;
    }
  }

  return maxScrollTop;
}

function isSliderContextNearTop(maxScrollTop = 24) {
  return getActivePageScrollTop() <= maxScrollTop;
}

function isElementVisible(element) {
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect?.();
  if (!rect || rect.height <= 0 || rect.width <= 0) return false;
  const style = window.getComputedStyle?.(element);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

function findVisibleSkinHeader() {
  const candidates = document.querySelectorAll('.skinHeader:not(.osdHeader)');
  for (const header of candidates) {
    if (isElementVisible(header)) return header;
  }
  // Jellyfin 12 (layout moderno): o cabecalho antigo fica escondido e o visivel e o da interface nova.
  // Na primeira carga ele passa um tempo com visibility:hidden, mas ja ocupa o lugar e tem a altura final:
  // medir por ele desde o inicio evita o slider nascer ~36 px acima e pular para baixo quando ele aparece.
  const modern = document.querySelector('header.MuiAppBar-root');
  if (modern?.isConnected) {
    const rect = modern.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && window.getComputedStyle?.(modern)?.display !== 'none') return modern;
  }
  return null;
}

function readSliderHeaderOffsetPx(container) {
  if (!container) return 0;
  const rawValue =
    container.style.getPropertyValue(HEADER_OFFSET_VAR) ||
    window.getComputedStyle?.(container)?.getPropertyValue?.(HEADER_OFFSET_VAR) ||
    '';
  const numericValue = Number.parseFloat(rawValue);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function readCustomProperty(element, name) {
  if (!element || !name) return '';
  return (
    element.style.getPropertyValue(name) ||
    window.getComputedStyle?.(element)?.getPropertyValue?.(name) ||
    ''
  ).trim();
}

// Fork ParticularFlix: cada resolucao cria uma sonda no DOM e le getComputedStyle (forca recalculo de
// estilo). Valores em px sao lidos direto; valores que dependem so da janela (vh, vw, calc de px/vh/vw)
// ficam em cache por tamanho da janela. Valores com %, em, rem, var() ou env() continuam usando a sonda.
const SIMPLE_PX_RE = /^-?(?:\d+\.?\d*|\.\d+)px$/i;
const CACHEABLE_VIEWPORT_RE = /^[\d\s.+\-*/()%a-z]+$/i;
const NON_CACHEABLE_RE = /%|em\b|rem\b|ex\b|ch\b|lh\b|var\(|env\(|attr\(|\d(?:em|rem|ex|ch|lh)/i;
const cssLengthCache = new Map();

function resolveCssLengthPx(rawValue, contextElement, fallback = 0) {
  const value = String(rawValue ?? '').trim();
  if (!value) return fallback;

  if (SIMPLE_PX_RE.test(value)) return Number.parseFloat(value);

  const cacheable = CACHEABLE_VIEWPORT_RE.test(value) && !NON_CACHEABLE_RE.test(value);
  let cacheKey = '';
  if (cacheable) {
    cacheKey = `${value}|${window.innerWidth}x${window.innerHeight}`;
    if (cssLengthCache.has(cacheKey)) {
      const hit = cssLengthCache.get(cacheKey);
      return Number.isFinite(hit) ? hit : fallback;
    }
  }

  const probe = document.createElement('div');
  const parent = contextElement?.isConnected ? contextElement : document.body;
  if (!parent) return fallback;

  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;width:0;height:0;contain:strict;';
  probe.style.top = value;

  try {
    parent.appendChild(probe);
    const resolved = Number.parseFloat(window.getComputedStyle?.(probe)?.top || '');
    if (cacheKey) {
      if (cssLengthCache.size > 64) cssLengthCache.clear();
      cssLengthCache.set(cacheKey, resolved);
    }
    return Number.isFinite(resolved) ? resolved : fallback;
  } catch {
    return fallback;
  } finally {
    try { probe.remove(); } catch {}
  }
}

function readCssLengthVarPx(element, name, fallback = 0) {
  const rawValue = readCustomProperty(element, name);
  return resolveCssLengthPx(rawValue, element, fallback);
}

function readSliderVisualTopDeltaPx(container) {
  const referenceTopPx = readCssLengthVarPx(container, HEADER_REFERENCE_TOP_VAR, 0);
  const visualTopPx = readCssLengthVarPx(container, VISUAL_TOP_VAR, referenceTopPx);
  return visualTopPx - referenceTopPx;
}

function setSliderHeaderOffsetVar(container, offsetPx) {
  const roundedOffset = Number.isFinite(offsetPx) ? Math.round(offsetPx) : 0;
  const value = `${roundedOffset}px`;

  const rootStyle = document.documentElement?.style;
  if (rootStyle && rootStyle.getPropertyValue(HEADER_OFFSET_VAR) !== value) {
    rootStyle.setProperty(HEADER_OFFSET_VAR, value);
  }

  if (!container) return;
  if (container.style.getPropertyValue(HEADER_OFFSET_VAR) !== value) {
    container.style.setProperty(HEADER_OFFSET_VAR, value);
  }
}

function clearSliderHeaderOffsetVar(container) {
  document.documentElement?.style?.removeProperty(HEADER_OFFSET_VAR);
  if (container) {
    container.style.removeProperty(HEADER_OFFSET_VAR);
  }
}

function clearSliderHeaderObserver() {
  sliderHeaderObservedEl = null;
  if (!sliderHeaderResizeObserver) return;
  try { sliderHeaderResizeObserver.disconnect(); } catch {}
}

function pauseSliderHeaderMutationObserver() {
  try { sliderHeaderMutationObserver?.disconnect(); } catch {}
}

function reconnectSliderHeaderMutationObserver() {
  const root = document.body || document.documentElement;
  if (!sliderHeaderMutationObserver || !root || document.visibilityState === 'hidden') return;
  try { sliderHeaderMutationObserver.disconnect(); } catch {}
  try { sliderHeaderMutationObserver.observe(root, SLIDER_HEADER_OBSERVER_OPTIONS); } catch {}
}

let sliderHeaderLastSyncAt = 0;
let sliderHeaderSyncTimer = 0;
const SLIDER_HEADER_SYNC_MIN_INTERVAL_MS = 120;

function scheduleSliderHeaderOffsetSync() {
  if (sliderHeaderRafId || sliderHeaderSyncTimer) return;
  // Fork ParticularFlix: no maximo uma sincronizacao a cada 120 ms (a ultima sempre roda).
  const wait = SLIDER_HEADER_SYNC_MIN_INTERVAL_MS - (Date.now() - sliderHeaderLastSyncAt);
  const run = () => {
    sliderHeaderRafId = requestAnimationFrame(() => {
      sliderHeaderRafId = 0;
      sliderHeaderLastSyncAt = Date.now();
      try { syncSliderHeaderOffset(); } catch {}
    });
  };
  if (wait <= 0) { run(); return; }
  sliderHeaderSyncTimer = setTimeout(() => { sliderHeaderSyncTimer = 0; run(); }, wait);
}

// Fork ParticularFlix: enquanto a tela de Posicoes esta sendo editada, cada tique de valor muda o style
// de varios elementos e dispararia medicoes do cabecalho (layout forcado). A medicao fica em pausa
// durante a edicao e roda uma vez quando o usuario para.
let positionEditing = false;
let positionEditingTimer = 0;
export function markPositionEditing() {
  positionEditing = true;
  if (positionEditingTimer) clearTimeout(positionEditingTimer);
  positionEditingTimer = setTimeout(() => {
    positionEditing = false;
    positionEditingTimer = 0;
    try { scheduleSliderHeaderOffsetBurst(); } catch {}
  }, 700);
}

let sliderHeaderBurstTimers = [];
function scheduleSliderHeaderOffsetBurst() {
  if (positionEditing) return;
  // Fork ParticularFlix: rajadas empilhadas (cada mutacao do cabecalho abria 5 timers novos)
  // viravam dezenas de medicoes. Agora uma rajada nova substitui a pendente.
  for (const t of sliderHeaderBurstTimers) clearTimeout(t);
  const delays = [0, 60, 180, 420, 900];
  sliderHeaderBurstTimers = delays.map((delay) => setTimeout(() => {
    try { scheduleSliderHeaderOffsetSync(); } catch {}
  }, delay));
}

function nodeMatchesSliderHeaderRelevantTarget(node) {
  return !!node?.matches?.(SLIDER_HEADER_RELEVANT_SELECTOR);
}

function nodeContainsSliderHeaderRelevantTarget(node) {
  return !!node?.querySelector?.(SLIDER_HEADER_RELEVANT_SELECTOR);
}

function shouldScheduleSliderHeaderSync(mutations = []) {
  for (const mutation of mutations) {
    const target = mutation.target;
    if (mutation.type === 'attributes') {
      // Class changes on the slider itself (hover of the side bars, dots, Peak and Cinema states) do not move it
      // under the header; they used to start a burst of five header measurements each time.
      if (target?.id === 'monwui-slides-container') continue;
      if (nodeMatchesSliderHeaderRelevantTarget(target)) return true;
      continue;
    }

    // Changes inside the slider (slides, trailers, dots) never add or remove the header or a page.
    if (target?.nodeType === 1 && target.closest?.('#monwui-slides-container')) continue;

    for (const node of mutation.addedNodes || []) {
      if (nodeMatchesSliderHeaderRelevantTarget(node) || nodeContainsSliderHeaderRelevantTarget(node)) {
        return true;
      }
    }

    for (const node of mutation.removedNodes || []) {
      if (nodeMatchesSliderHeaderRelevantTarget(node) || nodeContainsSliderHeaderRelevantTarget(node)) {
        return true;
      }
    }
  }

  return false;
}

function bindSliderHeaderLifecycle() {
  if (sliderHeaderLifecycleBound) return;
  sliderHeaderLifecycleBound = true;

  window.addEventListener('resize', scheduleSliderHeaderOffsetBurst, { passive: true });
  // Fork ParticularFlix: o deslocamento do cabecalho so e medido com a pagina no topo; quando a
  // rolagem chega ao topo (ex. depois de restaurar a posicao com o botao voltar) nada disparava a
  // medicao e o slider ficava ~40 px acima do lugar ate a proxima rajada.
  let lastNearTop = null;
  let scrollRaf = 0;
  window.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const near = isSliderContextNearTop();
      if (near && lastNearTop !== true) scheduleSliderHeaderOffsetBurst();
      lastNearTop = near;
    });
  }, { passive: true });
  window.addEventListener('pageshow', scheduleSliderHeaderOffsetBurst);
  window.addEventListener('load', scheduleSliderHeaderOffsetBurst);
  window.addEventListener('hashchange', scheduleSliderHeaderOffsetBurst);
  window.addEventListener('popstate', scheduleSliderHeaderOffsetBurst);
  window.addEventListener('focus', scheduleSliderHeaderOffsetBurst);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') {
      scheduleSliderHeaderOffsetBurst();
      reconnectSliderHeaderMutationObserver();
      return;
    }
    try { sliderHeaderMutationObserver?.disconnect(); } catch {}
  });

  if (!sliderHeaderMutationObserver) {
    sliderHeaderMutationObserver = new MutationObserver((mutations) => {
      if (!shouldScheduleSliderHeaderSync(mutations)) return;
      scheduleSliderHeaderOffsetBurst();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSliderHeaderOffsetBurst, { once: true });
  } else {
    scheduleSliderHeaderOffsetBurst();
  }

  reconnectSliderHeaderMutationObserver();
}

function ensureSliderHeaderObserver(header) {
  if (!header?.isConnected || typeof ResizeObserver !== 'function') return;
  bindSliderHeaderLifecycle();

  if (!sliderHeaderResizeObserver) {
    sliderHeaderResizeObserver = new ResizeObserver(() => {
      scheduleSliderHeaderOffsetSync();
    });
  }

  if (sliderHeaderObservedEl === header) return;

  try { sliderHeaderResizeObserver.disconnect(); } catch {}
  sliderHeaderObservedEl = header;
  try { sliderHeaderResizeObserver.observe(header); } catch {}
}

// Fork ParticularFlix: animacoes de entrada de pagina (ex. scale .98 -> 1) e
// transforms em ancestrais deslocam getBoundingClientRect(). Medir o overlap
// nesse momento gravava um offset errado (slider mais alto que o limite, topo
// cortado) que so era corrigido por uma medicao posterior. Agora a medicao e
// adiada ate os ancestrais ficarem sem transform nem animacao em andamento.
let sliderHeaderTransformRetries = 0;
function hasUnsettledTransformAncestor(container) {
  let node = container;
  let guard = 0;
  while (node && node.nodeType === 1 && node !== document.documentElement && guard++ < 40) {
    try {
      if (node !== container && node.getAnimations) {
        const running = node.getAnimations().some((a) => {
          if (a.playState !== 'running') return false;
          const iterations = a.effect?.getComputedTiming?.().iterations;
          return iterations !== Infinity;
        });
        if (running) return true;
      }
      const t = window.getComputedStyle(node).transform;
      if (t && t !== 'none') {
        const m2 = t.match(/^matrix\(([^)]+)\)$/);
        const m3 = t.match(/^matrix3d\(([^)]+)\)$/);
        let a, b, c, d, e, f;
        if (m2) {
          [a, b, c, d, e, f] = m2[1].split(',').map((x) => Number.parseFloat(x));
        } else if (m3) {
          const v = m3[1].split(',').map((x) => Number.parseFloat(x));
          a = v[0]; b = v[1]; c = v[4]; d = v[5]; e = v[12]; f = v[13];
        } else {
          return true;
        }
        const identity =
          Math.abs(a - 1) < 0.001 && Math.abs(d - 1) < 0.001 &&
          Math.abs(b) < 0.001 && Math.abs(c) < 0.001 &&
          Math.abs(e) < 0.5 && Math.abs(f) < 0.5;
        if (!identity) return true;
      }
    } catch {}
    node = node.parentElement;
  }
  return false;
}

function computeSliderHeaderOffsetPx(header, container) {
  const currentOffset = readSliderHeaderOffsetPx(container);
  if (!isSliderContextNearTop()) return currentOffset;

  const headerRect = header?.getBoundingClientRect?.();
  const slideRect = container?.getBoundingClientRect?.();
  const headerBottom = Number(headerRect?.bottom || 0);
  const slideTop = Number(slideRect?.top || 0) - readSliderVisualTopDeltaPx(container);

  if (!Number.isFinite(headerBottom) || !Number.isFinite(slideTop)) return 0;

  const overlapPx = headerBottom - slideTop;
  const nextOffset = Math.max(0, currentOffset + overlapPx);
  return Math.abs(nextOffset) < 1 ? 0 : nextOffset;
}

function resolveTopStyleValue(prefix, rawTopValue, config = getConfig()) {
  const numericTopValue = Number(rawTopValue);
  if (!Number.isFinite(numericTopValue) || numericTopValue === 0) return '';

  if (prefix === 'slide') {
    return `${numericTopValue}vh`;
  }

  return `${numericTopValue}%`;
}

export function syncSliderHeaderOffset(container = findActiveSlidesContainer()) {
  const config = getConfig();
  const variant = getActiveSliderVariant(config);
  const explicitSlideTop = hasExplicitSlideTop(config);

  if (!container || !usesDynamicHeaderOffset(variant) || explicitSlideTop) {
    clearSliderHeaderOffsetVar(container);
    if (!usesDynamicHeaderOffset(variant) || explicitSlideTop) {
      clearSliderHeaderObserver();
      pauseSliderHeaderMutationObserver();
    }
    return;
  }

  bindSliderHeaderLifecycle();
  reconnectSliderHeaderMutationObserver();

  const header = findVisibleSkinHeader();
  if (!header) {
    setSliderHeaderOffsetVar(container, 0);
    clearSliderHeaderObserver();
    reconnectSliderHeaderMutationObserver();
    return;
  }

  ensureSliderHeaderObserver(header);
  if (hasUnsettledTransformAncestor(container) && sliderHeaderTransformRetries < 40) {
    sliderHeaderTransformRetries += 1;
    setTimeout(() => {
      try { scheduleSliderHeaderOffsetSync(); } catch {}
    }, 80);
    return;
  }
  sliderHeaderTransformRetries = 0;
  setSliderHeaderOffsetVar(container, computeSliderHeaderOffsetPx(header, container));
}

function setImportantStyle(element, property, value) {
  if (!element) return;

  if (value !== undefined && value !== null && value !== '') {
    const nextValue = String(value);
    if (
      element.style.getPropertyValue(property) === nextValue &&
      element.style.getPropertyPriority(property) === 'important'
    ) {
      return;
    }
    element.style.setProperty(property, nextValue, 'important');
  } else {
    if (!element.style.getPropertyValue(property)) return;
    element.style.removeProperty(property);
  }
}

/*
 * Fork ParticularFlix: nos layouts Cinema e Mosaico alguns blocos (caixa de provedores, wrapper do slider,
 * pontos) sao position:absolute ancorados por right/bottom. Ao definir Esquerda (left) sem soltar o right,
 * o bloco passa a ficar esticado entre os dois (a caixa de fundo vira um "rastro" que acompanha o movimento).
 * Definir Topo (top) sem soltar o bottom faz o mesmo na vertical. Esta funcao solta o lado oposto.
 */
export function isFlowLayoutActive() {
  const layout = document.documentElement?.dataset?.sliderLayout || '';
  return layout === 'cinema' || layout === 'mosaic';
}

export function writeAnchorRelease(element, cssProperty, hasValue) {
  if (!element || !isFlowLayoutActive()) return;
  const target = cssProperty === 'left' ? 'right' : cssProperty === 'top' ? 'bottom' : '';
  if (!target) return;
  const current = element.style.getPropertyValue(target);
  if (hasValue) {
    // so escreve quando muda (escrita repetida dispara observadores de estilo sem necessidade)
    if (current !== 'auto' || element.style.getPropertyPriority(target) !== 'important') {
      element.style.setProperty(target, 'auto', 'important');
    }
  } else if (current === 'auto') {
    element.style.removeProperty(target);
  }
}

const HELPER_STYLE_ID = 'jms-position-helpers';
const HELPER_STYLE_CSS = [
  // a caixa interna de icones passa a aceitar Topo/Esquerda (antes era estatica e ignorava os valores)
  '.monwui-providericons-container{position:relative}',
  // fundo da caixa de provedores (engrenagem, IMDb, TMDb...) pode ser removido sem tirar os icones
  'html[data-jms-provider-bg="none"] .monwui-provider-container{background:none!important;box-shadow:none!important;',
  '-webkit-backdrop-filter:none!important;backdrop-filter:none!important;border:0!important;padding:0!important}',
  // item em edicao na tela de Posicoes: contorno amarelo para saber onde ele esta
  '.jms-pos-target{outline:2px dashed #ffd24a!important;outline-offset:3px!important;box-shadow:0 0 0 6px rgba(255,210,74,.2)!important}',
].join('');

export function ensurePositionHelperStyles() {
  if (document.getElementById(HELPER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HELPER_STYLE_ID;
  style.textContent = HELPER_STYLE_CSS;
  (document.head || document.documentElement).appendChild(style);
}

export function applyProviderBackgroundMode(mode) {
  ensurePositionHelperStyles();
  const root = document.documentElement;
  if (!root) return;
  if (mode === 'none') {
    if (root.dataset.jmsProviderBg !== 'none') root.dataset.jmsProviderBg = 'none';
  } else if (root.dataset.jmsProviderBg) {
    delete root.dataset.jmsProviderBg;
  }
}

export function applyContainerStyles(container, type = '') {
  const config = getConfig();
  let prefix;

  if (type === 'progress') {
    prefix = 'progressBar';
  } else if (type === 'progressSeconds') {
    prefix = 'progressSeconds';
  } else if (type) {
    prefix = `${type}Container`;
  } else {
    prefix = 'slide';
  }

  // Nos layouts cinema e mosaic os blocos ficam em pilha (position:relative), entao Top/Left
  // funcionam como deslocamento a partir da posicao padrao do layout. Cada layout tem seu proprio
  // perfil de posicoes (ver positionProfiles.js), entao os valores do Peak/Normal nao vazam para ca.

  setImportantStyle(container, 'top',    resolveTopStyleValue(prefix, config[`${prefix}Top`], config));
  setImportantStyle(container, 'left',   config[`${prefix}Left`]   ? `${config[`${prefix}Left`]}%`   : '');
  if (prefix !== 'slide' && isFlowLayoutActive()) {
    writeAnchorRelease(container, 'top', !!Number(config[`${prefix}Top`]));
    writeAnchorRelease(container, 'left', !!Number(config[`${prefix}Left`]));
  }
  setImportantStyle(container, 'width',  config[`${prefix}Width`]  ? `${config[`${prefix}Width`]}%`  : '');
  setImportantStyle(container, 'height', config[`${prefix}Height`] ? `${config[`${prefix}Height`]}%` : '');

  if (type && type !== 'slide' && type !== 'progressSeconds' && type !== 'progress') {
    setImportantStyle(container, 'display',         config[`${prefix}Display`]        || '');
    setImportantStyle(container, 'flex-direction',  config[`${prefix}FlexDirection`]  || '');
    setImportantStyle(container, 'justify-content', config[`${prefix}JustifyContent`] || '');
    setImportantStyle(container, 'align-items',     config[`${prefix}AlignItems`]     || '');
    setImportantStyle(container, 'flex-wrap',       config[`${prefix}FlexWrap`]       || '');
  }
}

export function updateSlidePosition() {
  const config = getConfig();
  try { applyProviderBackgroundMode(config.providerBoxBackground); } catch {}

  const slidesContainer = document.querySelector("#monwui-slides-container");
  if (slidesContainer) {
    applyContainerStyles(slidesContainer);
    syncSliderHeaderOffset(slidesContainer);
  } else {
    clearSliderHeaderObserver();
  }

  const containerTypes = [
    'logo', 'meta', 'format', 'status', 'rating', 'plot',
    'title', 'director', 'info', 'button',
    'existingDot', 'provider', 'providericons'
  ];

  containerTypes.forEach(type => {
    document.querySelectorAll(`.monwui-${type}-container`).forEach(container => {
      applyContainerStyles(container, type);
    });
  });

  document.querySelectorAll(".monwui-slider-wrapper").forEach(sliderWrapper => {
    if (!sliderWrapper.classList.contains("monwui-artist-menu")) {
      applyContainerStyles(sliderWrapper, 'slider');
    }
  });

  const progressBar = document.querySelector(".monwui-slide-progress-bar");
  if (progressBar) applyContainerStyles(progressBar, 'progress');

  const progressSeconds = document.querySelector(".monwui-slide-progress-seconds");
  if (progressSeconds) applyContainerStyles(progressSeconds, 'progressSeconds');

  const homeSectionsContainers = document.querySelectorAll(".homeSectionsContainer");
  if (homeSectionsContainers.length) {
    const explicitHomeTop = Number(config.homeSectionsTop);
    if (Number.isFinite(explicitHomeTop) && explicitHomeTop !== 0) {
      homeSectionsContainers.forEach(container => {
        setImportantStyle(container, 'top', `${explicitHomeTop}vh`);
      });
    } else {
      homeSectionsContainers.forEach(container => {
        setImportantStyle(container, 'top', '');
      });
      try { forceHomeSectionsTop(); } catch {}
    }
  }
}
