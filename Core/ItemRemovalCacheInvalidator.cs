using System;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    // Fork ParticularFlix 4.0.0.13: os caches de lista (slider, fileiras recentes, diretores, recomendacoes, colecoes)
    // guardam os itens ja montados. Quando um filme, serie ou colecao era apagado da biblioteca, o card continuava no
    // slider e nas fileiras ate o cache expirar, e abrir dava "item nao encontrado". Aqui, uma remocao de Movie, Series
    // ou BoxSet agenda UMA troca de geracao do cache de todos os usuarios, 2 minutos depois da ultima remocao (apagar
    // uma pasta inteira vira uma troca so). Episodios, temporadas e musicas nao disparam. Os arquivos antigos deixam de
    // ser lidos e a limpeza de 14 dias de AccessControlCore os remove. Desligar: InvalidateListCachesOnItemRemoval.
    public sealed class ItemRemovalCacheInvalidator : IHostedService, IDisposable
    {
        private static readonly TimeSpan Quiet = TimeSpan.FromMinutes(2);

        private readonly ILibraryManager _library;
        private readonly IUserManager _users;
        private readonly ILogger<ItemRemovalCacheInvalidator> _logger;
        private readonly object _gate = new();
        private Timer? _timer;
        private int _removedSinceLast;

        public ItemRemovalCacheInvalidator(ILibraryManager library, IUserManager users, ILogger<ItemRemovalCacheInvalidator> logger)
        {
            _library = library;
            _users = users;
            _logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            _library.ItemRemoved += OnItemRemoved;
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            _library.ItemRemoved -= OnItemRemoved;
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

        private void OnItemRemoved(object? sender, ItemChangeEventArgs e)
        {
            try
            {
                if (JMSFusionPlugin.Instance?.Configuration?.InvalidateListCachesOnItemRemoval != true)
                {
                    return;
                }

                // Comparar pelo nome do tipo evita depender dos namespaces das entidades entre versoes do Jellyfin.
                var typeName = e?.Item?.GetType().Name;
                if (!string.Equals(typeName, "Movie", StringComparison.Ordinal)
                    && !string.Equals(typeName, "Series", StringComparison.Ordinal)
                    && !string.Equals(typeName, "BoxSet", StringComparison.Ordinal))
                {
                    return;
                }

                lock (_gate)
                {
                    _removedSinceLast++;
                    _timer ??= new Timer(_ => Flush(), null, Timeout.Infinite, Timeout.Infinite);
                    _timer.Change(Quiet, Timeout.InfiniteTimeSpan);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "[JMSFusion] List cache invalidation on item removal skipped");
            }
        }

        private void Flush()
        {
            int removed;
            lock (_gate)
            {
                removed = _removedSinceLast;
                _removedSinceLast = 0;
            }

            if (removed == 0)
            {
                return;
            }

            try
            {
                var plugin = JMSFusionPlugin.Instance;
                if (plugin is null)
                {
                    return;
                }

                var count = 0;
                foreach (var user in UserAccessor.List(_users))
                {
                    var id = UserAccessor.IdOf(user);
                    if (id == Guid.Empty)
                    {
                        continue;
                    }

                    AccessControlCore.BumpCacheGeneration(id);
                    count++;
                }

                if (count > 0)
                {
                    plugin.UpdateConfiguration(plugin.Configuration);
                }

                _logger.LogInformation(
                    "[JMSFusion] {Removed} movie/series/collection removal(s): list caches of {Users} user(s) will be rebuilt on the next page load.",
                    removed,
                    count);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[JMSFusion] List cache invalidation after item removal failed");
            }
        }
    }
}
