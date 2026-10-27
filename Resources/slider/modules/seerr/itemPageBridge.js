import { fetchItemDetailsFull, getSessionInfo, makeApiRequest } from "../../../Plugins/JMSFusion/runtime/api.js";
import { getConfig } from "../config.js";
import { withServer } from "../jfUrl.js";
import { getEffectiveLanguage, getLanguageLabels } from "../../language/index.js";
import { showNotification } from "../player/ui/notification.js";
import { requestMovieFromArr, requestSingleEpisodeFromArr } from "../arr/requestFallback.js";
import {
  createSerrRequest,
  getSerrAccess,
  getSerrCollectionDetails,
  getSerrMovieDetails,
  getSerrTvDetails,
  getSerrTvSeasonDetails,
  listSerrRequests,
  searchJellyfinByTmdbId
} from "./api.js";
import { ensureSerrStyles } from "./styles.js";

let booted = false;
let observer = null;
let scanTimer = 0;
let pollTimer = 0;
let activeKey = "";
let activeItemId = "";
let activeAbort = null;
let loadingKey = "";
let lastPlan = null;
let requestStateCache = null;
let requestStateCacheAt = 0;
const localTmdbAvailabilityCache = new Map();
const EPISODE_FIELDS = "Id,Name,OriginalTitle,IndexNumber,ParentIndexNumber,SeasonId,SeriesId,UserData,LocationType,ProviderIds,PremiereDate,Path,MediaSources,RunTimeTicks";
const COLLECTION_FIELDS = "Id,Name,OriginalTitle,ProviderIds,ProductionYear,PremiereDate,LocationType,Path,MediaSources,RunTimeTicks,ImageTags,PrimaryImageAspectRatio,UserData";
const SERR_IMAGE_BASE = "https://image.tmdb.org/t/p";
const SYNTHETIC_PREFIX = "monwui-serr-missing";
const REQUEST_STATE_CACHE_MS = 15_000;

function cfg() {
  try { return getConfig?.() || {}; } catch { return {}; }
}

function labels() {
  try {
    const activeLabels = getLanguageLabels?.(getEffectiveLanguage?.()) || {};
    if (Object.keys(activeLabels).length) return activeLabels;
  } catch {}
  return cfg()?.languageLabels || {};
}

function L(key, fallback) {
  const value = labels()?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[m]));
}

function providerId(item, ...keys) {
  const ids = item?.ProviderIds || item?.providerIds || {};
  for (const key of keys) {
    const value =
      item?.[key] ??
      ids?.[key] ??
      ids?.[key?.toUpperCase?.()] ??
      ids?.[key?.toLowerCase?.()];
    const clean = text(value);
    if (clean) return clean;
  }
  return "";
}

