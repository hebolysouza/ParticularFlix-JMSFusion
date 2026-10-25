import { getActivePositionProfile } from "./positionProfiles.js";

/*
 * Ajustes globais por estilo de slider (fork ParticularFlix).
 * Em vez de mexer bloco a bloco (cada deslocamento em % de um container diferente), estes ajustes mexem
 * no layout inteiro de uma vez, e cada estilo guarda os seus em chaves proprias "jmsLay:<estilo>:<campo>":
 *   padX / padB / textW / gap  -> margem lateral, margem inferior, largura do texto e espaco entre blocos
 *                                 (so Cinema e Mosaico, que empilham os blocos em fluxo)
 *   plot                       -> como a sinopse aparece: '' (padrao), hidden, l2, l3, l4, full (todos os estilos
 *                                 aceitam hidden; l2..full valem para Cinema e Mosaico)
 * Valores vazios = padrao do estilo. Nada aqui altera as chaves de posicao ja existentes.
 */

const NS = "jmsLay:";
const FLOW = new Set(["cinema", "mosaic"]);
const STYLE_ID = "jms-layout-tuning-css";

export const TUNING_FIELDS = {
  padX:  { css: "--lay-pad-x",  unit: "px", min: 16, max: 240, step: 2,   flow: true },
  padB:  { css: "--lay-pad-b",  unit: "%",  min: 1,  max: 20,  step: 0.5, flow: true },
  textW: { css: "--lay-text-w", unit: "vw", min: 25, max: 80,  step: 1,   flow: true },
  gap:   { css: "--lay-gap",    unit: "px", min: 0,  max: 40,  step: 1,   flow: true },
  zoneGap: { css: "--lay-zone-gap", unit: "vh", min: 0, max: 40, step: 1,   flow: true, zonesOnly: true }
};
export const LAYOUT_MODES = ["", "zones"];
export const PLOT_MODES = ["", "hidden", "l2", "l3", "l4", "full"];

const CSS = `
/* ocultar a sinopse nao esconde a barra de progresso do filme (ela mora dentro do mesmo bloco) */
html[data-jms-plot=hidden] .monwui-plot-container .monwui-plot{display:none!important}
html[data-jms-plot=hidden] .monwui-plot-container:not(:has(.monwui-playing-progress-container)){display:none!important}
html[data-slider-layout=cinema][data-jms-plot=full] .monwui-plot-container .monwui-plot,
html[data-slider-layout=mosaic][data-jms-plot=full] .monwui-plot-container .monwui-plot{display:block!important;-webkit-line-clamp:unset!important;overflow:visible!important}
`;

function ensureCss() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function keyOf(profile, name) { return `${NS}${profile}:${name}`; }

export function isFlowProfile(profile) { return FLOW.has(profile); }

export function readTuning(profile = getActivePositionProfile()) {
  const out = { plot: "", layout: "" };
  Object.keys(TUNING_FIELDS).forEach((k) => { out[k] = ""; });
  try {
    Object.keys(out).forEach((k) => {
      const raw = localStorage.getItem(keyOf(profile, k));
      if (raw === null || raw === "") return;
      if (k === "plot") { out.plot = PLOT_MODES.includes(raw) ? raw : ""; return; }
      if (k === "layout") { out.layout = LAYOUT_MODES.includes(raw) ? raw : ""; return; }
      const n = Number(raw);
      if (Number.isFinite(n)) out[k] = n;
    });
  } catch {}
  return out;
}

export function saveTuning(profile, values) {
  try {
    Object.entries(values || {}).forEach(([k, v]) => {
      if (k !== "plot" && k !== "layout" && !TUNING_FIELDS[k]) return;
      const key = keyOf(profile, k);
      const empty = v === "" || v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v));
      if (empty) { localStorage.removeItem(key); return; }
      try { window.__JMS_MANAGED_STORAGE__?.registerKeys?.([key]); } catch {}
      localStorage.setItem(key, String(v));
    });
    return true;
  } catch { return false; }
}

/* Escreve as variaveis no <html>. `preview` (opcional) sobrepoe o que esta salvo, para a previa ao vivo. */
export function applyLayoutTuning(preview) {
  try {
    ensureCss();
    const root = document.documentElement;
    const profile = getActivePositionProfile();
    const stored = readTuning(profile);
    const values = preview ? { ...stored, ...preview } : stored;
    const flow = isFlowProfile(profile);

    Object.entries(TUNING_FIELDS).forEach(([name, f]) => {
      const raw = values[name];
      const n = Number(raw);
      if (flow && raw !== "" && raw !== null && raw !== undefined && Number.isFinite(n)) {
        const v = `${Math.min(f.max, Math.max(f.min, n))}${f.unit}`;
        if (root.style.getPropertyValue(f.css) !== v) root.style.setProperty(f.css, v);
      } else if (root.style.getPropertyValue(f.css) !== "") {
        root.style.removeProperty(f.css);
      }
    });

    // disposicao em duas zonas: so no Cinema
    if (profile === "cinema" && values.layout === "zones") { if (root.dataset.jmsZones !== "on") root.dataset.jmsZones = "on"; }
    else delete root.dataset.jmsZones;

    const plot = PLOT_MODES.includes(values.plot) ? values.plot : "";
    const effective = plot === "l2" ? "" : plot;
    const lines = plot === "l3" ? "3" : plot === "l4" ? "4" : "";
    if (effective) { if (root.dataset.jmsPlot !== effective) root.dataset.jmsPlot = effective; } else { delete root.dataset.jmsPlot; }
    if (lines && flow) root.style.setProperty("--lay-plot-lines", lines); else root.style.removeProperty("--lay-plot-lines");
  } catch {}
}

/* Se a janela de configuracoes fechar sem salvar, volta ao que esta salvo. */
let watching = false;
export function revertTuningWhenSettingsCloses() {
  if (watching) return;
  const modal = document.getElementById("settings-modal");
  const parent = modal && modal.parentNode;
  if (!parent) return;
  watching = true;
  const obs = new MutationObserver(() => {
    if (!document.getElementById("settings-modal")) {
      obs.disconnect();
      watching = false;
      applyLayoutTuning();
    }
  });
  obs.observe(parent, { childList: true });
}
