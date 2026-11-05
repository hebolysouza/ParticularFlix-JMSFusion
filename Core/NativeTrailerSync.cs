using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core;

public enum NativeTrailerMode
{
    Simulate,
    Real
}

// Fork ParticularFlix 4.0.0.10: o que o download precisa de um titulo. Vem de um item do Jellyfin (tarefa agendada) ou
// so da pasta (deteccao em tempo real, antes de o Jellyfin catalogar): sem ano/TMDb, eles saem do nome da pasta e da
// busca no TMDb, como ja acontecia com itens sem metadados.
public sealed record TrailerTarget(string Folder, bool IsSeries, int? Year, string? TmdbId);

/// <summary>
/// Porta fiel do script JMSFusion-trailers-sync.ps1 (v3): TMDb + pt-BR primeiro.
/// Ordem: A (TMDb pt oficial), B (YouTube pt dublado, depois legendado), C (TMDb en oficial),
/// C2 (IMDb), D (YouTube en). Se nada passar nas validacoes, nao baixa nada.
/// O log vai somente para o log do Jellyfin (nenhum arquivo txt).
/// </summary>
public sealed class NativeTrailerSync
{
    private const string BlockChannel = "claro|looke|vivo play|telecine|google play|oi play|itunes";
    private const string BlockTitle = "alugue|aluguel|compre agora";
    private const string RejectTitle = "(?i)(review|reaction|fan made|concept|breakdown|ending explained|podcast|vlog|unboxing|recap|open matte|extended trailer)";
    private static readonly string FilterSuffix = " & channel !~=? (?i)(" + BlockChannel + ") & title !~= (?i)(" + BlockTitle + ")";
    // Cookies do YouTube (opcional): variavel de ambiente JMSFUSION_COOKIES ou /config/cookies.txt.
    private static readonly string[] CookiesCandidates =
    {
        Environment.GetEnvironmentVariable("JMSFUSION_COOKIES") ?? string.Empty,
        "/config/cookies.txt"
    };
    private static readonly string[] VideoExtensions = { ".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".ts" };
    private static readonly HttpClient Http = CreateHttp();

    private static readonly SemaphoreSlim RunLock = new(1, 1);
    private static readonly ConcurrentDictionary<string, DateTime> LastFailure = new(StringComparer.Ordinal);
    private static readonly TimeSpan RetryAfterFailure = TimeSpan.FromHours(5);

    // Fork ParticularFlix 4.0.0.8: trailers em AV1 baixados antes da 4.0.0.3 (ou quando o YouTube nao tinha H.264) sao
    // decodificados na CPU por placas sem AV1 em hardware (RX 6400: 99% de CPU com o trailer do slider). A tarefa
    // agendada refaz esses trailers, poucos por execucao, guardando o arquivo antigo ate o novo estar pronto.
    private const int MaxCodecUpgradesPerRun = 40;
    private const string UpgradeBackupPrefix = ".jms-av1-";
    private const string UpgradeBackupSuffix = ".bak";
    private static readonly TimeSpan UpgradeRetryAfterFailure = TimeSpan.FromHours(12);
    private static readonly ConcurrentDictionary<string, DateTime> UpgradeBlockedUntil = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, (long Size, DateTime Mtime, string Codec, int Height)> CodecCache = new(StringComparer.Ordinal);

    // Fork ParticularFlix 4.0.0.10: na 4.0.0.8 tres trailers AV1 1080p viraram H.264 240p/360p/480p (o video so tinha
    // H.264 em baixa resolucao) e os trocados ocupam o dobro do AV1 com o disco da biblioteca quase cheio. Agora:
    // H.264/VP9 so a partir de 720p (abaixo disso fica o AV1 de maior resolucao), o trailer novo so fica se for melhor
    // que o antigo, trailers H.264/VP9 abaixo de 720p tambem sao revistos, e nada e baixado sem folga de disco.
    private const int MinGoodHeight = 720;
    private const long UpgradeMinFreeMb = 20L * 1024;
    private const long DownloadMinFreeMb = 2L * 1024;
    private const string KeepMarkerName = ".jms-trailer-keep";
    private static readonly TimeSpan KeepMarkerValidity = TimeSpan.FromDays(30);

    // Pastas sendo processadas agora (tarefa agendada ou tempo real), para os dois caminhos nunca baixarem o mesmo trailer.
    private static readonly ConcurrentDictionary<string, byte> InProgress = new(StringComparer.Ordinal);
    private static readonly SemaphoreSlim RealtimeLock = new(1, 1);
    private static readonly HashSet<string> ExtrasFolderNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "extras", "featurettes", "behind the scenes", "deleted scenes", "interviews", "scenes", "shorts", "trailers", "other", "samples", "clips"
    };

    private readonly ILibraryManager _libraryManager;
    private readonly TrailerAutomationService _tools;
    private readonly ILogger _logger;

    public NativeTrailerSync(ILibraryManager libraryManager, TrailerAutomationService tools, ILogger logger)
    {
        _libraryManager = libraryManager;
        _tools = tools;
        _logger = logger;
    }