function tmdbId(item) {
  const direct = Number(item?.__tmdbId || item?.tmdbId || item?.TmdbId || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const id = Number(providerId(item, "Tmdb", "TMDb", "tmdb", "MovieDb", "TheMovieDb", "TmdbCollection"));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function tvdbId(item) {
  const id = Number(providerId(item, "Tvdb", "TVDB", "tvdb"));
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function serrLanguage(access = null) {
  return text(access?.settings?.defaultLanguage || cfg()?.serrDefaultLanguage || cfg()?.defaultLanguage, "");
}

function accessHasSerr(access) {
  return access?.serrEnabled !== false && access?.enabled === true;
}

function access4KEnabled(access) {
  return access?.settings?.enable4KRequests === true;
}

function moduleEnabled() {
  return cfg()?.enableSerrArrIntegrationModule !== false;
}

function accessCanHandleDetails(access, type = "") {
  const clean = text(type).toLowerCase();
  if (accessHasSerr(access)) return true;
  if (clean === "boxset") return access?.arrRadarrEnabled === true;
  if (clean === "movie") return access?.arrRadarrEnabled === true;
  if (["series", "season", "episode"].includes(clean)) return access?.arrSonarrEnabled === true;
  return false;
}

function readFirst(source, ...keys) {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keys) {
    if (!key) continue;
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function readArray(source, ...keys) {
  for (const key of keys) {
    const value = readFirst(source, key);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function readNumber(source, ...keys) {
  const value = readFirst(source, ...keys);
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function readBool(source, ...keys) {
  const value = readFirst(source, ...keys);
  if (value === true || value === false) return value;
  const clean = text(value).toLowerCase();
  return clean === "true" || clean === "1";
}

function readYear(source, ...keys) {
  for (const key of keys) {
    const value = text(readFirst(source, key));
    if (value.length >= 4) {
      const year = Number(value.slice(0, 4));
      if (Number.isFinite(year) && year > 1800) return year;
    }
  }
  return NaN;
}

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function imageUrl(path, size = "w300") {
  const clean = text(path);
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^\/(?:Items|Users|Videos|web|Plugins)\//i.test(clean)) return withServer(clean);
  return `${SERR_IMAGE_BASE}/${size}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

function buildJellyfinPrimaryImageUrl(itemId, tag = "", maxHeight = 420) {
  const cleanId = text(itemId);
  if (!cleanId) return "";
  const qs = new URLSearchParams();
  qs.set("quality", "88");
  qs.set("maxHeight", String(maxHeight));
  if (tag) qs.set("tag", tag);
  return withServer(`/Items/${encodeURIComponent(cleanId)}/Images/Primary?${qs.toString()}`);
}

function jellyfinPrimaryImageUrl(item, maxHeight = 420) {
  const tags = item?.ImageTags || item?.imageTags || {};
  const primaryTag = text(item?.PrimaryImageTag || item?.primaryImageTag || tags?.Primary || tags?.primary);
  const itemId = text(item?.Id || item?.id);
  const hasPrimary = primaryTag || item?.HasPrimaryImage === true || item?.hasPrimaryImage === true;
  if (itemId && hasPrimary) return buildJellyfinPrimaryImageUrl(itemId, primaryTag, maxHeight);

  const series = item?.Series || item?.series || {};
  const seriesTag = text(item?.SeriesPrimaryImageTag || item?.seriesPrimaryImageTag || series?.PrimaryImageTag || series?.ImageTags?.Primary);
  const seriesId = text(item?.SeriesId || item?.seriesId || series?.Id || series?.id);
  if (seriesId && seriesTag) return buildJellyfinPrimaryImageUrl(seriesId, seriesTag, maxHeight);

  const parentTag = text(item?.ParentPrimaryImageTag || item?.parentPrimaryImageTag);
  const parentId = text(item?.ParentPrimaryImageItemId || item?.parentPrimaryImageItemId || item?.ParentId || item?.parentId);
  if (parentId && parentTag) return buildJellyfinPrimaryImageUrl(parentId, parentTag, maxHeight);

  return "";
}

function notify(message, type = "info") {
  const clean = text(message);
  if (!clean) return;
  try {
    showNotification(`<i class="fas fa-clapperboard" style="margin-right:8px;"></i>${escapeHtml(clean)}`, 3200, type);
  } catch {
    window.showMessage?.(clean, type === "error" ? "error" : "success");
  }
}

function statusLabel(status) {
  switch (text(status).toLowerCase()) {
    case "pending": return L("serrStatusPending", "Onay bekliyor");
    case "approved": return L("serrStatusApproved", "Onaylandı");
    case "processing": return L("serrStatusProcessing", "İşleniyor");
    case "completed":
    case "available": return L("serrStatusCompleted", "Tamamlandı");
    case "declined": return L("serrStatusDeclined", "Reddedildi");
    case "failed": return L("serrStatusFailed", "Hatalı");
    case "withdrawn": return L("serrStatusWithdrawn", "Geri çekildi");
    default: return L("serrStatusApproved", "Onaylandı");
  }
}

function lowerStatusLabel(status) {
  const label = statusLabel(status);
  try { return label.toLocaleLowerCase("tr-TR"); } catch { return label.toLowerCase(); }
}

function statusMessage(result) {
  if (result?.ok !== false && (result?.backend === "arr" || result?.service === "radarr" || result?.service === "sonarr")) {
    return arrStatusMessage(result);
  }
  if (result?.duplicate) {
    const status = lowerStatusLabel(result?.duplicateStatus || result?.request?.Status || result?.request?.status);
    const own = result?.duplicateOwnedByCurrentUser === true;
    const fallback = own
      ? "Bu istek zaten sizin tarafınızdan oluşturuldu ve {status}."
      : "Bu istek başka bir kullanıcı tarafından oluşturuldu ve {status}.";
    return L(own ? "serrDuplicateOwnRequest" : "serrDuplicateOtherRequest", fallback).replace("{status}", status);
  }
  if (result?.pendingApproval) return L("serrRequestPendingToast", "İstek yönetici onayına gönderildi.");
  if (result?.request?.episodeOnly || result?.request?.EpisodeOnly) return L("serrRequestCreatedToast", "İstek oluşturuldu.");
  return L("serrRequestApprovedToast", "İstek Seerr'e gönderildi.");
}

function statusType(result) {
  return result?.duplicate || result?.ok === false ? "error" : "success";
}

function requestErrorMessage(error, fallback = L("serrRequestFailed", "Seerr isteği oluşturulamadı.")) {
  const code = text(error?.payload?.code || error?.payload?.errorCode);
  const message = text(error?.message || error?.payload?.error);
  if (code === "serrAlreadyAvailable" || code === "already_available" || /already available in jellyfin/i.test(message)) {
    return L("serrAlreadyAvailable", "Bu içerik Jellyfin'de zaten mevcut.");
  }
  return message || fallback;
}

function isJellyfinAlreadyAvailableError(error) {
  const code = text(error?.payload?.code || error?.payload?.errorCode);
  const message = text(error?.message || error?.payload?.error);
  return code === "serrAlreadyAvailable" || /already available in jellyfin/i.test(message);
}

function arrStatusMessage(result) {
  if (result?.service === "sonarr") return L("arrEpisodeRequestSent", "Bölüm isteği Sonarr'a gönderildi.");
  if (result?.service === "radarr") return L("arrMovieRequestSent", "Film isteği Radarr'a gönderildi.");
  return L("arrRequestSent", "Arr isteği gönderildi.");
}

function hasSerrRequestId(result) {
  const request = result?.request || result?.Request || {};
  const id = request?.SerrRequestId ?? request?.serrRequestId;
  return Number(id) > 0;
}

function shouldFallbackEpisodeToArr(result) {
  if (result?.backend === "arr" || result?.service === "radarr" || result?.service === "sonarr") return false;
  if (result?.duplicate) return false;
  if (result?.pendingApproval) return false;
  if (result?.ok === false) return true;
  const request = result?.request || result?.Request || {};
  const episodeOnly = request?.episodeOnly === true || request?.EpisodeOnly === true;
  return episodeOnly && !hasSerrRequestId(result);
}

function shouldFallbackMovieToArr(result) {
  if (result?.backend === "arr" || result?.service === "radarr" || result?.service === "sonarr") return false;
  if (result?.pendingApproval) return false;
  if (result?.ok === false) return true;

  const request = result?.request || result?.Request || {};
  const mediaType = text(request?.MediaType || request?.mediaType).toLowerCase();
  if (mediaType && mediaType !== "movie") return false;

  const status = text(result?.duplicateStatus || request?.Status || request?.status).toLowerCase();
  return result?.duplicate === true && (status === "completed" || status === "available");
}

async function requestMovieFallbackFromArr(movie, options = {}) {
  const result = await requestMovieFromArr(movie, options);
  notify(arrStatusMessage(result), "success");
  return result;
}

function emptyRequestState() {
  return {
    movieIds: new Set(),
    tvById: new Map()
  };
}

function isActiveRequestStatus(status) {
  const clean = text(status).toLowerCase();
  return clean !== "completed" &&
    clean !== "available" &&
    clean !== "declined" &&
    clean !== "failed" &&
    clean !== "withdrawn";
}

function tvRequestBucket(state, mediaId) {
  if (!state.tvById.has(mediaId)) {
    state.tvById.set(mediaId, {
      all: false,
      seasons: new Set(),
      episodes: new Set()
    });
  }
  return state.tvById.get(mediaId);
}

function buildRequestState(requests) {
  const state = emptyRequestState();
  for (const req of Array.isArray(requests) ? requests : []) {
    if (!isActiveRequestStatus(readFirst(req, "Status", "status"))) continue;
    const mediaType = text(readFirst(req, "MediaType", "mediaType")).toLowerCase();
    const mediaId = readNumber(req, "MediaId", "mediaId");
    if (!Number.isFinite(mediaId) || mediaId <= 0) continue;

    if (mediaType === "movie") {
      state.movieIds.add(mediaId);
      continue;
    }

    if (mediaType !== "tv") continue;
    const bucket = tvRequestBucket(state, mediaId);
    if (readBool(req, "RequestAllSeasons", "requestAllSeasons")) {
      bucket.all = true;
    }
    for (const season of readArray(req, "seasons", "Seasons")) {
      const n = Number.isFinite(Number(season))
        ? Number(season)
        : readNumber(season, "SeasonNumber", "seasonNumber", "IndexNumber", "indexNumber", "number");
      if (Number.isFinite(n) && n >= 0) bucket.seasons.add(n);
    }
    for (const episode of readArray(req, "episodes", "Episodes")) {
      const seasonNumber = readNumber(episode, "SeasonNumber", "seasonNumber");
      const episodeNumber = readNumber(episode, "EpisodeNumber", "episodeNumber");
      if (!Number.isFinite(seasonNumber) || seasonNumber < 0) continue;
      if (Number.isFinite(episodeNumber) && episodeNumber >= 0) {
        bucket.episodes.add(`${seasonNumber}:${episodeNumber}`);
      }
    }
  }
  return state;
}

function invalidateRequestState() {
  requestStateCache = null;
  requestStateCacheAt = 0;
}

async function getRequestState({ force = false } = {}) {
  const now = Date.now();
  if (!force && requestStateCache && (now - requestStateCacheAt) < REQUEST_STATE_CACHE_MS) {
    return requestStateCache;
  }
  const data = await listSerrRequests({ includeHistory: false, includeDownloads: false }).catch(() => null);
  requestStateCache = buildRequestState(data?.requests || data?.Requests || []);
  requestStateCacheAt = Date.now();
  return requestStateCache;
}

function planRequestState(plan) {
  return plan?.requestState || emptyRequestState();
}

function isMovieRequested(plan, movie) {
  const mediaId = tmdbId(movie);
  return mediaId > 0 && planRequestState(plan).movieIds.has(mediaId);
}

function isSeasonRequested(plan, season) {
  const mediaId = tmdbId(plan?.seriesItem || {});
  const seasonNumber = Number(season?.IndexNumber);
  const bucket = mediaId > 0 ? planRequestState(plan).tvById.get(mediaId) : null;
  return !!bucket &&
    Number.isFinite(seasonNumber) &&
    seasonNumber >= 0 &&
    (bucket.all || bucket.seasons.has(seasonNumber));
}

function isEpisodeRequested(plan, episode) {
  const mediaId = tmdbId(plan?.seriesItem || {});
  const seasonNumber = Number(episode?.ParentIndexNumber);
  const episodeNumber = Number(episode?.IndexNumber);
  const bucket = mediaId > 0 ? planRequestState(plan).tvById.get(mediaId) : null;
  if (!bucket || !Number.isFinite(seasonNumber) || seasonNumber < 0) return false;
  return bucket.all ||
    bucket.seasons.has(seasonNumber) ||
    (Number.isFinite(episodeNumber) && bucket.episodes.has(`${seasonNumber}:${episodeNumber}`));
}

function isSyntheticRequested(item, requestState = null) {
  if (!isSerrMissingSyntheticItem(item)) return false;
  if (item.__monwuiSerrRequested === true) return true;

  const state = requestState || emptyRequestState();
  const type = text(item.__monwuiSerrMissingType);
  if (type === "movie") {
    return isMovieRequested({ requestState: state }, item);
  }

  const seriesItem = item.__monwuiSerrSeriesItem || {};
  const plan = { requestState: state, seriesItem };
  if (type === "season") return isSeasonRequested(plan, item);
  if (type === "episode") return isEpisodeRequested(plan, item);
  return false;
}

function withSyntheticRequestState(items = [], requestState = null) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const requested = isSyntheticRequested(item, requestState);
    return requested ? { ...item, __monwuiSerrRequested: true } : item;
  });
}

function markButtonRequested(button, title = L("serrStatusRequested", "İstendi")) {
  if (!button) return;
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("title", title);
  button.setAttribute("aria-label", title);
  button.innerHTML = `<span class="material-icons check" aria-hidden="true"></span>`;
  const host = button.closest?.(".monwui-serr-missing-card, .monwui-serr-missing-listitem");
  host?.setAttribute?.("data-serr-requested", "1");
  host?.classList?.add?.("monwui-serr-requested");
}

function isAlreadyRequestedNode(node, button) {
  return button?.disabled === true || node?.getAttribute?.("data-serr-requested") === "1";
}

function serrMissingPosterPath(item) {
  return text(item?.PosterPath || item?.posterPath || item?.StillPath || item?.stillPath);
}

function toSerrMissingMovieItem(movie) {
  const mediaId = tmdbId(movie);
  return {
    ...movie,
    Id: `${SYNTHETIC_PREFIX}:movie:${mediaId || normalizeKey(movie?.Name)}`,
    Type: "Movie",
    MediaType: "Video",
    ProviderIds: { ...(movie?.ProviderIds || {}), Tmdb: mediaId ? String(mediaId) : undefined },
    __tmdbId: mediaId,
    __monwuiSerrMissing: true,
    __monwuiSerrMissingType: "movie",
    __monwuiSerrPosterPath: serrMissingPosterPath(movie)
  };
}

function toSerrMissingSeasonItem(season, seriesItem) {
  const seasonNumber = Number(season?.IndexNumber);
  return {
    ...season,
    Id: `${SYNTHETIC_PREFIX}:season:${tmdbId(seriesItem)}:${Number.isFinite(seasonNumber) ? seasonNumber : "x"}`,
    Type: "Season",
    SeriesId: text(seriesItem?.Id),
    ProviderIds: { ...(season?.ProviderIds || {}) },
    __monwuiSerrMissing: true,
    __monwuiSerrMissingType: "season",
    __monwuiSerrSeriesItem: seriesItem,
    __monwuiSerrPosterPath: serrMissingPosterPath(season)
  };
}

function toSerrMissingEpisodeItem(episode, seriesItem) {
  const seasonNumber = Number(episode?.ParentIndexNumber);
  const episodeNumber = Number(episode?.IndexNumber);
  return {
    ...episode,
    Id: `${SYNTHETIC_PREFIX}:episode:${tmdbId(seriesItem)}:${Number.isFinite(seasonNumber) ? seasonNumber : "x"}:${Number.isFinite(episodeNumber) ? episodeNumber : "x"}`,
    Type: "Episode",
    MediaType: "Video",
    SeriesId: text(seriesItem?.Id),
    __monwuiSerrMissing: true,
    __monwuiSerrMissingType: "episode",
    __monwuiSerrSeriesItem: seriesItem,
    __monwuiSerrPosterPath: serrMissingPosterPath(episode)
  };
}

export function isSerrMissingSyntheticItem(item) {
  return item?.__monwuiSerrMissing === true;
}

export function isSerrMissingSyntheticItemRequested(item) {
  return item?.__monwuiSerrRequested === true;
}

export function getSerrMissingSyntheticPosterUrl(item, size = "w342") {
  return imageUrl(item?.__monwuiSerrPosterPath, size);
}

export async function getSerrMissingSyntheticItems(containerItem, localItems = [], { mode = "", seriesItem = null, signal } = {}) {
  if (!moduleEnabled()) return [];
  const access = await getSerrAccess().catch(() => null);
  if (!access?.enabled) return [];

  const resolvedMode = text(mode).toLowerCase() || (() => {
    const type = text(containerItem?.Type || containerItem?.itemType).toLowerCase();
    if (type === "boxset" || type === "collectionfolder") return "collection";
    if (type === "series") return "season";
    if (type === "season") return "episode";
    return "";
  })();

  if (!accessHasSerr(access)) {
    if (resolvedMode === "collection" && access?.arrRadarrEnabled !== true) return [];
    if ((resolvedMode === "season" || resolvedMode === "episode") && access?.arrSonarrEnabled !== true) return [];
  }

  if (resolvedMode === "collection") {
    const collectionId = await resolveCollectionTmdbId(containerItem, { access });
    if (signal?.aborted || !collectionId) return [];
    const details = await getSerrCollectionDetails(collectionId, { language: serrLanguage(access) }).catch(() => null);
    if (signal?.aborted || !details) return [];
    const expected = normalizeSerrCollectionDetails(details);
    const localKeys = localCollectionMovieKeySet(localItems);
    const requestState = await getRequestState().catch(() => emptyRequestState());
    if (signal?.aborted) return [];
    const missingMovies = await filterUnavailableCollectionMovies(
      expected.parts.filter((movie) => !isCollectionMoviePresent(movie, localKeys)),
      { signal }
    );
    if (signal?.aborted) return [];
    return withSyntheticRequestState(missingMovies
      .map(toSerrMissingMovieItem), requestState);
  }

  let resolvedSeries = seriesItem || containerItem;
  if (resolvedMode === "episode" && !tmdbId(resolvedSeries) && text(containerItem?.SeriesId)) {
    resolvedSeries = await fetchItemDetailsFull(containerItem.SeriesId, { signal }).catch(() => resolvedSeries);
    if (signal?.aborted) return [];
  }
  const mediaId = tmdbId(resolvedSeries);
  if (!mediaId) return [];

  if (resolvedMode === "season") {
    const details = await getSerrTvDetails(mediaId, { language: serrLanguage(access) }).catch(() => null);
    if (signal?.aborted || !details) return [];
    const expected = normalizeSerrTvDetails(details);
    const localSeasons = localSeasonNumberSet(localItems);
    const requestState = await getRequestState().catch(() => emptyRequestState());
    if (signal?.aborted) return [];
    return withSyntheticRequestState(expected.seasons
      .filter((season) => !localSeasons.has(Number(season.IndexNumber)))
      .map((season) => toSerrMissingSeasonItem(season, resolvedSeries)), requestState);
  }

  if (resolvedMode === "episode") {
    const seasonNumber = Number(containerItem?.IndexNumber);
    if (!isRequestableEpisodeSeasonNumber(seasonNumber)) return [];
    const details = await getSerrTvSeasonDetails(mediaId, seasonNumber, { language: serrLanguage(access) }).catch(() => null);
    if (signal?.aborted || !details) return [];
    const expected = normalizeSerrSeasonDetails(details, seasonNumber);
    const localEpisodes = localEpisodeNumberSet(localItems, seasonNumber);
    const requestState = await getRequestState().catch(() => emptyRequestState());
    if (signal?.aborted) return [];
    return withSyntheticRequestState(expected.episodes
      .filter((episode) => !localEpisodes.has(Number(episode.IndexNumber)))
      .map((episode) => toSerrMissingEpisodeItem(episode, resolvedSeries)), requestState);
  }

  return [];
}

export async function requestSerrMissingSyntheticItem(item, { button } = {}) {
  if (!moduleEnabled()) return null;
  if (!isSerrMissingSyntheticItem(item)) return null;
  if (isSerrMissingSyntheticItemRequested(item)) {
    markButtonRequested(button);
    return null;
  }
  const type = text(item.__monwuiSerrMissingType);
  const access = await getSerrAccess().catch(() => null);
  const serrSettings = access?.settings || {};
  const confirmRequests = access4KEnabled(access) || serrSettings.confirmRequests !== false;
  if (type === "movie") {
    if (confirmRequests) {
      openSelectionModal({
        mode: "movie",
        titleMode: "movie",
        submitMode: "movie",
        visualOnly: true,
        plan: { serrSettings },
        items: [item],
        originButton: button,
        source: "jellyfin-missing-preview-card",
        requestedItem: item
      });
      return { openedModal: true };
    }
    await submitMovieRequest({
      movie: item,
      button,
      originButton: button,
      source: "jellyfin-missing-preview-card",
      requestedItem: item
    });
    return null;
  }

  const series = item.__monwuiSerrSeriesItem || {};
  const plan = { seriesItem: series, pageItem: series, requestState: emptyRequestState(), serrSettings: { ...serrSettings, confirmRequests } };
  if (type === "season") {
    const seasonNumber = Number(item?.IndexNumber);
    if (!isRequestableSeasonNumber(seasonNumber)) {
      notify(L("serrRequestFailed", "Seerr isteği oluşturulamadı."), "error");
      return null;
    }
    if (confirmRequests) {
      openSelectionModal({
        mode: "season",
        titleMode: "season",
        submitMode: "season",
        visualOnly: true,
        plan,
        items: [item],
        originButton: button,
        source: "jellyfin-missing-preview-card",
        requestedItem: item
      });
      return { openedModal: true };
    }
    await submitSelection({
      plan,
      seasons: [seasonNumber],
      episodes: [],
      mode: "season",
      button,
      originButton: button,
      source: "jellyfin-missing-preview-card",
      requestedItem: item
    });
    return null;
  }

  if (type === "episode") {
    const seasonNumber = Number(item?.ParentIndexNumber);
    const episodeNumber = Number(item?.IndexNumber);
    if (!isRequestableEpisodeSeasonNumber(seasonNumber) || !Number.isFinite(episodeNumber) || episodeNumber < 0) {
      notify(L("serrRequestFailed", "Seerr isteği oluşturulamadı."), "error");
      return null;
    }
    if (confirmRequests) {
      openSelectionModal({
        mode: "episode",
        titleMode: "episode",
        submitMode: "episode",
        visualOnly: true,
        plan,
        items: [item],
        originButton: button,
        source: "jellyfin-missing-preview-card",
        requestedItem: item
      });
      return { openedModal: true };
    }
    await submitSelection({
      plan,
      seasons: [],
      episodes: [{
        seasonNumber,
        episodeNumber,
        name: episodeOriginalTitle(item)
      }],
      mode: "episode",
      button,
      originButton: button,
      source: "jellyfin-missing-preview-card",
      requestedItem: item
    });
    return null;
  }

  return null;
}

function normalizeCollectionRequestItem(collection = {}) {
  const mediaId = Number(collection?.id || collection?.mediaId || collection?.tmdbId || collection?.TmdbId || collection?.__tmdbId || 0);
  const title = text(
    collection?.name ||
    collection?.title ||
    collection?.Name ||
    collection?.Title ||
    collection?.originalName ||
    collection?.original_name,
    L("boxset", "Koleksiyon")
  );
  return {
    Id: text(collection?.Id || collection?.id || `tmdb-collection-${mediaId || normalizeKey(title)}`),
    Type: "BoxSet",
    Name: title,
    OriginalTitle: text(collection?.originalName || collection?.original_name || collection?.originalTitle || collection?.original_title, title),
    Overview: text(collection?.overview || collection?.Overview),
    ProviderIds: { ...(collection?.ProviderIds || collection?.providerIds || {}), Tmdb: mediaId > 0 ? String(mediaId) : undefined },
    PosterPath: text(collection?.posterPath || collection?.poster_path || collection?.PosterPath),
    BackdropPath: text(collection?.backdropPath || collection?.backdrop_path || collection?.BackdropPath),
    __tmdbId: Number.isFinite(mediaId) && mediaId > 0 ? Math.floor(mediaId) : 0
  };
}

export async function openSerrCollectionRequestModal(collection = {}, { source = "jellyfin-search-collection" } = {}) {
  if (!moduleEnabled()) return null;
  const access = await getSerrAccess().catch(() => null);
  if (!access?.enabled || !accessCanHandleDetails(access, "boxset")) {
    throw new Error(L("serrDisabled", "Seerr entegrasyonu etkin değil."));
  }

  const collectionItem = normalizeCollectionRequestItem(collection);
  const collectionId = tmdbId(collectionItem);
  if (!collectionId) {
    throw new Error(L("serrTmdbMissing", "TMDb ID bulunamadı. Seerr araması ile devam edin."));
  }

  const details = await getSerrCollectionDetails(collectionId, { language: serrLanguage(access) }).catch(() => null);
  const expected = normalizeSerrCollectionDetails(details);
  if (!expected.parts.length) {
    throw new Error(L("serrNoResults", "Seerr'de sonuç bulunamadı."));
  }

  const [unavailableMovies, requestState] = await Promise.all([
    filterUnavailableCollectionMovies(expected.parts),
    getRequestState().catch(() => emptyRequestState())
  ]);
  const plan = {
    kind: "collection",
    pageItem: collectionItem,
    collectionId,
    expectedCollectionItems: expected.parts,
    missingCollectionItems: unavailableMovies,
    requestState,
    serrSettings: access?.settings || {}
  };
  const missingMovies = unavailableMovies.filter((movie) => !isMovieRequested(plan, movie));
  if (!missingMovies.length) {
    notify(L("serrCollectionNothingToRequest", "Bu boxset içinde Jellyfin'de olmayan ya da bekleyen film yok."), "success");
    return { empty: true };
  }

  if (await shouldConfirmRequests(plan)) {
    openSelectionModal({
      mode: "movie",
      titleMode: "movie",
      submitMode: "collection",
      visualOnly: false,
      plan,
      items: missingMovies,
      source
    });
    return { openedModal: true, count: missingMovies.length };
  }

  const result = await submitMovieCollection({ plan, movies: missingMovies, source });
  return { submitted: true, count: missingMovies.length, result };
}

function ensureStyles() {
  ensureSerrStyles();
  const styleId = "monwui-serr-native-page-styles";
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = `
    .monwui-serr-native-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0;
    }
    .monwui-serr-native-actions .monwui-serr-btn {
      min-height: 38px;
    }
    #monwuiSerrNativeSelectModal {
      background:
        radial-gradient(circle at top left, rgba(255, 193, 7, 0.18), transparent 28%),
        linear-gradient(180deg, rgba(8, 10, 16, 0.72), rgba(7, 9, 15, 0.92)) !important;
      backdrop-filter: blur(14px);
      padding: 18px !important;
    }
    #monwuiSerrNativeSelectModal .monwui-serr-card {
      width: min(760px, calc(100vw - 36px));
    }
    #monwuiSerrNativeSelectModal .monwui-serr-footer {
      border-top: 1px solid rgba(255,255,255,0.06);
      justify-content: flex-end;
    }
    .monwui-serr-choice-hero {
      align-items: center;
      background:
        linear-gradient(135deg, rgba(255,183,3,0.16), rgba(251,133,0,0.06)),
        rgba(255,255,255,0.035);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: grid;
      gap: 14px;
      grid-template-columns: 92px minmax(0, 1fr);
      padding: 18px 24px;
    }
    .monwui-serr-choice-poster {
      align-items: center;
      aspect-ratio: 2 / 3;
      background:
        linear-gradient(160deg, rgba(255,183,3,0.28), rgba(251,133,0,0.08)),
        rgba(255,255,255,0.06);
      background-position: center;
      background-size: cover;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.28);
      color: #ffb703;
      display: flex;
      justify-content: center;
      overflow: hidden;
      position: relative;
      width: 92px;
    }
    .monwui-serr-choice-poster::before,
    .monwui-serr-choice-thumb::before {
      background: linear-gradient(180deg, transparent, rgba(0,0,0,.35));
      content: "";
      inset: 0;
      position: absolute;
    }
    .monwui-serr-choice-poster .material-icons {
      font-size: 34px;
      position: relative;
      z-index: 1;
    }
    .monwui-serr-choice-summary {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .monwui-serr-choice-eyebrow {
      color: #ffb703;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .monwui-serr-choice-hero-title {
      color: rgba(255,255,255,.95);
      font-size: 20px;
      font-weight: 800;
      line-height: 1.18;
      overflow-wrap: anywhere;
    }
    .monwui-serr-choice-chipbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .monwui-serr-choice-chip {
      background: rgba(255,255,255,0.10);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      color: rgba(255,255,255,0.9);
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
      padding: 6px 10px;
    }
    .monwui-serr-choice-overview {
      color: rgba(255,255,255,.68);
      display: -webkit-box;
      font-size: 12px;
      line-height: 1.45;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .monwui-serr-choice-list {
      display: grid;
      gap: 14px;
      max-height: min(32vh, 520px);
      overflow: auto;
      overscroll-behavior: contain;
      padding: 18px 24px;
      scrollbar-color: #ffb703 transparent;
    }
    .monwui-serr-choice-row {
      align-items: center;
      background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      display: grid;
      gap: 14px;
      grid-template-columns: auto 68px minmax(0, 1fr);
      padding: 12px;
      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
    }
    .monwui-serr-choice-row:hover,
    .monwui-serr-choice-row:focus-within {
      border-color: rgba(255,183,3,0.42);
      box-shadow: 0 14px 30px rgba(0,0,0,0.18);
      transform: translateY(-2px);
    }
    .monwui-serr-choice-row.is-episode {
      grid-template-columns: auto 86px minmax(0, 1fr);
    }
      .monwui-serr-choice-row input {
        accent-color: #ffb703;
        pointer-events: none;
        height: 18px;
        width: 18px;
      }
      .monwui-serr-choice-row.is-selectable input {
        pointer-events: auto;
      }
    .monwui-serr-choice-row input[type=checkbox]:checked {
      background-color: #ffb703;
      border-color: #ffc107ab;
      height: 18px;
      width: 18px;
      margin: 0;
      border-radius: 4px;
    }
      .monwui-serr-choice-row input:disabled {
        opacity: 1;
      }
    .monwui-serr-choice-thumb {
      align-items: center;
      aspect-ratio: 2 / 3;
      background:
        linear-gradient(160deg, rgba(255,183,3,0.28), rgba(251,133,0,0.08)),
        rgba(255,255,255,0.06);
      background-position: center;
      background-size: cover;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      color: #ffb703;
      display: flex;
      justify-content: center;
      overflow: hidden;
      position: relative;
      width: 68px;
    }
    .monwui-serr-choice-thumb.is-episode {
      aspect-ratio: 16 / 9;
      width: 86px;
    }
    .monwui-serr-choice-thumb .material-icons {
      font-size: 24px;
      position: relative;
      z-index: 1;
    }
    .monwui-serr-choice-name {
      color: rgba(255,255,255,0.94);
      font-size: 15px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .monwui-serr-choice-meta,
    .monwui-serr-choice-hint {
      color: rgba(255,255,255,.68);
      font-size: 12px;
      line-height: 1.45;
    }
    .monwui-serr-choice-toolbar {
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,.08);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 24px;
    }
    @media (max-width: 560px) {
      .monwui-serr-choice-hero {
        grid-template-columns: 76px minmax(0, 1fr);
        padding: 12px 14px;
      }
      .monwui-serr-choice-poster,
      .monwui-serr-choice-poster.is-episode {
        width: 76px;
      }
      .monwui-serr-choice-hero-title {
        font-size: 17px;
      }
      .monwui-serr-choice-row,
      .monwui-serr-choice-row.is-episode {
        grid-template-columns: auto 54px minmax(0, 1fr);
        border-radius: 16px;
      }
      .monwui-serr-choice-thumb,
      .monwui-serr-choice-thumb.is-episode {
        border-radius: 10px;
        width: 54px;
      }
    }
    .monwui-serr-native-episode-inline .material-icons {
      color: #ffb703;
    }
    .monwui-serr-native-episode-inline:disabled {
      cursor: wait;
      opacity: .72;
    }
    .monwui-serr-missing-card .cardBox,
    .monwui-serr-missing-listitem {
      border: 1px dashed rgba(255,183,3,0.42);
    }
    .card.overflowPortraitCard.card-hoverable.card-withuserdata:hover .monwui-serr-missing-card-icon,
    .card.overflowBackdropCard.card-hoverable.card-withuserdata:hover .monwui-serr-missing-card-icon {
      opacity: 1;
    }
    .monwui-serr-missing-card {
      cursor: pointer;
    }
    .monwui-serr-missing-card .monwui-serr-missing-cardRow {
      display: flex;
      flex-direction: column;
      gap: 0;
      position: relative;
      width: 100%;
    }
    .monwui-serr-missing-card .cardPadder {
      width: 100%;
    }
    .monwui-serr-missing-card .cardScalable,
    .monwui-serr-missing-card .monwui-serr-missing-cardMedia {
      position: relative;
    }
    .monwui-serr-missing-card .monwui-serr-missing-cardAction {
      bottom: 12px;
      left: 10px;
      pointer-events: auto;
      position: absolute;
      right: auto;
      top: auto;
      z-index: 4;
    }
    .card.overflowPortraitCard.monwui-serr-missing-card .monwui-serr-missing-cardAction {
      bottom: 12px;
      right: 5px;
      left: auto;
      top: auto;
    }
    .monwui-serr-missing-card-image,
    .monwui-serr-missing-thumb {
      align-items: center;
      background-color: rgba(255,183,3,0.12);
      background-position: center;
      background-size: cover;
      color: rgba(255,255,255,.86);
      display: flex;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }
    .cardImageContainer.coveredImage.cardContent.monwui-serr-missing-card-image {
      position: absolute;
    }
    .monwui-serr-missing-card-image::before,
    .monwui-serr-missing-thumb::before {
      background: linear-gradient(180deg, rgba(0,0,0,.04), rgba(0,0,0,.38));
      content: "";
      inset: 0;
      pointer-events: none;
      position: absolute;
    }
    .monwui-serr-missing-card-icon {
      color: #ffb703;
      font-size: 42px;
      position: relative;
      z-index: 1;
      opacity: 1;
      transition: opacity 0.2s cubic-bezier(0.55, 0.09, 0.68, 0.53);
    }
    .monwui-serr-missing-badge {
      background: rgba(239,68,68,.96);
      border: 1px solid rgba(254,202,202,.72);
      box-shadow: 0 8px 18px rgba(0,0,0,.3);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      left: -34px;
      letter-spacing: 0;
      line-height: 20px;
      pointer-events: none;
      position: absolute;
      text-align: center;
      top: 12px;
      transform: rotate(-35deg);
      width: 128px;
      z-index: 2;
    }
    .monwui-serr-missing-listitem .listItemBodyText {
      overflow-wrap: anywhere;
    }
    .monwui-serr-missing-listitem .monwui-serr-native-episode-inline {
      color: #ffb703;
    }
    .monwui-serr-missing-card .monwui-serr-missing-cardAction .monwui-serr-native-card-btn {
      align-items: center;
      background: linear-gradient(135deg, #ffb703, #fb8500);
      border: 0;
      border-radius: 8px;
      box-shadow: 0 8px 18px rgba(0,0,0,.28);
      color: #141822;
      display: inline-flex;
      height: 30px;
      justify-content: center;
      min-height: 30px;
      min-width: 30px;
      padding: 0;
      width: 30px;
    }
    .monwui-serr-missing-card .cardOverlayContainer {
      align-items: flex-end;
      background: transparent;
      box-sizing: border-box;
      display: flex !important;
      inset: 0;
      justify-content: center;
      opacity: 1 !important;
      padding: 0 0 10px;
      pointer-events: none;
      position: absolute;
      visibility: visible !important;
      z-index: 3;
    }
    .monwui-serr-missing-listitem .monwui-serr-native-episode-inline:disabled,
    .monwui-serr-missing-card .monwui-serr-native-card-btn:disabled {
      cursor: wait;
      opacity: .72;
    }
    .monwui-serr-requested,
    .monwui-serr-requested .monwui-serr-native-card-btn:disabled,
    .monwui-serr-requested .monwui-serr-native-episode-inline:disabled {
      cursor: default;
      opacity: 1;
    }
    .monwui-serr-missing-card.monwui-serr-requested {
      cursor: default;
    }
  `;
}

export function ensureSerrMissingVisualStyles() {
  ensureStyles();
}

function currentRouteItemId() {
  const hash = String(window.location.hash || "");
  const href = String(window.location.href || "");
  for (const source of [hash, href]) {
    const match = source.match(/[?&](?:id|itemId|ItemId)=([^&#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return "";
}

function isDetailsRoute() {
  const hash = String(window.location.hash || "").toLowerCase();
  if (hash.includes("details") || hash.includes("itemdetails")) return true;
  return !!document.querySelector("#itemDetailsPage:not(.hide), #itemdetailsPage:not(.hide), .itemDetailPage:not(.hide), .detailPagePrimaryContainer");
}

function isVisibleNode(node) {
  if (!node?.isConnected) return false;
  if (node.closest?.(".hide")) return false;
  const style = window.getComputedStyle?.(node);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  const rects = node.getClientRects?.();
  return !rects || rects.length > 0;
}

function activeDetailsRoot() {
  const selectors = [
    "#itemDetailsPage:not(.hide)",
    "#itemdetailsPage:not(.hide)",
    ".itemDetailPage:not(.hide)",
    ".detailPagePrimaryContainer"
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!isVisibleNode(el)) continue;
    if (el.classList?.contains("detailPagePrimaryContainer")) {
      return el.closest?.("#itemDetailsPage, #itemdetailsPage, .itemDetailPage") || document;
    }
    return el;
  }
  return document;
}

function findNativeHost() {
  const root = activeDetailsRoot();
  const selectors = [
    ".mainDetailButtons",
    ".detailButtonContainer",
    ".itemDetailButtons",
    ".itemPageButtons",
    ".detailPagePrimaryContainer",
    "#itemDetailsPage:not(.hide)",
    "#itemdetailsPage:not(.hide)",
    ".itemDetailPage:not(.hide)"
  ];
  for (const selector of selectors) {
    const el = root.querySelector?.(selector) || (root.matches?.(selector) ? root : null);
    if (isVisibleNode(el)) return el;
  }
  return null;
}

function isMissingItem(item) {
  const type = text(item?.Type || item?.type).toLowerCase();
  const location = text(item?.LocationType || item?.locationType).toLowerCase();
  if (item?.IsMissing === true || item?.isMissing === true) return true;
  if (location === "virtual") return true;
  if (item?.IsVirtualItem === true || item?.isVirtualItem === true) return true;
  if (type === "series" || type === "season") return false;
  if (type === "episode") {
    const mediaSources = Array.isArray(item?.MediaSources) ? item.MediaSources : [];
    const hasPath = !!text(item?.Path);
    const runtime = Number(item?.RunTimeTicks || 0);
    if (!mediaSources.length && !hasPath && runtime <= 0 && item?.LocationType) return true;
  }
  return false;
}

function isRequestableSeasonNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 1000;
}

function isRequestableEpisodeSeasonNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1000;
}

function seasonNumberOf(item) {
  const direct = readNumber(item, "IndexNumber", "indexNumber", "SeasonNumber", "seasonNumber", "number");
  if (isRequestableSeasonNumber(direct)) return direct;
  const name = text(item?.Name || item?.name || item?.Title || item?.title);
  const match = name.match(/\b(\d{1,4})\b/);
  const parsed = Number(match?.[1]);
  return isRequestableSeasonNumber(parsed) ? parsed : NaN;
}

function episodeSeasonNumberOf(item) {
  const direct = readNumber(item, "ParentIndexNumber", "parentIndexNumber", "SeasonNumber", "seasonNumber");
  return isRequestableEpisodeSeasonNumber(direct) ? direct : NaN;
}

function episodeNumberOf(item) {
  const direct = readNumber(item, "IndexNumber", "indexNumber", "EpisodeNumber", "episodeNumber", "number");
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const name = text(item?.Name || item?.name || item?.Title || item?.title);
  const match = name.match(/^\s*(\d{1,4})\b/);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

function normalizeEpisodeForSeason(episode, season) {
  const seasonNumber = episodeSeasonNumberOf(episode);
  if (isRequestableSeasonNumber(seasonNumber)) return episode;
  const fallbackSeasonNumber = seasonNumberOf(season);
  if (!isRequestableSeasonNumber(fallbackSeasonNumber)) return episode;
  return {
    ...episode,
    ParentIndexNumber: fallbackSeasonNumber,
    SeasonId: episode?.SeasonId || season?.Id,
    SeriesId: episode?.SeriesId || season?.SeriesId
  };
}

function episodeKey(episode) {
  const id = text(episode?.Id);
  if (id) return `id:${id}`;
  const s = Number(episode?.ParentIndexNumber);
  const e = Number(episode?.IndexNumber);
  return `idx:${Number.isFinite(s) ? s : "x"}:${Number.isFinite(e) ? e : "x"}:${text(episode?.Name).toLowerCase()}`;
}

async function fetchSeasons(seriesId, { signal } = {}) {
  const userId = getSessionInfo()?.userId || window.ApiClient?.getCurrentUserId?.() || "";
  const build = (mode = "all") => {
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("Fields", "Id,Name,IndexNumber,UserData,ChildCount,LocationType,ProviderIds,PremiereDate,Path");
    if (mode === "missing") qp.set("IsMissing", "true");
    if (mode === "virtual") qp.set("LocationTypes", "Virtual");
    return `/Shows/${encodeURIComponent(seriesId)}/Seasons?${qp.toString()}`;
  };

  const [normal, missing, virtual] = await Promise.all([
    makeApiRequest(build("all"), { signal }).catch(() => ({ Items: [] })),
    makeApiRequest(build("missing"), { signal }).catch(() => ({ Items: [] })),
    makeApiRequest(build("virtual"), { signal }).catch(() => ({ Items: [] }))
  ]);
  const map = new Map();
  for (const item of [...(normal?.Items || []), ...(missing?.Items || []), ...(virtual?.Items || [])]) {
    if (item?.Id) map.set(item.Id, item);
  }
  return Array.from(map.values())
    .sort((a, b) => Number(a?.IndexNumber || 0) - Number(b?.IndexNumber || 0));
}

async function fetchEpisodes(seriesId, { signal } = {}) {
  const userId = getSessionInfo()?.userId || window.ApiClient?.getCurrentUserId?.() || "";
  const build = (mode = "all") => {
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("Limit", "10000");
    qp.set("Fields", EPISODE_FIELDS);
    if (mode === "missing") qp.set("IsMissing", "true");
    if (mode === "virtual") qp.set("LocationTypes", "Virtual");
    return `/Shows/${encodeURIComponent(seriesId)}/Episodes?${qp.toString()}`;
  };

  const [normal, missing, virtual] = await Promise.all([
    makeApiRequest(build("all"), { signal }).catch(() => ({ Items: [] })),
    makeApiRequest(build("missing"), { signal }).catch(() => ({ Items: [] })),
    makeApiRequest(build("virtual"), { signal }).catch(() => ({ Items: [] }))
  ]);
  const map = new Map();
  for (const item of [...(normal?.Items || []), ...(missing?.Items || []), ...(virtual?.Items || [])]) {
    if (item?.Id) map.set(item.Id, item);
  }
  return Array.from(map.values()).sort((a, b) => {
    const sa = Number(a?.ParentIndexNumber || 0);
    const sb = Number(b?.ParentIndexNumber || 0);
    if (sa !== sb) return sa - sb;
    return Number(a?.IndexNumber || 0) - Number(b?.IndexNumber || 0);
  });
}

async function fetchSeasonEpisodes(season, { signal } = {}) {
  const seasonId = text(season?.Id);
  const userId = getSessionInfo()?.userId || window.ApiClient?.getCurrentUserId?.() || "";
  if (!seasonId || !userId) return [];

  const build = (mode = "all") => {
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", seasonId);
    qp.set("IncludeItemTypes", "Episode");
    qp.set("Recursive", "false");
    qp.set("Limit", "10000");
    qp.set("Fields", EPISODE_FIELDS);
    qp.set("SortBy", "ParentIndexNumber,IndexNumber,SortName");
    qp.set("SortOrder", "Ascending");
    if (mode === "missing") qp.set("IsMissing", "true");
    if (mode === "virtual") qp.set("LocationTypes", "Virtual");
    return `/Items?${qp.toString()}`;
  };

  const [normal, missing, virtual] = await Promise.all([
    makeApiRequest(build("all"), { signal }).catch(() => ({ Items: [] })),
    makeApiRequest(build("missing"), { signal }).catch(() => ({ Items: [] })),
    makeApiRequest(build("virtual"), { signal }).catch(() => ({ Items: [] }))
  ]);
  return [...(normal?.Items || []), ...(missing?.Items || []), ...(virtual?.Items || [])]
    .map((episode) => normalizeEpisodeForSeason(episode, season));
}

async function fetchSeasonEpisodesForMissingCheck(seasons, { signal } = {}) {
  const requestable = (seasons || []).filter((season) => isRequestableSeasonNumber(season?.IndexNumber) && text(season?.Id));
  const out = [];
  let index = 0;
  const workerCount = Math.min(4, Math.max(1, requestable.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < requestable.length) {
      const season = requestable[index++];
      if (signal?.aborted) return;
      const items = await fetchSeasonEpisodes(season, { signal }).catch(() => []);
      out.push(...items);
    }
  }));
  return out;
}

async function fetchCollectionMovies(collectionId, { signal } = {}) {
  const userId = getSessionInfo()?.userId || window.ApiClient?.getCurrentUserId?.() || "";
  if (!collectionId || !userId) return [];

  const out = [];
  const seen = new Set();
  let start = 0;
  const pageSize = 200;

  while (!signal?.aborted) {
    const qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", String(collectionId));
    qp.set("IncludeItemTypes", "Movie");
    qp.set("Recursive", "false");
    qp.set("Limit", String(pageSize));
    qp.set("StartIndex", String(start));
    qp.set("Fields", COLLECTION_FIELDS);
    qp.set("SortBy", "ProductionYear,SortName");
    qp.set("SortOrder", "Ascending");

    const data = await makeApiRequest(`/Items?${qp.toString()}`, { signal }).catch(() => ({ Items: [] }));
    const items = Array.isArray(data?.Items) ? data.Items : [];
    for (const item of items) {
      const id = text(item?.Id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }
    if (items.length < pageSize) break;
    start += pageSize;
  }

  return out;
}

function collectionCardTitle(card) {
  return text(
    card?.querySelector?.(".cardText-first bdi")?.textContent ||
    card?.querySelector?.(".cardText-first")?.textContent ||
    card?.querySelector?.(".textActionButton")?.getAttribute?.("title") ||
    card?.querySelector?.(".textActionButton")?.textContent ||
    card?.querySelector?.(".cardImageContainer")?.getAttribute?.("aria-label") ||
    card?.getAttribute?.("aria-label")
  );
}

function collectionCardYear(card) {
  const textValue = text(
    card?.querySelector?.(".cardText-secondary bdi")?.textContent ||
    card?.querySelector?.(".cardText-secondary")?.textContent
  );
  const match = textValue.match(/\b(18|19|20|21)\d{2}\b/);
  const year = Number(match?.[0]);
  return Number.isFinite(year) ? year : NaN;
}

function collectionDomMovieFromCard(card) {
  if (!card?.isConnected) return null;
  const type = text(card.getAttribute("data-type") || card.dataset?.type).toLowerCase();
  if (type && type !== "movie") return null;
  const id = text(card.getAttribute("data-id") || card.dataset?.id);
  const name = collectionCardTitle(card);
  if (!id && !name) return null;
  return {
    Id: id,
    Type: "Movie",
    Name: name,
    ProductionYear: collectionCardYear(card),
    CollectionId: text(card.getAttribute("data-collectionid") || card.dataset?.collectionid)
  };
}

function getRenderedCollectionMovies(container) {
  if (!container?.isConnected) return [];
  return Array.from(container.querySelectorAll('.card[data-type="Movie"]:not(.monwui-serr-missing-card), .card[data-itemtype="Movie"]:not(.monwui-serr-missing-card)'))
    .map(collectionDomMovieFromCard)
    .filter(Boolean);
}

function normalizeSerrSeason(raw) {
  const seasonNumber = readNumber(raw, "seasonNumber", "season_number", "season");
  if (!isRequestableSeasonNumber(seasonNumber)) return null;
  const name = text(
    readFirst(raw, "name", "title", "displayName"),
    `${L("season", "Sezon")} ${seasonNumber}`
  );
  const episodeCount = readNumber(raw, "episodeCount", "episode_count", "episodesCount", "episode_count_total");
  return {
    Id: `${SYNTHETIC_PREFIX}-season-${seasonNumber}`,
    Type: "Season",
    Name: name,
    OriginalTitle: text(readFirst(raw, "originalName", "original_name", "originalTitle", "original_title"), name),
    Overview: text(readFirst(raw, "overview", "description")),
    IndexNumber: seasonNumber,
    ChildCount: Number.isFinite(episodeCount) ? episodeCount : 0,
    PremiereDate: text(readFirst(raw, "airDate", "air_date", "releaseDate", "release_date")),
    PosterPath: text(readFirst(raw, "posterPath", "poster_path")),
    Source: "serr"
  };
}

function normalizeSerrEpisode(raw, fallbackSeasonNumber) {
  const seasonNumber = readNumber(raw, "seasonNumber", "season_number", "season");
  const finalSeason = Number.isFinite(seasonNumber) ? seasonNumber : Number(fallbackSeasonNumber);
  const episodeNumber = readNumber(raw, "episodeNumber", "episode_number", "episode");
  if (!isRequestableEpisodeSeasonNumber(finalSeason) || !Number.isFinite(episodeNumber) || episodeNumber < 0) return null;
  const name = text(readFirst(raw, "name", "title"), `${L("episode", "Bölüm")} ${episodeNumber}`);
  return {
    Id: `${SYNTHETIC_PREFIX}-episode-${finalSeason}-${episodeNumber}`,
    Type: "Episode",
    Name: name,
    OriginalTitle: text(readFirst(raw, "originalName", "original_name", "originalTitle", "original_title"), name),
    Overview: text(readFirst(raw, "overview", "description")),
    ParentIndexNumber: finalSeason,
    IndexNumber: episodeNumber,
    PremiereDate: text(readFirst(raw, "airDate", "air_date", "releaseDate", "release_date")),
    StillPath: text(readFirst(raw, "stillPath", "still_path")),
    Source: "serr"
  };
}

function normalizeSerrCollectionMovie(raw) {
  const mediaId = readNumber(raw, "id", "mediaId", "media_id", "tmdbId", "tmdb_id");
  if (!Number.isFinite(mediaId) || mediaId <= 0) return null;
  const title = text(
    readFirst(raw, "title", "name", "originalTitle", "original_title", "originalName", "original_name"),
    L("serrMovie", "Film")
  );
  return {
    Id: `${SYNTHETIC_PREFIX}-movie-${mediaId}`,
    Type: "Movie",
    Name: title,
    OriginalTitle: text(readFirst(raw, "originalTitle", "original_title", "originalName", "original_name"), title),
    Overview: text(readFirst(raw, "overview", "description")),
    ProductionYear: readYear(raw, "releaseDate", "release_date", "firstAirDate", "first_air_date"),
    PremiereDate: text(readFirst(raw, "releaseDate", "release_date", "firstAirDate", "first_air_date")),
    PosterPath: text(readFirst(raw, "posterPath", "poster_path")),
    BackdropPath: text(readFirst(raw, "backdropPath", "backdrop_path")),
    CommunityRating: readNumber(raw, "voteAverage", "vote_average", "rating"),
    __tmdbId: mediaId,
    Source: "serr"
  };
}

function normalizeSerrTvDetails(data) {
  const seasons = readArray(data, "seasons", "Seasons")
    .map(normalizeSerrSeason)
    .filter(Boolean);
  return {
    seasons: seasons
      .filter((season) => isRequestableSeasonNumber(season.IndexNumber))
      .sort((a, b) => Number(a.IndexNumber || 0) - Number(b.IndexNumber || 0))
  };
}

function normalizeSerrSeasonDetails(data, seasonNumber) {
  const episodes = readArray(data, "episodes", "Episodes")
    .map((episode) => normalizeSerrEpisode(episode, seasonNumber))
    .filter(Boolean);
  return {
    episodes: episodes.sort((a, b) => Number(a.IndexNumber || 0) - Number(b.IndexNumber || 0))
  };
}

function normalizeSerrMovieDetails(data) {
  return readFirst(data, "belongsToCollection", "belongs_to_collection", "collection") || null;
}

function normalizeSerrCollectionDetails(data) {
  const rawParts = readArray(data, "parts", "Parts", "items", "Items", "movies", "Movies", "results", "Results");
  const parts = rawParts.map(normalizeSerrCollectionMovie).filter(Boolean);
  return {
    parts: parts.sort((a, b) => {
      const ay = Number(a.ProductionYear || 0);
      const by = Number(b.ProductionYear || 0);
      if (ay !== by) return ay - by;
      return normalizeKey(a.Name).localeCompare(normalizeKey(b.Name));
    })
  };
}

function localSeasonNumberSet(seasons) {
  const set = new Set();
  for (const season of seasons || []) {
    const n = seasonNumberOf(season);
    if (!isRequestableSeasonNumber(n) || isMissingItem(season)) continue;
    set.add(n);
  }
  return set;
}

function localEpisodeNumberSet(episodes, seasonNumber) {
  const set = new Set();
  for (const episode of episodes || []) {
    if (isMissingItem(episode)) continue;
    if (episodeSeasonNumberOf(episode) !== Number(seasonNumber)) continue;
    const n = episodeNumberOf(episode);
    if (Number.isFinite(n) && n >= 0) set.add(n);
  }
  return set;
}

function collectionMovieKeys(item) {
  const tmdb = tmdbId(item);
  const title = normalizeKey(item?.Name || item?.OriginalTitle);
  const year = Number(item?.ProductionYear || readYear(item, "PremiereDate"));
  return {
    tmdb: tmdb > 0 ? `tmdb:${tmdb}` : "",
    titleYear: title ? `title:${title}:${Number.isFinite(year) ? year : ""}` : ""
  };
}

function localCollectionMovieKeySet(items) {
  const set = new Set();
  for (const item of items || []) {
    if (isMissingItem(item)) continue;
    const keys = collectionMovieKeys(item);
    if (keys.tmdb) set.add(keys.tmdb);
    if (keys.titleYear) set.add(keys.titleYear);
  }
  return set;
}

function isCollectionMoviePresent(movie, localKeys) {
  const keys = collectionMovieKeys(movie);
  return (!!keys.tmdb && localKeys.has(keys.tmdb)) || (!!keys.titleYear && localKeys.has(keys.titleYear));
}

async function isMovieAvailableInJellyfinByTmdb(movie, { signal } = {}) {
  const id = tmdbId(movie);
  if (!id || signal?.aborted) return false;
  if (localTmdbAvailabilityCache.has(id)) return localTmdbAvailabilityCache.get(id) === true;

  const data = await searchJellyfinByTmdbId(id).catch(() => null);
  if (!data || data?.ok === false) return false;
  const available = Array.isArray(data?.items) && data.items.length > 0;
  if (available) localTmdbAvailabilityCache.set(id, true);
  return available;
}

async function filterUnavailableCollectionMovies(movies, { signal } = {}) {
  const list = Array.isArray(movies) ? movies : [];
  if (!list.length || signal?.aborted) return [];

  const unavailable = new Array(list.length).fill(false);
  let index = 0;
  const workerCount = Math.min(4, list.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!signal?.aborted && index < list.length) {
      const current = index++;
      unavailable[current] = !(await isMovieAvailableInJellyfinByTmdb(list[current], { signal }));
    }
  }));
  if (signal?.aborted) return [];
  return list.filter((_, i) => unavailable[i]);
}

async function buildExternalSeriesMissingPlan(seriesItem, seasons, pageItem, { access = null, signal, episodes = [] } = {}) {
  const mediaId = tmdbId(seriesItem);
  if (!mediaId) return null;

  const tvDetails = await getSerrTvDetails(mediaId, { language: serrLanguage(access) }).catch(() => null);
  if (signal?.aborted || !tvDetails) return null;

  const expected = normalizeSerrTvDetails(tvDetails);
  const localSeasons = localSeasonNumberSet(seasons);
  const missingSeasons = expected.seasons.filter((season) => !localSeasons.has(Number(season.IndexNumber)));
  const pageType = text(pageItem?.Type).toLowerCase();
  const pageEpisode = Array.isArray(episodes)
    ? episodes.find((episode) => text(episode?.Id) === text(pageItem?.Id))
    : null;
  const pageSeasonNumber = pageType === "season"
    ? Number(pageItem?.IndexNumber)
    : (pageType === "episode" ? Number(pageItem?.ParentIndexNumber ?? pageEpisode?.ParentIndexNumber) : NaN);

  let missingEpisodes = [];
  if (isRequestableSeasonNumber(pageSeasonNumber)) {
    const seasonNumber = Number(pageSeasonNumber);
    const localEpisodesPromise = pageType === "season"
      ? fetchSeasonEpisodes(pageItem, { signal }).catch(() => [])
      : Promise.resolve((Array.isArray(episodes) ? episodes : [])
        .filter((episode) => episodeSeasonNumberOf(episode) === seasonNumber));
    const [seasonDetails, localEpisodes] = await Promise.all([
      getSerrTvSeasonDetails(mediaId, seasonNumber, { language: serrLanguage(access) }).catch(() => null),
      localEpisodesPromise
    ]);
    if (signal?.aborted) return null;
    const expectedEpisodes = normalizeSerrSeasonDetails(seasonDetails, seasonNumber).episodes;
    const localEpisodesSet = localEpisodeNumberSet(localEpisodes, seasonNumber);
    missingEpisodes = expectedEpisodes.filter((episode) => !localEpisodesSet.has(Number(episode.IndexNumber)));
  }

  return {
    missingSeasons,
    missingEpisodes,
    expectedSeasons: expected.seasons
  };
}

function collectionIdFromMovieDetails(details) {
  const collection = normalizeSerrMovieDetails(details);
  const id = Number(readFirst(collection, "id", "collectionId", "collection_id"));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

async function resolveCollectionTmdbId(item, { access = null } = {}) {
  const direct = tmdbId(item);
  const type = text(item?.Type).toLowerCase();
  if (direct > 0 && type === "boxset") return direct;
  if (direct > 0 && type === "movie") {
    const movieDetails = await getSerrMovieDetails(direct, { language: serrLanguage(access) }).catch(() => null);
    return collectionIdFromMovieDetails(movieDetails);
  }
  return 0;
}

async function buildExternalCollectionMissingPlan(collectionItem, { access = null, signal } = {}) {
  const collectionId = await resolveCollectionTmdbId(collectionItem, { access });
  if (signal?.aborted || !collectionId) return null;

  const [collectionDetails, localMovies] = await Promise.all([
    getSerrCollectionDetails(collectionId, { language: serrLanguage(access) }).catch(() => null),
    fetchCollectionMovies(collectionItem.Id, { signal }).catch(() => [])
  ]);
  if (signal?.aborted || !collectionDetails) return null;

  const expected = normalizeSerrCollectionDetails(collectionDetails);
  const domMovies = getRenderedCollectionMovies(findCollectionItemsContainer({ pageItem: collectionItem }));
  const localKeys = localCollectionMovieKeySet([...localMovies, ...domMovies]);
  const missingCollectionItems = expected.parts.filter((movie) => !isCollectionMoviePresent(movie, localKeys));

  return {
    kind: "collection",
    pageItem: collectionItem,
    collectionId,
    expectedCollectionItems: expected.parts,
    missingCollectionItems
  };
}

function groupEpisodes(episodes) {
  const groups = new Map();
  for (const episode of episodes || []) {
    const seasonNumber = Number(episode?.ParentIndexNumber);
    if (!isRequestableSeasonNumber(seasonNumber)) continue;
    if (!groups.has(seasonNumber)) {
      groups.set(seasonNumber, { seasonNumber, available: [], missing: [] });
    }
    const group = groups.get(seasonNumber);
    (isMissingItem(episode) ? group.missing : group.available).push(episode);
  }
  return groups;
}

function buildMissingPlan(seriesItem, seasons, episodes, pageItem) {
  const groups = groupEpisodes(episodes);
  const missingSeasonNumbers = new Set();
  const missingSeasonEpisodes = [];
  const partialMissingEpisodes = [];
  const syntheticSeasons = new Map();

  for (const season of seasons || []) {
    const n = Number(season?.IndexNumber);
    if (!isRequestableSeasonNumber(n)) continue;
    syntheticSeasons.set(n, season);
    const group = groups.get(n);
    if (isMissingItem(season) || (group?.missing?.length && !group.available.length)) {
      missingSeasonNumbers.add(n);
    }
  }

  for (const group of groups.values()) {
    if (!group.missing.length) continue;
    if (!syntheticSeasons.has(group.seasonNumber)) {
      syntheticSeasons.set(group.seasonNumber, {
        Id: `season-${group.seasonNumber}`,
        Name: `${L("season", "Sezon")} ${group.seasonNumber}`,
        IndexNumber: group.seasonNumber
      });
    }

    if (missingSeasonNumbers.has(group.seasonNumber)) continue;
    partialMissingEpisodes.push(...group.missing);
  }

  for (const seasonNumber of missingSeasonNumbers) {
    const group = groups.get(seasonNumber);
    if (group?.missing?.length) {
      missingSeasonEpisodes.push(...group.missing);
    }
  }

  const pageType = text(pageItem?.Type).toLowerCase();
  if (pageType === "season") {
    const n = Number(pageItem?.IndexNumber);
    if (isRequestableSeasonNumber(n)) {
      const group = groups.get(n);
      return {
        seriesItem,
        pageItem,
        seasons: [syntheticSeasons.get(n) || pageItem],
        missingSeasons: missingSeasonNumbers.has(n) ? [syntheticSeasons.get(n) || pageItem] : [],
        missingSeasonEpisodes: missingSeasonNumbers.has(n) ? (group?.missing || []) : [],
        missingEpisodes: missingSeasonNumbers.has(n) ? [] : (group?.missing || [])
      };
    }
  }

  if (pageType === "episode") {
    const n = Number(pageItem?.ParentIndexNumber);
    const e = Number(pageItem?.IndexNumber);
    const missingCurrent = isMissingItem(pageItem)
      ? [pageItem]
      : partialMissingEpisodes.filter((episode) =>
          Number(episode?.ParentIndexNumber) === n &&
          (!Number.isFinite(e) || Number(episode?.IndexNumber) === e)
        );
    return {
      seriesItem,
      pageItem,
      seasons: [syntheticSeasons.get(n)].filter(Boolean),
      missingSeasons: [],
      missingSeasonEpisodes: [],
      missingEpisodes: missingCurrent
    };
  }

  return {
    seriesItem,
    pageItem,
    seasons: Array.from(syntheticSeasons.values()).sort((a, b) => Number(a?.IndexNumber || 0) - Number(b?.IndexNumber || 0)),
    missingSeasons: Array.from(missingSeasonNumbers)
      .sort((a, b) => a - b)
      .map((n) => syntheticSeasons.get(n) || { Name: `${L("season", "Sezon")} ${n}`, IndexNumber: n }),
    missingSeasonEpisodes,
    missingEpisodes: partialMissingEpisodes
  };
}

function dedupeSeasons(items) {
  const map = new Map();
  for (const item of items || []) {
    const n = Number(item?.IndexNumber);
    if (!isRequestableSeasonNumber(n)) continue;
    if (!map.has(n) || text(item?.Source) === "serr") map.set(n, item);
  }
  return Array.from(map.values()).sort((a, b) => Number(a?.IndexNumber || 0) - Number(b?.IndexNumber || 0));
}

function dedupeEpisodes(items) {
  const map = new Map();
  for (const item of items || []) {
    const s = Number(item?.ParentIndexNumber);
    const e = Number(item?.IndexNumber);
    if (!isRequestableEpisodeSeasonNumber(s) || !Number.isFinite(e) || e < 0) continue;
    const key = `${s}:${e}`;
    if (!map.has(key) || text(item?.Source) === "serr") map.set(key, item);
  }
  return Array.from(map.values()).sort((a, b) => {
    const sa = Number(a?.ParentIndexNumber || 0);
    const sb = Number(b?.ParentIndexNumber || 0);
    if (sa !== sb) return sa - sb;
    return Number(a?.IndexNumber || 0) - Number(b?.IndexNumber || 0);
  });
}

function mergeSeriesPlan(base, external) {
  if (!external) return { ...base, kind: "series" };
  return {
    ...base,
    kind: "series",
    external,
    missingSeasons: dedupeSeasons([...(base?.missingSeasons || []), ...(external.missingSeasons || [])]),
    missingEpisodes: dedupeEpisodes([...(base?.missingEpisodes || []), ...(external.missingEpisodes || [])])
  };
}

function seasonLabel(season) {
  const n = Number(season?.IndexNumber);
  return text(season?.Name, Number.isFinite(n) ? `${L("season", "Sezon")} ${n}` : L("season", "Sezon"));
}

function episodeLabel(episode) {
  const s = Number(episode?.ParentIndexNumber);
  const e = Number(episode?.IndexNumber);
  const prefix = [
    Number.isFinite(s) ? `S${String(s).padStart(2, "0")}` : "",
    Number.isFinite(e) ? `E${String(e).padStart(2, "0")}` : ""
  ].filter(Boolean).join("");
  return [prefix, text(episode?.Name, L("episode", "Bölüm"))].filter(Boolean).join(" - ");
}

function episodeOriginalTitle(episode) {
  return text(
    episode?.OriginalTitle ||
    episode?.originalTitle ||
    episode?.OriginalName ||
    episode?.originalName ||
    episode?.Name,
    L("episode", "Bölüm")
  );
}

function episodeRequestTitle(series, episode) {
  const seriesTitle = text(
    series?.OriginalTitle ||
    series?.originalTitle ||
    series?.OriginalName ||
    series?.originalName ||
    series?.Name,
    L("serrTv", "Dizi")
  );
  return [seriesTitle, episodeCode(episode), episodeOriginalTitle(episode)]
    .filter(Boolean)
    .join(" - ");
}

function episodeCode(episode) {
  const s = Number(episode?.ParentIndexNumber);
  const e = Number(episode?.IndexNumber);
  return [
    Number.isFinite(s) ? `S${String(s).padStart(2, "0")}` : "",
    Number.isFinite(e) ? `E${String(e).padStart(2, "0")}` : ""
  ].filter(Boolean).join("");
}

function mapMissingEpisodes(plan) {
  const map = new Map();
  const items = [
    ...(Array.isArray(plan?.missingSeasonEpisodes) ? plan.missingSeasonEpisodes : []),
    ...(Array.isArray(plan?.missingEpisodes) ? plan.missingEpisodes : [])
  ];
  for (const episode of items) {
    const id = text(episode?.Id);
    if (id) map.set(id, episode);
  }
  return map;
}

function ensureSelectionModal() {
  ensureStyles();
  let modal = document.getElementById("monwuiSerrNativeSelectModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "monwuiSerrNativeSelectModal";
  modal.innerHTML = `
    <div class="monwui-serr-card" role="dialog" aria-modal="true">
      <div class="monwui-serr-head">
        <h2 class="monwui-serr-title"></h2>
        <button type="button" class="monwui-serr-close" data-serr-native-close aria-label="${escapeHtml(L("close", "Kapat"))}">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <div class="monwui-serr-choice-hero"></div>
      <div class="monwui-serr-choice-toolbar"></div>
      <div class="monwui-serr-choice-list"></div>
      <div class="monwui-serr-footer">
        <button type="button" class="monwui-serr-btn" data-serr-native-submit>
          <i class="fas fa-paper-plane" aria-hidden="true"></i><span>${escapeHtml(L("serrRequestButton", "İste"))}</span>
        </button>
        <button type="button" class="monwui-serr-btn monwui-serr-4k-btn" data-serr-native-submit-4k hidden>
          <i class="fas fa-film" aria-hidden="true"></i><span>${escapeHtml(L("serrRequest4KButton", "4K İste"))}</span>
        </button>
      </div>
    </div>
  `;
  modal.style.display = "none";
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "1000000";
  modal.style.background = "radial-gradient(circle at top left, rgba(255, 193, 7, 0.18), transparent 28%), linear-gradient(180deg, rgba(8, 10, 16, 0.72), rgba(7, 9, 15, 0.92))";
  modal.style.backdropFilter = "blur(14px)";
  modal.style.padding = "18px";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target?.closest?.("[data-serr-native-close]")) {
      closeSelectionModal();
    }
  });
  document.body.appendChild(modal);
  return modal;
}

function selectionModalTitle(mode, titleMode, submitMode = mode) {
  if (submitMode === "collection") return L("serrNativeCollectionModalTitle", "Boxset İsteği");
  if (mode === "movie" || titleMode === "movie") return L("serrNativeMovieModalTitle", "Seerr Film İsteği");
  if (titleMode === "season") return L("serrNativeSeasonModalTitle", "Seerr Sezon İsteği");
  return L("serrNativeEpisodeModalTitle", "Seerr Bölüm İsteği");
}

function selectionModalHint(mode, titleMode, submitMode) {
  if (submitMode === "collection") {
    return L("serrCollectionConfirmHint", "Boxset içindeki Jellyfin'de olmayan filmleri kontrol edin.");
  }
  if (mode === "movie" || submitMode === "movie") {
    return L("serrMovieConfirmHint", "Film isteği gönderilmeden önce içeriği kontrol edin.");
  }
  if (titleMode === "season" || submitMode === "season") {
    return L("serrSeasonConfirmHint", "Sezon isteği gönderilmeden önce kapsamı kontrol edin.");
  }
  return L("serrEpisodeConfirmHint", "Bölüm isteği gönderilmeden önce seçimi kontrol edin.");
}

function selectionImagePath(item, mode) {
  if (mode === "episode") return text(item?.StillPath || item?.stillPath || item?.BackdropPath || item?.backdropPath || item?.__monwuiSerrPosterPath || item?.PosterPath || item?.posterPath);
  return text(item?.PosterPath || item?.posterPath || item?.__monwuiSerrPosterPath || item?.StillPath || item?.stillPath || item?.BackdropPath || item?.backdropPath);
}

function selectionImageUrl(item, mode) {
  const path = selectionImagePath(item, mode);
  return imageUrl(path, mode === "episode" ? "w500" : "w342") ||
    jellyfinPrimaryImageUrl(item, mode === "episode" ? 320 : 420);
}

function selectionIcon(mode, titleMode) {
  if (mode === "movie" || titleMode === "movie") return "movie";
  if (titleMode === "season" || mode === "season") return "folder";
  return "playlist_add";
}

function selectionHeroInfo({ mode, titleMode, submitMode, plan, items }) {
  const first = Array.isArray(items) ? (items[0] || {}) : {};
  const series = plan?.seriesItem || first.__monwuiSerrSeriesItem || {};
  const effectiveMode = mode === "movie" ? "movie" : (titleMode === "season" ? "season" : mode);
  if (submitMode === "collection") {
    const collection = plan?.pageItem || {};
    const count = Array.isArray(items) ? items.length : 0;
    return {
      mode: "movie",
      title: text(collection?.Name || collection?.OriginalTitle, L("boxset", "BoxSet")),
      chips: [
        L("boxset", "BoxSet"),
        count ? `${count} ${L("serrMovie", "Film")}` : "",
        tmdbId(collection) ? `TMDb ${tmdbId(collection)}` : ""
      ].filter(Boolean),
      overview: text(collection?.Overview || collection?.overview),
      image: selectionImageUrl(collection, "movie"),
      icon: "folder"
    };
  }
  if (mode === "movie") {
    const year = Number(first?.ProductionYear || readYear(first, "PremiereDate"));
    return {
      mode: "movie",
      title: text(first?.Name || first?.OriginalTitle, L("serrMovie", "Film")),
      chips: [
        L("serrMovie", "Film"),
        Number.isFinite(year) ? String(year) : "",
        tmdbId(first) ? `TMDb ${tmdbId(first)}` : ""
      ].filter(Boolean),
      overview: text(first?.Overview || first?.overview),
      image: selectionImageUrl(first, "movie"),
      icon: selectionIcon("movie", titleMode)
    };
  }

  if (effectiveMode === "season") {
    const seasonNumber = mode === "episode"
      ? Number(first?.ParentIndexNumber)
      : Number(first?.IndexNumber);
    const count = Array.isArray(items) ? items.length : 0;
    const title = [
      text(series?.Name || series?.OriginalTitle, L("serrTv", "Dizi")),
      Number.isFinite(seasonNumber) ? `${L("season", "Sezon")} ${seasonNumber}` : ""
    ].filter(Boolean).join(" - ");
    return {
      mode: mode === "episode" ? "episode" : "season",
      title: title || L("serrNativeSeasonModalTitle", "Seerr Sezon İsteği"),
      chips: [
        L("serrTv", "Dizi"),
        Number.isFinite(seasonNumber) ? `${L("season", "Sezon")} ${seasonNumber}` : "",
        count ? `${count} ${mode === "episode" ? L("episode", "Bölüm") : L("season", "Sezon")}` : L("serrNativeFullSeason", "Sezonun tamamı")
      ].filter(Boolean),
      overview: text(first?.Overview || first?.overview || series?.Overview || series?.overview),
      image: selectionImageUrl(first, mode === "episode" ? "episode" : "season"),
      icon: selectionIcon(mode, titleMode)
    };
  }

  const episodeSeason = Number(first?.ParentIndexNumber);
  return {
    mode: "episode",
    title: episodeRequestTitle(series, first),
    chips: [
      L("serrTv", "Dizi"),
      episodeCode(first),
      Number.isFinite(episodeSeason) ? `${L("season", "Sezon")} ${episodeSeason}` : ""
    ].filter(Boolean),
    overview: text(first?.Overview || first?.overview),
    image: selectionImageUrl(first, "episode"),
    icon: selectionIcon(mode, titleMode)
  };
}

function renderSelectionHero(modal, options) {
  const hero = modal.querySelector(".monwui-serr-choice-hero");
  if (!hero) return;
  const info = selectionHeroInfo(options);
  const posterClass = info.mode === "episode" ? "monwui-serr-choice-poster is-episode" : "monwui-serr-choice-poster";
  const bg = info.image ? ` style="background-image:url('${info.image.replace(/'/g, "%27")}')"` : "";
  hero.innerHTML = `
    <div class="${posterClass}"${bg}>
      <span class="material-icons ${escapeHtml(info.icon)}" aria-hidden="true"></span>
    </div>
    <div class="monwui-serr-choice-summary">
      <div class="monwui-serr-choice-eyebrow">${escapeHtml(L("serrRequestConfirmHint", "İstek onayı"))}</div>
      <div class="monwui-serr-choice-hero-title">${escapeHtml(info.title)}</div>
      <div class="monwui-serr-choice-chipbar">
        ${info.chips.map((chip) => `<span class="monwui-serr-choice-chip">${escapeHtml(chip)}</span>`).join("")}
      </div>
      ${info.overview ? `<div class="monwui-serr-choice-overview">${escapeHtml(info.overview)}</div>` : ""}
    </div>
  `;
}

function closeSelectionModal() {
  const modal = document.getElementById("monwuiSerrNativeSelectModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.__payloadBuilder = null;
}

function planConfirmRequestsValue(plan) {
  const settings = plan?.serrSettings || plan?.settings || null;
  if (settings?.enable4KRequests === true) return true;
  if (settings && settings.confirmRequests !== undefined) return settings.confirmRequests !== false;
  return null;
}

async function shouldConfirmRequests(plan = null) {
  const fromPlan = planConfirmRequestsValue(plan);
  if (fromPlan !== null) return fromPlan;
  const access = await getSerrAccess().catch(() => null);
  if (access4KEnabled(access)) return true;
  return access?.settings?.confirmRequests !== false;
}

function restoreSubmissionButton(button, oldHtml, originButton, completed = false) {
  if (!button) return;
  if (completed && button === originButton) return;
  button.disabled = false;
  button.innerHTML = oldHtml;
}

function openSelectionModal({ mode, plan, items, titleMode = mode, visualOnly = false, submitMode = mode, originButton = null, source = "", requestedItem = null }) {
  const modal = ensureSelectionModal();
  const title = modal.querySelector(".monwui-serr-title");
  const toolbar = modal.querySelector(".monwui-serr-choice-toolbar");
  const list = modal.querySelector(".monwui-serr-choice-list");
  const submit = modal.querySelector("[data-serr-native-submit]");
  const submit4K = modal.querySelector("[data-serr-native-submit-4k]");
  const isSeasonMode = mode === "season";
  const isMovieMode = mode === "movie";
  const enable4K = plan?.serrSettings?.enable4KRequests === true || plan?.settings?.enable4KRequests === true;

  title.textContent = selectionModalTitle(mode, titleMode, submitMode);
  renderSelectionHero(modal, { mode, titleMode, submitMode, plan, items });
  if (submit4K) {
    if (enable4K) submit4K.removeAttribute("hidden");
    else submit4K.setAttribute("hidden", "hidden");
  }

  toolbar.innerHTML = `<div class="monwui-serr-choice-hint">${escapeHtml(selectionModalHint(mode, titleMode, submitMode))}</div>`;

  list.innerHTML = items.map((item, index) => {
    const seasonNumber = isSeasonMode
      ? Number(item?.IndexNumber)
      : (isMovieMode ? -1 : Number(item?.ParentIndexNumber));
    const episodeNumber = isSeasonMode ? -1 : Number(item?.IndexNumber);
    const name = isMovieMode
      ? text(item?.Name || item?.OriginalTitle, L("serrMovie", "Film"))
      : (isSeasonMode ? seasonLabel(item) : episodeLabel(item));
    const meta = isSeasonMode
      ? L("serrNativeFullSeason", "Sezonun tamamı")
      : (isMovieMode
        ? [L("serrMovie", "Film"), Number(item?.ProductionYear || readYear(item, "PremiereDate")) || ""].filter(Boolean).join(" - ")
        : `${L("season", "Sezon")} ${Number.isFinite(seasonNumber) ? seasonNumber : ""}`);
    const rowMode = isMovieMode ? "movie" : (isSeasonMode ? "season" : "episode");
    const thumb = selectionImageUrl(item, rowMode);
    const thumbBg = thumb ? ` style="background-image:url('${thumb.replace(/'/g, "%27")}')"` : "";
    const icon = selectionIcon(rowMode, titleMode);
    return `
      <label class="monwui-serr-choice-row ${rowMode === "episode" ? "is-episode" : ""} ${visualOnly ? "" : "is-selectable"}">
        <input type="checkbox" checked ${visualOnly ? "disabled aria-disabled=\"true\"" : ""} data-index="${escapeHtml(String(index))}" data-tmdb="${escapeHtml(String(tmdbId(item) || ""))}" data-season="${escapeHtml(String(seasonNumber))}" data-episode="${escapeHtml(String(episodeNumber))}" data-name="${escapeHtml(text(item?.Name))}">
        <span class="monwui-serr-choice-thumb ${rowMode === "episode" ? "is-episode" : ""}"${thumbBg}>
          <span class="material-icons ${escapeHtml(icon)}" aria-hidden="true"></span>
        </span>
        <span>
          <span class="monwui-serr-choice-name">${escapeHtml(name || `${L("content", "İçerik")} ${index + 1}`)}</span>
          <span class="monwui-serr-choice-meta">${escapeHtml(meta)}</span>
        </span>
      </label>
    `;
  }).join("");

  const handleSubmit = async (is4K = false) => {
    const checked = Array.from(list.querySelectorAll(visualOnly ? "input[type='checkbox']" : "input[type='checkbox']:checked"));
    if (!checked.length) {
      notify(L("serrSelectAtLeastOne", "En az bir seçim yapın."), "error");
      return;
    }

    const effectiveMode = submitMode || mode;
    if (effectiveMode === "collection") {
      const selectedMovies = checked
        .map((input) => items[Number(input.getAttribute("data-index"))])
        .filter(Boolean);
      await submitMovieCollection({
        plan,
        movies: selectedMovies,
        button: is4K ? submit4K : submit,
        originButton,
        source: source || "jellyfin-native-collection",
        is4K
      });
      return;
    }
    if (effectiveMode === "movie") {
      const selected = checked[0];
      const movie = selected ? (items[Number(selected.getAttribute("data-index"))] || items[0]) : items[0];
      await submitMovieRequest({ movie, button: is4K ? submit4K : submit, originButton, source: source || "jellyfin-native-movie-card", requestedItem, is4K });
      return;
    }

    const seasons = [...new Set(checked
      .map((input) => Number(input.getAttribute("data-season")))
      .filter((n) => Number.isFinite(n) && n >= 0))]
      .sort((a, b) => a - b);
    const episodes = effectiveMode === "season" ? [] : checked.map((input) => ({
      seasonNumber: Number(input.getAttribute("data-season")),
      episodeNumber: Number(input.getAttribute("data-episode")),
      name: text(input.getAttribute("data-name"))
    })).filter((entry) =>
      Number.isFinite(entry.seasonNumber) &&
      Number.isFinite(entry.episodeNumber) &&
      entry.seasonNumber >= 0 &&
      entry.episodeNumber >= 0
    );

    await submitSelection({ plan, seasons, episodes, mode: effectiveMode, button: is4K ? submit4K : submit, originButton, source, requestedItem, is4K });
  };
  submit.onclick = () => handleSubmit(false);
  if (submit4K) submit4K.onclick = () => handleSubmit(true);

  modal.style.display = "flex";
}

function openSeasonRequestModal(plan) {
  const seasonEpisodes = Array.isArray(plan?.missingSeasonEpisodes) ? plan.missingSeasonEpisodes : [];
  if (seasonEpisodes.length) {
    openSelectionModal({ mode: "episode", titleMode: "season", submitMode: "season", visualOnly: true, plan, items: seasonEpisodes });
    return;
  }
  openSelectionModal({ mode: "season", submitMode: "season", visualOnly: true, plan, items: plan.missingSeasons });
}

async function submitSelection({ plan, seasons, episodes, mode, button, originButton = null, source = "", requestedItem = null, is4K = false }) {
  const series = plan?.seriesItem || {};
  const mediaId = tmdbId(series);
  if (!mediaId) {
    notify(L("serrTmdbMissing", "TMDb ID bulunamadı. Seerr araması ile devam edin."), "error");
    return;
  }

  const old = button?.innerHTML || "";
  let completed = false;
  const access = await getSerrAccess().catch(() => null);
  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${escapeHtml(L("serrRequestSending", "Gönderiliyor..."))}</span>`;
    }
    const countText = mode === "episode" && episodes.length
      ? `${episodes.length} ${L("episode", "Bölüm")}`
      : `${seasons.length} ${L("season", "Sezon")}`;
    const result = await createSerrRequest({
      mediaType: "tv",
      mediaId,
      tvdbId: tvdbId(series),
      seasons: mode === "episode" ? [] : seasons,
      episodes,
      requestAllSeasons: false,
      is4K: is4K === true,
      title: `${text(series?.Name, L("serrTv", "Dizi"))} - ${countText}`,
      source: source || "jellyfin-native-details",
      jellyfinItemId: ""
    });

    if (result?.ok === false) {
      const err = new Error(result?.error || L("serrRequestFailed", "Seerr isteği oluşturulamadı."));
      err.payload = result;
      throw err;
    }

    if (mode === "episode" && episodes.length === 1 && accessHasSerr(access) && shouldFallbackEpisodeToArr(result)) {
      const selected = episodes[0];
      const arrResult = await requestSingleEpisodeFromArr({
        series,
        episode: {
          ParentIndexNumber: selected.seasonNumber,
          IndexNumber: selected.episodeNumber,
          Name: selected.name
        },
        is4K: is4K === true
      });
      notify(arrStatusMessage(arrResult), "success");
      if (requestedItem) requestedItem.__monwuiSerrRequested = true;
      if (originButton) markButtonRequested(originButton);
      completed = true;
      closeSelectionModal();
      try { window.dispatchEvent(new CustomEvent("monwui:serr-requests-changed")); } catch {}
      return;
    }

    notify(statusMessage(result), statusType(result));
    if (requestedItem) requestedItem.__monwuiSerrRequested = true;
    if (originButton) markButtonRequested(originButton);
    completed = true;
    closeSelectionModal();
    try { window.dispatchEvent(new CustomEvent("monwui:serr-requests-changed")); } catch {}
  } catch (error) {
    if (mode === "episode" && episodes.length === 1 && accessHasSerr(access)) {
      try {
        const selected = episodes[0];
        const arrResult = await requestSingleEpisodeFromArr({
          series,
          episode: {
            ParentIndexNumber: selected.seasonNumber,
            IndexNumber: selected.episodeNumber,
            Name: selected.name
          },
          is4K: is4K === true
        });
        notify(arrStatusMessage(arrResult), "success");
        if (requestedItem) requestedItem.__monwuiSerrRequested = true;
        if (originButton) markButtonRequested(originButton);
        completed = true;
        closeSelectionModal();
        try { window.dispatchEvent(new CustomEvent("monwui:serr-requests-changed")); } catch {}
        return;
      } catch (arrError) {
        notify(arrError?.message || requestErrorMessage(error), "error");
        return;
      }
    }
    notify(requestErrorMessage(error), "error");
  } finally {
    restoreSubmissionButton(button, old, originButton, completed);
  }
}

function removeNativeActions() {
  document.getElementById("monwui-serr-native-actions")?.remove();
  document.querySelectorAll(".monwui-serr-native-actions").forEach((node) => node.remove());
}

function removeNativeEpisodeActions() {
  document.querySelectorAll(".monwui-serr-native-episode-inline").forEach((button) => button.remove());
}

function removeNativeMissingPlaceholders() {
  document.querySelectorAll("[data-serr-missing-key]").forEach((node) => node.remove());
  document.querySelectorAll("[data-monwui-serr-missing-season-key], [data-monwui-serr-missing-episode-key], [data-monwui-serr-missing-collection-key]").forEach((node) => {
    node.removeAttribute("data-monwui-serr-missing-season-key");
    node.removeAttribute("data-monwui-serr-missing-episode-key");
    node.removeAttribute("data-monwui-serr-missing-collection-key");
    node.removeAttribute("data-monwui-serr-route-item-id");
  });
}

function resetPageState({ clearDom = false } = {}) {
  activeKey = "";
  loadingKey = "";
  lastPlan = null;
  try { activeAbort?.abort?.(); } catch {}
  activeAbort = null;
  if (clearDom) {
    removeNativeActions();
    removeNativeEpisodeActions();
    removeNativeMissingPlaceholders();
  }
}

function renderNativeActions() {
  removeNativeActions();
}

function rowLooksMissingEpisode(row, missingMap) {
  if (!row?.isConnected) return false;
  const type = text(row.getAttribute("data-type") || row.dataset?.type).toLowerCase();
  if (type !== "episode") return false;
  if (row.querySelector(".missingIndicator")) return true;
  const id = text(row.getAttribute("data-id") || row.dataset?.id);
  return !!id && missingMap.has(id);
}

function cardLooksMissingEpisode(card, missingMap) {
  if (!card?.isConnected) return false;
  const type = text(card.getAttribute("data-type") || card.dataset?.type || card.getAttribute("data-itemtype") || card.dataset?.itemtype).toLowerCase();
  if (type !== "episode") return false;
  if (card.querySelector(".missingIndicator")) return true;
  const id = text(card.getAttribute("data-id") || card.dataset?.id);
  return !!id && missingMap.has(id);
}

function findEpisodeButtonHost(row) {
  return row?.querySelector?.(".listViewUserDataButtons")
    || row?.querySelector?.(".listItem-content")
    || row;
}

function findEpisodeCardButtonHost(card) {
  return card?.querySelector?.(".cardOverlayButton-br")
    || card?.querySelector?.(".cardOverlayContainer")
    || card?.querySelector?.(".cardScalable")
    || card;
}

function fallbackEpisodeFromRow(row, plan) {
  const title = text(row?.querySelector?.(".listItemBodyText bdi")?.textContent || row?.querySelector?.(".listItemBodyText")?.textContent);
  const match = title.match(/^\s*(\d+)\s*[.)-]?\s*(.*)$/);
  const seasonNumber = Number(text(plan?.pageItem?.Type).toLowerCase() === "season" ? plan.pageItem.IndexNumber : NaN);
  return {
    Id: text(row?.getAttribute?.("data-id") || row?.dataset?.id),
    Name: match?.[2] || title || L("episode", "Bölüm"),
    OriginalTitle: match?.[2] || title || L("episode", "Bölüm"),
    ParentIndexNumber: seasonNumber,
    IndexNumber: match?.[1] ? Number(match[1]) : NaN,
    Type: "Episode",
    LocationType: "Virtual"
  };
}

function fallbackEpisodeFromCard(card, plan) {
  const prefix = text(card?.getAttribute?.("data-prefix") || card?.dataset?.prefix);
  const rawTitle = text(
    card?.querySelector?.(".textActionButton")?.getAttribute?.("title") ||
    card?.querySelector?.(".textActionButton")?.textContent ||
    card?.querySelector?.(".cardText-first")?.textContent ||
    card?.querySelector?.(".cardImageContainer")?.getAttribute?.("aria-label")
  );
  const source = `${prefix} ${rawTitle}`.trim();
  const match = source.match(/^\s*(\d+)\s*[.)-]?\s*(.*)$/);
  const seasonNumber = Number(text(plan?.pageItem?.Type).toLowerCase() === "season" ? plan.pageItem.IndexNumber : NaN);
  return {
    Id: text(card?.getAttribute?.("data-id") || card?.dataset?.id),
    Name: match?.[2] || rawTitle || L("episode", "Bölüm"),
    OriginalTitle: match?.[2] || rawTitle || L("episode", "Bölüm"),
    ParentIndexNumber: seasonNumber,
    IndexNumber: match?.[1] ? Number(match[1]) : NaN,
    Type: "Episode",
    LocationType: "Virtual"
  };
}

async function resolveEpisodeForNode(node, plan, missingMap, signal, fallbackFactory) {
  const id = text(node?.getAttribute?.("data-id") || node?.dataset?.id);
  const known = id ? missingMap.get(id) : null;
  if (known) return known;
  const fallback = fallbackFactory(node, plan);
  if (id) {
    const fetched = await fetchItemDetailsFull(id, { signal }).catch(() => null);
    if (fetched) {
      return {
        ...fallback,
        ...fetched,
        ParentIndexNumber: fetched.ParentIndexNumber ?? fallback.ParentIndexNumber,
        IndexNumber: fetched.IndexNumber ?? fallback.IndexNumber
      };
    }
  }
  return fallback;
}

function createNativeEpisodeButton({ id, requested, className, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("data-episode-id", id);
  btn.setAttribute("title", L("serrNativeRequestMissingEpisodes", "Eksik Bölüm İste"));
  btn.setAttribute("aria-label", L("serrNativeRequestMissingEpisodes", "Eksik Bölüm İste"));
  btn.innerHTML = `<span class="material-icons playlist_add" aria-hidden="true"></span>`;
  if (requested) markButtonRequested(btn);
  btn.addEventListener("click", onClick);
  return btn;
}

function renderNativeEpisodeActions(plan) {
  ensureStyles();
  const missingMap = mapMissingEpisodes(plan);
  const rows = Array.from(document.querySelectorAll('.listItem[data-type="Episode"], .listItem[data-itemtype="Episode"]'));
  const cards = Array.from(document.querySelectorAll('.card[data-type="Episode"], .card[data-itemtype="Episode"]'));
  const live = new Set();

  for (const row of rows) {
    if (!rowLooksMissingEpisode(row, missingMap)) continue;
    const id = text(row.getAttribute("data-id") || row.dataset?.id);
    if (!id) continue;
    live.add(id);
    const episodeForState = missingMap.get(id) || fallbackEpisodeFromRow(row, plan);
    const requested = isEpisodeRequested(plan, episodeForState);
    const existing = Array.from(row.querySelectorAll(".monwui-serr-native-episode-inline"))
      .find((button) => button.getAttribute("data-episode-id") === id);
    if (existing) {
      if (requested) markButtonRequested(existing);
      continue;
    }

    const host = findEpisodeButtonHost(row);
    if (!host) continue;
    const btn = createNativeEpisodeButton({
      id,
      requested,
      className: "listItemButton paper-icon-button-light emby-button monwui-serr-native-episode-inline",
      onClick: async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (btn.disabled) return;
        const abort = new AbortController();
        const episode = await resolveEpisodeForNode(row, plan, missingMap, abort.signal, fallbackEpisodeFromRow);
        await submitSingleEpisode({ plan, episode, button: btn });
      }
    });

    const menu = host.querySelector('[data-action="menu"]');
    if (menu?.parentNode === host) {
      host.insertBefore(btn, menu);
    } else {
      host.appendChild(btn);
    }
  }

  for (const card of cards) {
    if (card.classList?.contains("monwui-serr-missing-card")) continue;
    if (!cardLooksMissingEpisode(card, missingMap)) continue;
    const id = text(card.getAttribute("data-id") || card.dataset?.id);
    if (!id) continue;
    live.add(id);
    const episodeForState = missingMap.get(id) || fallbackEpisodeFromCard(card, plan);
    const requested = isEpisodeRequested(plan, episodeForState);
    const existing = Array.from(card.querySelectorAll(".monwui-serr-native-episode-inline"))
      .find((button) => button.getAttribute("data-episode-id") === id);
    if (existing) {
      if (requested) markButtonRequested(existing);
      continue;
    }

    const host = findEpisodeCardButtonHost(card);
    if (!host) continue;
    const btn = createNativeEpisodeButton({
      id,
      requested,
      className: "cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light emby-button monwui-serr-native-episode-inline",
      onClick: async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (btn.disabled) return;
        const abort = new AbortController();
        const episode = await resolveEpisodeForNode(card, plan, missingMap, abort.signal, fallbackEpisodeFromCard);
        await submitSingleEpisode({ plan, episode, button: btn });
      }
    });

    const menu = host.querySelector('[data-action="menu"]');
    if (menu?.parentNode === host) {
      host.insertBefore(btn, menu);
    } else {
      host.appendChild(btn);
    }
  }

  document.querySelectorAll(".monwui-serr-native-episode-inline").forEach((button) => {
    if (button.closest?.(".monwui-serr-missing-listitem, .monwui-serr-missing-card")) return;
    const id = text(button.getAttribute("data-episode-id"));
    if (!id || !live.has(id)) button.remove();
  });
}

