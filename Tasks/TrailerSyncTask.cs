using Jellyfin.Plugin.JMSFusion.Core;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Tasks;

/// <summary>
/// Tarefas agendadas nativas de trailers (substituem o script JMSFusion-trailers-sync.ps1).
/// Os logs vao para o log do Jellyfin (prefixo "[JMS trailers]"), sem arquivo txt.
/// </summary>
public abstract class TrailerSyncTaskBase : IScheduledTask
{
    private readonly ILibraryManager _libraryManager;
    private readonly TrailerAutomationService _tools;
    private readonly ILogger _logger;

    protected TrailerSyncTaskBase(ILibraryManager libraryManager, TrailerAutomationService tools, ILogger logger)
    {
        _libraryManager = libraryManager;
        _tools = tools;
        _logger = logger;
    }

    public abstract string Name { get; }
    public abstract string Key { get; }
    public abstract string Description { get; }
    public string Category => "JMSFusion";

    protected abstract NativeTrailerMode Mode { get; }
    protected abstract bool Sample { get; }
    protected abstract int Limit { get; }

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => Array.Empty<TaskTriggerInfo>();

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
        await sync.RunAsync(Mode, Sample, Limit, apiKey, progress, cancellationToken).ConfigureAwait(false);
    }
}

/// <summary>Procura o trailer (TMDb e yt-dlp em modo simulacao) para os itens sem trailer. Nao baixa nada.</summary>
public sealed class TrailerSyncSimulateTask : TrailerSyncTaskBase
{
    public TrailerSyncSimulateTask(ILibraryManager libraryManager, TrailerAutomationService tools, ILogger<TrailerSyncSimulateTask> logger)
        : base(libraryManager, tools, logger)
    {
    }

    public override string Name => "JMSFusion: simular trailers (itens sem trailer)";
    public override string Key => "JMSFusionTrailerSyncSimulate";
    public override string Description => "Segue as mesmas regras do download de trailers, mas apenas mostra no log o que seria baixado. Nao baixa nem altera nada.";
    protected override NativeTrailerMode Mode => NativeTrailerMode.Simulate;
    protected override bool Sample => false;
    protected override int Limit => 40;
}

/// <summary>Igual a simulacao, mas em 10 itens que ja tem trailer (para testar as regras). Nao baixa nada.</summary>
public sealed class TrailerSyncSampleTask : TrailerSyncTaskBase
{
    public TrailerSyncSampleTask(ILibraryManager libraryManager, TrailerAutomationService tools, ILogger<TrailerSyncSampleTask> logger)
        : base(libraryManager, tools, logger)
    {
    }

    public override string Name => "JMSFusion: simular trailers (amostra de 10 itens)";
    public override string Key => "JMSFusionTrailerSyncSample";
    public override string Description => "Analisa 10 filmes ou series, mesmo que ja tenham trailer, e mostra no log o que seria escolhido. Nao baixa nem altera nada.";
    protected override NativeTrailerMode Mode => NativeTrailerMode.Simulate;
    protected override bool Sample => true;
    protected override int Limit => 10;
}

/// <summary>Baixa os trailers que faltam. So grava em pastas com permissao de escrita.</summary>
public sealed class TrailerSyncRealTask : TrailerSyncTaskBase
{
    public TrailerSyncRealTask(ILibraryManager libraryManager, TrailerAutomationService tools, ILogger<TrailerSyncRealTask> logger)
        : base(libraryManager, tools, logger)
    {
    }

    public override string Name => "JMSFusion: sincronizar trailers (baixa de verdade)";
    public override string Key => "JMSFusionTrailerSync";
    public override string Description => "Atualiza o yt-dlp e baixa o trailer dos filmes e series que ainda nao tem. Nao mexe em pastas que ja tem trailer.";
    protected override NativeTrailerMode Mode => NativeTrailerMode.Real;
    protected override bool Sample => false;
    protected override int Limit => int.MaxValue;
}
