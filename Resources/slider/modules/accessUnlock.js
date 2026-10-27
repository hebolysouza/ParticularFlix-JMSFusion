import { fetchAccessStatus, unlockAccess, lockAccess } from "./parentalPinApi.js";
import { getConfig } from "./config.js";
import { blockScopedCacheFlush, rememberKnownGeneration, readKnownGenerationFor } from "./scopedJsonCache.js";

// ParticularFlix fork: temporary access unlock for restricted (non-admin) users.
// Shows a small lock button; the global PIN elevates the native Jellyfin policy for
// N minutes and the server restores the restriction automatically.

const STYLE_ID = "jms-accu-style";
const BTN_ID = "jms-accu-btn";
const DLG_ID = "jms-accu-dialog";
const POLL_MS = 60_000;
const EMPTY_ID = "jms-accu-empty";

// Fork ParticularFlix: com o perfil bloqueado (html.jms-access-blocked), os atalhos de biblioteca, favoritos e busca
// somem de todos os lugares onde o Jellyfin e os scripts do ParticularFlix os desenham (barra moderna, barra legada,
// menu lateral nativo e o menu lateral do ParticularFlix). A garantia real e a politica no servidor; isto evita que
// o usuario veja icones que levariam a paginas vazias ou, com a politica antiga ainda em cache, a conteudo.
const NAV_HOSTS = ["header", ".skinHeader", ".mainDrawer", "#pf-dr", ".headerTabs"];
const NAV_LINKS = [
  'a[href*="topParentId="]', 'a[href*="parentId="]', 'a[href^="#/movies"]', 'a[href^="#/tv"]', 'a[href^="#/music"]',
  'a[href^="#/boxsets"]', 'a[href^="#/livetv"]', 'a[href^="#/homevideos"]', 'a[href^="#/books"]', 'a[href^="#/musicvideos"]',
  'a[href^="#/list"]', 'a[href^="#/search"]', 'a[href^="#/home?tab=1"]', 'a[href^="#/favorites"]', 'a.lnkMediaFolder[data-itemid]',
  ".headerSearchButton", ".libraryMenuOptions", ".jms-watchlist-header-btn"
];
const BLOCKED_NAV_CSS = NAV_HOSTS.map((h) => NAV_LINKS.map((l) => `html.jms-access-blocked ${h} ${l}`).join(",")).join(",") + "{display:none !important}";

// Rotas que continuam abertas com o perfil bloqueado: a home (que mostra o aviso), as preferencias do usuario e as
// telas de login/servidor. Qualquer outra (biblioteca, detalhes, busca, favoritos, player, lista) volta para a home.
const BLOCKED_ALLOWED_ROUTES = /^\/(home|index|home\.html|index\.html|mypreferences[a-z]*|userprofile|login|selectserver|addserver|forgotpassword[a-z]*|forgotpasswordpin|quickconnect|userpluginsettings\.html|wizard[a-z]*|dashboard|startup[a-z/]*)?$/i;

