using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System.Text.Json.Nodes;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("Plugins/JMSFusion/UserSettings")]
    public class UserSettingsController : ControllerBase
    {
        private const int MaxUserSnapshotEntries = 500;

        // Fork ParticularFlix 4.0.0.12: protecao contra regressao. Uma gravacao que derruba mais de 10% das chaves
        // de um snapshot com pelo menos 20 chaves (ex.: 612 -> 471, o estado velho de um navegador) e recusada, a
        // menos que o cliente peca explicitamente (Resetar, ou confirmacao do admin ao publicar o padrao).
        private const double MaxKeyDropRatio = 0.10;
        private const int MinKeysForDropGuard = 20;
        private const int MaxAuditEntries = 100;

        // Gravacoes concorrentes (duas abas, dois aparelhos) mexem na mesma configuracao em memoria.
        private static readonly object ConfigGate = new();

        private readonly IUserManager _users;
        private readonly ILogger<UserSettingsController> _logger;

        public UserSettingsController(IUserManager users, ILogger<UserSettingsController> logger)
        {
            _users = users;
            _logger = logger;
        }

        // Fork ParticularFlix: identifica o usuario Jellyfin que fez a requisicao.
        // Somente a claim da autenticacao do Jellyfin (token enviado pelo navegador).
        // O cabecalho X-Emby-UserId e forjavel por qualquer cliente e nao e mais aceito.
        private bool TryResolveUserId(out Guid userId)
        {
            userId = Guid.Empty;

            var claim = HttpContext?.User?.Claims?.FirstOrDefault(c =>
                string.Equals(c.Type, "Jellyfin-UserId", StringComparison.OrdinalIgnoreCase))?.Value;
            return Guid.TryParse(claim, out userId) && userId != Guid.Empty;
        }

        private bool IsAdmin(Guid userId)
        {
            var user = _users.GetUserById(userId);
            return user?.Permissions.Any(permission =>
                permission.Kind == PermissionKind.IsAdministrator && permission.Value) == true;
        }

        private static UserSettingsSnapshotEntry? FindEntry(JMSFusionConfiguration cfg, string userId, string profile)
        {
            cfg.UserSettingsSnapshots ??= new();
            return cfg.UserSettingsSnapshots.FirstOrDefault(e =>
                string.Equals(e?.UserId, userId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(NormalizeProfile(e?.Profile), profile, StringComparison.OrdinalIgnoreCase));
        }

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }

        private static string NormalizeProfile(string? p)
        {
            p = (p ?? "").Trim().ToLowerInvariant();
            return (p == "mobile" || p == "m") ? "mobile" : "desktop";
        }

        private static readonly HashSet<string> DeniedSnapshotKeys = new(StringComparer.OrdinalIgnoreCase)
        {
            "json-credentials",
            "api-key",
            "accessToken",
            "serverId",
            "userId",
            "deviceId",
            "sessionId",
            "jf_serverAddress",
            "jf_userId",
            "jf_api_deviceId",
            "jf_api_deviceName",
            "persist_user_id",
            "persist_device_id",
            "persist_device_name",
            "persist_server_id",
            "serverAddress",
            "currentUserIsAdmin",
            "currentUserId",
            "currentUserName",
            "emby.device.id",
            "emby.session.id",
            "jellyfin_credentials",
            "emby_credentials",
            "jf_debug_api",
            "jms:lastPlayNowDebug",
            "jms_backdrop_index",
            "userTopGenresCache",
            "userTopGenres_v2"
        };

        private static readonly string[] DeniedSnapshotPrefixes =
        {
            "persist_",
            "jf:",
            "emby.",
            "jms:debug:",
            "jms:trace:",
            "jms:focusedUserDataSync:",
            "jms:last",
            "jms_indexer_",
            "studioHub_",
            "avatar-"
        };

        private static bool ShouldPersistSnapshotKey(string? key)
        {
            var normalized = (key ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalized)) return false;
            if (DeniedSnapshotKeys.Contains(normalized)) return false;

            foreach (var prefix in DeniedSnapshotPrefixes)
            {
                if (normalized.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            return !normalized.Contains("token", StringComparison.OrdinalIgnoreCase)
                && !normalized.Contains("credential", StringComparison.OrdinalIgnoreCase)
                && !normalized.Contains("session", StringComparison.OrdinalIgnoreCase);
        }

        private static string SerializeSanitizedSnapshot(JsonElement element)
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                return "{}";
            }

            var filtered = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var prop in element.EnumerateObject())
            {
                if (!ShouldPersistSnapshotKey(prop.Name)) continue;
                filtered[prop.Name] = prop.Value.Clone();
            }

            return JsonSerializer.Serialize(filtered);
        }

        private static string SanitizeSnapshotJson(string? json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                return "{}";
            }

            try
            {
                using var doc = JsonDocument.Parse(json);
                return SerializeSanitizedSnapshot(doc.RootElement);
            }
            catch
            {
                return "{}";
            }
        }

        private static string SerializeSanitizedSnapshot(object? snapshot)
        {
            if (snapshot is JsonElement element)
            {
                return SerializeSanitizedSnapshot(element);
            }

            if (snapshot is null)
            {
                return "{}";
            }

            try
            {
                return SanitizeSnapshotJson(JsonSerializer.Serialize(snapshot));
            }
            catch
            {
                return "{}";
            }
        }

        private static void EnsureMigrated(JMSFusionConfiguration cfg, JMSFusionPlugin plugin)
        {
            var legacy = cfg.GlobalUserSettingsJson;
            var legacyHas = !string.IsNullOrWhiteSpace(legacy) && legacy != "{}";

            var desktopEmpty = string.IsNullOrWhiteSpace(cfg.GlobalUserSettingsJsonDesktop) || cfg.GlobalUserSettingsJsonDesktop == "{}";
            var mobileEmpty  = string.IsNullOrWhiteSpace(cfg.GlobalUserSettingsJsonMobile)  || cfg.GlobalUserSettingsJsonMobile  == "{}";

            if (!legacyHas) return;
            if (!(desktopEmpty && mobileEmpty)) return;

            cfg.GlobalUserSettingsJsonDesktop = legacy!;
            cfg.GlobalUserSettingsJsonMobile  = legacy!;

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            cfg.GlobalUserSettingsRevisionDesktop = now;
            cfg.GlobalUserSettingsRevisionMobile  = now;

            plugin.UpdateConfiguration(cfg);
        }

        private static int CountKeys(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return 0;
            try
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind != JsonValueKind.Object) return 0;
                var count = 0;
                foreach (var _ in doc.RootElement.EnumerateObject()) count++;
                return count;
            }
            catch
            {
                return 0;
            }
        }

        private static bool IsLargeKeyDrop(int before, int after)
            => before >= MinKeysForDropGuard && after < before * (1.0 - MaxKeyDropRatio);

        private static string GlobalJson(JMSFusionConfiguration cfg, string prof)
            => prof == "mobile" ? (cfg.GlobalUserSettingsJsonMobile ?? "{}") : (cfg.GlobalUserSettingsJsonDesktop ?? "{}");

        private static long GlobalRev(JMSFusionConfiguration cfg, string prof)
            => prof == "mobile" ? cfg.GlobalUserSettingsRevisionMobile : cfg.GlobalUserSettingsRevisionDesktop;

        private static string Trunc(string? value, int max)
        {
            var v = (value ?? string.Empty).Trim();
            return v.Length <= max ? v : v.Substring(0, max);
        }

        // Fork ParticularFlix 4.0.0.12: registra no log do Jellyfin e na trilha do XML de onde veio cada gravacao
        // importante. Nunca grava o conteudo do snapshot, tokens ou cabecalhos de autenticacao.
        private bool Audit(
            JMSFusionConfiguration cfg,
            string action,
            string result,
            string prof,
            Guid userId,
            int keysBefore,
            int keysAfter,
            long revBefore,
            long revAfter,
            long baseRev,
            string? detail,
            bool persistInConfig)
        {
            var userName = userId == Guid.Empty ? null : _users.GetUserById(userId)?.Username;
            var host = Trunc(Request?.Host.Value, 120);
            var origin = Trunc(Request?.Headers["Origin"].ToString(), 160);
            if (string.IsNullOrEmpty(origin))
            {
                origin = Trunc(Request?.Headers["Referer"].ToString(), 160);
            }

            var ip = Trunc(HttpContext?.Connection?.RemoteIpAddress?.ToString(), 64);
            var ua = Trunc(Request?.Headers.UserAgent.ToString(), 200);

            var level = result == "ok" || result == "skipped" ? LogLevel.Information : LogLevel.Warning;
            _logger.Log(
                level,
                "[JMSFusion] UserSettings {Action} {Result}: profile={Profile} user={User} host={Host} origin={Origin} ip={Ip} keys {Before}->{After} rev {RevBefore}->{RevAfter} baseRev={BaseRev} {Detail} ua={UserAgent}",
                action, result, prof, userName ?? userId.ToString("N"), host, origin, ip, keysBefore, keysAfter, revBefore, revAfter, baseRev, detail ?? string.Empty, ua);

            if (!persistInConfig) return false;

            cfg.UserSettingsAudit ??= new();
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var userKey = userId == Guid.Empty ? null : userId.ToString("N");

            // Recusas repetidas (uma aba antiga gravando a cada mudanca) viram uma linha so a cada 10 minutos,
            // para nao empurrar as publicacoes reais para fora da trilha.
            if (result.StartsWith("refused", StringComparison.Ordinal) && cfg.UserSettingsAudit.Count > 0)
            {
                var last = cfg.UserSettingsAudit[cfg.UserSettingsAudit.Count - 1];
                if (string.Equals(last.Action, action, StringComparison.Ordinal)
                    && string.Equals(last.Result, result, StringComparison.Ordinal)
                    && string.Equals(last.Profile, prof, StringComparison.Ordinal)
                    && string.Equals(last.UserId, userKey, StringComparison.Ordinal)
                    && (nowMs - last.AtUtc) < 600000)
                {
                    return false;
                }
            }

            cfg.UserSettingsAudit.Add(new UserSettingsAuditEntry
            {
                AtUtc = nowMs,
                Action = action,
                Result = result,
                Profile = prof,
                UserId = userKey,
                UserName = userName,
                Host = host,
                Origin = origin,
                RemoteIp = ip,
                UserAgent = ua,
                KeysBefore = keysBefore,
                KeysAfter = keysAfter,
                RevisionBefore = revBefore,
                RevisionAfter = revAfter,
                BaseRevision = baseRev,
                Detail = detail
            });
            if (cfg.UserSettingsAudit.Count > MaxAuditEntries)
            {
                cfg.UserSettingsAudit.RemoveRange(0, cfg.UserSettingsAudit.Count - MaxAuditEntries);
            }

            return true;
        }

        [HttpGet]
        public IActionResult Get([FromQuery] string? profile = null)
        {
            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;

            EnsureMigrated(cfg, plugin);

            var prof = NormalizeProfile(profile);
            var globalJson = GlobalJson(cfg, prof);
            var globalRev = GlobalRev(cfg, prof);
            var json = globalJson;
            var rev = globalRev;

            // Fork ParticularFlix: cada usuario le o proprio snapshot; o global e o padrao de quem ainda nao tem um.
            // 4.0.0.12: com "forcar configuracoes globais" ligado, o usuario comum recebe sempre o global, mas o
            // administrador le o PROPRIO snapshot (edita o dele e publica o padrao de proposito).
            var personal = false;
            var isAdmin = false;
            var hasUser = TryResolveUserId(out var requestUserId);
            if (hasUser)
            {
                isAdmin = IsAdmin(requestUserId);
                if (!cfg.ForceGlobalUserSettings || isAdmin)
                {
                    var entry = FindEntry(cfg, requestUserId.ToString("D"), prof);
                    if (entry is not null)
                    {
                        json = entry.Json ?? "{}";
                        rev = entry.Revision;
                        personal = true;
                    }
                }
            }

            var sanitizedJson = SanitizeSnapshotJson(json);

            object globalObj;
            try
            {
                globalObj = JsonSerializer.Deserialize<object>(sanitizedJson) ?? new();
            }
            catch
            {
                globalObj = new();
            }

            NoCache();
            return Ok(new
            {
                profile = prof,
                rev,
                forceGlobal = cfg.ForceGlobalUserSettings,
                personal,
                isAdmin,
                keys = CountKeys(sanitizedJson),
                globalRev,
                globalKeys = CountKeys(globalJson),
                global = globalObj
            });
        }

        public sealed class PublishReq
        {
            public object? Global { get; set; }
            public string? Profile { get; set; }

            // Fork ParticularFlix 4.0.0.12: o navegador so grava depois de ter carregado o estado do servidor nesta
            // pagina (Loaded) e informa a revisao que carregou (BaseRev). Clientes antigos, sem esses campos, sao
            // recusados: eram eles que republicavam o estado velho do localStorage.
            public bool? Loaded { get; set; }
            public long? BaseRev { get; set; }
            public bool? AllowShrink { get; set; }
        }

        // Fork ParticularFlix 4.0.0.12: "Salvar" e o salvamento automatico gravam SOMENTE o snapshot do usuario
        // logado, com ou sem "forcar configuracoes globais". O padrao global so muda por PublishGlobal.
        [HttpPost("Publish")]
        public IActionResult Publish([FromBody] PublishReq req, [FromQuery] string? profile = null)
        {
            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;

            EnsureMigrated(cfg, plugin);

            req ??= new PublishReq();
            var prof = NormalizeProfile(req.Profile ?? profile);
            var json = SerializeSanitizedSnapshot(req.Global);
            var newKeys = CountKeys(json);
            var baseRev = req.BaseRev ?? 0;

            if (!TryResolveUserId(out var requestUserId))
            {
                NoCache();
                return Unauthorized(new { ok = false, error = "Usuario nao identificado." });
            }

            var isAdmin = IsAdmin(requestUserId);
            if (cfg.ForceGlobalUserSettings && !isAdmin)
            {
                // Com configuracoes globais forcadas, o usuario comum nao tem snapshot proprio.
                NoCache();
                return Ok(new { ok = true, profile = prof, ignored = true });
            }

            lock (ConfigGate)
            {
                var userId = requestUserId.ToString("D");
                var existing = FindEntry(cfg, userId, prof);
                var baselineJson = existing?.Json ?? GlobalJson(cfg, prof);
                var baselineKeys = CountKeys(baselineJson);
                var baselineRev = existing?.Revision ?? GlobalRev(cfg, prof);

                if (req.Loaded != true)
                {
                    if (Audit(cfg, "save", "refused-not-loaded", prof, requestUserId, baselineKeys, newKeys, baselineRev, baselineRev, baseRev, "cliente sem estado do servidor", persistInConfig: true))
                    {
                        plugin.UpdateConfiguration(cfg);
                    }
                    NoCache();
                    return Conflict(new { ok = false, error = "not-loaded", profile = prof, keysBefore = baselineKeys, keysAfter = newKeys });
                }

                if (existing is not null && string.Equals(existing.Json ?? "{}", json, StringComparison.Ordinal))
                {
                    NoCache();
                    return Ok(new { ok = true, profile = prof, rev = existing.Revision, skipped = true, personal = true });
                }

                if (IsLargeKeyDrop(baselineKeys, newKeys) && req.AllowShrink != true)
                {
                    if (Audit(cfg, "save", "refused-shrink", prof, requestUserId, baselineKeys, newKeys, baselineRev, baselineRev, baseRev, null, persistInConfig: true))
                    {
                        plugin.UpdateConfiguration(cfg);
                    }
                    NoCache();
                    return Conflict(new { ok = false, error = "shrink", profile = prof, keysBefore = baselineKeys, keysAfter = newKeys });
                }

                if (existing is null)
                {
                    if (cfg.UserSettingsSnapshots.Count >= MaxUserSnapshotEntries)
                    {
                        NoCache();
                        return StatusCode(StatusCodes.Status507InsufficientStorage, new { ok = false, error = "Limite de snapshots atingido." });
                    }

                    existing = new UserSettingsSnapshotEntry { UserId = userId, Profile = prof };
                    cfg.UserSettingsSnapshots.Add(existing);
                }

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                existing.UserName = _users.GetUserById(requestUserId)?.Username;
                existing.Json = json;
                existing.Revision = now;
                existing.UpdatedAtUtc = now;

                Audit(cfg, "save", "ok", prof, requestUserId, baselineKeys, newKeys, baselineRev, now, baseRev,
                    req.AllowShrink == true ? "allowShrink" : null, persistInConfig: false);
                plugin.UpdateConfiguration(cfg);

                NoCache();
                return Ok(new { ok = true, profile = prof, rev = now, personal = true, keys = newKeys });
            }
        }

        public sealed class PublishGlobalReq
        {
            // Perfil do padrao global que sera trocado (desktop ou mobile).
            public string? Profile { get; set; }

            // Perfil do snapshot do proprio admin usado como origem (padrao: o mesmo de Profile).
            public string? SourceProfile { get; set; }

            // So calcula e devolve os numeros, sem gravar (para a tela de confirmacao).
            public bool? DryRun { get; set; }

            // Confirmacao forte do admin quando o novo padrao tem muito menos chaves que o atual.
            public bool? AllowShrink { get; set; }

            // Revisao do snapshot de origem mostrada na confirmacao; se mudou no meio, pede nova confirmacao.
            public long? SourceRev { get; set; }
        }

        private IActionResult? RequireAdminUser(out Guid userId)
        {
            if (!TryResolveUserId(out userId))
            {
                NoCache();
                return Unauthorized(new { ok = false, error = "Usuario nao identificado." });
            }

            if (!IsAdmin(userId))
            {
                NoCache();
                return StatusCode(StatusCodes.Status403Forbidden, new { ok = false, error = "Somente administradores." });
            }

            return null;
        }

        // Fork ParticularFlix 4.0.0.12: publicar o padrao global e um gesto separado e explicito do admin. A origem e o
        // snapshot do admin JA GRAVADO NO SERVIDOR (nunca o localStorage do navegador), e a tela mostra antes o
        // numero de chaves do padrao atual e do novo.
        [HttpPost("PublishGlobal")]
        public IActionResult PublishGlobal([FromBody] PublishGlobalReq req)
        {
            var denied = RequireAdminUser(out var adminId);
            if (denied is not null) return denied;

            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;
            EnsureMigrated(cfg, plugin);

            req ??= new PublishGlobalReq();
            var prof = NormalizeProfile(req.Profile);
            var sourceProf = NormalizeProfile(req.SourceProfile ?? prof);

            lock (ConfigGate)
            {
                var source = FindEntry(cfg, adminId.ToString("D"), sourceProf);
                var oldJson = GlobalJson(cfg, prof);
                var oldKeys = CountKeys(oldJson);
                var oldRev = GlobalRev(cfg, prof);

                if (source is null)
                {
                    NoCache();
                    return Conflict(new { ok = false, error = "no-source", profile = prof, sourceProfile = sourceProf, keysBefore = oldKeys });
                }

                var newJson = SanitizeSnapshotJson(source.Json);
                var newKeys = CountKeys(newJson);
                var same = string.Equals(SanitizeSnapshotJson(oldJson), newJson, StringComparison.Ordinal);
                var shrink = IsLargeKeyDrop(oldKeys, newKeys);

                if (req.DryRun == true)
                {
                    NoCache();
                    return Ok(new
                    {
                        ok = true,
                        dryRun = true,
                        profile = prof,
                        sourceProfile = sourceProf,
                        keysBefore = oldKeys,
                        keysAfter = newKeys,
                        revBefore = oldRev,
                        sourceRev = source.Revision,
                        sourceUpdatedAt = source.UpdatedAtUtc,
                        same,
                        shrink,
                        forceGlobal = cfg.ForceGlobalUserSettings
                    });
                }

                if (req.SourceRev.HasValue && req.SourceRev.Value != source.Revision)
                {
                    NoCache();
                    return Conflict(new { ok = false, error = "source-changed", profile = prof, sourceRev = source.Revision });
                }

                if (same)
                {
                    NoCache();
                    return Ok(new { ok = true, profile = prof, skipped = true, rev = oldRev, keys = newKeys });
                }

                if (shrink && req.AllowShrink != true)
                {
                    if (Audit(cfg, "publish-global", "refused-shrink", prof, adminId, oldKeys, newKeys, oldRev, oldRev, source.Revision, "origem " + sourceProf, persistInConfig: true))
                    {
                        plugin.UpdateConfiguration(cfg);
                    }
                    NoCache();
                    return Conflict(new { ok = false, error = "shrink", profile = prof, keysBefore = oldKeys, keysAfter = newKeys });
                }

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (prof == "mobile")
                {
                    cfg.GlobalUserSettingsPreviousJsonMobile = oldJson;
                    cfg.GlobalUserSettingsPreviousRevisionMobile = oldRev;
                    cfg.GlobalUserSettingsJsonMobile = newJson;
                    cfg.GlobalUserSettingsRevisionMobile = now;
                }
                else
                {
                    cfg.GlobalUserSettingsPreviousJsonDesktop = oldJson;
                    cfg.GlobalUserSettingsPreviousRevisionDesktop = oldRev;
                    cfg.GlobalUserSettingsJsonDesktop = newJson;
                    cfg.GlobalUserSettingsRevisionDesktop = now;
                }

                Audit(cfg, "publish-global", "ok", prof, adminId, oldKeys, newKeys, oldRev, now, source.Revision,
                    "origem " + sourceProf + (shrink ? ", queda confirmada" : string.Empty), persistInConfig: true);
                plugin.UpdateConfiguration(cfg);

                NoCache();
                return Ok(new { ok = true, profile = prof, rev = now, keysBefore = oldKeys, keysAfter = newKeys });
            }
        }

        public sealed class RevertGlobalReq
        {
            public string? Profile { get; set; }
            public bool? DryRun { get; set; }
        }

        // Fork ParticularFlix 4.0.0.12: devolve o padrao global anterior a ultima publicacao (troca atual e anterior,
        // entao um segundo "Desfazer" refaz).
        [HttpPost("RevertGlobal")]
        public IActionResult RevertGlobal([FromBody] RevertGlobalReq req)
        {
            var denied = RequireAdminUser(out var adminId);
            if (denied is not null) return denied;

            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;
            req ??= new RevertGlobalReq();
            var prof = NormalizeProfile(req.Profile);

            lock (ConfigGate)
            {
                var current = GlobalJson(cfg, prof);
                var currentRev = GlobalRev(cfg, prof);
                var previous = prof == "mobile" ? cfg.GlobalUserSettingsPreviousJsonMobile : cfg.GlobalUserSettingsPreviousJsonDesktop;
                var previousRev = prof == "mobile" ? cfg.GlobalUserSettingsPreviousRevisionMobile : cfg.GlobalUserSettingsPreviousRevisionDesktop;

                if (string.IsNullOrWhiteSpace(previous))
                {
                    NoCache();
                    return Conflict(new { ok = false, error = "no-previous", profile = prof, keysBefore = CountKeys(current) });
                }

                if (req.DryRun == true)
                {
                    NoCache();
                    return Ok(new { ok = true, dryRun = true, profile = prof, keysBefore = CountKeys(current), keysAfter = CountKeys(previous), revBefore = currentRev, previousRev });
                }

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (prof == "mobile")
                {
                    cfg.GlobalUserSettingsPreviousJsonMobile = current;
                    cfg.GlobalUserSettingsPreviousRevisionMobile = currentRev;
                    cfg.GlobalUserSettingsJsonMobile = previous;
                    cfg.GlobalUserSettingsRevisionMobile = now;
                }
                else
                {
                    cfg.GlobalUserSettingsPreviousJsonDesktop = current;
                    cfg.GlobalUserSettingsPreviousRevisionDesktop = currentRev;
                    cfg.GlobalUserSettingsJsonDesktop = previous;
                    cfg.GlobalUserSettingsRevisionDesktop = now;
                }

                Audit(cfg, "revert-global", "ok", prof, adminId, CountKeys(current), CountKeys(previous), currentRev, now, previousRev, null, persistInConfig: true);
                plugin.UpdateConfiguration(cfg);

                NoCache();
                return Ok(new { ok = true, profile = prof, rev = now, keysBefore = CountKeys(current), keysAfter = CountKeys(previous) });
            }
        }

        public sealed class CopyGlobalReq
        {
            public string? FromProfile { get; set; }
            public string? ToProfile { get; set; }
            public bool? DryRun { get; set; }

            // 4.0.0.15: so estas chaves (ex.: as da aba API Query, que definem os cards do slider). Vazio = tudo.
            public List<string>? Keys { get; set; }
        }

        // Fork ParticularFlix 4.0.0.15: copia so as chaves pedidas de um padrao para o outro, mantendo o resto do destino.
        // A copia inteira (4.0.0.14) levava o layout do computador para o celular e o slider do celular quebrava.
        // Chave que nao existe na origem sai do destino (o destino passa a usar o mesmo valor padrao da origem).
        private static string MergeKeys(string sourceJson, string targetJson, IEnumerable<string> keys, out int changed)
        {
            changed = 0;
            var src = (JsonNode.Parse(string.IsNullOrWhiteSpace(sourceJson) ? "{}" : sourceJson) as JsonObject) ?? new JsonObject();
            var dst = (JsonNode.Parse(string.IsNullOrWhiteSpace(targetJson) ? "{}" : targetJson) as JsonObject) ?? new JsonObject();
            foreach (var key in keys.Where(k => !string.IsNullOrWhiteSpace(k)).Distinct(StringComparer.Ordinal))
            {
                var tem = src.TryGetPropertyValue(key, out var valor);
                var antes = dst.TryGetPropertyValue(key, out var atual) ? atual?.ToJsonString() : null;
                if (tem)
                {
                    var novo = valor?.DeepClone();
                    if (antes != novo?.ToJsonString()) changed++;
                    dst[key] = novo;
                }
                else if (dst.Remove(key))
                {
                    changed++;
                }
            }

            return dst.ToJsonString();
        }

        // Fork ParticularFlix 4.0.0.14: copia um padrao global para o outro perfil (normalmente desktop -> celular), para o
        // celular comecar com os mesmos cards, fontes e configuracoes do slider do computador. As posicoes manuais do
        // desktop nao atrapalham o celular: no modo celular o slider empilha os blocos e ignora essas posicoes. O padrao
        // anterior do destino fica guardado e "Desfazer" (RevertGlobal com o perfil de destino) volta.
        [HttpPost("CopyGlobal")]
        public IActionResult CopyGlobal([FromBody] CopyGlobalReq req)
        {
            var denied = RequireAdminUser(out var adminId);
            if (denied is not null) return denied;

            req ??= new CopyGlobalReq();
            var from = NormalizeProfile(req.FromProfile ?? "desktop");
            var to = NormalizeProfile(req.ToProfile ?? "mobile");
            if (from == to)
            {
                NoCache();
                return BadRequest(new { ok = false, error = "same-profile" });
            }

            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;
            EnsureMigrated(cfg, plugin);

            lock (ConfigGate)
            {
                var source = GlobalJson(cfg, from);
                var sourceKeys = CountKeys(source);
                var oldJson = GlobalJson(cfg, to);
                var oldKeys = CountKeys(oldJson);
                var oldRev = GlobalRev(cfg, to);
                if (sourceKeys < 20)
                {
                    NoCache();
                    return Conflict(new { ok = false, error = "source-empty", from, keys = sourceKeys });
                }

                var parcial = req.Keys is { Count: > 0 };
                var changedKeys = 0;
                if (parcial)
                {
                    source = MergeKeys(source, oldJson, req.Keys!, out changedKeys);
                    sourceKeys = CountKeys(source);
                }

                if (req.DryRun == true)
                {
                    NoCache();
                    return Ok(new { ok = true, dryRun = true, from, to, partial = parcial, changed = changedKeys, keysBefore = oldKeys, keysAfter = sourceKeys, same = string.Equals(oldJson, source, StringComparison.Ordinal) });
                }

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (to == "mobile")
                {
                    cfg.GlobalUserSettingsPreviousJsonMobile = oldJson;
                    cfg.GlobalUserSettingsPreviousRevisionMobile = oldRev;
                    cfg.GlobalUserSettingsJsonMobile = source;
                    cfg.GlobalUserSettingsRevisionMobile = now;
                }
                else
                {
                    cfg.GlobalUserSettingsPreviousJsonDesktop = oldJson;
                    cfg.GlobalUserSettingsPreviousRevisionDesktop = oldRev;
                    cfg.GlobalUserSettingsJsonDesktop = source;
                    cfg.GlobalUserSettingsRevisionDesktop = now;
                }

                Audit(cfg, "copy-global", "ok", to, adminId, oldKeys, sourceKeys, oldRev, now, GlobalRev(cfg, from),
                    "origem " + from + (parcial ? ", so " + changedKeys + " chave(s) dos cards" : string.Empty), persistInConfig: true);
                plugin.UpdateConfiguration(cfg);
                NoCache();
                return Ok(new { ok = true, from, to, partial = parcial, changed = changedKeys, rev = now, keysBefore = oldKeys, keysAfter = sourceKeys });
            }
        }

        public sealed class ResetUserReq
        {
            public string? UserId { get; set; }
            public string? Profile { get; set; }
            public bool? DryRun { get; set; }
        }

        // Fork ParticularFlix 4.0.0.13: o admin volta o layout de UM usuario ao padrao global apagando o snapshot
        // dele (desktop, mobile ou os dois). Sem snapshot proprio, o usuario recebe o padrao na proxima carga da
        // pagina e volta a ter um snapshot proprio quando salvar. Nao mexe no padrao nem nos outros usuarios.
        [HttpPost("ResetUser")]
        public IActionResult ResetUser([FromBody] ResetUserReq req)
        {
            var denied = RequireAdminUser(out var adminId);
            if (denied is not null) return denied;

            req ??= new ResetUserReq();
            // Fork ParticularFlix 4.0.0.14: UserId "*" = todos os usuarios que NAO sao administradores (usado para levar o
            // padrao novo do celular a todo mundo de uma vez; os administradores mantem o proprio layout).
            var todos = string.Equals((req.UserId ?? string.Empty).Trim(), "*", StringComparison.Ordinal);
            var targetId = Guid.Empty;
            if (!todos && (!Guid.TryParse(req.UserId, out targetId) || targetId == Guid.Empty))
            {
                NoCache();
                return BadRequest(new { ok = false, error = "user-required" });
            }

            var target = todos ? null : _users.GetUserById(targetId);
            var rawProfile = (req.Profile ?? "all").Trim().ToLowerInvariant();
            var profiles = rawProfile == "all" ? new[] { "desktop", "mobile" } : new[] { NormalizeProfile(rawProfile) };

            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;
            EnsureMigrated(cfg, plugin);

            lock (ConfigGate)
            {
                cfg.UserSettingsSnapshots ??= new();
                var matches = cfg.UserSettingsSnapshots
                    .Where(e => e is not null
                        && Guid.TryParse(e.UserId, out var id) && (todos ? !IsAdmin(id) : id == targetId)
                        && profiles.Contains(NormalizeProfile(e.Profile), StringComparer.OrdinalIgnoreCase))
                    .ToList();

                string NomeDe(UserSettingsSnapshotEntry e)
                    => Guid.TryParse(e.UserId, out var g) ? (_users.GetUserById(g)?.Username ?? e.UserName ?? e.UserId) : (e.UserName ?? e.UserId);

                var removed = matches.Select(e => new { user = NomeDe(e), profile = NormalizeProfile(e.Profile), keys = CountKeys(e.Json) }).ToList();
                if (req.DryRun == true || matches.Count == 0)
                {
                    NoCache();
                    return Ok(new { ok = true, dryRun = req.DryRun == true, userName = target?.Username, removed, none = matches.Count == 0 });
                }

                cfg.UserSettingsSnapshots.RemoveAll(e => matches.Contains(e));
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                foreach (var m in matches)
                {
                    var prof = NormalizeProfile(m.Profile);
                    Audit(cfg, "reset-user", "ok", prof, adminId, CountKeys(m.Json), CountKeys(GlobalJson(cfg, prof)), m.Revision, now, 0,
                        "target=" + NomeDe(m) + (todos ? " (todos)" : string.Empty), persistInConfig: true);
                }

                plugin.UpdateConfiguration(cfg);
                NoCache();
                return Ok(new { ok = true, userName = target?.Username, removed });
            }
        }

        // Fork ParticularFlix 4.0.0.12: estado dos padroes e trilha de auditoria (somente admin, sem conteudo dos
        // snapshots). Diagnostico em um comando: GET /Plugins/JMSFusion/UserSettings/Audit
        [HttpGet("Audit")]
        public IActionResult GetAudit()
        {
            var denied = RequireAdminUser(out _);
            if (denied is not null) return denied;

            var cfg = JMSFusionPlugin.Instance.Configuration;
            var entries = (cfg.UserSettingsAudit ?? new()).AsEnumerable().Reverse().ToList();
            var snapshots = (cfg.UserSettingsSnapshots ?? new())
                .Select(e => new
                {
                    userId = e.UserId,
                    userName = e.UserName,
                    profile = NormalizeProfile(e.Profile),
                    keys = CountKeys(e.Json),
                    rev = e.Revision
                })
                .ToList();

            NoCache();
            return Ok(new
            {
                forceGlobal = cfg.ForceGlobalUserSettings,
                desktop = new
                {
                    keys = CountKeys(cfg.GlobalUserSettingsJsonDesktop),
                    rev = cfg.GlobalUserSettingsRevisionDesktop,
                    previousKeys = CountKeys(cfg.GlobalUserSettingsPreviousJsonDesktop),
                    previousRev = cfg.GlobalUserSettingsPreviousRevisionDesktop
                },
                mobile = new
                {
                    keys = CountKeys(cfg.GlobalUserSettingsJsonMobile),
                    rev = cfg.GlobalUserSettingsRevisionMobile,
                    previousKeys = CountKeys(cfg.GlobalUserSettingsPreviousJsonMobile),
                    previousRev = cfg.GlobalUserSettingsPreviousRevisionMobile
                },
                snapshots,
                entries
            });
        }
    }
}
