using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.FileProviders;

namespace Jellyfin.Plugin.JMSFusion
{
    /// <summary>
    /// Fork ParticularFlix 3.7.3: monta, uma vez por versao do plugin, o bloco de dicas de carregamento dos
    /// modulos JS que vai no index.html:
    ///  - um import map que faz todo import de /slider/... e /Plugins/JMSFusion/runtime/... usar a URL com
    ///    ?v=&lt;versao&gt;, que e servida com cache imutavel (zero requisicoes no F5);
    ///  - links modulepreload para os modulos carregados de forma estatica a partir dos pontos de entrada,
    ///    para o navegador buscar todos em paralelo em vez de em ondas por nivel de dependencia.
    /// Se o navegador ignorar o import map (por exemplo, se outro modulo ja tiver sido carregado antes),
    /// nada quebra: tudo volta a ser carregado como antes.
    /// </summary>
    internal static class ModuleHints
    {
        private static readonly Lazy<string> s_html = new Lazy<string>(Build, true);

        private static readonly Regex s_staticImport = new Regex(
            @"(?:^|[\s;}])(?:import|export)\b(?:[^;'""`]*?\bfrom)?\s*[""']([^""']+)[""']",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private static readonly string[] s_entryPoints =
        {
            "/slider/main.js",
            "/slider/modules/player/main.js"
        };

        private static readonly string[] s_runtimeNames = { "auth", "api", "storage-preload" };

        public static string BuildHtml()
        {
            try
            {
                return s_html.Value;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string Build()
        {
            var asm = typeof(JMSFusionPlugin).Assembly;
            var provider = new ManifestEmbeddedFileProvider(asm, "Resources/slider");
            var version = Uri.EscapeDataString(AssetVersioning.AssetVersion);

            // Todos os modulos servidos como arquivo JS (chave: caminho absoluto no servidor).
            var all = new SortedSet<string>(StringComparer.Ordinal);
            Collect(provider, "/modules", all);
            Collect(provider, "/language", all);

            var urls = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var p in all)
            {
                urls.Add("/slider" + p);
            }

            foreach (var name in s_runtimeNames)
            {
                urls.Add($"/Plugins/JMSFusion/runtime/{name}.js");
            }

            var preload = ComputeStaticClosure(asm, provider, urls);

            var sb = new StringBuilder();
            sb.AppendLine("<script type=\"importmap\">");
            sb.Append("{\"imports\":{");
            var first = true;
            foreach (var u in urls)
            {
                if (!IsSafe(u)) continue;
                if (!first) sb.Append(',');
                first = false;
                sb.Append('"').Append("..").Append(u).Append("\":\"").Append("..").Append(u).Append("?v=").Append(version).Append('"');
            }

            sb.AppendLine("}}");
            sb.AppendLine("</script>");

            foreach (var u in preload)
            {
                if (!IsSafe(u)) continue;
                sb.Append("<link rel=\"modulepreload\" href=\"..").Append(u).Append("?v=").Append(version).AppendLine("\">");
            }

            return sb.ToString();
        }

        private static bool IsSafe(string url)
        {
            foreach (var c in url)
            {
                if (!(char.IsAsciiLetterOrDigit(c) || c == '/' || c == '.' || c == '_' || c == '-'))
                {
                    return false;
                }
            }

            return url.EndsWith(".js", StringComparison.Ordinal);
        }

        private static void Collect(IFileProvider provider, string dir, ISet<string> into)
        {
            foreach (var entry in provider.GetDirectoryContents(dir))
            {
                var path = dir.TrimEnd('/') + "/" + entry.Name;
                if (entry.IsDirectory)
                {
                    Collect(provider, path, into);
                }
                else if (entry.Name.EndsWith(".js", StringComparison.OrdinalIgnoreCase))
                {
                    into.Add(path);
                }
            }
        }

        private static string? ReadSource(Assembly asm, IFileProvider provider, string url)
        {
            try
            {
                if (url.StartsWith("/slider/", StringComparison.Ordinal))
                {
                    var info = provider.GetFileInfo(url.Substring("/slider".Length));
                    if (!info.Exists) return null;
                    using var s = info.CreateReadStream();
                    using var r = new StreamReader(s, Encoding.UTF8);
                    return r.ReadToEnd();
                }

                const string runtimePrefix = "/Plugins/JMSFusion/runtime/";
                if (url.StartsWith(runtimePrefix, StringComparison.Ordinal))
                {
                    var name = Path.GetFileNameWithoutExtension(url);
                    var resource = name switch
                    {
                        "auth" => "RuntimeModules.auth.js",
                        "api" => "RuntimeModules.api.js",
                        "storage-preload" => "RuntimeModules.storagePreload.js",
                        _ => null
                    };
                    if (resource == null) return null;
                    var full = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith(resource, StringComparison.OrdinalIgnoreCase));
                    if (full == null) return null;
                    using var s = asm.GetManifestResourceStream(full);
                    if (s == null) return null;
                    using var r = new StreamReader(s, Encoding.UTF8);
                    return r.ReadToEnd();
                }
            }
            catch
            {
            }

            return null;
        }

        private static string? Resolve(string importerUrl, string specifier)
        {
            if (string.IsNullOrWhiteSpace(specifier)) return null;
            if (specifier.IndexOf('?') >= 0 || specifier.IndexOf('#') >= 0) return null;

            string combined;
            if (specifier.StartsWith("/", StringComparison.Ordinal))
            {
                combined = specifier;
            }
            else if (specifier.StartsWith("./", StringComparison.Ordinal) || specifier.StartsWith("../", StringComparison.Ordinal))
            {
                var dir = importerUrl.Substring(0, importerUrl.LastIndexOf('/') + 1);
                combined = dir + specifier;
            }
            else
            {
                return null;
            }

            var parts = new List<string>();
            foreach (var seg in combined.Split('/'))
            {
                if (seg.Length == 0 || seg == ".") continue;
                if (seg == "..")
                {
                    if (parts.Count == 0) return null;
                    parts.RemoveAt(parts.Count - 1);
                    continue;
                }

                parts.Add(seg);
            }

            return "/" + string.Join('/', parts);
        }

        private static List<string> ComputeStaticClosure(Assembly asm, IFileProvider provider, ISet<string> known)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var order = new List<string>();
            var queue = new Queue<string>();
            foreach (var e in s_entryPoints)
            {
                queue.Enqueue(e);
            }

            while (queue.Count > 0)
            {
                var url = queue.Dequeue();
                if (!seen.Add(url)) continue;

                // Os pontos de entrada ja sao <script type="module"> e nao precisam de preload.
                if (known.Contains(url))
                {
                    order.Add(url);
                }

                var src = ReadSource(asm, provider, url);
                if (src == null) continue;

                foreach (Match m in s_staticImport.Matches(src))
                {
                    var target = Resolve(url, m.Groups[1].Value);
                    if (target != null && (target.StartsWith("/slider/", StringComparison.Ordinal) ||
                                            target.StartsWith("/Plugins/JMSFusion/runtime/", StringComparison.Ordinal)))
                    {
                        queue.Enqueue(target);
                    }
                }
            }

            return order;
        }
    }
}
