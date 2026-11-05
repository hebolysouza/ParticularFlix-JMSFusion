using System.Diagnostics;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    // Fork ParticularFlix 4.0.0.8: o TaskManager do Jellyfin cria as tarefas agendadas em lote e o gatilho "ao iniciar"
    // de cada uma dispara 3 s depois de criada. Quando o lote demora mais que isso (subida lenta, muitos plugins), o
    // gatilho procura a tarefa numa lista que ainda nao a contem e o log mostra
    // "Unable to find scheduled task of type "StartupService" in QueueScheduledTask": a tarefa nao roda ate a proxima
    // subida. Em 05/11/2026 isso aconteceu com a "HomeScreenSections Startup": sem ela o Home Screen Sections nao
    // modifica a home e somem as secoes que so ele tem (Because You Watched, Filmes e Series em breve).
    // Este servico espera a subida assentar e executa, uma vez, cada tarefa com gatilho de inicializacao que nao rodou
    // desde que o processo comecou. Nao mexe em gatilhos nem em tarefas que ja rodaram ou estao rodando.
    public sealed class StartupTaskGuardService : BackgroundService
    {
        private static readonly TimeSpan FirstCheckDelay = TimeSpan.FromSeconds(90);
        private static readonly TimeSpan SecondCheckDelay = TimeSpan.FromSeconds(90);

        private readonly ITaskManager _taskManager;
        private readonly ILogger<StartupTaskGuardService> _logger;

        public StartupTaskGuardService(ITaskManager taskManager, ILogger<StartupTaskGuardService> logger)
        {
            _taskManager = taskManager;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try
            {
                // Inicio desta subida: o do processo, ou (reinicio pelo painel, que o Jellyfin faz no mesmo processo)
                // um minuto antes deste servico comecar. Fica o mais recente dos dois.
                var serviceStartUtc = DateTime.UtcNow;
                await Task.Delay(FirstCheckDelay, stoppingToken).ConfigureAwait(false);
                var processStartUtc = GetProcessStartUtc(serviceStartUtc);
                var hostStartUtc = serviceStartUtc - TimeSpan.FromSeconds(60);
                var bootUtc = processStartUtc > hostStartUtc ? processStartUtc : hostStartUtc;
                RunMissedStartupTasks(bootUtc);

                // Segunda passada para as tarefas que ainda estavam rodando na primeira. As executadas na primeira ja
                // terminaram depois da subida (ou seguem rodando) e sao ignoradas: nada roda duas vezes.
                await Task.Delay(SecondCheckDelay, stoppingToken).ConfigureAwait(false);
                RunMissedStartupTasks(bootUtc);
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[JMSFusion] Startup task guard failed");
            }
        }

        private static DateTime GetProcessStartUtc(DateTime fallbackUtc)
        {
            try
            {
                using var process = Process.GetCurrentProcess();
                return process.StartTime.ToUniversalTime();
            }
            catch
            {
                return fallbackUtc - TimeSpan.FromSeconds(60);
            }
        }

        private void RunMissedStartupTasks(DateTime bootUtc)
        {
            foreach (var worker in _taskManager.ScheduledTasks.ToList())
            {
                try
                {
                    if (worker.Triggers?.Any(t => t.Type == TaskTriggerInfoType.StartupTrigger) != true)
                    {
                        continue;
                    }

                    if (worker.State != TaskState.Idle)
                    {
                        continue;
                    }

                    var last = worker.LastExecutionResult;
                    if (last is not null && last.EndTimeUtc >= bootUtc)
                    {
                        continue;
                    }

                    _logger.LogWarning(
                        "[JMSFusion] Startup task \"{Name}\" ({Key}) did not run after this server start; running it now",
                        worker.Name,
                        worker.ScheduledTask?.Key);
                    _taskManager.Execute(worker, new TaskOptions());
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[JMSFusion] Could not run the missed startup task \"{Name}\"", worker.Name);
                }
            }
        }
    }
}
