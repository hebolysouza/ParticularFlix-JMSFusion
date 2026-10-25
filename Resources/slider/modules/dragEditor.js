import { getActivePositionProfile } from "./positionProfiles.js";
import {
  BLOCKS, isFlowProfile, readTuning, saveTuning, applyLayoutTuning, setLivePreview, getLivePreview
} from "./layoutTuning.js";

/*
 * Modo "arrastar elementos" (fork ParticularFlix, Cinema e Mosaico).
 * A janela de configuracoes some, cada bloco do slide ativo ganha uma moldura e pode ser arrastado com o mouse.
 * Linhas-guia aparecem quando uma borda ou o centro do bloco alinha com o centro do slide, as margens ou
 * com outro bloco (como em editores de design). Alt solta sem imã; setas movem 1px (Shift: 10px).
 * Os deslocamentos sao guardados por estilo (jmsLay:<estilo>:<bloco>X / Y) e aplicados com a propriedade
 * CSS "translate", sem mexer nas chaves de posicao antigas.
 */

const SNAP = 6;
const LAYER_ID = "jms-drag-layer";

function visibleRect(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 6 || r.height < 6) return null;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
  return r;
}

export function startDragEditor({ labels, hideMain, showMain, onSaved }) {
  const L = (k, f) => (typeof labels === "function" ? labels(k, f) : f);
  if (document.getElementById(LAYER_ID)) return;
  const profile = getActivePositionProfile();
  const slide = document.querySelector(".monwui-slide.active") || document.querySelector(".monwui-slide");
  if (!isFlowProfile(profile) || !slide) {
    window.alert(L("posDragUnavailable", "Arrastar elementos funciona nos estilos Cinema e Mosaico, com o slider visível na tela."));
    return;
  }

  const mainModal = hideMain ? hideMain() : null;
  const prevLive = getLivePreview();
  const base = { ...readTuning(profile), ...(prevLive || {}) };
  const work = {};
  BLOCKS.forEach((b) => {
    work[`${b.id}X`] = Number(base[`${b.id}X`]) || 0;
    work[`${b.id}Y`] = Number(base[`${b.id}Y`]) || 0;
  });
  const startWork = { ...work };

  const layer = document.createElement("div");
  layer.id = LAYER_ID;
  layer.style.cssText = "position:fixed;inset:0;z-index:2147482500;cursor:default;touch-action:none;user-select:none";
  const frames = document.createElement("div");
  const guides = document.createElement("div");
  layer.append(frames, guides);

  const bar = document.createElement("div");
  bar.className = "jms-drag-bar";
  bar.style.cssText = "position:fixed;top:68px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;" +
    "max-width:calc(100vw - 24px);padding:10px 14px;border-radius:14px;background:rgba(10,13,20,.92);border:1px solid rgba(255,255,255,.14);color:#f5f8fc;" +
    "font:13px/1.3 system-ui,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.5);z-index:2";
  const msg = document.createElement("span");
  msg.textContent = L("posDragBar", "Arraste os elementos na tela. Alt solta sem imã, setas movem 1px.");
  const mk = (text, bg, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.cssText = `cursor:pointer;border:0;border-radius:9px;padding:7px 12px;font:600 13px system-ui,sans-serif;color:#fff;background:${bg}`;
    b.addEventListener("click", fn);
    return b;
  };
  const status = document.createElement("span");
  status.style.cssText = "opacity:.8;min-width:110px;text-align:center";
  bar.append(msg, status,
    mk(L("posDragSave", "Salvar"), "#a3121a", () => finish(true)),
    mk(L("posDragReset", "Zerar posições"), "rgba(255,255,255,.14)", () => { Object.keys(work).forEach((k) => { work[k] = 0; }); push(); draw(); }),
    mk(L("posDragCancel", "Cancelar"), "rgba(255,255,255,.14)", () => finish(false)));
  layer.appendChild(bar);
  document.body.appendChild(layer);

  const push = () => {
    setLivePreview({ ...base, ...work });
    applyLayoutTuning();
  };

  let hover = null;
  let selected = null;
  let drag = null;

  const getBlocks = () => {
    const out = [];
    BLOCKS.forEach((b) => {
      const el = slide.querySelector(b.sel);
      const r = visibleRect(el);
      if (r) out.push({ ...b, el, rect: r });
    });
    return out;
  };

  const draw = () => {
    frames.textContent = "";
    getBlocks().forEach((b) => {
      const d = document.createElement("div");
      const on = (drag && drag.block.id === b.id) || (!drag && hover === b.id) || selected === b.id;
      d.style.cssText = `position:fixed;left:${b.rect.left}px;top:${b.rect.top}px;width:${b.rect.width}px;height:${b.rect.height}px;box-sizing:border-box;pointer-events:none;` +
        `border:${on ? "2px solid #ff4d6d" : "1px dashed rgba(255,255,255,.35)"};border-radius:6px;background:${on ? "rgba(255,77,109,.08)" : "transparent"}`;
      if (on) {
        const t = document.createElement("span");
        t.textContent = L(`posBlock_${b.id}`, b.label);
        t.style.cssText = "position:absolute;left:0;bottom:100%;margin-bottom:3px;padding:2px 7px;border-radius:6px;background:#ff4d6d;color:#fff;font:600 11px system-ui,sans-serif;white-space:nowrap";
        d.appendChild(t);
      }
      frames.appendChild(d);
    });
  };

  const pick = (x, y) => {
    let best = null;
    getBlocks().forEach((b) => {
      const r = b.rect;
      if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4) {
        const area = r.width * r.height;
        if (!best || area < best.area) best = { block: b, area };
      }
    });
    return best ? best.block : null;
  };

  const drawGuides = (vx, hy, sr) => {
    guides.textContent = "";
    const line = (css) => { const g = document.createElement("div"); g.style.cssText = `position:fixed;pointer-events:none;background:#3ad1ff;${css}`; guides.appendChild(g); };
    vx.forEach((x) => line(`left:${x}px;top:${sr.top}px;width:1px;height:${sr.height}px`));
    hy.forEach((y) => line(`top:${y}px;left:${sr.left}px;height:1px;width:${sr.width}px`));
  };

  const onDown = (e) => {
    if (e.target.closest && e.target.closest(".jms-drag-bar")) return;
    const blocks = getBlocks();
    const b = pick(e.clientX, e.clientY);
    e.preventDefault();
    if (!b) { selected = null; draw(); return; }
    selected = b.id;
    const sr = slide.getBoundingClientRect();
    const cs = getComputedStyle(slide);
    drag = {
      block: b, sx: e.clientX, sy: e.clientY, rect: b.rect, sr,
      padL: parseFloat(cs.paddingLeft) || 0, padR: parseFloat(cs.paddingRight) || 0, padB: parseFloat(cs.paddingBottom) || 0,
      x0: work[`${b.id}X`], y0: work[`${b.id}Y`],
      others: blocks.filter((o) => o.id !== b.id).map((o) => o.rect)
    };
    try { layer.setPointerCapture(e.pointerId); } catch {}
    layer.style.cursor = "grabbing";
  };

  const onMove = (e) => {
    if (!drag) {
      if (e.target.closest && e.target.closest(".jms-drag-bar")) return;
      const h = pick(e.clientX, e.clientY);
      const id = h ? h.id : null;
      if (id !== hover) { hover = id; layer.style.cursor = id ? "grab" : "default"; draw(); }
      return;
    }
    let dx = e.clientX - drag.sx;
    let dy = e.clientY - drag.sy;
    const vx = [];
    const hy = [];
    if (!e.altKey) {
      const sr = drag.sr;
      const lines = { x: [sr.left, sr.right, sr.left + sr.width / 2, sr.left + drag.padL, sr.right - drag.padR], y: [sr.top, sr.bottom, sr.top + sr.height / 2, sr.bottom - drag.padB] };
      drag.others.forEach((r) => { lines.x.push(r.left, r.left + r.width / 2, r.right); lines.y.push(r.top, r.top + r.height / 2, r.bottom); });
      const r = drag.rect;
      const bestFor = (edges, cands) => {
        let best = null;
        edges.forEach((edge) => cands.forEach((c) => {
          const diff = c - edge;
          if (Math.abs(diff) <= SNAP && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, line: c };
        }));
        return best;
      };
      const bx = bestFor([r.left + dx, r.left + dx + r.width / 2, r.left + dx + r.width], lines.x);
      const by = bestFor([r.top + dy, r.top + dy + r.height / 2, r.top + dy + r.height], lines.y);
      if (bx) { dx += bx.diff; vx.push(bx.line); }
      if (by) { dy += by.diff; hy.push(by.line); }
    }
    work[`${drag.block.id}X`] = Math.round(drag.x0 + dx);
    work[`${drag.block.id}Y`] = Math.round(drag.y0 + dy);
    push();
    drawGuides(vx, hy, drag.sr);
    status.textContent = `X ${work[`${drag.block.id}X`]}  Y ${work[`${drag.block.id}Y`]}`;
    requestAnimationFrame(() => { if (drag) { const nb = getBlocks().find((x) => x.id === drag.block.id); if (nb) drag.block.rect = nb.rect; draw(); } });
  };

  const onUp = (e) => {
    if (!drag) return;
    try { layer.releasePointerCapture(e.pointerId); } catch {}
    drag = null;
    guides.textContent = "";
    layer.style.cursor = "grab";
    draw();
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); return; }
    if (!selected || !e.key.startsWith("Arrow")) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") work[`${selected}X`] -= step;
    if (e.key === "ArrowRight") work[`${selected}X`] += step;
    if (e.key === "ArrowUp") work[`${selected}Y`] -= step;
    if (e.key === "ArrowDown") work[`${selected}Y`] += step;
    push();
    requestAnimationFrame(draw);
    status.textContent = `X ${work[`${selected}X`]}  Y ${work[`${selected}Y`]}`;
  };

  const timer = setInterval(() => { if (!drag) draw(); }, 600);
  layer.addEventListener("pointerdown", onDown);
  layer.addEventListener("pointermove", onMove);
  layer.addEventListener("pointerup", onUp);
  layer.addEventListener("pointercancel", onUp);
  document.addEventListener("keydown", onKey, true);
  draw();

  function finish(save) {
    clearInterval(timer);
    document.removeEventListener("keydown", onKey, true);
    layer.remove();
    if (save) {
      const out = {};
      Object.keys(work).forEach((k) => { out[k] = work[k] === 0 ? "" : work[k]; });
      saveTuning(profile, out);
      setLivePreview(prevLive);
      applyLayoutTuning();
      if (onSaved) onSaved();
    } else {
      Object.assign(work, startWork);
      setLivePreview(prevLive);
      applyLayoutTuning();
    }
    if (showMain) showMain(mainModal);
  }
}
