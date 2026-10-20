import { getConfig } from './config.js';

let homeTopObserver = null;
let homeTopRafId = 0;
let skinHeaderObserver = null;
let applyHomeTop = null;
let applySkinHeader = null;
let homeTopLifecycleBound = false;
let skinHeaderLifecycleBound = false;
const SLIDER_HEADER_OFFSET_VAR = '--jms-slider-header-offset-px';
const SLIDER_VISUAL_TOP_VAR = '--jms-slider-visual-top';

const OBSERVER_OPTIONS = {
  subtree: true,
  childList: true,
  attributes: false
};

function scheduleBurst(fn) {
  if (typeof fn !== 'function') return;
  const delays = [0, 60, 180, 420];
  for (const delay of delays) {
    setTimeout(() => {
      try { fn(); } catch {}
    }, delay);
  }
}

function reconnectObserver(observer) {
  const root = document.body || document.documentElement;
  if (!observer || !root || document.visibilityState === 'hidden') return;
  try { observer.disconnect(); } catch {}
  try { observer.observe(root, OBSERVER_OPTIONS); } catch {}
}

function bindHomeTopLifecycle() {
  if (homeTopLifecycleBound) return;
  homeTopLifecycleBound = true;

  const reapply = () => {
    scheduleBurst(() => {
      try { applyHomeTop?.(); } catch {}
      reconnectObserver(homeTopObserver);
    });
  };

  let resizeRafId = 0;
  const handleResize = () => {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      reapply();
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { homeTopObserver?.disconnect(); } catch {}
      return;
    }
    reapply();
  });

  window.addEventListener('pageshow', reapply);
  window.addEventListener('pagehide', () => {
    try { homeTopObserver?.disconnect(); } catch {}
  });
  window.addEventListener('hashchange', reapply);
  window.addEventListener('popstate', reapply);
  window.addEventListener('focus', reapply);
  window.addEventListener('resize', handleResize, { passive: true });
}

function bindSkinHeaderLifecycle() {
  if (skinHeaderLifecycleBound) return;
  skinHeaderLifecycleBound = true;

  const reapply = () => {
    scheduleBurst(() => {
      try { applySkinHeader?.(); } catch {}
      reconnectObserver(skinHeaderObserver);
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { skinHeaderObserver?.disconnect(); } catch {}
      return;
    }
    reapply();
  });

  window.addEventListener('pageshow', reapply);
  window.addEventListener('pagehide', () => {
    try { skinHeaderObserver?.disconnect(); } catch {}
  });
  window.addEventListener('hashchange', reapply);
  window.addEventListener('popstate', reapply);
  window.addEventListener('focus', reapply);
}

function isMobileDevice() {
  const widthNarrow = window.matchMedia?.('(max-width: 768px)')?.matches;
  const coarse     = window.matchMedia?.('(pointer: coarse)')?.matches;
  const hoverNone  = window.matchMedia?.('(hover: none)')?.matches;
  const touchPts   = navigator.maxTouchPoints || 0;
  const uaMobile   = navigator.userAgentData?.mobile ?? /Mobi|Android/i.test(navigator.userAgent);

  return widthNarrow && (coarse || hoverNone || touchPts > 0 || uaMobile);
}

function normalizeVariant(x) {
  const s = String(x ?? '').toLowerCase().trim();
  if (!s) return 'normalslider';

  if (s.includes('normalslider') || s.includes('normal')) return 'normalslider';
  if (s.includes('full')) return 'normalslider';
  if (s.includes('peakslider') || s.includes('peak'))   return 'peakslider';
  if (s.includes('slider')) return 'slider';
  return 'normalslider';
}

function detectCssVariantFromDom() {
  if (window.__cssVariant) return normalizeVariant(window.__cssVariant);

  const dv = document.documentElement?.dataset?.cssVariant;
  if (dv) return normalizeVariant(dv);

  const has = (s) => !!document.querySelector(`link[href*="${s}"]`);
  if (has('peakslider.css'))   return 'peakslider';
  if (has('normalslider.css')) return 'normalslider';
  if (has('slider.css')) return 'slider';
  return 'normalslider';
}

function resolveConfiguredVariant(cfg = {}) {
  const rawVariant = String(cfg?.cssVariant ?? '').trim();
  if (rawVariant) {
    return normalizeVariant(rawVariant);
  }
  return detectCssVariantFromDom();
}

function usesDynamicHeaderAdjustedTop(variant) {
  return variant === 'normalslider' || variant === 'peakslider' || variant === 'slider';
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
  return null;
}

