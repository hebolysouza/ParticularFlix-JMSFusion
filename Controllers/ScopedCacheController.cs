using System;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JMSFusion.Core;
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

        public ScopedCacheController(
            ScopedCacheJsonService cacheService,
            ILogger<ScopedCacheController> logger)
        {
            _cacheService = cacheService;
            _logger = logger;
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
