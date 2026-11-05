using System.Collections.Concurrent;
using System.Globalization;
using Jellyfin.Plugin.JMSFusion.Core;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Tasks;

/// <summary>
/// Baixa o trailer de titulos novos assim que a pasta aparece na biblioteca.
/// Fork ParticularFlix 4.0.0.10: antes dependia so do evento ItemAdded do Jellyfin, que chega depois do atraso do
/// monitor de biblioteca e do escaneamento, e ainda esperava 3 minutos de silencio (4 a 5 minutos no total; o script
/// antigo no Windows reagia em segundos). Agora:
/// 1) vigia as pastas das bibliotecas de filmes e series (FileSystemWatcher) e processa a pasta nova 15 s depois do
///    ultimo evento, sem esperar o Jellyfin catalogar o titulo (ano e TMDb saem do nome da pasta);
/// 2) a cada 30 s compara a lista de pastas do primeiro nivel de cada biblioteca, para o caso de o evento de arquivo
///    nao chegar ao container (montagens do Docker Desktop);
/// 3) o ItemAdded continua como ultima rede, com 90 s de silencio, rodando a sincronizacao das pastas sem trailer.
/// A tarefa agendada segue procurando faltantes e trocando trailers AV1 nos horarios dela.
/// </summary>
public sealed class TrailerWatcher : IHostedService, IDisposable
{
    private static readonly TimeSpan QuietPeriod = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan FolderSettle = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan FirstPoll = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan WatcherRefresh = TimeSpan.FromMinutes(10);
    private static readonly string[] VideoExtensions = { ".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".ts" };

    // Subpastas de extras do Jellyfin: video dentro delas nao e titulo novo.
    private static readonly HashSet<string> ExtrasFolders = new(StringComparer.OrdinalIgnoreCase)
    {
        "extras", "featurettes", "behind the scenes", "deleted scenes", "interviews", "scenes", "shorts", "trailers", "other", "samples", "clips"
    };

    private readonly ILibraryManager _libraryManager;
    private readonly TrailerAutomationService _tools;
    private readonly ILogger<TrailerWatcher> _logger;
    private readonly object _gate = new();
    private readonly ConcurrentDictionary<string, bool> _pending = new(StringComparer.Ordinal);
    private readonly Dictionary<string, HashSet<string>> _knownFolders = new(StringComparer.Ordinal);
    private readonly List<FileSystemWatcher> _watchers = new();
    private List<(string Root, bool IsSeries)> _roots = new();
    private string _rootsKey = string.Empty;
    private DateTime _lastWatcherRefresh = DateTime.MinValue;
    private Timer? _itemAddedTimer;
    private Timer? _flushTimer;
    private Timer? _pollTimer;
    private int _flushing;
    private int _polling;
    private bool _stopped;

    public TrailerWatcher(ILibraryManager libraryManager, TrailerAutomationService tools, ILogger<TrailerWatcher> logger)
    {
        _libraryManager = libraryManager;
        _tools = tools;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _libraryManager.ItemAdded += OnItemAdded;
        lock (_gate)
        {
            _stopped = false;
            _pollTimer = new Timer(_ => Poll(), null, FirstPoll, PollInterval);
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _libraryManager.ItemAdded -= OnItemAdded;
        DisposeAll();
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        DisposeAll();
    }

    private void DisposeAll()
    {
        lock (_gate)
        {
            _stopped = true;
            _itemAddedTimer?.Dispose();
            _itemAddedTimer = null;
            _flushTimer?.Dispose();
            _flushTimer = null;
            _pollTimer?.Dispose();
            _pollTimer = null;
            foreach (var w in _watchers)
            {
                try
                {
                    w.EnableRaisingEvents = false;
                    w.Dispose();
                }
                catch
                {
                }
            }

            _watchers.Clear();
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
            if (_stopped)
            {
                return;
            }

            _itemAddedTimer?.Dispose();
            _itemAddedTimer = new Timer(_ => _ = RunFullAsync(), null, QuietPeriod, Timeout.InfiniteTimeSpan);
        }
    }

    // Bibliotecas de filmes e series (sem a adulta). O tipo da biblioteca vem como texto para nao depender do enum.
    private List<(string Root, bool IsSeries)> ReadRoots()
    {
        var roots = new List<(string Root, bool IsSeries)>();
        try
        {
            foreach (var f in _libraryManager.GetVirtualFolders())
            {
                var type = Convert.ToString(f.CollectionType, CultureInfo.InvariantCulture) ?? string.Empty;
                var isMovies = type.Equals("movies", StringComparison.OrdinalIgnoreCase);
                var isSeries = type.Equals("tvshows", StringComparison.OrdinalIgnoreCase);
                if (!isMovies && !isSeries)
                {
                    continue;
                }

                foreach (var loc in f.Locations ?? Array.Empty<string>())
                {
                    if (!string.IsNullOrWhiteSpace(loc) && !IsExcluded(loc) && Directory.Exists(loc))
                    {
                        roots.Add((loc.TrimEnd('/', '\\'), isSeries));
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[JMS trailers] Tempo real: nao consegui ler as bibliotecas: {Erro}", ex.Message);
        }

        return roots;
    }

    // Recria os watchers quando as bibliotecas mudam (ou a cada 10 minutos, se um watcher deu erro).
    private void RefreshWatchers(List<(string Root, bool IsSeries)> roots)
    {
        var key = string.Join("|", roots.Select(r => r.Root + (r.IsSeries ? ":s" : ":m")));
        lock (_gate)
        {
            if (_stopped || (roots.Count == 0 && key == _rootsKey))
            {
                return;
            }

            if (key == _rootsKey && _watchers.Count > 0 && DateTime.UtcNow - _lastWatcherRefresh < WatcherRefresh)
            {
                return;
            }

            var changed = key != _rootsKey || _watchers.Count == 0;
            if (!changed && _watchers.All(w => w.EnableRaisingEvents))
            {
                _lastWatcherRefresh = DateTime.UtcNow;
                return;
            }

            foreach (var w in _watchers)
            {
                try
                {
                    w.EnableRaisingEvents = false;
                    w.Dispose();
                }
                catch
                {
                }
            }

            _watchers.Clear();
            foreach (var (root, isSeries) in roots)
            {
                try
                {
                    var w = new FileSystemWatcher(root)
                    {
                        IncludeSubdirectories = true,
                        NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName,
                        InternalBufferSize = 64 * 1024
                    };
                    var r = root;
                    var s = isSeries;
                    w.Created += (_, e) => OnFsEvent(r, s, e.FullPath);
                    w.Renamed += (_, e) => OnFsEvent(r, s, e.FullPath);
                    w.Error += (_, e) =>
                    {
                        _logger.LogWarning("[JMS trailers] Tempo real: watcher de {Pasta} falhou ({Erro}); a varredura de 30 s continua.", r, e.GetException()?.Message);
                        try
                        {
                            w.EnableRaisingEvents = false;
                        }
                        catch
                        {
                        }
                    };
                    w.EnableRaisingEvents = true;
                    _watchers.Add(w);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("[JMS trailers] Tempo real: nao consegui vigiar {Pasta}: {Erro}", root, ex.Message);
                }
            }

            _roots = roots;
            _rootsKey = key;
            _lastWatcherRefresh = DateTime.UtcNow;
            _logger.LogInformation(
                "[JMS trailers] Tempo real: vigiando {Total} pasta(s) de biblioteca: {Pastas}",
                _watchers.Count,
                string.Join(", ", roots.Select(x => x.Root + (x.IsSeries ? " (series)" : " (filmes)"))));
        }
    }

    // Evento de arquivo: so videos que nao sao trailer nem amostra. Filme: a pasta do arquivo. Serie: a pasta do
    // primeiro nivel abaixo da biblioteca (os trailers de serie ficam na pasta da serie).
    private void OnFsEvent(string root, bool isSeries, string path)
    {
        try
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (!VideoExtensions.Contains(ext))
            {
                return;
            }

            var name = Path.GetFileNameWithoutExtension(path);
            if (name.StartsWith("trailer", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("-trailer", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith(".", StringComparison.Ordinal)
                || name.Contains("sample", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var rel = Path.GetRelativePath(root, path);
            var parts = rel.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2 || parts[0] == "..")
            {
                return;
            }

            var parent = Path.GetFileName(Path.GetDirectoryName(path) ?? string.Empty);
            if (!isSeries && ExtrasFolders.Contains(parent))
            {
                return;
            }

            var folder = isSeries ? Path.Combine(root, parts[0]) : Path.GetDirectoryName(path);
            if (string.IsNullOrWhiteSpace(folder) || IsExcluded(folder))
            {
                return;
            }

            Enqueue(folder!, isSeries, "evento de arquivo");
        }
        catch
        {
        }
    }

    private void Enqueue(string folder, bool isSeries, string source)
    {
        if (_pending.TryAdd(folder, isSeries))
        {
            _logger.LogInformation("[JMS trailers] Tempo real: pasta nova ({Origem}): {Pasta}", source, Path.GetFileName(folder));
        }
        lock (_gate)
        {
            if (_stopped)
            {
                return;
            }

            _flushTimer?.Dispose();
            _flushTimer = new Timer(_ => _ = FlushAsync(), null, FolderSettle, Timeout.InfiniteTimeSpan);
        }
    }

    // A cada 30 s: confere os watchers e procura pastas novas no primeiro nivel de cada biblioteca. A primeira passada
    // so memoriza o que ja existe; dai em diante, pasta nova vai para a fila (a mesma dos eventos de arquivo).
    private void Poll()
    {
        if (Interlocked.Exchange(ref _polling, 1) == 1)
        {
            return;
        }

        try
        {
            var roots = ReadRoots();
            RefreshWatchers(roots);
            foreach (var (root, isSeries) in roots)
            {
                List<string> dirs;
                try
                {
                    dirs = Directory.EnumerateDirectories(root).ToList();
                }
                catch
                {
                    continue;
                }

                if (!_knownFolders.TryGetValue(root, out var known))
                {
                    _knownFolders[root] = new HashSet<string>(dirs, StringComparer.Ordinal);
                    continue;
                }

                foreach (var d in dirs)
                {
                    if (known.Add(d) && !IsExcluded(d))
                    {
                        Enqueue(d, isSeries, "varredura");
                    }
                }

                known.IntersectWith(dirs);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[JMS trailers] Tempo real: varredura falhou: {Erro}", ex.Message);
        }
        finally
        {
            Interlocked.Exchange(ref _polling, 0);
        }
    }

    private async Task FlushAsync()
    {
        if (Interlocked.Exchange(ref _flushing, 1) == 1)
        {
            // Um lote ainda esta baixando: tenta de novo depois, sem perder as pastas da fila.
            lock (_gate)
            {
                if (!_stopped)
                {
                    _flushTimer?.Dispose();
                    _flushTimer = new Timer(_ => _ = FlushAsync(), null, FolderSettle, Timeout.InfiniteTimeSpan);
                }
            }

            return;
        }

        try
        {
            var targets = new List<TrailerTarget>();
            foreach (var folder in _pending.Keys.ToList())
            {
                if (_pending.TryRemove(folder, out var isSeries))
                {
                    targets.Add(new TrailerTarget(folder, isSeries, null, null));
                }
            }

            if (targets.Count == 0)
            {
                return;
            }

            var apiKey = JMSFusionPlugin.Instance?.Configuration?.TmdbApiKey?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(apiKey) || apiKey == "CHANGE_ME")
            {
                _logger.LogWarning("[JMS trailers] Titulo novo detectado, mas a chave do TMDb nao esta configurada no plugin.");
                return;
            }

            var sync = new NativeTrailerSync(_libraryManager, _tools, _logger);
            await sync.RunForFoldersAsync(targets, apiKey, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[JMS trailers] Erro na deteccao em tempo real: {Erro}", ex.Message);
        }
        finally
        {
            Interlocked.Exchange(ref _flushing, 0);
        }
    }

    private async Task RunFullAsync()
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

    // Mesma regra da sincronizacao: biblioteca adulta e pastas xxx/adult/adultos ficam fora, sempre.
    private static bool IsExcluded(string path)
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