function findEpisodeCardsContainer() {
  const root = activeDetailsRoot();
  const currentId = currentRouteItemId();
  const candidates = Array.from(root.querySelectorAll?.("#childrenContent .itemsContainer, .itemsContainer") || []);
  const connected = candidates.filter((node) =>
    isVisibleNode(node) &&
    !node.classList?.contains("nextUpItems") &&
    matchesSerrRouteScope(node, currentId) &&
    !!node.querySelector?.('.card[data-type="Episode"], .card[data-itemtype="Episode"]'));

  return connected.find((node) =>
    node.classList?.contains("scrollSlider") ||
    node.classList?.contains("scrollX") ||
    node.classList?.contains("animatedScrollX") ||
    node.classList?.contains("focuscontainer-x"))
    || connected[0]
    || null;
}

function missingEpisodeCardTitle(episode) {
  const episodeNumber = Number(episode?.IndexNumber);
  return `${Number.isFinite(episodeNumber) ? `${episodeNumber}. ` : ""}${text(episode?.Name, L("episode", "Bölüm"))}`;
}

function missingPlaceholderEpisodes(plan) {
  const pageType = text(plan?.pageItem?.Type).toLowerCase();
  const pageSeasonNumber = pageType === "season"
    ? Number(plan?.pageItem?.IndexNumber)
    : (pageType === "episode" ? Number(plan?.pageItem?.ParentIndexNumber) : NaN);
  const items = [
    ...(Array.isArray(plan?.missingSeasonEpisodes) ? plan.missingSeasonEpisodes : []),
    ...(Array.isArray(plan?.missingEpisodes) ? plan.missingEpisodes : [])
  ];
  const episodes = Number.isFinite(pageSeasonNumber)
    ? items.filter((episode) => Number(episode?.ParentIndexNumber) === pageSeasonNumber)
    : items;
  return dedupeEpisodes(episodes);
}

