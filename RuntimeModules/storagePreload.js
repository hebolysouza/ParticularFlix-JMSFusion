const USER_SETTINGS_URL = "/Plugins/JMSFusion/UserSettings";
const SAVE_URL = "/Plugins/JMSFusion/UserSettings/Publish";
const SAVE_DEBOUNCE_MS = 500;

const EXPLICIT_KEYS = new Set([
  "jms:settingsTargetProfile",
  "settings.allowedTabs.v1",
  "lyricsMode",
  "lyricsOverwrite"
]);

const DENY_KEYS = new Set([
  "json-credentials",
  "api-key",
  "accessToken",
  "serverId",
  "userId",
  "deviceId",
  "sessionId",
  "jf_serverAddress",
  "jf_userId",
  "jf_api_deviceId",
  "jf_api_deviceName",
  "persist_user_id",
  "persist_device_id",
  "persist_device_name",
  "persist_server_id",
  "serverAddress",
  "currentUserIsAdmin",
  "emby.device.id",
  "emby.session.id",
  "jellyfin_credentials",
  "emby_credentials",
  "currentUserId",
  "currentUserName",
  "jf_debug_api",
  "jms:lastPlayNowDebug",
  "jms_backdrop_index",
  "userTopGenresCache",
  "userTopGenres_v2"
]);

const DENY_PREFIXES = [
  "persist_",
  "jf:",
  "emby.",
  "jms:debug:",
  "jms:trace:",
  "jms:focusedUserDataSync:",
  "jms:last",
  "jms_indexer_",
  "studioHub_",
  "avatar-"
];

const managedKeys = new Set(EXPLICIT_KEYS);
const profile = detectProfile();

let forceGlobal = false;
let rev = 0;
let state = {};
let serverSnapshotEmpty = true;
let saveTimer = null;
let savePromise = null;
let saveQueued = false;
let queuedPersistPromise = null;
let resolveQueuedPersist = null;
let rejectQueuedPersist = null;
let activePersistJson = null;
let lastPersistedJson = null;
let suspendSync = false;
let bootstrappedLocal = false;
let snapshotLoaded = false;
let lastLifecycleFlushAt = 0;

const storage = window.localStorage;
const originalGetItem = storage.getItem.bind(storage);
const originalSetItem = storage.setItem.bind(storage);
const originalRemoveItem = storage.removeItem.bind(storage);
const originalClear = storage.clear.bind(storage);

// Fork ParticularFlix: identifica o usuario Jellyfin logado para que cada perfil tenha
// o proprio snapshot de configuracoes no servidor.
function readAuthContext() {
  try {
    const raw = originalGetItem("jellyfin_credentials");
    if (!raw) return { token: "", userId: "" };
    const servers = JSON.parse(raw)?.Servers;
    if (!Array.isArray(servers)) return { token: "", userId: "" };
    const origin = window.location.origin.toLowerCase();
    const match =
      servers.find(sv => sv?.AccessToken && String(sv?.ManualAddress || sv?.LocalAddress || "").toLowerCase().startsWith(origin)) ||
      servers.find(sv => sv?.AccessToken);
    return {
      token: String(match?.AccessToken || ""),
      userId: String(match?.UserId || "").replace(/-/g, "").toLowerCase()
    };
  } catch {
    return { token: "", userId: "" };
  }
}

function buildAuthHeaders() {
  const { token, userId } = readAuthContext();
  const headers = {};
  if (token) headers["X-Emby-Token"] = token;
  if (userId) headers["X-Emby-UserId"] = userId;
  return headers;
}

let loadedUserId = null;

// Se o usuario logado mudou depois que o snapshot foi carregado (login, troca de perfil,
// logout), recarrega a pagina para carregar o snapshot certo e nunca grava o estado de
// um usuario no snapshot de outro.
function userChangedSinceLoad() {
  if (loadedUserId === null) return false;
  const current = readAuthContext().userId;
  if (current === loadedUserId) return false;
  try {
    const key = "jms:userSwitchReload";
    const last = JSON.parse(sessionStorage.getItem(key) || "null");
    const recent = last && last.to === current && (Date.now() - Number(last.at || 0)) < 15000;
    if (!recent) {
      sessionStorage.setItem(key, JSON.stringify({ to: current, at: Date.now() }));
      window.location.reload();
    }
  } catch {
    window.location.reload();
  }
  return true;
}

