// ParticularFlix fork: fontes alternativas para a lista do slider principal.
//
// O slider original monta a lista com UMA unica consulta /Users/{id}/Items?...
// Para series, PremiereDate e DateCreated pertencem a serie inteira, entao uma
// temporada ou episodio novo nao muda a posicao. Este modulo monta a lista a
// partir de varias consultas e mistura o resultado com uma data efetiva unica.
//
// Modos:
//   query            comportamento original (consulta unica configurada na tela)
//   currentReleases  somente lancamentos atuais, ordenados pela data em que o
//                    conteudo foi ADICIONADO no Jellyfin (filmes + series)
//   premieres        lancamentos recentes ordenados pela DATA DE ESTREIA, onde
//                    a estreia de uma temporada conta como lancamento da serie
//
// Este arquivo nao depende de DOM nem de outros modulos, para poder ser testado
// com node.

export const SOURCE_MODE_QUERY = "query";
export const SOURCE_MODE_CURRENT_RELEASES = "currentReleases";
export const SOURCE_MODE_PREMIERES = "premieres";

const VALID_MODES = new Set([
  SOURCE_MODE_QUERY,
  SOURCE_MODE_CURRENT_RELEASES,
  SOURCE_MODE_PREMIERES
]);

export const DEFAULT_WINDOW_MONTHS = 6;
const EPISODE_QUERY_LIMIT = 300;
const MOVIE_QUERY_LIMIT = 200;
const SEASON_QUERY_LIMIT = 200;

export function normalizeSourceMode(value) {
  const raw = String(value || "").trim();
  return VALID_MODES.has(raw) ? raw : SOURCE_MODE_QUERY;
}

export function normalizeWindowMonths(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_MONTHS;
  return Math.max(1, Math.min(60, n));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateOnly(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthsAgo(now, months) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setMonth(d.getMonth() - months);
  return d;
}

// currentReleases: ano atual OU ultimos N meses, o que for mais abrangente
//                  (evita lista vazia em janeiro).
// premieres:       somente os ultimos N meses.
export function computeWindowStart(mode, now, windowMonths) {
  const months = normalizeWindowMonths(windowMonths);
  const byMonths = monthsAgo(now, months);
  if (mode === SOURCE_MODE_CURRENT_RELEASES) {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return toDateOnly(startOfYear < byMonths ? startOfYear : byMonths);
  }
  return toDateOnly(byMonths);
}

// Fim da janela: amanha, para nao incluir estreias futuras mas aceitar o dia de hoje
// em qualquer fuso.
export function computeWindowEnd(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + 1);
  return toDateOnly(d);
}

function encodeFields(list) {
  return encodeURIComponent(list.join(","));
}

export function buildSourceRequests({ mode, userId, now = new Date(), windowMonths = DEFAULT_WINDOW_MONTHS } = {}) {
  const safeMode = normalizeSourceMode(mode);
  if (safeMode === SOURCE_MODE_QUERY) return [];

  const min = computeWindowStart(safeMode, now, windowMonths);
  const max = computeWindowEnd(now);
  const base = `/Users/${userId}/Items`;
  const range = `MinPremiereDate=${min}&MaxPremiereDate=${max}`;
  const fields = encodeFields(["PremiereDate", "DateCreated"]);

  if (safeMode === SOURCE_MODE_CURRENT_RELEASES) {
    return [
      {
        key: "movies",
        url: `${base}?IncludeItemTypes=Movie&Recursive=true&hasOverview=true&${range}&SortBy=DateCreated&SortOrder=Descending&Limit=${MOVIE_QUERY_LIMIT}&Fields=${fields}&EnableTotalRecordCount=false`
      },
      {
        key: "episodes",
        url: `${base}?IncludeItemTypes=Episode&Recursive=true&${range}&SortBy=DateCreated&SortOrder=Descending&Limit=${EPISODE_QUERY_LIMIT}&Fields=${fields}&EnableTotalRecordCount=false`
      }
    ];
  }

  return [
    {
      key: "movies",
      url: `${base}?IncludeItemTypes=Movie&Recursive=true&hasOverview=true&${range}&SortBy=PremiereDate&SortOrder=Descending&Limit=${MOVIE_QUERY_LIMIT}&Fields=${fields}&EnableTotalRecordCount=false`
    },
    {
      key: "seasons",
      url: `${base}?IncludeItemTypes=Season&Recursive=true&${range}&SortBy=PremiereDate&SortOrder=Descending&Limit=${SEASON_QUERY_LIMIT}&Fields=${fields}&EnableTotalRecordCount=false`
    }
  ];
}

function ts(value) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : NaN;
}

function itemsOf(result) {
  return Array.isArray(result?.Items) ? result.Items : [];
}