function isBlockedRoute() {
  const raw = String(location.hash || "").replace(/^#!?/, "");
  if (!raw) return false;
  const [path, query = ""] = raw.split("?");
  if (!BLOCKED_ALLOWED_ROUTES.test(path || "/")) return true;
  if (/^\/(home|index)/i.test(path)) {
    const tab = new URLSearchParams(query).get("tab");
    if (tab === "1") return true;
  }
  return false;
}

function guardBlockedRoute() {
  if (!document.documentElement.classList.contains("jms-access-blocked")) return;
  if (!isBlockedRoute()) return;
  try { location.replace("#/home"); } catch { location.hash = "#/home"; }
}

let started = false;
let pollTimer = 0;
let expiryTimer = 0;
let lastStatus = null;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
#${BTN_ID}{position:fixed;left:14px;bottom:14px;z-index:9990;display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:99px;border:1px solid rgba(255,255,255,.25);background:rgba(20,20,24,.82);color:#fff;font-size:.85em;cursor:pointer;backdrop-filter:blur(6px)}
#${BTN_ID}.open{background:rgba(180,120,0,.85)}
body.jms-accu-hide #${BTN_ID}{display:none}
#${EMPTY_ID}{margin:14vh auto 0;max-width:520px;padding:34px 28px 30px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;color:#fff;border-radius:18px;background:rgba(18,18,24,.72);border:1px solid rgba(255,255,255,.08);box-shadow:0 18px 50px rgba(0,0,0,.45);animation:jmsAccuIn .22s ease-out both}
#${EMPTY_ID} .jms-accu-ico{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(229,9,20,.14);border:1px solid rgba(229,9,20,.45);color:#ff4d57;margin-bottom:6px;flex:none}
#${EMPTY_ID} .jms-accu-ico i{font-size:26px;line-height:1;display:block;margin:0}
#${EMPTY_ID} p{margin:0;line-height:1.5}
#${EMPTY_ID} p.jms-accu-title{font-size:1.15em;font-weight:600}
#${EMPTY_ID} p.jms-accu-hint{font-size:.95em;opacity:.72}
@keyframes jmsAccuIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#${EMPTY_ID}{animation:none}}
${BLOCKED_NAV_CSS}
#${DLG_ID}{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6)}
#${DLG_ID} .box{background:#1b1b20;color:#fff;border-radius:14px;padding:22px;width:min(92vw,340px);box-shadow:0 10px 40px rgba(0,0,0,.6)}
#${DLG_ID} h3{margin:0 0 10px}
#${DLG_ID} input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.4);color:#fff;font-size:1.1em;letter-spacing:.2em;text-align:center}
#${DLG_ID} .msg{min-height:1.3em;margin:8px 0;font-size:.9em;color:#ffb4a8}
#${DLG_ID} .btns{display:flex;gap:8px;justify-content:flex-end}
#${DLG_ID} button{padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;cursor:pointer}
#${DLG_ID} button.primary{background:#1e88e5;border-color:#1e88e5}
`;
  document.head.appendChild(st);
}

function tr(key, fallback) {
  try {
    const labels = getConfig()?.languageLabels || {};
    const v = labels[key];
    if (typeof v === "string" && v) return v;
  } catch {}
  return fallback;
}

function removeEls() {
  document.getElementById(BTN_ID)?.remove();
  document.getElementById(DLG_ID)?.remove();
}

function isPlayerActive() {
  return !!document.querySelector("video.htmlvideoplayer, .videoPlayerContainer:not(.hide)");
}

function clearListCaches() {
  try {
    const prefix = "jms:scoped-json-cache:v1:";
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) sessionStorage.removeItem(k);
    }
  } catch {}
}

// Recarrega sem que o cache em memoria (antigo) seja gravado de volta no servidor durante o pagehide.
function reloadClean() {
  try { blockScopedCacheFlush(); } catch {}
  clearListCaches();
  location.reload();
}

// Se a geracao de cache do usuario mudou no servidor (permissoes alteradas), esta pagina esta com dados
// antigos: recarrega, mas nunca no meio de uma reproducao e no maximo uma vez a cada 20 s.
function handleGenerationChange(status) {
  const gen = Number(status?.generation || 0);
  const uid = String(status?.userId || "");
  if (!gen || !uid) return;

  const known = readKnownGenerationFor(uid);
  if (!known) {
    rememberKnownGeneration(gen, uid);
    return;
  }
  if (known === gen) return;

  if (isPlayerActive()) return;
  try {
    const last = Number(sessionStorage.getItem("jms:accu-reload-at") || 0);
    if (Date.now() - last < 20000) return;
    sessionStorage.setItem("jms:accu-reload-at", String(Date.now()));
  } catch {}
  rememberKnownGeneration(gen, uid);
  reloadClean();
}

function closeDialog() {
  document.getElementById(DLG_ID)?.remove();
}

function openDialog() {
  closeDialog();
  const dlg = document.createElement("div");
  dlg.id = DLG_ID;
  const box = document.createElement("div");
  box.className = "box";
  const h = document.createElement("h3");
  h.textContent = tr("accessUnlockTitle", "Unlock content");
  const input = document.createElement("input");
  input.type = "password";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.placeholder = "PIN";
  const msg = document.createElement("div");
  msg.className = "msg";
  const btns = document.createElement("div");
  btns.className = "btns";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = tr("accessUnlockCancel", "Cancel");
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "primary";
  ok.textContent = tr("accessUnlockConfirm", "Unlock");
  btns.append(cancel, ok);
  box.append(h, input, msg, btns);
  dlg.appendChild(box);
  document.body.appendChild(dlg);
  setTimeout(() => input.focus(), 30);

  cancel.addEventListener("click", closeDialog);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(); });

  const submit = async () => {
    const pin = input.value.trim();
    if (!pin) return;
    ok.disabled = true;
    msg.textContent = "";
    try {
      const res = await unlockAccess(pin);
      if (res && res.valid) {
        reloadClean();
        return;
      }
      if (res && res.isLocked) {
        msg.textContent = tr("accessUnlockLocked", "Too many attempts. Try again later.");
      } else {
        const left = res && typeof res.remainingAttempts === "number" ? ` (${res.remainingAttempts})` : "";
        msg.textContent = tr("accessUnlockWrong", "Wrong PIN.") + left;
      }
      input.value = "";
      input.focus();
    } catch (e) {
      msg.textContent = String(e?.message || e);
    }
    ok.disabled = false;
  };
  ok.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") closeDialog();
  });
}

function isHomeRoute() {
  const h = String(location.hash || "").toLowerCase();
  return h === "" || h === "#" || h.startsWith("#/home") || h.startsWith("#/index");
}

function countHomeContent(page) {
  try {
    return page.querySelectorAll(".homeSectionsContainer .card, .homeSectionsContainer .cardBox, .monwui-slide, #monwui-slides-container .monwui-slide").length;
  } catch {
    return 1;
  }
}

// Perfil que bloqueia tudo: sem nenhum cartao na home, mostra um aviso (o Jellyfin nativo mostra o dele
// apenas quando nao ha bibliotecas; com o Home Screen Sections a tela ficava vazia ou com linha vazia).
let emptyCheckTimers = [];
function clearEmptyNotice() {
  emptyCheckTimers.forEach((t) => clearTimeout(t));
  emptyCheckTimers = [];
  document.getElementById(EMPTY_ID)?.remove();
}

// Fork ParticularFlix: perfil que bloqueia todas as bibliotecas (status.blocksAll). A home fica marcada com a
// classe jms-access-blocked (o CSS critico do main.js esconde slider, colecoes e todas as secoes de uma vez)
// e o usuario fica lembrado no localStorage, para a proxima abertura ja comecar bloqueada.
const BLOCKED_USER_KEY = "jms:accessBlockedUser";
function isBlockedStatus(status) {
  return !!status && status.blocksAll === true && status.isUnlocked !== true;
}
function applyBlockedState(status) {
  const blocked = isBlockedStatus(status);
  document.documentElement.classList.toggle("jms-access-blocked", blocked);
  if (blocked) guardBlockedRoute();
  try {
    const uid = String(status?.userId || "").replace(/-/g, "").toLowerCase();
    if (blocked && uid) localStorage.setItem(BLOCKED_USER_KEY, uid);
    else if (status) localStorage.removeItem(BLOCKED_USER_KEY);
  } catch {}
}

function buildEmptyNotice() {
  const box = document.createElement("div");
  box.id = EMPTY_ID;
  box.setAttribute("role", "status");
  const badge = document.createElement("span");
  badge.className = "jms-accu-ico";
  badge.setAttribute("aria-hidden", "true");
  const icon = document.createElement("i");
  icon.className = "fas fa-lock";
  badge.appendChild(icon);
  const p1 = document.createElement("p");
  p1.className = "jms-accu-title";
  p1.textContent = tr("accessEmptyHome", "No content is available for this profile.");
  const p2 = document.createElement("p");
  p2.className = "jms-accu-hint";
  p2.textContent = tr("accessEmptyHomeHint", "Contact the server administrator to request access.");
  box.append(badge, p1, p2);
  return box;
}

function evaluateEmptyHome(status) {
  const locked = !!status && status.hasProfile && status.isUnlocked !== true;
  const page = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
  const existing = document.getElementById(EMPTY_ID);
  if (!locked || !page || !isHomeRoute()) {
    existing?.remove();
    return;
  }
  if (isBlockedStatus(status)) {
    // Tudo bloqueado: o aviso entra direto, sem esperar as secoes carregarem vazias.
    const host = page.querySelector("#homeTab") || page;
    if (existing && existing.isConnected && existing.parentElement === host) return;
    existing?.remove();
    host.prepend(buildEmptyNotice());
    return;
  }
  // O Jellyfin nativo ja mostra a propria mensagem (.centerMessage) quando nao ha bibliotecas.
  const nativeMessage = !!page.querySelector(".centerMessage");
  const hasContent = nativeMessage || countHomeContent(page) > 0;
  if (hasContent) {
    existing?.remove();
    return;
  }
  if (existing && existing.isConnected) return;
  const host = page.querySelector(".homeSectionsContainer") || page;
  host.appendChild(buildEmptyNotice());
}

function scheduleEmptyHomeCheck(status) {
  emptyCheckTimers.forEach((t) => clearTimeout(t));
  const delays = isBlockedStatus(status) ? [0, 150, 500, 1200, 3000] : [2500, 6000, 12000];
  emptyCheckTimers = delays.map((ms) => setTimeout(() => {
    try { evaluateEmptyHome(status); } catch {}
  }, ms));
}

function formatRemaining(untilMs) {
  const mins = Math.max(0, Math.ceil((untilMs - Date.now()) / 60000));
  return `${mins} min`;
}

function renderButton(status) {
  let btn = document.getElementById(BTN_ID);
  if (!status || !status.hasProfile || (!status.unlockAvailable && !status.isUnlocked)) {
    btn?.remove();
    return;
  }
  if (!btn) {
    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    document.body.appendChild(btn);
  }
  btn.classList.toggle("open", status.isUnlocked === true);
  btn.textContent = "";
  const icon = document.createElement("i");
  icon.className = `fas ${status.isUnlocked ? "fa-lock-open" : "fa-lock"}`;
  const label = document.createElement("span");
  label.textContent = status.isUnlocked
    ? `${tr("accessUnlockLockNow", "Lock now")} (${formatRemaining(status.unlockedUntilUtc)})`
    : tr("accessUnlockButton", "Unlock");
  btn.append(icon, label);
  btn.onclick = async () => {
    if (status.isUnlocked) {
      btn.disabled = true;
      try {
        await lockAccess();
        reloadClean();
      } catch {
        btn.disabled = false;
      }
    } else {
      openDialog();
    }
  };
  document.body.classList.toggle("jms-accu-hide", isPlayerActive());
}

function scheduleExpiry(status) {
  clearTimeout(expiryTimer);
  expiryTimer = 0;
  if (status && status.isUnlocked && status.unlockedUntilUtc) {
    // The server relocks within ~20s after expiry; reload once it had time to do so.
    const wait = Math.max(5000, status.unlockedUntilUtc - Date.now() + 30_000);
    expiryTimer = window.setTimeout(() => reloadClean(), Math.min(wait, 2_147_000_000));
  }
}

async function refresh() {
  try {
    const status = await fetchAccessStatus();
    lastStatus = status;
    applyBlockedState(status);
    handleGenerationChange(status);
    renderButton(status);
    scheduleExpiry(status);
    scheduleEmptyHomeCheck(status);
  } catch {
    // silent: not logged in or plugin endpoint unavailable
  }
}

export function initAccessUnlock() {
  if (started) {
    refresh();
    return;
  }
  started = true;
  injectStyle();
  refresh();
  pollTimer = window.setInterval(() => {
    if (lastStatus) renderButton(lastStatus);
    refresh();
  }, POLL_MS);
  window.addEventListener("jms:cache-generation-stale", () => {
    void refresh();
  });
  window.addEventListener("hashchange", () => {
    guardBlockedRoute();
    if (lastStatus) scheduleEmptyHomeCheck(lastStatus);
  });
  window.addEventListener("popstate", guardBlockedRoute);
  document.addEventListener("jms:auth-profile-changed", () => {
    document.documentElement.classList.remove("jms-access-blocked");
    clearEmptyNotice();
    removeEls();
    lastStatus = null;
    refresh();
  });
}

export function stopAccessUnlock() {
  clearEmptyNotice();
  clearInterval(pollTimer);
  clearTimeout(expiryTimer);
  removeEls();
  started = false;
}
