using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using MediaBrowser.Common.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion
{
    // Fork ParticularFlix 4.0.0.9: o Home Screen Sections modifica, em memoria (File Transformation), o arquivo do
    // jellyfin-web que contem ",loadSections:". O nome desse arquivo tem hash fixo e o navegador o guarda em cache.
    // Se ele for baixado numa janela em que a modificacao ainda nao foi registrada (em 05/11/2026 a tarefa de
    // inicializacao do HSS nao rodou, ver StartupTaskGuardService), o navegador guarda a versao sem o HSS e a home
    // fica sem as secoes dele ate alguem limpar o cache, mesmo depois de o servidor voltar ao normal.
    // So esse arquivo (uns 78 KB) passa a sair com "no-store": cada carga da home pega o que o servidor tem agora.
    internal static class HomeChunkNoStore
    {
        private const string LoadSectionsMarker = ",loadSections:";

        private static volatile HashSet<string>? s_names;

        // Procura os chunks uma vez, em segundo plano, logo na subida. Ate terminar nada muda nas respostas.
        public static void StartDiscovery(IApplicationPaths? paths, ILogger logger)
        {
            _ = Task.Run(() =>
            {
                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                try
                {
                    var webPath = paths?.WebPath;
                    if (string.IsNullOrWhiteSpace(webPath) || !Directory.Exists(webPath))
                    {
                        logger.LogInformation("[JMSFusion] Home chunk no-store: web path not found, nothing changed");
                    }
                    else
                    {
                        foreach (var file in Directory.EnumerateFiles(webPath, "*.chunk.js", SearchOption.AllDirectories))
                        {
                            try
                            {
                                if (File.ReadAllText(file).Contains(LoadSectionsMarker, StringComparison.Ordinal))
                                {
                                    names.Add(Path.GetFileName(file));
                                }
                            }
                            catch
                            {
                            }
                        }

                        logger.LogInformation(
                            "[JMSFusion] Home chunk no-store: {Count} file(s): {Names}",
                            names.Count,
                            string.Join(", ", names));
                    }
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "[JMSFusion] Home chunk no-store: discovery failed, nothing changed");
                }

                s_names = names;
            });
        }

        public static void Apply(HttpContext ctx)
        {
            var names = s_names;
            if (names is null || names.Count == 0)
            {
                return;
            }

            if (!HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method))
            {
                return;
            }

            var path = ctx.Request.Path.Value;
            if (string.IsNullOrEmpty(path) || !path.EndsWith(".chunk.js", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var name = path.Substring(path.LastIndexOf('/') + 1);
            if (!names.Contains(name))
            {
                return;
            }

            // Um navegador que ainda guarda uma copia (talvez a sem o HSS) e pergunta se ela vale recebe o arquivo
            // inteiro, nunca um 304 que confirmaria a copia velha.
            ctx.Request.Headers.Remove("If-None-Match");
            ctx.Request.Headers.Remove("If-Modified-Since");

            // Sem ETag/Last-Modified o navegador nao tem como revalidar uma copia antiga: sempre baixa de novo.
            ctx.Response.OnStarting(() =>
            {
                var headers = ctx.Response.Headers;
                headers["Cache-Control"] = "no-store, max-age=0";
                headers.Remove("ETag");
                headers.Remove("Last-Modified");
                headers.Remove("Expires");
                return Task.CompletedTask;
            });
        }
    }
}