function renderMissingEpisodeCards(plan, container) {
  const rendered = renderedEpisodeNumbers(container);
  const episodes = missingPlaceholderEpisodes(plan)
    .filter((episode) => !rendered.has(Number(episode.IndexNumber)));
  const key = `${placeholderScopeKey(plan, "episode-card")}|${episodes.map((episode) => `${Number(episode.ParentIndexNumber)}:${Number(episode.IndexNumber)}:${isEpisodeRequested(plan, episode) ? 1 : 0}`).join("|")}`;
  const nodes = episodes.map((episode) => createMissingPosterCard({
    key: `episode:${Number(episode.ParentIndexNumber)}:${Number(episode.IndexNumber)}`,
    type: "Episode",
    title: missingEpisodeCardTitle(episode),
    subtitle: `${L("season", "Sezon")} ${Number(episode?.ParentIndexNumber)}`,
    poster: episode?.StillPath,
    icon: "playlist_add",
    requested: isEpisodeRequested(plan, episode),
    buttonTitle: L("serrNativeRequestMissingEpisodes", "Eksik Bölüm İste"),
    cardClassName: "card overflowBackdropCard card-hoverable card-withuserdata",
    padderClassName: "cardPadder-overflowBackdrop",
    onClick: async (event, controls = {}) => {
      await submitSingleEpisode({ plan, episode, button: controls.button });
    }
  }));
  setContainerPlaceholders(container, ".monwui-serr-missing-card[data-type='Episode']", "data-monwui-serr-missing-episode-key", key, nodes);
}

