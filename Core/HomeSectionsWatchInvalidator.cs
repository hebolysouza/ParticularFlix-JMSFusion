using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    // Fork ParticularFlix 4.0.0.12: o Home Screen Sections guarda em memoria, por usuario, a home ja montada por 1 hora
    // apos o ULTIMO acesso (renovada a cada acesso). Quem marcava um titulo como assistido (ou terminava de ver) continuava
    // vendo a home antiga: "Because you watched" nao aparecia e "Continue assistindo" nao mudava. Aqui, quando o
    // assistido/nao assistido muda (marcar/desmarcar ou fim da reproducao), so as entradas DESSE usuario saem do cache;
    // a proxima abertura da home remonta. O progresso durante a reproducao (a cada poucos segundos) e ignorado.
    // Se o Home Screen Sections nao estiver instalado, AccessControlCore.InvalidateHomeSectionsCache nao faz nada.
    public sealed class HomeSectionsWatchInvalidator : IHostedService
    {
        // Varios eventos seguidos do mesmo usuario (marcar uma temporada inteira gera um por episodio) viram uma limpeza so.
        private static readonly TimeSpan Coalesce = TimeSpan.FromSeconds(3);

        private readonly IUserDataManager _userData;
        private readonly ILogger<HomeSectionsWatchInvalidator> _logger;
        private readonly ConcurrentDictionary<Guid, byte> _pending = new();

        public HomeSectionsWatchInvalidator(IUserDataManager userData, ILogger<HomeSectionsWatchInvalidator> logger, IServiceProvider services)
        {
            _userData = userData;
            _logger = logger;
            AccessControlCore.Log ??= logger;
            AccessControlCore.Services ??= services;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            _userData.UserDataSaved += OnUserDataSaved;
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            _userData.UserDataSaved -= OnUserDataSaved;
            return Task.CompletedTask;
        }

        private void OnUserDataSaved(object? sender, UserDataSaveEventArgs e)
        {
            try
            {
                // Comparar pelo nome evita depender do namespace do enum entre versoes do Jellyfin.
                var reason = e.SaveReason.ToString();
                if (!string.Equals(reason, "TogglePlayed", StringComparison.Ordinal)
                    && !string.Equals(reason, "PlaybackFinished", StringComparison.Ordinal))
                {
                    return;
                }

                var userId = e.UserId;
                if (userId == Guid.Empty || !_pending.TryAdd(userId, 0))
                {
                    return;
                }

                _ = Task.Run(async () =>
                {
                    try
                    {
                        await Task.Delay(Coalesce).ConfigureAwait(false);
                    }
                    finally
                    {
                        _pending.TryRemove(userId, out _);
                    }

                    AccessControlCore.InvalidateHomeSectionsCache(userId);
                });
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Home Screen Sections invalidation skipped");
            }
        }
    }
}
