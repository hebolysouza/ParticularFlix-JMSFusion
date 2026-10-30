using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers;

/// <summary>
/// Scripts (.js) e estilos (.css) personalizados do dono do servidor.
/// Basta colocar os arquivos na pasta "custom" do plugin; eles sao injetados na pagina junto com o JMSFusion.
/// Fork ParticularFlix: arquivos que comecam com "_" e fontes (.woff2, .woff, .ttf, .otf) sao apenas servidos, nunca
/// injetados. Assim um tema (ex.: o NetFin) e as fontes dele ficam no servidor e o CSS do branding os importa por
/// "/JMSFusion/custom/_arquivo.css", na mesma ordem de antes, sem depender da internet.
/// </summary>
public static class CustomAssets
{
    private static readonly Regex SafeName = new(@"^[A-Za-z0-9_][A-Za-z0-9._-]{0,100}\.(js|css|woff2|woff|ttf|otf)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static bool IsSafeName(string? name) => !string.IsNullOrEmpty(name) && SafeName.IsMatch(name);

    public static bool IsInjected(string name) =>
        !name.StartsWith('_')
        && (name.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".css", StringComparison.OrdinalIgnoreCase));

    public static string ContentTypeOf(string name)
    {
        var ext = Path.GetExtension(name).ToLowerInvariant();
        return ext switch
        {
            ".css" => "text/css; charset=utf-8",
            ".woff2" => "font/woff2",
            ".woff" => "font/woff",
            ".ttf" => "font/ttf",
            ".otf" => "font/otf",
            _ => "application/javascript; charset=utf-8"
        };
    }

    public static string? GetDirectory()
    {
        try
        {
            return JMSFusionPlugin.Instance?.GetStorageDirectory("custom");
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Tags HTML dos arquivos personalizados (ordem alfabetica), com ?v=<data de modificacao>.</summary>
    public static string BuildTags()
    {
        try
        {
            var dir = GetDirectory();
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
            {
                return string.Empty;
            }

            var sb = new System.Text.StringBuilder();
            foreach (var file in Directory.EnumerateFiles(dir).OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
            {
                var name = Path.GetFileName(file);
                if (!IsSafeName(name) || !IsInjected(name))
                {
                    continue;
                }

                var ver = new DateTimeOffset(File.GetLastWriteTimeUtc(file)).ToUnixTimeSeconds();
                var url = "../JMSFusion/custom/" + Uri.EscapeDataString(name) + "?v=" + ver;
                if (name.EndsWith(".css", StringComparison.OrdinalIgnoreCase))
                {
                    sb.AppendLine("<link rel=\"stylesheet\" href=\"" + url + "\">");
                }
                else
                {
                    sb.AppendLine("<script src=\"" + url + "\" defer></script>");
                }
            }

            return sb.ToString();
        }
        catch
        {
            return string.Empty;
        }
    }
}

[ApiController]
[Route("JMSFusion/custom")]
public class CustomAssetsController : ControllerBase
{
    [HttpGet("{name}")]
    public IActionResult Get(string name)
    {
        if (!CustomAssets.IsSafeName(name))
        {
            return NotFound();
        }

        var dir = CustomAssets.GetDirectory();
        if (string.IsNullOrEmpty(dir))
        {
            return NotFound();
        }

        var path = Path.Combine(dir, name);
        var full = Path.GetFullPath(path);
        if (!full.StartsWith(Path.GetFullPath(dir), StringComparison.Ordinal) || !System.IO.File.Exists(full))
        {
            return NotFound();
        }

        var contentType = CustomAssets.ContentTypeOf(name);

        Response.Headers["Cache-Control"] = Request.Query.ContainsKey("v")
            ? "public, max-age=31536000, immutable"
            : "no-cache";
        return PhysicalFile(full, contentType);
    }
}