function renderMissingEpisodeListItems(plan, container) {
  const rendered = renderedEpisodeNumbers(container);
  const episodes = missingPlaceholderEpisodes(plan)
    .filter((episode) => !rendered.has(Number(episode.IndexNumber)));
  const key = `${placeholderScopeKey(plan, "episode")}|${episodes.map((episode) => `${Number(episode.ParentIndexNumber)}:${Number(episode.IndexNumber)}:${isEpisodeRequested(plan, episode) ? 1 : 0}`).join("|")}`;
  const nodes = episodes.map((episode) => createMissingEpisodeListItem({
    plan,
    episode,
    requested: isEpisodeRequested(plan, episode)
  }));
  setContainerPlaceholders(container, ".monwui-serr-missing-listitem", "data-monwui-serr-missing-episode-key", key, nodes);
}

function findChildrenItemsContainer(mode) {
  const root = activeDetailsRoot();
  const currentId = currentRouteItemId();
  const expectedType = mode === "vertical-wrap" ? "Season" : (mode === "vertical-list" ? "Episode" : "");
  const candidates = Array.from(root.querySelectorAll?.("#childrenContent .itemsContainer") || []);
  const scoped = candidates.find((node) =>
    isVisibleNode(node) &&
    node.classList?.contains(mode) &&
    (!expectedType || !!node.querySelector?.(`[data-type="${expectedType}"], [data-itemtype="${expectedType}"]`)) &&
    (!node.getAttribute("data-monwui-serr-route-item-id") || node.getAttribute("data-monwui-serr-route-item-id") === currentId))
    || null;
  if (scoped) return scoped;

  const fallback = Array.from(root.querySelectorAll?.(".itemsContainer") || []);
  return fallback.find((node) =>
    isVisibleNode(node) &&
    node.classList?.contains(mode) &&
    !node.classList?.contains("nextUpItems") &&
    (!expectedType || !!node.querySelector?.(`[data-type="${expectedType}"], [data-itemtype="${expectedType}"]`)) &&
    (!node.getAttribute("data-monwui-serr-route-item-id") || node.getAttribute("data-monwui-serr-route-item-id") === currentId))
    || null;
}

