using System.Globalization;
using System.Text.Json;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Tasks;

/// <summary>
/// Tarefa agendada nativa de trailers (fatia 1: SOMENTE SIMULACAO).
/// Lista filmes e series sem trailer na pasta, consulta o TMDb e registra no log
/// qual trailer seria escolhido e por que. Nao baixa nem grava nada.
/// </summary>
public sealed class TrailerSyncTask : IScheduledTask
{
    private const int MaxItemsPerRun = 300;
    private const int DelayBetweenCallsMs = 300;

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<TrailerSyncTask> _logger;

    public TrailerSyncTask(ILibraryManager libraryManager, ILogger<TrailerSyncTask> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    public string Name => "JMSFusion: simular trailers (sem baixar)";
    public string Key => "JMSFusionTrailerSyncDryRun";
    public string Description => "Procura filmes e series sem trailer e registra no log qual trailer seria escolhido. Nao baixa nem altera nada.";
    public string Category => "JMSFusion";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => Array.Empty<TaskTriggerInfo>();

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var apiKey = JMSFusionPlugin.Instance?.Configuration?.TmdbApiKey?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(apiKey) || apiKey == "CHANGE_ME")
        {
            _logger.LogWarning("[JMS trailers] Chave do TMDb nao configurada no plugin. Simulacao cancelada.");
            progress.Report(100);
            return;
        }

        var query = new InternalItemsQuery
        {
            IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series },
            IsVirtualItem = false,
            Recursive = true
        };

        var all = _libraryManager.GetItemList(query);
        var pending = new List<BaseItem>();
        foreach (var item in all)
        {
            if (!string.IsNullOrWhiteSpace(item.Path) && !HasLocalTrailer(item))
            {
                pending.Add(item);
            }
        }

        _logger.LogInformation("[JMS trailers] Simulacao: {Total} itens na biblioteca, {Sem} sem trailer na pasta (analisando ate {Max}).",
            all.Count, pending.Count, MaxItemsPerRun);

        var count = Math.Min(pending.Count, MaxItemsPerRun);
        var withPlan = 0;
        var withoutPlan = 0;

        for (var i = 0; i < count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var item = pending[i];
            try
            {
                var plan = await PlanAsync(item, apiKey, cancellationToken).ConfigureAwait(false);
                if (plan == null) { withoutPlan++; } else { withPlan++; }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                withoutPlan++;
                _logger.LogWarning("[JMS trailers] {Nome}: falha na consulta ao TMDb: {Erro}", item.Name, ex.Message);
            }

            progress.Report((i + 1) * 100.0 / Math.Max(1, count));
            await Task.Delay(DelayBetweenCallsMs, cancellationToken).ConfigureAwait(false);
        }

        _logger.LogInformation("[JMS trailers] Simulacao concluida: {Com} itens com trailer candidato no TMDb, {Sem} sem candidato. Nada foi baixado.",
            withPlan, withoutPlan);
        progress.Report(100);
    }

    private static bool HasLocalTrailer(BaseItem item)
    {
        var folder = item is Series ? item.Path : Path.GetDirectoryName(item.Path);
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
        {
            return true; // sem pasta acessivel: nao mexe
        }

        foreach (var file in Directory.EnumerateFiles(folder))
        {
            var name = Path.GetFileNameWithoutExtension(file);
            if (name.Equals("trailer", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("-trailer", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private async Task<string?> PlanAsync(BaseItem item, string apiKey, CancellationToken ct)
    {
        var tmdbId = item.GetProviderId(MetadataProvider.Tmdb);
        if (string.IsNullOrWhiteSpace(tmdbId))
        {
            _logger.LogInformation("[JMS trailers] {Nome} ({Ano}): sem ID do TMDb no Jellyfin, a busca por titulo entra na fatia 2.",
                item.Name, item.ProductionYear);
            return null;
        }

        var kind = item is Series ? "tv" : "movie";
        var url = string.Format(CultureInfo.InvariantCulture,
            "https://api.themoviedb.org/3/{0}/{1}/videos?api_key={2}&language=pt-BR&include_video_language=pt,en,null",
            kind, Uri.EscapeDataString(tmdbId), Uri.EscapeDataString(apiKey));

        using var resp = await Http.GetAsync(url, ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            _logger.LogWarning("[JMS trailers] {Nome}: TMDb respondeu {Status}.", item.Name, (int)resp.StatusCode);
            return null;
        }

        var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var candidates = new List<Candidate>();
        foreach (var r in results.EnumerateArray())
        {
            var site = GetString(r, "site");
            var type = GetString(r, "type");
            var key = GetString(r, "key");
            if (!site.Equals("YouTube", StringComparison.OrdinalIgnoreCase)
                || !type.Equals("Trailer", StringComparison.OrdinalIgnoreCase)
                || string.IsNullOrWhiteSpace(key))
            {
                continue;
            }

            var name = GetString(r, "name");
            var lang = GetString(r, "iso_639_1");
            var country = GetString(r, "iso_3166_1");
            var official = r.TryGetProperty("official", out var o) && o.ValueKind == JsonValueKind.True;
            var published = GetString(r, "published_at");

            // Regra A (portugues) antes da C (ingles); dentro de A: dublado, legendado, outros.
            var group = lang.Equals("pt", StringComparison.OrdinalIgnoreCase) ? 0 : lang.Equals("en", StringComparison.OrdinalIgnoreCase) ? 1 : 2;
            var dub = name.Contains("dublado", StringComparison.OrdinalIgnoreCase) ? 0
                    : name.Contains("legendado", StringComparison.OrdinalIgnoreCase) ? 1 : 2;

            candidates.Add(new Candidate(key, name, lang, country, official, published, group, dub));
        }

        if (candidates.Count == 0)
        {
            _logger.LogInformation("[JMS trailers] {Nome} ({Ano}): TMDb sem trailer em pt/en. A busca no YouTube entra na fatia 2.",
                item.Name, item.ProductionYear);
            return null;
        }

        var best = candidates
            .OrderBy(c => c.Group)
            .ThenBy(c => c.Dub)
            .ThenBy(c => c.Country.Equals("BR", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenBy(c => c.Official ? 0 : 1)
            .ThenByDescending(c => c.Published, StringComparer.Ordinal)
            .First();

        var regra = best.Group == 0 ? "A (oficial em portugues)" : best.Group == 1 ? "C (ingles)" : "outro idioma";
        _logger.LogInformation("[JMS trailers] {Nome} ({Ano}): escolheria https://www.youtube.com/watch?v={Key} | regra {Regra} | idioma {Lang}-{Pais} | oficial={Oficial} | \"{Titulo}\"",
            item.Name, item.ProductionYear, best.Key, regra, best.Lang, best.Country, best.Official, best.Name);
        return best.Key;
    }

    private static string GetString(JsonElement e, string prop)
    {
        return e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? string.Empty) : string.Empty;
    }

    private sealed record Candidate(string Key, string Name, string Lang, string Country, bool Official, string Published, int Group, int Dub);
}
