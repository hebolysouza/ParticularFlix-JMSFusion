using System;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JMSFusion.Core;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("Plugins/JMSFusion/ScopedCache")]
    public class ScopedCacheController : ControllerBase
    {
        private readonly ScopedCacheJsonService _cacheService;
        private readonly ILogger<ScopedCacheController> _logger;
        private readonly IUserManager _userManager;

        // Fork ParticularFlix: limite de tamanho de um cache gravado. Os maiores (slider, fileiras)
        // ficam bem abaixo disso; o limite so impede que alguem encha o disco do servidor.
        private const long MaxPayloadBytes = 16L * 1024 * 1024;

        public ScopedCacheController(
            ScopedCacheJsonService cacheService,
            ILogger<ScopedCacheController> logger,
            IUserManager userManager)
        {
            _cacheService = cacheService;
            _logger = logger;
            _userManager = userManager;
        }

        // Fork ParticularFlix: antes estas rotas nao pediam login, entao qualquer pessoa na internet
        // podia ler ou gravar o cache (slider, fileiras, recomendacoes) de qualquer usuario, bastando
        // montar o escopo "serverId|userId". Agora: precisa estar logado, e um usuario comum so mexe
        // no escopo que termina com o proprio id. Administrador e chave de API acessam qualquer escopo
        // (pagina de backup do cache). A identidade vem do token validado pelo Jellyfin, nunca de cabecalho.
        private IActionResult? Authorize(string scope)
        {
            var level = RequestAuth.GetLevel(HttpContext, _userManager);
            if (level == RequestAuth.Level.Anonymous)
            {
                return Unauthorized(new { ok = false, error = "auth-required" });
            }

            if (level == RequestAuth.Level.Admin)
            {
                return null;
            }

            if (!RequestAuth.TryGetAuthenticatedUserId(HttpContext, out var callerId))
            {
                return Unauthorized(new { ok = false, error = "auth-required" });
            }

            var raw = (scope ?? string.Empty).Trim();
            var bar = raw.LastIndexOf('|');
            var userPart = (bar >= 0 ? raw.Substring(bar + 1) : raw)
                .Replace("-", string.Empty, StringComparison.Ordinal)
                .Trim();

            if (!string.Equals(userPart, callerId.ToString("N"), StringComparison.OrdinalIgnoreCase))
            {
                return StatusCode(403, new { ok = false, error = "scope-forbidden" });
            }

            return null;
        }

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }

        [HttpGet("{cacheType}/{scope}")]
        public async Task<IActionResult> Get(
            string cacheType,
            string scope,
            CancellationToken cancellationToken)
        {
            if (!_cacheService.TryNormalizeCacheType(cacheType, out var normalizedCacheType))
            {
                return NotFound();
            }

            var denied = Authorize(scope);
            if (denied is not null)
            {
                return denied;
            }

            try
            {
                var raw = await _cacheService.ReadAsync(normalizedCacheType, scope, cancellationToken).ConfigureAwait(false);
                NoCache();
                Response.Headers["X-JMS-Gen"] = ScopedCacheJsonService.CurrentGeneration(normalizedCacheType, scope).ToString();
                return Content(raw, "application/json; charset=utf-8", Encoding.UTF8);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { ok = false, error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[JMSFusion] Scoped cache read failed for {CacheType}", normalizedCacheType);
                return StatusCode(500, new { ok = false, error = ex.Message });
            }
        }

        [HttpPost("{cacheType}/{scope}")]
        [RequestSizeLimit(MaxPayloadBytes)]
        public async Task<IActionResult> Put(
            string cacheType,
            string scope,
            [FromBody] JsonElement payload,
            CancellationToken cancellationToken)
        {
            if (!_cacheService.TryNormalizeCacheType(cacheType, out var normalizedCacheType))
            {
                return NotFound();
            }

            var denied = Authorize(scope);
            if (denied is not null)
            {
                return denied;
            }

            try
            {
                // O cliente informa a geracao com que leu os dados; se a politica de acesso mudou desde entao,
                // a gravacao e recusada para nao reviver conteudo de permissoes antigas.
                if (Request.Headers.TryGetValue("X-JMS-Gen", out var sentGen)
                    && long.TryParse(sentGen.ToString(), out var clientGen)
                    && clientGen != ScopedCacheJsonService.CurrentGeneration(normalizedCacheType, scope))
                {
                    NoCache();
                    Response.Headers["X-JMS-Gen"] = ScopedCacheJsonService.CurrentGeneration(normalizedCacheType, scope).ToString();
                    return StatusCode(409, new { ok = false, stale = true });
                }

                var raw = payload.ValueKind == JsonValueKind.Undefined
                    ? "{}"
                    : payload.GetRawText();

                if (raw.Length > MaxPayloadBytes)
                {
                    return StatusCode(413, new { ok = false, error = "too-large" });
                }

                var written = await _cacheService.WriteAsync(normalizedCacheType, scope, raw, cancellationToken).ConfigureAwait(false);
                NoCache();
                return Ok(new { ok = true, written });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { ok = false, error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[JMSFusion] Scoped cache write failed for {CacheType}", normalizedCacheType);
                return StatusCode(500, new { ok = false, error = ex.Message });
            }
        }

        [HttpDelete("{cacheType}/{scope}")]
        public async Task<IActionResult> Delete(
            string cacheType,
            string scope,
            CancellationToken cancellationToken)
        {
            if (!_cacheService.TryNormalizeCacheType(cacheType, out var normalizedCacheType))
            {
                return NotFound();
            }

            var denied = Authorize(scope);
            if (denied is not null)
            {
                return denied;
            }

            try
            {
                var deleted = await _cacheService.DeleteAsync(normalizedCacheType, scope, cancellationToken).ConfigureAwait(false);
                NoCache();
                return Ok(new { ok = true, deleted });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { ok = false, error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[JMSFusion] Scoped cache delete failed for {CacheType}", normalizedCacheType);
                return StatusCode(500, new { ok = false, error = ex.Message });
            }
        }
    }
}