function matchesSerrRouteScope(node, currentId = currentRouteItemId()) {
  if (!node) return false;
  const scopedId = node.getAttribute?.("data-monwui-serr-route-item-id");
  return !scopedId || scopedId === currentId;
}

function findSeasonCardsContainer() {
  const root = activeDetailsRoot();
  const currentId = currentRouteItemId();
  const modes = ["vertical-wrap", "scrollX"];
  for (const mode of modes) {
    const container = findChildrenItemsContainer(mode);
    if (
      container &&
      container.querySelector?.('.card[data-type="Season"], .card[data-itemtype="Season"]')
    ) {
      return container;
    }
  }

  const candidates = Array.from(root.querySelectorAll?.("#childrenContent .itemsContainer, .itemsContainer") || []);
  return candidates.find((node) =>
    isVisibleNode(node) &&
    !node.classList?.contains("nextUpItems") &&
    matchesSerrRouteScope(node, currentId) &&
    !!node.querySelector?.('.card[data-type="Season"], .card[data-itemtype="Season"]')
  ) || null;
}

function findSeasonListContainer() {
  const root = activeDetailsRoot();
  const currentId = currentRouteItemId();
  const listContainer = findChildrenItemsContainer("vertical-list");
  if (
    listContainer &&
    listContainer.querySelector?.('.listItem[data-type="Season"], .listItem[data-itemtype="Season"]')
  ) {
    return listContainer;
  }

  const candidates = Array.from(root.querySelectorAll?.("#childrenContent .itemsContainer, .itemsContainer") || []);
  return candidates.find((node) =>
    isVisibleNode(node) &&
    !node.classList?.contains("nextUpItems") &&
    matchesSerrRouteScope(node, currentId) &&
    !!node.querySelector?.('.listItem[data-type="Season"], .listItem[data-itemtype="Season"]')
  ) || null;
}

function findCollectionItemsContainer(plan = null) {
  const collectionId = text(plan?.pageItem?.Id);
  const root = activeDetailsRoot();
  const currentId = currentRouteItemId();
  const candidates = Array.from(root.querySelectorAll?.([
    "#childrenContent .itemsContainer.collectionItemsContainer",
    ".itemsContainer.collectionItemsContainer",
    "#childrenContent .itemsContainer.vertical-wrap",
    ".itemsContainer.vertical-wrap"
  ].join(",")) || []);

  const connected = candidates.filter((node) =>
    isVisibleNode(node) &&
    (!node.getAttribute("data-monwui-serr-route-item-id") || node.getAttribute("data-monwui-serr-route-item-id") === currentId));

  if (collectionId) {
    const withCollectionCards = connected.find((node) =>
      node.classList?.contains("vertical-wrap") &&
      Array.from(node.querySelectorAll?.(".card[data-collectionid]") || [])
        .some((card) => text(card.getAttribute("data-collectionid") || card.dataset?.collectionid) === collectionId));
    if (withCollectionCards) return withCollectionCards;

    const hasOtherCollectionCards = connected.some((node) =>
      Array.from(node.querySelectorAll?.(".card[data-collectionid]") || [])
        .some((card) => text(card.getAttribute("data-collectionid") || card.dataset?.collectionid)));
    if (hasOtherCollectionCards) return null;
  }

  const withCollectionClass = connected.find((node) =>
    node.classList?.contains("collectionItemsContainer") &&
    node.classList?.contains("vertical-wrap"));
  if (withCollectionClass) return withCollectionClass;

  return connected.find((node) =>
    node.classList?.contains("vertical-wrap") &&
    !!node.querySelector?.('.card[data-type="Movie"], .card[data-itemtype="Movie"]'))
    || null;
}

