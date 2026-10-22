/*
 * Fork ParticularFlix: "foto" das esteiras da home para a volta pelo botao voltar.
 *
 * O Jellyfin recria o container da home a cada retorno e as esteiras do plugin precisam ser
 * montadas de novo (cerca de 2 s). Para a pagina nao voltar vazia (e para o scroll restaurado
 * cair no lugar certo), ao sair da home guardamos uma copia inerte das esteiras ja renderizadas
 * e a colocamos de volta na hora; cada copia some assim que a esteira real correspondente
 * tem cards, ou apos um tempo limite.
 *
 * As copias NAO tem id nem data-managed-section-key (os modulos localizam as secoes por id),
 * nao tem video/iframe, sao inertes (sem clique) e ficam fora da acessibilidade.
 *
 * Config (getConfig()): homeSectionSnapshot:false desliga; homeSectionSnapshotMaxAgeMs (padrao 30 min);
 * homeSectionSnapshotTimeoutMs (padrao 12000).
 */
import { getConfig } from "./config.js";

const SNAP_CLASS = "jms-home-snapshot";
const STYLE_ID = "jms-home-snapshot-style";
const MANAGED_ID_RE = /^(studio-hubs|recent-rows|continue-rows|tmdb-|top10|personal-recommendations|genre-hubs|because-you-watched|director|upcoming|nextup)/i;
const CARD_SELECTOR = ".personal-recs-card, .hub-card, .dir-row-hero";

let snapshot = null; // { at, items: [{ key, node }] }
let restoreTimers = [];
let installed = false;

function cfg() {
  try { return getConfig?.() || {}; } catch { return {}; }
}
function enabled() {
  return cfg().homeSectionSnapshot !== false;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `.${SNAP_CLASS}{pointer-events:none!important;user-select:none!important}`;
  (document.head || document.documentElement).appendChild(st);
}

function isManagedSection(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.classList.contains(SNAP_CLASS)) return false;
  const id = el.id || "";
  if (id && MANAGED_ID_RE.test(id)) return true;
  return !!el.dataset?.managedSectionKey;
}

function hasRenderedCards(el) {
  return !!el.querySelector(CARD_SELECTOR);
}

export function captureHomeSnapshot(container) {
  if (!enabled() || !container?.children) return;
  const items = [];
  for (const child of container.children) {
    if (child.classList.contains(SNAP_CLASS)) continue;
    let keyEl = isManagedSection(child) ? child : null;
    if (!keyEl) {
      // a secao pode estar dentro de um envoltorio: procura o primeiro descendente gerenciado
      const inner = Array.from(child.querySelectorAll("[id]")).find((n) => MANAGED_ID_RE.test(n.id || ""));
      if (inner) keyEl = inner;
    }
    if (!keyEl) continue;
    if (!hasRenderedCards(child)) continue;
    if (child.style?.display === "none") continue;
    const key = keyEl.id || keyEl.dataset.managedSectionKey;
    if (!key) continue;
    let node;
    try { node = child.cloneNode(true); } catch { continue; }
    node.removeAttribute("id");
    node.removeAttribute("data-managed-section-key");
    node.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    node.querySelectorAll("[data-managed-section-key]").forEach((n) => n.removeAttribute("data-managed-section-key"));
    node.querySelectorAll("video, iframe, audio, script").forEach((n) => n.remove());
    node.querySelectorAll(".is-entering").forEach((n) => n.classList.remove("is-entering"));
    node.classList.add(SNAP_CLASS);
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("inert", "");
    node.dataset.jmsSnapKey = key;
    items.push({ key, node });
  }
  if (!items.length) return;
  // Saida precoce da home (so algumas esteiras prontas) nao pode piorar uma foto recente mais completa.
  if (snapshot && Date.now() - snapshot.at < 5 * 60 * 1000) {
    const have = new Set(items.map((i) => i.key));
    for (const old of snapshot.items) if (!have.has(old.key)) items.push(old);
  }
  snapshot = { at: Date.now(), items };
}

function findReal(container, key) {
  let el = null;
  try { el = container.querySelector(`[id="${String(key).replace(/"/g, "")}"]`); } catch {}
  if (el && !el.closest(`.${SNAP_CLASS}`)) return el;
  try {
    el = container.querySelector(`[data-managed-section-key="${String(key).replace(/"/g, "")}"]`);
  } catch {}
  return el && !el.closest(`.${SNAP_CLASS}`) ? el : null;
}

export function reconcileHomeSnapshot(container) {
  if (!container) return;
  const snaps = container.querySelectorAll(`:scope > .${SNAP_CLASS}`);
  for (const snap of snaps) {
    const real = findReal(container, snap.dataset.jmsSnapKey);
    if (real && hasRenderedCards(real)) {
      try { snap.remove(); } catch {}
    }
  }
}

export function clearHomeSnapshotNodes(container) {
  for (const t of restoreTimers) clearTimeout(t);
  restoreTimers = [];
  const root = container || document;
  root.querySelectorAll?.(`.${SNAP_CLASS}`).forEach((n) => { try { n.remove(); } catch {} });
}

export function restoreHomeSnapshot(container) {
  if (!enabled() || !snapshot || !container?.isConnected) return;
  const c = cfg();
  const maxAge = Number.isFinite(Number(c.homeSectionSnapshotMaxAgeMs)) ? Number(c.homeSectionSnapshotMaxAgeMs) : 30 * 60 * 1000;
  if (Date.now() - snapshot.at > maxAge) return;
  if (container.querySelector(`:scope > .${SNAP_CLASS}`)) return;
  ensureStyle();
  let inserted = 0;
  for (const { key, node } of snapshot.items) {
    if (findReal(container, key)) continue; // a esteira real ja existe: nao precisa de foto
    container.appendChild(node.cloneNode(true));
    inserted += 1;
  }
  if (!inserted) return;
  const timeout = Number.isFinite(Number(c.homeSectionSnapshotTimeoutMs)) ? Number(c.homeSectionSnapshotTimeoutMs) : 12000;
  restoreTimers.push(window.setTimeout(() => clearHomeSnapshotNodes(container), Math.max(2000, timeout)));
}

export function installHomeSnapshotLeaveCapture(getObservedContainer) {
  if (installed) return;
  installed = true;
  const onLeave = () => {
    const container = typeof getObservedContainer === "function" ? getObservedContainer() : null;
    if (!container?.isConnected) return;
    const hash = String(location.hash || "");
    if (/^#!?\/?(home|index)(\.html)?($|[?&])/i.test(hash)) return; // continua na home
    captureHomeSnapshot(container);
    clearHomeSnapshotNodes(container);
  };
  window.addEventListener("hashchange", onLeave);
  window.addEventListener("popstate", onLeave);
}
