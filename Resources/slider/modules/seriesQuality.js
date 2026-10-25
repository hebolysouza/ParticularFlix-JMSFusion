// Fork ParticularFlix: badges de qualidade (resolucao, HDR, codec, audio) tambem nas series.
// Uma serie nao tem MediaStreams; usamos o primeiro episodio regular como referencia.
// A busca roda depois do slide aparecer (nao atrasa nada), com cache de 7 dias e no maximo 3 pedidos paralelos.
//
// Interruptor de emergencia: localStorage.setItem("pf:seriesQuality", "off") e recarregar.
import { getSessionInfo, makeApiRequest } from "../../Plugins/JMSFusion/runtime/api.js";
import { getVideoQualityText } from "./containerUtils.js";

const CACHE_KEY = "pf:seriesQuality:v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 400;
const MAX_PARALLEL = 3;

const memory = new Map();
const inFlight = new Map();
const waiting = [];
let running = 0;

function enabled() {
  try {
    return localStorage.getItem("pf:seriesQuality") !== "off";
  } catch {
    return true;
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

// Funcao pura (testavel): escolhe o episodio de referencia (primeiro regular; senao o primeiro que houver).
export function pickReferenceEpisode(episodes) {
  const list = Array.isArray(episodes) ? episodes.filter((e) => Array.isArray(e?.MediaStreams) && e.MediaStreams.length) : [];
  if (!list.length) return null;
  return list.find((e) => Number(e?.ParentIndexNumber) > 0) || list[0];
}

// Funcao pura (testavel): guarda so o que o badge precisa (1 video + 1 audio padrao).
export function compactStreams(streams) {
  const list = Array.isArray(streams) ? streams : [];
  const video = list.find((s) => s?.Type === "Video");
  const audios = list.filter((s) => s?.Type === "Audio");
  const audio = audios.find((s) => s?.IsDefault) || audios[0];
  const out = [];
  if (video) {
    out.push({
      Type: "Video",
      Width: video.Width,
      Height: video.Height,
      Codec: video.Codec,
      VideoRangeType: video.VideoRangeType,
      BitDepth: video.BitDepth
    });
  }
  if (audio) {
    out.push({
      Type: "Audio",
      Codec: audio.Codec,
      Channels: audio.Channels,
      ChannelLayout: audio.ChannelLayout,
      Profile: audio.Profile,
      DisplayTitle: audio.DisplayTitle,
      IsDefault: true,
      Index: audio.Index
    });
  }
  return out;
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

async function fetchEpisodes(seriesId) {
  const { userId } = getSessionInfo() || {};
  const qs = new URLSearchParams({
    ParentId: seriesId,
    Recursive: "true",
    IncludeItemTypes: "Episode",
    SortBy: "ParentIndexNumber,IndexNumber",
    SortOrder: "Ascending",
    Limit: "4",
    Fields: "MediaStreams",
    EnableImages: "false",
    EnableUserData: "false"
  });
  const base = userId ? `/Users/${encodeURIComponent(userId)}/Items` : "/Items";
  const res = await makeApiRequest(`${base}?${qs.toString()}`);
  return res?.Items || [];
}

export async function resolveSeriesStreams(seriesId, { now = Date.now() } = {}) {
  const id = String(seriesId || "").trim();
  if (!id) return null;

  const mem = memory.get(id);
  if (mem && now - mem.at < CACHE_TTL_MS) return mem.s;

  const stored = loadStored()[id];
  if (stored && now - stored.at < CACHE_TTL_MS) {
    memory.set(id, stored);
    return stored.s;
  }

  if (inFlight.has(id)) return inFlight.get(id);

  const p = schedule(async () => {
    const ep = pickReferenceEpisode(await fetchEpisodes(id));
    const s = ep ? compactStreams(ep.MediaStreams) : [];
    const entry = { s, at: now };
    memory.set(id, entry);
    const all = loadStored();
    all[id] = entry;
    saveStored(all);
    return s;
  })
    .catch(() => null)
    .finally(() => inFlight.delete(id));

  inFlight.set(id, p);
  return p;
}

// Acrescenta o grupo de badges ao lado do chip "Serie (N Temporadas)", como nos filmes.
export async function applySeriesQualityBadges(formatContainer, item, config) {
  try {
    if (!formatContainer || item?.Type !== "Series" || !config?.showQualityInfo || !enabled()) return;
    if (formatContainer.querySelector(".video-quality")) return;
    const streams = await resolveSeriesStreams(item.Id);
    if (!streams || !streams.length || !formatContainer.isConnected) return;
    const video = streams.find((s) => s.Type === "Video");
    if (!video) return;
    const html = getVideoQualityText(video, streams);
    if (!html) return;
    const span = document.createElement("span");
    span.className = "video-quality";
    span.innerHTML = html;
    if (!formatContainer.querySelector(".video-quality")) formatContainer.appendChild(span);
  } catch {}
}
