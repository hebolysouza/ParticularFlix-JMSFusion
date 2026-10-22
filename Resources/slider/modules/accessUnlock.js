import { fetchAccessStatus, unlockAccess, lockAccess } from "./parentalPinApi.js";
import { getConfig } from "./config.js";

// ParticularFlix fork: temporary access unlock for restricted (non-admin) users.
// Shows a small lock button; the global PIN elevates the native Jellyfin policy for
// N minutes and the server restores the restriction automatically.

const STYLE_ID = "jms-accu-style";
const BTN_ID = "jms-accu-btn";
const DLG_ID = "jms-accu-dialog";
const POLL_MS = 60_000;

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
        location.reload();
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
        location.reload();
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
    expiryTimer = window.setTimeout(() => location.reload(), Math.min(wait, 2_147_000_000));
  }
}

async function refresh() {
  try {
    const status = await fetchAccessStatus();
    lastStatus = status;
    renderButton(status);
    scheduleExpiry(status);
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
  document.addEventListener("jms:auth-profile-changed", () => {
    removeEls();
    lastStatus = null;
    refresh();
  });
}

export function stopAccessUnlock() {
  clearInterval(pollTimer);
  clearTimeout(expiryTimer);
  removeEls();
  started = false;
}
