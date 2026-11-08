using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("MonWUI/arr")]
    [Route("Plugins/MonWUI/arr")]
    public class ArrController : ControllerBase
    {
        private static readonly HttpClient Http = new();
        private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
        {
            WriteIndented = false
        };

        private readonly IUserManager _users;

        public ArrController(IUserManager users)
        {
            _users = users;
        }

        public sealed class ArrSettingsRequest
        {
            public bool? Enabled { get; set; }
            public bool? SonarrEnabled { get; set; }
            public string? SonarrBaseUrl { get; set; }
            public string? SonarrApiKey { get; set; }
            public string? SonarrRootFolderPath { get; set; }
            public int? SonarrQualityProfileId { get; set; }
            public int? SonarrLanguageProfileId { get; set; }
            public bool? SonarrSeasonFolder { get; set; }
            public bool? SonarrSearchOnRequest { get; set; }
            public bool? Sonarr4KEnabled { get; set; }
            public string? Sonarr4KBaseUrl { get; set; }
            public string? Sonarr4KApiKey { get; set; }
            public string? Sonarr4KRootFolderPath { get; set; }
            public int? Sonarr4KQualityProfileId { get; set; }
            public int? Sonarr4KLanguageProfileId { get; set; }
            public bool? Sonarr4KSeasonFolder { get; set; }
            public bool? Sonarr4KSearchOnRequest { get; set; }
            public bool? RadarrEnabled { get; set; }
            public string? RadarrBaseUrl { get; set; }
            public string? RadarrApiKey { get; set; }
            public string? RadarrRootFolderPath { get; set; }
            public int? RadarrQualityProfileId { get; set; }
            public bool? RadarrSearchOnRequest { get; set; }
            public bool? Radarr4KEnabled { get; set; }
            public string? Radarr4KBaseUrl { get; set; }
            public string? Radarr4KApiKey { get; set; }
            public string? Radarr4KRootFolderPath { get; set; }
            public int? Radarr4KQualityProfileId { get; set; }
            public bool? Radarr4KSearchOnRequest { get; set; }
        }

        public sealed class ArrEpisodeRequest
        {
            public int? TmdbId { get; set; }
            public int? TvdbId { get; set; }
            public int? SeasonNumber { get; set; }
            public int? EpisodeNumber { get; set; }
            public string? Title { get; set; }
            public bool? Is4K { get; set; }
        }

        public sealed class ArrMovieRequest
        {
            public int? TmdbId { get; set; }
            public string? Title { get; set; }
            public int? Year { get; set; }
            public bool? Is4K { get; set; }
        }

        [HttpGet("settings")]
        public IActionResult GetSettings()
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                settings = BuildSettingsPayload(GetConfig(), includeSensitive: true)
            });
        }

        [HttpPost("settings")]
        public IActionResult SaveSettings([FromBody] ArrSettingsRequest? request)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;

            if (request?.Enabled.HasValue == true) cfg.EnableArrIntegration = request.Enabled.Value;
            if (request?.SonarrEnabled.HasValue == true) cfg.ArrSonarrEnabled = request.SonarrEnabled.Value;
            if (request?.SonarrBaseUrl is not null) cfg.ArrSonarrBaseUrl = NormalizeBaseUrlForStorage(request.SonarrBaseUrl);
            if (request?.SonarrApiKey is not null) cfg.ArrSonarrApiKey = NormalizeSecret(request.SonarrApiKey);
            if (request?.SonarrRootFolderPath is not null) cfg.ArrSonarrRootFolderPath = CleanText(request.SonarrRootFolderPath, 500);
            if (request?.SonarrQualityProfileId.HasValue == true) cfg.ArrSonarrQualityProfileId = Math.Max(0, request.SonarrQualityProfileId.Value);
            if (request?.SonarrLanguageProfileId.HasValue == true) cfg.ArrSonarrLanguageProfileId = Math.Max(0, request.SonarrLanguageProfileId.Value);
            if (request?.SonarrSeasonFolder.HasValue == true) cfg.ArrSonarrSeasonFolder = request.SonarrSeasonFolder.Value;
            if (request?.SonarrSearchOnRequest.HasValue == true) cfg.ArrSonarrSearchOnRequest = request.SonarrSearchOnRequest.Value;
            if (request?.Sonarr4KEnabled.HasValue == true) cfg.ArrSonarr4KEnabled = request.Sonarr4KEnabled.Value;
            if (request?.Sonarr4KBaseUrl is not null) cfg.ArrSonarr4KBaseUrl = NormalizeBaseUrlForStorage(request.Sonarr4KBaseUrl);
            if (request?.Sonarr4KApiKey is not null) cfg.ArrSonarr4KApiKey = NormalizeSecret(request.Sonarr4KApiKey);
            if (request?.Sonarr4KRootFolderPath is not null) cfg.ArrSonarr4KRootFolderPath = CleanText(request.Sonarr4KRootFolderPath, 500);
            if (request?.Sonarr4KQualityProfileId.HasValue == true) cfg.ArrSonarr4KQualityProfileId = Math.Max(0, request.Sonarr4KQualityProfileId.Value);
            if (request?.Sonarr4KLanguageProfileId.HasValue == true) cfg.ArrSonarr4KLanguageProfileId = Math.Max(0, request.Sonarr4KLanguageProfileId.Value);
            if (request?.Sonarr4KSeasonFolder.HasValue == true) cfg.ArrSonarr4KSeasonFolder = request.Sonarr4KSeasonFolder.Value;
            if (request?.Sonarr4KSearchOnRequest.HasValue == true) cfg.ArrSonarr4KSearchOnRequest = request.Sonarr4KSearchOnRequest.Value;
            if (request?.RadarrEnabled.HasValue == true) cfg.ArrRadarrEnabled = request.RadarrEnabled.Value;
            if (request?.RadarrBaseUrl is not null) cfg.ArrRadarrBaseUrl = NormalizeBaseUrlForStorage(request.RadarrBaseUrl);
            if (request?.RadarrApiKey is not null) cfg.ArrRadarrApiKey = NormalizeSecret(request.RadarrApiKey);
            if (request?.RadarrRootFolderPath is not null) cfg.ArrRadarrRootFolderPath = CleanText(request.RadarrRootFolderPath, 500);
            if (request?.RadarrQualityProfileId.HasValue == true) cfg.ArrRadarrQualityProfileId = Math.Max(0, request.RadarrQualityProfileId.Value);
            if (request?.RadarrSearchOnRequest.HasValue == true) cfg.ArrRadarrSearchOnRequest = request.RadarrSearchOnRequest.Value;
            if (request?.Radarr4KEnabled.HasValue == true) cfg.ArrRadarr4KEnabled = request.Radarr4KEnabled.Value;
            if (request?.Radarr4KBaseUrl is not null) cfg.ArrRadarr4KBaseUrl = NormalizeBaseUrlForStorage(request.Radarr4KBaseUrl);
            if (request?.Radarr4KApiKey is not null) cfg.ArrRadarr4KApiKey = NormalizeSecret(request.Radarr4KApiKey);
            if (request?.Radarr4KRootFolderPath is not null) cfg.ArrRadarr4KRootFolderPath = CleanText(request.Radarr4KRootFolderPath, 500);
            if (request?.Radarr4KQualityProfileId.HasValue == true) cfg.ArrRadarr4KQualityProfileId = Math.Max(0, request.Radarr4KQualityProfileId.Value);
            if (request?.Radarr4KSearchOnRequest.HasValue == true) cfg.ArrRadarr4KSearchOnRequest = request.Radarr4KSearchOnRequest.Value;

            SerrRequestStore.Save(cfg);
            plugin.UpdateConfiguration(cfg);
            NoCache();
            return Ok(new
            {
                ok = true,
                settings = BuildSettingsPayload(cfg, includeSensitive: true)
            });
        }

        [HttpPost("test")]
        public async Task<IActionResult> Test(CancellationToken cancellationToken)
            => await TestSonarr(cancellationToken);

        [HttpPost("sonarr/test")]
        public async Task<IActionResult> TestSonarr(CancellationToken cancellationToken)
            => await TestSonarrInternal(cancellationToken, use4K: false);

        [HttpPost("sonarr4k/test")]
        public async Task<IActionResult> TestSonarr4K(CancellationToken cancellationToken)
            => await TestSonarrInternal(cancellationToken, use4K: true);

        private async Task<IActionResult> TestSonarrInternal(CancellationToken cancellationToken, bool use4K)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var guard = EnsureSonarrConnectionConfigured(cfg, use4K);
            if (guard is not null) return guard;

            var status = await SendSonarrAsync(cfg, HttpMethod.Get, "/system/status", null, cancellationToken, use4K);
            if (!status.Ok)
            {
                return StatusCode(502, new { ok = false, error = status.Error, status = status.StatusCode });
            }

            var options = await FetchSonarrOptions(cfg, cancellationToken, use4K);
            NoCache();
            return Ok(new { ok = true, sonarr = status.Payload, options });
        }

        [HttpPost("radarr/test")]
        public async Task<IActionResult> TestRadarr(CancellationToken cancellationToken)
            => await TestRadarrInternal(cancellationToken, use4K: false);

        [HttpPost("radarr4k/test")]
        public async Task<IActionResult> TestRadarr4K(CancellationToken cancellationToken)
            => await TestRadarrInternal(cancellationToken, use4K: true);

        private async Task<IActionResult> TestRadarrInternal(CancellationToken cancellationToken, bool use4K)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var guard = EnsureRadarrConnectionConfigured(cfg, use4K);
            if (guard is not null) return guard;

            var status = await SendRadarrAsync(cfg, HttpMethod.Get, "/system/status", null, cancellationToken, use4K);
            if (!status.Ok)
            {
                return StatusCode(502, new { ok = false, error = status.Error, status = status.StatusCode });
            }

            var options = await FetchRadarrOptions(cfg, cancellationToken, use4K);
            NoCache();
            return Ok(new { ok = true, radarr = status.Payload, options });
        }

        [HttpGet("sonarr/options")]
        public async Task<IActionResult> GetSonarrOptions(CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var guard = EnsureSonarrConnectionConfigured(cfg, use4K: false);
            if (guard is not null) return guard;

            var options = await FetchSonarrOptions(cfg, cancellationToken, use4K: false);
            NoCache();
            return Ok(new { ok = true, options });
        }

        [HttpGet("sonarr4k/options")]
        public async Task<IActionResult> GetSonarr4KOptions(CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var guard = EnsureSonarrConnectionConfigured(cfg, use4K: true);
            if (guard is not null) return guard;

            var options = await FetchSonarrOptions(cfg, cancellationToken, use4K: true);
            NoCache();
            return Ok(new { ok = true, options });
        }

        [HttpGet("radarr/options")]
        public async Task<IActionResult> GetRadarrOptions(CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var guard = EnsureRadarrConnectionConfigured(cfg, use4K: false);
            if (guard is not null) return guard;

            var options = await FetchRadarrOptions(cfg, cancellationToken, use4K: false);
            NoCache();
            return Ok(new { ok = true, options });
        }

        [HttpGet("radarr4k/options")]
        public async Task<IActionResult> GetRadarr4KOptions(CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var guard = EnsureRadarrConnectionConfigured(cfg, use4K: true);
            if (guard is not null) return guard;

            var options = await FetchRadarrOptions(cfg, cancellationToken, use4K: true);
            NoCache();
            return Ok(new { ok = true, options });
        }

        [HttpGet("calendar")]
        public async Task<IActionResult> GetCalendar([FromQuery] string? start = null, [FromQuery] string? end = null, CancellationToken cancellationToken = default)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var cfg = GetConfig();
            if (!cfg.EnableArrIntegration || (!cfg.ArrSonarrEnabled && !cfg.ArrRadarrEnabled))
            {
                return StatusCode(403, new { ok = false, error = "Arr integration is disabled." });
            }

            var now = DateTimeOffset.UtcNow;
            var todayUtc = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
            var startDate = ParseCalendarDate(start) ?? todayUtc.AddDays(-7);
            var endDate = ParseCalendarDate(end) ?? startDate.AddDays(75);
            if (endDate < startDate)
            {
                (startDate, endDate) = (endDate, startDate);
            }

            if ((endDate - startDate).TotalDays > 180)
            {
                endDate = startDate.AddDays(180);
            }

            var events = new List<ArrCalendarItem>();
            if (cfg.ArrSonarrEnabled && EnsureSonarrConnectionConfigured(cfg) is null)
            {
                await AppendSonarrCalendar(events, cfg, startDate, endDate, cancellationToken);
            }
            if (cfg.ArrRadarrEnabled && EnsureRadarrConnectionConfigured(cfg) is null)
            {
                await AppendRadarrCalendar(events, cfg, startDate, endDate, cancellationToken);
            }

            if (SerrRequestStore.Save(cfg))
            {
                JMSFusionPlugin.Instance.UpdateConfiguration(cfg);
            }
            var requests = cfg.SerrRequests ?? new List<SerrRequestEntry>();
            var payload = events
                .OrderBy(item => item.SortDate)
                .ThenBy(item => item.Title, StringComparer.OrdinalIgnoreCase)
                .Select(item =>
                {
                    var request = FindCalendarRequest(requests, item);
                    return new
                    {
                        id = item.Id,
                        service = item.Service,
                        mediaType = item.MediaType,
                        title = item.Title,
                        subtitle = item.Subtitle,
                        date = item.Date,
                        status = item.Status,
                        releaseType = item.ReleaseType,
                        monitored = item.Monitored,
                        hasFile = item.HasFile,
                        tmdbId = item.TmdbId,
                        tvdbId = ResolveCalendarTvdbId(request, item),
                        imdbId = item.ImdbId,
                        overview = item.Overview,
                        posterUrl = item.PosterUrl,
                        arrUrl = item.ArrUrl,
                        serrUrl = BuildSerrMediaWebUrl(cfg, item),
                        requestStatus = request?.Status ?? string.Empty
                    };
                })
                .ToList();

            NoCache();
            return Ok(new
            {
                ok = true,
                start = startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                end = endDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                events = payload
            });
        }

        [HttpPost("episode")]
        public async Task<IActionResult> RequestEpisode([FromBody] ArrEpisodeRequest? request, CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var use4K = ShouldUseSonarr4K(cfg, request?.Is4K == true);
            var guard = EnsureSonarrRequestConfigured(cfg, use4K);
            if (guard is not null) return guard;

            var seasonNumber = request?.SeasonNumber ?? -1;
            var episodeNumber = request?.EpisodeNumber ?? -1;
            if (seasonNumber < 0 || seasonNumber > 1000 || episodeNumber < 0 || episodeNumber > 10000)
            {
                return BadRequest(new { ok = false, error = "Valid seasonNumber and episodeNumber are required." });
            }

            if ((request?.TvdbId ?? 0) <= 0 && (request?.TmdbId ?? 0) <= 0 && string.IsNullOrWhiteSpace(request?.Title))
            {
                return BadRequest(new { ok = false, error = "tvdbId, tmdbId or title is required." });
            }

            var result = await RequestSonarrEpisode(cfg, request!, cancellationToken, use4K);
            if (!result.Ok)
            {
                return StatusCode(502, new { ok = false, error = result.Error, status = result.StatusCode });
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                service = "sonarr",
                seriesId = result.SeriesId,
                episodeId = result.EpisodeId,
                commandId = result.CommandId,
                addedSeries = result.AddedSeries
            });
        }

        [HttpPost("movie")]
        public async Task<IActionResult> RequestMovie([FromBody] ArrMovieRequest? request, CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var use4K = ShouldUseRadarr4K(cfg, request?.Is4K == true);
            var guard = EnsureRadarrRequestConfigured(cfg, use4K);
            if (guard is not null) return guard;

            if ((request?.TmdbId ?? 0) <= 0 && string.IsNullOrWhiteSpace(request?.Title))
            {
                return BadRequest(new { ok = false, error = "tmdbId or title is required." });
            }

            var result = await RequestRadarrMovie(cfg, request!, cancellationToken, use4K);
            if (!result.Ok)
            {
                return StatusCode(502, new { ok = false, error = result.Error, status = result.StatusCode });
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                service = "radarr",
                movieId = result.MovieId,
                commandId = result.CommandId,
                addedMovie = result.AddedMovie
            });
        }

        private async Task<object> FetchSonarrOptions(JMSFusionConfiguration cfg, CancellationToken cancellationToken, bool use4K = false)
        {
            var qualityProfiles = await ReadSonarrOptionList(
                cfg,
                "/qualityprofile",
                cancellationToken,
                use4K,
                item => new
                {
                    id = ReadIntValue(item, "id"),
                    name = ReadString(item, "name")
                });

            var rootFolders = await ReadSonarrOptionList(
                cfg,
                "/rootfolder",
                cancellationToken,
                use4K,
                item => new
                {
                    id = ReadIntValue(item, "id"),
                    path = ReadString(item, "path"),
                    freeSpace = ReadLongValue(item, "freeSpace")
                });

            var languageProfiles = await ReadSonarrOptionList(
                cfg,
                "/languageprofile",
                cancellationToken,
                use4K,
                item => new
                {
                    id = ReadIntValue(item, "id"),
                    name = ReadString(item, "name")
                });

            return new
            {
                qualityProfiles,
                rootFolders,
                languageProfiles
            };
        }

        private async Task<List<T>> ReadSonarrOptionList<T>(
            JMSFusionConfiguration cfg,
            string path,
            CancellationToken cancellationToken,
            bool use4K,
            Func<JsonElement, T> map)
        {
            var response = await SendSonarrAsync(cfg, HttpMethod.Get, path, null, cancellationToken, use4K);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return new List<T>();
            return response.Payload.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.Object)
                .Select(map)
                .ToList();
        }

        private async Task<object> FetchRadarrOptions(JMSFusionConfiguration cfg, CancellationToken cancellationToken, bool use4K = false)
        {
            var qualityProfiles = await ReadRadarrOptionList(
                cfg,
                "/qualityprofile",
                cancellationToken,
                use4K,
                item => new
                {
                    id = ReadIntValue(item, "id"),
                    name = ReadString(item, "name")
                });

            var rootFolders = await ReadRadarrOptionList(
                cfg,
                "/rootfolder",
                cancellationToken,
                use4K,
                item => new
                {
                    id = ReadIntValue(item, "id"),
                    path = ReadString(item, "path"),
                    freeSpace = ReadLongValue(item, "freeSpace")
                });

            return new
            {
                qualityProfiles,
                rootFolders
            };
        }

        private async Task<List<T>> ReadRadarrOptionList<T>(
            JMSFusionConfiguration cfg,
            string path,
            CancellationToken cancellationToken,
            bool use4K,
            Func<JsonElement, T> map)
        {
            var response = await SendRadarrAsync(cfg, HttpMethod.Get, path, null, cancellationToken, use4K);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return new List<T>();
            return response.Payload.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.Object)
                .Select(map)
                .ToList();
        }

        private async Task AppendSonarrCalendar(List<ArrCalendarItem> output, JMSFusionConfiguration cfg, DateTimeOffset startDate, DateTimeOffset endDate, CancellationToken cancellationToken)
        {
            var path = "/calendar?" + BuildQueryString(new Dictionary<string, string>
            {
                ["start"] = CalendarDate(startDate),
                ["end"] = CalendarDate(endDate),
                ["includeSeries"] = "true",
                ["includeEpisodeFile"] = "true",
                ["includeEpisodeImages"] = "true"
            });
            var response = await SendSonarrAsync(cfg, HttpMethod.Get, path, null, cancellationToken);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return;

            foreach (var item in response.Payload.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                if (!TryReadDateAny(item, out var date, "airDateUtc", "airDate")) continue;
                if (!DateInRange(date, startDate, endDate)) continue;

                var series = TryReadObject(item, "series", out var seriesObject) ? seriesObject : default;
                var seriesTitle = ReadStringAny(series, "title", "sortTitle");
                var episodeTitle = ReadStringAny(item, "title");
                var season = ReadIntValue(item, "seasonNumber");
                var episode = ReadIntValue(item, "episodeNumber");
                var code = season > 0 || episode > 0
                    ? "S" + season.ToString("00", CultureInfo.InvariantCulture) + "E" + episode.ToString("00", CultureInfo.InvariantCulture)
                    : string.Empty;
                var title = string.Join(" - ", new[] { seriesTitle, code, episodeTitle }.Where(value => !string.IsNullOrWhiteSpace(value)));
                var hasFile = TryReadObject(item, "episodeFile", out _) || ReadBool(item, "hasFile");
                var monitored = ReadBool(item, "monitored") || ReadBool(series, "monitored");
                var tmdbId = ReadIntValue(series, "tmdbId");
                var tvdbId = ReadIntValue(series, "tvdbId");
                var imdbId = ReadStringAny(series, "imdbId");

                output.Add(new ArrCalendarItem
                {
                    Id = "sonarr:" + ReadIntValue(item, "id").ToString(CultureInfo.InvariantCulture),
                    Service = "sonarr",
                    MediaType = "tv",
                    Title = string.IsNullOrWhiteSpace(title) ? (seriesTitle.Length > 0 ? seriesTitle : "Episode") : title,
                    Subtitle = "Sonarr" + (seriesTitle.Length > 0 ? " • " + seriesTitle : string.Empty),
                    SortDate = date,
                    Date = date.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture),
                    Status = CalendarStatus(date, hasFile, monitored),
                    ReleaseType = "air",
                    Monitored = monitored,
                    HasFile = hasFile,
                    TmdbId = tmdbId,
                    TvdbId = tvdbId,
                    ImdbId = imdbId,
                    Overview = ReadStringAny(item, "overview"),
                    PosterUrl = ReadArrImageUrl(series),
                    ArrUrl = BuildArrItemWebUrl(cfg.ArrSonarrBaseUrl, "series", ReadStringAny(series, "titleSlug"))
                });
            }
        }

        private async Task AppendRadarrCalendar(List<ArrCalendarItem> output, JMSFusionConfiguration cfg, DateTimeOffset startDate, DateTimeOffset endDate, CancellationToken cancellationToken)
        {
            var path = "/calendar?" + BuildQueryString(new Dictionary<string, string>
            {
                ["start"] = CalendarDate(startDate),
                ["end"] = CalendarDate(endDate),
                ["unmonitored"] = "true"
            });
            var response = await SendRadarrAsync(cfg, HttpMethod.Get, path, null, cancellationToken);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return;

            foreach (var item in response.Payload.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                var tmdbId = ReadIntValue(item, "tmdbId");
                var title = ReadStringAny(item, "title", "originalTitle");
                var imdbId = ReadStringAny(item, "imdbId");
                var hasFile = ReadBool(item, "hasFile") || TryReadObject(item, "movieFile", out _);
                var monitored = ReadBool(item, "monitored");
                var dates = new[]
                {
                    ("inCinemas", "cinema"),
                    ("digitalRelease", "digital"),
                    ("physicalRelease", "physical"),
                    ("releaseDate", "release")
                };
                var seenDates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var (property, releaseType) in dates)
                {
                    if (!TryReadDateAny(item, out var date, property)) continue;
                    if (!DateInRange(date, startDate, endDate)) continue;
                    var dayKey = date.ToUniversalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                    if (!seenDates.Add(dayKey)) continue;

                    output.Add(new ArrCalendarItem
                    {
                        Id = "radarr:" + (tmdbId > 0 ? tmdbId.ToString(CultureInfo.InvariantCulture) : ReadIntValue(item, "id").ToString(CultureInfo.InvariantCulture)) + ":" + releaseType,
                        Service = "radarr",
                        MediaType = "movie",
                        Title = string.IsNullOrWhiteSpace(title) ? "Movie" : title,
                        Subtitle = "Radarr",
                        SortDate = date,
                        Date = date.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture),
                        Status = CalendarStatus(date, hasFile, monitored),
                        ReleaseType = releaseType,
                        Monitored = monitored,
                        HasFile = hasFile,
                        TmdbId = tmdbId,
                        TvdbId = null,
                        ImdbId = imdbId,
                        Overview = ReadStringAny(item, "overview"),
                        PosterUrl = ReadArrImageUrl(item),
                        ArrUrl = BuildArrItemWebUrl(cfg.ArrRadarrBaseUrl, "movie", ReadStringAny(item, "titleSlug"))
                    });
                }
            }
        }

        private static DateTimeOffset? ParseCalendarDate(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto))
            {
                return new DateTimeOffset(dto.UtcDateTime.Date, TimeSpan.Zero);
            }
            if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dt))
            {
                return new DateTimeOffset(DateTime.SpecifyKind(dt.Date, DateTimeKind.Utc));
            }
            return null;
        }

        private static string CalendarDate(DateTimeOffset value)
            => value.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        private static bool DateInRange(DateTimeOffset value, DateTimeOffset startDate, DateTimeOffset endDate)
        {
            var day = new DateTimeOffset(value.UtcDateTime.Date, TimeSpan.Zero);
            return day >= startDate && day <= endDate;
        }

        private static string CalendarStatus(DateTimeOffset date, bool hasFile, bool monitored)
        {
            if (hasFile) return "available";
            if (!monitored) return "unmonitored";
            return date > DateTimeOffset.UtcNow ? "upcoming" : "missing";
        }

        private static SerrRequestEntry? FindCalendarRequest(IEnumerable<SerrRequestEntry> requests, ArrCalendarItem item)
        {
            foreach (var req in requests ?? Array.Empty<SerrRequestEntry>())
            {
                if (!Same(req.MediaType, item.MediaType)) continue;
                if (Same(req.Status, "declined") || Same(req.Status, "withdrawn")) continue;
                if (item.MediaType == "movie" && item.TmdbId > 0 && req.MediaId == item.TmdbId) return req;
                if (item.MediaType == "tv")
                {
                    if (item.TvdbId.HasValue && req.TvdbId.HasValue && req.TvdbId.Value == item.TvdbId.Value) return req;
                    if (item.TmdbId > 0 && req.MediaId == item.TmdbId) return req;
                }
            }

            return null;
        }

        private static int? ResolveCalendarTvdbId(SerrRequestEntry? request, ArrCalendarItem item)
        {
            if (request?.TvdbId.HasValue == true && request.TvdbId.Value > 0) return request.TvdbId.Value;
            return item.TvdbId.HasValue && item.TvdbId.Value > 0 ? item.TvdbId.Value : null;
        }

        private async Task<SonarrEpisodeResult> RequestSonarrEpisode(JMSFusionConfiguration cfg, ArrEpisodeRequest request, CancellationToken cancellationToken, bool use4K = false)
        {
            var series = await FindSonarrSeries(cfg, request, cancellationToken, use4K);
            var addedSeries = false;
            if (series.ValueKind != JsonValueKind.Object)
            {
                var lookup = await LookupSonarrSeries(cfg, request, cancellationToken, use4K);
                if (lookup.ValueKind != JsonValueKind.Object)
                {
                    return SonarrEpisodeResult.Fail(404, "Series was not found in Sonarr lookup.");
                }

                var addResult = await AddSonarrSeries(cfg, lookup, request.SeasonNumber ?? 0, cancellationToken, use4K);
                if (!addResult.Ok) return SonarrEpisodeResult.Fail(addResult.StatusCode, addResult.Error);
                series = addResult.Payload;
                addedSeries = true;
            }

            if (!TryReadInt(series, "id", out var seriesId) || seriesId <= 0)
            {
                return SonarrEpisodeResult.Fail(502, "Sonarr did not return a valid series id.");
            }

            var updateResult = await EnsureSonarrSeriesMonitored(cfg, series, request.SeasonNumber ?? 0, cancellationToken, use4K);
            if (updateResult.Ok && updateResult.Payload.ValueKind == JsonValueKind.Object)
            {
                series = updateResult.Payload;
            }

            var episode = await FindSonarrEpisode(cfg, seriesId, request.SeasonNumber ?? 0, request.EpisodeNumber ?? 0, cancellationToken, use4K);
            if (episode.ValueKind != JsonValueKind.Object && addedSeries)
            {
                await SendSonarrAsync(cfg, HttpMethod.Post, "/command", new Dictionary<string, object?>
                {
                    ["name"] = "RefreshSeries",
                    ["seriesId"] = seriesId
                }, cancellationToken, use4K);
                await Task.Delay(1200, cancellationToken);
                episode = await FindSonarrEpisode(cfg, seriesId, request.SeasonNumber ?? 0, request.EpisodeNumber ?? 0, cancellationToken, use4K);
            }

            if (episode.ValueKind != JsonValueKind.Object || !TryReadInt(episode, "id", out var episodeId) || episodeId <= 0)
            {
                return SonarrEpisodeResult.Fail(404, "Episode was not found in Sonarr after adding or locating the series.");
            }

            var monitor = await SendSonarrAsync(cfg, HttpMethod.Put, "/episode/monitor", new Dictionary<string, object?>
            {
                ["episodeIds"] = new[] { episodeId },
                ["monitored"] = true
            }, cancellationToken, use4K);
            if (!monitor.Ok) return SonarrEpisodeResult.Fail(monitor.StatusCode, monitor.Error);

            int? commandId = null;
            if (SonarrSearchOnRequest(cfg, use4K))
            {
                var command = await SendSonarrAsync(cfg, HttpMethod.Post, "/command", new Dictionary<string, object?>
                {
                    ["name"] = "EpisodeSearch",
                    ["episodeIds"] = new[] { episodeId }
                }, cancellationToken, use4K);
                if (!command.Ok) return SonarrEpisodeResult.Fail(command.StatusCode, command.Error);
                if (TryReadInt(command.Payload, "id", out var id)) commandId = id;
            }

            return SonarrEpisodeResult.Success(seriesId, episodeId, commandId, addedSeries);
        }

        private async Task<JsonElement> FindSonarrSeries(JMSFusionConfiguration cfg, ArrEpisodeRequest request, CancellationToken cancellationToken, bool use4K = false)
        {
            var response = await SendSonarrAsync(cfg, HttpMethod.Get, "/series", null, cancellationToken, use4K);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return default;

            foreach (var item in response.Payload.EnumerateArray())
            {
                if (request.TvdbId.HasValue && request.TvdbId.Value > 0 &&
                    TryReadInt(item, "tvdbId", out var tvdbId) && tvdbId == request.TvdbId.Value)
                {
                    return item.Clone();
                }

                var title = CleanKey(request.Title);
                if (!string.IsNullOrWhiteSpace(title) &&
                    string.Equals(CleanKey(ReadString(item, "title")), title, StringComparison.OrdinalIgnoreCase))
                {
                    return item.Clone();
                }
            }

            return default;
        }

        private async Task<JsonElement> LookupSonarrSeries(JMSFusionConfiguration cfg, ArrEpisodeRequest request, CancellationToken cancellationToken, bool use4K = false)
        {
            var terms = new List<string>();
            if (request.TvdbId.HasValue && request.TvdbId.Value > 0) terms.Add("tvdb:" + request.TvdbId.Value.ToString(CultureInfo.InvariantCulture));
            if (request.TmdbId.HasValue && request.TmdbId.Value > 0) terms.Add("tmdb:" + request.TmdbId.Value.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrWhiteSpace(request.Title)) terms.Add(request.Title!);

            foreach (var term in terms.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var response = await SendSonarrAsync(cfg, HttpMethod.Get, "/series/lookup?term=" + Uri.EscapeDataString(term), null, cancellationToken, use4K);
                if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) continue;
                foreach (var item in response.Payload.EnumerateArray())
                {
                    if (request.TvdbId.HasValue && request.TvdbId.Value > 0 &&
                        TryReadInt(item, "tvdbId", out var tvdbId) && tvdbId == request.TvdbId.Value)
                    {
                        return item.Clone();
                    }
                }

                var first = response.Payload.EnumerateArray().FirstOrDefault();
                if (first.ValueKind == JsonValueKind.Object) return first.Clone();
            }

            return default;
        }

        private async Task<ArrCallResult> AddSonarrSeries(JMSFusionConfiguration cfg, JsonElement lookup, int seasonNumber, CancellationToken cancellationToken, bool use4K = false)
        {
            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(lookup.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            body["qualityProfileId"] = SonarrQualityProfileId(cfg, use4K);
            if (SonarrLanguageProfileId(cfg, use4K) > 0) body["languageProfileId"] = SonarrLanguageProfileId(cfg, use4K);
            body["rootFolderPath"] = SonarrRootFolderPath(cfg, use4K);
            body["monitored"] = true;
            body["seasonFolder"] = SonarrSeasonFolder(cfg, use4K);
            body["seasons"] = BuildSeasonMonitorPayload(lookup, seasonNumber);
            body["addOptions"] = new Dictionary<string, object?>
            {
                ["searchForMissingEpisodes"] = false
            };

            return await SendSonarrAsync(cfg, HttpMethod.Post, "/series", body, cancellationToken, use4K);
        }

        private async Task<ArrCallResult> EnsureSonarrSeriesMonitored(JMSFusionConfiguration cfg, JsonElement series, int seasonNumber, CancellationToken cancellationToken, bool use4K = false)
        {
            if (!TryReadInt(series, "id", out var seriesId) || seriesId <= 0) return ArrCallResult.Fail(0, "Invalid series id.");

            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(series.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            body["monitored"] = true;
            body["seasons"] = BuildSeasonMonitorPayload(series, seasonNumber, preserveExisting: true);
            return await SendSonarrAsync(cfg, HttpMethod.Put, "/series/" + seriesId.ToString(CultureInfo.InvariantCulture), body, cancellationToken, use4K);
        }

        private async Task<JsonElement> FindSonarrEpisode(JMSFusionConfiguration cfg, int seriesId, int seasonNumber, int episodeNumber, CancellationToken cancellationToken, bool use4K = false)
        {
            var response = await SendSonarrAsync(cfg, HttpMethod.Get, "/episode?seriesId=" + seriesId.ToString(CultureInfo.InvariantCulture), null, cancellationToken, use4K);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return default;

            foreach (var item in response.Payload.EnumerateArray())
            {
                if (TryReadInt(item, "seasonNumber", out var season) &&
                    TryReadInt(item, "episodeNumber", out var episode) &&
                    season == seasonNumber &&
                    episode == episodeNumber)
                {
                    return item.Clone();
                }
            }

            return default;
        }

        private static List<Dictionary<string, object?>> BuildSeasonMonitorPayload(JsonElement source, int targetSeason, bool preserveExisting = false)
        {
            var output = new List<Dictionary<string, object?>>();
            if (source.ValueKind == JsonValueKind.Object && source.TryGetProperty("seasons", out var seasons) && seasons.ValueKind == JsonValueKind.Array)
            {
                foreach (var season in seasons.EnumerateArray())
                {
                    if (!TryReadInt(season, "seasonNumber", out var seasonNumber)) continue;
                    var row = JsonSerializer.Deserialize<Dictionary<string, object?>>(season.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
                    var monitored = seasonNumber == targetSeason || (preserveExisting && ReadBool(season, "monitored"));
                    row["seasonNumber"] = seasonNumber;
                    row["monitored"] = monitored;
                    output.Add(row);
                }
            }

            if (!output.Any(row => Convert.ToInt32(row["seasonNumber"], CultureInfo.InvariantCulture) == targetSeason))
            {
                output.Add(new Dictionary<string, object?>
                {
                    ["seasonNumber"] = targetSeason,
                    ["monitored"] = true
                });
            }

            return output;
        }

        private async Task<RadarrMovieResult> RequestRadarrMovie(JMSFusionConfiguration cfg, ArrMovieRequest request, CancellationToken cancellationToken, bool use4K = false)
        {
            var movie = await FindRadarrMovie(cfg, request, cancellationToken, use4K);
            var addedMovie = false;
            if (movie.ValueKind != JsonValueKind.Object)
            {
                var lookup = await LookupRadarrMovie(cfg, request, cancellationToken, use4K);
                if (lookup.ValueKind != JsonValueKind.Object)
                {
                    return RadarrMovieResult.Fail(404, "Movie was not found in Radarr lookup.");
                }

                var addResult = await AddRadarrMovie(cfg, lookup, cancellationToken, use4K);
                if (!addResult.Ok) return RadarrMovieResult.Fail(addResult.StatusCode, addResult.Error);
                movie = addResult.Payload;
                addedMovie = true;
            }

            if (!TryReadInt(movie, "id", out var movieId) || movieId <= 0)
            {
                return RadarrMovieResult.Fail(502, "Radarr did not return a valid movie id.");
            }

            var updateResult = await EnsureRadarrMovieMonitored(cfg, movie, cancellationToken, use4K);
            if (!updateResult.Ok) return RadarrMovieResult.Fail(updateResult.StatusCode, updateResult.Error);
            if (updateResult.Payload.ValueKind == JsonValueKind.Object)
            {
                movie = updateResult.Payload;
            }

            int? commandId = null;
            if (RadarrSearchOnRequest(cfg, use4K))
            {
                var command = await SendRadarrAsync(cfg, HttpMethod.Post, "/command", new Dictionary<string, object?>
                {
                    ["name"] = "MoviesSearch",
                    ["movieIds"] = new[] { movieId }
                }, cancellationToken, use4K);
                if (!command.Ok) return RadarrMovieResult.Fail(command.StatusCode, command.Error);
                if (TryReadInt(command.Payload, "id", out var id)) commandId = id;
            }

            return RadarrMovieResult.Success(movieId, commandId, addedMovie);
        }

        private async Task<JsonElement> FindRadarrMovie(JMSFusionConfiguration cfg, ArrMovieRequest request, CancellationToken cancellationToken, bool use4K = false)
        {
            var response = await SendRadarrAsync(cfg, HttpMethod.Get, "/movie", null, cancellationToken, use4K);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return default;

            var requestedTitle = CleanKey(request.Title);
            foreach (var item in response.Payload.EnumerateArray())
            {
                if (request.TmdbId.HasValue && request.TmdbId.Value > 0 &&
                    TryReadInt(item, "tmdbId", out var tmdbId) && tmdbId == request.TmdbId.Value)
                {
                    return item.Clone();
                }

                if (!string.IsNullOrWhiteSpace(requestedTitle) &&
                    string.Equals(CleanKey(ReadString(item, "title")), requestedTitle, StringComparison.OrdinalIgnoreCase) &&
                    MatchesYear(item, request.Year))
                {
                    return item.Clone();
                }
            }

            return default;
        }

        private async Task<JsonElement> LookupRadarrMovie(JMSFusionConfiguration cfg, ArrMovieRequest request, CancellationToken cancellationToken, bool use4K = false)
        {
            if (request.TmdbId.HasValue && request.TmdbId.Value > 0)
            {
                var byTmdb = await SendRadarrAsync(
                    cfg,
                    HttpMethod.Get,
                    "/movie/lookup/tmdb?tmdbId=" + request.TmdbId.Value.ToString(CultureInfo.InvariantCulture),
                    null,
                    cancellationToken,
                    use4K);
                if (byTmdb.Ok && byTmdb.Payload.ValueKind == JsonValueKind.Object)
                {
                    return byTmdb.Payload.Clone();
                }
            }

            var terms = new List<string>();
            if (request.TmdbId.HasValue && request.TmdbId.Value > 0) terms.Add("tmdb:" + request.TmdbId.Value.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrWhiteSpace(request.Title)) terms.Add(request.Title!);

            foreach (var term in terms.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var response = await SendRadarrAsync(cfg, HttpMethod.Get, "/movie/lookup?term=" + Uri.EscapeDataString(term), null, cancellationToken, use4K);
                if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) continue;

                foreach (var item in response.Payload.EnumerateArray())
                {
                    if (request.TmdbId.HasValue && request.TmdbId.Value > 0 &&
                        TryReadInt(item, "tmdbId", out var tmdbId) && tmdbId == request.TmdbId.Value)
                    {
                        return item.Clone();
                    }
                }

                var requestedTitle = CleanKey(request.Title);
                foreach (var item in response.Payload.EnumerateArray())
                {
                    if (!string.IsNullOrWhiteSpace(requestedTitle) &&
                        string.Equals(CleanKey(ReadString(item, "title")), requestedTitle, StringComparison.OrdinalIgnoreCase) &&
                        MatchesYear(item, request.Year))
                    {
                        return item.Clone();
                    }
                }

                var first = response.Payload.EnumerateArray().FirstOrDefault();
                if (first.ValueKind == JsonValueKind.Object) return first.Clone();
            }

            return default;
        }

        private async Task<ArrCallResult> AddRadarrMovie(JMSFusionConfiguration cfg, JsonElement lookup, CancellationToken cancellationToken, bool use4K = false)
        {
            var validation = await ValidateRadarrMovieRequestConfig(cfg, cancellationToken, use4K);
            if (!validation.Ok) return validation;

            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(lookup.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            PrepareRadarrAddMovieBody(body, cfg, use4K);

            var result = await SendRadarrAsync(cfg, HttpMethod.Post, "/movie", body, cancellationToken, use4K);
            if (result.Ok || !IsRadarrSequenceError(result.Error)) return result;

            var minimal = BuildMinimalRadarrAddMovieBody(lookup, cfg, use4K);
            return await SendRadarrAsync(cfg, HttpMethod.Post, "/movie", minimal, cancellationToken, use4K);
        }

        private async Task<ArrCallResult> ValidateRadarrMovieRequestConfig(JMSFusionConfiguration cfg, CancellationToken cancellationToken, bool use4K = false)
        {
            var profiles = await SendRadarrAsync(cfg, HttpMethod.Get, "/qualityprofile", null, cancellationToken, use4K);
            if (!profiles.Ok) return profiles;
            if (profiles.Payload.ValueKind == JsonValueKind.Array &&
                !profiles.Payload.EnumerateArray().Any(profile => TryReadInt(profile, "id", out var id) && id == RadarrQualityProfileId(cfg, use4K)))
            {
                return ArrCallResult.Fail(412, "Radarr quality profile is not valid anymore. Test the Radarr connection and save a valid quality profile.");
            }

            var roots = await SendRadarrAsync(cfg, HttpMethod.Get, "/rootfolder", null, cancellationToken, use4K);
            if (!roots.Ok) return roots;
            var configuredRoot = NormalizeArrPath(RadarrRootFolderPath(cfg, use4K));
            if (roots.Payload.ValueKind == JsonValueKind.Array &&
                !roots.Payload.EnumerateArray().Any(root => string.Equals(NormalizeArrPath(ReadString(root, "path")), configuredRoot, StringComparison.OrdinalIgnoreCase)))
            {
                return ArrCallResult.Fail(412, "Radarr root folder is not valid anymore. Test the Radarr connection and save a valid root folder.");
            }

            return ArrCallResult.Success(200, default);
        }

        private static void PrepareRadarrAddMovieBody(Dictionary<string, object?> body, JMSFusionConfiguration cfg, bool use4K = false)
        {
            foreach (var key in new[]
            {
                "id",
                "movieFile",
                "movieFileId",
                "path",
                "sizeOnDisk",
                "hasFile",
                "downloaded",
                "status",
                "statistics"
            })
            {
                body.Remove(key);
            }

            body["qualityProfileId"] = RadarrQualityProfileId(cfg, use4K);
            body["rootFolderPath"] = RadarrRootFolderPath(cfg, use4K);
            body["monitored"] = true;
            if (!body.ContainsKey("minimumAvailability") || body["minimumAvailability"] is null) body["minimumAvailability"] = "announced";
            if (!body.ContainsKey("tags") || body["tags"] is null) body["tags"] = Array.Empty<int>();
            body["addOptions"] = new Dictionary<string, object?>
            {
                ["searchForMovie"] = false
            };
        }

        private static Dictionary<string, object?> BuildMinimalRadarrAddMovieBody(JsonElement lookup, JMSFusionConfiguration cfg, bool use4K = false)
        {
            var body = new Dictionary<string, object?>();
            foreach (var property in new[]
            {
                "title",
                "originalTitle",
                "sortTitle",
                "tmdbId",
                "imdbId",
                "year",
                "overview",
                "images",
                "website",
                "youTubeTrailerId",
                "studio",
                "runtime",
                "certification",
                "genres",
                "ratings",
                "titleSlug",
                "cleanTitle"
            })
            {
                CopyJsonProperty(lookup, body, property);
            }

            PrepareRadarrAddMovieBody(body, cfg, use4K);
            return body;
        }

        private static void CopyJsonProperty(JsonElement source, Dictionary<string, object?> target, string property)
        {
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var value)) return;
            target[property] = value.Clone();
        }

        private async Task<ArrCallResult> EnsureRadarrMovieMonitored(JMSFusionConfiguration cfg, JsonElement movie, CancellationToken cancellationToken, bool use4K = false)
        {
            if (!TryReadInt(movie, "id", out var movieId) || movieId <= 0) return ArrCallResult.Fail(0, "Invalid movie id.");
            if (ReadBool(movie, "monitored")) return ArrCallResult.Success(200, movie);

            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(movie.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            body["monitored"] = true;
            return await SendRadarrAsync(cfg, HttpMethod.Put, "/movie/" + movieId.ToString(CultureInfo.InvariantCulture), body, cancellationToken, use4K);
        }

        private static bool ShouldUseSonarr4K(JMSFusionConfiguration cfg, bool requested4K)
            => requested4K && IsSonarr4KRequestConfigured(cfg);

        private static bool ShouldUseRadarr4K(JMSFusionConfiguration cfg, bool requested4K)
            => requested4K && IsRadarr4KRequestConfigured(cfg);

        private static bool IsSonarr4KRequestConfigured(JMSFusionConfiguration cfg)
            => cfg.EnableArrIntegration &&
               cfg.ArrSonarr4KEnabled &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarr4KBaseUrl) &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarr4KApiKey) &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarr4KRootFolderPath) &&
               cfg.ArrSonarr4KQualityProfileId > 0;

        private static bool IsRadarr4KRequestConfigured(JMSFusionConfiguration cfg)
            => cfg.EnableArrIntegration &&
               cfg.ArrRadarr4KEnabled &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarr4KBaseUrl) &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarr4KApiKey) &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarr4KRootFolderPath) &&
               cfg.ArrRadarr4KQualityProfileId > 0;

        private static string SonarrBaseUrl(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrSonarr4KBaseUrl : cfg.ArrSonarrBaseUrl;

        private static string SonarrApiKey(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrSonarr4KApiKey : cfg.ArrSonarrApiKey;

        private static string SonarrRootFolderPath(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrSonarr4KRootFolderPath : cfg.ArrSonarrRootFolderPath;

        private static int SonarrQualityProfileId(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrSonarr4KQualityProfileId : cfg.ArrSonarrQualityProfileId;

        private static int SonarrLanguageProfileId(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrSonarr4KLanguageProfileId : cfg.ArrSonarrLanguageProfileId;

        private static bool SonarrSeasonFolder(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrSonarr4KSeasonFolder : cfg.ArrSonarrSeasonFolder;

        private static bool SonarrSearchOnRequest(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrSonarr4KSearchOnRequest : cfg.ArrSonarrSearchOnRequest;

        private static string RadarrBaseUrl(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrRadarr4KBaseUrl : cfg.ArrRadarrBaseUrl;

        private static string RadarrApiKey(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrRadarr4KApiKey : cfg.ArrRadarrApiKey;

        private static string RadarrRootFolderPath(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrRadarr4KRootFolderPath : cfg.ArrRadarrRootFolderPath;

        private static int RadarrQualityProfileId(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrRadarr4KQualityProfileId : cfg.ArrRadarrQualityProfileId;

        private static bool RadarrSearchOnRequest(JMSFusionConfiguration cfg, bool use4K)
            => use4K ? cfg.ArrRadarr4KSearchOnRequest : cfg.ArrRadarrSearchOnRequest;

        private IActionResult? EnsureSonarrConnectionConfigured(JMSFusionConfiguration cfg, bool use4K = false)
        {
            if (string.IsNullOrWhiteSpace(SonarrBaseUrl(cfg, use4K)) || string.IsNullOrWhiteSpace(SonarrApiKey(cfg, use4K)))
            {
                return StatusCode(412, new { ok = false, error = (use4K ? "4K " : string.Empty) + "Sonarr URL and API key are required." });
            }

            return null;
        }

        private IActionResult? EnsureRadarrConnectionConfigured(JMSFusionConfiguration cfg, bool use4K = false)
        {
            if (string.IsNullOrWhiteSpace(RadarrBaseUrl(cfg, use4K)) || string.IsNullOrWhiteSpace(RadarrApiKey(cfg, use4K)))
            {
                return StatusCode(412, new { ok = false, error = (use4K ? "4K " : string.Empty) + "Radarr URL and API key are required." });
            }

            return null;
        }

        private IActionResult? EnsureRadarrRequestConfigured(JMSFusionConfiguration cfg, bool use4K = false)
        {
            if (!cfg.EnableArrIntegration || !(use4K ? cfg.ArrRadarr4KEnabled : cfg.ArrRadarrEnabled))
            {
                return StatusCode(403, new { ok = false, error = (use4K ? "4K " : string.Empty) + "Arr/Radarr integration is disabled." });
            }

            var connectionError = EnsureRadarrConnectionConfigured(cfg, use4K);
            if (connectionError is not null) return connectionError;

            if (string.IsNullOrWhiteSpace(RadarrRootFolderPath(cfg, use4K)) || RadarrQualityProfileId(cfg, use4K) <= 0)
            {
                return StatusCode(412, new { ok = false, error = (use4K ? "4K " : string.Empty) + "Radarr root folder path and quality profile id are required." });
            }

            return null;
        }

        private IActionResult? EnsureSonarrRequestConfigured(JMSFusionConfiguration cfg, bool use4K = false)
        {
            if (!cfg.EnableArrIntegration || !(use4K ? cfg.ArrSonarr4KEnabled : cfg.ArrSonarrEnabled))
            {
                return StatusCode(403, new { ok = false, error = (use4K ? "4K " : string.Empty) + "Arr/Sonarr integration is disabled." });
            }

            var connectionError = EnsureSonarrConnectionConfigured(cfg, use4K);
            if (connectionError is not null) return connectionError;

            if (string.IsNullOrWhiteSpace(SonarrRootFolderPath(cfg, use4K)) || SonarrQualityProfileId(cfg, use4K) <= 0)
            {
                return StatusCode(412, new { ok = false, error = (use4K ? "4K " : string.Empty) + "Sonarr root folder path and quality profile id are required." });
            }

            return null;
        }

        private async Task<ArrCallResult> SendSonarrAsync(JMSFusionConfiguration cfg, HttpMethod method, string pathAndQuery, object? body, CancellationToken cancellationToken, bool use4K = false)
            => await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", method, pathAndQuery, body, cancellationToken);

        private async Task<ArrCallResult> SendRadarrAsync(JMSFusionConfiguration cfg, HttpMethod method, string pathAndQuery, object? body, CancellationToken cancellationToken, bool use4K = false)
            => await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", method, pathAndQuery, body, cancellationToken);

        private async Task<ArrCallResult> SendArrAsync(string baseUrl, string apiKey, string serviceName, HttpMethod method, string pathAndQuery, object? body, CancellationToken cancellationToken)
        {
            try
            {
                var apiBase = BuildArrApiBase(baseUrl);
                if (apiBase is null) return ArrCallResult.Fail(400, "Invalid " + serviceName + " URL.");

                var relative = pathAndQuery.TrimStart('/');
                using var request = new HttpRequestMessage(method, new Uri(apiBase, relative));
                request.Headers.TryAddWithoutValidation("X-Api-Key", apiKey);
                request.Headers.TryAddWithoutValidation("Accept", "application/json");
                if (body is not null)
                {
                    request.Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions), Encoding.UTF8, "application/json");
                }

                using var response = await Http.SendAsync(request, cancellationToken);
                var raw = await response.Content.ReadAsStringAsync(cancellationToken);
                if (!response.IsSuccessStatusCode)
                {
                    return ArrCallResult.Fail((int)response.StatusCode, ExtractError(raw) ?? (serviceName + " HTTP " + (int)response.StatusCode));
                }

                if (string.IsNullOrWhiteSpace(raw)) return ArrCallResult.Success((int)response.StatusCode, default);
                using var doc = JsonDocument.Parse(raw);
                return ArrCallResult.Success((int)response.StatusCode, doc.RootElement.Clone());
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                return ArrCallResult.Fail(500, ex.Message);
            }
        }

        private static Uri? BuildArrApiBase(string value)
        {
            var clean = NormalizeBaseUrlForStorage(value);
            if (!Uri.TryCreate(clean, UriKind.Absolute, out var uri)) return null;
            var raw = uri.ToString().TrimEnd('/');
            if (!raw.EndsWith("/api/v3", StringComparison.OrdinalIgnoreCase))
            {
                raw += "/api/v3";
            }

            return Uri.TryCreate(raw.TrimEnd('/') + "/", UriKind.Absolute, out var api) ? api : null;
        }

        private static string BuildArrItemWebUrl(string baseUrl, string section, string slug)
        {
            var webBase = BuildWebBaseUrl(baseUrl, "/api/v3");
            if (string.IsNullOrWhiteSpace(webBase)) return string.Empty;
            var cleanSection = (section ?? string.Empty).Trim().Trim('/');
            var cleanSlug = (slug ?? string.Empty).Trim().Trim('/');
            if (string.IsNullOrWhiteSpace(cleanSection) || string.IsNullOrWhiteSpace(cleanSlug)) return webBase;
            return webBase + "/" + Uri.EscapeDataString(cleanSection) + "/" + Uri.EscapeDataString(cleanSlug);
        }

        private static string BuildSerrMediaWebUrl(JMSFusionConfiguration cfg, ArrCalendarItem item)
        {
            if (!cfg.EnableSerrIntegration || string.IsNullOrWhiteSpace(cfg.SerrBaseUrl) || item.TmdbId <= 0) return string.Empty;
            var webBase = BuildWebBaseUrl(cfg.SerrBaseUrl, "/api/v1");
            if (string.IsNullOrWhiteSpace(webBase)) return string.Empty;
            var section = Same(item.MediaType, "tv") ? "tv" : "movie";
            return webBase + "/" + section + "/" + item.TmdbId.ToString(CultureInfo.InvariantCulture);
        }

        private static string BuildWebBaseUrl(string baseUrl, string apiSuffix)
        {
            var clean = NormalizeBaseUrlForStorage(baseUrl);
            if (!Uri.TryCreate(clean, UriKind.Absolute, out var uri)) return string.Empty;
            var raw = uri.ToString().TrimEnd('/');
            if (!string.IsNullOrWhiteSpace(apiSuffix) && raw.EndsWith(apiSuffix, StringComparison.OrdinalIgnoreCase))
            {
                raw = raw[..^apiSuffix.Length].TrimEnd('/');
            }
            return raw;
        }

        private static object BuildSettingsPayload(JMSFusionConfiguration cfg, bool includeSensitive)
            => new
            {
                enabled = cfg.EnableArrIntegration,
                sonarrEnabled = cfg.ArrSonarrEnabled,
                sonarrBaseUrl = cfg.ArrSonarrBaseUrl,
                sonarrApiKey = includeSensitive ? cfg.ArrSonarrApiKey : string.Empty,
                hasSonarrApiKey = !string.IsNullOrWhiteSpace(cfg.ArrSonarrApiKey),
                sonarrRootFolderPath = cfg.ArrSonarrRootFolderPath,
                sonarrQualityProfileId = cfg.ArrSonarrQualityProfileId,
                sonarrLanguageProfileId = cfg.ArrSonarrLanguageProfileId,
                sonarrSeasonFolder = cfg.ArrSonarrSeasonFolder,
                sonarrSearchOnRequest = cfg.ArrSonarrSearchOnRequest,
                sonarr4KEnabled = cfg.ArrSonarr4KEnabled,
                sonarr4KBaseUrl = cfg.ArrSonarr4KBaseUrl,
                sonarr4KApiKey = includeSensitive ? cfg.ArrSonarr4KApiKey : string.Empty,
                hasSonarr4KApiKey = !string.IsNullOrWhiteSpace(cfg.ArrSonarr4KApiKey),
                sonarr4KRootFolderPath = cfg.ArrSonarr4KRootFolderPath,
                sonarr4KQualityProfileId = cfg.ArrSonarr4KQualityProfileId,
                sonarr4KLanguageProfileId = cfg.ArrSonarr4KLanguageProfileId,
                sonarr4KSeasonFolder = cfg.ArrSonarr4KSeasonFolder,
                sonarr4KSearchOnRequest = cfg.ArrSonarr4KSearchOnRequest,
                radarrEnabled = cfg.ArrRadarrEnabled,
                radarrBaseUrl = cfg.ArrRadarrBaseUrl,
                radarrApiKey = includeSensitive ? cfg.ArrRadarrApiKey : string.Empty,
                hasRadarrApiKey = !string.IsNullOrWhiteSpace(cfg.ArrRadarrApiKey),
                radarrRootFolderPath = cfg.ArrRadarrRootFolderPath,
                radarrQualityProfileId = cfg.ArrRadarrQualityProfileId,
                radarrSearchOnRequest = cfg.ArrRadarrSearchOnRequest,
                radarr4KEnabled = cfg.ArrRadarr4KEnabled,
                radarr4KBaseUrl = cfg.ArrRadarr4KBaseUrl,
                radarr4KApiKey = includeSensitive ? cfg.ArrRadarr4KApiKey : string.Empty,
                hasRadarr4KApiKey = !string.IsNullOrWhiteSpace(cfg.ArrRadarr4KApiKey),
                radarr4KRootFolderPath = cfg.ArrRadarr4KRootFolderPath,
                radarr4KQualityProfileId = cfg.ArrRadarr4KQualityProfileId,
                radarr4KSearchOnRequest = cfg.ArrRadarr4KSearchOnRequest
            };

        private static JMSFusionConfiguration GetConfig()
            => JMSFusionPlugin.Instance?.Configuration ?? throw new InvalidOperationException("Config not available.");

        private (User? User, Guid UserId, IActionResult? Result) TryGetAdminUser()
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck;
            }

            if (!IsAdminUser(userCheck.User))
            {
                return (null, Guid.Empty, StatusCode(403, new { ok = false, error = "This action is only available to administrators." }));
            }

            return userCheck;
        }

        private (User? User, Guid UserId, IActionResult? Result) TryGetRequestUser()
        {
            if (!TryGetRequestUserId(out var userId))
            {
                return (null, Guid.Empty, Unauthorized(new { ok = false, error = "X-Emby-UserId is required." }));
            }

            var user = _users.GetUserById(userId);
            if (user is null)
            {
                return (null, Guid.Empty, Unauthorized(new { ok = false, error = "User not found." }));
            }

            return (user, userId, null);
        }

        // Fork ParticularFlix 4.0.0.11: identidade so pela claim do token validado pelo Jellyfin (RequestAuth). O cabecalho
        // X-Emby-UserId (e o ?userId=) qualquer cliente escreve, e estas rotas nao exigem login: com o ID do admin, mesmo sem
        // conta, dava para agir como admin (ler chaves do Radarr/Sonarr, pedir filmes, mudar configuracoes).
        private bool TryGetRequestUserId(out Guid userId)
        {
            return RequestAuth.TryGetAuthenticatedUserId(HttpContext, out userId);
        }

        private static bool IsAdminUser(User? user)
        {
            return user?.Permissions.Any(permission =>
                permission.Kind == PermissionKind.IsAdministrator && permission.Value) == true;
        }

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }

        private static string NormalizeBaseUrlForStorage(string? value)
            => (value ?? string.Empty).Trim().TrimEnd('/');

        private static string NormalizeSecret(string? value)
            => (value ?? string.Empty).Trim();

        private static string CleanText(string? value, int max)
        {
            var clean = string.Join(" ", (value ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));
            return clean.Length > max ? clean[..max] : clean;
        }

        private static string CleanKey(string? value)
            => new((value ?? string.Empty)
                .Trim()
                .ToLowerInvariant()
                .Where(ch => char.IsLetterOrDigit(ch) || char.IsWhiteSpace(ch))
                .ToArray());

        private static string NormalizeArrPath(string? value)
            => (value ?? string.Empty).Trim().TrimEnd('/', '\\');

        private static bool Same(string? left, string? right)
            => string.Equals(left ?? string.Empty, right ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        private static string BuildQueryString(Dictionary<string, string> values)
            => string.Join("&", values.Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));

        private static bool IsRadarrSequenceError(string? value)
            => (value ?? string.Empty).Contains("Sequence contains no matching element", StringComparison.OrdinalIgnoreCase);

        private static bool MatchesYear(JsonElement item, int? year)
        {
            if (!year.HasValue || year.Value <= 0) return true;
            return TryReadInt(item, "year", out var itemYear) && itemYear == year.Value;
        }

        private static bool TryReadInt(JsonElement source, string property, out int value)
        {
            value = 0;
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) return false;
            if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out value)) return true;
            if (el.ValueKind == JsonValueKind.String && int.TryParse(el.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value)) return true;
            return false;
        }

        private static string ReadString(JsonElement source, string property)
        {
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) return string.Empty;
            return el.ValueKind == JsonValueKind.String ? (el.GetString() ?? string.Empty) : string.Empty;
        }

        private static int ReadIntValue(JsonElement source, string property)
            => TryReadInt(source, property, out var value) ? value : 0;

        private static long ReadLongValue(JsonElement source, string property)
        {
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) return 0;
            if (el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out var value)) return value;
            if (el.ValueKind == JsonValueKind.String && long.TryParse(el.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value)) return value;
            return 0;
        }

        private static bool ReadBool(JsonElement source, string property)
        {
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) return false;
            if (el.ValueKind == JsonValueKind.True) return true;
            if (el.ValueKind == JsonValueKind.False) return false;
            return el.ValueKind == JsonValueKind.String && bool.TryParse(el.GetString(), out var value) && value;
        }

        private static bool TryReadObject(JsonElement source, string property, out JsonElement value)
        {
            value = default;
            return source.ValueKind == JsonValueKind.Object &&
                   source.TryGetProperty(property, out value) &&
                   value.ValueKind == JsonValueKind.Object;
        }

        private static bool TryReadDateAny(JsonElement source, out DateTimeOffset value, params string[] properties)
        {
            value = default;
            if (source.ValueKind != JsonValueKind.Object) return false;
            foreach (var property in properties)
            {
                if (!source.TryGetProperty(property, out var el)) continue;
                if (el.ValueKind == JsonValueKind.String)
                {
                    var raw = el.GetString();
                    if (string.IsNullOrWhiteSpace(raw)) continue;
                    if (DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out value))
                    {
                        return true;
                    }
                    if (DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dt))
                    {
                        value = new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc));
                        return true;
                    }
                }
            }

            return false;
        }

        private static string ReadStringAny(JsonElement source, params string[] properties)
        {
            foreach (var property in properties)
            {
                var value = ReadString(source, property);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }

            return string.Empty;
        }

        private static string ReadArrImageUrl(JsonElement item)
        {
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("images", out var images) || images.ValueKind != JsonValueKind.Array) return string.Empty;
            var fallback = string.Empty;
            foreach (var image in images.EnumerateArray())
            {
                if (image.ValueKind != JsonValueKind.Object) continue;
                var url = ReadStringAny(image, "remoteUrl", "url");
                if (string.IsNullOrWhiteSpace(url)) continue;
                if (string.IsNullOrWhiteSpace(fallback)) fallback = url;
                if (Same(ReadStringAny(image, "coverType"), "poster")) return url;
            }

            return fallback;
        }

        private static string? ExtractError(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Array)
                {
                    var first = root.EnumerateArray().FirstOrDefault();
                    if (first.ValueKind == JsonValueKind.Object)
                    {
                        var msg = ReadString(first, "errorMessage");
                        if (!string.IsNullOrWhiteSpace(msg)) return msg;
                    }
                }

                if (root.ValueKind == JsonValueKind.Object)
                {
                    var message = ReadString(root, "message");
                    if (!string.IsNullOrWhiteSpace(message)) return message;
                    var error = ReadString(root, "error");
                    if (!string.IsNullOrWhiteSpace(error)) return error;
                }
            }
            catch {}

            return raw.Length > 500 ? raw[..500] : raw;
        }

        private sealed class ArrCalendarItem
        {
            public string Id { get; init; } = string.Empty;
            public string Service { get; init; } = string.Empty;
            public string MediaType { get; init; } = string.Empty;
            public string Title { get; init; } = string.Empty;
            public string Subtitle { get; init; } = string.Empty;
            public DateTimeOffset SortDate { get; init; }
            public string Date { get; init; } = string.Empty;
            public string Status { get; init; } = string.Empty;
            public string ReleaseType { get; init; } = string.Empty;
            public bool Monitored { get; init; }
            public bool HasFile { get; init; }
            public int TmdbId { get; init; }
            public int? TvdbId { get; init; }
            public string ImdbId { get; init; } = string.Empty;
            public string Overview { get; init; } = string.Empty;
            public string PosterUrl { get; init; } = string.Empty;
            public string ArrUrl { get; init; } = string.Empty;
        }

        private readonly struct ArrCallResult
        {
            public bool Ok { get; init; }
            public int StatusCode { get; init; }
            public JsonElement Payload { get; init; }
            public string Error { get; init; }

            public static ArrCallResult Success(int statusCode, JsonElement payload)
                => new() { Ok = true, StatusCode = statusCode, Payload = payload, Error = string.Empty };

            public static ArrCallResult Fail(int statusCode, string error)
                => new() { Ok = false, StatusCode = statusCode, Payload = default, Error = error };
        }

        private readonly struct SonarrEpisodeResult
        {
            public bool Ok { get; init; }
            public int StatusCode { get; init; }
            public string Error { get; init; }
            public int SeriesId { get; init; }
            public int EpisodeId { get; init; }
            public int? CommandId { get; init; }
            public bool AddedSeries { get; init; }

            public static SonarrEpisodeResult Success(int seriesId, int episodeId, int? commandId, bool addedSeries)
                => new() { Ok = true, StatusCode = 200, Error = string.Empty, SeriesId = seriesId, EpisodeId = episodeId, CommandId = commandId, AddedSeries = addedSeries };

            public static SonarrEpisodeResult Fail(int statusCode, string error)
                => new() { Ok = false, StatusCode = statusCode, Error = error };
        }

        private readonly struct RadarrMovieResult
        {
            public bool Ok { get; init; }
            public int StatusCode { get; init; }
            public string Error { get; init; }
            public int MovieId { get; init; }
            public int? CommandId { get; init; }
            public bool AddedMovie { get; init; }

            public static RadarrMovieResult Success(int movieId, int? commandId, bool addedMovie)
                => new() { Ok = true, StatusCode = 200, Error = string.Empty, MovieId = movieId, CommandId = commandId, AddedMovie = addedMovie };

            public static RadarrMovieResult Fail(int statusCode, string error)
                => new() { Ok = false, StatusCode = statusCode, Error = error };
        }
    }
}