    private static HttpClient CreateHttp()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
        http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("en-US,en;q=0.9");
        return http;
    }

    private void Log(string message) => _logger.LogInformation("[JMS trailers] {Mensagem}", message);

    public async Task RunAsync(NativeTrailerMode mode, bool sample, int limit, string tmdbKey, bool retryFailed, IProgress<double> progress, CancellationToken ct, bool upgradeCodecs = false)
    {
        if (!await RunLock.WaitAsync(0, ct).ConfigureAwait(false))
        {
            Log("Ja existe uma sincronizacao de trailers em andamento; esta execucao foi dispensada.");
            progress.Report(100);
            return;
        }

        try
        {
            await RunCoreAsync(mode, sample, limit, tmdbKey, retryFailed, upgradeCodecs, progress, ct).ConfigureAwait(false);
        }
        finally
        {
            RunLock.Release();
        }
    }

    // Fork ParticularFlix 4.0.0.10: deteccao em tempo real (TrailerWatcher). Baixa so o trailer das pastas novas, sem
    // esperar o Jellyfin catalogar o titulo e sem atualizar o yt-dlp (isso fica com a tarefa agendada). Roda em paralelo
    // com a tarefa agendada; uma pasta nunca e processada pelos dois ao mesmo tempo.
    public async Task RunForFoldersAsync(IReadOnlyList<TrailerTarget> targets, string tmdbKey, CancellationToken ct)
    {
        await RealtimeLock.WaitAsync(ct).ConfigureAwait(false);
        string? cookies = null;
        try
        {
            TrailerAutomationService.NativeToolkit? toolkit = null;
            foreach (var t in targets)
            {
                ct.ThrowIfCancellationRequested();
                if (string.IsNullOrWhiteSpace(t.Folder) || IsExcludedPath(t.Folder) || !Directory.Exists(t.Folder))
                {
                    continue;
                }

                var leaf = new DirectoryInfo(t.Folder).Name;
                if (HasFinishedTrailer(t.Folder))
                {
                    continue;
                }

                // Filme: a pasta tem de ser a do proprio filme. Se uma subpasta tiver video, e uma pasta de colecao
                // (varios filmes dentro) e o trailer nao vai para ela.
                if (!t.IsSeries && HasVideoInSubfolders(t.Folder))
                {
                    continue;
                }

                var free = FreeMbFor(t.Folder);
                if (free >= 0 && free < DownloadMinFreeMb)
                {
                    Log("Tempo real: " + leaf + " sem trailer, mas so " + FormatGb(free) + " livres; fica para a tarefa agendada.");
                    continue;
                }

                if (!CanWrite(t.Folder))
                {
                    Log("Tempo real: " + leaf + " sem permissao de escrita para o usuario do Jellyfin; trailer nao baixado.");
                    continue;
                }

                if (!InProgress.TryAdd(t.Folder, 0))
                {
                    continue;
                }

                try
                {
                    Log("Tempo real: titulo novo detectado (" + (t.IsSeries ? "serie" : "filme") + "): " + leaf + "; buscando trailer.");
                    if (toolkit is null)
                    {
                        toolkit = await _tools.PrepareNativeToolkitAsync(false, ct).ConfigureAwait(false);
                        cookies = CopyCookies();
                    }

                    if (await ProcessItemAsync(t, toolkit, cookies, tmdbKey, false, ct).ConfigureAwait(false))
                    {
                        LastFailure.TryRemove(t.Folder, out _);
                    }
                    else
                    {
                        LastFailure[t.Folder] = DateTime.UtcNow;
                    }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("[JMS trailers] ERRO em tempo real em {Pasta}: {Erro}", leaf, ex.Message);
                }
                finally
                {
                    InProgress.TryRemove(t.Folder, out _);
                }
            }
        }
        finally
        {
            if (cookies != null)
            {
                TryDelete(cookies);
            }

            RealtimeLock.Release();
        }
    }

    // Copia temporaria do cookies.txt (o yt-dlp regrava o arquivo); null se nao houver cookies ou a copia falhar.
    private string? CopyCookies()
    {
        var original = CookiesCandidates.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c) && File.Exists(c));
        if (original == null)
        {
            return null;
        }

        try
        {
            var copy = Path.Combine(Path.GetTempPath(), "jms-cookies-" + Guid.NewGuid().ToString("N") + ".txt");
            File.Copy(original, copy, true);
            return copy;
        }
        catch (Exception ex)
        {
            Log("Aviso: nao consegui copiar o cookies.txt (" + ex.Message + "); seguindo sem cookies.");
            return null;
        }
    }

    private async Task RunCoreAsync(NativeTrailerMode mode, bool sample, int limit, string tmdbKey, bool retryFailed, bool upgradeCodecs, IProgress<double> progress, CancellationToken ct)
    {
        var simulate = mode == NativeTrailerMode.Simulate;
        var all = _libraryManager.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series },
            IsVirtualItem = false,
            Recursive = true
        });

        var work = new List<BaseItem>();
        var withTrailer = new List<(BaseItem Item, string Folder, string File)>();
        var skippedReadOnly = 0;
        var skippedRecent = 0;
        foreach (var item in all)
        {
            if (string.IsNullOrWhiteSpace(item.Path) || IsExcludedPath(item.Path))
            {
                continue;
            }

            var folder = GetItemFolder(item);
            if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
            {
                continue;
            }

            if (!simulate)
            {
                RecoverUpgradeBackup(folder);
            }

            if (!sample && HasFinishedTrailer(folder))
            {
                if (upgradeCodecs && !simulate)
                {
                    var existing = FindTrailerFile(folder);
                    if (existing != null)
                    {
                        withTrailer.Add((item, folder, existing));
                    }
                }

                continue;
            }

            if (!simulate)
            {
                if (!retryFailed && LastFailure.TryGetValue(folder, out var when) && DateTime.UtcNow - when < RetryAfterFailure)
                {
                    skippedRecent++;
                    continue;
                }

                if (!CanWrite(folder))
                {
                    skippedReadOnly++;
                    continue;
                }
            }

            work.Add(item);
        }

        var count = Math.Min(work.Count, limit);
        Log((simulate ? "SIMULACAO" : "SINCRONIZACAO") + ": " + all.Count.ToString(CultureInfo.InvariantCulture)
            + " itens na biblioteca, " + work.Count.ToString(CultureInfo.InvariantCulture)
            + (sample ? " elegiveis (amostra, com ou sem trailer)" : " sem trailer")
            + ", processando " + count.ToString(CultureInfo.InvariantCulture) + ". Biblioteca adulta fora.");

        if (skippedReadOnly > 0 || skippedRecent > 0)
        {
            Log("Ignorados: " + skippedReadOnly.ToString(CultureInfo.InvariantCulture) + " em pasta somente leitura e "
                + skippedRecent.ToString(CultureInfo.InvariantCulture) + " que falharam ha menos de 5 horas.");
        }

        var upgrades = withTrailer.Count > 0
            ? await FindTrailersToUpgradeAsync(withTrailer, ct).ConfigureAwait(false)
            : new List<(BaseItem Item, string Folder, string File)>();
        var total = count + upgrades.Count;

        if (total == 0)
        {
            progress.Report(100);
            return;
        }

        if (!simulate)
        {
            Log("Verificando atualizacoes automaticas do yt-dlp...");
        }

        var toolkit = await _tools.PrepareNativeToolkitAsync(!simulate, ct).ConfigureAwait(false);
        Log("yt-dlp " + (toolkit.YtDlpVersion ?? "?") + ", deno " + (toolkit.DenoVersion ?? "?")
            + ", ffmpeg " + (toolkit.FfmpegDir ?? "nao encontrado"));

        var cookiesOriginal = CookiesCandidates.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c) && File.Exists(c));
        string? cookies = null;
        if (cookiesOriginal == null)
        {
            Log("Aviso: cookies.txt do YouTube nao encontrado; o YouTube pode recusar alguns videos.");
        }
        else
        {
            // O yt-dlp regrava o arquivo de cookies; trabalha numa copia para nunca alterar (nem falhar em) o original.
            try
            {
                cookies = Path.Combine(Path.GetTempPath(), "jms-cookies-" + Guid.NewGuid().ToString("N") + ".txt");
                File.Copy(cookiesOriginal, cookies, true);
                Log("Cookies do YouTube: " + cookiesOriginal + " (copia temporaria)");
            }
            catch (Exception ex)
            {
                cookies = null;
                Log("Aviso: nao consegui copiar o cookies.txt (" + ex.Message + "); seguindo sem cookies.");
            }
        }

        var found = 0;
        for (var i = 0; i < count; i++)
        {
            ct.ThrowIfCancellationRequested();
            if (!simulate)
            {
                var freeNow = FreeMbFor(GetItemFolder(work[i]) ?? string.Empty);
                if (freeNow >= 0 && freeNow < DownloadMinFreeMb)
                {
                    Log("Downloads de trailer pausados: so " + FormatGb(freeNow) + " livres no disco da biblioteca (minimo "
                        + FormatGb(DownloadMinFreeMb) + "). Os itens restantes ficam para a proxima execucao.");
                    break;
                }
            }

            try
            {
                var folderKey = GetItemFolder(work[i]) ?? string.Empty;
                if (!simulate && !InProgress.TryAdd(folderKey, 0))
                {
                    Log("Pasta ja em processamento pela deteccao em tempo real: " + new DirectoryInfo(folderKey).Name);
                    continue;
                }

                bool ok;
                try
                {
                    ok = await ProcessItemAsync(TargetOf(work[i]), toolkit, cookies, tmdbKey, simulate, ct).ConfigureAwait(false);
                }
                finally
                {
                    if (!simulate)
                    {
                        InProgress.TryRemove(folderKey, out _);
                    }
                }

                if (ok)
                {
                    found++;
                    LastFailure.TryRemove(folderKey, out _);
                }
                else if (!simulate)
                {
                    LastFailure[folderKey] = DateTime.UtcNow;
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                if (cookies != null)
                {
                    TryDelete(cookies);
                }

                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("[JMS trailers] ERRO em {Nome}: {Erro}", work[i].Name, ex.Message);
            }

            progress.Report((i + 1) * 100.0 / total);
        }

        var upgraded = 0;
        for (var j = 0; j < upgrades.Count; j++)
        {
            ct.ThrowIfCancellationRequested();
            var up = upgrades[j];
            var freeUp = FreeMbFor(up.Folder);
            if (freeUp >= 0 && freeUp < UpgradeMinFreeMb)
            {
                Log("Troca de trailers pausada: so " + FormatGb(freeUp) + " livres no disco da biblioteca (minimo "
                    + FormatGb(UpgradeMinFreeMb) + " para trocar). Volta sozinha quando houver espaco.");
                break;
            }

            if (!InProgress.TryAdd(up.Folder, 0))
            {
                continue;
            }

            try
            {
                Log("Trocando trailer AV1 ou de baixa resolucao: " + new DirectoryInfo(up.Folder).Name
                    + " (livre: " + (freeUp >= 0 ? FormatGb(freeUp) : "?") + ")");
                if (await UpgradeTrailerAsync(up.Item, up.Folder, up.File, toolkit, cookies, tmdbKey, ct).ConfigureAwait(false))
                {
                    upgraded++;
                }
                else
                {
                    UpgradeBlockedUntil[up.Folder] = DateTime.UtcNow + UpgradeRetryAfterFailure;
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                if (cookies != null)
                {
                    TryDelete(cookies);
                }

                throw;
            }
            catch (Exception ex)
            {
                UpgradeBlockedUntil[up.Folder] = DateTime.UtcNow + UpgradeRetryAfterFailure;
                _logger.LogWarning("[JMS trailers] ERRO ao trocar o trailer AV1 de {Nome}: {Erro}", up.Item.Name, ex.Message);
            }
            finally
            {
                InProgress.TryRemove(up.Folder, out _);
            }

            progress.Report((count + j + 1) * 100.0 / total);
        }

        if (upgrades.Count > 0)
        {
            Log("Troca de trailers AV1: " + upgraded.ToString(CultureInfo.InvariantCulture) + " de "
                + upgrades.Count.ToString(CultureInfo.InvariantCulture) + " refeitos nesta execucao (o antigo volta se o novo falhar).");
        }

        if (cookies != null)
        {
            TryDelete(cookies);
        }

        Log((simulate ? "Simulacao concluida" : "Sincronizacao concluida") + ": trailer "
            + (simulate ? "encontrado" : "baixado") + " em " + found.ToString(CultureInfo.InvariantCulture)
            + " de " + count.ToString(CultureInfo.InvariantCulture) + " itens.");
        progress.Report(100);
    }

    private static TrailerTarget TargetOf(BaseItem item)
    {
        return new TrailerTarget(GetItemFolder(item)!, item is Series, item.ProductionYear, item.GetProviderId(MetadataProvider.Tmdb));
    }

    private async Task<bool> ProcessItemAsync(TrailerTarget target, TrailerAutomationService.NativeToolkit tk, string? cookies, string tmdbKey, bool simulate, CancellationToken ct)
    {
        var isSeries = target.IsSeries;
        var kind = isSeries ? "tv" : "movie";
        var folder = target.Folder;
        var leaf = new DirectoryInfo(folder).Name;

        if (!isSeries && CountVideoFiles(folder) > 1)
        {
            Log("Pasta ignorada (varios videos na mesma pasta, nao parece uma pasta de filme): " + leaf);
            return false;
        }

        if (!simulate)
        {
            if (!CanWrite(folder))
            {
                Log("Pasta somente leitura ou sem permissao de escrita, ignorada: " + leaf);
                return false;
            }

            foreach (var part in Directory.EnumerateFiles(folder, "trailer.*.part"))
            {
                TryDelete(part);
            }
        }

        var yearInt = target.Year ?? 0;
        var m = Regex.Match(leaf, @"\b(19\d\d|20\d\d)\b");
        if (yearInt == 0 && m.Success)
        {
            yearInt = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        }

        var yearFolder = m.Success ? m.Groups[1].Value : string.Empty;
        var cleanTitle = Regex.Replace(leaf, @"\s*\(\d{4}\).*", string.Empty);
        cleanTitle = Regex.Replace(cleanTitle, @"(?i)\b(WEBDL|WEB-DL|HDR|BluRay|REMUX|1080p|720p|4K|UHD|AAC|H\.264|x264|x265|DDP5\.1|Atmos)\b.*", string.Empty).Trim();

        // 1) ID do TMDb: Jellyfin primeiro, busca por titulo + ano como plano B
        var tmdbId = target.TmdbId;
        var origem = "Jellyfin";
        if (string.IsNullOrWhiteSpace(tmdbId))
        {
            var url = "https://api.themoviedb.org/3/search/" + kind + "?api_key=" + Uri.EscapeDataString(tmdbKey)
                + "&query=" + Uri.EscapeDataString(cleanTitle) + "&language=pt-BR";
            if (!string.IsNullOrEmpty(yearFolder))
            {
                url += (isSeries ? "&first_air_date_year=" : "&year=") + yearFolder;
            }

            var s = await GetJsonAsync(url, ct).ConfigureAwait(false);
            var first = s?["results"]?.AsArray().FirstOrDefault();
            var id = first == null ? null : (int?)first["id"];
            if (id.HasValue)
            {
                tmdbId = id.Value.ToString(CultureInfo.InvariantCulture);
                origem = "busca TMDb";
            }
        }

        // 2) Titulos e ano oficiais
        string? ptTitle = null, enTitle = null, origTitle = null;
        var tmdbYear = 0;
        if (!string.IsNullOrWhiteSpace(tmdbId))
        {
            var ptInfo = await GetJsonAsync("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + Uri.EscapeDataString(tmdbKey) + "&language=pt-BR", ct).ConfigureAwait(false);
            var enInfo = await GetJsonAsync("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + Uri.EscapeDataString(tmdbKey) + "&language=en-US", ct).ConfigureAwait(false);
            if (ptInfo != null)
            {
                ptTitle = (string?)ptInfo[isSeries ? "name" : "title"];
                origTitle = (string?)ptInfo[isSeries ? "original_name" : "original_title"];
                var d = (string?)ptInfo[isSeries ? "first_air_date" : "release_date"];
                if (!string.IsNullOrEmpty(d) && d.Length >= 4 && int.TryParse(d.AsSpan(0, 4), NumberStyles.Integer, CultureInfo.InvariantCulture, out var ty))
                {
                    tmdbYear = ty;
                }
            }

            if (enInfo != null)
            {
                enTitle = (string?)enInfo[isSeries ? "name" : "title"];
            }
        }

        if (string.IsNullOrWhiteSpace(enTitle)) { enTitle = cleanTitle; }
        if (string.IsNullOrWhiteSpace(ptTitle)) { ptTitle = cleanTitle; }
        var refYear = tmdbYear > 0 ? tmdbYear : yearInt;
        var yearTxt = refYear > 0 ? refYear.ToString(CultureInfo.InvariantCulture) : string.Empty;

        Log("Pasta: " + leaf + " | TMDb: " + tmdbId + " (" + origem + ") | pt-BR: '" + ptTitle + "' | en: '" + enTitle + "' | ano: " + yearTxt);
        if (!string.IsNullOrWhiteSpace(tmdbId) && yearInt > 0 && tmdbYear > 0 && Math.Abs(yearInt - tmdbYear) > 1)
        {
            Log("   ATENCAO: ano da pasta (" + yearInt.ToString(CultureInfo.InvariantCulture) + ") difere do TMDb (" + tmdbYear.ToString(CultureInfo.InvariantCulture) + "); confira se o ID esta certo.");
        }

        var titles = new[] { ptTitle, enTitle, origTitle }.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t!).Distinct().ToList();
        var filtersTitulo = new List<string>();
        var filtersDub = new List<string>();
        var filtersLeg = new List<string>();
        foreach (var t in titles)
        {
            var rx = TitleRegex(t);
            if (rx == null)
            {
                continue;
            }

            var baseFilter = "duration > 10 & duration < 300 & title ~= (?i)(trailer|teaser) & title ~= (?i)" + rx;
            filtersTitulo.Add(baseFilter + FilterSuffix);
            filtersDub.Add(baseFilter + " & title ~= (?i)(dublad|dublagem|\\bdub\\b)" + FilterSuffix);
            filtersLeg.Add(baseFilter + " & title ~= (?i)(legendad|\\bleg\\b)" + FilterSuffix);
        }

        var filtroSoDuracao = new List<string> { "duration > 10 & duration < 300" + FilterSuffix };
        string? dateAfter = refYear >= 2010 ? (refYear - 2).ToString(CultureInfo.InvariantCulture) + "0101" : null;

        var achou = false;
        var fonte = string.Empty;

        // A1) Prioridade maxima: trailer oficial do Brasil (pt, pais BR) listado no TMDb
        if (!string.IsNullOrWhiteSpace(tmdbId) && !achou)
        {
            var chaves = await GetTmdbTrailerKeysAsync(kind, tmdbId!, "pt-BR", "pt", tmdbKey, 1, ct).ConfigureAwait(false);
            if (chaves.Count == 0) { Log("   TMDb Brasil: nenhum trailer oficial listado"); }
            foreach (var key in chaves)
            {
                Log("   Tentando trailer pt-BR do TMDb: https://www.youtube.com/watch?v=" + key);
                if (await InvokeYtAsync(tk, cookies, folder, "https://www.youtube.com/watch?v=" + key, filtroSoDuracao, null, simulate, ct).ConfigureAwait(false))
                {
                    achou = true; fonte = "TMDb Brasil"; break;
                }
            }
        }

        // B) Busca no YouTube em portugues (titulo validado)
        if (!achou && filtersTitulo.Count > 0)
        {
            Log("   Buscando no YouTube (portugues dublado): " + ptTitle + " " + yearTxt + " trailer dublado");
            if (await InvokeYtAsync(tk, cookies, folder, "ytsearch8:" + ptTitle + " " + yearTxt + " trailer oficial dublado", filtersDub, dateAfter, simulate, ct).ConfigureAwait(false))
            {
                achou = true; fonte = "YouTube pt-BR dublado";
            }

            if (!achou)
            {
                Log("   Buscando no YouTube (legendado em portugues): " + ptTitle + " " + yearTxt + " trailer legendado");
                if (await InvokeYtAsync(tk, cookies, folder, "ytsearch8:" + ptTitle + " " + yearTxt + " trailer oficial legendado", filtersLeg, dateAfter, simulate, ct).ConfigureAwait(false))
                {
                    achou = true; fonte = "YouTube pt-BR legendado";
                }
            }
        }

        // A2) Sem trailer do Brasil: segue a regra do script, trailer oficial em portugues de outro pais
        if (!string.IsNullOrWhiteSpace(tmdbId) && !achou)
        {
            var chaves = await GetTmdbTrailerKeysAsync(kind, tmdbId!, "pt-BR", "pt", tmdbKey, 2, ct).ConfigureAwait(false);
            foreach (var key in chaves)
            {
                Log("   Tentando trailer em portugues (outro pais) do TMDb: https://www.youtube.com/watch?v=" + key);
                if (await InvokeYtAsync(tk, cookies, folder, "https://www.youtube.com/watch?v=" + key, filtroSoDuracao, null, simulate, ct).ConfigureAwait(false))
                {
                    achou = true; fonte = "TMDb pt (outro pais)"; break;
                }
            }
        }

        // C) Trailer oficial em ingles listado no TMDb
        if (!string.IsNullOrWhiteSpace(tmdbId) && !achou)
        {
            var chaves = await GetTmdbTrailerKeysAsync(kind, tmdbId!, "en-US", "en", tmdbKey, 0, ct).ConfigureAwait(false);
            if (chaves.Count == 0) { Log("   TMDb en-US: nenhum trailer oficial listado"); }
            foreach (var key in chaves)
            {
                Log("   Tentando trailer en-US do TMDb: https://www.youtube.com/watch?v=" + key);
                if (await InvokeYtAsync(tk, cookies, folder, "https://www.youtube.com/watch?v=" + key, filtroSoDuracao, null, simulate, ct).ConfigureAwait(false))
                {
                    achou = true; fonte = "TMDb en-US"; break;
                }
            }
        }

        // C2) IMDb (trailer em ingles). Se a pagina nao abrir ou nao tiver videos, segue sem erro.
        if (!string.IsNullOrWhiteSpace(tmdbId) && !achou && filtersTitulo.Count > 0)
        {
            var ext = await GetJsonAsync("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + Uri.EscapeDataString(tmdbKey), ct).ConfigureAwait(false);
            var imdbId = (string?)ext?["imdb_id"];
            if (!string.IsNullOrWhiteSpace(imdbId))
            {
                var viIds = await GetImdbVideoIdsAsync(imdbId!, ct).ConfigureAwait(false);
                Log("   IMDb (" + imdbId + "): " + viIds.Count.ToString(CultureInfo.InvariantCulture) + " video(s) encontrado(s) na pagina");
                foreach (var vi in viIds)
                {
                    if (await InvokeYtAsync(tk, cookies, folder, "https://www.imdb.com/video/" + vi + "/", filtersTitulo, null, simulate, ct).ConfigureAwait(false))
                    {
                        achou = true; fonte = "IMDb"; break;
                    }
                }
            }
        }

        // D) Busca no YouTube em ingles (titulo validado)
        if (!achou && filtersTitulo.Count > 0)
        {
            var q = "ytsearch5:" + enTitle + " " + yearTxt + " official trailer";
            if (refYear >= 2010) { q += " 1080p"; }
            Log("   Buscando no YouTube (ingles): " + enTitle + " " + yearTxt + " official trailer");
            if (await InvokeYtAsync(tk, cookies, folder, q, filtersTitulo, dateAfter, simulate, ct).ConfigureAwait(false))
            {
                achou = true; fonte = "YouTube en";
            }
        }

        if (achou)
        {
            Log(simulate ? "   [SIMULACAO] Fonte que seria usada: " + fonte : "Sucesso: Trailer baixado para " + cleanTitle + " (fonte: " + fonte + ")");
        }
        else
        {
            Log("Nenhum trailer compativel encontrado para " + cleanTitle + " (tentara de novo na proxima execucao)");
        }

        return achou;
    }

    private async Task<bool> InvokeYtAsync(
        TrailerAutomationService.NativeToolkit tk,
        string? cookies,
        string folder,
        string target,
        IEnumerable<string> matchFilters,
        string? dateAfter,
        bool simulate,
        CancellationToken ct)
    {
        var args = new List<string>();
        if (cookies != null)
        {
            args.Add("--cookies");
            args.Add(cookies);
        }

        args.AddRange(new[] { "--remote-components", "ejs:github", "--js-runtimes", tk.JsRuntimeArg, "--no-check-certificates", "--geo-bypass", "--max-downloads", "1", "--force-overwrites" });
        if (!string.IsNullOrWhiteSpace(tk.FfmpegDir))
        {
            args.Add("--ffmpeg-location");
            args.Add(tk.FfmpegDir!);
        }

        foreach (var mf in matchFilters)
        {
            args.Add("--match-filter");
            args.Add(mf);
        }

        args.Add("--reject-title");
        args.Add(RejectTitle);
        if (!string.IsNullOrEmpty(dateAfter))
        {
            args.Add("--dateafter");
            args.Add(dateAfter!);
        }

        // Fork ParticularFlix 4.0.0.3: a ordem padrao de codec do yt-dlp poe AV1 na frente, e o YouTube serve AV1 em mp4
        // tambem, entao os trailers saiam em AV1. Navegador sem decodificacao AV1 em hardware toca esses arquivos na CPU
        // (pesado no slider, onde um trailer comeca a cada troca de slide). H.264 e decodificado pela GPU quase sempre.
        // 4.0.0.8: "-S res:1080,vcodec:h264" ordenava pela resolucao antes do codec, entao um 1080p em AV1 ganhava de um
        // 720p em H.264 e AV1 continuou entrando (64% dos trailers no inventario de 05/11/2026). Agora o AV1 fica fora do
        // seletor e so entra se o video nao tiver nenhum outro formato; entre os demais, ate 1080p, H.264 antes de VP9
        // ("+codec:avc:m4a" e a forma documentada do yt-dlp para preferir h264 > h265 > vp9 > av01 e audio m4a).
        // 4.0.0.10: H.264/VP9 so a partir de 720p; sem isso, o melhor video ate 1080p em qualquer codec (AV1 inclusive),
        // para nunca trocar um 1080p por um 240p.
        args.AddRange(new[]
        {
            "-S", "res:1080,+codec:avc:m4a",
            "-f", "bestvideo[vcodec!^=av01][height>=720]+bestaudio[ext=m4a]/bestvideo[vcodec!^=av01][height>=720]+bestaudio/bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
            "--merge-output-format", "mp4", "--postprocessor-args", "Merger:-movflags +faststart"
        });

        if (simulate)
        {
            args.AddRange(new[] { "--simulate", "--print", "ACHADO | %(title)s | %(id)s | %(upload_date)s | %(channel)s" });
        }
        else
        {
            args.AddRange(new[] { "--no-simulate", "--no-quiet", "--print", "ESCOLHIDO | %(title)s | %(id)s | %(channel)s | %(upload_date)s", "-o", Path.Combine(folder, "trailer.%(ext)s") });
        }

        args.Add(target);

        (int ExitCode, string Stdout, string Stderr) result;
        using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
        {
            cts.CancelAfter(TimeSpan.FromMinutes(8));
            try
            {
                result = await TrailerAutomationService.RunNativeProcessAsync(tk.YtDlpPath, args, cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                Log("   yt-dlp passou de 8 minutos e foi interrompido.");
                CleanLeftovers(folder, simulate);
                return false;
            }
        }

        var marker = simulate ? "ACHADO |" : "ESCOLHIDO |";
        var hits = result.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim())
            .Where(l => l.StartsWith(marker, StringComparison.Ordinal))
            .ToList();
        foreach (var h in hits)
        {
            Log((simulate ? "   [SIMULACAO] " : "   ") + h);
        }

        if (simulate)
        {
            return hits.Count > 0;
        }

        var ok = File.Exists(Path.Combine(folder, "trailer.mp4"));
        if (!ok)
        {
            var err = result.Stderr.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => l.Trim()).Where(l => l.Length > 0).TakeLast(2);
            foreach (var e in err)
            {
                Log("   yt-dlp: " + e);
            }

            CleanLeftovers(folder, simulate);
        }

        return ok;
    }

    private static void CleanLeftovers(string folder, bool simulate)
    {
        if (simulate)
        {
            return;
        }

        try
        {
            foreach (var f in Directory.EnumerateFiles(folder, "trailer.*"))
            {
                var ext = Path.GetExtension(f).ToLowerInvariant();
                if ((ext != ".mp4" && ext != ".mkv" && ext != ".webm") || f.EndsWith(".part", StringComparison.OrdinalIgnoreCase))
                {
                    TryDelete(f);
                }
            }
        }
        catch
        {
        }
    }

    private async Task<List<string>> GetTmdbTrailerKeysAsync(string kind, string id, string lang, string iso, string tmdbKey, int brFilter, CancellationToken ct)
    {
        var v = await GetJsonAsync("https://api.themoviedb.org/3/" + kind + "/" + id + "/videos?api_key=" + Uri.EscapeDataString(tmdbKey) + "&language=" + lang, ct).ConfigureAwait(false);
        var results = v?["results"]?.AsArray();
        if (results == null)
        {
            return new List<string>();
        }

        var list = new List<(string Key, int Dub, int Br, int Official, string Published)>();
        foreach (var r in results)
        {
            if (r == null)
            {
                continue;
            }

            var site = (string?)r["site"];
            var type = (string?)r["type"];
            var lg = (string?)r["iso_639_1"];
            var official = (bool?)r["official"] == true;
            var key = (string?)r["key"];
            if (site != "YouTube" || type != "Trailer" || lg != iso || !official || string.IsNullOrWhiteSpace(key))
            {
                continue;
            }

            var name = (string?)r["name"] ?? string.Empty;
            var dub = Regex.IsMatch(name, "(?i)dublad") ? 2 : Regex.IsMatch(name, "(?i)legendad") ? 1 : 0;
            var br = string.Equals((string?)r["iso_3166_1"], "BR", StringComparison.Ordinal) ? 1 : 0;
            if ((brFilter == 1 && br == 0) || (brFilter == 2 && br == 1))
            {
                continue;
            }

            list.Add((key!, dub, br, 1, (string?)r["published_at"] ?? string.Empty));
        }

        return list
            .OrderByDescending(x => x.Br)
            .ThenByDescending(x => x.Dub)
            .ThenByDescending(x => x.Official)
            .ThenByDescending(x => x.Published, StringComparer.Ordinal)
            .Take(4)
            .Select(x => x.Key)
            .ToList();
    }

    private async Task<List<string>> GetImdbVideoIdsAsync(string imdbId, CancellationToken ct)
    {
        try
        {
            var html = await Http.GetStringAsync("https://www.imdb.com/title/" + imdbId + "/", ct).ConfigureAwait(false);
            return Regex.Matches(html, @"/video/(vi\d{6,})")
                .Select(x => x.Groups[1].Value)
                .Distinct()
                .Take(6)
                .ToList();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return new List<string>();
        }
    }

    private static async Task<JsonNode?> GetJsonAsync(string url, CancellationToken ct)
    {
        try
        {
            var text = await Http.GetStringAsync(url, ct).ConfigureAwait(false);
            return JsonNode.Parse(text);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return null;
        }
    }

    private static string? TitleRegex(string title)
    {
        var r = Regex.Replace(title, @"[^\p{L}\p{N}]+", ".*").Trim('.', '*');
        return r.Length < 2 ? null : "\\b" + r + "\\b";
    }

    private static string? GetItemFolder(BaseItem item)
    {
        if (string.IsNullOrWhiteSpace(item.Path))
        {
            return null;
        }

        return item is Series ? item.Path : Path.GetDirectoryName(item.Path);
    }

    private static bool HasFinishedTrailer(string folder)
    {
        try
        {
            return FindTrailerFileCore(folder) != null;
        }
        catch
        {
            return true;
        }
    }

    private static string? FindTrailerFile(string folder)
    {
        try
        {
            return FindTrailerFileCore(folder);
        }
        catch
        {
            return null;
        }
    }

    private static string? FindTrailerFileCore(string folder)
    {
        foreach (var f in Directory.EnumerateFiles(folder))
        {
            var name = Path.GetFileNameWithoutExtension(f);
            var ext = Path.GetExtension(f).ToLowerInvariant();
            var isTrailerName = name.Equals("trailer", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("-trailer", StringComparison.OrdinalIgnoreCase);
            if (isTrailerName && (ext == ".mp4" || ext == ".mkv" || ext == ".webm"))
            {
                return f;
            }
        }

        return null;
    }

    // Lista os trailers que valem ser refeitos agora: AV1 (CPU) ou H.264/VP9 abaixo de 720p (imagem ruim).
    // ffprobe com cache por tamanho e data; pastas com marcador valido (nao havia versao melhor) ficam de fora.
    private async Task<List<(BaseItem Item, string Folder, string File)>> FindTrailersToUpgradeAsync(
        List<(BaseItem Item, string Folder, string File)> candidates,
        CancellationToken ct)
    {
        var result = new List<(BaseItem Item, string Folder, string File)>();
        var ffprobe = _tools.ResolveFfprobePath();
        if (string.IsNullOrWhiteSpace(ffprobe))
        {
            Log("Aviso: ffprobe nao encontrado; a troca de trailers fica para a proxima execucao.");
            return result;
        }

        var av1 = 0;
        var lowRes = 0;
        var blocked = 0;
        var kept = 0;
        foreach (var c in candidates)
        {
            ct.ThrowIfCancellationRequested();
            var info = await ProbeVideoAsync(ffprobe!, c.File, ct).ConfigureAwait(false);
            if (info is null)
            {
                continue;
            }

            var isAv1 = string.Equals(info.Value.Codec, "av1", StringComparison.OrdinalIgnoreCase);
            var isLow = !isAv1 && info.Value.Height > 0 && info.Value.Height < MinGoodHeight;
            if (!isAv1 && !isLow)
            {
                continue;
            }

            if (isAv1)
            {
                av1++;
            }
            else
            {
                lowRes++;
            }

            if (HasValidKeepMarker(c.Folder, c.File))
            {
                kept++;
                continue;
            }

            if (UpgradeBlockedUntil.TryGetValue(c.Folder, out var until) && DateTime.UtcNow < until)
            {
                blocked++;
                continue;
            }

            if (result.Count < MaxCodecUpgradesPerRun)
            {
                result.Add(c);
            }
        }

        if (av1 + lowRes > 0)
        {
            Log("Trailers em AV1: " + av1.ToString(CultureInfo.InvariantCulture)
                + "; H.264/VP9 abaixo de 720p: " + lowRes.ToString(CultureInfo.InvariantCulture)
                + "; sem versao melhor no YouTube (mantidos): " + kept.ToString(CultureInfo.InvariantCulture)
                + "; refazendo " + result.Count.ToString(CultureInfo.InvariantCulture) + " nesta execucao"
                + (blocked > 0 ? ", " + blocked.ToString(CultureInfo.InvariantCulture) + " aguardando nova tentativa" : string.Empty) + ".");
        }

        return result;
    }

    private static async Task<(string Codec, int Height)?> ProbeVideoAsync(string ffprobe, string file, CancellationToken ct)
    {
        try
        {
            var fi = new FileInfo(file);
            if (!fi.Exists)
            {
                return null;
            }

            if (CodecCache.TryGetValue(file, out var cached) && cached.Size == fi.Length && cached.Mtime == fi.LastWriteTimeUtc)
            {
                return (cached.Codec, cached.Height);
            }

            var r = await TrailerAutomationService.RunNativeProcessAsync(
                ffprobe,
                new[] { "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,height", "-of", "csv=p=0", file },
                ct).ConfigureAwait(false);
            if (r.ExitCode != 0)
            {
                return null;
            }

            var line = r.Stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(l => l.Trim())
                .FirstOrDefault(l => l.Length > 0) ?? string.Empty;
            var parts = line.Split(',');
            var codec = parts.Length > 0 ? parts[0].Trim() : string.Empty;
            var height = 0;
            if (parts.Length > 1)
            {
                int.TryParse(parts[1].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out height);
            }

            CodecCache[file] = (fi.Length, fi.LastWriteTimeUtc, codec, height);
            return (codec, height);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return null;
        }
    }

    // O trailer novo so fica se for melhor: sai do AV1 com 720p ou mais, ou sobe de uma resolucao abaixo de 720p.
    private static bool IsBetterTrailer((string Codec, int Height) oldInfo, (string Codec, int Height) newInfo)
    {
        var oldAv1 = string.Equals(oldInfo.Codec, "av1", StringComparison.OrdinalIgnoreCase);
        var newAv1 = string.Equals(newInfo.Codec, "av1", StringComparison.OrdinalIgnoreCase);
        if (oldAv1 && !newAv1 && newInfo.Height >= MinGoodHeight)
        {
            return true;
        }

        return oldInfo.Height > 0 && oldInfo.Height < MinGoodHeight && newInfo.Height > oldInfo.Height;
    }

    private static string Describe((string Codec, int Height)? info)
    {
        return info is null ? "?" : info.Value.Codec + " " + info.Value.Height.ToString(CultureInfo.InvariantCulture) + "p";
    }

    // Baixa o trailer de novo. O arquivo antigo fica guardado como oculto (.jms-av1-<nome>.bak, fora do padrao trailer.*
    // que a limpeza do yt-dlp apaga e ignorado pelo Jellyfin) e volta se o download falhar ou se o novo nao for melhor;
    // nesse caso um marcador oculto (.jms-trailer-keep) evita baixar o mesmo video de novo por 30 dias.
    private async Task<bool> UpgradeTrailerAsync(
        BaseItem item,
        string folder,
        string oldFile,
        TrailerAutomationService.NativeToolkit tk,
        string? cookies,
        string tmdbKey,
        CancellationToken ct)
    {
        if (!CanWrite(folder))
        {
            Log("   Pasta somente leitura, trailer mantido: " + new DirectoryInfo(folder).Name);
            return false;
        }

        var ffprobe = _tools.ResolveFfprobePath();
        var oldInfo = string.IsNullOrWhiteSpace(ffprobe) ? null : await ProbeVideoAsync(ffprobe!, oldFile, ct).ConfigureAwait(false);
        if (oldInfo is null)
        {
            Log("   Nao consegui ler o trailer atual; mantido como esta.");
            return false;
        }

        var backup = Path.Combine(folder, UpgradeBackupPrefix + Path.GetFileName(oldFile) + UpgradeBackupSuffix);
        try
        {
            if (File.Exists(backup))
            {
                File.Delete(backup);
            }

            File.Move(oldFile, backup);
        }
        catch (Exception ex)
        {
            Log("   Nao consegui separar o trailer atual (" + ex.Message + "); mantido como esta.");
            return false;
        }

        var newFile = Path.Combine(folder, "trailer.mp4");
        bool downloaded;
        try
        {
            downloaded = await ProcessItemAsync(TargetOf(item), tk, cookies, tmdbKey, false, ct).ConfigureAwait(false) && File.Exists(newFile);
        }
        catch
        {
            RestoreBackup(backup, oldFile);
            throw;
        }

        if (!downloaded)
        {
            RestoreBackup(backup, oldFile);
            Log("   Download novo falhou; o trailer antigo foi mantido.");
            return false;
        }

        var newInfo = await ProbeVideoAsync(ffprobe!, newFile, ct).ConfigureAwait(false);
        if (newInfo is not null && !IsBetterTrailer(oldInfo.Value, newInfo.Value))
        {
            if (!string.Equals(newFile, oldFile, StringComparison.Ordinal))
            {
                TryDelete(newFile);
            }

            RestoreBackup(backup, oldFile);
            WriteKeepMarker(folder, oldFile);
            Log("   Sem versao melhor (novo " + Describe(newInfo) + ", antigo " + Describe(oldInfo) + "); trailer antigo mantido.");
            return false;
        }

        TryDelete(backup);
        TryDelete(Path.Combine(folder, KeepMarkerName));
        Log("   Trailer refeito, codec agora: " + Describe(newInfo) + " (antes " + Describe(oldInfo) + ")");
        return true;
    }

    private static void WriteKeepMarker(string folder, string trailer)
    {
        try
        {
            var fi = new FileInfo(trailer);
            File.WriteAllText(
                Path.Combine(folder, KeepMarkerName),
                fi.Length.ToString(CultureInfo.InvariantCulture) + "|" + fi.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture)
                + "|" + DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture));
        }
        catch
        {
        }
    }

    private static bool HasValidKeepMarker(string folder, string trailer)
    {
        try
        {
            var path = Path.Combine(folder, KeepMarkerName);
            if (!File.Exists(path))
            {
                return false;
            }

            var parts = File.ReadAllText(path).Trim().Split('|');
            var fi = new FileInfo(trailer);
            if (parts.Length != 3 || !fi.Exists)
            {
                return false;
            }

            var size = long.Parse(parts[0], CultureInfo.InvariantCulture);
            var mtime = long.Parse(parts[1], CultureInfo.InvariantCulture);
            var written = new DateTime(long.Parse(parts[2], CultureInfo.InvariantCulture), DateTimeKind.Utc);
            return size == fi.Length && mtime == fi.LastWriteTimeUtc.Ticks && DateTime.UtcNow - written < KeepMarkerValidity;
        }
        catch
        {
            return false;
        }
    }

    // Espaco livre do disco onde a pasta esta. DriveInfo da raiz ("/") nao serve no container: a biblioteca e um ponto de
    // montagem proprio (/storage2), entao vale o ponto de montagem mais longo que contem o caminho. -1 = nao deu para medir.
    private static long FreeMbFor(string path)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return -1;
            }

            var full = Path.GetFullPath(path);
            DriveInfo? best = null;
            var bestLen = -1;
            foreach (var d in DriveInfo.GetDrives())
            {
                string root;
                try
                {
                    if (!d.IsReady)
                    {
                        continue;
                    }

                    root = d.RootDirectory.FullName;
                }
                catch
                {
                    continue;
                }

                var rootTrim = root.Length > 1 ? root.TrimEnd('/', '\\') : root;
                var inside = full.Equals(rootTrim, StringComparison.Ordinal)
                    || rootTrim == "/"
                    || (full.StartsWith(rootTrim, StringComparison.Ordinal) && full.Length > rootTrim.Length && (full[rootTrim.Length] == '/' || full[rootTrim.Length] == '\\'));
                if (inside && rootTrim.Length > bestLen)
                {
                    best = d;
                    bestLen = rootTrim.Length;
                }
            }

            return best is null ? -1 : best.AvailableFreeSpace / (1024 * 1024);
        }
        catch
        {
            return -1;
        }
    }

    private static string FormatGb(long mb)
    {
        return (mb / 1024.0).ToString("0.0", CultureInfo.InvariantCulture) + " GB";
    }

    private void RestoreBackup(string backup, string original)
    {
        try
        {
            if (!File.Exists(backup))
            {
                return;
            }

            if (File.Exists(original))
            {
                File.Delete(original);
            }

            File.Move(backup, original);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[JMS trailers] Nao consegui devolver o trailer antigo {Arquivo}: {Erro}", original, ex.Message);
        }
    }

    // Se o servidor parou no meio de uma troca, devolve o trailer antigo (pasta sem trailer) ou apaga a copia (troca concluida).
    private void RecoverUpgradeBackup(string folder)
    {
        try
        {
            foreach (var backup in Directory.EnumerateFiles(folder, UpgradeBackupPrefix + "*" + UpgradeBackupSuffix).ToList())
            {
                var name = Path.GetFileName(backup);
                var original = Path.Combine(folder, name.Substring(UpgradeBackupPrefix.Length, name.Length - UpgradeBackupPrefix.Length - UpgradeBackupSuffix.Length));
                if (FindTrailerFile(folder) != null)
                {
                    TryDelete(backup);
                }
                else
                {
                    RestoreBackup(backup, original);
                }
            }
        }
        catch
        {
        }
    }

    private static bool HasVideoInSubfolders(string folder)
    {
        try
        {
            foreach (var sub in Directory.EnumerateDirectories(folder))
            {
                if (ExtrasFolderNames.Contains(Path.GetFileName(sub)))
                {
                    continue;
                }

                if (Directory.EnumerateFiles(sub).Any(f => VideoExtensions.Contains(Path.GetExtension(f).ToLowerInvariant())))
                {
                    return true;
                }
            }

            return false;
        }
        catch
        {
            return true;
        }
    }

    private static int CountVideoFiles(string folder)
    {
        try
        {
            return Directory.EnumerateFiles(folder)
                .Count(f => VideoExtensions.Contains(Path.GetExtension(f).ToLowerInvariant())
                    && !Path.GetFileNameWithoutExtension(f).StartsWith("trailer", StringComparison.OrdinalIgnoreCase)
                    && !Path.GetFileNameWithoutExtension(f).EndsWith("-trailer", StringComparison.OrdinalIgnoreCase));
        }
        catch
        {
            return 0;
        }
    }

    private static bool CanWrite(string folder)
    {
        try
        {
            var probe = Path.Combine(folder, ".jms-write-test-" + Guid.NewGuid().ToString("N"));
            File.WriteAllText(probe, "x");
            File.Delete(probe);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
        }
    }

    // Biblioteca adulta (/media/xxx) e qualquer pasta chamada xxx/adult/adultos ficam fora, sempre.
    private static bool IsExcludedPath(string path)
    {
        foreach (var part in path.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (part.Equals("xxx", StringComparison.OrdinalIgnoreCase)
                || part.Equals("adult", StringComparison.OrdinalIgnoreCase)
                || part.Equals("adultos", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
