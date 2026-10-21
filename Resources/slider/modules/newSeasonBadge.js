// Fork ParticularFlix: selo "Nova temporada" no chip de tipo do slide ("Serie (2 Temporadas)").
// Quando a temporada mais recente (numero 2 ou maior, fora especiais) estreou ha poucos dias,
// o chip troca de "Serie (N Temporadas)" para "Nova temporada". Series antigas nao mudam.
//
// Chaves opcionais no localStorage (sem tela de configuracao):
//   showNewSeasonBadge = "false"  desliga o selo
//   newSeasonBadgeDays = numero   janela em dias (padrao 60)
import { getSessionInfo, makeApiRequest } from "../../Plugins/JMSFusion/runtime/api.js";

const DEFAULT_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = "jms:newSeasonInfo:v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const MAX_PARALLEL = 3;

const memory = new Map();
const inFlight = new Map();
const waiting = [];
let running = 0;
let styleAdded = false;

function readFlag() {
  try {
    return localStorage.getItem("showNewSeasonBadge") !== "false";
  } catch {
    return true;
  }
}

function readDays() {
  try {
    const n = Number(localStorage.getItem("newSeasonBadgeDays"));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : DEFAULT_DAYS;
  } catch {
    return DEFAULT_DAYS;
  }
}

function loadStored() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveStored(obj) {
  try {
    const keys = Object.keys(obj);
    if (keys.length > MAX_CACHE_ENTRIES) {
      keys
        .sort((a, b) => (obj[a]?.at || 0) - (obj[b]?.at || 0))
        .slice(0, keys.length - MAX_CACHE_ENTRIES)
        .forEach((k) => delete obj[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {}
}

// Funcao pura (testavel): recebe a lista de temporadas e devolve { isNew, seasonNumber, premiere }.
export function pickNewSeason(seasons, now = Date.now(), days = DEFAULT_DAYS) {
  let latest = null;
  (Array.isArray(seasons) ? seasons : []).forEach((s) => {
    const n = Number(s?.IndexNumber);
    if (!Number.isFinite(n) || n <= 0) return; // ignora especiais
    if (!latest || n > latest.n) latest = { n, premiere: s?.PremiereDate || null };
  });
  if (!latest) return { isNew: false, seasonNumber: null, premiere: null };
  const t = latest.premiere ? Date.parse(latest.premiere) : NaN;
  const isNew =
    latest.n >= 2 &&
    Number.isFinite(t) &&
    t <= now &&
    now - t <= days * DAY_MS;
  return { isNew, seasonNumber: latest.n, premiere: latest.premiere };
}

function schedule(task) {
  return new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  while (running < MAX_PARALLEL && waiting.length) {
    const job = waiting.shift();
    running++;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        running--;
        pump();
      });
  }
}

async function fetchSeasons(seriesId) {
  const { userId } = getSessionInfo() || {};
  const qs = new URLSearchParams({ Fields: "PremiereDate" });
  if (userId) qs.set("UserId", userId);
  const res = await makeApiRequest(`/Shows/${encodeURIComponent(seriesId)}/Seasons?${qs.toString()}`);
  return res?.Items || [];
}

export async function resolveNewSeasonInfo(item, { now = Date.now() } = {}) {
  const id = item?.Id;
  if (!id || item?.Type !== "Series") return null;
  const days = readDays();

  const mem = memory.get(id);
  if (mem && now - mem.at < CACHE_TTL_MS && mem.days === days) return mem;

  const stored = loadStored()[id];
  if (stored && now - stored.at < CACHE_TTL_MS && stored.days === days) {
    memory.set(id, stored);
    return stored;
  }

  if (inFlight.has(id)) return inFlight.get(id);

  const p = schedule(async () => {
    const seasons = await fetchSeasons(id);
    const r = pickNewSeason(seasons, now, days);
    const entry = { isNew: r.isNew, seasonNumber: r.seasonNumber, days, at: now };
    memory.set(id, entry);
    const all = loadStored();
    all[id] = entry;
    saveStored(all);
    return entry;
  })
    .catch(() => null)
    .finally(() => inFlight.delete(id));

  inFlight.set(id, p);
  return p;
}

function ensureStyle() {
  if (styleAdded) return;
  styleAdded = true;
  try {
    const st = document.createElement("style");
    st.id = "jms-new-season-badge-style";
    st.textContent =
      ".monwui-format-container .type.monwui-type-newseason{background:#e50914!important;color:#fff!important}" +
      ".monwui-format-container .type.monwui-type-newseason i,.monwui-format-container .type.monwui-type-newseason .monwui-type-text{color:#fff!important}";
    document.head.appendChild(st);
  } catch {}
}

// Troca o texto do chip depois que a resposta chega (a criacao do slide nao espera a rede).
export function applyNewSeasonBadge(formatContainer, item, labels = {}) {
  try {
    if (!formatContainer || item?.Type !== "Series" || !readFlag()) return;
    resolveNewSeasonInfo(item).then((info) => {
      if (!info?.isNew) return;
      const type = formatContainer.querySelector(".type");
      const text = formatContainer.querySelector(".monwui-type-text");
      if (!type || !text) return;
      ensureStyle();
      text.textContent = labels.newSeason || "Nova temporada";
      type.classList.add("monwui-type-newseason");
      if (info.seasonNumber) type.title = `${labels.season || "Temporada"} ${info.seasonNumber}`;
    });
  } catch {}
}
