using System.Collections.Generic;
using System.Text.Json.Serialization;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.JMSFusion
{
    [JsonSourceGenerationOptions(WriteIndented = true)]
    public class JMSFusionConfiguration : BasePluginConfiguration
    {
        [JsonPropertyName("scriptDirectory")]
        public string ScriptDirectory { get; set; } = string.Empty;

        [JsonPropertyName("forceGlobalUserSettings")]
        public bool ForceGlobalUserSettings { get; set; } = false;

        [JsonPropertyName("globalUserSettingsJsonDesktop")]
        public string GlobalUserSettingsJsonDesktop { get; set; } = "{}";

        [JsonPropertyName("globalUserSettingsJsonMobile")]
        public string GlobalUserSettingsJsonMobile { get; set; } = "{}";

        [JsonPropertyName("globalUserSettingsRevisionDesktop")]
        public long GlobalUserSettingsRevisionDesktop { get; set; } = 0;

        [JsonPropertyName("globalUserSettingsRevisionMobile")]
        public long GlobalUserSettingsRevisionMobile { get; set; } = 0;

        [JsonPropertyName("globalUserSettingsJson")]
        public string GlobalUserSettingsJson { get; set; } = "{}";

        [JsonPropertyName("globalUserSettingsRevision")]
        public long GlobalUserSettingsRevision { get; set; } = 0;

        [JsonPropertyName("allowScriptExecution")]
        public bool AllowScriptExecution { get; set; } = true;

        [JsonPropertyName("playerSubdir")]
        public string PlayerSubdir { get; set; } = "modules/player";

        [JsonPropertyName("enableTransformEngine")]
        public bool EnableTransformEngine { get; set; } = true;

        [JsonPropertyName("enableTrailerDownloader")]
        public bool EnableTrailerDownloader { get; set; } = false;

        [JsonPropertyName("enableTrailerUrlNfo")]
        public bool EnableTrailerUrlNfo { get; set; } = false;

        [JsonPropertyName("jfBase")]
        public string JFBase { get; set; } = "http://localhost:8096";

        [JsonPropertyName("jfApiKey")]
        public string JFApiKey { get; set; } = "CHANGE_ME";

        [JsonPropertyName("tmdbApiKey")]
        public string TmdbApiKey { get; set; } = "CHANGE_ME";

        [JsonPropertyName("preferredLang")]
        public string PreferredLang { get; set; } = "tr-TR";

        [JsonPropertyName("fallbackLang")]
        public string FallbackLang { get; set; } = "en-US";

        [JsonPropertyName("trailerMinResolution")]
        public int TrailerMinResolution { get; set; } = 720;

        [JsonPropertyName("trailerMaxResolution")]
        public int TrailerMaxResolution { get; set; } = 1080;

        [JsonPropertyName("overwritePolicy")]
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public OverwritePolicy OverwritePolicy { get; set; } = OverwritePolicy.Skip;

        [JsonPropertyName("enableThemeLink")]
        public int EnableThemeLink { get; set; } = 0;

        [JsonPropertyName("themeLinkMode")]
        public string ThemeLinkMode { get; set; } = "symlink";

        [JsonPropertyName("includeTypes")]
        public string IncludeTypes { get; set; } = "Movie,Series,Season,Episode";

        [JsonPropertyName("pageSize")]
        public int PageSize { get; set; } = 200;

        [JsonPropertyName("sleepSecs")]
        public double SleepSecs { get; set; } = 1.0;

        [JsonPropertyName("maxConcurrentDownloads")]
        public int MaxConcurrentDownloads { get; set; } = 1;

        [JsonPropertyName("jfUserId")]
        public string? JFUserId { get; set; } = null;

        [JsonPropertyName("radioStations")]
        public List<SharedRadioStationEntry> RadioStations { get; set; } = new();

        [JsonPropertyName("watchlistEntries")]
        public List<WatchlistEntry> WatchlistEntries { get; set; } = new();

        [JsonPropertyName("watchlistShares")]
        public List<WatchlistShareEntry> WatchlistShares { get; set; } = new();

        [JsonPropertyName("watchlistHistoryEntries")]
        public List<WatchlistHistoryEntry> WatchlistHistoryEntries { get; set; } = new();

        [JsonPropertyName("watchlistRevision")]
        public long WatchlistRevision { get; set; } = 0;

        [JsonPropertyName("enablePhysicalIndexHtmlPatchFallback")]
        public bool EnablePhysicalIndexHtmlPatchFallback { get; set; } = false;

        [JsonPropertyName("itemComments")]
        public List<ItemCommentEntry> ItemComments { get; set; } = new();

        [JsonPropertyName("itemCommentsRevision")]
        public long ItemCommentsRevision { get; set; } = 0;

        [JsonPropertyName("studioHubVideoEntries")]
        public List<StudioHubVideoEntry> StudioHubVideoEntries { get; set; } = new();

        [JsonPropertyName("studioHubManualEntries")]
        public List<StudioHubManualEntry> StudioHubManualEntries { get; set; } = new();

        // Fork ParticularFlix: snapshot de configuracoes da interface por usuario e perfil de tela.
        // JsonIgnore: nao sai nas respostas JSON da API, so e gravado no XML do plugin.
        [JsonIgnore]
        public List<UserSettingsSnapshotEntry> UserSettingsSnapshots { get; set; } = new();

        [JsonPropertyName("studioHubVisibilityEntries")]
        public List<StudioHubVisibilityEntry> StudioHubVisibilityEntries { get; set; } = new();

        [JsonPropertyName("parentalPinRules")]
        public List<ParentalPinRuleEntry> ParentalPinRules { get; set; } = new();

        [JsonPropertyName("parentalPinHash")]
        public string? ParentalPinHash { get; set; }

        [JsonPropertyName("parentalPinSalt")]
        public string? ParentalPinSalt { get; set; }

        [JsonPropertyName("parentalPinRevision")]
        public long ParentalPinRevision { get; set; } = 0;

        [JsonPropertyName("parentalPinMaxAttempts")]
        public int ParentalPinMaxAttempts { get; set; } = 5;

        [JsonPropertyName("parentalPinLockoutMinutes")]
        public int ParentalPinLockoutMinutes { get; set; } = 15;

        [JsonPropertyName("parentalPinTrustMinutes")]
        public int ParentalPinTrustMinutes { get; set; } = 60;

        // Fork ParticularFlix: controle de acesso por usuario. Edita a politica NATIVA do Jellyfin
        // (classificacao maxima, tags, bibliotecas), valida em todos os clientes. O PIN global desbloqueia
        // temporariamente (UnlockedUntilUtc) e a politica restrita volta sozinha.
        // Geracao dos caches de lista por usuario: sobe a cada mudanca de politica de acesso daquele
        // usuario. Caches de geracoes antigas nunca sao lidos nem gravados de volta.
        [JsonPropertyName("accessCacheGenerations")]
        public List<AccessGenEntry> AccessCacheGenerations { get; set; } = new();

        [JsonPropertyName("accessProfiles")]
        public List<AccessProfileEntry> AccessProfiles { get; set; } = new();

        [JsonPropertyName("enableCastModule")]
        public bool EnableCastModule { get; set; } = true;

        [JsonPropertyName("allowSharedCastViewerForUsers")]
        public bool AllowSharedCastViewerForUsers { get; set; } = false;

        [JsonPropertyName("enableSerrIntegration")]
        public bool EnableSerrIntegration { get; set; } = false;

        [JsonPropertyName("serrBaseUrl")]
        public string SerrBaseUrl { get; set; } = string.Empty;

        [JsonPropertyName("serrApiKey")]
        public string SerrApiKey { get; set; } = string.Empty;

        [JsonPropertyName("serrDefaultLanguage")]
        public string SerrDefaultLanguage { get; set; } = "tr";

        [JsonPropertyName("serrRequestAsJellyfinUser")]
        public bool SerrRequestAsJellyfinUser { get; set; } = true;

        [JsonPropertyName("serrConfirmRequests")]
        public bool SerrConfirmRequests { get; set; } = true;

        [JsonPropertyName("serrShowMissingSearchButton")]
        public bool SerrShowMissingSearchButton { get; set; } = true;

        [JsonPropertyName("serrEnableNotifications")]
        public bool SerrEnableNotifications { get; set; } = true;

        [JsonPropertyName("serrEnable4KRequests")]
        public bool SerrEnable4KRequests { get; set; } = false;

        [JsonPropertyName("serrRequests")]
        public List<SerrRequestEntry> SerrRequests { get; set; } = new();

        [JsonPropertyName("serrRequestsRevision")]
        public long SerrRequestsRevision { get; set; } = 0;

        [JsonPropertyName("enableArrIntegration")]
        public bool EnableArrIntegration { get; set; } = false;

        [JsonPropertyName("arrSonarrEnabled")]
        public bool ArrSonarrEnabled { get; set; } = false;

        [JsonPropertyName("arrSonarrBaseUrl")]
        public string ArrSonarrBaseUrl { get; set; } = string.Empty;

        [JsonPropertyName("arrSonarrApiKey")]
        public string ArrSonarrApiKey { get; set; } = string.Empty;

        [JsonPropertyName("arrSonarrRootFolderPath")]
        public string ArrSonarrRootFolderPath { get; set; } = string.Empty;

        [JsonPropertyName("arrSonarrQualityProfileId")]
        public int ArrSonarrQualityProfileId { get; set; } = 0;

        [JsonPropertyName("arrSonarrLanguageProfileId")]
        public int ArrSonarrLanguageProfileId { get; set; } = 0;

        [JsonPropertyName("arrSonarrSeasonFolder")]
        public bool ArrSonarrSeasonFolder { get; set; } = true;

        [JsonPropertyName("arrSonarrSearchOnRequest")]
        public bool ArrSonarrSearchOnRequest { get; set; } = true;

        [JsonPropertyName("arrSonarr4KEnabled")]
        public bool ArrSonarr4KEnabled { get; set; } = false;

        [JsonPropertyName("arrSonarr4KBaseUrl")]
        public string ArrSonarr4KBaseUrl { get; set; } = string.Empty;

        [JsonPropertyName("arrSonarr4KApiKey")]
        public string ArrSonarr4KApiKey { get; set; } = string.Empty;

        [JsonPropertyName("arrSonarr4KRootFolderPath")]
        public string ArrSonarr4KRootFolderPath { get; set; } = string.Empty;

        [JsonPropertyName("arrSonarr4KQualityProfileId")]
        public int ArrSonarr4KQualityProfileId { get; set; } = 0;

        [JsonPropertyName("arrSonarr4KLanguageProfileId")]
        public int ArrSonarr4KLanguageProfileId { get; set; } = 0;

        [JsonPropertyName("arrSonarr4KSeasonFolder")]
        public bool ArrSonarr4KSeasonFolder { get; set; } = true;

        [JsonPropertyName("arrSonarr4KSearchOnRequest")]
        public bool ArrSonarr4KSearchOnRequest { get; set; } = true;

        [JsonPropertyName("arrRadarrEnabled")]
        public bool ArrRadarrEnabled { get; set; } = false;

        [JsonPropertyName("arrRadarrBaseUrl")]
        public string ArrRadarrBaseUrl { get; set; } = string.Empty;

        [JsonPropertyName("arrRadarrApiKey")]
        public string ArrRadarrApiKey { get; set; } = string.Empty;

        [JsonPropertyName("arrRadarrRootFolderPath")]
        public string ArrRadarrRootFolderPath { get; set; } = string.Empty;

        [JsonPropertyName("arrRadarrQualityProfileId")]
        public int ArrRadarrQualityProfileId { get; set; } = 0;

        [JsonPropertyName("arrRadarrSearchOnRequest")]
        public bool ArrRadarrSearchOnRequest { get; set; } = true;

        [JsonPropertyName("arrRadarr4KEnabled")]
        public bool ArrRadarr4KEnabled { get; set; } = false;

        [JsonPropertyName("arrRadarr4KBaseUrl")]
        public string ArrRadarr4KBaseUrl { get; set; } = string.Empty;

        [JsonPropertyName("arrRadarr4KApiKey")]
        public string ArrRadarr4KApiKey { get; set; } = string.Empty;

        [JsonPropertyName("arrRadarr4KRootFolderPath")]
        public string ArrRadarr4KRootFolderPath { get; set; } = string.Empty;

        [JsonPropertyName("arrRadarr4KQualityProfileId")]
        public int ArrRadarr4KQualityProfileId { get; set; } = 0;

        [JsonPropertyName("arrRadarr4KSearchOnRequest")]
        public bool ArrRadarr4KSearchOnRequest { get; set; } = true;
    }

    public class SerrRequestEntry
    {
        public string Id { get; set; } = string.Empty;
        public string JellyfinUserId { get; set; } = string.Empty;
        public string JellyfinUserName { get; set; } = string.Empty;
        public bool JellyfinUserIsAdmin { get; set; } = false;
        public string Title { get; set; } = string.Empty;
        public string MediaType { get; set; } = string.Empty;
        public int MediaId { get; set; } = 0;
        public int? TvdbId { get; set; }
        public List<int> Seasons { get; set; } = new();
        public List<SerrEpisodeSelectionEntry> Episodes { get; set; } = new();
        public bool RequestAllSeasons { get; set; } = false;
        public bool Is4K { get; set; } = false;
        public string Source { get; set; } = string.Empty;
        public string JellyfinItemId { get; set; } = string.Empty;
        public string Status { get; set; } = "pending";
        public int? SerrRequestId { get; set; }
        public int? SerrMediaStatus { get; set; }
        public int? SerrRequestStatus { get; set; }
        public string Error { get; set; } = string.Empty;
        public long CreatedAtUtc { get; set; } = 0;
        public long UpdatedAtUtc { get; set; } = 0;
        public long CompletedAtUtc { get; set; } = 0;
    }

    public class SerrEpisodeSelectionEntry
    {
        public int SeasonNumber { get; set; } = 0;
        public int EpisodeNumber { get; set; } = 0;
        public string Name { get; set; } = string.Empty;
    }

    public class SharedRadioStationEntry
    {
        public string? Id { get; set; }
        public string? StationUuid { get; set; }
        public string? Name { get; set; }
        public string? Url { get; set; }
        public string? UrlResolved { get; set; }
        public string? Homepage { get; set; }
        public string? Logo { get; set; }
        public string? LogoUrl { get; set; }
        public string? ImageUrl { get; set; }
        public string? Favicon { get; set; }
        public string? Country { get; set; }
        public string? CountryCode { get; set; }
        public string? State { get; set; }
        public string? Language { get; set; }
        public string? Tags { get; set; }
        public string? Codec { get; set; }
        public int Bitrate { get; set; }
        public int ClickCount { get; set; }
        public int Votes { get; set; }
        public string? Source { get; set; }
        public string? CreatedAt { get; set; }
        public string? AddedBy { get; set; }
        public string? AddedByUserId { get; set; }
    }

    public class WatchlistEntry
    {
        public string? Id { get; set; }
        public string? ItemId { get; set; }
        public string? ItemType { get; set; }
        public string? Name { get; set; }
        public string? Overview { get; set; }
        public int? ProductionYear { get; set; }
        public long? RunTimeTicks { get; set; }
        public double? CommunityRating { get; set; }
        public string? OfficialRating { get; set; }
        public List<string> Genres { get; set; } = new();
        public string? AlbumArtist { get; set; }
        public List<string> Artists { get; set; } = new();
        public string? ParentName { get; set; }
        public long AddedAtUtc { get; set; }
        public string? OwnerUserId { get; set; }
        public string? OwnerUserName { get; set; }
    }

    public class WatchlistHistoryEntry
    {
        public string? ItemId { get; set; }
        public string? ItemType { get; set; }
        public string? Name { get; set; }
        public string? OwnerUserId { get; set; }
        public string? OwnerUserName { get; set; }
        public long FirstAddedAtUtc { get; set; }
        public long LastAddedAtUtc { get; set; }
        public long LastRemovedAtUtc { get; set; }
        public int AddCount { get; set; }
        public int RemoveCount { get; set; }
        public bool RemovedAfterPlayed { get; set; }
    }

    public class WatchlistShareEntry
    {
        public string? Id { get; set; }
        public string? WatchlistEntryId { get; set; }
        public string? ItemId { get; set; }
        public string? OwnerUserId { get; set; }
        public string? OwnerUserName { get; set; }
        public string? TargetUserId { get; set; }
        public string? TargetUserName { get; set; }
        public string? Note { get; set; }
        public long SharedAtUtc { get; set; }
        public WatchlistEntry? EntrySnapshot { get; set; }
    }

    public class ItemCommentEntry
    {
        public string? Id { get; set; }
        public string? ItemId { get; set; }
        public string? Content { get; set; }
        public string? OwnerUserId { get; set; }
        public string? OwnerUserName { get; set; }
        public long CreatedAtUtc { get; set; }
        public long UpdatedAtUtc { get; set; }
    }

    public class StudioHubVideoEntry
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("fileName")]
        public string FileName { get; set; } = string.Empty;

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;

        [JsonPropertyName("updatedBy")]
        public string? UpdatedBy { get; set; }

        [JsonPropertyName("updatedByUserId")]
        public string? UpdatedByUserId { get; set; }
    }

    public class StudioHubManualEntry
    {
        [JsonPropertyName("studioId")]
        public string StudioId { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("logoFileName")]
        public string? LogoFileName { get; set; }

        [JsonPropertyName("addedAtUtc")]
        public long AddedAtUtc { get; set; } = 0;

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;

        [JsonPropertyName("addedBy")]
        public string? AddedBy { get; set; }

        [JsonPropertyName("addedByUserId")]
        public string? AddedByUserId { get; set; }
    }

    public class UserSettingsSnapshotEntry
    {
        public string UserId { get; set; } = string.Empty;
        public string? UserName { get; set; }
        public string Profile { get; set; } = "desktop";
        public string Json { get; set; } = "{}";
        public long Revision { get; set; } = 0;
        public long UpdatedAtUtc { get; set; } = 0;
    }

    public class StudioHubVisibilityEntry
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("userName")]
        public string? UserName { get; set; }

        [JsonPropertyName("profile")]
        public string Profile { get; set; } = "desktop";

        [JsonPropertyName("hiddenNames")]
        public List<string> HiddenNames { get; set; } = new();

        [JsonPropertyName("orderNames")]
        public List<string> OrderNames { get; set; } = new();

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;
    }

    public class AccessGenEntry
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("generation")]
        public long Generation { get; set; }
    }

    public class AccessPolicyValues
    {
        [JsonPropertyName("maxParentalRating")]
        public int? MaxParentalRating { get; set; }

        [JsonPropertyName("blockUnratedItems")]
        public int[] BlockUnratedItems { get; set; } = Array.Empty<int>();

        [JsonPropertyName("blockedTags")]
        public string[] BlockedTags { get; set; } = Array.Empty<string>();

        [JsonPropertyName("allowedTags")]
        public string[] AllowedTags { get; set; } = Array.Empty<string>();

        [JsonPropertyName("enableAllFolders")]
        public bool EnableAllFolders { get; set; } = true;

        [JsonPropertyName("enabledFolders")]
        public string[] EnabledFolders { get; set; } = Array.Empty<string>();
    }

    public class AccessProfileEntry
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("userName")]
        public string? UserName { get; set; }

        // Politica do usuario antes de o plugin mexer (usada para reverter).
        [JsonPropertyName("original")]
        public AccessPolicyValues? Original { get; set; }

        [JsonPropertyName("restricted")]
        public AccessPolicyValues Restricted { get; set; } = new();

        [JsonPropertyName("unlockEnabled")]
        public bool UnlockEnabled { get; set; } = false;

        // Quando true, o desbloqueio devolve a politica original do usuario (em vez de "Unlocked").
        [JsonPropertyName("unlockUseOriginal")]
        public bool UnlockUseOriginal { get; set; } = false;

        [JsonPropertyName("unlockMinutes")]
        public int UnlockMinutes { get; set; } = 30;

        [JsonPropertyName("unlocked")]
        public AccessPolicyValues Unlocked { get; set; } = new();

        [JsonPropertyName("unlockedUntilUtc")]
        public long UnlockedUntilUtc { get; set; } = 0;

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;
    }

    public class ParentalPinRuleEntry
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("userName")]
        public string? UserName { get; set; }

        [JsonPropertyName("ratingThreshold")]
        public int RatingThreshold { get; set; } = 0;

        [JsonPropertyName("requireUnratedPin")]
        public bool RequireUnratedPin { get; set; } = false;

        [JsonPropertyName("updatedAtUtc")]
        public long UpdatedAtUtc { get; set; } = 0;
    }

    public enum OverwritePolicy
    {
        Skip,
        Replace,
        IfBetter
    }
}
