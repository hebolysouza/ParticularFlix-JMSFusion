using System.Reflection;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Users;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    // O Jellyfin 10.11.x mudou a assinatura binaria de IUserManager (tipo User); por isso o acesso a
    // usuarios e feito por reflexao em tempo de execucao, como no restante do plugin.
    public static class UserAccessor
    {
        private const BindingFlags Flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        // Procura primeiro na interface (implementacoes explicitas so aparecem la) e depois na classe real.
        private static IEnumerable<Type> Sources(IUserManager users)
        {
            yield return typeof(IUserManager);
            yield return users.GetType();
        }

        private static PropertyInfo? FindProperty(IUserManager users, string name)
        {
            return Sources(users).Select(t => t.GetProperty(name, Flags)).FirstOrDefault(p => p is not null);
        }

        private static MethodInfo? FindMethod(IUserManager users, string name, Func<ParameterInfo[], bool> match)
        {
            return Sources(users)
                .SelectMany(t => t.GetMethods(Flags))
                .FirstOrDefault(m => m.Name == name && match(m.GetParameters()));
        }

        public static List<object> List(IUserManager users)
        {
            var result = new List<object>();

            // 1) propriedade Users, 2) metodos sem parametro GetUsers/GetAllUsers, 3) ids + GetUserById.
            object? value = FindProperty(users, "Users")?.GetValue(users);
            if (value is null)
            {
                foreach (var name in new[] { "GetUsers", "GetAllUsers" })
                {
                    var m = FindMethod(users, name, ps => ps.Length == 0);
                    if (m is not null)
                    {
                        value = m.Invoke(users, Array.Empty<object>());
                        if (value is not null)
                        {
                            break;
                        }
                    }
                }
            }

            if (value is System.Collections.IEnumerable items)
            {
                foreach (var item in items)
                {
                    if (item is not null)
                    {
                        result.Add(item);
                    }
                }
            }

            if (result.Count == 0)
            {
                var idsValue = FindProperty(users, "UsersIds")?.GetValue(users);
                if (idsValue is System.Collections.IEnumerable ids)
                {
                    foreach (var rawId in ids)
                    {
                        if (rawId is Guid g && Find(users, g) is { } found)
                        {
                            result.Add(found);
                        }
                    }
                }
            }

            return result;
        }

        public static object? Find(IUserManager users, Guid id)
        {
            var method = FindMethod(users, "GetUserById", ps => ps.Length == 1 && ps[0].ParameterType == typeof(Guid));
            return method?.Invoke(users, new object[] { id });
        }

        public static Guid IdOf(object user)
        {
            return user.GetType().GetProperty("Id", Flags)?.GetValue(user) is Guid g ? g : Guid.Empty;
        }

        public static string NameOf(object user)
        {
            return user.GetType().GetProperty("Username", Flags)?.GetValue(user)?.ToString() ?? string.Empty;
        }

        public static UserPolicy? PolicyOf(IUserManager users, object user)
        {
            var method = FindMethod(users, "GetUserDto", ps => ps.Length >= 1 && ps[0].ParameterType.IsInstanceOfType(user) && ps.Skip(1).All(p => p.IsOptional));
            if (method is null)
            {
                throw new MissingMethodException("IUserManager.GetUserDto not found.");
            }

            var args = method.GetParameters().Select((p, i) => i == 0 ? user : (p.HasDefaultValue ? p.DefaultValue : null)).ToArray();
            var dto = method.Invoke(users, args);
            return dto?.GetType().GetProperty("Policy", Flags)?.GetValue(dto) as UserPolicy;
        }

        public static async Task UpdatePolicyAsync(IUserManager users, Guid id, UserPolicy policy)
        {
            var method = FindMethod(users, "UpdatePolicyAsync", ps => ps.Length == 2 && ps[0].ParameterType == typeof(Guid) && ps[1].ParameterType.IsInstanceOfType(policy));
            if (method is null)
            {
                throw new MissingMethodException("IUserManager.UpdatePolicyAsync not found.");
            }

            if (method.Invoke(users, new object[] { id, policy }) is Task task)
            {
                await task.ConfigureAwait(false);
            }
        }
    }

    // Fork ParticularFlix: nucleo do controle de acesso. Aplica valores na politica NATIVA do Jellyfin
    // (UserPolicy), que o servidor impoe para todos os clientes.
    public static class AccessControlCore
    {
        // Uma operacao de cada vez sobre a configuracao e as politicas.
        public static readonly SemaphoreSlim Gate = new(1, 1);

        public static UnratedItem[] ToUnrated(int[]? values)
        {
            if (values is null || values.Length == 0)
            {
                return Array.Empty<UnratedItem>();
            }

            return values
                .Where(v => Enum.IsDefined(typeof(UnratedItem), v))
                .Select(v => (UnratedItem)v)
                .Distinct()
                .ToArray();
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        public static bool IsAdmin(UserPolicy policy)
        {
            return policy.IsAdministrator;
        }

        public static int[] AllUnratedValues()
        {
            return Enum.GetValues(typeof(UnratedItem)).Cast<UnratedItem>().Select(v => (int)v).ToArray();
        }

        public static AccessPolicyValues Capture(UserPolicy policy)
        {
            return new AccessPolicyValues
            {
                MaxParentalRating = policy.MaxParentalRating,
                BlockUnratedItems = (policy.BlockUnratedItems ?? Array.Empty<UnratedItem>()).Select(v => (int)v).ToArray(),
                BlockedTags = policy.BlockedTags ?? Array.Empty<string>(),
                AllowedTags = policy.AllowedTags ?? Array.Empty<string>(),
                EnableAllFolders = policy.EnableAllFolders,
                EnabledFolders = (policy.EnabledFolders ?? Array.Empty<Guid>()).Select(g => g.ToString("N")).ToArray()
            };
        }

        // Os caches de listas (slider, fileiras recentes, diretores, recomendacoes, colecoes) guardam itens
        // que o usuario via antes da mudanca de permissao. Sao apenas caches e se refazem sozinhos.
        private static readonly string[] ItemCacheTypes =
        {
            "sliderCache", "recentRows", "directorRows", "personalRecommendations", "collectionCache"
        };

        public static void PurgeItemCaches()
        {
            var plugin = JMSFusionPlugin.Instance;
            if (plugin is null)
            {
                return;
            }

            foreach (var type in ItemCacheTypes)
            {
                try
                {
                    var dir = plugin.GetStorageDirectory("scoped-cache", type);
                    if (!Directory.Exists(dir))
                    {
                        continue;
                    }

                    foreach (var file in Directory.EnumerateFiles(dir, "*.json"))
                    {
                        try { File.Delete(file); } catch { }
                    }
                }
                catch
                {
                }
            }
        }

        // Devolve false quando o usuario nao existe ou e administrador (nunca restringimos administradores).
        public static async Task<bool> ApplyAsync(IUserManager users, Guid userId, AccessPolicyValues values)
        {
            var user = UserAccessor.Find(users, userId);
            if (user is null)
            {
                return false;
            }

            var policy = UserAccessor.PolicyOf(users, user);
            if (policy is null || IsAdmin(policy))
            {
                return false;
            }

            policy.MaxParentalRating = values.MaxParentalRating;
            policy.BlockUnratedItems = ToUnrated(values.BlockUnratedItems);
            policy.BlockedTags = values.BlockedTags ?? Array.Empty<string>();
            policy.AllowedTags = values.AllowedTags ?? Array.Empty<string>();
            policy.EnableAllFolders = values.EnableAllFolders;
            policy.EnabledFolders = (values.EnabledFolders ?? Array.Empty<string>())
                .Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty)
                .Where(g => g != Guid.Empty)
                .Distinct()
                .ToArray();

            await UserAccessor.UpdatePolicyAsync(users, userId, policy).ConfigureAwait(false);
            PurgeItemCaches();
            return true;
        }

        // Volta para a politica restrita quando o desbloqueio temporario venceu.
        public static async Task RelockExpiredAsync(IUserManager users, ILogger logger)
        {
            var plugin = JMSFusionPlugin.Instance;
            if (plugin is null)
            {
                return;
            }

            await Gate.WaitAsync().ConfigureAwait(false);
            try
            {
                var cfg = plugin.Configuration;
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var changed = false;

                foreach (var entry in cfg.AccessProfiles.ToList())
                {
                    if (entry.UnlockedUntilUtc <= 0 || entry.UnlockedUntilUtc > now)
                    {
                        continue;
                    }

                    if (Guid.TryParse(entry.UserId, out var id))
                    {
                        await ApplyAsync(users, id, entry.Restricted).ConfigureAwait(false);
                        logger.LogInformation("[JMSFusion] Access control: temporary unlock ended, restricted policy restored for {UserId}.", entry.UserId);
                    }

                    entry.UnlockedUntilUtc = 0;
                    changed = true;
                }

                if (changed)
                {
                    plugin.UpdateConfiguration(cfg);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[JMSFusion] Access control: relock pass failed, it will be retried.");
            }
            finally
            {
                Gate.Release();
            }
        }
    }

    // Verifica a cada 20 s (e logo apos iniciar) se algum desbloqueio venceu.
    public sealed class AccessRelockService : BackgroundService
    {
        private readonly IUserManager _users;
        private readonly ILogger<AccessRelockService> _logger;

        public AccessRelockService(IUserManager users, ILogger<AccessRelockService> logger)
        {
            _users = users;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken).ConfigureAwait(false);
                while (!stoppingToken.IsCancellationRequested)
                {
                    await AccessControlCore.RelockExpiredAsync(_users, _logger).ConfigureAwait(false);
                    await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
            }
        }
    }
}