function detectProfile() {
  try {
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
    const small = window.matchMedia?.("(max-width: 900px)")?.matches === true;
    const uaMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return (coarse || (small && uaMobile)) ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

function isDeniedKey(key) {
  const normalized = String(key || "").trim();
  const lowered = normalized.toLowerCase();
  if (!normalized) return true;
  if (DENY_KEYS.has(normalized)) return true;
  if (DENY_PREFIXES.some(prefix => lowered.startsWith(prefix))) return true;
  if (/token|credential|session/i.test(normalized)) return true;
  return false;
}

function registerKeys(keys = []) {
  for (const key of keys) {
    const normalized = String(key || "").trim();
    if (!normalized || isDeniedKey(normalized)) continue;
    managedKeys.add(normalized);
    if (snapshotLoaded && !serverSnapshotEmpty && !Object.prototype.hasOwnProperty.call(state, normalized)) {
      suspendSync = true;
      try {
        originalRemoveItem(normalized);
      } finally {
        suspendSync = false;
      }
    }
  }
}

function shouldPersistKey(key) {
  const normalized = String(key || "").trim();
  if (!normalized || isDeniedKey(normalized)) return false;
  return managedKeys.has(normalized);
}

function normalizeValueForStorage(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return String(value);
}

function normalizeSnapshot(source) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (isDeniedKey(key)) continue;
    const normalizedValue = normalizeValueForStorage(value);
    if (normalizedValue === null) continue;
    out[key] = normalizedValue;
  }
  return out;
}

function serializeSnapshot(snapshot) {
  return JSON.stringify(normalizeSnapshot(snapshot));
}

function getQueuedPersistPromise() {
  if (!queuedPersistPromise) {
    queuedPersistPromise = new Promise((resolve, reject) => {
      resolveQueuedPersist = resolve;
      rejectQueuedPersist = reject;
    });
  }
  return queuedPersistPromise;
}

function applySnapshotToStorage(snapshot) {
  registerKeys(Object.keys(snapshot || {}));
  suspendSync = true;
  try {
    for (const [key, value] of Object.entries(snapshot || {})) {
      if (!shouldPersistKey(key)) continue;
      originalSetItem(key, value);
    }
  } finally {
    suspendSync = false;
  }
}

function buildSnapshotFromStorage() {
  const out = {};
  for (const key of managedKeys) {
    if (!shouldPersistKey(key)) continue;
    const raw = originalGetItem(key);
    if (raw !== null) {
      out[key] = raw;
    }
  }
  return out;
}

async function persistSnapshot(snapshot, options = {}) {
  if (userChangedSinceLoad()) {
    return { ok: true, skipped: true, reason: "user-changed", profile, rev };
  }
  const payload = normalizeSnapshot(snapshot);
  const payloadJson = JSON.stringify(payload);
  state = payload;
  serverSnapshotEmpty = Object.keys(payload).length === 0;

  if (savePromise) {
    if (payloadJson === activePersistJson) {
      return savePromise;
    }
    saveQueued = true;
    return getQueuedPersistPromise();
  }

  if (payloadJson === lastPersistedJson) {
    return { ok: true, skipped: true, profile, rev };
  }

  const requestInit = {
    keepalive: options?.keepalive === true,
    method: "POST",
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify({
      global: payload,
      profile
    })
  };

  activePersistJson = payloadJson;
  savePromise = fetch(`${SAVE_URL}?profile=${encodeURIComponent(profile)}&ts=${Date.now()}`, requestInit).then(async response => {
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(raw || `UserSettings publish HTTP ${response.status}`);
    }
    return response.json().catch(() => ({}));
  }).then(result => {
    rev = Number(result?.rev || rev || 0);
    bridge.bootstrapOverride = { forceGlobal, global: payload, rev, profile };
    lastPersistedJson = payloadJson;
    return result;
  }).catch(error => {
    console.warn("[JMSFusion] Managed storage persist failed:", error);
    throw error;
  }).finally(() => {
    const runQueued = saveQueued;
    const queuedResolve = resolveQueuedPersist;
    const queuedReject = rejectQueuedPersist;
    saveQueued = false;
    queuedPersistPromise = null;
    resolveQueuedPersist = null;
    rejectQueuedPersist = null;
    savePromise = null;
    activePersistJson = null;
    if (runQueued) {
      persistSnapshot(buildSnapshotFromStorage()).then(
        result => queuedResolve?.(result),
        error => queuedReject?.(error)
      );
    }
  });

  return savePromise;
}

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistSnapshot(buildSnapshotFromStorage());
  }, SAVE_DEBOUNCE_MS);
}

function flushPendingSnapshotOnPageLifecycle() {
  if (!snapshotLoaded) return;
  if (saveTimer == null && !savePromise) return;

  const now = Date.now();
  if ((now - lastLifecycleFlushAt) < 1000) return;
  lastLifecycleFlushAt = now;

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  void persistSnapshot(buildSnapshotFromStorage(), { keepalive: true });
}