function isLiveTvRouteActive() {
  try {
    const raw = [
      window.location?.hash || '',
      window.location?.pathname || '',
      window.location?.search || ''
    ].join(' ').toLowerCase();
    return /(?:^|[#/?&.\s-])(?:live[-_]?tv|tvguide)(?:[/?#&=.\s-]|$)/i.test(raw);
  } catch {
    return false;
  }
}

function getHomeTopTargets(affectFavoritesTab = true) {
  const targets = [...document.querySelectorAll('#indexPage .homeSectionsContainer, #homePage .homeSectionsContainer')]
    .filter(el => affectFavoritesTab || el?.id !== 'favoritesTab');
  if (affectFavoritesTab) {
    const fav = document.querySelector('#favoritesTab');
    if (fav && !targets.includes(fav)) targets.push(fav);
  }
  return targets;
}

function findRepresentativeHomeTopTarget(affectFavoritesTab = true) {
  const visibleTargets = getHomeTopTargets(affectFavoritesTab)
    .filter(isElementVisible)
    .sort((a, b) => {
      const topA = Number(a.getBoundingClientRect?.().top || 0);
      const topB = Number(b.getBoundingClientRect?.().top || 0);
      return topA - topB;
    });

  if (visibleTargets.length) return visibleTargets[0];
  return getHomeTopTargets(affectFavoritesTab)[0] || null;
}

function findActiveSlidesContainer() {
  return document.querySelector(
    '#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container, #monwui-slides-container'
  );
}

function readSliderVisualTopValue() {
  const container = findActiveSlidesContainer();
  if (!container) return '0px';

  const inlineValue = container.style?.getPropertyValue?.(SLIDER_VISUAL_TOP_VAR)?.trim();
  if (inlineValue) return inlineValue;

  try {
    return window.getComputedStyle?.(container)?.getPropertyValue?.(SLIDER_VISUAL_TOP_VAR)?.trim() || '0px';
  } catch {
    return '0px';
  }
}

function computeEffectiveTopState() {
  if (isLiveTvRouteActive()) {
    return null;
  }

  const cfg = (typeof getConfig === 'function') ? getConfig() : {};
  const userTop = readUserTopFromLocalStorage();
  if (userTop !== null) {
    return {
      topValue: `${userTop}vh`,
      usesHeaderOffset: false,
      visualTopValue: '',
    };
  }
  if (cfg?.enableSlider === false || cfg?.enableSlider === 'false') {
    return null;
  }

  const variant = resolveConfiguredVariant(cfg);
  const baseTop = getDefaultTopByVariant(variant);
  const usesHeaderOffset = usesDynamicHeaderAdjustedTop(variant);

  return {
    topValue: usesHeaderOffset
      ? `calc(${baseTop}vh + var(${SLIDER_HEADER_OFFSET_VAR}, 0px) + var(${SLIDER_VISUAL_TOP_VAR}, 0px))`
      : `${baseTop}vh`,
    usesHeaderOffset,
    visualTopValue: usesHeaderOffset ? readSliderVisualTopValue() : '',
  };
}

function getDefaultTopByVariant(variant) {
  let baseTop;
  const mobile = window.matchMedia?.('(max-width: 768px)')?.matches || isMobileDevice();
  if (mobile) {
    switch (variant) {
      case 'normalslider': baseTop = -1; break;
      case 'peakslider': baseTop = 0; break;
      case 'slider': baseTop = 0; break;
      default: baseTop = 0; break;
    }
  } else {
    switch (variant) {
      case 'normalslider': baseTop = -10; break;
      case 'peakslider': baseTop = 0; break;
      case 'slider': baseTop = 1; break;
      default: baseTop = 0; break;
    }
  }

  return baseTop;
}

function readUserTopFromLocalStorage() {
  const raw = localStorage.getItem('homeSectionsTop');
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

function coerceBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return fallback;
}

function shouldAffectFavoritesTab(cfg) {
  const raw = localStorage.getItem('onlyShowSliderOnHomeTab');
  if (raw === 'true' || raw === 'false') return raw === 'false';
  return !coerceBoolean(cfg?.onlyShowSliderOnHomeTab, true);
}

function applyTopToElements(value, affectFavoritesTab = true, visualTopValue = '') {
  const targets = getHomeTopTargets(affectFavoritesTab);
  for (const el of targets) {
    if (!el) continue;
    // So escreve no estilo quando o valor realmente muda (escrita repetida invalida o estilo).
    const currentVisualTop = el.style.getPropertyValue(SLIDER_VISUAL_TOP_VAR);
    if (visualTopValue) {
      if (currentVisualTop !== visualTopValue) {
        el.style.setProperty(SLIDER_VISUAL_TOP_VAR, visualTopValue);
      }
    } else if (currentVisualTop) {
      el.style.removeProperty(SLIDER_VISUAL_TOP_VAR);
    }
    if (el.style.top !== value) {
      el.style.setProperty('top', value, 'important');
    }
  }
}

function clearTopOverrides(affectFavoritesTab = true) {
  const targets = getHomeTopTargets(affectFavoritesTab);
  for (const el of targets) {
    if (!el) continue;
    el.style.removeProperty('top');
    el.style.removeProperty(SLIDER_VISUAL_TOP_VAR);
  }
}

function clearFavoritesTabTopOverride() {
  const el = document.querySelector('#favoritesTab');
  if (!el) return;
  el.style.removeProperty('top');
  el.style.removeProperty(SLIDER_VISUAL_TOP_VAR);
}

function waitForFavoritesTabAndApply(topValue, visualTopValue = '') {
  let tries = 0;
  function attempt() {
    const cfg = (typeof getConfig === 'function') ? getConfig() : {};
    if (!shouldAffectFavoritesTab(cfg)) return;

    const el = document.querySelector('#favoritesTab');
    if (el) {
      if (visualTopValue) {
        el.style.setProperty(SLIDER_VISUAL_TOP_VAR, visualTopValue);
      } else {
        el.style.removeProperty(SLIDER_VISUAL_TOP_VAR);
      }
      el.style.setProperty('top', topValue, 'important');
      return;
    }
    if (++tries < 30) setTimeout(attempt, 100);
  }
  attempt();
}

export function forceHomeSectionsTop() {
  const applyAlways = () => {
    const topState = computeEffectiveTopState();
    const cfg = (typeof getConfig === 'function') ? getConfig() : {};
    const affectFavoritesTab = shouldAffectFavoritesTab(cfg);

    if (topState === null) {
      clearTopOverrides(affectFavoritesTab);
      if (!affectFavoritesTab) clearFavoritesTabTopOverride();
      return;
    }

    applyTopToElements(topState.topValue, affectFavoritesTab, topState.visualTopValue);
    if (affectFavoritesTab) {
      waitForFavoritesTabAndApply(topState.topValue, topState.visualTopValue);
    } else {
      clearFavoritesTabTopOverride();
    }
  };

  applyHomeTop = applyAlways;
  bindHomeTopLifecycle();

  if (!homeTopObserver) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scheduleBurst(applyAlways), { once: true });
    } else {
      scheduleBurst(applyAlways);
    }

    // A home recebe centenas de mutacoes enquanto as fileiras carregam. Antes cada lote de
    // mutacoes executava applyHomeTop na hora (consultas ao DOM e escritas de estilo);
    // agora os lotes de um mesmo quadro viram uma unica execucao, ainda antes da pintura.
    // Fork ParticularFlix: alem de agrupar por quadro, limita a uma execucao a cada 250 ms
    // (o ultimo lote sempre roda, entao o estado final fica correto).
    let homeTopTimer = 0;
    let homeTopLastAt = 0;
    const runHomeTop = () => {
      homeTopRafId = requestAnimationFrame(() => {
        homeTopRafId = 0;
        homeTopLastAt = Date.now();
        try { applyHomeTop?.(); } catch {}
      });
    };
    homeTopObserver = new MutationObserver(() => {
      if (homeTopRafId || homeTopTimer) return;
      const wait = 250 - (Date.now() - homeTopLastAt);
      if (wait <= 0) { runHomeTop(); return; }
      homeTopTimer = setTimeout(() => { homeTopTimer = 0; runHomeTop(); }, wait);
    });
    reconnectObserver(homeTopObserver);
  } else {
    scheduleBurst(applyAlways);
    reconnectObserver(homeTopObserver);
  }
}

