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
  padX:  { css: "--lay-pad-x",  unit: "px", min: 0,  max: 400, step: 1,   def: 56,  flow: true },
  padB:  { css: "--lay-pad-b",  unit: "%",  min: 1,  max: 20,  step: 0.5, def: 4.5, flow: true },
  textW: { css: "--lay-text-w", unit: "vw", min: 25, max: 80,  step: 1,   def: 46,  flow: true },
  gap:   { css: "--lay-gap",    unit: "px", min: 0,  max: 40,  step: 1,   def: 10,  flow: true },
  zoneGap: { css: "--lay-zone-gap", unit: "vh", min: 0, max: 40, step: 1, def: 6,   flow: true, zonesOnly: true },
  fmtTop:  { css: "--lay-fmt-top",  unit: "px", min: 0, max: 300, step: 1, def: 40, flow: true },
  fmtLeft: { css: "--lay-fmt-left", unit: "px", min: 0, max: 600, step: 1, def: 56, flow: true }
};

/* Blocos que podem ser deslocados de forma independente (arrastar e soltar ou campos X/Y). Valores em px. */
export const BLOCKS = [
  { id: "fmt",  sel: ".monwui-format-container",   label: "Selos do topo" },
  { id: "logo", sel: ".monwui-logo-container",     label: "Logo" },
  { id: "meta", sel: ".monwui-meta-container",     label: "Selos de informação (nota, duração)" },
  { id: "plot", sel: ".monwui-plot-container",     label: "Sinopse" },
  { id: "dir",  sel: ".monwui-director-container", label: "Diretor" },
  { id: "btn",  sel: ".monwui-main-button-container", label: "Botões" },
  { id: "info", sel: ".monwui-info-container",     label: "Gênero, ano e país" }
];
BLOCKS.forEach((b) => {
  TUNING_FIELDS[`${b.id}X`] = { css: `--lay-${b.id}-x`, unit: "px", min: -1500, max: 1500, step: 1, def: 0, flow: true, offset: true };
  TUNING_FIELDS[`${b.id}Y`] = { css: `--lay-${b.id}-y`, unit: "px", min: -1500, max: 1500, step: 1, def: 0, flow: true, offset: true };
});

export const ALIGN_MODES = ["", "left", "center", "right", "bottom"];
export const CORNER_MODES = ["", "left", "right", "top", "none"];
export const LAYOUT_MODES = ["", "zones"];
export const PLOT_MODES = ["", "hidden", "l2", "l3", "l4", "full"];
const STRING_OPTS = { plot: PLOT_MODES, layout: LAYOUT_MODES, align: ALIGN_MODES, alignInfo: ALIGN_MODES, corners: CORNER_MODES };
const STRING_FIELDS = new Set(Object.keys(STRING_OPTS));
export function isStringField(name) { return STRING_FIELDS.has(name); }

/* Previa ao vivo que sobrevive a qualquer reaplicacao enquanto a janela de configuracoes esta aberta. */
let livePreview = null;
export function setLivePreview(v) { livePreview = v || null; }
export function getLivePreview() { return livePreview; }

const ALIGN_CSS = (attr, sel, fields) => ["left", "center", "right"].map((v) => {
  const self = v === "left" ? "flex-start" : v === "right" ? "flex-end" : "center";
  return `html[data-slider-layout][${attr}=${v}] .monwui-slide>${sel}{align-self:${self}!important;justify-content:${self}!important}`;
}).join("\n");

