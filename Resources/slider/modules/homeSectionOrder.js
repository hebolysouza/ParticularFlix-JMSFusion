/*
 * Fork ParticularFlix: ordem das secoes da home, dentro do plugin.
 *
 * Substitui o script externo particularflix-section-order.js e as regras de CSS
 * `order` do Jellyfin custom CSS. Diferencas importantes em relacao ao script:
 *
 * 1. Observa o documento inteiro e re-vincula ao container ATUAL
 *    (.homeSectionsContainer). O script antigo observava so o container que
 *    existia na primeira carga; quando o Jellyfin recriava o container na
 *    volta para a home, o observador ficava morto e a secao "Proximo" ia para
 *    o fim da pagina (order:999 herdado).
 * 2. Reaplica quando alguem reescreve o `style` ou a `class` de uma secao
 *    (Home Screen Sections escreve order inline), nao so em childList.
 * 3. Reaplica em toda navegacao (hashchange, viewshow, pageshow, popstate) com
 *    pequenas rajadas, para cobrir secoes que chegam depois.
 * 4. So escreve quando o valor muda, entao nao gera laco de mutacoes.
 *
 * Configuracao opcional (getConfig()):
 *   enforceHomeSectionOrder: false  -> desliga o modulo
 *   homeSectionOrderSelectors: [[selector, ordem], ...]
 *   homeSectionOrderTitles: [[ordem, ["trecho do titulo", ...]], ...]
 */
import { getConfig } from "./config.js";
import {
  restoreHomeSnapshot,
  reconcileHomeSnapshot,
  installHomeSnapshotLeaveCapture,
} from "./homeSectionSnapshot.js";

const CONTAINER_SELECTOR = ".sections.homeSectionsContainer, .homeSectionsContainer";

const DEFAULT_SELECTORS = [
  ['[data-managed-section-key="nextUpRows"]', 2],
  ["#nextup-rows", 2],
  [".NextUp, .nextUpSection, [data-section-type='nextup']", 2],
  ["#studio-hubs", 4],
  ['[data-managed-section-key="recentRows"]', 7],
  ['[id^="recent-rows"]', 7],
  ['[data-managed-section-key="tmdbTrailerRows"]', 8],
  ["#personal-recommendations", 12],
  ['[data-managed-section-key="top10MovieRows"]', 13],
  ['[data-managed-section-key="top10SeriesRows"]', 14],
  ['[data-managed-section-key="tmdbTopMoviesRows"]', 15],
  ['[id^="genre-hubs-"]', 16],
];

// A ordem da lista importa: termos especificos antes do generico "descobrir".
const DEFAULT_TITLES = [
  [1, ["continuar assistindo", "continue watching"]],
  [2, ["próximo", "proximo", "next up", "up next", "a seguir", "siguiente", "a continuación", "a continuacion"]],
  [3, ["minha mídia", "minha midia", "my media"]],
  [5, ["filmes a estrear", "upcoming movies"]],
  [6, ["séries a estrear", "series a estrear", "upcoming shows"]],
  [9, ["descobrir filmes", "discover movies"]],
  [10, ["descobrir séries", "descobrir series", "discover tv"]],
  [17, ["porque viu", "because you watched"]],
  [11, ["descobrir", "discover"]],
];

let installed = false;
let observer = null;
let observedContainer = null;
let lastKnownContainer = null; // ultimo container valido (para a foto das esteiras ao sair da home)
let rafId = 0;
let burstTimers = [];

function readOptions() {
  let cfg = {};
  try { cfg = getConfig?.() || {}; } catch {}
  const selectors = Array.isArray(cfg.homeSectionOrderSelectors) && cfg.homeSectionOrderSelectors.length
    ? cfg.homeSectionOrderSelectors
    : DEFAULT_SELECTORS;
  const titles = Array.isArray(cfg.homeSectionOrderTitles) && cfg.homeSectionOrderTitles.length
    ? cfg.homeSectionOrderTitles
    : DEFAULT_TITLES;
  return { enabled: cfg.enforceHomeSectionOrder !== false, selectors, titles };
}

function getContainer() {
  const page = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
  const scope = page || document;
  const el = scope.querySelector(CONTAINER_SELECTOR);
  return el && el.isConnected ? el : null;
}

function closestFlexChild(el, container) {
  let node = el;
  while (node && node.parentElement !== container) node = node.parentElement;
  return node || null;
}

function setOrder(el, order) {
  const want = String(order);
  const style = el.style;
  if (style.getPropertyValue("order") === want && style.getPropertyPriority("order") === "important") {
    return;
  }
  style.setProperty("order", want, "important");
}

export function applyHomeSectionOrder() {
  const opts = readOptions();
  if (!opts.enabled) return;
  const container = getContainer();
  if (!container) return;

  const handled = new Set();

  for (const [selector, order] of opts.selectors) {
    let matches = [];
    try { matches = container.querySelectorAll(selector); } catch { continue; }
    for (const match of matches) {
      const target = closestFlexChild(match, container);
      if (!target || handled.has(target)) continue;
      setOrder(target, order);
      handled.add(target);
    }
  }

  for (const child of container.children) {
    if (handled.has(child)) continue;
    const titleEl = child.querySelector(".sectionTitle, h2");
    if (!titleEl) continue;
    const text = (titleEl.textContent || "").trim().toLowerCase();
    if (!text) continue;
    for (const [order, needles] of opts.titles) {
      if (needles.some((needle) => text.includes(needle))) {
        setOrder(child, order);
        break;
      }
    }
  }
}

function scheduleApply() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    try { applyHomeSectionOrder(); } catch (e) { console.warn("[JMS] homeSectionOrder:", e); }
    try { reconcileHomeSnapshot(observedContainer); } catch {}
  });
}

function scheduleBurst() {
  for (const t of burstTimers) clearTimeout(t);
  burstTimers = [0, 120, 400, 900, 1800, 3500].map((delay) =>
    window.setTimeout(scheduleApply, delay)
  );
}

function bindToCurrentContainer() {
  const container = getContainer();
  if (container === observedContainer) return;
  try { observer?.disconnect(); } catch {}
  observedContainer = container;
  if (!container) return;
  lastKnownContainer = container;
  try { restoreHomeSnapshot(container); } catch (e) { console.warn("[JMS] homeSectionSnapshot:", e); }
  observer = new MutationObserver(scheduleApply);
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "data-managed-section-key"],
  });
  scheduleBurst();
}

export function installHomeSectionOrder() {
  if (installed) return;
  installed = true;

  // Registrado antes dos ouvintes de navegacao abaixo, para a foto sair antes de o container sumir.
  try { installHomeSnapshotLeaveCapture(() => lastKnownContainer); } catch {}

  // Detecta troca/recriacao do container e navegacao de rota.
  let rootRaf = 0;
  const rootObserver = new MutationObserver(() => {
    if (rootRaf) return;
    rootRaf = requestAnimationFrame(() => {
      rootRaf = 0;
      bindToCurrentContainer();
    });
  });
  rootObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  const onNav = () => {
    bindToCurrentContainer();
    scheduleBurst();
  };
  window.addEventListener("hashchange", onNav);
  window.addEventListener("popstate", onNav);
  window.addEventListener("pageshow", onNav);
  document.addEventListener("viewshow", onNav);
  document.addEventListener("viewshown", onNav);

  bindToCurrentContainer();
  scheduleBurst();
}
