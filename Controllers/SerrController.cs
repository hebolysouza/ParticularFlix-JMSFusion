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
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("MonWUI/serr")]
    [Route("MonWUI/seerr")]
    [Route("Plugins/MonWUI/serr")]
    [Route("Plugins/MonWUI/seerr")]
    public class SerrController : ControllerBase
    {
        private static readonly object SyncRoot = new();
        private static readonly HttpClient Http = new();
        private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
        {
            WriteIndented = false
        };
        private const int MaxStoredRequests = 300;
        private const int MaxSyncPerListCall = 40;
        private const int MaxTitleLength = 180;
        private const int SerrListSyncCacheMs = 15_000;
        private const int LocalAvailabilityScanCacheMs = 20_000;
        private const int ArrQueueCacheMs = 2_000;
        private const int ArrLookupCacheMs = 60_000;
        private const int MaxSerrRequestLookupPages = 10;
        private static readonly object ArrRecordsCacheRoot = new();
        private static readonly Dictionary<string, ArrRecordCacheEntry> ArrRecordsCache = new(StringComparer.OrdinalIgnoreCase);
        private static readonly Dictionary<string, Task<List<JsonElement>>> ArrRecordsInFlight = new(StringComparer.OrdinalIgnoreCase);
        private static long LastSerrListSyncAtUtc;
        private static long LastLocalAvailabilityScanAtUtc;

        private readonly IUserManager _users;
        private readonly ILibraryManager _libraryManager;

        public SerrController(IUserManager users, ILibraryManager libraryManager)
        {
            _users = users;
            _libraryManager = libraryManager;
        }

        public sealed class SerrSettingsRequest
        {
            public bool? Enabled { get; set; }
            public string? BaseUrl { get; set; }
            public string? ApiKey { get; set; }
            public string? DefaultLanguage { get; set; }
            public bool? RequestAsJellyfinUser { get; set; }
            public bool? ConfirmRequests { get; set; }
            public bool? ShowMissingSearchButton { get; set; }
            public bool? EnableNotifications { get; set; }
            public bool? Enable4KRequests { get; set; }
        }

        public sealed class SerrCreateRequest
        {
            public string? MediaType { get; set; }
            public int? MediaId { get; set; }
            public int? TvdbId { get; set; }
            public List<int>? Seasons { get; set; }
            public List<SerrEpisodeSelectionRequest>? Episodes { get; set; }
            public bool? RequestAllSeasons { get; set; }
            public bool? Is4K { get; set; }
            public string? Title { get; set; }
            public string? Source { get; set; }
            public string? JellyfinItemId { get; set; }
        }

        public sealed class SerrEpisodeSelectionRequest
        {
            public int? SeasonNumber { get; set; }
            public int? EpisodeNumber { get; set; }
            public string? Name { get; set; }
        }

        [HttpGet("access")]
        public IActionResult GetAccess()
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var cfg = GetConfig();
            var isAdmin = IsAdminUser(userCheck.User);
            NoCache();
            return Ok(new
            {
                ok = true,
                isAdmin,
                enabled = IsSerrConnectionConfigured(cfg) || IsAnyArrRequestConfigured(cfg),
                serrEnabled = IsSerrConnectionConfigured(cfg),
                arrEnabled = IsAnyArrRequestConfigured(cfg),
                arrRadarrEnabled = IsRadarrRequestConfigured(cfg),
                arrSonarrEnabled = IsSonarrRequestConfigured(cfg),
                arrRadarr4KEnabled = cfg.SerrEnable4KRequests && IsRadarr4KRequestConfigured(cfg),
                arrSonarr4KEnabled = cfg.SerrEnable4KRequests && IsSonarr4KRequestConfigured(cfg),
                settings = BuildSettingsPayload(cfg, isAdmin)
            });
        }

        [HttpGet("settings")]
        public IActionResult GetSettings()
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            NoCache();
            return Ok(new
            {
                ok = true,
                settings = BuildSettingsPayload(cfg, includeSensitive: true)
            });
        }

        [HttpPost("settings")]
        public IActionResult SaveSettings([FromBody] SerrSettingsRequest? request)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;

            if (request?.Enabled.HasValue == true) cfg.EnableSerrIntegration = request.Enabled.Value;
            if (request?.BaseUrl is not null) cfg.SerrBaseUrl = NormalizeBaseUrlForStorage(request.BaseUrl);
            if (request?.ApiKey is not null) cfg.SerrApiKey = NormalizeSecret(request.ApiKey);
            if (request?.DefaultLanguage is not null) cfg.SerrDefaultLanguage = NormalizeLanguage(request.DefaultLanguage);
            if (request?.RequestAsJellyfinUser.HasValue == true) cfg.SerrRequestAsJellyfinUser = request.RequestAsJellyfinUser.Value;
            if (request?.ConfirmRequests.HasValue == true) cfg.SerrConfirmRequests = request.ConfirmRequests.Value;
            if (request?.ShowMissingSearchButton.HasValue == true) cfg.SerrShowMissingSearchButton = request.ShowMissingSearchButton.Value;
            if (request?.EnableNotifications.HasValue == true) cfg.SerrEnableNotifications = request.EnableNotifications.Value;
            if (request?.Enable4KRequests.HasValue == true) cfg.SerrEnable4KRequests = request.Enable4KRequests.Value;
            if (cfg.SerrEnable4KRequests) cfg.SerrConfirmRequests = true;

            SerrRequestStore.Save(cfg);
            TouchSerr(cfg);
            plugin.UpdateConfiguration(cfg);

            NoCache();
            return Ok(new
            {
                ok = true,
                settings = BuildSettingsPayload(cfg, includeSensitive: true)
            });
        }

        [HttpPost("test")]
        public async Task<IActionResult> TestConnection(CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            var guard = EnsureConfigured(cfg);
            if (guard is not null) return guard;

            var response = await SendSerrAsync(cfg, HttpMethod.Get, "/settings/about", null, cancellationToken);
            if (!response.Ok)
            {
                return StatusCode(502, new
                {
                    ok = false,
                    error = response.Error,
                    status = response.StatusCode
                });
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                about = response.Payload
            });
        }

        [HttpGet("search")]
        public async Task<IActionResult> Search([FromQuery] string? query, [FromQuery] int page = 1, [FromQuery] string? language = null, CancellationToken cancellationToken = default)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var cfg = GetConfig();
            var q = CleanText(query, 120);
            if (string.IsNullOrWhiteSpace(q))
            {
                return BadRequest(new { ok = false, error = "Search query is required." });
            }

            var guard = EnsureConfigured(cfg);
            if (guard is not null)
            {
                var arrResults = await SearchArrFallback(cfg, q, cancellationToken);
                if (arrResults.Count == 0 && !IsAnyArrSearchConfigured(cfg)) return guard;
                NoCache();
                return Ok(new
                {
                    page = Math.Max(1, page),
                    results = arrResults,
                    totalResults = arrResults.Count,
                    totalPages = 1
                });
            }

            var qs = new Dictionary<string, string>
            {
                ["query"] = q,
                ["page"] = Math.Max(1, page).ToString(CultureInfo.InvariantCulture)
            };
            var lang = NormalizeLanguage(string.IsNullOrWhiteSpace(language) ? cfg.SerrDefaultLanguage : language);
            if (!string.IsNullOrWhiteSpace(lang)) qs["language"] = lang;

            var response = await SendSerrAsync(cfg, HttpMethod.Get, "/search?" + BuildQueryString(qs), null, cancellationToken);
            if (!response.Ok)
            {
                return StatusCode(502, new
                {
                    ok = false,
                    error = response.Error,
                    status = response.StatusCode
                });
            }

            NoCache();
            return Ok(response.Payload);
        }

        [HttpGet("metadata/tv/{id:int}")]
        public async Task<IActionResult> GetTvMetadata(int id, [FromQuery] string? language = null, CancellationToken cancellationToken = default)
        {
            return await ProxySerrMetadata("/tv/" + id.ToString(CultureInfo.InvariantCulture), language, cancellationToken);
        }

        [HttpGet("metadata/tv/{id:int}/season/{seasonNumber:int}")]
        public async Task<IActionResult> GetTvSeasonMetadata(int id, int seasonNumber, [FromQuery] string? language = null, CancellationToken cancellationToken = default)
        {
            return await ProxySerrMetadata(
                "/tv/" + id.ToString(CultureInfo.InvariantCulture) + "/season/" + seasonNumber.ToString(CultureInfo.InvariantCulture),
                language,
                cancellationToken);
        }

        [HttpGet("metadata/movie/{id:int}")]
        public async Task<IActionResult> GetMovieMetadata(int id, [FromQuery] string? language = null, CancellationToken cancellationToken = default)
        {
            return await ProxySerrMetadata("/movie/" + id.ToString(CultureInfo.InvariantCulture), language, cancellationToken);
        }

        [HttpGet("metadata/collection/{id:int}")]
        public async Task<IActionResult> GetCollectionMetadata(int id, [FromQuery] string? language = null, CancellationToken cancellationToken = default)
        {
            return await ProxySerrMetadata("/collection/" + id.ToString(CultureInfo.InvariantCulture), language, cancellationToken);
        }

        [HttpGet("metadata/collection/search")]
        public async Task<IActionResult> SearchCollectionMetadata([FromQuery] string? query, [FromQuery] int page = 1, [FromQuery] string? language = null, CancellationToken cancellationToken = default)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var q = CleanText(query, 120);
            if (string.IsNullOrWhiteSpace(q))
            {
                return BadRequest(new { ok = false, error = "Search query is required." });
            }

            var cfg = GetConfig();
            var lang = NormalizeLanguage(string.IsNullOrWhiteSpace(language) ? cfg.SerrDefaultLanguage : language);
            var tmdb = await SearchTmdbCollections(cfg, q, page, lang, cancellationToken);
            if (tmdb is not null)
            {
                NoCache();
                return Ok(tmdb);
            }

            if (IsSerrConnectionConfigured(cfg))
            {
                var qs = new Dictionary<string, string>
                {
                    ["query"] = q,
                    ["page"] = Math.Max(1, page).ToString(CultureInfo.InvariantCulture)
                };
                if (!string.IsNullOrWhiteSpace(lang)) qs["language"] = lang;

                var response = await SendSerrAsync(cfg, HttpMethod.Get, "/search?" + BuildQueryString(qs), null, cancellationToken);
                if (response.Ok && response.Payload.ValueKind == JsonValueKind.Object)
                {
                    var results = ReadArray(response.Payload, "results", "Results")
                        .Where(item => Same(ReadStringAny(item, "mediaType", "media_type"), "collection"))
                        .Select(ToCollectionSearchDto)
                        .Where(item => item is not null)
                        .Cast<object>()
                        .ToList();
                    NoCache();
                    return Ok(new
                    {
                        page = Math.Max(1, page),
                        results,
                        totalResults = results.Count,
                        totalPages = results.Count > 0 ? 1 : 0
                    });
                }
            }

            NoCache();
            return Ok(new
            {
                page = Math.Max(1, page),
                results = Array.Empty<object>(),
                totalResults = 0,
                totalPages = 0
            });
        }

        [HttpGet("local/tmdb/{id:int}")]
        public IActionResult GetLocalByTmdbId(int id)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            if (id <= 0)
            {
                return BadRequest(new { ok = false, error = "TMDb id is required." });
            }

            var items = FindJellyfinItemsByTmdb(id)
                .Select(ToLocalSearchDto)
                .ToList();

            NoCache();
            return Ok(new
            {
                ok = true,
                tmdbId = id,
                items
            });
        }

        [HttpPost("request")]
        public async Task<IActionResult> CreateRequest([FromBody] SerrCreateRequest? request, CancellationToken cancellationToken)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var cfg = GetConfig();
            var validationError = ValidateRequest(request);
            if (validationError is not null) return validationError;

            if (request?.Is4K == true && !cfg.SerrEnable4KRequests)
            {
                return StatusCode(403, new { ok = false, error = "4K requests are disabled." });
            }

            var guard = EnsureRequestBackendConfigured(cfg, request!);
            if (guard is not null) return guard;

            var availabilityError = ValidateJellyfinAvailability(request!);
            if (availabilityError is not null) return availabilityError;

            var isAdmin = IsAdminUser(userCheck.User);
            var now = NowMs();
            SerrRequestEntry entry;

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                cfg = plugin.Configuration;
                SerrRequestStore.Save(cfg);
                NormalizeSerrRequests(cfg);

                var existing = FindBlockingDuplicate(cfg, request!);
                if (existing is not null)
                {
                    NoCache();
                    return Ok(new
                    {
                        ok = true,
                        duplicate = true,
                        duplicateOwnedByCurrentUser = Same(existing.JellyfinUserId, userCheck.UserId.ToString("D")),
                        duplicateStatus = existing.Status,
                        message = BuildDuplicateMessage(existing, userCheck.UserId),
                        pendingApproval = string.Equals(existing.Status, "pending", StringComparison.OrdinalIgnoreCase),
                        request = ToRequestDto(existing, isAdmin)
                    });
                }

                entry = BuildEntry(request!, userCheck.User, userCheck.UserId, isAdmin, now);
                cfg.SerrRequests.Insert(0, entry);
                PruneRequests(cfg);
                TouchSerr(cfg);
                SerrRequestStore.Save(cfg);
                plugin.UpdateConfiguration(cfg);
            }

            RequestSubmissionResult submission = default;
            if (isAdmin)
            {
                submission = await SubmitAndPersist(entry.Id, userCheck.UserId, cancellationToken);
            }

            var updated = GetRequestById(entry.Id) ?? entry;
            NoCache();
            return Ok(new
            {
                ok = string.IsNullOrWhiteSpace(updated.Error),
                pendingApproval = !isAdmin,
                request = ToRequestDto(updated, isAdmin),
                backend = string.IsNullOrWhiteSpace(submission.Backend) ? null : submission.Backend,
                service = string.IsNullOrWhiteSpace(submission.Service) ? null : submission.Service,
                error = string.IsNullOrWhiteSpace(updated.Error) ? null : updated.Error
            });
        }

        [HttpGet("requests")]
        public async Task<IActionResult> GetRequests(
            [FromQuery] bool includeHistory = false,
            [FromQuery] bool includeDownloads = true,
            CancellationToken cancellationToken = default)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var cfg = GetConfig();
            if (SerrRequestStore.Save(cfg))
            {
                JMSFusionPlugin.Instance.UpdateConfiguration(cfg);
            }
            var isAdmin = IsAdminUser(userCheck.User);

            if (includeDownloads &&
                cfg.EnableSerrIntegration &&
                !string.IsNullOrWhiteSpace(cfg.SerrBaseUrl) &&
                !string.IsNullOrWhiteSpace(cfg.SerrApiKey) &&
                ShouldRunSerrListSync())
            {
                await SyncActiveRequests(cancellationToken);
                await SyncExternalSerrRequests(cancellationToken);
                cfg = GetConfig();
            }
            if (includeDownloads && ShouldRunLocalAvailabilityScan() && CompleteLocallyAvailableRequests())
            {
                cfg = GetConfig();
            }

            var userId = userCheck.UserId.ToString("D");
            var visibleBase = (cfg.SerrRequests ?? new List<SerrRequestEntry>())
                .Where(entry => isAdmin || Same(entry.JellyfinUserId, userId))
                .OrderByDescending(entry => entry.UpdatedAtUtc > 0 ? entry.UpdatedAtUtc : entry.CreatedAtUtc)
                .ToList();
            var downloads = includeDownloads
                ? await ResolveArrDownloadSnapshots(visibleBase, cfg, cancellationToken)
                : new Dictionary<string, ArrDownloadSnapshot>(StringComparer.OrdinalIgnoreCase);
            var requests = visibleBase
                .Where(entry => includeHistory || !IsTerminalHiddenForDisplay(entry, downloads.GetValueOrDefault(entry.Id)))
                .Select(entry => ToRequestDto(entry, isAdmin, downloads.GetValueOrDefault(entry.Id)))
                .ToList();

            NoCache();
            return Ok(new
            {
                ok = true,
                isAdmin,
                enabled = cfg.EnableSerrIntegration,
                downloadsIncluded = includeDownloads,
                requests,
                revision = cfg.SerrRequestsRevision
            });
        }

        [HttpPost("requests/{id}/withdraw")]
        public async Task<IActionResult> WithdrawRequest(string id, CancellationToken cancellationToken)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var isAdmin = IsAdminUser(userCheck.User);
            SerrRequestEntry? entry;
            lock (SyncRoot)
            {
                var cfg = GetConfig();
                SerrRequestStore.Save(cfg);
                var found = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, id));
                entry = found is null ? null : CloneEntry(found);
            }

            if (entry is null)
            {
                return NotFound(new { ok = false, error = "Request not found." });
            }

            if (!isAdmin && !Same(entry.JellyfinUserId, userCheck.UserId.ToString("D")))
            {
                return StatusCode(403, new { ok = false, error = "You can only withdraw your own requests." });
            }

            if (!isAdmin && !Same(entry.Status, "pending"))
            {
                return StatusCode(409, new { ok = false, error = "Only pending requests can be withdrawn by the requester." });
            }

            var warnings = new List<string>();
            if (isAdmin)
            {
                var cfgForDelete = GetConfig();

                var serrWarning = await WithdrawFromSerr(cfgForDelete, entry, cancellationToken);
                if (!string.IsNullOrWhiteSpace(serrWarning)) warnings.Add(serrWarning);

                var arrWarning = await WithdrawFromArr(cfgForDelete, entry, cancellationToken);
                if (!string.IsNullOrWhiteSpace(arrWarning)) warnings.Add(arrWarning);
            }

            var warning = string.Join(" | ", warnings.Where(value => !string.IsNullOrWhiteSpace(value)));
            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                SerrRequestStore.Save(cfg);
                entry = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, id));
                if (entry is null)
                {
                    return NotFound(new { ok = false, error = "Request not found." });
                }

                entry.Status = "withdrawn";
                entry.Error = warning;
                entry.UpdatedAtUtc = NowMs();
                TouchSerr(cfg);
                SerrRequestStore.Save(cfg);
                plugin.UpdateConfiguration(cfg);
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                warning = string.IsNullOrWhiteSpace(warning) ? null : warning,
                request = ToRequestDto(entry!, includeAdminFields: isAdmin)
            });
        }

        [HttpPost("requests/{id}/approve")]
        public async Task<IActionResult> ApproveRequest(string id, CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var entry = GetRequestById(id);
            if (entry is null)
            {
                return NotFound(new { ok = false, error = "Request not found." });
            }

            var blocker = FindBlockingDuplicate(entry, includePending: false);
            if (blocker is not null)
            {
                NoCache();
                return StatusCode(409, new
                {
                    ok = false,
                    duplicate = true,
                    duplicateOwnedByCurrentUser = Same(blocker.JellyfinUserId, adminCheck.UserId.ToString("D")),
                    duplicateStatus = blocker.Status,
                    error = BuildDuplicateMessage(blocker, adminCheck.UserId),
                    request = ToRequestDto(blocker, includeAdminFields: true)
                });
            }

            RequestSubmissionResult submission;
            if (entry.SerrRequestId.HasValue && entry.SerrRequestId.Value > 0)
            {
                submission = await UpdateExistingSerrRequestAndPersist(entry.Id, "approve", cancellationToken);
            }
            else
            {
                submission = await SubmitAndPersist(entry.Id, adminCheck.UserId, cancellationToken);
            }
            entry = GetRequestById(id) ?? entry;

            NoCache();
            return Ok(new
            {
                ok = string.IsNullOrWhiteSpace(entry.Error),
                request = ToRequestDto(entry, includeAdminFields: true),
                backend = string.IsNullOrWhiteSpace(submission.Backend) ? null : submission.Backend,
                service = string.IsNullOrWhiteSpace(submission.Service) ? null : submission.Service,
                error = string.IsNullOrWhiteSpace(entry.Error) ? null : entry.Error
            });
        }

        [HttpPost("requests/{id}/upgrade4k")]
        public async Task<IActionResult> UpgradeRequestTo4K(string id, CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var cfg = GetConfig();
            if (!cfg.SerrEnable4KRequests)
            {
                return StatusCode(403, new { ok = false, error = "4K requests are disabled." });
            }

            var entry = GetRequestById(id);
            if (entry is null)
            {
                return NotFound(new { ok = false, error = "Request not found." });
            }

            if (entry.Is4K)
            {
                NoCache();
                return Ok(new { ok = true, request = ToRequestDto(entry, includeAdminFields: true) });
            }

            if (!CanUpgradeTo4K(entry))
            {
                return StatusCode(409, new { ok = false, error = "This request cannot be converted to 4K." });
            }

            var upgradeEntry = CloneEntry(entry);
            upgradeEntry.Is4K = true;
            if (!CanSubmitTo4KBackend(cfg, upgradeEntry))
            {
                return StatusCode(412, new { ok = false, error = "No configured 4K Seerr or Arr backend can handle this request." });
            }

            var blocker = FindBlockingDuplicate(upgradeEntry, includePending: true);
            if (blocker is not null)
            {
                NoCache();
                return StatusCode(409, new
                {
                    ok = false,
                    duplicate = true,
                    duplicateOwnedByCurrentUser = Same(blocker.JellyfinUserId, adminCheck.UserId.ToString("D")),
                    duplicateStatus = blocker.Status,
                    error = BuildDuplicateMessage(blocker, adminCheck.UserId),
                    request = ToRequestDto(blocker, includeAdminFields: true)
                });
            }

            if (Same(entry.Status, "pending"))
            {
                lock (SyncRoot)
                {
                    var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                    cfg = plugin.Configuration;
                    SerrRequestStore.Save(cfg);
                    var current = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, id));
                    if (current is null)
                    {
                        return NotFound(new { ok = false, error = "Request not found." });
                    }

                    current.Is4K = true;
                    current.Error = string.Empty;
                    current.UpdatedAtUtc = NowMs();
                    TouchSerr(cfg);
                    SerrRequestStore.Save(cfg);
                    plugin.UpdateConfiguration(cfg);
                    entry = CloneEntry(current);
                }

                NoCache();
                return Ok(new { ok = true, pendingApproval = true, request = ToRequestDto(entry, includeAdminFields: true) });
            }

            var cleanupWarnings = new List<string>();
            if (ShouldCleanupArrOnWithdraw(entry))
            {
                var cleanupCfg = GetConfig();
                var serrWarning = await WithdrawFromSerr(cleanupCfg, entry, cancellationToken);
                if (!string.IsNullOrWhiteSpace(serrWarning)) cleanupWarnings.Add(serrWarning);
                var arrWarning = await WithdrawFromArr(cleanupCfg, entry, cancellationToken);
                if (!string.IsNullOrWhiteSpace(arrWarning)) cleanupWarnings.Add(arrWarning);
            }

            if (cleanupWarnings.Any())
            {
                return StatusCode(502, new
                {
                    ok = false,
                    error = string.Join(" | ", cleanupWarnings)
                });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                cfg = plugin.Configuration;
                SerrRequestStore.Save(cfg);
                var current = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, id));
                if (current is null)
                {
                    return NotFound(new { ok = false, error = "Request not found." });
                }

                current.Is4K = true;
                current.Status = "approved";
                current.SerrRequestId = null;
                current.SerrMediaStatus = null;
                current.SerrRequestStatus = null;
                current.CompletedAtUtc = 0;
                current.Error = string.Empty;
                current.UpdatedAtUtc = NowMs();
                TouchSerr(cfg);
                SerrRequestStore.Save(cfg);
                plugin.UpdateConfiguration(cfg);
            }

            var submission = await SubmitAndPersist(id, adminCheck.UserId, cancellationToken, strict4KArr: true);
            entry = GetRequestById(id) ?? upgradeEntry;

            NoCache();
            return Ok(new
            {
                ok = string.IsNullOrWhiteSpace(entry.Error),
                request = ToRequestDto(entry, includeAdminFields: true),
                backend = string.IsNullOrWhiteSpace(submission.Backend) ? null : submission.Backend,
                service = string.IsNullOrWhiteSpace(submission.Service) ? null : submission.Service,
                error = string.IsNullOrWhiteSpace(entry.Error) ? null : entry.Error
            });
        }

        [HttpPost("requests/{id}/decline")]
        public async Task<IActionResult> DeclineRequest(string id, CancellationToken cancellationToken)
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var entry = GetRequestById(id);
            if (entry is null)
            {
                return NotFound(new { ok = false, error = "Request not found." });
            }

            if (entry.SerrRequestId.HasValue && entry.SerrRequestId.Value > 0)
            {
                var submission = await UpdateExistingSerrRequestAndPersist(entry.Id, "decline", cancellationToken);
                entry = GetRequestById(id) ?? entry;

                NoCache();
                return Ok(new
                {
                    ok = string.IsNullOrWhiteSpace(entry.Error),
                    request = ToRequestDto(entry, includeAdminFields: true),
                    backend = string.IsNullOrWhiteSpace(submission.Backend) ? null : submission.Backend,
                    service = string.IsNullOrWhiteSpace(submission.Service) ? null : submission.Service,
                    error = string.IsNullOrWhiteSpace(entry.Error) ? null : entry.Error
                });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                SerrRequestStore.Save(cfg);
                entry = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, id));
                if (entry is null)
                {
                    return NotFound(new { ok = false, error = "Request not found." });
                }

                entry.Status = "declined";
                entry.Error = string.Empty;
                entry.UpdatedAtUtc = NowMs();
                TouchSerr(cfg);
                SerrRequestStore.Save(cfg);
                plugin.UpdateConfiguration(cfg);
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                request = ToRequestDto(entry!, includeAdminFields: true)
            });
        }

        private async Task<IActionResult> ProxySerrMetadata(string path, string? language, CancellationToken cancellationToken)
        {
            var userCheck = TryGetRequestUser();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var cfg = GetConfig();
            var guard = EnsureConfigured(cfg);
            if (guard is not null)
            {
                var tmdb = await ProxyTmdbMetadata(cfg, path, language, cancellationToken);
                if (tmdb is not null) return tmdb;
                NoCache();
                return Ok(new { });
            }

            var qs = new Dictionary<string, string>();
            var lang = NormalizeLanguage(string.IsNullOrWhiteSpace(language) ? cfg.SerrDefaultLanguage : language);
            if (!string.IsNullOrWhiteSpace(lang)) qs["language"] = lang;

            var response = await SendSerrAsync(
                cfg,
                HttpMethod.Get,
                path + (qs.Count > 0 ? "?" + BuildQueryString(qs) : string.Empty),
                null,
                cancellationToken);

            if (!response.Ok)
            {
                var tmdb = await ProxyTmdbMetadata(cfg, path, language, cancellationToken);
                if (tmdb is not null) return tmdb;
                NoCache();
                return Ok(new { });
            }

            NoCache();
            return Ok(response.Payload);
        }

        private async Task<IActionResult?> ProxyTmdbMetadata(JMSFusionConfiguration cfg, string path, string? language, CancellationToken cancellationToken)
        {
            var apiKey = CleanText(cfg.TmdbApiKey, 200);
            if (string.IsNullOrWhiteSpace(apiKey) || Same(apiKey, "CHANGE_ME")) return null;

            var clean = (path ?? string.Empty).Trim().Trim('/');
            var parts = clean.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) return null;

            string tmdbPath;
            if (Same(parts[0], "movie") && int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var movieId) && movieId > 0)
            {
                tmdbPath = "/movie/" + movieId.ToString(CultureInfo.InvariantCulture);
            }
            else if (Same(parts[0], "collection") && int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var collectionId) && collectionId > 0)
            {
                tmdbPath = "/collection/" + collectionId.ToString(CultureInfo.InvariantCulture);
            }
            else if (Same(parts[0], "tv") && int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var tvId) && tvId > 0)
            {
                if (parts.Length >= 4 &&
                    Same(parts[2], "season") &&
                    int.TryParse(parts[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out var seasonNumber) &&
                    seasonNumber >= 0)
                {
                    tmdbPath = "/tv/" + tvId.ToString(CultureInfo.InvariantCulture) + "/season/" + seasonNumber.ToString(CultureInfo.InvariantCulture);
                }
                else
                {
                    tmdbPath = "/tv/" + tvId.ToString(CultureInfo.InvariantCulture);
                }
            }
            else
            {
                return null;
            }

            var qs = new Dictionary<string, string>
            {
                ["api_key"] = apiKey
            };
            var lang = NormalizeTmdbLanguage(language);
            if (!string.IsNullOrWhiteSpace(lang)) qs["language"] = lang;

            var response = await SendTmdbAsync(tmdbPath + "?" + BuildQueryString(qs), cancellationToken);
            NoCache();
            return response.Ok
                ? Ok(response.Payload)
                : Ok(new { });
        }

        private async Task<SerrCallResult> SendTmdbAsync(string pathAndQuery, CancellationToken cancellationToken)
        {
            try
            {
                var path = pathAndQuery.StartsWith("/", StringComparison.Ordinal) ? pathAndQuery : "/" + pathAndQuery;
                using var req = new HttpRequestMessage(HttpMethod.Get, new Uri("https://api.themoviedb.org/3" + path));
                req.Headers.TryAddWithoutValidation("Accept", "application/json");

                using var res = await Http.SendAsync(req, cancellationToken);
                var raw = await res.Content.ReadAsStringAsync(cancellationToken);
                if (!res.IsSuccessStatusCode)
                {
                    return SerrCallResult.Fail((int)res.StatusCode, ExtractError(raw) ?? $"TMDb HTTP {(int)res.StatusCode}");
                }

                if (string.IsNullOrWhiteSpace(raw)) return SerrCallResult.Success((int)res.StatusCode, default);
                using var doc = JsonDocument.Parse(raw);
                return SerrCallResult.Success((int)res.StatusCode, doc.RootElement.Clone());
            }
            catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                return SerrCallResult.Fail(0, ex.Message);
            }
        }

        private async Task<object?> SearchTmdbCollections(JMSFusionConfiguration cfg, string query, int page, string? language, CancellationToken cancellationToken)
        {
            var apiKey = CleanText(cfg.TmdbApiKey, 200);
            if (string.IsNullOrWhiteSpace(apiKey) || Same(apiKey, "CHANGE_ME")) return null;

            var qs = new Dictionary<string, string>
            {
                ["api_key"] = apiKey,
                ["query"] = query,
                ["page"] = Math.Max(1, page).ToString(CultureInfo.InvariantCulture),
                ["include_adult"] = "false"
            };
            var lang = NormalizeTmdbLanguage(language);
            if (!string.IsNullOrWhiteSpace(lang)) qs["language"] = lang;

            var response = await SendTmdbAsync("/search/collection?" + BuildQueryString(qs), cancellationToken);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Object) return null;

            var results = ReadArray(response.Payload, "results", "Results")
                .Select(ToCollectionSearchDto)
                .Where(item => item is not null)
                .Cast<object>()
                .ToList();
            var totalResults = ReadIntValue(response.Payload, "total_results");
            var totalPages = ReadIntValue(response.Payload, "total_pages");
            var resultPage = ReadIntValue(response.Payload, "page");

            return new
            {
                page = resultPage > 0 ? resultPage : Math.Max(1, page),
                results,
                totalResults = totalResults > 0 ? totalResults : results.Count,
                totalPages = totalPages > 0 ? totalPages : (results.Count > 0 ? 1 : 0)
            };
        }

        private static object? ToCollectionSearchDto(JsonElement item)
        {
            var id = ReadIntValue(item, "id");
            if (id <= 0) return null;
            var title = ReadStringAny(item, "name", "title", "originalName", "original_name");
            if (string.IsNullOrWhiteSpace(title)) return null;
            return new
            {
                id,
                mediaType = "collection",
                media_type = "collection",
                name = title,
                title,
                originalName = ReadStringAny(item, "originalName", "original_name"),
                overview = ReadStringAny(item, "overview"),
                posterPath = ReadStringAny(item, "posterPath", "poster_path"),
                backdropPath = ReadStringAny(item, "backdropPath", "backdrop_path"),
                source = "tmdb"
            };
        }

        private async Task<List<object>> SearchArrFallback(JMSFusionConfiguration cfg, string query, CancellationToken cancellationToken)
        {
            var output = new List<object>();
            var use4KRadarr = !IsRadarrSearchConfigured(cfg) && cfg.SerrEnable4KRequests && IsRadarr4KSearchConfigured(cfg);
            if (IsRadarrSearchConfigured(cfg) || use4KRadarr)
            {
                var response = await SendArrAsync(
                    RadarrBaseUrl(cfg, use4KRadarr),
                    RadarrApiKey(cfg, use4KRadarr),
                    use4KRadarr ? "4K Radarr" : "Radarr",
                    HttpMethod.Get,
                    "/movie/lookup?term=" + Uri.EscapeDataString(query),
                    null,
                    cancellationToken);
                if (response.Ok && response.Payload.ValueKind == JsonValueKind.Array)
                {
                    output.AddRange(response.Payload.EnumerateArray()
                        .Where(item => item.ValueKind == JsonValueKind.Object)
                        .Select(ToRadarrSearchDto)
                        .Where(item => item is not null)
                        .Cast<object>());
                }
            }

            var use4KSonarr = !IsSonarrSearchConfigured(cfg) && cfg.SerrEnable4KRequests && IsSonarr4KSearchConfigured(cfg);
            if (IsSonarrSearchConfigured(cfg) || use4KSonarr)
            {
                var response = await SendArrAsync(
                    SonarrBaseUrl(cfg, use4KSonarr),
                    SonarrApiKey(cfg, use4KSonarr),
                    use4KSonarr ? "4K Sonarr" : "Sonarr",
                    HttpMethod.Get,
                    "/series/lookup?term=" + Uri.EscapeDataString(query),
                    null,
                    cancellationToken);
                if (response.Ok && response.Payload.ValueKind == JsonValueKind.Array)
                {
                    output.AddRange(response.Payload.EnumerateArray()
                        .Where(item => item.ValueKind == JsonValueKind.Object)
                        .Select(ToSonarrSearchDto)
                        .Where(item => item is not null)
                        .Cast<object>());
                }
            }

            return output
                .GroupBy(item => ArrSearchKey(item), StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .Take(30)
                .ToList();
        }

        private static object? ToRadarrSearchDto(JsonElement item)
        {
            var tmdbId = ReadIntValue(item, "tmdbId");
            if (tmdbId <= 0) return null;
            var title = ReadStringAny(item, "title", "originalTitle");
            if (string.IsNullOrWhiteSpace(title)) return null;
            var year = ReadIntValue(item, "year");
            return new
            {
                id = tmdbId,
                mediaType = "movie",
                media_type = "movie",
                title,
                originalTitle = ReadStringAny(item, "originalTitle", "originalTitleSlug"),
                overview = ReadStringAny(item, "overview"),
                releaseDate = ReadStringAny(item, "releaseDate", "inCinemas", "digitalRelease", "physicalRelease"),
                posterPath = ReadArrImageUrl(item),
                year = year > 0 ? year : (int?)null,
                source = "radarr"
            };
        }

        private static object? ToSonarrSearchDto(JsonElement item)
        {
            var tvdbId = ReadIntValue(item, "tvdbId");
            var tmdbId = ReadIntValue(item, "tmdbId");
            var id = tmdbId > 0 ? tmdbId : tvdbId;
            if (id <= 0) return null;
            var title = ReadStringAny(item, "title", "sortTitle");
            if (string.IsNullOrWhiteSpace(title)) return null;
            var year = ReadIntValue(item, "year");
            return new
            {
                id,
                tvdbId = tvdbId > 0 ? tvdbId : (int?)null,
                mediaType = "tv",
                media_type = "tv",
                name = title,
                title,
                originalName = title,
                overview = ReadStringAny(item, "overview"),
                firstAirDate = ReadStringAny(item, "firstAired", "premiereDate"),
                posterPath = ReadArrImageUrl(item),
                year = year > 0 ? year : (int?)null,
                source = "sonarr"
            };
        }

        private static string ArrSearchKey(object item)
        {
            try
            {
                var json = JsonSerializer.SerializeToElement(item, JsonOptions);
                var type = ReadStringAny(json, "mediaType", "media_type");
                var id = ReadIntValue(json, "id");
                if (!string.IsNullOrWhiteSpace(type) && id > 0) return type + ":" + id.ToString(CultureInfo.InvariantCulture);
            }
            catch {}

            return Guid.NewGuid().ToString("N");
        }

        private static string ReadArrImageUrl(JsonElement item)
        {
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("images", out var images) || images.ValueKind != JsonValueKind.Array) return string.Empty;
            string fallback = string.Empty;
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

        private async Task<RequestSubmissionResult> SubmitAndPersist(
            string entryId,
            Guid adminUserId,
            CancellationToken cancellationToken,
            bool strict4KArr = false)
        {
            SerrRequestEntry? entry;
            JMSFusionConfiguration cfg;
            lock (SyncRoot)
            {
                cfg = GetConfig();
                entry = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, entryId));
            }

            if (entry is null) return default;

            var submission = await SubmitRequestBackend(cfg, entry, adminUserId, cancellationToken, strict4KArr);
            var response = submission.Response;
            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                cfg = plugin.Configuration;
                var current = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, entryId));
                if (current is null) return submission;

                if (response.Ok)
                {
                    ApplySerrResponse(current, response.Payload);
                    MarkCompletedIfLocalAvailable(current);
                    current.Error = string.Empty;
                    if (string.Equals(current.Status, "pending", StringComparison.OrdinalIgnoreCase))
                    {
                        current.Status = "approved";
                    }
                }
                else
                {
                    if (!MarkCompletedIfLocalAvailable(current))
                    {
                        current.Status = "failed";
                        current.Error = response.Error;
                    }
                }

                current.UpdatedAtUtc = NowMs();
                TouchSerr(cfg);
                SerrRequestStore.Save(cfg);
                plugin.UpdateConfiguration(cfg);
            }

            return submission;
        }

        private async Task<RequestSubmissionResult> SubmitRequestBackend(
            JMSFusionConfiguration cfg,
            SerrRequestEntry entry,
            Guid adminUserId,
            CancellationToken cancellationToken,
            bool strict4KArr = false)
        {
            var canSubmitToArr = strict4KArr ? CanSubmitTo4KArr(cfg, entry) : CanSubmitToArr(cfg, entry);
            if (IsSerrConnectionConfigured(cfg))
            {
                var serr = await SubmitToSeerr(cfg, entry, adminUserId, cancellationToken);
                if (serr.Ok || !canSubmitToArr)
                {
                    return new RequestSubmissionResult(serr, "serr", string.Empty);
                }
            }

            if (canSubmitToArr)
            {
                return await SubmitToArr(cfg, entry, cancellationToken);
            }

            return new RequestSubmissionResult(
                SerrCallResult.Fail(412, "No configured Seerr or Arr backend can handle this request."),
                string.Empty,
                string.Empty);
        }

        private async Task<RequestSubmissionResult> SubmitToArr(
            JMSFusionConfiguration cfg,
            SerrRequestEntry entry,
            CancellationToken cancellationToken)
        {
            if (Same(entry.MediaType, "movie"))
            {
                return await SubmitMovieToRadarr(cfg, entry, cancellationToken);
            }

            if (Same(entry.MediaType, "tv"))
            {
                return await SubmitSeriesToSonarr(cfg, entry, cancellationToken);
            }

            return new RequestSubmissionResult(
                SerrCallResult.Fail(400, "Arr can only handle movie or tv requests."),
                "arr",
                string.Empty);
        }

        private async Task<string> WithdrawFromSerr(JMSFusionConfiguration cfg, SerrRequestEntry entry, CancellationToken cancellationToken)
        {
            if (entry is null || !IsSerrConnectionConfigured(cfg)) return string.Empty;

            var requestIds = new List<int>();
            if (entry.SerrRequestId.HasValue && entry.SerrRequestId.Value > 0)
            {
                requestIds.Add(entry.SerrRequestId.Value);
            }
            else
            {
                var lookup = await FindMatchingSerrRequestIds(cfg, entry, cancellationToken);
                if (!string.IsNullOrWhiteSpace(lookup.Error)) return "Seerr: " + lookup.Error;
                requestIds.AddRange(lookup.Ids);
            }

            var warnings = new List<string>();
            foreach (var requestId in requestIds.Where(id => id > 0).Distinct())
            {
                var delete = await SendSerrAsync(
                    cfg,
                    HttpMethod.Delete,
                    "/request/" + requestId.ToString(CultureInfo.InvariantCulture),
                    null,
                    cancellationToken);
                if (!delete.Ok)
                {
                    warnings.Add("#" + requestId.ToString(CultureInfo.InvariantCulture) + ": " + delete.Error);
                }
            }

            return warnings.Any() ? "Seerr: " + string.Join(" | ", warnings) : string.Empty;
        }

        private async Task<(List<int> Ids, string Error)> FindMatchingSerrRequestIds(
            JMSFusionConfiguration cfg,
            SerrRequestEntry entry,
            CancellationToken cancellationToken)
        {
            var records = await FetchSerrRequestRecords(cfg, cancellationToken);
            if (!string.IsNullOrWhiteSpace(records.Error)) return (new List<int>(), records.Error);

            var ids = records.Records
                .Where(record => SerrRequestMatchesEntry(record, entry))
                .Select(record => ReadIntValue(record, "id"))
                .Where(id => id > 0)
                .Distinct()
                .ToList();

            return (ids, string.Empty);
        }

        private async Task<RequestSubmissionResult> UpdateExistingSerrRequestAndPersist(
            string entryId,
            string action,
            CancellationToken cancellationToken)
        {
            SerrRequestEntry? entry;
            JMSFusionConfiguration cfg;
            lock (SyncRoot)
            {
                cfg = GetConfig();
                entry = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, entryId)) is { } found
                    ? CloneEntry(found)
                    : null;
            }

            if (entry is null || !entry.SerrRequestId.HasValue || entry.SerrRequestId.Value <= 0)
            {
                return new RequestSubmissionResult(
                    SerrCallResult.Fail(404, "Request not found."),
                    string.Empty,
                    string.Empty);
            }

            if (!IsSerrConnectionConfigured(cfg))
            {
                return new RequestSubmissionResult(
                    SerrCallResult.Fail(412, "Seerr URL and API key are required."),
                    "serr",
                    string.Empty);
            }

            var response = await SendSerrRequestAction(cfg, entry.SerrRequestId.Value, action, cancellationToken);
            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                cfg = plugin.Configuration;
                var current = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, entryId));
                if (current is null) return new RequestSubmissionResult(response, "serr", string.Empty);

                if (response.Ok)
                {
                    ApplySerrResponsePayload(current, response.Payload);
                    if (Same(action, "approve") && Same(current.Status, "pending"))
                    {
                        current.Status = "approved";
                    }
                    else if (Same(action, "decline"))
                    {
                        current.Status = "declined";
                    }
                    MarkCompletedIfLocalAvailable(current);
                    current.Error = string.Empty;
                }
                else
                {
                    current.Error = response.Error;
                }

                current.UpdatedAtUtc = NowMs();
                TouchSerr(cfg);
                SerrRequestStore.Save(cfg);
                plugin.UpdateConfiguration(cfg);
            }

            return new RequestSubmissionResult(response, "serr", string.Empty);
        }

        private async Task<SerrCallResult> SendSerrRequestAction(
            JMSFusionConfiguration cfg,
            int requestId,
            string action,
            CancellationToken cancellationToken)
        {
            var cleanAction = Same(action, "decline") ? "decline" : "approve";
            var id = requestId.ToString(CultureInfo.InvariantCulture);
            var response = await SendSerrAsync(cfg, HttpMethod.Post, "/request/" + id + "/" + cleanAction, null, cancellationToken);
            if (response.Ok || !Same(cleanAction, "approve")) return response;

            return await SendSerrAsync(cfg, HttpMethod.Post, "/request/" + id + "/retry", null, cancellationToken);
        }

        private async Task SyncExternalSerrRequests(CancellationToken cancellationToken)
        {
            JMSFusionConfiguration cfg;
            Dictionary<int, string> knownTitles;
            lock (SyncRoot)
            {
                cfg = GetConfig();
                if (!IsSerrConnectionConfigured(cfg)) return;
                knownTitles = (cfg.SerrRequests ?? new List<SerrRequestEntry>())
                    .Where(entry =>
                        entry.SerrRequestId.HasValue &&
                        entry.SerrRequestId.Value > 0 &&
                        !IsGeneratedSerrTitle(entry.Title, entry.SerrRequestId.Value))
                    .GroupBy(entry => entry.SerrRequestId!.Value)
                    .ToDictionary(group => group.Key, group => group.First().Title);
            }

            var recordsResult = await FetchSerrRequestRecords(cfg, cancellationToken);
            if (!string.IsNullOrWhiteSpace(recordsResult.Error) || !recordsResult.Records.Any()) return;
            var resolvedTitles = await ResolveSerrRequestTitles(cfg, recordsResult.Records, knownTitles, cancellationToken);

            var changed = false;
            var now = NowMs();
            var usedLocalIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                cfg = plugin.Configuration;
                SerrRequestStore.Save(cfg);
                NormalizeSerrRequests(cfg);

                foreach (var record in recordsResult.Records)
                {
                    var requestId = ReadIntValue(record, "id");
                    if (requestId <= 0) continue;

                    var current = cfg.SerrRequests.FirstOrDefault(entry => entry.SerrRequestId == requestId);
                    if (current is null)
                    {
                        current = cfg.SerrRequests.FirstOrDefault(entry =>
                            !usedLocalIds.Contains(entry.Id) &&
                            !entry.SerrRequestId.HasValue &&
                            SerrRequestMatchesEntry(record, entry));
                    }

                    if (current is null)
                    {
                        var imported = BuildEntryFromSerrRecord(record, now, resolvedTitles.GetValueOrDefault(requestId));
                        if (imported is null) continue;
                        cfg.SerrRequests.Add(imported);
                        usedLocalIds.Add(imported.Id);
                        changed = true;
                        continue;
                    }

                    var before = JsonSerializer.Serialize(current, JsonOptions);
                    ApplySerrRecord(current, record, now, resolvedTitles.GetValueOrDefault(requestId));
                    MarkCompletedIfLocalAvailable(current);
                    var after = JsonSerializer.Serialize(current, JsonOptions);
                    if (string.Equals(before, after, StringComparison.Ordinal)) continue;

                    usedLocalIds.Add(current.Id);
                    changed = true;
                }

                if (changed)
                {
                    PruneRequests(cfg);
                    TouchSerr(cfg);
                    SerrRequestStore.Save(cfg);
                    plugin.UpdateConfiguration(cfg);
                }
            }
        }

        private async Task<Dictionary<int, string>> ResolveSerrRequestTitles(
            JMSFusionConfiguration cfg,
            IReadOnlyList<JsonElement> records,
            IReadOnlyDictionary<int, string> knownTitles,
            CancellationToken cancellationToken)
        {
            var output = new Dictionary<int, string>();
            foreach (var record in records)
            {
                var requestId = ReadIntValue(record, "id");
                if (requestId <= 0 || knownTitles.ContainsKey(requestId)) continue;

                var media = TryReadObject(record, "media", out var mediaObject) ? mediaObject : default;
                var inline = CleanText(ReadSerrRequestTitle(record, media, requestId), MaxTitleLength);
                if (!IsGeneratedSerrTitle(inline, requestId))
                {
                    output[requestId] = inline;
                    continue;
                }

                var mediaType = NormalizeMediaType(ReadStringAny(record, "mediaType", "media_type", "type"));
                if (string.IsNullOrWhiteSpace(mediaType) && media.ValueKind == JsonValueKind.Object)
                {
                    mediaType = NormalizeMediaType(ReadStringAny(media, "mediaType", "media_type", "type"));
                }

                var mediaId = ReadSerrTmdbId(record, media);
                if (mediaId <= 0 || (!Same(mediaType, "movie") && !Same(mediaType, "tv"))) continue;

                var resolved = await ResolveSerrMetadataTitle(cfg, mediaType, mediaId, cancellationToken);
                if (!string.IsNullOrWhiteSpace(resolved))
                {
                    output[requestId] = CleanText(resolved, MaxTitleLength);
                }
            }

            return output;
        }

        private async Task<string> ResolveSerrMetadataTitle(
            JMSFusionConfiguration cfg,
            string mediaType,
            int mediaId,
            CancellationToken cancellationToken)
        {
            var path = (Same(mediaType, "tv") ? "/tv/" : "/movie/") + mediaId.ToString(CultureInfo.InvariantCulture);
            if (IsSerrConnectionConfigured(cfg))
            {
                var qs = new Dictionary<string, string>();
                var lang = NormalizeLanguage(cfg.SerrDefaultLanguage);
                if (!string.IsNullOrWhiteSpace(lang)) qs["language"] = lang;
                var response = await SendSerrAsync(
                    cfg,
                    HttpMethod.Get,
                    path + (qs.Count > 0 ? "?" + BuildQueryString(qs) : string.Empty),
                    null,
                    cancellationToken);
                var title = ReadMetadataTitle(response.Payload, mediaType);
                if (!string.IsNullOrWhiteSpace(title)) return title;
            }

            var apiKey = CleanText(cfg.TmdbApiKey, 200);
            if (string.IsNullOrWhiteSpace(apiKey) || Same(apiKey, "CHANGE_ME")) return string.Empty;

            var tmdbQs = new Dictionary<string, string>
            {
                ["api_key"] = apiKey
            };
            var tmdbLang = NormalizeTmdbLanguage(cfg.SerrDefaultLanguage);
            if (!string.IsNullOrWhiteSpace(tmdbLang)) tmdbQs["language"] = tmdbLang;

            var tmdb = await SendTmdbAsync(path + "?" + BuildQueryString(tmdbQs), cancellationToken);
            return tmdb.Ok ? ReadMetadataTitle(tmdb.Payload, mediaType) : string.Empty;
        }

        private static SerrRequestEntry? BuildEntryFromSerrRecord(JsonElement record, long now, string? resolvedTitle)
        {
            var requestId = ReadIntValue(record, "id");
            if (requestId <= 0) return null;

            var media = TryReadObject(record, "media", out var mediaObject) ? mediaObject : default;
            var mediaType = NormalizeMediaType(ReadStringAny(record, "mediaType", "media_type", "type"));
            if (string.IsNullOrWhiteSpace(mediaType) && media.ValueKind == JsonValueKind.Object)
            {
                mediaType = NormalizeMediaType(ReadStringAny(media, "mediaType", "media_type", "type"));
            }
            if (!Same(mediaType, "movie") && !Same(mediaType, "tv")) return null;

            var mediaId = ReadSerrTmdbId(record, media);
            if (mediaId <= 0) return null;

            var requestedBy = TryReadObject(record, "requestedBy", out var requestedByObject) ? requestedByObject : default;
            var created = ReadTimestampMsAny(record, "createdAt", "created_at", "requestedAt", "requested_at");
            var updated = ReadTimestampMsAny(record, "updatedAt", "updated_at", "modifiedAt", "modified_at");
            var seasons = ReadSerrRequestSeasons(record)
                .Where(season => season > 0)
                .Distinct()
                .OrderBy(season => season)
                .ToList();

            var entry = new SerrRequestEntry
            {
                Id = "seerr:" + requestId.ToString(CultureInfo.InvariantCulture),
                JellyfinUserId = ReadStringAny(requestedBy, "jellyfinUserId", "jellyfinUserID", "jellyfinId", "jellyfin_id"),
                JellyfinUserName = CleanText(ReadStringAny(requestedBy, "displayName", "username", "plexUsername", "jellyfinUsername", "email"), 80),
                JellyfinUserIsAdmin = false,
                Title = CleanText(string.IsNullOrWhiteSpace(resolvedTitle) ? ReadSerrRequestTitle(record, media, requestId) : resolvedTitle, MaxTitleLength),
                MediaType = mediaType,
                MediaId = mediaId,
                TvdbId = ReadSerrIntAny(record, media, "tvdbId", "tvdb", "tvdb_id") is var tvdbId && tvdbId > 0 ? tvdbId : null,
                Seasons = seasons,
                Episodes = new List<SerrEpisodeSelectionEntry>(),
                RequestAllSeasons = Same(mediaType, "tv") && seasons.Count == 0,
                Is4K = ReadSerrRequestIs4K(record),
                Source = "seerr",
                Status = "approved",
                SerrRequestId = requestId,
                Error = CleanText(ReadStringAny(record, "error", "errorMessage"), 500),
                CreatedAtUtc = created > 0 ? created : now,
                UpdatedAtUtc = updated > 0 ? updated : (created > 0 ? created : now)
            };

            ApplySerrResponse(entry, record);
            if (IsCompletedStatus(entry.Status))
            {
                entry.CompletedAtUtc = entry.UpdatedAtUtc > 0 ? entry.UpdatedAtUtc : now;
            }
            return entry;
        }

        private static void ApplySerrRecord(SerrRequestEntry entry, JsonElement record, long now, string? resolvedTitle)
        {
            var media = TryReadObject(record, "media", out var mediaObject) ? mediaObject : default;
            var requestId = entry.SerrRequestId ?? ReadIntValue(record, "id");
            var title = CleanText(string.IsNullOrWhiteSpace(resolvedTitle) ? ReadSerrRequestTitle(record, media, requestId) : resolvedTitle, MaxTitleLength);
            if (!IsGeneratedSerrTitle(title, requestId) &&
                (Same(entry.Source, "seerr") || string.IsNullOrWhiteSpace(entry.Title) || IsGeneratedSerrTitle(entry.Title, requestId)))
            {
                entry.Title = title;
            }

            var mediaType = NormalizeMediaType(ReadStringAny(record, "mediaType", "media_type", "type"));
            if (string.IsNullOrWhiteSpace(mediaType) && media.ValueKind == JsonValueKind.Object)
            {
                mediaType = NormalizeMediaType(ReadStringAny(media, "mediaType", "media_type", "type"));
            }
            if (Same(mediaType, "movie") || Same(mediaType, "tv")) entry.MediaType = mediaType;

            var mediaId = ReadSerrTmdbId(record, media);
            if (mediaId > 0) entry.MediaId = mediaId;

            var tvdbId = ReadSerrIntAny(record, media, "tvdbId", "tvdb", "tvdb_id");
            if (tvdbId > 0) entry.TvdbId = tvdbId;

            var seasons = ReadSerrRequestSeasons(record)
                .Where(season => season > 0)
                .Distinct()
                .OrderBy(season => season)
                .ToList();
            if (Same(entry.MediaType, "tv"))
            {
                if (seasons.Count > 0)
                {
                    entry.Seasons = seasons;
                    entry.RequestAllSeasons = false;
                }
                else if (Same(entry.Source, "seerr") && !IsEpisodeOnlyRequest(entry))
                {
                    entry.Seasons = new List<int>();
                    entry.RequestAllSeasons = true;
                }
            }

            if (TryReadSerrRequestIs4K(record, out var is4K))
            {
                entry.Is4K = is4K;
            }
            if (TryReadObject(record, "requestedBy", out var requestedBy))
            {
                var jellyfinUserId = ReadStringAny(requestedBy, "jellyfinUserId", "jellyfinUserID", "jellyfinId", "jellyfin_id");
                if (!string.IsNullOrWhiteSpace(jellyfinUserId)) entry.JellyfinUserId = jellyfinUserId;

                var userName = CleanText(ReadStringAny(requestedBy, "displayName", "username", "plexUsername", "jellyfinUsername", "email"), 80);
                if (!string.IsNullOrWhiteSpace(userName)) entry.JellyfinUserName = userName;
            }

            ApplySerrResponse(entry, record);
            entry.Error = CleanText(ReadStringAny(record, "error", "errorMessage"), 500);

            var created = ReadTimestampMsAny(record, "createdAt", "created_at", "requestedAt", "requested_at");
            if (created > 0) entry.CreatedAtUtc = created;

            var updated = ReadTimestampMsAny(record, "updatedAt", "updated_at", "modifiedAt", "modified_at");
            if (updated > 0) entry.UpdatedAtUtc = updated;
            else if (entry.UpdatedAtUtc <= 0) entry.UpdatedAtUtc = now;
            if (IsCompletedStatus(entry.Status) && entry.CompletedAtUtc <= 0)
            {
                entry.CompletedAtUtc = entry.UpdatedAtUtc > 0 ? entry.UpdatedAtUtc : now;
            }
        }

        private async Task<(List<JsonElement> Records, string Error)> FetchSerrRequestRecords(
            JMSFusionConfiguration cfg,
            CancellationToken cancellationToken)
        {
            var output = new List<JsonElement>();
            const int take = 100;

            for (var page = 0; page < MaxSerrRequestLookupPages; page++)
            {
                var skip = page * take;
                var response = await SendSerrAsync(
                    cfg,
                    HttpMethod.Get,
                    "/request?take=" + take.ToString(CultureInfo.InvariantCulture) +
                    "&skip=" + skip.ToString(CultureInfo.InvariantCulture) +
                    "&filter=all&sort=added",
                    null,
                    cancellationToken);
                if (!response.Ok)
                {
                    return (output, response.Error);
                }

                var records = ExtractSerrRequestRecords(response.Payload);
                output.AddRange(records);
                if (records.Count < take) break;
            }

            return (output, string.Empty);
        }

        private static List<JsonElement> ExtractSerrRequestRecords(JsonElement payload)
        {
            if (payload.ValueKind == JsonValueKind.Array)
            {
                return payload.EnumerateArray()
                    .Where(item => item.ValueKind == JsonValueKind.Object)
                    .Select(item => item.Clone())
                    .ToList();
            }

            if (payload.ValueKind != JsonValueKind.Object) return new List<JsonElement>();
            foreach (var property in new[] { "results", "requests", "items", "data" })
            {
                if (payload.TryGetProperty(property, out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    return arr.EnumerateArray()
                        .Where(item => item.ValueKind == JsonValueKind.Object)
                        .Select(item => item.Clone())
                        .ToList();
                }
            }

            return new List<JsonElement>();
        }

        private static bool SerrRequestMatchesEntry(JsonElement request, SerrRequestEntry entry)
            => request.ValueKind == JsonValueKind.Object &&
               SerrRequestMediaMatchesEntry(request, entry) &&
               SerrRequestQualityMatchesEntry(request, entry) &&
               SerrRequestScopeMatchesEntry(request, entry);

        private static bool SerrRequestMediaMatchesEntry(JsonElement request, SerrRequestEntry entry)
        {
            var media = TryReadObject(request, "media", out var mediaObject) ? mediaObject : default;
            var requestMediaType = NormalizeMediaType(ReadStringAny(request, "mediaType", "media_type", "type"));
            if (string.IsNullOrWhiteSpace(requestMediaType) && media.ValueKind == JsonValueKind.Object)
            {
                requestMediaType = NormalizeMediaType(ReadStringAny(media, "mediaType", "media_type", "type"));
            }

            if (!string.IsNullOrWhiteSpace(requestMediaType) && !Same(requestMediaType, entry.MediaType)) return false;

            if (Same(entry.MediaType, "movie"))
            {
                return entry.MediaId > 0 && ReadSerrTmdbId(request, media) == entry.MediaId;
            }

            if (Same(entry.MediaType, "tv"))
            {
                if (entry.TvdbId.HasValue && entry.TvdbId.Value > 0 &&
                    ReadSerrIntAny(request, media, "tvdbId", "tvdb", "tvdb_id") == entry.TvdbId.Value)
                {
                    return true;
                }

                return entry.MediaId > 0 && ReadSerrTmdbId(request, media) == entry.MediaId;
            }

            return false;
        }

        private static bool SerrRequestQualityMatchesEntry(JsonElement request, SerrRequestEntry entry)
        {
            if (!TryReadBoolAny(request, out var requestIs4K, "is4k", "is4K", "is4KRequest")) return true;
            return requestIs4K == entry.Is4K;
        }

        private static bool SerrRequestScopeMatchesEntry(JsonElement request, SerrRequestEntry entry)
        {
            if (!Same(entry.MediaType, "tv")) return true;
            if (entry.RequestAllSeasons) return true;

            var entrySeasons = EntryRequestScope(entry).Seasons;
            if (!entrySeasons.Any()) return true;

            var requestSeasons = ReadSerrRequestSeasons(request);
            return !requestSeasons.Any() || entrySeasons.Overlaps(requestSeasons);
        }

        private static HashSet<int> ReadSerrRequestSeasons(JsonElement request)
        {
            var seasons = new HashSet<int>();
            AddSerrSeasonValues(request, seasons);
            if (TryReadObject(request, "media", out var media)) AddSerrSeasonValues(media, seasons);
            return seasons;
        }

        private static void AddSerrSeasonValues(JsonElement source, HashSet<int> output)
        {
            if (source.ValueKind != JsonValueKind.Object) return;
            if (TryReadIntAny(source, out var directSeason, "seasonNumber", "season_number", "season"))
            {
                output.Add(directSeason);
            }

            foreach (var property in new[] { "seasons", "requestedSeasons" })
            {
                if (!source.TryGetProperty(property, out var arr) || arr.ValueKind != JsonValueKind.Array) continue;
                foreach (var item in arr.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out var number))
                    {
                        output.Add(number);
                    }
                    else if (item.ValueKind == JsonValueKind.String &&
                             int.TryParse(item.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
                    {
                        output.Add(parsed);
                    }
                    else if (item.ValueKind == JsonValueKind.Object &&
                             TryReadIntAny(item, out var seasonNumber, "seasonNumber", "season_number", "season"))
                    {
                        output.Add(seasonNumber);
                    }
                }
            }
        }

        private static int ReadSerrIntAny(JsonElement request, JsonElement media, params string[] properties)
        {
            if (TryReadIntAny(request, out var value, properties)) return value;
            return media.ValueKind == JsonValueKind.Object && TryReadIntAny(media, out value, properties) ? value : 0;
        }

        private static int ReadSerrTmdbId(JsonElement request, JsonElement media)
        {
            var value = ReadSerrIntAny(request, media, "tmdbId", "tmdb", "mediaTmdbId", "tmdb_id");
            if (value > 0) return value;

            return media.ValueKind != JsonValueKind.Object && TryReadInt(request, "mediaId", out value) ? value : 0;
        }

        private static bool ReadSerrRequestIs4K(JsonElement request)
        {
            return TryReadSerrRequestIs4K(request, out var is4K) && is4K;
        }

        private static bool TryReadSerrRequestIs4K(JsonElement request, out bool is4K)
        {
            if (TryReadBoolAny(request, out is4K, "is4k", "is4K", "is4KRequest")) return true;
            if (TryReadObject(request, "media", out var media) &&
                TryReadBoolAny(media, out is4K, "is4k", "is4K", "is4KRequest"))
            {
                return true;
            }

            is4K = false;
            return false;
        }

        private static string ReadSerrRequestTitle(JsonElement request, JsonElement media, int requestId)
        {
            var title = ReadStringAny(request, "title", "name", "mediaTitle", "media_title", "originalTitle", "original_title", "originalName", "original_name");
            if (string.IsNullOrWhiteSpace(title) && media.ValueKind == JsonValueKind.Object)
            {
                title = ReadStringAny(media, "title", "name", "mediaTitle", "media_title", "originalTitle", "original_title", "originalName", "original_name");
            }

            return string.IsNullOrWhiteSpace(title)
                ? "Seerr #" + requestId.ToString(CultureInfo.InvariantCulture)
                : title;
        }

        private static string ReadMetadataTitle(JsonElement payload, string mediaType)
        {
            if (payload.ValueKind != JsonValueKind.Object) return string.Empty;
            var title = Same(mediaType, "tv")
                ? ReadStringAny(payload, "name", "title", "originalName", "original_name", "originalTitle", "original_title")
                : ReadStringAny(payload, "title", "name", "originalTitle", "original_title", "originalName", "original_name");
            if (!string.IsNullOrWhiteSpace(title)) return title;

            foreach (var property in new[] { "media", "mediaInfo", "movie", "tv", "show", "item", "result" })
            {
                if (!TryReadObject(payload, property, out var nested)) continue;
                title = Same(mediaType, "tv")
                    ? ReadStringAny(nested, "name", "title", "originalName", "original_name", "originalTitle", "original_title")
                    : ReadStringAny(nested, "title", "name", "originalTitle", "original_title", "originalName", "original_name");
                if (!string.IsNullOrWhiteSpace(title)) return title;
            }

            return string.Empty;
        }

        private static bool IsGeneratedSerrTitle(string? title, int requestId)
        {
            if (requestId <= 0) return false;
            return Same(title, "Seerr #" + requestId.ToString(CultureInfo.InvariantCulture));
        }

        private async Task<string> WithdrawFromArr(JMSFusionConfiguration cfg, SerrRequestEntry entry, CancellationToken cancellationToken)
        {
            if (entry is null || !ShouldCleanupArrOnWithdraw(entry)) return string.Empty;

            var warnings = new List<string>();
            if (Same(entry.MediaType, "movie"))
            {
                foreach (var use4K in RadarrCleanupTargets(cfg, entry))
                {
                    var warning = await WithdrawMovieFromRadarr(cfg, entry, use4K, cancellationToken);
                    if (!string.IsNullOrWhiteSpace(warning)) warnings.Add(warning);
                }
            }
            else if (Same(entry.MediaType, "tv"))
            {
                foreach (var use4K in SonarrCleanupTargets(cfg, entry))
                {
                    var warning = await WithdrawTvFromSonarr(cfg, entry, use4K, cancellationToken);
                    if (!string.IsNullOrWhiteSpace(warning)) warnings.Add(warning);
                }
            }

            return string.Join(" | ", warnings.Distinct(StringComparer.OrdinalIgnoreCase));
        }

        private static bool ShouldCleanupArrOnWithdraw(SerrRequestEntry entry)
            => Same(entry.Status, "approved") || Same(entry.Status, "processing");

        private static IEnumerable<bool> RadarrCleanupTargets(JMSFusionConfiguration cfg, SerrRequestEntry entry)
        {
            if (entry.Is4K && IsRadarr4KSearchConfigured(cfg)) yield return true;
            else if (IsRadarrSearchConfigured(cfg)) yield return false;
        }

        private static IEnumerable<bool> SonarrCleanupTargets(JMSFusionConfiguration cfg, SerrRequestEntry entry)
        {
            if (entry.Is4K && IsSonarr4KSearchConfigured(cfg)) yield return true;
            else if (IsSonarrSearchConfigured(cfg)) yield return false;
        }

        private async Task<string> WithdrawMovieFromRadarr(
            JMSFusionConfiguration cfg,
            SerrRequestEntry entry,
            bool use4K,
            CancellationToken cancellationToken)
        {
            var serviceName = use4K ? "4K Radarr" : "Radarr";
            var movie = await FindRadarrMovie(cfg, entry, cancellationToken, use4K);
            if (movie.ValueKind != JsonValueKind.Object) return string.Empty;
            if (!TryReadInt(movie, "id", out var movieId) || movieId <= 0)
            {
                return serviceName + ": movie id could not be resolved.";
            }

            var delete = await SendArrAsync(
                RadarrBaseUrl(cfg, use4K),
                RadarrApiKey(cfg, use4K),
                serviceName,
                HttpMethod.Delete,
                "/movie/" + movieId.ToString(CultureInfo.InvariantCulture) + "?deleteFiles=false&addImportListExclusion=false",
                null,
                cancellationToken);
            if (!delete.Ok) return serviceName + ": " + delete.Error;

            ClearArrRecordsCache();
            return string.Empty;
        }

        private async Task<string> WithdrawTvFromSonarr(
            JMSFusionConfiguration cfg,
            SerrRequestEntry entry,
            bool use4K,
            CancellationToken cancellationToken)
        {
            var serviceName = use4K ? "4K Sonarr" : "Sonarr";
            var series = await FindSonarrSeries(cfg, entry, cancellationToken, use4K);
            if (series.ValueKind != JsonValueKind.Object) return string.Empty;
            if (!TryReadInt(series, "id", out var seriesId) || seriesId <= 0)
            {
                return serviceName + ": series id could not be resolved.";
            }

            if (ShouldDeleteSonarrSeriesOnWithdraw(entry))
            {
                var delete = await SendArrAsync(
                    SonarrBaseUrl(cfg, use4K),
                    SonarrApiKey(cfg, use4K),
                    serviceName,
                    HttpMethod.Delete,
                    "/series/" + seriesId.ToString(CultureInfo.InvariantCulture) + "?deleteFiles=false&addImportListExclusion=false",
                    null,
                    cancellationToken);
                if (!delete.Ok) return serviceName + ": " + delete.Error;

                ClearArrRecordsCache();
                return string.Empty;
            }

            if (IsEpisodeOnlyRequest(entry))
            {
                var episodeIds = await FindRequestedSonarrEpisodeIdsOnce(cfg, seriesId, entry, cancellationToken, use4K);
                if (episodeIds.Count == 0) return string.Empty;

                var monitor = await SendArrAsync(
                    SonarrBaseUrl(cfg, use4K),
                    SonarrApiKey(cfg, use4K),
                    serviceName,
                    HttpMethod.Put,
                    "/episode/monitor",
                    new Dictionary<string, object?>
                    {
                        ["episodeIds"] = episodeIds.ToArray(),
                        ["monitored"] = false
                    },
                    cancellationToken);
                if (!monitor.Ok) return serviceName + ": " + monitor.Error;

                ClearArrRecordsCache();
                return string.Empty;
            }

            var targetSeasons = GetArrTargetSeasons(entry);
            if (targetSeasons.Count == 0) return string.Empty;

            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(series.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            var seasons = BuildSonarrSeasonUnmonitorPayload(series, targetSeasons);
            body["seasons"] = seasons;
            if (!seasons.Any(season => season.TryGetValue("monitored", out var monitored) && ObjectBool(monitored)))
            {
                body["monitored"] = false;
            }

            var update = await SendArrAsync(
                SonarrBaseUrl(cfg, use4K),
                SonarrApiKey(cfg, use4K),
                serviceName,
                HttpMethod.Put,
                "/series/" + seriesId.ToString(CultureInfo.InvariantCulture),
                body,
                cancellationToken);
            if (!update.Ok) return serviceName + ": " + update.Error;

            ClearArrRecordsCache();
            return string.Empty;
        }

        private static bool ShouldDeleteSonarrSeriesOnWithdraw(SerrRequestEntry entry)
            => entry.RequestAllSeasons ||
               (!IsEpisodeOnlyRequest(entry) && NormalizeSeasons(entry.Seasons).Count == 0);

        private async Task<RequestSubmissionResult> SubmitMovieToRadarr(JMSFusionConfiguration cfg, SerrRequestEntry entry, CancellationToken cancellationToken)
        {
            var use4K = ShouldUseRadarr4K(cfg, entry.Is4K);
            var movie = await FindRadarrMovie(cfg, entry, cancellationToken, use4K);
            if (movie.ValueKind != JsonValueKind.Object)
            {
                var lookup = await LookupRadarrMovie(cfg, entry, cancellationToken, use4K);
                if (lookup.ValueKind != JsonValueKind.Object)
                {
                    return ArrSubmitFailure("radarr", 404, "Movie was not found in Radarr lookup.");
                }

                var add = await AddRadarrMovie(cfg, lookup, cancellationToken, use4K);
                if (!add.Ok) return ArrSubmitFailure("radarr", add.StatusCode, add.Error);
                movie = add.Payload;
            }

            if (!TryReadInt(movie, "id", out var movieId) || movieId <= 0)
            {
                return ArrSubmitFailure("radarr", 502, "Radarr did not return a valid movie id.");
            }

            var update = await EnsureRadarrMovieMonitored(cfg, movie, cancellationToken, use4K);
            if (!update.Ok) return ArrSubmitFailure("radarr", update.StatusCode, update.Error);

            if (RadarrSearchOnRequest(cfg, use4K))
            {
                var command = await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", HttpMethod.Post, "/command", new Dictionary<string, object?>
                {
                    ["name"] = "MoviesSearch",
                    ["movieIds"] = new[] { movieId }
                }, cancellationToken);
                if (!command.Ok) return ArrSubmitFailure("radarr", command.StatusCode, command.Error);
            }

            return ArrSubmitSuccess("radarr");
        }

        private async Task<RequestSubmissionResult> SubmitSeriesToSonarr(JMSFusionConfiguration cfg, SerrRequestEntry entry, CancellationToken cancellationToken)
        {
            var use4K = ShouldUseSonarr4K(cfg, entry.Is4K);
            var targetSeasons = GetArrTargetSeasons(entry);
            var requestAllSeasons = entry.RequestAllSeasons || (!IsEpisodeOnlyRequest(entry) && targetSeasons.Count == 0);
            var series = await FindSonarrSeries(cfg, entry, cancellationToken, use4K);
            var addedSeries = false;

            if (series.ValueKind != JsonValueKind.Object)
            {
                var lookup = await LookupSonarrSeries(cfg, entry, cancellationToken, use4K);
                if (lookup.ValueKind != JsonValueKind.Object)
                {
                    return ArrSubmitFailure("sonarr", 404, "Series was not found in Sonarr lookup.");
                }

                var add = await AddSonarrSeries(cfg, lookup, targetSeasons, requestAllSeasons, cancellationToken, use4K);
                if (!add.Ok) return ArrSubmitFailure("sonarr", add.StatusCode, add.Error);
                series = add.Payload;
                addedSeries = true;
            }

            if (!TryReadInt(series, "id", out var seriesId) || seriesId <= 0)
            {
                return ArrSubmitFailure("sonarr", 502, "Sonarr did not return a valid series id.");
            }

            var update = await EnsureSonarrSeriesMonitored(cfg, series, targetSeasons, requestAllSeasons, cancellationToken, use4K);
            if (!update.Ok) return ArrSubmitFailure("sonarr", update.StatusCode, update.Error);
            if (update.Payload.ValueKind == JsonValueKind.Object) series = update.Payload;

            if (IsEpisodeOnlyRequest(entry))
            {
                var episodeIds = await FindRequestedSonarrEpisodeIds(cfg, seriesId, entry, addedSeries, cancellationToken, use4K);
                if (episodeIds.Count == 0)
                {
                    return ArrSubmitFailure("sonarr", 404, "Requested episodes were not found in Sonarr.");
                }

                var monitor = await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Put, "/episode/monitor", new Dictionary<string, object?>
                {
                    ["episodeIds"] = episodeIds.ToArray(),
                    ["monitored"] = true
                }, cancellationToken);
                if (!monitor.Ok) return ArrSubmitFailure("sonarr", monitor.StatusCode, monitor.Error);

                if (SonarrSearchOnRequest(cfg, use4K))
                {
                    var command = await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Post, "/command", new Dictionary<string, object?>
                    {
                        ["name"] = "EpisodeSearch",
                        ["episodeIds"] = episodeIds.ToArray()
                    }, cancellationToken);
                    if (!command.Ok) return ArrSubmitFailure("sonarr", command.StatusCode, command.Error);
                }

                return ArrSubmitSuccess("sonarr");
            }

            if (SonarrSearchOnRequest(cfg, use4K))
            {
                if (requestAllSeasons)
                {
                    var command = await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Post, "/command", new Dictionary<string, object?>
                    {
                        ["name"] = "SeriesSearch",
                        ["seriesId"] = seriesId
                    }, cancellationToken);
                    if (!command.Ok) return ArrSubmitFailure("sonarr", command.StatusCode, command.Error);
                }
                else
                {
                    foreach (var seasonNumber in targetSeasons)
                    {
                        var command = await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Post, "/command", new Dictionary<string, object?>
                        {
                            ["name"] = "SeasonSearch",
                            ["seriesId"] = seriesId,
                            ["seasonNumber"] = seasonNumber
                        }, cancellationToken);
                        if (!command.Ok) return ArrSubmitFailure("sonarr", command.StatusCode, command.Error);
                    }
                }
            }

            return ArrSubmitSuccess("sonarr");
        }

        private static RequestSubmissionResult ArrSubmitSuccess(string service)
            => new(SerrCallResult.Success(200, default), "arr", service);

        private static RequestSubmissionResult ArrSubmitFailure(string service, int statusCode, string error)
            => new(SerrCallResult.Fail(statusCode, error), "arr", service);

        private async Task<JsonElement> FindRadarrMovie(JMSFusionConfiguration cfg, SerrRequestEntry entry, CancellationToken cancellationToken, bool use4K = false)
        {
            var response = await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", HttpMethod.Get, "/movie", null, cancellationToken);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return default;

            var requestedTitle = CleanKey(entry.Title);
            foreach (var item in response.Payload.EnumerateArray())
            {
                if (entry.MediaId > 0 && TryReadInt(item, "tmdbId", out var tmdbId) && tmdbId == entry.MediaId) return item.Clone();
                if (!string.IsNullOrWhiteSpace(requestedTitle) &&
                    string.Equals(CleanKey(ReadStringAny(item, "title", "originalTitle")), requestedTitle, StringComparison.OrdinalIgnoreCase))
                {
                    return item.Clone();
                }
            }

            return default;
        }

        private async Task<JsonElement> LookupRadarrMovie(JMSFusionConfiguration cfg, SerrRequestEntry entry, CancellationToken cancellationToken, bool use4K = false)
        {
            if (entry.MediaId > 0)
            {
                var byTmdb = await SendArrAsync(
                    RadarrBaseUrl(cfg, use4K),
                    RadarrApiKey(cfg, use4K),
                    use4K ? "4K Radarr" : "Radarr",
                    HttpMethod.Get,
                    "/movie/lookup/tmdb?tmdbId=" + entry.MediaId.ToString(CultureInfo.InvariantCulture),
                    null,
                    cancellationToken);
                if (byTmdb.Ok && byTmdb.Payload.ValueKind == JsonValueKind.Object) return byTmdb.Payload.Clone();
            }

            var terms = new List<string>();
            if (entry.MediaId > 0) terms.Add("tmdb:" + entry.MediaId.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrWhiteSpace(entry.Title)) terms.Add(entry.Title);

            foreach (var term in terms.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var response = await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", HttpMethod.Get, "/movie/lookup?term=" + Uri.EscapeDataString(term), null, cancellationToken);
                if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) continue;

                foreach (var item in response.Payload.EnumerateArray())
                {
                    if (entry.MediaId > 0 && TryReadInt(item, "tmdbId", out var tmdbId) && tmdbId == entry.MediaId) return item.Clone();
                }

                var requestedTitle = CleanKey(entry.Title);
                foreach (var item in response.Payload.EnumerateArray())
                {
                    if (!string.IsNullOrWhiteSpace(requestedTitle) &&
                        string.Equals(CleanKey(ReadStringAny(item, "title", "originalTitle")), requestedTitle, StringComparison.OrdinalIgnoreCase))
                    {
                        return item.Clone();
                    }
                }

                var first = response.Payload.EnumerateArray().FirstOrDefault();
                if (first.ValueKind == JsonValueKind.Object) return first.Clone();
            }

            return default;
        }

        private async Task<ArrApiCallResult> AddRadarrMovie(JMSFusionConfiguration cfg, JsonElement lookup, CancellationToken cancellationToken, bool use4K = false)
        {
            var validation = await ValidateRadarrMovieRequestConfig(cfg, cancellationToken, use4K);
            if (!validation.Ok) return validation;

            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(lookup.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            PrepareRadarrAddMovieBody(body, cfg, use4K);

            var result = await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", HttpMethod.Post, "/movie", body, cancellationToken);
            if (result.Ok || !IsRadarrSequenceError(result.Error)) return result;

            var minimal = BuildMinimalRadarrAddMovieBody(lookup, cfg, use4K);
            return await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", HttpMethod.Post, "/movie", minimal, cancellationToken);
        }

        private async Task<ArrApiCallResult> ValidateRadarrMovieRequestConfig(JMSFusionConfiguration cfg, CancellationToken cancellationToken, bool use4K = false)
        {
            var profiles = await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", HttpMethod.Get, "/qualityprofile", null, cancellationToken);
            if (!profiles.Ok) return profiles;
            if (profiles.Payload.ValueKind == JsonValueKind.Array &&
                !profiles.Payload.EnumerateArray().Any(profile => TryReadInt(profile, "id", out var id) && id == RadarrQualityProfileId(cfg, use4K)))
            {
                return ArrApiCallResult.Fail(412, "Radarr quality profile is not valid anymore. Test the Radarr connection and save a valid quality profile.");
            }

            var roots = await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", HttpMethod.Get, "/rootfolder", null, cancellationToken);
            if (!roots.Ok) return roots;
            var configuredRoot = NormalizeArrPath(RadarrRootFolderPath(cfg, use4K));
            if (roots.Payload.ValueKind == JsonValueKind.Array &&
                !roots.Payload.EnumerateArray().Any(root => string.Equals(NormalizeArrPath(ReadStringAny(root, "path")), configuredRoot, StringComparison.OrdinalIgnoreCase)))
            {
                return ArrApiCallResult.Fail(412, "Radarr root folder is not valid anymore. Test the Radarr connection and save a valid root folder.");
            }

            return ArrApiCallResult.Success(200, default);
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

        private async Task<ArrApiCallResult> EnsureRadarrMovieMonitored(JMSFusionConfiguration cfg, JsonElement movie, CancellationToken cancellationToken, bool use4K = false)
        {
            if (!TryReadInt(movie, "id", out var movieId) || movieId <= 0) return ArrApiCallResult.Fail(0, "Invalid movie id.");
            if (ReadBool(movie, "monitored")) return ArrApiCallResult.Success(200, movie);

            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(movie.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            body["monitored"] = true;
            return await SendArrAsync(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), use4K ? "4K Radarr" : "Radarr", HttpMethod.Put, "/movie/" + movieId.ToString(CultureInfo.InvariantCulture), body, cancellationToken);
        }

        private async Task<JsonElement> FindSonarrSeries(JMSFusionConfiguration cfg, SerrRequestEntry entry, CancellationToken cancellationToken, bool use4K = false)
        {
            var response = await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Get, "/series", null, cancellationToken);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return default;

            var requestedTitle = CleanKey(entry.Title);
            foreach (var item in response.Payload.EnumerateArray())
            {
                if (entry.TvdbId.HasValue && entry.TvdbId.Value > 0 &&
                    TryReadInt(item, "tvdbId", out var tvdbId) && tvdbId == entry.TvdbId.Value) return item.Clone();

                if (entry.MediaId > 0 && TryReadIntAny(item, out var tmdbId, "tmdbId", "tmdb") && tmdbId == entry.MediaId) return item.Clone();

                if (!string.IsNullOrWhiteSpace(requestedTitle) &&
                    string.Equals(CleanKey(ReadStringAny(item, "title", "sortTitle")), requestedTitle, StringComparison.OrdinalIgnoreCase))
                {
                    return item.Clone();
                }
            }

            return default;
        }

        private async Task<JsonElement> LookupSonarrSeries(JMSFusionConfiguration cfg, SerrRequestEntry entry, CancellationToken cancellationToken, bool use4K = false)
        {
            var terms = new List<string>();
            if (entry.TvdbId.HasValue && entry.TvdbId.Value > 0) terms.Add("tvdb:" + entry.TvdbId.Value.ToString(CultureInfo.InvariantCulture));
            if (entry.MediaId > 0) terms.Add("tmdb:" + entry.MediaId.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrWhiteSpace(entry.Title)) terms.Add(entry.Title);

            foreach (var term in terms.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var response = await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Get, "/series/lookup?term=" + Uri.EscapeDataString(term), null, cancellationToken);
                if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) continue;

                foreach (var item in response.Payload.EnumerateArray())
                {
                    if (entry.TvdbId.HasValue && entry.TvdbId.Value > 0 &&
                        TryReadInt(item, "tvdbId", out var tvdbId) && tvdbId == entry.TvdbId.Value) return item.Clone();

                    if (entry.MediaId > 0 && TryReadIntAny(item, out var tmdbId, "tmdbId", "tmdb") && tmdbId == entry.MediaId) return item.Clone();
                }

                var first = response.Payload.EnumerateArray().FirstOrDefault();
                if (first.ValueKind == JsonValueKind.Object) return first.Clone();
            }

            return default;
        }

        private async Task<ArrApiCallResult> AddSonarrSeries(
            JMSFusionConfiguration cfg,
            JsonElement lookup,
            IReadOnlyCollection<int> targetSeasons,
            bool requestAllSeasons,
            CancellationToken cancellationToken,
            bool use4K = false)
        {
            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(lookup.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            body["qualityProfileId"] = SonarrQualityProfileId(cfg, use4K);
            if (SonarrLanguageProfileId(cfg, use4K) > 0) body["languageProfileId"] = SonarrLanguageProfileId(cfg, use4K);
            body["rootFolderPath"] = SonarrRootFolderPath(cfg, use4K);
            body["monitored"] = true;
            body["seasonFolder"] = SonarrSeasonFolder(cfg, use4K);
            body["seasons"] = BuildSonarrSeasonMonitorPayload(lookup, targetSeasons, requestAllSeasons);
            body["addOptions"] = new Dictionary<string, object?>
            {
                ["searchForMissingEpisodes"] = false
            };

            return await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Post, "/series", body, cancellationToken);
        }

        private async Task<ArrApiCallResult> EnsureSonarrSeriesMonitored(
            JMSFusionConfiguration cfg,
            JsonElement series,
            IReadOnlyCollection<int> targetSeasons,
            bool requestAllSeasons,
            CancellationToken cancellationToken,
            bool use4K = false)
        {
            if (!TryReadInt(series, "id", out var seriesId) || seriesId <= 0) return ArrApiCallResult.Fail(0, "Invalid series id.");

            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(series.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
            body["monitored"] = true;
            body["seasons"] = BuildSonarrSeasonMonitorPayload(series, targetSeasons, requestAllSeasons, preserveExisting: true);
            return await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Put, "/series/" + seriesId.ToString(CultureInfo.InvariantCulture), body, cancellationToken);
        }

        private async Task<List<int>> FindRequestedSonarrEpisodeIds(
            JMSFusionConfiguration cfg,
            int seriesId,
            SerrRequestEntry entry,
            bool refreshBeforeRetry,
            CancellationToken cancellationToken,
            bool use4K = false)
        {
            var ids = await FindRequestedSonarrEpisodeIdsOnce(cfg, seriesId, entry, cancellationToken, use4K);
            if (ids.Count == NormalizeEpisodes(entry.Episodes).Count) return ids;
            if (!refreshBeforeRetry) return ids;

            await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Post, "/command", new Dictionary<string, object?>
            {
                ["name"] = "RefreshSeries",
                ["seriesId"] = seriesId
            }, cancellationToken);
            await Task.Delay(1200, cancellationToken);
            return await FindRequestedSonarrEpisodeIdsOnce(cfg, seriesId, entry, cancellationToken, use4K);
        }

        private async Task<List<int>> FindRequestedSonarrEpisodeIdsOnce(JMSFusionConfiguration cfg, int seriesId, SerrRequestEntry entry, CancellationToken cancellationToken, bool use4K = false)
        {
            var response = await SendArrAsync(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), use4K ? "4K Sonarr" : "Sonarr", HttpMethod.Get, "/episode?seriesId=" + seriesId.ToString(CultureInfo.InvariantCulture), null, cancellationToken);
            if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Array) return new List<int>();

            var requested = NormalizeEpisodes(entry.Episodes)
                .Select(episode => (episode.SeasonNumber, episode.EpisodeNumber))
                .ToHashSet();
            var ids = new List<int>();
            foreach (var item in response.Payload.EnumerateArray())
            {
                if (!TryReadInt(item, "seasonNumber", out var seasonNumber) ||
                    !TryReadInt(item, "episodeNumber", out var episodeNumber) ||
                    !requested.Contains((seasonNumber, episodeNumber)) ||
                    !TryReadInt(item, "id", out var id) ||
                    id <= 0)
                {
                    continue;
                }

                ids.Add(id);
            }

            return ids.Distinct().ToList();
        }

        private static List<Dictionary<string, object?>> BuildSonarrSeasonMonitorPayload(
            JsonElement source,
            IReadOnlyCollection<int> targetSeasons,
            bool requestAllSeasons,
            bool preserveExisting = false)
        {
            var targets = (targetSeasons ?? Array.Empty<int>())
                .Where(season => season >= 0 && season <= 1000)
                .ToHashSet();
            var output = new List<Dictionary<string, object?>>();

            if (source.ValueKind == JsonValueKind.Object &&
                source.TryGetProperty("seasons", out var seasons) &&
                seasons.ValueKind == JsonValueKind.Array)
            {
                foreach (var season in seasons.EnumerateArray())
                {
                    if (!TryReadInt(season, "seasonNumber", out var seasonNumber)) continue;
                    var row = JsonSerializer.Deserialize<Dictionary<string, object?>>(season.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
                    row["seasonNumber"] = seasonNumber;
                    row["monitored"] = requestAllSeasons || targets.Contains(seasonNumber) || (preserveExisting && ReadBool(season, "monitored"));
                    output.Add(row);
                }
            }

            foreach (var seasonNumber in targets)
            {
                if (output.Any(row => Convert.ToInt32(row["seasonNumber"], CultureInfo.InvariantCulture) == seasonNumber)) continue;
                output.Add(new Dictionary<string, object?>
                {
                    ["seasonNumber"] = seasonNumber,
                    ["monitored"] = true
                });
            }

            return output;
        }

        private static List<Dictionary<string, object?>> BuildSonarrSeasonUnmonitorPayload(
            JsonElement source,
            IReadOnlyCollection<int> targetSeasons)
        {
            var targets = (targetSeasons ?? Array.Empty<int>())
                .Where(season => season >= 0 && season <= 1000)
                .ToHashSet();
            var output = new List<Dictionary<string, object?>>();

            if (source.ValueKind == JsonValueKind.Object &&
                source.TryGetProperty("seasons", out var seasons) &&
                seasons.ValueKind == JsonValueKind.Array)
            {
                foreach (var season in seasons.EnumerateArray())
                {
                    if (!TryReadInt(season, "seasonNumber", out var seasonNumber)) continue;
                    var row = JsonSerializer.Deserialize<Dictionary<string, object?>>(season.GetRawText(), JsonOptions) ?? new Dictionary<string, object?>();
                    row["seasonNumber"] = seasonNumber;
                    if (targets.Contains(seasonNumber))
                    {
                        row["monitored"] = false;
                    }
                    output.Add(row);
                }
            }

            foreach (var seasonNumber in targets)
            {
                if (output.Any(row => Convert.ToInt32(row["seasonNumber"], CultureInfo.InvariantCulture) == seasonNumber)) continue;
                output.Add(new Dictionary<string, object?>
                {
                    ["seasonNumber"] = seasonNumber,
                    ["monitored"] = false
                });
            }

            return output;
        }

        private static List<int> GetArrTargetSeasons(SerrRequestEntry entry)
        {
            if (IsEpisodeOnlyRequest(entry))
            {
                return NormalizeEpisodes(entry.Episodes)
                    .Select(episode => episode.SeasonNumber)
                    .Distinct()
                    .OrderBy(season => season)
                    .ToList();
            }

            return NormalizeSeasons(entry.Seasons);
        }

        private async Task<SerrCallResult> SubmitToSeerr(JMSFusionConfiguration cfg, SerrRequestEntry entry, Guid adminUserId, CancellationToken cancellationToken)
        {
            var body = new Dictionary<string, object?>
            {
                ["mediaType"] = entry.MediaType,
                ["mediaId"] = entry.MediaId,
                ["is4k"] = entry.Is4K
            };

            if (entry.MediaType == "tv")
            {
                body["seasons"] = entry.RequestAllSeasons ? "all" : GetSerrSubmitSeasons(entry);
                if (entry.TvdbId.HasValue && entry.TvdbId.Value > 0) body["tvdbId"] = entry.TvdbId.Value;
            }

            if (cfg.SerrRequestAsJellyfinUser)
            {
                var mappedUserId = await ResolveSerrUserId(cfg, entry.JellyfinUserId, cancellationToken);
                if (mappedUserId.HasValue)
                {
                    body["userId"] = mappedUserId.Value;
                }
            }

            return await SendSerrAsync(cfg, HttpMethod.Post, "/request", body, cancellationToken);
        }

        private async Task<int?> ResolveSerrUserId(JMSFusionConfiguration cfg, string jellyfinUserId, CancellationToken cancellationToken)
        {
            var clean = (jellyfinUserId ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(clean)) return null;

            var candidates = new List<string>();
            if (Guid.TryParse(clean, out var guid))
            {
                candidates.Add(guid.ToString("N"));
                candidates.Add(guid.ToString("D"));
            }
            candidates.Add(clean);

            foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var response = await SendSerrAsync(cfg, HttpMethod.Get, "/user/jellyfin/" + Uri.EscapeDataString(candidate), null, cancellationToken);
                if (!response.Ok || response.Payload.ValueKind != JsonValueKind.Object) continue;
                if (TryReadInt(response.Payload, "id", out var id) && id > 0) return id;
            }

            return null;
        }

        private async Task SyncActiveRequests(CancellationToken cancellationToken)
        {
            List<SerrRequestEntry> active;
            JMSFusionConfiguration cfg;
            lock (SyncRoot)
            {
                cfg = GetConfig();
                active = (cfg.SerrRequests ?? new List<SerrRequestEntry>())
                    .Where(entry => entry.SerrRequestId.HasValue && !IsTerminalHidden(entry))
                    .OrderByDescending(entry => entry.UpdatedAtUtc > 0 ? entry.UpdatedAtUtc : entry.CreatedAtUtc)
                    .Take(MaxSyncPerListCall)
                    .Select(CloneEntry)
                    .ToList();
            }

            if (!active.Any()) return;

            var changed = false;
            var updates = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in active)
            {
                if (!entry.SerrRequestId.HasValue) continue;
                var response = await SendSerrAsync(cfg, HttpMethod.Get, "/request/" + entry.SerrRequestId.Value.ToString(CultureInfo.InvariantCulture), null, cancellationToken);
                if (response.Ok && response.Payload.ValueKind == JsonValueKind.Object)
                {
                    updates[entry.Id] = response.Payload;
                }
            }

            if (!updates.Any()) return;

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                cfg = plugin.Configuration;
                foreach (var pair in updates)
                {
                    var target = cfg.SerrRequests.FirstOrDefault(x => Same(x.Id, pair.Key));
                    if (target is null) continue;
                    var before = $"{target.Status}:{target.SerrRequestStatus}:{target.SerrMediaStatus}:{target.CompletedAtUtc}";
                    ApplySerrResponse(target, pair.Value);
                    MarkCompletedIfLocalAvailable(target);
                    var after = $"{target.Status}:{target.SerrRequestStatus}:{target.SerrMediaStatus}:{target.CompletedAtUtc}";
                    if (!string.Equals(before, after, StringComparison.Ordinal))
                    {
                        target.UpdatedAtUtc = NowMs();
                        changed = true;
                    }
                }

                if (changed)
                {
                    TouchSerr(cfg);
                    SerrRequestStore.Save(cfg);
                    plugin.UpdateConfiguration(cfg);
                }
            }
        }

        private static void ApplySerrResponse(SerrRequestEntry entry, JsonElement payload)
        {
            if (payload.ValueKind != JsonValueKind.Object) return;

            if (TryReadInt(payload, "id", out var requestId) && requestId > 0)
            {
                entry.SerrRequestId = requestId;
            }

            if (TryReadInt(payload, "status", out var requestStatus))
            {
                entry.SerrRequestStatus = requestStatus;
            }

            if (TryReadObject(payload, "media", out var media))
            {
                if (entry.Is4K && TryReadIntAny(media, out var mediaStatus4K, "status4k", "status4K"))
                {
                    entry.SerrMediaStatus = mediaStatus4K;
                }
                else if (TryReadInt(media, "status", out var mediaStatus))
                {
                    entry.SerrMediaStatus = mediaStatus;
                }
            }

            entry.Status = AreRequestedSeasonsCompleted(entry, payload)
                ? "completed"
                : MapStatus(entry.SerrRequestStatus, entry.SerrMediaStatus);
            if (IsCompletedStatus(entry.Status) && entry.CompletedAtUtc <= 0)
            {
                entry.CompletedAtUtc = NowMs();
            }
        }

        private static void ApplySerrResponsePayload(SerrRequestEntry entry, JsonElement payload)
        {
            if (payload.ValueKind != JsonValueKind.Object) return;
            if (TryReadObject(payload, "request", out var request))
            {
                ApplySerrResponse(entry, request);
                return;
            }

            ApplySerrResponse(entry, payload);
        }

        private static string MapStatus(int? requestStatus, int? mediaStatus)
        {
            if (requestStatus == 3) return "declined";
            if (requestStatus == 4) return "failed";
            if (requestStatus == 1) return "pending";
            if (mediaStatus == 5) return "completed";
            if (requestStatus == 5) return "approved";
            if (requestStatus == 2) return "approved";
            return "approved";
        }

        private static bool AreRequestedSeasonsCompleted(SerrRequestEntry entry, JsonElement payload)
        {
            if (!Same(entry.MediaType, "tv") || entry.RequestAllSeasons) return false;
            var requested = GetSerrSubmitSeasons(entry).Where(season => season > 0).ToHashSet();
            if (!requested.Any()) return false;

            if (TryReadSeasonStatusMap(payload, "seasons", out var requestSeasons) &&
                requested.All(season => requestSeasons.TryGetValue(season, out var status) && status == 5))
            {
                return true;
            }

            if (TryReadObject(payload, "media", out var media) &&
                TryReadSeasonStatusMap(media, "seasons", out var mediaSeasons) &&
                requested.All(season => mediaSeasons.TryGetValue(season, out var status) && status == 5))
            {
                return true;
            }

            return false;
        }

        private static List<int> GetSerrSubmitSeasons(SerrRequestEntry entry)
        {
            if (IsEpisodeOnlyRequest(entry))
            {
                return NormalizeEpisodes(entry.Episodes)
                    .Select(episode => episode.SeasonNumber)
                    .Where(season => season >= 0 && season <= 1000)
                    .Distinct()
                    .OrderBy(season => season)
                    .ToList();
            }

            return NormalizeSeasons(entry.Seasons).Distinct().OrderBy(season => season).ToList();
        }

        private static bool TryReadSeasonStatusMap(JsonElement source, string property, out Dictionary<int, int> statuses)
        {
            statuses = new Dictionary<int, int>();
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var arr) || arr.ValueKind != JsonValueKind.Array)
            {
                return false;
            }

            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                if (!TryReadIntAny(item, out var seasonNumber, "seasonNumber", "season_number", "season")) continue;
                if (!TryReadIntAny(item, out var status, "status", "status4k")) continue;
                statuses[seasonNumber] = status;
            }

            return statuses.Any();
        }

        private async Task<SerrCallResult> SendSerrAsync(JMSFusionConfiguration cfg, HttpMethod method, string pathAndQuery, object? body, CancellationToken cancellationToken)
        {
            try
            {
                var baseUrl = BuildSerrApiBase(cfg.SerrBaseUrl);
                if (baseUrl is null) return SerrCallResult.Fail(0, "Invalid Seerr URL.");

                var path = pathAndQuery.StartsWith("/", StringComparison.Ordinal) ? pathAndQuery[1..] : pathAndQuery;
                var url = new Uri(baseUrl, path);
                using var req = new HttpRequestMessage(method, url);
                req.Headers.TryAddWithoutValidation("Accept", "application/json");
                req.Headers.TryAddWithoutValidation("X-Api-Key", cfg.SerrApiKey);

                if (body is not null)
                {
                    req.Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions), Encoding.UTF8, "application/json");
                }

                using var res = await Http.SendAsync(req, cancellationToken);
                var raw = await res.Content.ReadAsStringAsync(cancellationToken);
                if (!res.IsSuccessStatusCode)
                {
                    return SerrCallResult.Fail((int)res.StatusCode, ExtractError(raw) ?? $"Seerr HTTP {(int)res.StatusCode}");
                }

                if (string.IsNullOrWhiteSpace(raw))
                {
                    return SerrCallResult.Success((int)res.StatusCode, default);
                }

                using var doc = JsonDocument.Parse(raw);
                return SerrCallResult.Success((int)res.StatusCode, doc.RootElement.Clone());
            }
            catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                return SerrCallResult.Fail(0, ex.Message);
            }
        }

        private IActionResult? EnsureConfigured(JMSFusionConfiguration cfg)
        {
            if (!IsSerrConnectionConfigured(cfg))
            {
                if (!cfg.EnableSerrIntegration)
                {
                    return StatusCode(403, new { ok = false, error = "Seerr integration is disabled." });
                }

                return StatusCode(412, new { ok = false, error = "Seerr URL and API key are required." });
            }

            return null;
        }

        private IActionResult? EnsureRequestBackendConfigured(JMSFusionConfiguration cfg, SerrCreateRequest request)
        {
            if (IsSerrConnectionConfigured(cfg)) return null;

            var mediaType = NormalizeMediaType(request.MediaType);
            if (CanSubmitToArrRequest(cfg, mediaType, request.Is4K == true)) return null;

            if (mediaType == "movie")
            {
                return StatusCode(412, new { ok = false, error = "Seerr is not configured and Arr/Radarr is not ready for movie requests." });
            }

            if (mediaType == "tv")
            {
                return StatusCode(412, new { ok = false, error = "Seerr is not configured and Arr/Sonarr is not ready for TV requests." });
            }

            return StatusCode(412, new { ok = false, error = "No configured Seerr or Arr backend can handle this request." });
        }

        private static bool IsSerrConnectionConfigured(JMSFusionConfiguration cfg)
            => cfg.EnableSerrIntegration &&
               !string.IsNullOrWhiteSpace(cfg.SerrBaseUrl) &&
               !string.IsNullOrWhiteSpace(cfg.SerrApiKey);

        private static bool IsAnyArrSearchConfigured(JMSFusionConfiguration cfg)
            => IsRadarrSearchConfigured(cfg) || IsSonarrSearchConfigured(cfg);

        private static bool IsAnyArrRequestConfigured(JMSFusionConfiguration cfg)
            => IsRadarrRequestConfigured(cfg) ||
               IsSonarrRequestConfigured(cfg) ||
               (cfg.SerrEnable4KRequests && (IsRadarr4KRequestConfigured(cfg) || IsSonarr4KRequestConfigured(cfg)));

        private static bool IsRadarrSearchConfigured(JMSFusionConfiguration cfg)
            => cfg.EnableArrIntegration &&
               cfg.ArrRadarrEnabled &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarrBaseUrl) &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarrApiKey);

        private static bool IsSonarrSearchConfigured(JMSFusionConfiguration cfg)
            => cfg.EnableArrIntegration &&
               cfg.ArrSonarrEnabled &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarrBaseUrl) &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarrApiKey);

        private static bool IsRadarrRequestConfigured(JMSFusionConfiguration cfg)
            => IsRadarrSearchConfigured(cfg) &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarrRootFolderPath) &&
               cfg.ArrRadarrQualityProfileId > 0;

        private static bool IsSonarrRequestConfigured(JMSFusionConfiguration cfg)
            => IsSonarrSearchConfigured(cfg) &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarrRootFolderPath) &&
               cfg.ArrSonarrQualityProfileId > 0;

        private static bool IsRadarr4KSearchConfigured(JMSFusionConfiguration cfg)
            => cfg.EnableArrIntegration &&
               cfg.ArrRadarr4KEnabled &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarr4KBaseUrl) &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarr4KApiKey);

        private static bool IsSonarr4KSearchConfigured(JMSFusionConfiguration cfg)
            => cfg.EnableArrIntegration &&
               cfg.ArrSonarr4KEnabled &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarr4KBaseUrl) &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarr4KApiKey);

        private static bool IsRadarr4KRequestConfigured(JMSFusionConfiguration cfg)
            => IsRadarr4KSearchConfigured(cfg) &&
               !string.IsNullOrWhiteSpace(cfg.ArrRadarr4KRootFolderPath) &&
               cfg.ArrRadarr4KQualityProfileId > 0;

        private static bool IsSonarr4KRequestConfigured(JMSFusionConfiguration cfg)
            => IsSonarr4KSearchConfigured(cfg) &&
               !string.IsNullOrWhiteSpace(cfg.ArrSonarr4KRootFolderPath) &&
               cfg.ArrSonarr4KQualityProfileId > 0;

        private static bool CanSubmitToArrRequest(JMSFusionConfiguration cfg, string mediaType, bool is4K)
            => (Same(mediaType, "movie") && (ShouldUseRadarr4K(cfg, is4K) || IsRadarrRequestConfigured(cfg))) ||
               (Same(mediaType, "tv") && (ShouldUseSonarr4K(cfg, is4K) || IsSonarrRequestConfigured(cfg)));

        private static bool CanSubmitToArr(JMSFusionConfiguration cfg, SerrRequestEntry entry)
            => CanSubmitToArrRequest(cfg, entry.MediaType, entry.Is4K);

        private static bool CanSubmitTo4KBackend(JMSFusionConfiguration cfg, SerrRequestEntry entry)
            => IsSerrConnectionConfigured(cfg) || CanSubmitTo4KArr(cfg, entry);

        private static bool CanSubmitTo4KArr(JMSFusionConfiguration cfg, SerrRequestEntry entry)
            => entry.Is4K &&
               ((Same(entry.MediaType, "movie") && IsRadarr4KRequestConfigured(cfg)) ||
                (Same(entry.MediaType, "tv") && IsSonarr4KRequestConfigured(cfg)));

        private static bool CanUpgradeTo4K(SerrRequestEntry entry)
            => !entry.Is4K &&
               !IsCompletedStatus(entry.Status) &&
               !Same(entry.Status, "declined") &&
               !Same(entry.Status, "withdrawn");

        private static bool ShouldUseRadarr4K(JMSFusionConfiguration cfg, bool is4K)
            => is4K && IsRadarr4KRequestConfigured(cfg);

        private static bool ShouldUseSonarr4K(JMSFusionConfiguration cfg, bool is4K)
            => is4K && IsSonarr4KRequestConfigured(cfg);

        private static bool ShouldUseRadarr4KForDownloads(JMSFusionConfiguration cfg, SerrRequestEntry entry)
            => entry.Is4K && IsRadarr4KSearchConfigured(cfg);

        private static bool ShouldUseSonarr4KForDownloads(JMSFusionConfiguration cfg, SerrRequestEntry entry)
            => entry.Is4K && IsSonarr4KSearchConfigured(cfg);

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

        private IActionResult? ValidateJellyfinAvailability(SerrCreateRequest request)
        {
            if (IsRequestAvailableInJellyfin(request))
            {
                return StatusCode(409, new
                {
                    ok = false,
                    code = "serrAlreadyAvailable",
                    error = "This item is already available in Jellyfin."
                });
            }

            return null;
        }

        private bool CompleteLocallyAvailableRequests()
        {
            var changed = false;
            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                NormalizeSerrRequests(cfg);

                foreach (var entry in cfg.SerrRequests.Where(entry => !IsTerminalHidden(entry)))
                {
                    if (!MarkCompletedIfLocalAvailable(entry)) continue;
                    entry.UpdatedAtUtc = NowMs();
                    changed = true;
                }

                if (changed)
                {
                    TouchSerr(cfg);
                    SerrRequestStore.Save(cfg);
                    plugin.UpdateConfiguration(cfg);
                }
            }

            return changed;
        }

        private bool MarkCompletedIfLocalAvailable(SerrRequestEntry entry)
        {
            if (!IsRequestAvailableInJellyfin(entry)) return false;
            if (IsCompletedStatus(entry.Status)) return false;

            entry.Status = "completed";
            entry.CompletedAtUtc = entry.CompletedAtUtc > 0 ? entry.CompletedAtUtc : NowMs();
            entry.Error = string.Empty;
            return true;
        }

        private bool IsRequestAvailableInJellyfin(SerrCreateRequest request)
        {
            if (IsJellyfinItemAvailable(request.JellyfinItemId)) return true;
            var mediaType = NormalizeMediaType(request.MediaType);
            if (mediaType == "movie")
            {
                return request.MediaId.HasValue && IsJellyfinMovieAvailableByTmdb(request.MediaId.Value);
            }

            if (mediaType == "tv")
            {
                var entry = new SerrRequestEntry
                {
                    MediaType = "tv",
                    MediaId = request.MediaId ?? 0,
                    TvdbId = request.TvdbId,
                    Title = CleanText(request.Title, MaxTitleLength),
                    Seasons = NormalizeSeasons(request.Seasons),
                    Episodes = NormalizeEpisodes(request.Episodes),
                    RequestAllSeasons = request.RequestAllSeasons == true,
                    JellyfinItemId = CleanText(request.JellyfinItemId, 80)
                };
                return IsJellyfinTvRequestAvailable(entry);
            }

            return false;
        }

        private bool IsRequestAvailableInJellyfin(SerrRequestEntry entry)
        {
            if (IsJellyfinItemAvailable(entry.JellyfinItemId)) return true;
            if (Same(entry.MediaType, "movie")) return IsJellyfinMovieAvailableByTmdb(entry.MediaId);
            if (Same(entry.MediaType, "tv")) return IsJellyfinTvRequestAvailable(entry);
            return false;
        }

        private bool IsJellyfinItemAvailable(string? itemId)
        {
            var clean = CleanText(itemId, 80);
            if (string.IsNullOrWhiteSpace(clean) || !Guid.TryParse(clean, out var guid)) return false;

            try
            {
                var item = _libraryManager.GetItemById(guid);
                return IsAvailableLibraryItem(item);
            }
            catch
            {
                return false;
            }
        }

        private bool IsJellyfinMovieAvailableByTmdb(int tmdbId)
        {
            if (tmdbId <= 0) return false;

            try
            {
                var tmdb = tmdbId.ToString(CultureInfo.InvariantCulture);
                var query = new InternalItemsQuery
                {
                    Recursive = true,
                    IncludeItemTypes = new[] { BaseItemKind.Movie },
                    HasAnyProviderId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                    {
                        ["Tmdb"] = tmdb,
                        ["TMDb"] = tmdb,
                        ["TheMovieDb"] = tmdb,
                        ["MovieDb"] = tmdb
                    },
                    IsMissing = false,
                    Limit = 20,
                    EnableTotalRecordCount = false
                };

                return (_libraryManager.GetItemList(query) ?? Array.Empty<BaseItem>())
                    .Any(IsAvailableLibraryItem);
            }
            catch
            {
                return false;
            }
        }

        private bool IsJellyfinTvRequestAvailable(SerrRequestEntry entry)
        {
            var seriesItems = FindJellyfinSeriesForRequest(entry);
            if (!seriesItems.Any()) return false;

            foreach (var series in seriesItems)
            {
                var episodes = FindJellyfinEpisodesForSeries(series)
                    .Where(IsAvailableLibraryItem)
                    .ToList();
                if (!episodes.Any()) continue;

                if (IsEpisodeOnlyRequest(entry))
                {
                    var requestedEpisodes = NormalizeEpisodes(entry.Episodes);
                    if (requestedEpisodes.Any() &&
                        requestedEpisodes.All(requested => episodes.Any(episode => EpisodeMatchesRequest(episode, requested))))
                    {
                        return true;
                    }

                    continue;
                }

                var requestedSeasons = NormalizeSeasons(entry.Seasons);
                if (entry.RequestAllSeasons || requestedSeasons.Count == 0)
                {
                    return true;
                }

                if (requestedSeasons.All(season => episodes.Any(episode => EpisodeSeasonNumber(episode) == season)))
                {
                    return true;
                }
            }

            return false;
        }

        private IReadOnlyList<BaseItem> FindJellyfinSeriesForRequest(SerrRequestEntry entry)
        {
            var output = new List<BaseItem>();
            try
            {
                var providerIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                if (entry.MediaId > 0)
                {
                    var tmdb = entry.MediaId.ToString(CultureInfo.InvariantCulture);
                    providerIds["Tmdb"] = tmdb;
                    providerIds["TMDb"] = tmdb;
                    providerIds["TheMovieDb"] = tmdb;
                    providerIds["MovieDb"] = tmdb;
                }

                if (entry.TvdbId.HasValue && entry.TvdbId.Value > 0)
                {
                    var tvdb = entry.TvdbId.Value.ToString(CultureInfo.InvariantCulture);
                    providerIds["Tvdb"] = tvdb;
                    providerIds["TVDB"] = tvdb;
                }

                if (providerIds.Any())
                {
                    output.AddRange((_libraryManager.GetItemList(new InternalItemsQuery
                    {
                        Recursive = true,
                        IncludeItemTypes = new[] { BaseItemKind.Series },
                        HasAnyProviderId = providerIds,
                        IsMissing = false,
                        Limit = 20,
                        EnableTotalRecordCount = false
                    }) ?? Array.Empty<BaseItem>()).Where(item => item is Series));
                }

                var title = CleanKey(entry.Title);
                if (!string.IsNullOrWhiteSpace(title))
                {
                    output.AddRange((_libraryManager.GetItemList(new InternalItemsQuery
                    {
                        Recursive = true,
                        IncludeItemTypes = new[] { BaseItemKind.Series },
                        SearchTerm = entry.Title,
                        IsMissing = false,
                        Limit = 20,
                        EnableTotalRecordCount = false
                    }) ?? Array.Empty<BaseItem>())
                        .Where(item => item is Series && string.Equals(CleanKey(item.Name), title, StringComparison.OrdinalIgnoreCase)));
                }
            }
            catch
            {
                return Array.Empty<BaseItem>();
            }

            return output
                .GroupBy(item => item.Id)
                .Select(group => group.First())
                .ToList();
        }

        private IReadOnlyList<BaseItem> FindJellyfinEpisodesForSeries(BaseItem series)
        {
            if (series.Id == Guid.Empty) return Array.Empty<BaseItem>();

            try
            {
                return (_libraryManager.GetItemList(new InternalItemsQuery
                {
                    Recursive = true,
                    IncludeItemTypes = new[] { BaseItemKind.Episode },
                    AncestorIds = new[] { series.Id },
                    IsMissing = false,
                    Limit = 10000,
                    EnableTotalRecordCount = false
                }) ?? Array.Empty<BaseItem>())
                    .Where(item => item is Episode)
                    .ToList();
            }
            catch
            {
                return Array.Empty<BaseItem>();
            }
        }

        private static bool EpisodeMatchesRequest(BaseItem item, SerrEpisodeSelectionEntry requested)
        {
            if (EpisodeSeasonNumber(item) != requested.SeasonNumber) return false;
            if (item is Episode episode && episode.ContainsEpisodeNumber(requested.EpisodeNumber)) return true;
            return EpisodeNumber(item) == requested.EpisodeNumber;
        }

        private static int EpisodeSeasonNumber(BaseItem item)
            => item.ParentIndexNumber ?? -1;

        private static int EpisodeNumber(BaseItem item)
            => item.IndexNumber ?? -1;

        private IReadOnlyList<BaseItem> FindJellyfinItemsByTmdb(int tmdbId)
        {
            if (tmdbId <= 0) return Array.Empty<BaseItem>();

            try
            {
                var tmdb = tmdbId.ToString(CultureInfo.InvariantCulture);
                var query = new InternalItemsQuery
                {
                    Recursive = true,
                    IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series },
                    HasAnyProviderId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                    {
                        ["Tmdb"] = tmdb,
                        ["TMDb"] = tmdb,
                        ["TheMovieDb"] = tmdb,
                        ["MovieDb"] = tmdb
                    },
                    IsMissing = false,
                    Limit = 20,
                    EnableTotalRecordCount = false
                };

                return (_libraryManager.GetItemList(query) ?? Array.Empty<BaseItem>())
                    .OrderBy(item => item.SortName)
                    .ThenBy(item => item.Name)
                    .ToList();
            }
            catch
            {
                return Array.Empty<BaseItem>();
            }
        }

        private static object ToLocalSearchDto(BaseItem item)
        {
            var type = item.GetType().Name;
            return new
            {
                Id = NormalizeItemId(item),
                item.Name,
                Type = type,
                item.ProductionYear,
                item.OfficialRating,
                item.CommunityRating,
                item.RunTimeTicks,
                item.Overview
            };
        }

        private static bool IsAvailableLibraryItem(BaseItem? item)
        {
            if (item is null) return false;
            if (item.LocationType == LocationType.Virtual) return false;
            return item.LocationType == LocationType.FileSystem ||
                   !string.IsNullOrWhiteSpace(item.Path) ||
                   item.RunTimeTicks > 0;
        }

        private IActionResult? ValidateRequest(SerrCreateRequest? request)
        {
            if (request is null) return BadRequest(new { ok = false, error = "Request body is required." });
            var mediaType = NormalizeMediaType(request.MediaType);
            if (mediaType != "movie" && mediaType != "tv")
            {
                return BadRequest(new { ok = false, error = "mediaType must be movie or tv." });
            }

            if (!request.MediaId.HasValue || request.MediaId.Value <= 0)
            {
                return BadRequest(new { ok = false, error = "mediaId is required." });
            }

            request.MediaType = mediaType;
            request.Episodes = NormalizeEpisodes(request.Episodes)
                .Select(entry => new SerrEpisodeSelectionRequest
                {
                    SeasonNumber = entry.SeasonNumber,
                    EpisodeNumber = entry.EpisodeNumber,
                    Name = entry.Name
                })
                .ToList();
            request.Seasons = NormalizeSeasons(request.Seasons);
            if (mediaType == "tv" && request.RequestAllSeasons != true && request.Episodes.Any())
            {
                request.Seasons = new List<int>();
            }
            if (mediaType == "tv" && request.RequestAllSeasons != true && !request.Episodes.Any() && !request.Seasons.Any())
            {
                request.RequestAllSeasons = true;
            }
            return null;
        }

        private SerrRequestEntry BuildEntry(SerrCreateRequest request, User? user, Guid userId, bool isAdmin, long now)
        {
            return new SerrRequestEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                JellyfinUserId = userId.ToString("D"),
                JellyfinUserName = CleanText(user?.Username, 80),
                JellyfinUserIsAdmin = isAdmin,
                Title = CleanText(request.Title, MaxTitleLength),
                MediaType = NormalizeMediaType(request.MediaType),
                MediaId = request.MediaId ?? 0,
                TvdbId = request.TvdbId,
                Seasons = NormalizeSeasons(request.Seasons),
                Episodes = NormalizeEpisodes(request.Episodes),
                RequestAllSeasons = request.RequestAllSeasons == true,
                Is4K = request.Is4K == true,
                Source = CleanText(request.Source, 60),
                JellyfinItemId = CleanText(request.JellyfinItemId, 80),
                Status = isAdmin ? "approved" : "pending",
                CreatedAtUtc = now,
                UpdatedAtUtc = now
            };
        }

        private SerrRequestEntry? FindBlockingDuplicate(JMSFusionConfiguration cfg, SerrCreateRequest request)
        {
            var mediaType = NormalizeMediaType(request.MediaType);
            var seasons = NormalizeSeasons(request.Seasons);
            var episodes = NormalizeEpisodes(request.Episodes);
            var episodeOnly = mediaType == "tv" && request.RequestAllSeasons != true && episodes.Any();
            var all = request.RequestAllSeasons == true || (mediaType == "tv" && !episodeOnly && !seasons.Any());
            var scope = CreateRequestScope(mediaType, all, seasons, episodes);

            return (cfg.SerrRequests ?? new List<SerrRequestEntry>()).FirstOrDefault(entry =>
                Same(entry.MediaType, mediaType) &&
                entry.MediaId == request.MediaId &&
                entry.Is4K == (request.Is4K == true) &&
                !IsLegacyLocalOnlyEpisodeRequest(entry, episodeOnly) &&
                IsDuplicateBlockingStatus(entry.Status, includePending: true) &&
                RequestScopesOverlap(scope, EntryRequestScope(entry)));
        }

        private SerrRequestEntry? FindBlockingDuplicate(SerrRequestEntry request, bool includePending)
        {
            lock (SyncRoot)
            {
                var cfg = GetConfig();
                NormalizeSerrRequests(cfg);
                var scope = EntryRequestScope(request);
                return (cfg.SerrRequests ?? new List<SerrRequestEntry>()).FirstOrDefault(entry =>
                    !Same(entry.Id, request.Id) &&
                    Same(entry.MediaType, request.MediaType) &&
                    entry.MediaId == request.MediaId &&
                    entry.Is4K == request.Is4K &&
                    IsDuplicateBlockingStatus(entry.Status, includePending) &&
                    RequestScopesOverlap(scope, EntryRequestScope(entry)));
            }
        }

        private static SerrRequestScope CreateRequestScope(
            string mediaType,
            bool requestAllSeasons,
            IReadOnlyCollection<int>? seasons,
            IReadOnlyCollection<SerrEpisodeSelectionEntry>? episodes)
        {
            if (!Same(mediaType, "tv")) return new SerrRequestScope(true, new HashSet<int>());
            if (requestAllSeasons) return new SerrRequestScope(true, new HashSet<int>());

            var selected = NormalizeEpisodes(episodes)
                .Select(episode => episode.SeasonNumber)
                .Concat(NormalizeSeasons(seasons))
                .Where(season => season >= 0)
                .ToHashSet();

            return selected.Count == 0
                ? new SerrRequestScope(true, selected)
                : new SerrRequestScope(false, selected);
        }

        private static SerrRequestScope EntryRequestScope(SerrRequestEntry entry)
            => CreateRequestScope(
                entry.MediaType,
                entry.RequestAllSeasons == true,
                entry.Seasons,
                entry.Episodes);

        private static bool RequestScopesOverlap(SerrRequestScope left, SerrRequestScope right)
        {
            if (left.All || right.All) return true;
            return left.Seasons.Overlaps(right.Seasons);
        }

        private static bool IsDuplicateBlockingStatus(string? status, bool includePending)
            => (includePending || !Same(status, "pending")) &&
               !Same(status, "declined") &&
               !Same(status, "failed") &&
               !Same(status, "withdrawn");

        private static string BuildDuplicateMessage(SerrRequestEntry entry, Guid userId)
        {
            var owner = Same(entry.JellyfinUserId, userId.ToString("D"))
                ? "This request was already created by you"
                : "This request was created by another user";
            return owner + " and " + DuplicateStatusText(entry.Status) + ".";
        }

        private static string DuplicateStatusText(string? status)
        {
            if (Same(status, "pending")) return "is pending approval";
            if (Same(status, "processing")) return "was approved";
            if (Same(status, "completed") || Same(status, "available")) return "is completed";
            if (Same(status, "declined")) return "was declined";
            if (Same(status, "failed")) return "failed";
            if (Same(status, "withdrawn")) return "was withdrawn";
            return "was approved";
        }

        private readonly record struct SerrRequestScope(bool All, HashSet<int> Seasons);

        private SerrRequestEntry? GetRequestById(string id)
        {
            lock (SyncRoot)
            {
                var cfg = GetConfig();
                SerrRequestStore.Save(cfg);
                return cfg.SerrRequests.FirstOrDefault(entry => Same(entry.Id, id)) is { } entry
                    ? CloneEntry(entry)
                    : null;
            }
        }

        private async Task<Dictionary<string, ArrDownloadSnapshot>> ResolveArrDownloadSnapshots(
            IReadOnlyList<SerrRequestEntry> entries,
            JMSFusionConfiguration cfg,
            CancellationToken cancellationToken)
        {
            var output = new Dictionary<string, ArrDownloadSnapshot>(StringComparer.OrdinalIgnoreCase);
            var candidates = (entries ?? Array.Empty<SerrRequestEntry>())
                .Where(ShouldCheckArrDownload)
                .ToList();
            if (!candidates.Any() || !cfg.EnableArrIntegration) return output;

            var movies = candidates.Where(entry => Same(entry.MediaType, "movie")).ToList();
            await ResolveRadarrDownloadSnapshots(
                movies.Where(entry => !ShouldUseRadarr4KForDownloads(cfg, entry)).ToList(),
                cfg,
                use4K: false,
                output,
                cancellationToken);
            await ResolveRadarrDownloadSnapshots(
                movies.Where(entry => ShouldUseRadarr4KForDownloads(cfg, entry)).ToList(),
                cfg,
                use4K: true,
                output,
                cancellationToken);

            var tv = candidates.Where(entry => Same(entry.MediaType, "tv")).ToList();
            await ResolveSonarrDownloadSnapshots(
                tv.Where(entry => !ShouldUseSonarr4KForDownloads(cfg, entry)).ToList(),
                cfg,
                use4K: false,
                output,
                cancellationToken);
            await ResolveSonarrDownloadSnapshots(
                tv.Where(entry => ShouldUseSonarr4KForDownloads(cfg, entry)).ToList(),
                cfg,
                use4K: true,
                output,
                cancellationToken);

            return output;
        }

        private async Task ResolveRadarrDownloadSnapshots(
            IReadOnlyList<SerrRequestEntry> movies,
            JMSFusionConfiguration cfg,
            bool use4K,
            IDictionary<string, ArrDownloadSnapshot> output,
            CancellationToken cancellationToken)
        {
            if (movies.Count == 0) return;
            if (use4K ? !IsRadarr4KSearchConfigured(cfg) : !IsRadarrSearchConfigured(cfg)) return;

            var serviceName = use4K ? "4K Radarr" : "Radarr";
            var serviceKey = use4K ? "radarr4k" : "radarr";
            var queue = await FetchArrRecordsCached(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), serviceName, "/queue?page=1&pageSize=1000&includeUnknownMovieItems=true", ArrQueueCacheMs, cancellationToken);
            var radarrMovies = await FetchArrRecordsCached(RadarrBaseUrl(cfg, use4K), RadarrApiKey(cfg, use4K), serviceName, "/movie", ArrLookupCacheMs, cancellationToken);
            var movieById = radarrMovies
                .Where(item => TryReadInt(item, "id", out var id) && id > 0)
                .GroupBy(item => ReadIntValue(item, "id"))
                .ToDictionary(group => group.Key, group => group.First(), EqualityComparer<int>.Default);

            foreach (var entry in movies)
            {
                var matches = queue
                    .Where(record => RadarrQueueMatches(entry, record, movieById))
                    .Select(record => TryBuildDownloadSnapshot(record, serviceKey))
                    .Where(snapshot => snapshot is not null)
                    .Select(snapshot => snapshot!)
                    .ToList();
                var snapshot = AggregateDownloadSnapshots(serviceKey, matches);
                if (snapshot is not null) output[entry.Id] = snapshot;
            }
        }

        private async Task ResolveSonarrDownloadSnapshots(
            IReadOnlyList<SerrRequestEntry> tv,
            JMSFusionConfiguration cfg,
            bool use4K,
            IDictionary<string, ArrDownloadSnapshot> output,
            CancellationToken cancellationToken)
        {
            if (tv.Count == 0) return;
            if (use4K ? !IsSonarr4KSearchConfigured(cfg) : !IsSonarrSearchConfigured(cfg)) return;

            var serviceName = use4K ? "4K Sonarr" : "Sonarr";
            var serviceKey = use4K ? "sonarr4k" : "sonarr";
            var queue = await FetchArrRecordsCached(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), serviceName, "/queue?page=1&pageSize=1000", ArrQueueCacheMs, cancellationToken);
            var series = await FetchArrRecordsCached(SonarrBaseUrl(cfg, use4K), SonarrApiKey(cfg, use4K), serviceName, "/series", ArrLookupCacheMs, cancellationToken);
            var seriesById = series
                .Where(item => TryReadInt(item, "id", out var id) && id > 0)
                .GroupBy(item => ReadIntValue(item, "id"))
                .ToDictionary(group => group.Key, group => group.First(), EqualityComparer<int>.Default);

            foreach (var entry in tv)
            {
                var matches = queue
                    .Where(record => SonarrQueueMatches(entry, record, seriesById))
                    .Select(record => TryBuildDownloadSnapshot(record, serviceKey))
                    .Where(snapshot => snapshot is not null)
                    .Select(snapshot => snapshot!)
                    .ToList();
                var snapshot = AggregateDownloadSnapshots(serviceKey, matches);
                if (snapshot is not null) output[entry.Id] = snapshot;
            }
        }

        private async Task<List<JsonElement>> FetchArrRecords(string baseUrl, string apiKey, string serviceName, string pathAndQuery, CancellationToken cancellationToken)
        {
            var response = await SendArrAsync(baseUrl, apiKey, serviceName, HttpMethod.Get, pathAndQuery, null, cancellationToken);
            if (!response.Ok) return new List<JsonElement>();
            return ExtractArrRecords(response.Payload);
        }

        private async Task<List<JsonElement>> FetchArrRecordsCached(
            string baseUrl,
            string apiKey,
            string serviceName,
            string pathAndQuery,
            int cacheMs,
            CancellationToken cancellationToken)
        {
            var key = BuildArrRecordsCacheKey(baseUrl, serviceName, pathAndQuery);
            var now = NowMs();
            Task<List<JsonElement>>? fetchTask;
            lock (ArrRecordsCacheRoot)
            {
                if (ArrRecordsCache.TryGetValue(key, out var cached) && cached.ExpiresAtUtc > now)
                {
                    return cached.Records.ToList();
                }

                if (!ArrRecordsInFlight.TryGetValue(key, out fetchTask))
                {
                    fetchTask = FetchArrRecords(baseUrl, apiKey, serviceName, pathAndQuery, CancellationToken.None);
                    ArrRecordsInFlight[key] = fetchTask;
                }
            }

            if (fetchTask is null) return new List<JsonElement>();
            return await AwaitAndCacheArrRecords(key, fetchTask, cacheMs, cancellationToken);
        }

        private static async Task<List<JsonElement>> AwaitAndCacheArrRecords(
            string key,
            Task<List<JsonElement>> fetchTask,
            int cacheMs,
            CancellationToken cancellationToken)
        {
            var records = await fetchTask.WaitAsync(cancellationToken);
            lock (ArrRecordsCacheRoot)
            {
                if (ArrRecordsInFlight.TryGetValue(key, out var currentFetch) && ReferenceEquals(currentFetch, fetchTask))
                {
                    ArrRecordsInFlight.Remove(key);
                }

                ArrRecordsCache[key] = new ArrRecordCacheEntry(
                    NowMs() + Math.Max(500, cacheMs),
                    records.Select(item => item.Clone()).ToList());
                PruneArrRecordsCache(NowMs());
            }

            return records;
        }

        private static bool ShouldCheckArrDownload(SerrRequestEntry entry)
        {
            if (entry is null) return false;
            if (!Same(entry.MediaType, "movie") && !Same(entry.MediaType, "tv")) return false;
            if (Same(entry.Status, "pending") || Same(entry.Status, "declined") || Same(entry.Status, "withdrawn")) return false;
            return entry.MediaId > 0 || !string.IsNullOrWhiteSpace(entry.Title);
        }

        private static List<JsonElement> ExtractArrRecords(JsonElement payload)
        {
            if (payload.ValueKind == JsonValueKind.Array)
            {
                return payload.EnumerateArray()
                    .Where(item => item.ValueKind == JsonValueKind.Object)
                    .Select(item => item.Clone())
                    .ToList();
            }

            if (payload.ValueKind == JsonValueKind.Object &&
                payload.TryGetProperty("records", out var records) &&
                records.ValueKind == JsonValueKind.Array)
            {
                return records.EnumerateArray()
                    .Where(item => item.ValueKind == JsonValueKind.Object)
                    .Select(item => item.Clone())
                    .ToList();
            }

            return new List<JsonElement>();
        }

        private static bool RadarrQueueMatches(SerrRequestEntry entry, JsonElement record, IReadOnlyDictionary<int, JsonElement> movieById)
        {
            var movie = TryReadObject(record, "movie", out var directMovie) ? directMovie : default;
            if (entry.MediaId > 0)
            {
                if (TryReadIntAny(record, out var recordTmdb, "tmdbId", "tmdb") && recordTmdb == entry.MediaId) return true;
                if (movie.ValueKind == JsonValueKind.Object && TryReadIntAny(movie, out var movieTmdb, "tmdbId", "tmdb") && movieTmdb == entry.MediaId) return true;
                if (TryReadInt(record, "movieId", out var movieId) &&
                    movieById.TryGetValue(movieId, out var storedMovie) &&
                    TryReadIntAny(storedMovie, out var storedTmdb, "tmdbId", "tmdb") &&
                    storedTmdb == entry.MediaId)
                {
                    return true;
                }
            }

            var requestedTitle = CleanKey(entry.Title);
            if (string.IsNullOrWhiteSpace(requestedTitle)) return false;
            var recordTitle = CleanKey(ReadStringAny(record, "title", "downloadTitle"));
            if (string.Equals(recordTitle, requestedTitle, StringComparison.OrdinalIgnoreCase)) return true;
            if (movie.ValueKind == JsonValueKind.Object)
            {
                var movieTitle = CleanKey(ReadStringAny(movie, "title", "originalTitle"));
                if (string.Equals(movieTitle, requestedTitle, StringComparison.OrdinalIgnoreCase)) return true;
            }

            return false;
        }

        private static bool SonarrQueueMatches(SerrRequestEntry entry, JsonElement record, IReadOnlyDictionary<int, JsonElement> seriesById)
        {
            var series = TryReadObject(record, "series", out var directSeries)
                ? directSeries
                : (TryReadInt(record, "seriesId", out var seriesId) && seriesById.TryGetValue(seriesId, out var storedSeries) ? storedSeries : default);
            if (!SeriesMatches(entry, series, record)) return false;
            if (entry.RequestAllSeasons) return true;

            var pairs = ReadQueueEpisodePairs(record);
            var episodes = NormalizeEpisodes(entry.Episodes);
            if (episodes.Any())
            {
                return pairs.Any(pair => episodes.Any(episode =>
                    episode.SeasonNumber == pair.Season &&
                    episode.EpisodeNumber == pair.Episode));
            }

            var seasons = NormalizeSeasons(entry.Seasons);
            if (seasons.Any())
            {
                return !pairs.Any() || pairs.Any(pair => seasons.Contains(pair.Season));
            }

            return true;
        }

        private static bool SeriesMatches(SerrRequestEntry entry, JsonElement series, JsonElement record)
        {
            if (entry.TvdbId.HasValue && entry.TvdbId.Value > 0)
            {
                if (series.ValueKind == JsonValueKind.Object && TryReadIntAny(series, out var tvdb, "tvdbId", "tvdb") && tvdb == entry.TvdbId.Value) return true;
                if (TryReadIntAny(record, out var recordTvdb, "tvdbId", "tvdb") && recordTvdb == entry.TvdbId.Value) return true;
            }

            if (entry.MediaId > 0)
            {
                if (series.ValueKind == JsonValueKind.Object && TryReadIntAny(series, out var tmdb, "tmdbId", "tmdb") && tmdb == entry.MediaId) return true;
                if (TryReadIntAny(record, out var recordTmdb, "tmdbId", "tmdb") && recordTmdb == entry.MediaId) return true;
            }

            var requestedTitle = CleanKey(entry.Title);
            if (string.IsNullOrWhiteSpace(requestedTitle)) return false;
            if (series.ValueKind == JsonValueKind.Object &&
                string.Equals(CleanKey(ReadStringAny(series, "title", "sortTitle")), requestedTitle, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return string.Equals(CleanKey(ReadStringAny(record, "seriesTitle", "title")), requestedTitle, StringComparison.OrdinalIgnoreCase);
        }

        private static List<(int Season, int Episode)> ReadQueueEpisodePairs(JsonElement record)
        {
            var output = new List<(int Season, int Episode)>();
            AddEpisodePair(record, output);
            if (TryReadObject(record, "episode", out var episode)) AddEpisodePair(episode, output);
            if (record.ValueKind == JsonValueKind.Object &&
                record.TryGetProperty("episodes", out var episodes) &&
                episodes.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in episodes.EnumerateArray())
                {
                    AddEpisodePair(item, output);
                }
            }

            return output
                .Where(pair => pair.Season >= 0)
                .Distinct()
                .ToList();
        }

        private static void AddEpisodePair(JsonElement source, List<(int Season, int Episode)> output)
        {
            if (source.ValueKind != JsonValueKind.Object) return;
            if (!TryReadIntAny(source, out var season, "seasonNumber", "season", "parentIndexNumber")) return;
            var episode = TryReadIntAny(source, out var episodeNumber, "episodeNumber", "episode", "indexNumber") ? episodeNumber : -1;
            output.Add((season, episode));
        }

        private static ArrDownloadSnapshot? TryBuildDownloadSnapshot(JsonElement record, string service)
        {
            var size = ReadLongAny(record, "size", "totalSize");
            var sizeLeft = ReadLongAny(record, "sizeleft", "sizeLeft", "remainingSize", "bytesLeft");
            var progress = ComputeProgressPercent(size, sizeLeft);
            if (!IsActivelyDownloading(record, progress)) return null;

            return new ArrDownloadSnapshot
            {
                Service = service,
                Title = ReadStringAny(record, "title", "downloadTitle"),
                Status = ReadStringAny(record, "status", "trackedDownloadState", "trackedDownloadStatus"),
                DownloadClient = ReadStringAny(record, "downloadClient"),
                TimeLeft = ReadStringAny(record, "timeleft", "timeLeft", "estimatedCompletionTime"),
                Size = size,
                SizeLeft = sizeLeft,
                ProgressPercent = progress
            };
        }

        private static bool IsActivelyDownloading(JsonElement record, double progress)
        {
            var statuses = new[]
            {
                ReadStringAny(record, "status"),
                ReadStringAny(record, "trackedDownloadState"),
                ReadStringAny(record, "trackedDownloadStatus")
            }
                .Select(status => status.Trim().ToLowerInvariant())
                .Where(status => !string.IsNullOrWhiteSpace(status))
                .ToList();

            if (statuses.Any(status => status == "downloading")) return true;
            if (statuses.Any(status =>
                status.Contains("paused", StringComparison.OrdinalIgnoreCase) ||
                status.Contains("queued", StringComparison.OrdinalIgnoreCase) ||
                status.Contains("delay", StringComparison.OrdinalIgnoreCase) ||
                status.Contains("completed", StringComparison.OrdinalIgnoreCase) ||
                status.Contains("failed", StringComparison.OrdinalIgnoreCase)))
            {
                return false;
            }

            return progress > 0 && progress < 100 && statuses.Count == 0;
        }

        private static ArrDownloadSnapshot? AggregateDownloadSnapshots(string service, IReadOnlyList<ArrDownloadSnapshot> snapshots)
        {
            if (snapshots is null || snapshots.Count == 0) return null;
            if (snapshots.Count == 1) return snapshots[0];

            var size = snapshots.Sum(snapshot => snapshot.Size);
            var sizeLeft = snapshots.Sum(snapshot => snapshot.SizeLeft);
            var progress = size > 0 ? ComputeProgressPercent(size, sizeLeft) : snapshots.Max(snapshot => snapshot.ProgressPercent);
            var first = snapshots[0];
            return new ArrDownloadSnapshot
            {
                Service = service,
                Title = first.Title,
                Status = first.Status,
                DownloadClient = first.DownloadClient,
                TimeLeft = first.TimeLeft,
                Size = size,
                SizeLeft = sizeLeft,
                ProgressPercent = progress,
                ItemCount = snapshots.Count
            };
        }

        private async Task<ArrApiCallResult> SendArrAsync(string baseUrl, string apiKey, string serviceName, HttpMethod method, string pathAndQuery, object? body, CancellationToken cancellationToken)
        {
            try
            {
                var apiBase = BuildArrApiBase(baseUrl);
                if (apiBase is null) return ArrApiCallResult.Fail(400, "Invalid " + serviceName + " URL.");

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
                    return ArrApiCallResult.Fail((int)response.StatusCode, ExtractError(raw) ?? (serviceName + " HTTP " + (int)response.StatusCode));
                }

                if (string.IsNullOrWhiteSpace(raw)) return ArrApiCallResult.Success((int)response.StatusCode, default);
                using var doc = JsonDocument.Parse(raw);
                return ArrApiCallResult.Success((int)response.StatusCode, doc.RootElement.Clone());
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                return ArrApiCallResult.Fail(500, ex.Message);
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

        private static object ToRequestDto(SerrRequestEntry entry, bool includeAdminFields, ArrDownloadSnapshot? download = null, JMSFusionConfiguration? cfg = null)
        {
            var status = DisplayStatus(entry.Status, download);
            var serrUrl = BuildSerrMediaWebUrl(cfg ?? GetConfig(), entry);
            return new
            {
                entry.Id,
                entry.Title,
                entry.MediaType,
                entry.MediaId,
                entry.TvdbId,
                seasons = entry.RequestAllSeasons || IsEpisodeOnlyRequest(entry) ? Array.Empty<int>() : entry.Seasons.ToArray(),
                episodes = entry.Episodes.Select(episode => new
                {
                    episode.SeasonNumber,
                    episode.EpisodeNumber,
                    episode.Name
                }).ToArray(),
                entry.RequestAllSeasons,
                episodeOnly = IsEpisodeOnlyRequest(entry),
                entry.Is4K,
                entry.Source,
                entry.JellyfinItemId,
                Status = status,
                rawStatus = entry.Status,
                entry.SerrRequestId,
                SerrUrl = serrUrl,
                entry.SerrMediaStatus,
                entry.SerrRequestStatus,
                entry.CreatedAtUtc,
                entry.UpdatedAtUtc,
                entry.CompletedAtUtc,
                entry.Error,
                download = ToDownloadDto(download),
                requestedBy = includeAdminFields ? new
                {
                    userId = entry.JellyfinUserId,
                    userName = entry.JellyfinUserName,
                    isAdmin = entry.JellyfinUserIsAdmin
                } : null
            };
        }

        private static string DisplayStatus(string? status, ArrDownloadSnapshot? download)
        {
            var clean = string.IsNullOrWhiteSpace(status) ? "pending" : status.Trim().ToLowerInvariant();
            if (download?.IsActive == true &&
                !Same(clean, "pending") &&
                !Same(clean, "declined") &&
                !Same(clean, "withdrawn"))
            {
                return "processing";
            }

            return clean;
        }

        private static bool IsTerminalHiddenForDisplay(SerrRequestEntry entry, ArrDownloadSnapshot? download)
        {
            var status = DisplayStatus(entry.Status, download);
            return IsCompletedStatus(status) ||
                   Same(status, "declined") ||
                   Same(status, "failed") ||
                   Same(status, "withdrawn");
        }

        private static object? ToDownloadDto(ArrDownloadSnapshot? download)
            => download is null
                ? null
                : new
                {
                    active = download.IsActive,
                    service = download.Service,
                    title = download.Title,
                    status = download.Status,
                    downloadClient = download.DownloadClient,
                    timeLeft = download.TimeLeft,
                    size = download.Size,
                    sizeLeft = download.SizeLeft,
                    progressPercent = Math.Round(download.ProgressPercent, 1),
                    itemCount = download.ItemCount
                };

        private static object BuildSettingsPayload(JMSFusionConfiguration cfg, bool includeSensitive)
        {
            return new
            {
                enabled = cfg.EnableSerrIntegration,
                baseUrl = includeSensitive ? cfg.SerrBaseUrl : (string.IsNullOrWhiteSpace(cfg.SerrBaseUrl) ? string.Empty : cfg.SerrBaseUrl),
                apiKey = includeSensitive ? cfg.SerrApiKey : string.Empty,
                hasApiKey = !string.IsNullOrWhiteSpace(cfg.SerrApiKey),
                defaultLanguage = cfg.SerrDefaultLanguage,
                requestAsJellyfinUser = cfg.SerrRequestAsJellyfinUser,
                confirmRequests = cfg.SerrEnable4KRequests || cfg.SerrConfirmRequests,
                showMissingSearchButton = cfg.SerrShowMissingSearchButton,
                enableNotifications = cfg.SerrEnableNotifications,
                enable4KRequests = cfg.SerrEnable4KRequests
            };
        }

        private static JMSFusionConfiguration GetConfig()
            => JMSFusionPlugin.Instance?.Configuration ?? throw new InvalidOperationException("Config not available.");

        private static void NormalizeSerrRequests(JMSFusionConfiguration cfg)
        {
            cfg.SerrRequests ??= new List<SerrRequestEntry>();
            foreach (var entry in cfg.SerrRequests)
            {
                entry.Id = string.IsNullOrWhiteSpace(entry.Id) ? Guid.NewGuid().ToString("N") : entry.Id;
                entry.MediaType = NormalizeMediaType(entry.MediaType);
                entry.Status = string.IsNullOrWhiteSpace(entry.Status) ? "pending" : entry.Status.Trim().ToLowerInvariant();
                entry.Seasons = NormalizeSeasons(entry.Seasons);
                entry.Episodes = NormalizeEpisodes(entry.Episodes);
                if (IsEpisodeOnlyRequest(entry))
                {
                    entry.Seasons = new List<int>();
                }
            }
        }

        private static void PruneRequests(JMSFusionConfiguration cfg)
        {
            NormalizeSerrRequests(cfg);
            cfg.SerrRequests = cfg.SerrRequests
                .OrderByDescending(entry => entry.UpdatedAtUtc > 0 ? entry.UpdatedAtUtc : entry.CreatedAtUtc)
                .Take(MaxStoredRequests)
                .ToList();
        }

        private static void TouchSerr(JMSFusionConfiguration cfg)
        {
            cfg.SerrRequestsRevision = NowMs();
        }

        private static bool ShouldRunSerrListSync()
        {
            lock (SyncRoot)
            {
                var now = NowMs();
                if (now - LastSerrListSyncAtUtc < SerrListSyncCacheMs) return false;
                LastSerrListSyncAtUtc = now;
                return true;
            }
        }

        private static bool ShouldRunLocalAvailabilityScan()
        {
            lock (SyncRoot)
            {
                var now = NowMs();
                if (now - LastLocalAvailabilityScanAtUtc < LocalAvailabilityScanCacheMs) return false;
                LastLocalAvailabilityScanAtUtc = now;
                return true;
            }
        }

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

        private bool TryGetRequestUserId(out Guid userId)
        {
            var userIdHeader =
                Request.Headers["X-Emby-UserId"].FirstOrDefault() ??
                Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault();

            return Guid.TryParse(userIdHeader, out userId) && userId != Guid.Empty;
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

        private static Uri? BuildSerrApiBase(string value)
        {
            var clean = NormalizeBaseUrlForStorage(value);
            if (!Uri.TryCreate(clean, UriKind.Absolute, out var uri)) return null;
            var raw = uri.ToString().TrimEnd('/');
            if (!raw.EndsWith("/api/v1", StringComparison.OrdinalIgnoreCase))
            {
                raw += "/api/v1";
            }

            return Uri.TryCreate(raw.TrimEnd('/') + "/", UriKind.Absolute, out var api) ? api : null;
        }

        private static string BuildSerrMediaWebUrl(JMSFusionConfiguration cfg, SerrRequestEntry entry)
        {
            if (!cfg.EnableSerrIntegration || string.IsNullOrWhiteSpace(cfg.SerrBaseUrl) || entry.MediaId <= 0) return string.Empty;
            var webBase = BuildSerrWebBaseUrl(cfg.SerrBaseUrl);
            if (string.IsNullOrWhiteSpace(webBase)) return string.Empty;
            var section = Same(entry.MediaType, "tv") ? "tv" : "movie";
            return webBase + "/" + section + "/" + entry.MediaId.ToString(CultureInfo.InvariantCulture);
        }

        private static string BuildSerrWebBaseUrl(string baseUrl)
        {
            var clean = NormalizeBaseUrlForStorage(baseUrl);
            if (!Uri.TryCreate(clean, UriKind.Absolute, out var uri)) return string.Empty;
            var raw = uri.ToString().TrimEnd('/');
            const string apiSuffix = "/api/v1";
            if (raw.EndsWith(apiSuffix, StringComparison.OrdinalIgnoreCase))
            {
                raw = raw[..^apiSuffix.Length].TrimEnd('/');
            }
            return raw;
        }

        private static string NormalizeBaseUrlForStorage(string? value)
            => (value ?? string.Empty).Trim().TrimEnd('/');

        private static string NormalizeSecret(string? value)
            => (value ?? string.Empty).Trim();

        private static string NormalizeLanguage(string? value)
        {
            var lang = (value ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(lang)) return "tr";
            return lang.Length > 12 ? lang[..12] : lang;
        }

        private static string NormalizeTmdbLanguage(string? value)
        {
            var lang = NormalizeLanguage(value).Replace('_', '-').Trim();
            if (string.IsNullOrWhiteSpace(lang)) return "tr-TR";

            var lower = lang.ToLowerInvariant();
            return lower switch
            {
                "tur" or "tr" => "tr-TR",
                "eng" or "en" => "en-US",
                "deu" or "ger" or "de" => "de-DE",
                "fre" or "fra" or "fr" => "fr-FR",
                "spa" or "es" => "es-ES",
                "rus" or "ru" => "ru-RU",
                _ => lang.Length == 2 ? lower + "-" + lower.ToUpperInvariant() : lang
            };
        }

        private static string NormalizeMediaType(string? value)
        {
            var type = (value ?? string.Empty).Trim().ToLowerInvariant();
            return type is "series" or "show" or "tvshow" ? "tv" : type;
        }

        private static List<int> NormalizeSeasons(IEnumerable<int>? seasons)
            => (seasons ?? Array.Empty<int>())
                .Where(x => x >= 0 && x <= 1000)
                .Distinct()
                .OrderBy(x => x)
                .ToList();

        private static List<SerrEpisodeSelectionEntry> NormalizeEpisodes(IEnumerable<SerrEpisodeSelectionRequest>? episodes)
            => NormalizeEpisodes((episodes ?? Array.Empty<SerrEpisodeSelectionRequest>())
                .Select(entry => new SerrEpisodeSelectionEntry
                {
                    SeasonNumber = entry.SeasonNumber ?? -1,
                    EpisodeNumber = entry.EpisodeNumber ?? -1,
                    Name = CleanText(entry.Name, 120)
                }));

        private static List<SerrEpisodeSelectionEntry> NormalizeEpisodes(IEnumerable<SerrEpisodeSelectionEntry>? episodes)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var output = new List<SerrEpisodeSelectionEntry>();
            foreach (var entry in episodes ?? Array.Empty<SerrEpisodeSelectionEntry>())
            {
                var seasonNumber = entry.SeasonNumber;
                var episodeNumber = entry.EpisodeNumber;
                if (seasonNumber < 0 || seasonNumber > 1000 || episodeNumber < 0 || episodeNumber > 10000) continue;
                var key = $"{seasonNumber}:{episodeNumber}";
                if (!seen.Add(key)) continue;
                output.Add(new SerrEpisodeSelectionEntry
                {
                    SeasonNumber = seasonNumber,
                    EpisodeNumber = episodeNumber,
                    Name = CleanText(entry.Name, 120)
                });
            }

            return output
                .OrderBy(entry => entry.SeasonNumber)
                .ThenBy(entry => entry.EpisodeNumber)
                .ToList();
        }

        private static bool SameSeasons(IReadOnlyCollection<int>? left, IReadOnlyCollection<int>? right)
            => NormalizeSeasons(left).SequenceEqual(NormalizeSeasons(right));

        private static bool SameEpisodes(IReadOnlyCollection<SerrEpisodeSelectionEntry>? left, IReadOnlyCollection<SerrEpisodeSelectionEntry>? right)
            => NormalizeEpisodes(left)
                .Select(entry => $"{entry.SeasonNumber}:{entry.EpisodeNumber}")
                .SequenceEqual(NormalizeEpisodes(right).Select(entry => $"{entry.SeasonNumber}:{entry.EpisodeNumber}"));

        private static bool IsEpisodeOnlyRequest(SerrRequestEntry entry)
            => Same(entry.MediaType, "tv") && entry.RequestAllSeasons != true && NormalizeEpisodes(entry.Episodes).Any();

        private static bool IsLegacyLocalOnlyEpisodeRequest(SerrRequestEntry entry, bool currentRequestIsEpisodeOnly)
            => currentRequestIsEpisodeOnly &&
               IsEpisodeOnlyRequest(entry) &&
               !entry.SerrRequestId.HasValue &&
               string.IsNullOrWhiteSpace(entry.Error) &&
               (Same(entry.Status, "approved") || Same(entry.Status, "processing"));

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

        private static bool IsRadarrSequenceError(string? value)
            => (value ?? string.Empty).Contains("Sequence contains no matching element", StringComparison.OrdinalIgnoreCase);

        private static bool Same(string? left, string? right)
            => string.Equals(left ?? string.Empty, right ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        private static string NormalizeItemId(BaseItem? item)
            => item is null || item.Id == Guid.Empty ? string.Empty : item.Id.ToString("N");

        private static bool IsCompletedStatus(string? status)
            => Same(status, "completed") || Same(status, "available");

        private static bool IsTerminalHidden(SerrRequestEntry entry)
            => IsCompletedStatus(entry.Status) ||
               Same(entry.Status, "declined") ||
               Same(entry.Status, "failed") ||
               Same(entry.Status, "withdrawn");

        private static long NowMs()
            => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        private static string BuildQueryString(Dictionary<string, string> values)
            => string.Join("&", values.Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));

        private static string BuildArrRecordsCacheKey(string baseUrl, string serviceName, string pathAndQuery)
            => string.Join("|", new[]
            {
                serviceName.Trim().ToLowerInvariant(),
                NormalizeBaseUrlForStorage(baseUrl).ToLowerInvariant(),
                pathAndQuery.Trim()
            });

        private static void ClearArrRecordsCache()
        {
            lock (ArrRecordsCacheRoot)
            {
                ArrRecordsCache.Clear();
            }
        }

        private static void PruneArrRecordsCache(long now)
        {
            foreach (var key in ArrRecordsCache
                         .Where(pair => pair.Value.ExpiresAtUtc <= now)
                         .Select(pair => pair.Key)
                         .ToList())
            {
                ArrRecordsCache.Remove(key);
            }

            if (ArrRecordsCache.Count <= 32) return;
            foreach (var key in ArrRecordsCache
                         .OrderBy(pair => pair.Value.ExpiresAtUtc)
                         .Take(ArrRecordsCache.Count - 32)
                         .Select(pair => pair.Key)
                         .ToList())
            {
                ArrRecordsCache.Remove(key);
            }
        }

        private static string? ExtractError(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                if (TryReadString(root, "message", out var msg)) return msg;
                if (TryReadString(root, "error", out var err)) return err;
            }
            catch {}

            return raw.Length > 500 ? raw[..500] : raw;
        }

        private static bool TryReadObject(JsonElement source, string property, out JsonElement value)
        {
            value = default;
            return source.ValueKind == JsonValueKind.Object &&
                   source.TryGetProperty(property, out value) &&
                   value.ValueKind == JsonValueKind.Object;
        }

        private static bool TryReadInt(JsonElement source, string property, out int value)
        {
            value = 0;
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) return false;
            if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out value)) return true;
            if (el.ValueKind == JsonValueKind.String && int.TryParse(el.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value)) return true;
            return false;
        }

        private static bool TryReadIntAny(JsonElement source, out int value, params string[] properties)
        {
            foreach (var property in properties)
            {
                if (TryReadInt(source, property, out value))
                {
                    return true;
                }
            }

            value = 0;
            return false;
        }

        private static int ReadIntValue(JsonElement source, string property)
            => TryReadInt(source, property, out var value) ? value : 0;

        private static bool ReadBool(JsonElement source, string property)
        {
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) return false;
            if (el.ValueKind == JsonValueKind.True) return true;
            if (el.ValueKind == JsonValueKind.False) return false;
            return el.ValueKind == JsonValueKind.String && bool.TryParse(el.GetString(), out var value) && value;
        }

        private static bool TryReadBoolAny(JsonElement source, out bool value, params string[] properties)
        {
            foreach (var property in properties)
            {
                if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) continue;
                if (el.ValueKind == JsonValueKind.True)
                {
                    value = true;
                    return true;
                }
                if (el.ValueKind == JsonValueKind.False)
                {
                    value = false;
                    return true;
                }
                if (el.ValueKind == JsonValueKind.String && bool.TryParse(el.GetString(), out var parsed))
                {
                    value = parsed;
                    return true;
                }
                if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var number))
                {
                    value = number != 0;
                    return true;
                }
            }

            value = false;
            return false;
        }

        private static bool ObjectBool(object? value)
        {
            if (value is bool boolValue) return boolValue;
            if (value is JsonElement element)
            {
                if (element.ValueKind == JsonValueKind.True) return true;
                if (element.ValueKind == JsonValueKind.False) return false;
                return element.ValueKind == JsonValueKind.String && bool.TryParse(element.GetString(), out var parsed) && parsed;
            }

            return value is string textValue && bool.TryParse(textValue, out var stringValue) && stringValue;
        }

        private static long ReadLongAny(JsonElement source, params string[] properties)
        {
            foreach (var property in properties)
            {
                if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) continue;
                if (el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out var longValue)) return longValue;
                if (el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var doubleValue)) return (long)Math.Max(0, doubleValue);
                if (el.ValueKind == JsonValueKind.String && long.TryParse(el.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)) return parsed;
                if (el.ValueKind == JsonValueKind.String && double.TryParse(el.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedDouble)) return (long)Math.Max(0, parsedDouble);
            }

            return 0;
        }

        private static long ReadTimestampMsAny(JsonElement source, params string[] properties)
        {
            foreach (var property in properties)
            {
                if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) continue;
                if (el.ValueKind == JsonValueKind.Number)
                {
                    if (el.TryGetInt64(out var numeric)) return NormalizeTimestampMs(numeric);
                    if (el.TryGetDouble(out var numericDouble)) return NormalizeTimestampMs((long)Math.Max(0, numericDouble));
                }

                if (el.ValueKind != JsonValueKind.String) continue;
                var raw = el.GetString();
                if (long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedLong))
                {
                    return NormalizeTimestampMs(parsedLong);
                }

                if (DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsedDate))
                {
                    return parsedDate.ToUnixTimeMilliseconds();
                }
            }

            return 0;
        }

        private static long NormalizeTimestampMs(long value)
        {
            if (value <= 0) return 0;
            return value < 100_000_000_000L ? value * 1000L : value;
        }

        private static bool TryReadString(JsonElement source, string property, out string value)
        {
            value = string.Empty;
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty(property, out var el)) return false;
            if (el.ValueKind != JsonValueKind.String) return false;
            value = el.GetString() ?? string.Empty;
            return !string.IsNullOrWhiteSpace(value);
        }

        private static IEnumerable<JsonElement> ReadArray(JsonElement source, params string[] properties)
        {
            if (source.ValueKind != JsonValueKind.Object) return Array.Empty<JsonElement>();
            foreach (var property in properties)
            {
                if (source.TryGetProperty(property, out var el) && el.ValueKind == JsonValueKind.Array)
                {
                    return el.EnumerateArray()
                        .Where(item => item.ValueKind == JsonValueKind.Object)
                        .Select(item => item.Clone())
                        .ToList();
                }
            }

            return Array.Empty<JsonElement>();
        }

        private static string ReadStringAny(JsonElement source, params string[] properties)
        {
            foreach (var property in properties)
            {
                if (TryReadString(source, property, out var value)) return value;
            }

            return string.Empty;
        }

        private static double ComputeProgressPercent(long size, long sizeLeft)
        {
            if (size <= 0) return 0;
            var done = Math.Max(0, size - Math.Max(0, sizeLeft));
            return Math.Clamp((done / (double)size) * 100d, 0d, 100d);
        }

        private static SerrRequestEntry CloneEntry(SerrRequestEntry entry)
        {
            return new SerrRequestEntry
            {
                Id = entry.Id,
                JellyfinUserId = entry.JellyfinUserId,
                JellyfinUserName = entry.JellyfinUserName,
                JellyfinUserIsAdmin = entry.JellyfinUserIsAdmin,
                Title = entry.Title,
                MediaType = entry.MediaType,
                MediaId = entry.MediaId,
                TvdbId = entry.TvdbId,
                Seasons = NormalizeSeasons(entry.Seasons),
                Episodes = NormalizeEpisodes(entry.Episodes),
                RequestAllSeasons = entry.RequestAllSeasons,
                Is4K = entry.Is4K,
                Source = entry.Source,
                JellyfinItemId = entry.JellyfinItemId,
                Status = entry.Status,
                SerrRequestId = entry.SerrRequestId,
                SerrMediaStatus = entry.SerrMediaStatus,
                SerrRequestStatus = entry.SerrRequestStatus,
                Error = entry.Error,
                CreatedAtUtc = entry.CreatedAtUtc,
                UpdatedAtUtc = entry.UpdatedAtUtc,
                CompletedAtUtc = entry.CompletedAtUtc
            };
        }

        private sealed class ArrDownloadSnapshot
        {
            public bool IsActive { get; init; } = true;
            public string Service { get; init; } = string.Empty;
            public string Title { get; init; } = string.Empty;
            public string Status { get; init; } = string.Empty;
            public string DownloadClient { get; init; } = string.Empty;
            public string TimeLeft { get; init; } = string.Empty;
            public long Size { get; init; }
            public long SizeLeft { get; init; }
            public double ProgressPercent { get; init; }
            public int ItemCount { get; init; } = 1;
        }

        private sealed record ArrRecordCacheEntry(long ExpiresAtUtc, List<JsonElement> Records);

        private readonly struct RequestSubmissionResult
        {
            public SerrCallResult Response { get; }
            public string Backend { get; }
            public string Service { get; }

            public RequestSubmissionResult(SerrCallResult response, string backend, string service)
            {
                Response = response;
                Backend = backend;
                Service = service;
            }
        }

        private readonly struct ArrApiCallResult
        {
            public bool Ok { get; init; }
            public int StatusCode { get; init; }
            public JsonElement Payload { get; init; }
            public string Error { get; init; }

            public static ArrApiCallResult Success(int statusCode, JsonElement payload)
                => new() { Ok = true, StatusCode = statusCode, Payload = payload, Error = string.Empty };

            public static ArrApiCallResult Fail(int statusCode, string error)
                => new() { Ok = false, StatusCode = statusCode, Payload = default, Error = error };
        }

        private readonly struct SerrCallResult
        {
            public bool Ok { get; init; }
            public int StatusCode { get; init; }
            public JsonElement Payload { get; init; }
            public string Error { get; init; }

            public static SerrCallResult Success(int statusCode, JsonElement payload)
                => new() { Ok = true, StatusCode = statusCode, Payload = payload, Error = string.Empty };

            public static SerrCallResult Fail(int statusCode, string error)
                => new() { Ok = false, StatusCode = statusCode, Payload = default, Error = error };
        }
    }
}
