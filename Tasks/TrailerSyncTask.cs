using Jellyfin.Plugin.JMSFusion.Core;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Tasks;

/// <summary>
/// Tarefa agendada nativa de trailers (substitui o script JMSFusion-trailers-sync.ps1 e a tarefa do Windows).
/// Roda sozinha de tempos em tempos e repoe qualquer pasta sem trailer; alem disso o TrailerWatcher dispara
/// a mesma rotina quando um filme ou serie novo entra na biblioteca. Logs no log do Jellyfin ([JMS trailers]).
/// </summary>
public sealed class TrailerSyncTask : IScheduledTask
{
    private readonly ILibraryManager _libraryManager;
    private readonly TrailerAutomationService _tools;
    private readonly ILogger<TrailerSyncTask> _logger;

    public TrailerSyncTask(ILibraryManager libraryManager, TrailerAutomationService tools, ILogger<TrailerSyncTask> logger)
    {
        _libraryManager = libraryManager;
        _tools = tools;
        _logger = logger;
    }

    public string Name => "JMSFusion: sincronizar trailers";
    public string Key => "JMSFusionTrailerSync";
    public string Description => "Atualiza o yt-dlp e baixa o trailer dos filmes e series que ainda nao tem (pt-BR primeiro). Tambem roda sozinho quando um titulo novo entra na biblioteca. Nao mexe em pastas que ja tem trailer.";
    public string Category => "JMSFusion";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        yield return new TaskTriggerInfo
        {
            Type = TaskTriggerInfoType.IntervalTrigger,
            IntervalTicks = TimeSpan.FromHours(6).Ticks
        };
    }

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var apiKey = JMSFusionPlugin.Instance?.Configuration?.TmdbApiKey?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(apiKey) || apiKey == "CHANGE_ME")
        {
            _logger.LogWarning("[JMS trailers] Chave do TMDb nao configurada no plugin. Tarefa cancelada.");
            progress.Report(100);
            return;
        }

        var sync = new NativeTrailerSync(_libraryManager, _tools, _logger);
        await sync.RunAsync(NativeTrailerMode.Real, false, int.MaxValue, apiKey, true, progress, cancellationToken).ConfigureAwait(false);
    }
}