function renderedSeasonNumbers(container) {
  const numbers = new Set();
  container?.querySelectorAll?.('.card[data-type="Season"]:not(.monwui-serr-missing-card), .card[data-itemtype="Season"]:not(.monwui-serr-missing-card)')
    .forEach((card) => {
      const prefix = text(card.getAttribute("data-prefix") || card.dataset?.prefix);
      const label = text(card.querySelector(".cardText")?.textContent || card.getAttribute("aria-label"));
      const match = `${prefix} ${label}`.match(/(\d+)/);
      const n = match ? Number(match[1]) : NaN;
      if (isRequestableSeasonNumber(n)) numbers.add(n);
    });
  container?.querySelectorAll?.('.listItem[data-type="Season"]:not(.monwui-serr-missing-listitem), .listItem[data-itemtype="Season"]:not(.monwui-serr-missing-listitem)')
    .forEach((row) => {
      const label = text(row.querySelector(".listItemBodyText bdi")?.textContent || row.querySelector(".listItemBodyText")?.textContent);
      const match = label.match(/(\d+)/);
      const n = match ? Number(match[1]) : NaN;
      if (isRequestableSeasonNumber(n)) numbers.add(n);
    });
  return numbers;
}

function renderedEpisodeNumbers(container) {
  const numbers = new Set();
  container?.querySelectorAll?.('.listItem[data-type="Episode"]:not(.monwui-serr-missing-listitem), .listItem[data-itemtype="Episode"]:not(.monwui-serr-missing-listitem)')
    .forEach((row) => {
      const title = text(row.querySelector(".listItemBodyText bdi")?.textContent || row.querySelector(".listItemBodyText")?.textContent);
      const match = title.match(/^\s*(\d+)/);
      const n = match ? Number(match[1]) : NaN;
      if (Number.isFinite(n) && n >= 0) numbers.add(n);
    });
  container?.querySelectorAll?.('.card[data-type="Episode"]:not(.monwui-serr-missing-card), .card[data-itemtype="Episode"]:not(.monwui-serr-missing-card)')
    .forEach((card) => {
      const prefix = text(card.getAttribute("data-prefix") || card.dataset?.prefix);
      const title = text(
        card.querySelector(".textActionButton")?.getAttribute?.("title") ||
        card.querySelector(".textActionButton")?.textContent ||
        card.querySelector(".cardText-first")?.textContent ||
        card.querySelector(".cardImageContainer")?.getAttribute?.("aria-label")
      );
      const match = `${prefix} ${title}`.match(/^\s*(\d+)/);
      const n = match ? Number(match[1]) : NaN;
      if (Number.isFinite(n) && n >= 0) numbers.add(n);
    });
  return numbers;
}

function setContainerPlaceholders(container, selector, attrName, key, nodes) {
  if (!container) return;
  const current = container.getAttribute(attrName) || "";
  const existing = Array.from(container.querySelectorAll(selector));
  if (current === key && existing.length === nodes.length) return;
  existing.forEach((node) => node.remove());
  if (nodes.length) {
    const frag = document.createDocumentFragment();
    nodes.forEach((node) => frag.appendChild(node));
    container.appendChild(frag);
  }
  container.setAttribute(attrName, key);
  container.setAttribute("data-monwui-serr-route-item-id", currentRouteItemId());
}

function placeholderScopeKey(plan, scope) {
  const id = text(
    plan?.pageItem?.Id ||
    plan?.seriesItem?.Id ||
    plan?.collectionId ||
    currentRouteItemId()
  );
  return `${scope}:${text(plan?.kind || plan?.pageItem?.Type || "item").toLowerCase()}:${id}`;
}

function createMissingPosterCard({
  key,
  type,
  title,
  subtitle = "",
  poster = "",
  icon = "playlist_add",
  requested = false,
  buttonTitle,
  onClick,
  cardClassName = "card overflowPortraitCard card-hoverable card-withuserdata",
  padderClassName = "cardPadder-overflowPortrait"
}) {
  const card = document.createElement("div");
  card.className = `${cardClassName} monwui-serr-missing-card`;
  card.setAttribute("data-serr-missing-key", key);
  card.setAttribute("data-type", type);
  card.setAttribute("data-action", "none");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("title", buttonTitle);
  if (requested) {
    card.setAttribute("data-serr-requested", "1");
    card.classList.add("monwui-serr-requested");
  }
  const missingBadge = L("serrMissingBadge", "Eksik");
  const actionTitle = requested ? L("serrStatusRequested", "İstendi") : buttonTitle;
  const actionIcon = requested
    ? `<span class="material-icons check" aria-hidden="true"></span>`
    : `<span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover playlist_add" aria-hidden="true"></span>`;
  const disabledAttr = requested ? " disabled aria-disabled=\"true\"" : "";

  card.innerHTML = `
    <div class="cardBox cardBox-bottompadded">
      <div class="monwui-serr-missing-cardRow">
        <div class="cardScalable monwui-serr-missing-cardMedia">
          <div class="cardPadder ${escapeHtml(padderClassName)} lazy-hidden-children"></div>
          <div class="cardImageContainer coveredImage cardContent monwui-serr-missing-card-image" role="img" aria-label="${escapeHtml(title)}">
            <span class="monwui-serr-missing-badge">${escapeHtml(missingBadge)}</span>
            <span class="material-icons ${escapeHtml(icon)} monwui-serr-missing-card-icon" aria-hidden="true"></span>
          </div>
          <div class="monwui-serr-missing-cardAction">
            <button is="paper-icon-button-light" type="button" class="paper-icon-button-light monwui-serr-native-card-btn" title="${escapeHtml(actionTitle)}" aria-label="${escapeHtml(actionTitle)}"${disabledAttr}>
              ${actionIcon}
            </button>
          </div>
        </div>
      </div>
      <div class="cardText cardTextCentered cardText-first"><bdi>${escapeHtml(title)}</bdi></div>
      ${subtitle ? `<div class="cardText cardTextCentered secondary"><bdi>${escapeHtml(subtitle)}</bdi></div>` : ""}
    </div>
  `;

  const image = card.querySelector(".monwui-serr-missing-card-image");
  const url = imageUrl(poster, type === "Movie" ? "w342" : "w300");
  if (url && image) {
    image.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
  }

  const button = card.querySelector(".monwui-serr-native-card-btn");
  const run = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isAlreadyRequestedNode(card, button)) return;
    await onClick?.(event, { card, button });
  };

  button?.addEventListener("click", run);
  card.addEventListener("click", async (event) => {
    if (event.target?.closest?.("button,a,input,label")) return;
    await run(event);
  });
  card.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    await run(event);
  });
  return card;
}

function createMissingEpisodeListItem({ plan, episode, requested = false }) {
  const seasonNumber = Number(episode?.ParentIndexNumber);
  const episodeNumber = Number(episode?.IndexNumber);
  const title = `${Number.isFinite(episodeNumber) ? `${episodeNumber}. ` : ""}${text(episode?.Name, L("episode", "Bölüm"))}`;
  const overview = text(episode?.Overview);
  const item = document.createElement("div");
  item.className = "listItem listItem-largeImage listItem-withContentWrapper monwui-serr-missing-listitem";
  if (requested) item.classList.add("monwui-serr-requested");
  item.setAttribute("data-action", "none");
  item.setAttribute("data-isfolder", "false");
  item.setAttribute("data-type", "Episode");
  item.setAttribute("data-mediatype", "Video");
  item.setAttribute("data-serr-missing-key", `episode:${seasonNumber}:${episodeNumber}`);
  if (requested) item.setAttribute("data-serr-requested", "1");
  const missingBadge = L("serrMissingBadge", "Eksik");
  const actionTitle = requested
    ? L("serrStatusRequested", "İstendi")
    : L("serrNativeRequestMissingEpisodes", "Eksik Bölüm İste");
  const actionIcon = requested
    ? `<span class="material-icons check" aria-hidden="true"></span>`
    : `<span class="material-icons playlist_add" aria-hidden="true"></span>`;
  const disabledAttr = requested ? " disabled aria-disabled=\"true\"" : "";

  item.innerHTML = `
    <div class="listItem-content">
      <div class="listItemImage listItemImage-large monwui-serr-missing-thumb" item-icon="">
        <span class="monwui-serr-missing-badge">${escapeHtml(missingBadge)}</span>
        <span class="material-icons playlist_add monwui-serr-missing-card-icon" aria-hidden="true"></span>
      </div>
      <div class="listItemBody">
        <div class="listItemBodyText"><bdi>${escapeHtml(title)}</bdi></div>
        <div class="secondary listItemMediaInfo listItemBodyText">
          <div class="mediaInfoItem">${escapeHtml(`${L("season", "Sezon")} ${Number.isFinite(seasonNumber) ? seasonNumber : ""}`)}</div>
          <div class="mediaInfoItem">${escapeHtml(L("serrStatusRequested", "İstendi"))}</div>
        </div>
        ${overview ? `<div class="secondary listItem-overview listItemBodyText"><bdi>${escapeHtml(overview)}</bdi></div>` : ""}
      </div>
      <div class="listViewUserDataButtons">
        <button is="paper-icon-button-light" type="button" class="listItemButton paper-icon-button-light emby-button monwui-serr-native-episode-inline" title="${escapeHtml(actionTitle)}" aria-label="${escapeHtml(actionTitle)}"${disabledAttr}>
          ${actionIcon}
        </button>
      </div>
    </div>
    ${overview ? `<div class="listItem-bottomoverview secondary"><bdi>${escapeHtml(overview)}</bdi></div>` : ""}
  `;

  const still = imageUrl(episode?.StillPath, "w500");
  const thumb = item.querySelector(".monwui-serr-missing-thumb");
  if (still && thumb) thumb.style.backgroundImage = `url("${still.replace(/"/g, "%22")}")`;

  const btn = item.querySelector(".monwui-serr-native-episode-inline");
  btn?.setAttribute("data-episode-id", text(episode?.Id));
  btn?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isAlreadyRequestedNode(item, btn)) return;
    await submitSingleEpisode({ plan, episode, button: btn });
  });
  return item;
}

function createMissingSeasonListItem({ plan, season, requested = false }) {
  const seasonNumber = Number(season?.IndexNumber);
  const title = seasonLabel(season);
  const subtitle = season?.ChildCount
    ? `${season.ChildCount} ${L("episode", "Bölüm")}`
    : L("serrNativeFullSeason", "Sezonun tamamı");
  const item = document.createElement("div");
  item.className = "listItem listItem-largeImage listItem-withContentWrapper monwui-serr-missing-listitem";
  if (requested) item.classList.add("monwui-serr-requested");
  item.setAttribute("data-action", "none");
  item.setAttribute("data-isfolder", "true");
  item.setAttribute("data-type", "Season");
  item.setAttribute("data-serr-missing-key", `season:${seasonNumber}`);
  if (requested) item.setAttribute("data-serr-requested", "1");
  const missingBadge = L("serrMissingBadge", "Eksik");
  const actionTitle = requested
    ? L("serrStatusRequested", "İstendi")
    : L("serrNativeRequestMissingSeasons", "Eksik Sezon İste");
  const actionIcon = requested
    ? `<span class="material-icons check" aria-hidden="true"></span>`
    : `<span class="material-icons folder" aria-hidden="true"></span>`;
  const disabledAttr = requested ? " disabled aria-disabled=\"true\"" : "";

  item.innerHTML = `
    <div class="listItem-content">
      <div class="listItemImage listItemImage-large monwui-serr-missing-thumb" item-icon="">
        <span class="monwui-serr-missing-badge">${escapeHtml(missingBadge)}</span>
        <span class="material-icons folder monwui-serr-missing-card-icon" aria-hidden="true"></span>
      </div>
      <div class="listItemBody">
        <div class="listItemBodyText"><bdi>${escapeHtml(title)}</bdi></div>
        <div class="secondary listItemMediaInfo listItemBodyText">
          <div class="mediaInfoItem">${escapeHtml(subtitle)}</div>
        </div>
      </div>
      <div class="listViewUserDataButtons">
        <button is="paper-icon-button-light" type="button" class="listItemButton paper-icon-button-light emby-button monwui-serr-native-episode-inline" title="${escapeHtml(actionTitle)}" aria-label="${escapeHtml(actionTitle)}"${disabledAttr}>
          ${actionIcon}
        </button>
      </div>
    </div>
  `;

  const poster = imageUrl(season?.PosterPath, "w300");
  const thumb = item.querySelector(".monwui-serr-missing-thumb");
  if (poster && thumb) thumb.style.backgroundImage = `url("${poster.replace(/"/g, "%22")}")`;

  const btn = item.querySelector(".monwui-serr-native-episode-inline");
  btn?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isAlreadyRequestedNode(item, btn)) return;
    await openSeasonCardRequest({ plan, season, button: btn });
  });
  return item;
}

function renderMissingSeasonListItems(plan, container) {
  const rendered = renderedSeasonNumbers(container);
  const seasons = (plan?.missingSeasons || [])
    .filter((season) => isRequestableSeasonNumber(season?.IndexNumber))
    .filter((season) => !rendered.has(Number(season.IndexNumber)));
  const key = `${placeholderScopeKey(plan, "season-list")}|${seasons.map((season) => `${Number(season.IndexNumber)}:${isSeasonRequested(plan, season) ? 1 : 0}`).join("|")}`;
  const nodes = seasons.map((season) => createMissingSeasonListItem({
    plan,
    season,
    requested: isSeasonRequested(plan, season)
  }));
  setContainerPlaceholders(container, ".monwui-serr-missing-listitem[data-serr-missing-key^='season:']", "data-monwui-serr-missing-season-key", key, nodes);
}

function renderMissingSeasonCards(plan) {
  const cardContainer = findSeasonCardsContainer();
  if (cardContainer) {
    const rendered = renderedSeasonNumbers(cardContainer);
    const seasons = (plan?.missingSeasons || [])
      .filter((season) => isRequestableSeasonNumber(season?.IndexNumber))
      .filter((season) => !rendered.has(Number(season.IndexNumber)));
    const key = `${placeholderScopeKey(plan, "season")}|${seasons.map((season) => `${Number(season.IndexNumber)}:${isSeasonRequested(plan, season) ? 1 : 0}`).join("|")}`;
    const nodes = seasons.map((season) => createMissingPosterCard({
      key: `season:${Number(season.IndexNumber)}`,
      type: "Season",
      title: seasonLabel(season),
      subtitle: season?.ChildCount ? `${season.ChildCount} ${L("episode", "Bölüm")}` : L("serrNativeFullSeason", "Sezonun tamamı"),
      poster: season?.PosterPath,
      icon: "folder",
      requested: isSeasonRequested(plan, season),
      buttonTitle: L("serrNativeRequestMissingSeasons", "Eksik Sezon İste"),
      onClick: async (event, controls = {}) => {
        await openSeasonCardRequest({ plan, season, button: controls.button });
      }
    }));
    setContainerPlaceholders(cardContainer, ".monwui-serr-missing-card[data-type='Season']", "data-monwui-serr-missing-season-key", key, nodes);
    return;
  }

  const listContainer = findSeasonListContainer();
  if (listContainer) {
    renderMissingSeasonListItems(plan, listContainer);
    return;
  }

  if ((plan?.missingSeasons || []).length) scheduleScan(500);
}

function renderMissingEpisodePlaceholders(plan) {
  const listContainer = findChildrenItemsContainer("vertical-list");
  const cardContainer = findEpisodeCardsContainer();
  const episodes = missingPlaceholderEpisodes(plan);
  let rendered = false;

  if (listContainer) {
    renderMissingEpisodeListItems(plan, listContainer);
    rendered = true;
  }
  if (cardContainer && cardContainer !== listContainer) {
    renderMissingEpisodeCards(plan, cardContainer);
    rendered = true;
  }
  if (!rendered && episodes.length) scheduleScan(500);
}

function renderMissingCollectionCards(plan) {
  const container = findCollectionItemsContainer(plan);
  if (!container) {
    if ((plan?.missingCollectionItems || []).length) scheduleScan(500);
    return;
  }
  const renderedKeys = localCollectionMovieKeySet(getRenderedCollectionMovies(container));
  const movies = (Array.isArray(plan?.missingCollectionItems) ? plan.missingCollectionItems : [])
    .filter((movie) => !isCollectionMoviePresent(movie, renderedKeys));
  const key = `${placeholderScopeKey(plan, "collection")}|${movies.map((movie) => {
    const id = tmdbId(movie);
    return id ? `${id}:${isMovieRequested(plan, movie) ? 1 : 0}` : "";
  }).filter(Boolean).join("|")}`;
  const nodes = movies.map((movie) => {
    const year = Number(movie?.ProductionYear);
    return createMissingPosterCard({
      key: `movie:${tmdbId(movie)}`,
      type: "Movie",
      title: text(movie?.Name, L("serrMovie", "Film")),
      subtitle: Number.isFinite(year) ? String(year) : L("serrMovie", "Film"),
      poster: movie?.PosterPath,
      icon: "movie",
      requested: isMovieRequested(plan, movie),
      buttonTitle: L("serrRequestButton", "İste"),
      cardClassName: "card portraitCard card-hoverable card-withuserdata",
      padderClassName: "cardPadder-portrait",
      onClick: async (event, controls = {}) => {
        await submitCollectionMovie({ plan, movie, button: controls.button });
      }
    });
  });
  setContainerPlaceholders(container, ".monwui-serr-missing-card[data-type='Movie']", "data-monwui-serr-missing-collection-key", key, nodes);
}

