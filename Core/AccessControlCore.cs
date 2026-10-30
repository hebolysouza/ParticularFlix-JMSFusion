using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
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

        // Sobe a geracao dos caches de lista (slider, fileiras recentes, diretores, recomendacoes, colecoes).
        // Arquivos de geracoes antigas deixam de ser lidos; paginas abertas com dados antigos recebem 409 ao
        // tentar grava-los de volta. Sao apenas caches e se refazem sozinhos.
        public static void BumpCacheGeneration(Guid userId)
        {
            var plugin = JMSFusionPlugin.Instance;
            if (plugin is null)
            {
                return;
            }

            var cfg = plugin.Configuration;
            var key = userId.ToString("N");
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var entry = cfg.AccessCacheGenerations.FirstOrDefault(e => string.Equals(e.UserId, key, StringComparison.OrdinalIgnoreCase));
            if (entry is null)
            {
                entry = new AccessGenEntry { UserId = key };
                cfg.AccessCacheGenerations.Add(entry);
            }

            entry.Generation = Math.Max(entry.Generation + 1, now);
            PruneOldCaches(plugin);
        }

        // Fork ParticularFlix: os arquivos de cache tem nome de hash (escopo + geracao) e nao dizem de quem sao. A limpeza
        // apagava todo arquivo anterior a nova geracao, ou seja, o cache de TODOS os usuarios a cada desbloqueio, bloqueio
        // ou reaplicacao do perfil restrito; ao voltar para o administrador o slider refazia tudo do zero (~30 s). A
        // geracao nova ja torna os arquivos antigos do usuario inalcancaveis; aqui so saem os parados ha mais de 14 dias.
        private static readonly TimeSpan OrphanCacheMaxAge = TimeSpan.FromDays(14);

        private static void PruneOldCaches(JMSFusionPlugin plugin)
        {
            var cutoff = DateTime.UtcNow - OrphanCacheMaxAge;
            foreach (var type in Core.ScopedCacheJsonService.GenerationCacheTypes)
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
                        try
                        {
                            if (File.GetLastWriteTimeUtc(file) < cutoff)
                            {
                                File.Delete(file);
                            }
                        }
                        catch
                        {
                        }
                    }
                }
                catch
                {
                }
            }
        }

        // Isolamento: so estes campos da politica pertencem ao controle de acesso. Todo o resto
        // (permissoes, dispositivos, canais, sessoes...) deve permanecer exatamente como estava.
        private static readonly HashSet<string> AccessFieldNames = new(StringComparer.OrdinalIgnoreCase)
        {
            "MaxParentalRating", "BlockUnratedItems", "BlockedTags", "AllowedTags", "EnableAllFolders", "EnabledFolders"
        };

        public static ILogger? Log { get; set; }

        public static IServiceProvider? Services { get; set; }

        // O Home Screen Sections guarda em memoria, por usuario, a lista de secoes ja montada e a reaproveita
        // por 1 hora (renovada a cada acesso). Se ela foi montada com outro nivel de acesso, a home continua
        // mostrando o resultado antigo (ex.: "Because you watched" sumido apos desbloquear, ou titulos
        // liberados aparecendo apos bloquear). Aqui so removemos as entradas desse usuario. Se o plugin nao
        // existir ou mudar de estrutura, nada acontece. Tudo por reflexao, sem referencia ao outro plugin.
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        public static int InvalidateHomeSectionsCache(Guid userId)
        {
            try
            {
                var services = Services;
                if (services is null)
                {
                    return 0;
                }

                Type? cacheType = null;
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    string? asmName;
                    try { asmName = asm.GetName().Name; } catch { continue; }
                    if (!string.Equals(asmName, "Jellyfin.Plugin.HomeScreenSections", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    cacheType = asm.GetType("Jellyfin.Plugin.HomeScreenSections.Data.UserSectionsDataCache", false);
                    if (cacheType is not null)
                    {
                        break;
                    }
                }

                if (cacheType is null)
                {
                    return 0;
                }

                var cache = services.GetService(cacheType);
                if (cache is null)
                {
                    return 0;
                }

                var owners = cacheType.GetProperty("PageHashOwnerIds")?.GetValue(cache) as System.Collections.IDictionary;
                if (owners is null)
                {
                    return 0;
                }

                var hashes = new List<object>();
                foreach (System.Collections.DictionaryEntry entry in owners)
                {
                    if (entry.Value is Guid owner && owner == userId)
                    {
                        hashes.Add(entry.Key);
                    }
                }

                foreach (var name in new[] { "Cache", "PageHashExpiry", "PageHashOwnerIds" })
                {
                    if (cacheType.GetProperty(name)?.GetValue(cache) is System.Collections.IDictionary dict)
                    {
                        foreach (var hash in hashes)
                        {
                            dict.Remove(hash);
                        }
                    }
                }

                Log?.LogInformation("Access control: cleared {Count} cached Home Screen Sections page(s) for {UserId}", hashes.Count, userId);
                return hashes.Count;
            }
            catch (Exception ex)
            {
                Log?.LogWarning(ex, "Access control: could not clear the Home Screen Sections cache for {UserId}", userId);
                return 0;
            }
        }

        private static JsonObject? SnapshotNonAccessFields(UserPolicy policy)
        {
            try
            {
                var node = JsonSerializer.SerializeToNode(policy) as JsonObject;
                if (node is null)
                {
                    return null;
                }

                foreach (var name in AccessFieldNames)
                {
                    node.Remove(name);
                }

                return node;
            }
            catch
            {
                return null;
            }
        }

        // Le a politica de novo depois da gravacao e avisa no log se algum campo fora do controle de acesso mudou.
        private static void ReportPolicyDrift(IUserManager users, object user, Guid userId, JsonObject? before)
        {
            try
            {
                if (before is null)
                {
                    return;
                }

                var fresh = UserAccessor.PolicyOf(users, user);
                var after = fresh is null ? null : SnapshotNonAccessFields(fresh);
                if (after is null)
                {
                    return;
                }

                var changed = new List<string>();
                foreach (var kv in before)
                {
                    var other = after[kv.Key];
                    if (!string.Equals(kv.Value?.ToJsonString(), other?.ToJsonString(), StringComparison.Ordinal))
                    {
                        changed.Add(kv.Key);
                    }
                }

                if (changed.Count > 0)
                {
                    Log?.LogWarning("[JMSFusion] Access control: policy fields outside the access control changed for {UserId}: {Fields}", userId, string.Join(", ", changed));
                }
            }
            catch
            {
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

            var beforeJson = SnapshotNonAccessFields(policy);

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
            BumpCacheGeneration(userId);
            InvalidateHomeSectionsCache(userId);
            ReportPolicyDrift(users, user, userId, beforeJson);
            return true;
        }

        // Compara so os campos do controle de acesso (pastas em qualquer ordem, tags sem diferenciar maiusculas).
        public static bool PolicyMatches(UserPolicy policy, AccessPolicyValues values)
        {
            var live = Capture(policy);
            static HashSet<string> Set(IEnumerable<string>? items) => new((items ?? Array.Empty<string>()).Select(s => (s ?? string.Empty).Trim()).Where(s => s.Length > 0), StringComparer.OrdinalIgnoreCase);
            var wantedFolders = (values.EnabledFolders ?? Array.Empty<string>())
                .Select(s => Guid.TryParse(s, out var g) ? g.ToString("N") : string.Empty)
                .Where(s => s.Length > 0);
            var wantedUnrated = ToUnrated(values.BlockUnratedItems).Select(v => (int)v);

            return live.EnableAllFolders == values.EnableAllFolders
                && live.MaxParentalRating == values.MaxParentalRating
                && (values.EnableAllFolders || Set(live.EnabledFolders).SetEquals(Set(wantedFolders)))
                && new HashSet<int>(live.BlockUnratedItems).SetEquals(wantedUnrated)
                && Set(live.BlockedTags).SetEquals(Set(values.BlockedTags))
                && Set(live.AllowedTags).SetEquals(Set(values.AllowedTags));
        }

        private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, long> LastEnforce = new();

        // Fork ParticularFlix: o perfil bloqueado precisa valer em todos os caminhos (barra de bibliotecas, busca,
        // favoritos, endereco direto), e isso so o servidor garante. Se a politica real do usuario saiu do valor
        // restrito (edicao no painel do Jellyfin, gravacao que falhou, desbloqueio que nao voltou), ela e reaplicada.
        // No maximo uma verificacao a cada 15 s por usuario. Devolve true quando precisou reaplicar.
        public static async Task<bool> EnforceRestrictedAsync(IUserManager users, Guid userId, AccessProfileEntry entry)
        {
            var restricted = entry.Restricted;
            if (restricted is null || entry.UnlockedUntilUtc > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
            {
                return false;
            }

            var now = Environment.TickCount64;
            if (LastEnforce.TryGetValue(userId, out var last) && now - last < 15_000)
            {
                return false;
            }

            LastEnforce[userId] = now;
            var user = UserAccessor.Find(users, userId);
            if (user is null)
            {
                return false;
            }

            var policy = UserAccessor.PolicyOf(users, user);
            if (policy is null || IsAdmin(policy) || PolicyMatches(policy, restricted))
            {
                return false;
            }

            // Se o Jellyfin normalizar algum valor ao gravar, a comparacao nunca fecharia e cada verificacao subiria a
            // geracao do cache (a pagina recarregaria sem parar). Nesse caso a mesma diferenca so e reaplicada uma vez.
            var fingerprint = JsonSerializer.Serialize(Capture(policy)) + "|" + JsonSerializer.Serialize(restricted);
            if (Unenforceable.TryGetValue(userId, out var known) && string.Equals(known, fingerprint, StringComparison.Ordinal))
            {
                return false;
            }

            Log?.LogWarning("[JMSFusion] Access control: live policy of {UserId} differed from the restricted profile; restricted policy re-applied.", userId);
            var applied = await ApplyAsync(users, userId, restricted).ConfigureAwait(false);
            var reloaded = UserAccessor.Find(users, userId);
            var fresh = reloaded is null ? null : UserAccessor.PolicyOf(users, reloaded);
            if (fresh is not null && !PolicyMatches(fresh, restricted))
            {
                Unenforceable[userId] = JsonSerializer.Serialize(Capture(fresh)) + "|" + JsonSerializer.Serialize(restricted);
                Log?.LogWarning("[JMSFusion] Access control: the server stored a different policy for {UserId} after re-applying; it will not be retried until it changes.", userId);
            }

            return applied;
        }

        private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, string> Unenforceable = new();

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

        public AccessRelockService(IUserManager users, ILogger<AccessRelockService> logger, IServiceProvider services)
        {
            _users = users;
            _logger = logger;
            AccessControlCore.Log ??= logger;
            AccessControlCore.Services ??= services;
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
