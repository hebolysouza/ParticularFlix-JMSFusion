using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Jellyfin.Plugin.JMSFusion.Controllers;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion
{
    // Fork ParticularFlix 4.0.0.11: no Jellyfin 12 o GET /Users devolve a qualquer usuario logado a lista de TODOS os
    // usuarios (nomes e IDs; medido na VM em 08/11/2026 com o usuario "teste": admin, teste, victor), mesmo com todos
    // ocultos nas telas de login. Para quem nao e admin, a resposta passa a ter so o proprio usuario. Admin, chave de API
    // e pedidos sem login seguem intocados (o Jellyfin decide). Se algo falhar aqui, a resposta original sai sem mudanca.
    internal static class UsersListGuard
    {
        private static int s_failLogged;

        internal static bool Applies(HttpContext ctx)
        {
            if (!HttpMethods.IsGet(ctx.Request.Method))
            {
                return false;
            }

            var path = ctx.Request.Path;
            return path.Equals("/Users", StringComparison.OrdinalIgnoreCase)
                || path.Equals("/Users/", StringComparison.OrdinalIgnoreCase);
        }

        internal static async Task RunAsync(HttpContext ctx, Func<Task> next, ILogger logger)
        {
            Guid userId;
            try
            {
                // Este middleware roda antes da autenticacao do Jellyfin; o esquema padrao dele valida o token aqui.
                var auth = await ctx.AuthenticateAsync().ConfigureAwait(false);
                if (!auth.Succeeded || auth.Principal is null)
                {
                    await next().ConfigureAwait(false);
                    return;
                }

                ctx.User = auth.Principal;
                var users = ctx.RequestServices.GetService<IUserManager>();
                if (users is null
                    || RequestAuth.GetLevel(ctx, users) != RequestAuth.Level.User
                    || !RequestAuth.TryGetAuthenticatedUserId(ctx, out userId))
                {
                    await next().ConfigureAwait(false);
                    return;
                }
            }
            catch (Exception ex)
            {
                if (System.Threading.Interlocked.Exchange(ref s_failLogged, 1) == 0)
                {
                    logger.LogWarning(ex, "[JMSFusion] Users list guard: could not read the caller, /Users left unchanged");
                }

                await next().ConfigureAwait(false);
                return;
            }

            // A compressao do Jellyfin roda depois deste middleware: pede o corpo sem compressao para poder ler o JSON.
            ctx.Request.Headers["Accept-Encoding"] = "identity";
            var originalBody = ctx.Response.Body;
            await using var mem = new MemoryStream();
            ctx.Response.Body = mem;
            try
            {
                await next().ConfigureAwait(false);

                mem.Position = 0;
                var contentType = ctx.Response.ContentType ?? string.Empty;
                if (ctx.Response.StatusCode != StatusCodes.Status200OK
                    || contentType.IndexOf("json", StringComparison.OrdinalIgnoreCase) < 0
                    || ctx.Response.Headers.ContainsKey("Content-Encoding"))
                {
                    await mem.CopyToAsync(originalBody).ConfigureAwait(false);
                    return;
                }

                JsonArray? list = null;
                try
                {
                    list = JsonNode.Parse(mem) as JsonArray;
                }
                catch (JsonException)
                {
                    list = null;
                }

                if (list is null)
                {
                    mem.Position = 0;
                    await mem.CopyToAsync(originalBody).ConfigureAwait(false);
                    return;
                }

                var kept = new JsonArray();
                foreach (var item in list.ToList())
                {
                    if (item is JsonObject obj
                        && obj["Id"] is JsonValue idValue
                        && idValue.TryGetValue<string>(out var id)
                        && Guid.TryParse(id, out var itemId)
                        && itemId == userId)
                    {
                        list.Remove(item);
                        kept.Add(item);
                    }
                }

                var bytes = System.Text.Encoding.UTF8.GetBytes(kept.ToJsonString());
                ctx.Response.ContentLength = bytes.Length;
                await originalBody.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
            }
            finally
            {
                ctx.Response.Body = originalBody;
            }
        }
    }
}
