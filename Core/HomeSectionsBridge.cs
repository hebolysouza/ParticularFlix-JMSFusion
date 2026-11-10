using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    // Fork ParticularFlix 4.0.0.12: ponte com o Home Screen Sections (IAmParadox27/jellyfin-plugin-home-sections), sem
    // referencia ao outro plugin: tudo por reflexao, e se ele nao existir ou mudar de estrutura nada acontece.
    // O HSS guarda a lista de secoes de cada usuario em <configuracoes de plugins>/Jellyfin.Plugin.HomeScreenSections/
    // ModularHomeSettings.json, grava o arquivo na hora (UpdateUserSettings) e o le a cada pedido (GetUserSettings).
    // Quem nao tem item no arquivo recebe o padrao do plugin (quase tudo ligado). O que segurava a Home antiga depois de
    // mudar o arquivo era o cache em memoria de 1 hora, limpo aqui com AccessControlCore.InvalidateHomeSectionsCache.
    // Por isso copiar a Home de um usuario para outro nao precisa reiniciar o Jellyfin.
    internal static class HomeSectionsBridge
    {
        private const string AssemblyName = "Jellyfin.Plugin.HomeScreenSections";
        private const string ManagerTypeName = "Jellyfin.Plugin.HomeScreenSections.Library.IHomeScreenManager";
        private const string SettingsFolder = "Jellyfin.Plugin.HomeScreenSections";
        private const string SettingsFile = "ModularHomeSettings.json";

        private static readonly object CopyGate = new();

        private static Type? FindManagerType()
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                string? name;
                try { name = asm.GetName().Name; } catch { continue; }
                if (!string.Equals(name, AssemblyName, StringComparison.Ordinal)) continue;
                var type = asm.GetType(ManagerTypeName, false);
                if (type is not null) return type;
            }

            return null;
        }

        public static bool TryGetManager(IServiceProvider? services, out object manager, out Type managerType)
        {
            manager = null!;
            managerType = null!;
            if (services is null) return false;
            var type = FindManagerType();
            if (type is null) return false;
            object? instance;
            try { instance = services.GetService(type); } catch { instance = null; }
            if (instance is null) return false;
            manager = instance;
            managerType = type;
            return true;
        }

        // IDs (formato N) dos usuarios que ja tem lista propria no arquivo do HSS.
        public static HashSet<string> UsersWithEntry(IApplicationPaths paths)
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var file = Path.Combine(paths.PluginConfigurationsPath, SettingsFolder, SettingsFile);
                if (!File.Exists(file)) return result;
                using var doc = JsonDocument.Parse(File.ReadAllText(file));
                if (doc.RootElement.ValueKind != JsonValueKind.Array) return result;
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) continue;
                    foreach (var prop in item.EnumerateObject())
                    {
                        if (string.Equals(prop.Name, "UserId", StringComparison.OrdinalIgnoreCase)
                            && prop.Value.ValueKind == JsonValueKind.String
                            && Guid.TryParse(prop.Value.GetString(), out var id))
                        {
                            result.Add(id.ToString("N"));
                        }
                    }
                }
            }
            catch
            {
            }

            return result;
        }

        public static List<string>? GetEnabledSections(object manager, Type managerType, Guid userId)
        {
            try
            {
                var settings = managerType.GetMethod("GetUserSettings", new[] { typeof(Guid) })?.Invoke(manager, new object[] { userId });
                if (settings?.GetType().GetProperty("EnabledSections")?.GetValue(settings) is IEnumerable list)
                {
                    return list.Cast<object?>().Select(x => x?.ToString() ?? string.Empty).Where(x => x.Length > 0).ToList();
                }
            }
            catch
            {
            }

            return null;
        }

        // Copia a lista de secoes (efetiva) de source para target pelo proprio HSS e limpa o cache da Home de target.
        public static bool Copy(object manager, Type managerType, Guid source, Guid target, out string? error)
        {
            error = null;
            try
            {
                lock (CopyGate)
                {
                    var get = managerType.GetMethod("GetUserSettings", new[] { typeof(Guid) });
                    var update = managerType.GetMethods().FirstOrDefault(m => m.Name == "UpdateUserSettings" && m.GetParameters().Length == 2);
                    if (get is null || update is null)
                    {
                        error = "Home Screen Sections sem GetUserSettings/UpdateUserSettings";
                        return false;
                    }

                    var settings = get.Invoke(manager, new object[] { source });
                    if (settings is null)
                    {
                        error = "modelo sem configuracao";
                        return false;
                    }

                    settings.GetType().GetProperty("UserId")?.SetValue(settings, target);
                    update.Invoke(manager, new object[] { target, settings });
                }

                AccessControlCore.InvalidateHomeSectionsCache(target);
                return true;
            }
            catch (Exception ex)
            {
                error = (ex.InnerException ?? ex).Message;
                return false;
            }
        }
    }

    // Fork ParticularFlix 4.0.0.12: com um usuario modelo definido (HomeSectionsTemplateUserId), quem ainda nao tem lista de
    // secoes propria no HSS (usuario novo, ou antigo que nunca mexeu, como os que caiam no padrao "quase tudo ligado")
    // recebe a do modelo em ate 1 minuto, sem reiniciar. Quem ja tem lista propria nunca e tocado.
    public sealed class HomeSectionsSeeder : BackgroundService
    {
        private readonly IUserManager _users;
        private readonly IApplicationPaths _paths;
        private readonly IServiceProvider _services;
        private readonly ILogger<HomeSectionsSeeder> _logger;

        // Usuarios em que a copia falhou: nao repete (nem enche o log) ate o modelo mudar.
        private readonly HashSet<Guid> _failed = new();
        private Guid _lastTemplate = Guid.Empty;

        public HomeSectionsSeeder(IUserManager users, IApplicationPaths paths, IServiceProvider services, ILogger<HomeSectionsSeeder> logger)
        {
            _users = users;
            _paths = paths;
            _services = services;
            _logger = logger;
            AccessControlCore.Log ??= logger;
            AccessControlCore.Services ??= services;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken).ConfigureAwait(false);
                while (!stoppingToken.IsCancellationRequested)
                {
                    try
                    {
                        SeedMissing();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug(ex, "Home Screen Sections seeding skipped");
                    }

                    await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
            }
        }

        private void SeedMissing()
        {
            var template = JMSFusionPlugin.Instance?.Configuration?.HomeSectionsTemplateUserId;
            if (string.IsNullOrWhiteSpace(template) || !Guid.TryParse(template, out var templateId) || templateId == Guid.Empty)
            {
                return;
            }

            if (_users.GetUserById(templateId) is null)
            {
                return;
            }

            if (templateId != _lastTemplate)
            {
                _lastTemplate = templateId;
                _failed.Clear();
            }

            if (!HomeSectionsBridge.TryGetManager(_services, out var manager, out var managerType))
            {
                return;
            }

            var withEntry = HomeSectionsBridge.UsersWithEntry(_paths);
            foreach (var user in _users.Users.ToList())
            {
                if (user.Id == templateId || withEntry.Contains(user.Id.ToString("N")) || _failed.Contains(user.Id))
                {
                    continue;
                }

                if (HomeSectionsBridge.Copy(manager, managerType, templateId, user.Id, out var error))
                {
                    _logger.LogInformation("[JMSFusion] Home Screen Sections: Home do modelo copiada para {User}", user.Username);
                }
                else
                {
                    _failed.Add(user.Id);
                    _logger.LogWarning("[JMSFusion] Home Screen Sections: nao foi possivel copiar a Home do modelo para {User}: {Error}", user.Username, error);
                }
            }
        }
    }
}
