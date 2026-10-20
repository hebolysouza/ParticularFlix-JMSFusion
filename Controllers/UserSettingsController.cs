using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("Plugins/JMSFusion/UserSettings")]
    public class UserSettingsController : ControllerBase
    {
        private const int MaxUserSnapshotEntries = 500;

        private readonly IUserManager _users;

        public UserSettingsController(IUserManager users)
        {
            _users = users;
        }

        // Fork ParticularFlix: identifica o usuario Jellyfin que fez a requisicao.
        // 1) claim da autenticacao do Jellyfin (token enviado pelo navegador);
        // 2) cabecalho X-Emby-UserId, o mesmo que o resto do plugin ja usa.
        private bool TryResolveUserId(out Guid userId)
        {
            userId = Guid.Empty;

            var claim = HttpContext?.User?.Claims?.FirstOrDefault(c =>
                string.Equals(c.Type, "Jellyfin-UserId", StringComparison.OrdinalIgnoreCase))?.Value;
            if (Guid.TryParse(claim, out userId) && userId != Guid.Empty)
            {
                return true;
            }

            var header =
                Request.Headers["X-Emby-UserId"].FirstOrDefault() ??
                Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault();
            return Guid.TryParse(header, out userId) && userId != Guid.Empty;
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

        [HttpGet]
        public IActionResult Get([FromQuery] string? profile = null)
        {
            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;

            EnsureMigrated(cfg, plugin);

            var prof = NormalizeProfile(profile);
            var json = prof == "mobile"
                ? (cfg.GlobalUserSettingsJsonMobile ?? "{}")
                : (cfg.GlobalUserSettingsJsonDesktop ?? "{}");
            var rev = prof == "mobile"
                ? cfg.GlobalUserSettingsRevisionMobile
                : cfg.GlobalUserSettingsRevisionDesktop;

            // Fork ParticularFlix: com "forcar configuracoes globais" desligado, cada usuario
            // le o proprio snapshot. O snapshot global vira apenas o modelo inicial.
            var personal = false;
            if (!cfg.ForceGlobalUserSettings && TryResolveUserId(out var requestUserId))
            {
                var entry = FindEntry(cfg, requestUserId.ToString("D"), prof);
                if (entry is not null)
                {
                    json = entry.Json ?? "{}";
                    rev = entry.Revision;
                    personal = true;
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
                global = globalObj
            });
        }

        public sealed class PublishReq
        {
            public object? Global { get; set; }
            public string? Profile { get; set; }
        }

        [HttpPost("Publish")]
        public IActionResult Publish([FromBody] PublishReq req, [FromQuery] string? profile = null)
        {
            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;

            EnsureMigrated(cfg, plugin);

            var prof = NormalizeProfile(req.Profile ?? profile);
            var json = SerializeSanitizedSnapshot(req.Global);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            var hasUser = TryResolveUserId(out var requestUserId);

            if (cfg.ForceGlobalUserSettings)
            {
                // Com configuracoes globais forcadas, so o administrador publica o snapshot global.
                if (!hasUser || !IsAdmin(requestUserId))
                {
                    NoCache();
                    return Ok(new { ok = true, profile = prof, ignored = true });
                }

                if (prof == "mobile")
                {
                    if (string.Equals(cfg.GlobalUserSettingsJsonMobile ?? "{}", json, StringComparison.Ordinal))
                    {
                        NoCache();
                        return Ok(new { ok = true, profile = prof, rev = cfg.GlobalUserSettingsRevisionMobile, skipped = true });
                    }

                    cfg.GlobalUserSettingsJsonMobile = json;
                    cfg.GlobalUserSettingsRevisionMobile = now;
                }
                else
                {
                    if (string.Equals(cfg.GlobalUserSettingsJsonDesktop ?? "{}", json, StringComparison.Ordinal))
                    {
                        NoCache();
                        return Ok(new { ok = true, profile = prof, rev = cfg.GlobalUserSettingsRevisionDesktop, skipped = true });
                    }

                    cfg.GlobalUserSettingsJsonDesktop = json;
                    cfg.GlobalUserSettingsRevisionDesktop = now;
                }

                plugin.UpdateConfiguration(cfg);
                NoCache();
                return Ok(new { ok = true, profile = prof, rev = now });
            }

            // Fork ParticularFlix: cada usuario grava somente o proprio snapshot.
            if (!hasUser)
            {
                NoCache();
                return Unauthorized(new { ok = false, error = "Usuario nao identificado." });
            }

            var userId = requestUserId.ToString("D");
            var existing = FindEntry(cfg, userId, prof);
            if (existing is not null && string.Equals(existing.Json ?? "{}", json, StringComparison.Ordinal))
            {
                NoCache();
                return Ok(new { ok = true, profile = prof, rev = existing.Revision, skipped = true, personal = true });
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

            existing.UserName = _users.GetUserById(requestUserId)?.Username;
            existing.Json = json;
            existing.Revision = now;
            existing.UpdatedAtUtc = now;

            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new { ok = true, profile = prof, rev = now, personal = true });
        }
    }
}