const CSS = `
/* ocultar a sinopse nao esconde a barra de progresso do filme (ela mora dentro do mesmo bloco) */
html[data-jms-plot=hidden] .monwui-plot-container .monwui-plot{display:none!important}
html[data-jms-plot=hidden] .monwui-plot-container:not(:has(.monwui-playing-progress-container)){display:none!important}
/* alinhamento horizontal, separado para os botoes e para a linha de genero/ano/pais */
${ALIGN_CSS("data-jms-btnalign", ".monwui-main-button-container")}
${ALIGN_CSS("data-jms-infoalign", ".monwui-info-container")}
html[data-slider-layout][data-jms-btnalign=bottom] .monwui-slide>.monwui-main-button-container{align-self:center!important;justify-content:center!important;margin-top:auto!important}
/* centralizado embaixo: o grupo botoes + info desce mais, rente a borda de baixo */
html[data-slider-layout][data-jms-btnalign=bottom] .monwui-slide>.monwui-main-button-container,html[data-slider-layout][data-jms-btnalign=bottom] .monwui-slide>.monwui-info-container{top:clamp(14px,3.2vh,34px)!important}
html[data-slider-layout][data-jms-btnalign=bottom] .monwui-slide>.monwui-info-container{align-self:center!important;justify-content:center!important}
/* botoes e info nao dependem da largura do texto */
html[data-slider-layout] .monwui-slide>.monwui-main-button-container,html[data-slider-layout] .monwui-slide>.monwui-info-container{max-width:100%!important}
/* cantos do slider */
html[data-slider-layout][data-jms-corners=left] .monwui-slide{border-radius:0 var(--lay-radius,24px) var(--lay-radius,24px) 0!important}
html[data-slider-layout][data-jms-corners=right] .monwui-slide{border-radius:var(--lay-radius,24px) 0 0 var(--lay-radius,24px)!important}
html[data-slider-layout][data-jms-corners=top] .monwui-slide{border-radius:0 0 var(--lay-radius,24px) var(--lay-radius,24px)!important}
html[data-slider-layout][data-jms-corners=none] .monwui-slide{border-radius:0!important}
${BLOCKS.map((b) => `html[data-slider-layout][data-jms-moved~=${b.id}] .monwui-slide ${b.sel}{translate:var(--lay-${b.id}-x,0px) var(--lay-${b.id}-y,0px)}`).join("\n")}
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
  const out = {};
  Object.keys(STRING_OPTS).forEach((k) => { out[k] = ""; });
  Object.keys(TUNING_FIELDS).forEach((k) => { out[k] = ""; });
  try {
    Object.keys(out).forEach((k) => {
      const raw = localStorage.getItem(keyOf(profile, k));
      if (raw === null || raw === "") return;
      if (STRING_OPTS[k]) { out[k] = STRING_OPTS[k].includes(raw) ? raw : ""; return; }
      const n = Number(raw);
      if (Number.isFinite(n)) out[k] = n;
    });
  } catch {}
  return out;
}

export function saveTuning(profile, values) {
  try {
    Object.entries(values || {}).forEach(([k, v]) => {
      if (!STRING_FIELDS.has(k) && !TUNING_FIELDS[k]) return;
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
    const over = preview || livePreview;
    const values = over ? { ...stored, ...over } : stored;
    const flow = isFlowProfile(profile);
    const moved = [];

    Object.entries(TUNING_FIELDS).forEach(([name, f]) => {
      const raw = values[name];
      const n = Number(raw);
      if (flow && raw !== "" && raw !== null && raw !== undefined && Number.isFinite(n)) {
        const clamped = Math.min(f.max, Math.max(f.min, n));
        const v = `${clamped}${f.unit}`;
        if (root.style.getPropertyValue(f.css) !== v) root.style.setProperty(f.css, v);
        if (f.offset && clamped !== 0) { const id = name.slice(0, -1); if (!moved.includes(id)) moved.push(id); }
      } else if (root.style.getPropertyValue(f.css) !== "") {
        root.style.removeProperty(f.css);
      }
    });
    if (moved.length) { const m = moved.join(" "); if (root.dataset.jmsMoved !== m) root.dataset.jmsMoved = m; } else delete root.dataset.jmsMoved;

    // disposicao em duas zonas: so no Cinema
    if (profile === "cinema" && values.layout === "zones") { if (root.dataset.jmsZones !== "on") root.dataset.jmsZones = "on"; }
    else delete root.dataset.jmsZones;

    [["align", "jmsBtnalign"], ["alignInfo", "jmsInfoalign"], ["corners", "jmsCorners"]].forEach(([k, d]) => {
      const v = flow && STRING_OPTS[k].includes(values[k]) ? values[k] : "";
      if (v) { if (root.dataset[d] !== v) root.dataset[d] = v; } else delete root.dataset[d];
    });

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
      livePreview = null;
      applyLayoutTuning();
    }
  });
  obs.observe(parent, { childList: true });
}
