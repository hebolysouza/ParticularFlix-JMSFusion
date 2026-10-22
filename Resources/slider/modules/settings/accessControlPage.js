import { showNotification } from "../player/ui/notification.js";
import {
  fetchAccessProfiles,
  saveAccessProfile,
  deleteAccessProfile
} from "../parentalPinApi.js";
import { createSection } from "./shared.js";

// ParticularFlix fork: admin panel that edits the NATIVE Jellyfin user policy
// (max rating, blocked tags, libraries...) so the restriction is enforced by the
// server on every client, plus the optional temporary unlock with the global PIN.

const STYLE_ID = "jms-acc-style";
const RATING_OPTIONS = [
  { value: "", key: "accessCtlRatingNone", fallback: "No limit" },
  { value: "0", key: "accessCtlRatingL", fallback: "Livre (L)" },
  { value: "10", key: "accessCtlRating10", fallback: "Up to 10 years" },
  { value: "12", key: "accessCtlRating12", fallback: "Up to 12 years" },
  { value: "14", key: "accessCtlRating14", fallback: "Up to 14 years" },
  { value: "16", key: "accessCtlRating16", fallback: "Up to 16 years" },
  { value: "18", key: "accessCtlRating18", fallback: "Up to 18 years" }
];

function t(labels, key, fallback) {
  const v = labels && labels[key];
  return typeof v === "string" && v.trim() ? v : fallback;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
.jms-acc-card{border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;margin:12px 0;background:rgba(255,255,255,.04)}
.jms-acc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.jms-acc-name{font-weight:700;font-size:1.05em}
.jms-acc-badge{font-size:.78em;padding:2px 9px;border-radius:99px;background:rgba(255,255,255,.12)}
.jms-acc-badge.on{background:rgba(46,160,67,.35)}
.jms-acc-badge.warn{background:rgba(210,153,34,.4)}
.jms-acc-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0}
.jms-acc-row label{min-width:150px;opacity:.9}
.jms-acc-row select,.jms-acc-row input[type=text],.jms-acc-row input[type=number]{padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35);color:inherit;min-width:140px}
.jms-acc-row input[type=text].wide{flex:1;min-width:220px}
.jms-acc-libs{display:flex;flex-wrap:wrap;gap:6px 16px;margin:6px 0 6px 0}
.jms-acc-libs label{display:flex;align-items:center;gap:6px;min-width:0}
.jms-acc-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.jms-acc-btn{padding:7px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:inherit;cursor:pointer}
.jms-acc-btn.primary{background:#1e88e5;border-color:#1e88e5;color:#fff}
.jms-acc-btn:disabled{opacity:.5;cursor:default}
.jms-acc-note{opacity:.75;font-size:.9em;margin:6px 0}
.jms-acc-warn{padding:8px 12px;border-radius:8px;background:rgba(210,153,34,.25);margin:8px 0}
.jms-acc-sub{margin:12px 0 4px;font-weight:600;opacity:.9}
`;
  document.head.appendChild(st);
}

function splitTags(text) {
  return String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function ratingLabel(labels, value) {
  const opt = RATING_OPTIONS.find((o) => o.value === (value === null || value === undefined ? "" : String(value)));
  return opt ? t(labels, opt.key, opt.fallback) : String(value);
}

function notify(message, kind) {
  const icon = kind === "error" ? "fa-triangle-exclamation" : "fa-circle-check";
  showNotification(`<i class="fas ${icon} jms-notification-icon"></i> ${message}`, kind === "error" ? 4200 : 2800, kind);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function row(labelText, control) {
  const r = el("div", "jms-acc-row");
  if (labelText) r.appendChild(el("label", "", labelText));
  r.appendChild(control);
  return r;
}

function makeSelect(options, current) {
  const s = document.createElement("select");
  options.forEach(({ value, text }) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    s.appendChild(o);
  });
  s.value = current;
  return s;
}

function buildTemplates(labels, allUnrated) {
  return [
    {
      id: "free",
      text: t(labels, "accessCtlTplFree", "Free (no restriction)"),
      values: { maxParentalRating: null, blockUnratedItems: [], blockedTags: [], allowedTags: [], enableAllFolders: true, enabledFolders: [] }
    },
    {
      id: "child",
      text: t(labels, "accessCtlTplChild", "Child (up to 10, block unrated)"),
      values: { maxParentalRating: 10, blockUnratedItems: allUnrated, blockedTags: [], allowedTags: [], enableAllFolders: true, enabledFolders: [] }
    },
    {
      id: "teen",
      text: t(labels, "accessCtlTplTeen", "Teen (up to 14, block unrated)"),
      values: { maxParentalRating: 14, blockUnratedItems: allUnrated, blockedTags: [], allowedTags: [], enableAllFolders: true, enabledFolders: [] }
    },
    {
      id: "almost",
      text: t(labels, "accessCtlTplAlmost", "Almost adult (up to 16)"),
      values: { maxParentalRating: 16, blockUnratedItems: [], blockedTags: [], allowedTags: [], enableAllFolders: true, enabledFolders: [] }
    }
  ];
}

function buildUserCard(user, ctx) {
  const { labels, libraries, allUnrated, hasPin, reload } = ctx;
  const profile = user.profile || null;
  const base = profile ? profile.restricted : user.current;
  const unlockedBase = profile && profile.unlocked ? profile.unlocked : null;

  const card = el("div", "jms-acc-card");
  const head = el("div", "jms-acc-head");
  head.appendChild(el("span", "jms-acc-name", user.userName || user.userId));
  const badge = el("span", "jms-acc-badge");
  if (profile) {
    badge.classList.add(profile.isUnlocked ? "warn" : "on");
    badge.textContent = profile.isUnlocked
      ? t(labels, "accessCtlStatusUnlocked", "Temporarily unlocked")
      : t(labels, "accessCtlStatusActive", "Restriction active");
  } else {
    badge.textContent = t(labels, "accessCtlStatusNone", "Not managed by the plugin");
  }
  head.appendChild(badge);
  card.appendChild(head);

  // templates
  const tpls = buildTemplates(labels, allUnrated);
  const tplSel = makeSelect(
    [{ value: "", text: t(labels, "accessCtlTplPick", "Choose a template...") }, ...tpls.map((x) => ({ value: x.id, text: x.text }))],
    ""
  );
  card.appendChild(row(t(labels, "accessCtlTemplate", "Template"), tplSel));

  // rating
  const ratingSel = makeSelect(
    RATING_OPTIONS.map((o) => ({ value: o.value, text: t(labels, o.key, o.fallback) })),
    base.maxParentalRating === null || base.maxParentalRating === undefined ? "" : String(base.maxParentalRating)
  );
  card.appendChild(row(t(labels, "accessCtlMaxRating", "Maximum rating"), ratingSel));

  const unratedCb = document.createElement("input");
  unratedCb.type = "checkbox";
  unratedCb.checked = (base.blockUnratedItems || []).length > 0;
  card.appendChild(row(t(labels, "accessCtlBlockUnrated", "Block unrated content"), unratedCb));

  const blockedIn = el("input", "wide");
  blockedIn.type = "text";
  blockedIn.value = (base.blockedTags || []).join(", ");
  blockedIn.placeholder = t(labels, "accessCtlTagsPlaceholder", "tag1, tag2");
  card.appendChild(row(t(labels, "accessCtlBlockedTags", "Blocked tags"), blockedIn));

  const allowedIn = el("input", "wide");
  allowedIn.type = "text";
  allowedIn.value = (base.allowedTags || []).join(", ");
  allowedIn.placeholder = t(labels, "accessCtlTagsPlaceholder", "tag1, tag2");
  card.appendChild(row(t(labels, "accessCtlAllowedTags", "Allowed tags only"), allowedIn));

  // libraries
  const allLibs = document.createElement("input");
  allLibs.type = "checkbox";
  allLibs.checked = base.enableAllFolders !== false;
  card.appendChild(row(t(labels, "accessCtlAllLibraries", "Access to all libraries"), allLibs));
  const libBox = el("div", "jms-acc-libs");
  const libChecks = [];
  const enabledSet = new Set((base.enabledFolders || []).map((s) => String(s).replace(/-/g, "").toLowerCase()));
  libraries.forEach((lib) => {
    const lab = el("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = lib.id;
    cb.checked = enabledSet.has(String(lib.id).replace(/-/g, "").toLowerCase());
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(lib.name));
    libBox.appendChild(lab);
    libChecks.push(cb);
  });
  card.appendChild(libBox);
  const syncLibs = () => { libBox.style.display = allLibs.checked ? "none" : "flex"; };
  allLibs.addEventListener("change", syncLibs);
  syncLibs();

  // unlock
  card.appendChild(el("div", "jms-acc-sub", t(labels, "accessCtlUnlockTitle", "Temporary unlock with PIN")));
  const unlockCb = document.createElement("input");
  unlockCb.type = "checkbox";
  unlockCb.checked = profile ? profile.unlockEnabled === true : false;
  card.appendChild(row(t(labels, "accessCtlUnlockEnable", "Allow unlock with the global PIN"), unlockCb));
  const minutesIn = document.createElement("input");
  minutesIn.type = "number";
  minutesIn.min = "1";
  minutesIn.max = "480";
  minutesIn.value = String(profile ? profile.unlockMinutes : 30);
  card.appendChild(row(t(labels, "accessCtlUnlockMinutes", "Unlock duration (minutes)"), minutesIn));

  let unlockModeValue = !profile || profile.unlockUseOriginal === true ? "original" : "full";
  if (profile && profile.unlockUseOriginal !== true && unlockedBase && unlockedBase.maxParentalRating !== null && unlockedBase.maxParentalRating !== undefined) {
    unlockModeValue = String(unlockedBase.maxParentalRating);
  }
  const modeSel = makeSelect(
    [
      { value: "original", text: t(labels, "accessCtlUnlockOriginal", "Back to the original permissions") },
      { value: "full", text: t(labels, "accessCtlUnlockFull", "Full access") },
      ...RATING_OPTIONS.filter((o) => o.value !== "").map((o) => ({ value: o.value, text: t(labels, o.key, o.fallback) }))
    ],
    unlockModeValue
  );
  card.appendChild(row(t(labels, "accessCtlUnlockMode", "While unlocked"), modeSel));
  if (!hasPin) {
    card.appendChild(el("div", "jms-acc-warn", t(labels, "accessCtlNoPin", "No PIN is configured yet. Set one in the PIN tab to enable the temporary unlock.")));
  }
  if (profile && profile.isUnlocked && profile.unlockedUntilUtc) {
    card.appendChild(el("div", "jms-acc-note", `${t(labels, "accessCtlUnlockedUntil", "Unlocked until")} ${new Date(profile.unlockedUntilUtc).toLocaleTimeString()}`));
  }

  const collectBase = () => ({
    maxParentalRating: base.maxParentalRating === undefined ? null : base.maxParentalRating,
    blockUnratedItems: base.blockUnratedItems || [],
    blockedTags: base.blockedTags || [],
    allowedTags: base.allowedTags || [],
    enableAllFolders: base.enableAllFolders !== false,
    enabledFolders: base.enableAllFolders !== false ? [] : (base.enabledFolders || [])
  });

  const collect = () => {
    const restricted = {
      maxParentalRating: ratingSel.value === "" ? null : Number(ratingSel.value),
      blockUnratedItems: unratedCb.checked ? allUnrated : [],
      blockedTags: splitTags(blockedIn.value),
      allowedTags: splitTags(allowedIn.value),
      enableAllFolders: allLibs.checked,
      enabledFolders: allLibs.checked ? [] : libChecks.filter((c) => c.checked).map((c) => c.value)
    };
    const unlocked = (modeSel.value === "full" || modeSel.value === "original")
      ? { maxParentalRating: null, blockUnratedItems: [], blockedTags: [], allowedTags: [], enableAllFolders: true, enabledFolders: [] }
      : { ...restricted, maxParentalRating: Number(modeSel.value), blockUnratedItems: [] };
    return {
      userId: user.userId,
      restricted,
      unlockEnabled: unlockCb.checked,
      unlockUseOriginal: modeSel.value === "original",
      unlockMinutes: Math.min(480, Math.max(1, parseInt(minutesIn.value, 10) || 30)),
      unlocked,
      apply: true
    };
  };

  tplSel.addEventListener("change", () => {
    const tpl = tpls.find((x) => x.id === tplSel.value);
    if (!tpl) return;
    const v = tpl.values;
    ratingSel.value = v.maxParentalRating === null ? "" : String(v.maxParentalRating);
    unratedCb.checked = v.blockUnratedItems.length > 0;
    blockedIn.value = v.blockedTags.join(", ");
    allowedIn.value = v.allowedTags.join(", ");
    // Modelos mudam so classificacao e tags; as bibliotecas ficam como estao.
  });

  const btns = el("div", "jms-acc-btns");
  const saveBtn = el("button", "jms-acc-btn primary", t(labels, "accessCtlSave", "Save and apply"));
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => {
    const payload = collect();
    let msg = t(labels, "accessCtlConfirmApply", "This changes the native Jellyfin permissions of this user right now. Continue?");
    if (!payload.restricted.enableAllFolders && payload.restricted.enabledFolders.length === 0) {
      msg = t(labels, "accessCtlConfirmNoLibrary", "No library is selected: this user will see NO library until unlocked. Continue?");
    } else if (!profile && JSON.stringify(payload.restricted) === JSON.stringify(collectBase())) {
      msg = t(labels, "accessCtlConfirmNoChange", "These values are the same as the user's current permissions, so nothing will be blocked yet. Continue anyway?");
    }
    if (!window.confirm(msg)) return;
    saveBtn.disabled = true;
    try {
      await saveAccessProfile(payload);
      notify(t(labels, "accessCtlSaved", "Access profile saved and applied."), "success");
      await reload();
    } catch (e) {
      notify(String(e?.message || e), "error");
      saveBtn.disabled = false;
    }
  });
  btns.appendChild(saveBtn);

  if (profile) {
    const revBtn = el("button", "jms-acc-btn", t(labels, "accessCtlRevert", "Revert to original"));
    revBtn.type = "button";
    revBtn.addEventListener("click", async () => {
      const msg = t(labels, "accessCtlConfirmRevert", "Restore the permissions this user had before the plugin changed them?");
      if (!window.confirm(msg)) return;
      revBtn.disabled = true;
      try {
        await deleteAccessProfile(user.userId);
        notify(t(labels, "accessCtlReverted", "Original permissions restored."), "success");
        await reload();
      } catch (e) {
        notify(String(e?.message || e), "error");
        revBtn.disabled = false;
      }
    });
    btns.appendChild(revBtn);
    card.appendChild(el("div", "jms-acc-note",
      `${t(labels, "accessCtlOriginal", "Original")}: ${ratingLabel(labels, profile.original ? profile.original.maxParentalRating : null)}`));
  }
  card.appendChild(btns);
  return card;
}

export function createAccessControlPanel(config, labels) {
  injectStyle();
  const panel = document.createElement("div");
  panel.id = "access-control-panel";
  panel.className = "settings-panel";

  const section = createSection(t(labels, "accessCtlTitle", "Access control (native Jellyfin permissions)"));
  section.appendChild(el("div", "jms-acc-note", t(labels, "accessCtlIntro",
    "Restrictions set here are applied to the native Jellyfin user policy, so the server enforces them on every app and device. Administrators cannot be restricted.")));
  const list = el("div");
  section.appendChild(list);
  panel.appendChild(section);

  async function reload() {
    list.textContent = t(labels, "accessCtlLoading", "Loading...");
    try {
      const data = await fetchAccessProfiles();
      list.textContent = "";
      const users = (data.users || []).filter((u) => !u.isAdmin);
      if (!users.length) {
        const diag = data.diagnostics ? ` (read: ${data.diagnostics.usersRead}, listed: ${data.diagnostics.usersListed})` : "";
        list.appendChild(el("div", "jms-acc-note", t(labels, "accessCtlNoUsers", "No non-administrator users found.") + diag));
        return;
      }
      const ctx = {
        labels,
        libraries: data.libraries || [],
        allUnrated: data.allUnratedItems || [],
        hasPin: data.hasPin === true,
        reload
      };
      users.forEach((u) => list.appendChild(buildUserCard(u, ctx)));
    } catch (e) {
      list.textContent = "";
      list.appendChild(el("div", "jms-acc-warn", String(e?.message || e)));
    }
  }

  reload();
  return panel;
}
