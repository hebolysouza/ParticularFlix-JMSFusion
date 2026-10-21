using Jellyfin.Plugin.JMSFusion.Core;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Tasks;

/// <summary>
/// Dispara a sincronizacao de trailers quando um filme ou serie novo entra na biblioteca.
/// Espera 3 minutos de silencio (o Jellyfin ainda esta identificando o titulo e baixando os metadados)
/// e entao roda a mesma rotina da tarefa agendada, que so toca em pastas sem trailer.
/// </summary>
public sealed class TrailerWatcher : IHostedService, IDisposable
{
    private static readonly TimeSpan QuietPeriod = TimeSpan.FromMinutes(3);

    private readonly ILibraryManager _libraryManager;
    private readonly TrailerAutomationService _tools;
    private readonly ILogger<TrailerWatcher> _logger;
    private readonly object _gate = new();
    private Timer? _timer;

    public TrailerWatcher(ILibraryManager libraryManager, TrailerAutomationService tools, ILogger<TrailerWatcher> logger)
    {
        _libraryManager = libraryManager;
        _tools = tools;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _libraryManager.ItemAdded += OnItemAdded;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _libraryManager.ItemAdded -= OnItemAdded;
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
        }

        return Task.CompletedTask;
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
        }
    }

    private void OnItemAdded(object? sender, ItemChangeEventArgs e)
    {
        if (e.Item is not (Movie or Series))
        {
            return;
        }

        lock (_gate)
        {
            _timer?.Dispose();
            _timer = new Timer(_ => _ = RunAsync(), null, QuietPeriod, Timeout.InfiniteTimeSpan);
        }
    }

    private async Task RunAsync()
    {
        try
        {
            var apiKey = JMSFusionPlugin.Instance?.Configuration?.TmdbApiKey?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(apiKey) || apiKey == "CHANGE_ME")
            {
                _logger.LogWarning("[JMS trailers] Titulo novo detectado, mas a chave do TMDb nao esta configurada no plugin.");
                return;
            }

            _logger.LogInformation("[JMS trailers] Titulo novo na biblioteca; verificando trailers que faltam.");
            var sync = new NativeTrailerSync(_libraryManager, _tools, _logger);
            await sync.RunAsync(NativeTrailerMode.Real, false, int.MaxValue, apiKey, false, new Progress<double>(), CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[JMS trailers] Erro na sincronizacao automatica: {Erro}", ex.Message);
        }
    }
}
