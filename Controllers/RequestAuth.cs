using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Security.Claims;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    // Fork ParticularFlix: ajuda comum para saber QUEM esta chamando e proteger a configuracao.
    // Usa somente a identidade validada pelo Jellyfin (claims do token). O cabecalho
    // X-Emby-UserId NAO e usado aqui, porque qualquer pessoa consegue escreve-lo.
    internal static class RequestAuth
    {
        internal enum Level
        {
            Anonymous = 0,
            User = 1,
            Admin = 2
        }

        private static string? ClaimValue(HttpContext? ctx, string type)
            => ctx?.User?.Claims?.FirstOrDefault(c =>
                string.Equals(c.Type, type, StringComparison.OrdinalIgnoreCase))?.Value;

        internal static bool IsApiKeyRequest(HttpContext? ctx)
            => string.Equals(ClaimValue(ctx, "Jellyfin-IsApiKey"), "true", StringComparison.OrdinalIgnoreCase);

        internal static bool TryGetAuthenticatedUserId(HttpContext? ctx, out Guid userId)
        {
            userId = Guid.Empty;
            return Guid.TryParse(ClaimValue(ctx, "Jellyfin-UserId"), out userId) && userId != Guid.Empty;
        }

        internal static Level GetLevel(HttpContext? ctx, IUserManager users)
        {
            if (IsApiKeyRequest(ctx))
            {
                return Level.Admin;
            }

            if (!TryGetAuthenticatedUserId(ctx, out var userId))
            {
                return Level.Anonymous;
            }

            var user = users.GetUserById(userId);
            if (user is null)
            {
                return Level.Anonymous;
            }

            var isAdmin = user.Permissions.Any(p => p.Kind == PermissionKind.IsAdministrator && p.Value);
            return isAdmin ? Level.Admin : Level.User;
        }

        // Devolve uma copia da configuracao sem os segredos. A original nunca e alterada.
        internal static JMSFusionConfiguration Redact(JMSFusionConfiguration source, Level level)
        {
            if (level == Level.Admin)
            {
                return source;
            }

            var copy = new JMSFusionConfiguration();
            foreach (var prop in typeof(JMSFusionConfiguration).GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!prop.CanRead || !prop.CanWrite || prop.GetIndexParameters().Length > 0)
                {
                    continue;
                }

                try
                {
                    prop.SetValue(copy, prop.GetValue(source));
                }
                catch
                {
                }
            }

            copy.JFApiKey = string.Empty;
            copy.SerrApiKey = string.Empty;
            copy.ArrSonarrApiKey = string.Empty;
            copy.ArrSonarr4KApiKey = string.Empty;
            copy.ArrRadarrApiKey = string.Empty;
            copy.ArrRadarr4KApiKey = string.Empty;
            copy.ParentalPinHash = null;
            copy.ParentalPinSalt = null;
            copy.AccessProfiles = new();

            if (level == Level.Anonymous)
            {
                copy.TmdbApiKey = string.Empty;
                copy.WatchlistEntries = new();
                copy.WatchlistShares = new();
                copy.WatchlistHistoryEntries = new();
                copy.ItemComments = new();
                copy.SerrRequests = new();
                copy.ParentalPinRules = new();
            }

            return copy;
        }
    }
}