function renderPlan(host, plan) {
  if (!plan) return;
  ensureStyles();
  if (plan.kind === "collection") {
    removeNativeActions();
    removeNativeEpisodeActions();
    document.querySelectorAll("[data-serr-missing-key].monwui-serr-missing-listitem, [data-serr-missing-key].monwui-serr-missing-card[data-type='Season']").forEach((node) => node.remove());
    document.querySelectorAll("[data-monwui-serr-missing-season-key], [data-monwui-serr-missing-episode-key]").forEach((node) => {
      node.removeAttribute("data-monwui-serr-missing-season-key");
      node.removeAttribute("data-monwui-serr-missing-episode-key");
    });
    renderMissingCollectionCards(plan);
    return;
  }
  document.querySelectorAll("[data-serr-missing-key].monwui-serr-missing-card[data-type='Movie']").forEach((node) => node.remove());
  document.querySelectorAll("[data-monwui-serr-missing-collection-key]").forEach((node) => {
    node.removeAttribute("data-monwui-serr-missing-collection-key");
  });
  renderNativeActions();
  renderNativeEpisodeActions(plan);
  renderMissingSeasonCards(plan);
  renderMissingEpisodePlaceholders(plan);
}

async function openSeasonCardRequest({ plan, season, button }) {
  const mediaId = tmdbId(plan?.seriesItem || {});
  const seasonNumber = Number(season?.IndexNumber);
  if (!mediaId) {
    notify(L("serrTmdbMissing", "TMDb ID bulunamadı. Seerr araması ile devam edin."), "error");
    return;
  }
  if (!isRequestableSeasonNumber(seasonNumber)) {
    notify(L("serrRequestFailed", "Seerr isteği oluşturulamadı."), "error");
    return;
  }

  if (!(await shouldConfirmRequests(plan))) {
    await submitSelection({
      plan,
      seasons: [seasonNumber],
      episodes: [],
      mode: "season",
      button,
      originButton: button,
      source: "jellyfin-native-season-card"
    });
    return;
  }

  const old = button?.innerHTML || "";
  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `<span class="material-icons sync" aria-hidden="true"></span>`;
    }
    const access = await getSerrAccess().catch(() => null);
    const seasonDetails = access?.enabled
      ? await getSerrTvSeasonDetails(mediaId, seasonNumber, { language: serrLanguage(access) }).catch(() => null)
      : null;
    const episodes = normalizeSerrSeasonDetails(seasonDetails, seasonNumber).episodes;
    if (episodes.length) {
      openSelectionModal({ mode: "episode", titleMode: "season", submitMode: "season", visualOnly: true, plan, items: episodes });
      return;
    }
    openSelectionModal({ mode: "season", submitMode: "season", visualOnly: true, plan, items: [season] });
  } catch (error) {
    notify(requestErrorMessage(error), "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = old;
    }
  }
}

async function submitSingleSeason({ plan, season, button }) {
  const seasonNumber = Number(season?.IndexNumber);
  if (!isRequestableSeasonNumber(seasonNumber)) {
    notify(L("serrRequestFailed", "Seerr isteği oluşturulamadı."), "error");
    return;
  }
  await submitSelection({
    plan,
    seasons: [seasonNumber],
    episodes: [],
    mode: "season",
    button,
    originButton: button,
    source: "jellyfin-native-season-card"
  });
}

async function submitCollectionMovie({ plan, movie, button }) {
  if (!(await shouldConfirmRequests(plan))) {
    await submitMovieRequest({
      movie,
      button,
      originButton: button,
      source: "jellyfin-native-collection-card"
    });
    return;
  }

  openSelectionModal({
    mode: "movie",
    titleMode: "movie",
    submitMode: "movie",
    visualOnly: true,
    plan,
    items: [movie],
    originButton: button,
    source: "jellyfin-native-collection-card"
  });
}

async function requestCollectionMovieBackend(movie, { source = "jellyfin-native-collection", access = null, is4K = false } = {}) {
  const mediaId = tmdbId(movie);
  if (!mediaId) {
    throw new Error(L("serrTmdbMissing", "TMDb ID bulunamadı. Seerr araması ile devam edin."));
  }

  const title = text(movie?.Name, L("serrMovie", "Film"));
  try {
    const result = await createSerrRequest({
      mediaType: "movie",
      mediaId,
      seasons: [],
      episodes: [],
      requestAllSeasons: false,
      is4K: is4K === true,
      title,
      source,
      jellyfinItemId: ""
    });
    if (result?.ok === false) {
      const err = new Error(result?.error || L("serrRequestFailed", "Seerr isteği oluşturulamadı."));
      err.payload = result;
      throw err;
    }
    if (accessHasSerr(access) && shouldFallbackMovieToArr(result)) {
      return await requestMovieFromArr(movie, { tmdbId: mediaId, title, is4K: is4K === true });
    }
    return result;
  } catch (error) {
    if (accessHasSerr(access) && !isJellyfinAlreadyAvailableError(error)) {
      return await requestMovieFromArr(movie, { tmdbId: mediaId, title, is4K: is4K === true });
    }
    throw error;
  }
}

async function submitMovieCollection({ plan = null, movies = [], button, originButton = null, source = "jellyfin-native-collection", is4K = false } = {}) {
  const list = [];
  const seen = new Set();
  for (const movie of Array.isArray(movies) ? movies : []) {
    const id = tmdbId(movie);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push(movie);
  }
  if (!list.length) {
    notify(L("serrSelectAtLeastOne", "En az bir seçim yapın."), "error");
    return;
  }

  const old = button?.innerHTML || "";
  const requestState = planRequestState(plan);
  const access = await getSerrAccess().catch(() => null);
  let completed = 0;
  let skipped = 0;
  const failed = [];

  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${escapeHtml(L("serrRequestSending", "Gönderiliyor..."))}</span>`;
    }

    for (const movie of list) {
      const id = tmdbId(movie);
      if (id > 0 && requestState.movieIds?.has?.(id)) {
        skipped += 1;
        continue;
      }
      try {
        await requestCollectionMovieBackend(movie, { source, access, is4K });
        completed += 1;
        if (id > 0) requestState.movieIds?.add?.(id);
        movie.__monwuiSerrRequested = true;
      } catch (error) {
        if (isJellyfinAlreadyAvailableError(error)) {
          skipped += 1;
          continue;
        }
        failed.push({
          title: text(movie?.Name, L("serrMovie", "Film")),
          message: requestErrorMessage(error)
        });
      }
    }

    const parts = [];
    if (completed) parts.push(`${completed} ${L("serrMovie", "Film")} ${L("serrBulkRequestSent", "isteği gönderildi")}.`);
    if (skipped) parts.push(`${skipped} ${L("serrBulkRequestSkipped", "atlandı")}.`);
    if (failed.length) parts.push(`${failed.length} ${L("serrBulkRequestFailed", "gönderilemedi")}.`);
    notify(parts.join(" ") || L("serrRequestCreatedToast", "İstek oluşturuldu."), failed.length && !completed ? "error" : "success");

    if (completed) {
      try { window.dispatchEvent(new CustomEvent("monwui:serr-requests-changed")); } catch {}
      if (!failed.length) {
        if (originButton) markButtonRequested(originButton);
        closeSelectionModal();
      }
    }
    return { completed, skipped, failedCount: failed.length };
  } finally {
    restoreSubmissionButton(button, old, originButton, completed > 0 && !failed.length);
  }
}

async function submitMovieRequest({ movie, button, originButton = null, source = "jellyfin-native-movie-card", requestedItem = null, is4K = false }) {
  const mediaId = tmdbId(movie);
  if (!mediaId) {
    notify(L("serrTmdbMissing", "TMDb ID bulunamadı. Seerr araması ile devam edin."), "error");
    return;
  }

  const old = button?.innerHTML || "";
  let completed = false;
  const access = await getSerrAccess().catch(() => null);
  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${escapeHtml(L("serrRequestSending", "Gönderiliyor..."))}</span>`;
    }
    const result = await createSerrRequest({
      mediaType: "movie",
      mediaId,
      seasons: [],
      episodes: [],
      requestAllSeasons: false,
      is4K: is4K === true,
      title: text(movie?.Name, L("serrMovie", "Film")),
      source,
      jellyfinItemId: ""
    });
    if (result?.ok === false) {
      const err = new Error(result?.error || L("serrRequestFailed", "Seerr isteği oluşturulamadı."));
      err.payload = result;
      throw err;
    }
    if (accessHasSerr(access) && shouldFallbackMovieToArr(result)) {
      await requestMovieFallbackFromArr(movie, { tmdbId: mediaId, title: text(movie?.Name, L("serrMovie", "Film")), is4K: is4K === true });
      if (requestedItem) requestedItem.__monwuiSerrRequested = true;
      if (originButton) markButtonRequested(originButton);
      completed = true;
      restoreSubmissionButton(button, old, originButton, completed);
      closeSelectionModal();
      try { window.dispatchEvent(new CustomEvent("monwui:serr-requests-changed")); } catch {}
      return;
    }
    notify(statusMessage(result), statusType(result));
    if (requestedItem) requestedItem.__monwuiSerrRequested = true;
    if (originButton) markButtonRequested(originButton);
    completed = true;
    restoreSubmissionButton(button, old, originButton, completed);
    closeSelectionModal();
    try { window.dispatchEvent(new CustomEvent("monwui:serr-requests-changed")); } catch {}
  } catch (error) {
    if (accessHasSerr(access) && !isJellyfinAlreadyAvailableError(error)) {
      try {
        await requestMovieFallbackFromArr(movie, { tmdbId: mediaId, title: text(movie?.Name, L("serrMovie", "Film")), is4K: is4K === true });
        if (requestedItem) requestedItem.__monwuiSerrRequested = true;
        if (originButton) markButtonRequested(originButton);
        completed = true;
        restoreSubmissionButton(button, old, originButton, completed);
        closeSelectionModal();
        try { window.dispatchEvent(new CustomEvent("monwui:serr-requests-changed")); } catch {}
        return;
      } catch (arrError) {
        restoreSubmissionButton(button, old, originButton, completed);
        notify(arrError?.message || requestErrorMessage(error), "error");
        return;
      }
    }
    restoreSubmissionButton(button, old, originButton, completed);
    notify(requestErrorMessage(error), "error");
  }
}

async function submitSingleEpisode({ plan, episode, button }) {
  const series = plan?.seriesItem || {};
  const mediaId = tmdbId(series);
  const seasonNumber = Number(episode?.ParentIndexNumber);
  const episodeNumber = Number(episode?.IndexNumber);
  if (!mediaId) {
    notify(L("serrTmdbMissing", "TMDb ID bulunamadı. Seerr araması ile devam edin."), "error");
    return;
  }
  if (!isRequestableEpisodeSeasonNumber(seasonNumber) || !Number.isFinite(episodeNumber) || episodeNumber < 0) {
    notify(L("serrRequestFailed", "Seerr isteği oluşturulamadı."), "error");
    return;
  }

  if (!(await shouldConfirmRequests(plan))) {
    await submitSelection({
      plan,
      seasons: [],
      episodes: [{
        seasonNumber,
        episodeNumber,
        name: episodeOriginalTitle(episode)
      }],
      mode: "episode",
      button,
      originButton: button,
      source: "jellyfin-native-episode-row"
    });
    return;
  }

  openSelectionModal({
    mode: "episode",
    titleMode: "episode",
    submitMode: "episode",
    visualOnly: true,
    plan,
    items: [episode],
    originButton: button,
    source: "jellyfin-native-episode-row"
  });
}

// Fork ParticularFlix 4.0.0.2: outside an item page every scan (each DOM change on the Home, plus every 1.5 s) cleared
// the page again with six document-wide queries, although nothing had been placed since the last clear. Once the
// page is clean the bridge stays idle until an item page shows up.
let outsideClean = false;
function hashLooksLikeDetails() {
  const hash = String(window.location.hash || "").toLowerCase();
  return hash.includes("details");
}
function clearOutsideOnce() {
  if (outsideClean && !activeItemId) return;
  activeItemId = "";
  resetPageState({ clearDom: true });
  outsideClean = true;
}

async function scan() {
  if (!isDetailsRoute()) {
    clearOutsideOnce();
    return;
  }

  const itemId = currentRouteItemId();
  if (!itemId) {
    clearOutsideOnce();
    return;
  }
  outsideClean = false;

  if (activeItemId !== itemId) {
    activeItemId = itemId;
    resetPageState({ clearDom: true });
  }

  const host = findNativeHost();
  if (!host) return;

  const access = await getSerrAccess().catch(() => null);
  if (!access?.enabled) {
    resetPageState({ clearDom: true });
    return;
  }

  const key = `${itemId}:${host.isConnected ? "host" : "nohost"}`;
  if (activeKey === key && lastPlan?.routeItemId === itemId) {
    renderPlan(host, lastPlan);
    return;
  }
  if (loadingKey === key) return;
  if (activeKey !== key) {
    lastPlan = null;
    try { activeAbort?.abort?.(); } catch {}
    activeAbort = null;
  }

  activeKey = key;
  loadingKey = key;
  activeAbort = new AbortController();
  const signal = activeAbort.signal;

  try {
    const item = await fetchItemDetailsFull(itemId, { signal });
    if (signal.aborted || currentRouteItemId() !== itemId || !item) return;

    const type = text(item?.Type).toLowerCase();
    if (!accessCanHandleDetails(access, type)) {
      resetPageState({ clearDom: true });
      return;
    }
    if (type === "boxset") {
      const [collectionPlan, requestState] = await Promise.all([
        buildExternalCollectionMissingPlan(item, { access, signal }).catch(() => null),
        getRequestState().catch(() => emptyRequestState())
      ]);
      if (signal.aborted || currentRouteItemId() !== itemId) return;
      lastPlan = {
        ...(collectionPlan || { kind: "collection", pageItem: item, missingCollectionItems: [] }),
        requestState,
        routeItemId: itemId,
        serrSettings: access?.settings || {}
      };
      renderPlan(host, lastPlan);
      return;
    }

    if (!["series", "season", "episode"].includes(type)) {
      resetPageState({ clearDom: true });
      return;
    }

    const seriesItem = type === "series"
      ? item
      : await fetchItemDetailsFull(item.SeriesId, { signal });
    if (signal.aborted || currentRouteItemId() !== itemId || !seriesItem?.Id) return;

    const [seasons, seriesEpisodes] = await Promise.all([
      fetchSeasons(seriesItem.Id, { signal }).catch(() => []),
      fetchEpisodes(seriesItem.Id, { signal }).catch(() => [])
    ]);
    if (signal.aborted || currentRouteItemId() !== itemId) return;

    const seasonEpisodes = await fetchSeasonEpisodesForMissingCheck(seasons, { signal }).catch(() => []);
    if (signal.aborted || currentRouteItemId() !== itemId) return;
    const episodeMap = new Map();
    for (const episode of [...seriesEpisodes, ...seasonEpisodes]) {
      episodeMap.set(episodeKey(episode), episode);
    }
    const episodes = Array.from(episodeMap.values());
    const basePlan = buildMissingPlan(seriesItem, seasons, episodes, item);
    const [externalPlan, requestState] = await Promise.all([
      buildExternalSeriesMissingPlan(seriesItem, seasons, item, { access, signal, episodes }).catch(() => null),
      getRequestState().catch(() => emptyRequestState())
    ]);
    if (signal.aborted || currentRouteItemId() !== itemId) return;
    const plan = {
      ...mergeSeriesPlan(basePlan, externalPlan),
      requestState,
      routeItemId: itemId,
      serrSettings: access?.settings || {}
    };
    lastPlan = plan;
    renderPlan(host, plan);
  } finally {
    if (loadingKey === key) loadingKey = "";
  }
}

function scheduleScan(delay = 220) {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scan().catch(() => {});
  }, delay);
}

function handleSerrRequestsChanged() {
  invalidateRequestState();
  resetPageState();
  scheduleScan(120);
}

function handleRouteChanged() {
  outsideClean = false;
  activeItemId = "";
  resetPageState({ clearDom: true });
  scheduleScan(120);
  setTimeout(() => scheduleScan(0), 700);
  setTimeout(() => scheduleScan(0), 1600);
}

export function initSerrItemPageBridge() {
  if (!moduleEnabled()) return null;
  if (booted) return;
  booted = true;
  scheduleScan(200);
  const wanted = () => !outsideClean || hashLooksLikeDetails();
  pollTimer = setInterval(() => { if (wanted()) scheduleScan(0); }, 1500);
  observer = new MutationObserver(() => { if (wanted()) scheduleScan(220); });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
  window.addEventListener("hashchange", handleRouteChanged);
  window.addEventListener("popstate", handleRouteChanged);
  window.addEventListener("monwui:serr-requests-changed", handleSerrRequestsChanged);

  return () => {
    booted = false;
    clearInterval(pollTimer);
    clearTimeout(scanTimer);
    observer?.disconnect?.();
    observer = null;
    try { activeAbort?.abort?.(); } catch {}
    activeAbort = null;
    activeKey = "";
    activeItemId = "";
    loadingKey = "";
    lastPlan = null;
    window.removeEventListener("hashchange", handleRouteChanged);
    window.removeEventListener("popstate", handleRouteChanged);
    window.removeEventListener("monwui:serr-requests-changed", handleSerrRequestsChanged);
    removeNativeActions();
    removeNativeEpisodeActions();
    removeNativeMissingPlaceholders();
  };
}