// Converte os resultados das consultas em descritores ordenados.
// Descritor de filme:  { kind: "Movie",  id, effectiveDate, item }
// Descritor de serie:  { kind: "Series", id (SeriesId), effectiveDate, seasonNumber, episodeNumber, isNewSeason }
export function mergeSourceResults(mode, results) {
  const safeMode = normalizeSourceMode(mode);
  const descriptors = [];

  const dateField = safeMode === SOURCE_MODE_CURRENT_RELEASES ? "DateCreated" : "PremiereDate";

  itemsOf(results?.movies).forEach((item) => {
    const t = ts(item?.[dateField]);
    if (!item?.Id || Number.isNaN(t)) return;
    descriptors.push({ kind: "Movie", id: item.Id, effectiveDate: t, item });
  });

  if (safeMode === SOURCE_MODE_CURRENT_RELEASES) {
    const bySeries = new Map();
    itemsOf(results?.episodes).forEach((ep) => {
      const seriesId = ep?.SeriesId;
      const season = ep?.ParentIndexNumber;
      const t = ts(ep?.DateCreated);
      if (!seriesId || Number.isNaN(t)) return;
      if (season === 0) return; // especiais nao contam como lancamento
      const current = bySeries.get(seriesId);
      if (!current || t > current.effectiveDate) {
        bySeries.set(seriesId, {
          kind: "Series",
          id: seriesId,
          effectiveDate: t,
          seasonNumber: Number.isFinite(season) ? season : null,
          episodeNumber: Number.isFinite(ep?.IndexNumber) ? ep.IndexNumber : null,
          isNewSeason: false
        });
      }
    });
    bySeries.forEach((d) => descriptors.push(d));
  } else {
    const bySeries = new Map();
    itemsOf(results?.seasons).forEach((season) => {
      const seriesId = season?.SeriesId;
      const t = ts(season?.PremiereDate);
      if (!seriesId || Number.isNaN(t)) return;
      if (season?.IndexNumber === 0) return; // temporada de especiais
      const current = bySeries.get(seriesId);
      if (!current || t > current.effectiveDate) {
        bySeries.set(seriesId, {
          kind: "Series",
          id: seriesId,
          effectiveDate: t,
          seasonNumber: Number.isFinite(season?.IndexNumber) ? season.IndexNumber : null,
          episodeNumber: null,
          isNewSeason: true
        });
      }
    });
    bySeries.forEach((d) => descriptors.push(d));
  }

  descriptors.sort((a, b) => b.effectiveDate - a.effectiveDate);
  return descriptors;
}

async function mapLimit(arr, limit, mapper) {
  const out = new Array(arr.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, arr.length || 1)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= arr.length) return;
      out[i] = await mapper(arr[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Carrega a lista final de itens (Movie e Series) na ordem correta.
//   fetchJson(url)        -> resposta da API (com cache, fornecido pelo main.js)
//   fetchItemDetails(id)  -> detalhes completos do item (com cache)
//   resolveLimit          -> quantos itens completos a lista final deve ter, no maximo
//   itemFilter(item)      -> filtro opcional aplicado ao item completo (por exemplo, exigir
//                            capa de fundo e logo). Os candidatos sao resolvidos em lotes,
//                            na ordem de data, ate juntar itens suficientes que passem no
//                            filtro; assim os titulos mais novos, ainda sem imagens, nao
//                            esvaziam a lista.
//   maxResolve            -> teto de itens resolvidos (protege contra excesso de requisicoes)
export async function loadSourceItems({
  mode,
  userId,
  now = new Date(),
  windowMonths = DEFAULT_WINDOW_MONTHS,
  fetchJson,
  fetchItemDetails,
  resolveLimit = 60,
  concurrency = 4,
  itemFilter = null,
  maxResolve = 240,
  // Fork ParticularFlix 3.8.2.40: pede os detalhes dos candidatos em lote (poucas requisicoes grandes)
  // antes de resolver um a um; resolveOne passa a achar tudo no cache.
  prefetchDetails = null
} = {}) {
  const requests = buildSourceRequests({ mode, userId, now, windowMonths });
  if (!requests.length) return [];

  const responses = await Promise.all(
    requests.map(async (req) => {
      try {
        return [req.key, await fetchJson(req.url)];
      } catch (err) {
        console.warn(`[JMS] fonte '${req.key}' falhou:`, err);
        return [req.key, { Items: [] }];
      }
    })
  );
  const results = Object.fromEntries(responses);

  const candidates = mergeSourceResults(mode, results).slice(0, Math.max(1, maxResolve));
  const wanted = Math.max(1, resolveLimit);
  const batchSize = Math.max(concurrency * 4, 16);
  const safeMode = normalizeSourceMode(mode);

  const resolveOne = async (d) => {
    try {
      const detail = await fetchItemDetails(d.id);
      const source = detail || (d.kind === "Movie" ? d.item : null);
      if (!source || !source.Id) return null;
      const base = { ...source }; // copia: o objeto em cache nao pode carregar a marca de outro modo
      // marca de origem usada pela interface (por exemplo, selo "Nova temporada")
      base.__jmsSourceMeta = {
        mode: safeMode,
        effectiveDate: new Date(d.effectiveDate).toISOString(),
        seasonNumber: d.seasonNumber ?? null,
        episodeNumber: d.episodeNumber ?? null,
        isNewSeason: !!d.isNewSeason
      };
      return base;
    } catch (err) {
      console.warn("[JMS] falha ao resolver item da fonte:", d.id, err);
      return d.kind === "Movie" ? d.item : null;
    }
  };

  if (typeof prefetchDetails === "function") {
    try {
      const prefetchIds = candidates.slice(0, wanted).map((d) => d?.id).filter(Boolean);
      if (prefetchIds.length) await prefetchDetails(prefetchIds);
    } catch (err) {
      console.debug("[JMS] prefetch em lote dos detalhes falhou, seguindo item a item:", err);
    }
  }

  const out = [];
  let cursor = 0;
  while (out.length < wanted && cursor < candidates.length) {
    const slice = candidates.slice(cursor, cursor + batchSize);
    cursor += batchSize;
    const resolved = await mapLimit(slice, concurrency, resolveOne);
    for (const item of resolved) {
      if (!item) continue;
      if (typeof itemFilter === "function" && !itemFilter(item)) continue;
      out.push(item);
      if (out.length >= wanted) break;
    }
  }

  console.debug("[JMS] fonte do slider:", safeMode, "candidatos:", candidates.length, "resolvidos ate:", Math.min(cursor, candidates.length), "aceitos:", out.length);
  return out;
}