function patchLocalStorage() {
  storage.setItem = function patchedSetItem(key, value) {
    const normalizedKey = String(key || "");
    const normalizedValue = String(value);
    const previousValue = originalGetItem(normalizedKey);
    originalSetItem(normalizedKey, normalizedValue);
    if (previousValue === normalizedValue) return;
    if (suspendSync) return;
    if (!shouldPersistKey(normalizedKey)) return;
    state[normalizedKey] = normalizedValue;
    schedulePersist();
  };

  storage.removeItem = function patchedRemoveItem(key) {
    const normalizedKey = String(key || "");
    const previousValue = originalGetItem(normalizedKey);
    originalRemoveItem(normalizedKey);
    if (previousValue === null) return;
    if (suspendSync) return;
    if (!shouldPersistKey(normalizedKey)) return;
    delete state[normalizedKey];
    schedulePersist();
  };

  storage.clear = function patchedClear() {
    originalClear();
    if (suspendSync) return;
    let changed = false;
    for (const key of [...managedKeys]) {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        delete state[key];
        changed = true;
      }
    }
    if (changed) schedulePersist();
  };
}

async function loadServerSnapshot() {
  loadedUserId = readAuthContext().userId;
  try {
    const payload = await loadSharedUserSettingsSnapshot(profile);
    forceGlobal = payload?.forceGlobal === true;
    rev = Number(payload?.rev || 0);

    const snapshot = normalizeSnapshot(payload?.global || {});
    state = snapshot;
    serverSnapshotEmpty = Object.keys(snapshot).length === 0;
    lastPersistedJson = serializeSnapshot(snapshot);
    applySnapshotToStorage(snapshot);
    bridge.bootstrapOverride = { forceGlobal, global: snapshot, rev, profile };
  } catch (error) {
    console.warn("[JMSFusion] Managed storage preload failed:", error);
    bridge.bootstrapOverride = { forceGlobal: false, global: {}, rev: 0, profile };
  } finally {
    snapshotLoaded = true;
  }
}

function loadSharedUserSettingsSnapshot(targetProfile) {
  const cleanProfile = String(targetProfile || "desktop").trim() || "desktop";
  const existingSnapshot = window.__JMS_USER_SETTINGS_SNAPSHOT__;
  if (existingSnapshot?.profile === cleanProfile && existingSnapshot?.payload) {
    return Promise.resolve(existingSnapshot.payload);
  }

  const existingPromise = window.__JMS_USER_SETTINGS_PROMISE__;
  if (existingPromise?.profile === cleanProfile && existingPromise?.promise) {
    return existingPromise.promise;
  }

  const promise = fetch(`${USER_SETTINGS_URL}?profile=${encodeURIComponent(cleanProfile)}&ts=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      ...buildAuthHeaders()
    }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`UserSettings HTTP ${response.status}`);
      }
      return response.json().catch(() => ({}));
    })
    .then((payload) => {
      window.__JMS_USER_SETTINGS_SNAPSHOT__ = {
        profile: cleanProfile,
        payload: payload || {},
        at: Date.now()
      };
      return payload || {};
    })
    .finally(() => {
      if (window.__JMS_USER_SETTINGS_PROMISE__?.promise === promise) {
        window.__JMS_USER_SETTINGS_PROMISE__ = null;
      }
    });

  window.__JMS_USER_SETTINGS_PROMISE__ = {
    profile: cleanProfile,
    promise
  };
  return promise;
}

const bridge = {
  bootstrapOverride: { forceGlobal: false, global: {}, rev: 0, profile },
  registerKeys,
  maybeBootstrapFromLocal(snapshot) {
    if (!serverSnapshotEmpty || bootstrappedLocal) return;
    const normalized = normalizeSnapshot(snapshot);
    if (!Object.keys(normalized).length) return;
    bootstrappedLocal = true;
    registerKeys(Object.keys(normalized));
    state = normalized;
    schedulePersist();
  },
  async flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await persistSnapshot(buildSnapshotFromStorage());
  },
  get profile() {
    return profile;
  },
  get forceGlobal() {
    return forceGlobal;
  },
  get serverSnapshotEmpty() {
    return serverSnapshotEmpty;
  },
  get state() {
    return { ...state };
  }
};

window.__JMS_MANAGED_STORAGE__ = bridge;
patchLocalStorage();
window.addEventListener("pagehide", flushPendingSnapshotOnPageLifecycle, { capture: true });
window.addEventListener("beforeunload", flushPendingSnapshotOnPageLifecycle, { capture: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushPendingSnapshotOnPageLifecycle();
  }
});
await loadServerSnapshot();
