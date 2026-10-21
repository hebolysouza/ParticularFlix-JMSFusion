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
    private static readonly string[] CookiesCandidates = { "/data/JellyfinDownloads/cookies.txt", "/config/cookies.txt" };
    private static readonly string[] VideoExtensions = { ".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".ts" };
    private static readonly HttpClient Http = CreateHttp();

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

    public async Task RunAsync(NativeTrailerMode mode, bool sample, int limit, string tmdbKey, IProgress<double> progress, CancellationToken ct)
    {
        var simulate = mode == NativeTrailerMode.Simulate;
        var all = _libraryManager.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series },
            IsVirtualItem = false,
            Recursive = true
        });

        var work = new List<BaseItem>();
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

            if (sample || !HasFinishedTrailer(folder))
            {
                work.Add(item);
            }
        }

        var count = Math.Min(work.Count, limit);
        Log((simulate ? "SIMULACAO" : "SINCRONIZACAO") + ": " + all.Count.ToString(CultureInfo.InvariantCulture)
            + " itens na biblioteca, " + work.Count.ToString(CultureInfo.InvariantCulture)
            + (sample ? " elegiveis (amostra, com ou sem trailer)" : " sem trailer")
            + ", processando " + count.ToString(CultureInfo.InvariantCulture) + ". Biblioteca adulta fora.");

        if (count == 0)
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

        var cookies = CookiesCandidates.FirstOrDefault(File.Exists);
        Log(cookies == null ? "Aviso: cookies.txt do YouTube nao encontrado; o YouTube pode recusar alguns videos." : "Cookies do YouTube: " + cookies);

        var found = 0;
        for (var i = 0; i < count; i++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                if (await ProcessItemAsync(work[i], toolkit, cookies, tmdbKey, simulate, ct).ConfigureAwait(false))
                {
                    found++;
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("[JMS trailers] ERRO em {Nome}: {Erro}", work[i].Name, ex.Message);
            }

            progress.Report((i + 1) * 100.0 / count);
        }

        Log((simulate ? "Simulacao concluida" : "Sincronizacao concluida") + ": trailer "
            + (simulate ? "encontrado" : "baixado") + " em " + found.ToString(CultureInfo.InvariantCulture)
            + " de " + count.ToString(CultureInfo.InvariantCulture) + " itens.");
        progress.Report(100);
    }

    private async Task<bool> ProcessItemAsync(BaseItem item, TrailerAutomationService.NativeToolkit tk, string? cookies, string tmdbKey, bool simulate, CancellationToken ct)
    {
        var isSeries = item is Series;
        var kind = isSeries ? "tv" : "movie";
        var folder = GetItemFolder(item)!;
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

        var yearInt = item.ProductionYear ?? 0;
        var m = Regex.Match(leaf, @"\b(19\d\d|20\d\d)\b");
        if (yearInt == 0 && m.Success)
        {
            yearInt = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        }

        var yearFolder = m.Success ? m.Groups[1].Value : string.Empty;
        var cleanTitle = Regex.Replace(leaf, @"\s*\(\d{4}\).*", string.Empty);
        cleanTitle = Regex.Replace(cleanTitle, @"(?i)\b(WEBDL|WEB-DL|HDR|BluRay|REMUX|1080p|720p|4K|UHD|AAC|H\.264|x264|x265|DDP5\.1|Atmos)\b.*", string.Empty).Trim();

        // 1) ID do TMDb: Jellyfin primeiro, busca por titulo + ano como plano B
        var tmdbId = item.GetProviderId(MetadataProvider.Tmdb);
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

        // A) Trailer oficial em portugues listado no TMDb
        if (!string.IsNullOrWhiteSpace(tmdbId) && !achou)
        {
            var chaves = await GetTmdbTrailerKeysAsync(kind, tmdbId!, "pt-BR", "pt", tmdbKey, ct).ConfigureAwait(false);
            if (chaves.Count == 0) { Log("   TMDb pt-BR: nenhum trailer oficial listado"); }
            foreach (var key in chaves)
            {
                Log("   Tentando trailer pt-BR do TMDb: https://www.youtube.com/watch?v=" + key);
                if (await InvokeYtAsync(tk, cookies, folder, "https://www.youtube.com/watch?v=" + key, filtroSoDuracao, null, simulate, ct).ConfigureAwait(false))
                {
                    achou = true; fonte = "TMDb pt-BR"; break;
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

        // C) Trailer oficial em ingles listado no TMDb
        if (!string.IsNullOrWhiteSpace(tmdbId) && !achou)
        {
            var chaves = await GetTmdbTrailerKeysAsync(kind, tmdbId!, "en-US", "en", tmdbKey, ct).ConfigureAwait(false);
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

        args.AddRange(new[] { "-S", "res:1080", "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best", "--merge-output-format", "mp4", "--postprocessor-args", "Merger:-movflags +faststart" });

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

    private async Task<List<string>> GetTmdbTrailerKeysAsync(string kind, string id, string lang, string iso, string tmdbKey, CancellationToken ct)
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
            list.Add((key!, dub, br, 1, (string?)r["published_at"] ?? string.Empty));
        }

        return list
            .OrderByDescending(x => x.Dub)
            .ThenByDescending(x => x.Br)
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
            foreach (var f in Directory.EnumerateFiles(folder))
            {
                var name = Path.GetFileNameWithoutExtension(f);
                var ext = Path.GetExtension(f).ToLowerInvariant();
                var isTrailerName = name.Equals("trailer", StringComparison.OrdinalIgnoreCase)
                    || name.EndsWith("-trailer", StringComparison.OrdinalIgnoreCase);
                if (isTrailerName && (ext == ".mp4" || ext == ".mkv" || ext == ".webm"))
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