export function forceSkinHeaderPointerEvents() {
  const apply = () => {
    document.querySelectorAll('html .skinHeader').forEach(el => {
      el.style.setProperty('pointer-events', 'all', 'important');
    });

    const playerToggle = document.querySelector('button#jellyfinPlayerToggle');
    if (playerToggle) {
      playerToggle.style.setProperty('display', 'block', 'important');
      playerToggle.style.setProperty('opacity', '1', 'important');
      playerToggle.style.setProperty('pointer-events', 'all', 'important');
      playerToggle.style.setProperty('background', 'none', 'important');
      playerToggle.style.setProperty('text-shadow', 'rgb(255, 255, 255) 0px 0px 2px', 'important');
      playerToggle.style.setProperty('cursor', 'pointer', 'important');
      playerToggle.style.setProperty('border', 'none', 'important');
    }
  };

  applySkinHeader = apply;
  bindSkinHeaderLifecycle();

  if (!skinHeaderObserver) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scheduleBurst(apply), { once: true });
    } else {
      scheduleBurst(apply);
    }

    skinHeaderObserver = new MutationObserver(() => {
      try { applySkinHeader?.(); } catch {}
    });
    reconnectObserver(skinHeaderObserver);
  } else {
    scheduleBurst(apply);
    reconnectObserver(skinHeaderObserver);
  }
}
