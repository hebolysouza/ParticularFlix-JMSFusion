using Jellyfin.Plugin.JMSFusion.Core;
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers;

[ApiController]
[Route("JMSFusion/cinema-preroll")]
[Route("Plugins/JMSFusion/cinema-preroll")]
public class CinemaPreRollController : ControllerBase
{
    private readonly CinemaPreRollCacheService _cacheService;
    private readonly IUserManager _users;

    public CinemaPreRollController(
        CinemaPreRollCacheService cacheService,
        IUserManager users)
    {
        _cacheService = cacheService;
        _users = users;
    }

    [HttpGet("cache")]
    public async Task<IActionResult> GetCache(
        [FromQuery] string? language,
        [FromQuery] string? region,
        [FromQuery] string? regionMode,
        [FromQuery] string? fallbackMode,
        [FromQuery] string? fallbackRegion,
        [FromQuery] bool force,
        CancellationToken ct)
    {
        var snapshot = await _cacheService.GetSnapshotAsync(language, region, regionMode, fallbackMode, fallbackRegion, force, ct).ConfigureAwait(false);
        ApplyUserParentalRatingFilter(snapshot);
        NoCache();
        return Ok(snapshot);
    }

    private void ApplyUserParentalRatingFilter(CinemaPreRollCacheService.CacheSnapshot snapshot)
    {
        var user = TryGetRequestUser();
        var maxScore = user?.MaxParentalRatingScore;
        if (!maxScore.HasValue || maxScore.Value <= 0)
        {
            return;
        }

        var maxSubScore = user?.MaxParentalRatingSubScore;
        snapshot.Items = (snapshot.Items ?? new List<CinemaPreRollCacheService.CacheItem>())
            .Where(item => IsAllowedByMaxParentalRating(item, maxScore.Value, maxSubScore))
            .ToList();
    }

    private User? TryGetRequestUser()
    {
        if (!TryGetRequestUserId(out var userId))
        {
            return null;
        }

        return _users.GetUserById(userId);
    }

    // Fork ParticularFlix 4.0.0.11: identidade so pela claim do token validado pelo Jellyfin (RequestAuth). O cabecalho
    // X-Emby-UserId (e o ?userId=) qualquer cliente escreve, e estas rotas nao exigem login: com o ID do admin, mesmo sem
    // conta, dava para agir como admin (ler chaves do Radarr/Sonarr, pedir filmes, mudar configuracoes).
    private bool TryGetRequestUserId(out Guid userId)
    {
        return RequestAuth.TryGetAuthenticatedUserId(HttpContext, out userId);
    }

    private static bool IsAllowedByMaxParentalRating(
        CinemaPreRollCacheService.CacheItem item,
        int maxScore,
        int? maxSubScore)
    {
        if (IsUnratedCertification(item.OfficialRating) || !item.RatingScore.HasValue)
        {
            return false;
        }

        if (item.RatingScore.Value < maxScore)
        {
            return true;
        }

        if (item.RatingScore.Value > maxScore)
        {
            return false;
        }

        if (!item.RatingSubScore.HasValue || !maxSubScore.HasValue)
        {
            return true;
        }

        return item.RatingSubScore.Value <= maxSubScore.Value;
    }

    private static bool IsUnratedCertification(string? officialRating)
    {
        var value = string.IsNullOrWhiteSpace(officialRating)
            ? string.Empty
            : officialRating.Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        return value is "NR" or "US-NR" or "NOT RATED" or "UNRATED" or "UR";
    }

    private void NoCache()
    {
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";
    }
}
