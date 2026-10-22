using System.Collections.Concurrent;
using System.Collections;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Reflection;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Controllers;

[ApiController]
[Route("JMSFusion/parental-pin")]
[Route("Plugins/JMSFusion/parental-pin")]
public partial class ParentalPinController : ControllerBase
{
    private const int DefaultMaxAttempts = 5;
    private const int DefaultLockoutMinutes = 15;
    private const int DefaultTrustMinutes = 60;
    private const int MinMaxAttempts = 1;
    private const int MaxMaxAttempts = 20;
    private const int MinLockoutMinutes = 1;
    private const int MaxLockoutMinutes = 1440;
    private const int MinTrustMinutes = 0;
    private const int MaxTrustMinutes = 1440;
    private static readonly int[] AllowedThresholds = [7, 10, 13, 16, 18];
    private static readonly Regex PinRegex = new(@"^\d{4,8}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly ConcurrentDictionary<string, ParentalPinAccessState> AccessStates = new(StringComparer.OrdinalIgnoreCase);
    private readonly IUserManager _users;
    private readonly ILibraryManager _libraries;
    private readonly ILogger<ParentalPinController> _logger;

    public ParentalPinController(IUserManager users, ILibraryManager libraries, ILogger<ParentalPinController> logger)
    {
        _users = users;
        Jellyfin.Plugin.JMSFusion.Core.AccessControlCore.Log ??= logger;
        _libraries = libraries;
        _logger = logger;
    }

    private sealed class ParentalPinAccessState
    {
        public int FailedAttempts { get; set; }

        public long LockedUntilUtc { get; set; }

        public long TrustedUntilUtc { get; set; }
    }

    private sealed record AccessSnapshot(
        bool IsLocked,
        long LockedUntilUtc,
        bool IsTrusted,
        long TrustedUntilUtc,
        int RemainingAttempts);

    private sealed record LockedUserSnapshot(
        string UserId,
        string UserName,
        long LockedUntilUtc,
        int RemainingMinutes);

    private sealed record KnownUser(
        string UserId,
        string UserName,
        bool IsAdmin);

    public sealed class SaveSettingsRequest
    {
        public string? Pin { get; set; }

        public List<RuleDto>? Rules { get; set; }

        public int? MaxAttempts { get; set; }

        public int? LockoutMinutes { get; set; }

        public int? TrustMinutes { get; set; }
    }

    public sealed class VerifyPinRequest
    {
        public string? Pin { get; set; }
    }

    public sealed class UnlockUserRequest
    {
        public string? UserId { get; set; }
    }

    public sealed class RuleDto
    {
        public string? UserId { get; set; }
        public int RatingThreshold { get; set; }
        public bool RequireUnratedPin { get; set; }
    }

    public sealed class UserDto
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("userName")]
        public string UserName { get; set; } = string.Empty;

        [JsonPropertyName("isAdmin")]
        public bool IsAdmin { get; set; }
    }

    [HttpGet("settings")]
    public IActionResult GetSettings()
    {
        try
        {
            var adminCheck = TryGetAdminUser();
            if (adminCheck.Result is not null)
            {
                return adminCheck.Result;
            }

            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            var users = GetKnownUsers();
            var sanitizedRules = SanitizeRules(cfg.ParentalPinRules, users, out var rulesChanged);
            cfg.ParentalPinRules = sanitizedRules;
            var securityChanged = NormalizeSecuritySettings(cfg);
            if (rulesChanged || securityChanged)
            {
                plugin.UpdateConfiguration(cfg);
            }

            NoCache();
            return Ok(BuildSettingsResponse(cfg, users, sanitizedRules));
        }
        catch (Exception ex)
        {
            return InternalError(ex);
        }
    }

    [HttpPost("settings")]
    public IActionResult SaveSettings([FromBody] SaveSettingsRequest? request)
    {
        var adminCheck = TryGetAdminUser();
        if (adminCheck.Result is not null)
        {
            return adminCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        NormalizeSecuritySettings(cfg);
        var normalizedRules = SanitizeRules(
            (request?.Rules ?? [])
                .Select(rule => new ParentalPinRuleEntry
                {
                    UserId = NormalizeUserId(rule?.UserId),
                    RatingThreshold = rule?.RatingThreshold ?? 0,
                    RequireUnratedPin = rule?.RequireUnratedPin == true
                })
                .ToList(),
            users,
            out _);
        var nextMaxAttempts = NormalizeMaxAttempts(request?.MaxAttempts ?? cfg.ParentalPinMaxAttempts);
        var nextLockoutMinutes = NormalizeLockoutMinutes(request?.LockoutMinutes ?? cfg.ParentalPinLockoutMinutes);
        var nextTrustMinutes = NormalizeTrustMinutes(request?.TrustMinutes ?? cfg.ParentalPinTrustMinutes);

        var nextPin = NormalizePin(request?.Pin);
        var hasExistingPin = HasConfiguredPin(cfg);

        if (normalizedRules.Count > 0 && string.IsNullOrWhiteSpace(nextPin) && !hasExistingPin)
        {
            return BadRequest(new
            {
                ok = false,
                code = "parental_pin_pin_required",
                error = "A PIN must be configured before rules can be assigned."
            });
        }

        if (!string.IsNullOrWhiteSpace(request?.Pin) && nextPin is null)
        {
            return BadRequest(new
            {
                ok = false,
                code = "parental_pin_invalid_format",
                error = "PIN must be 4 to 8 digits."
            });
        }

        var rulesChanged = !AreRulesEqual(cfg.ParentalPinRules, normalizedRules);
        var securityChanged =
            cfg.ParentalPinMaxAttempts != nextMaxAttempts
            || cfg.ParentalPinLockoutMinutes != nextLockoutMinutes
            || cfg.ParentalPinTrustMinutes != nextTrustMinutes;
        var pinChanged = false;

        if (!string.IsNullOrWhiteSpace(nextPin))
        {
            var hashed = HashPin(nextPin);
            cfg.ParentalPinHash = hashed.Hash;
            cfg.ParentalPinSalt = hashed.Salt;
            pinChanged = true;
        }

        if (rulesChanged)
        {
            cfg.ParentalPinRules = normalizedRules;
        }

        if (securityChanged)
        {
            cfg.ParentalPinMaxAttempts = nextMaxAttempts;
            cfg.ParentalPinLockoutMinutes = nextLockoutMinutes;
            cfg.ParentalPinTrustMinutes = nextTrustMinutes;
        }

        if (rulesChanged || pinChanged || securityChanged)
        {
            cfg.ParentalPinRevision = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            AccessStates.Clear();
            plugin.UpdateConfiguration(cfg);
        }

        NoCache();
        return Ok(BuildSettingsResponse(cfg, users, cfg.ParentalPinRules));
    }

    [HttpPost("unlock")]
    public IActionResult UnlockUser([FromBody] UnlockUserRequest? request)
    {
        var adminCheck = TryGetAdminUser();
        if (adminCheck.Result is not null)
        {
            return adminCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        var sanitizedRules = SanitizeRules(cfg.ParentalPinRules, users, out var rulesChanged);
        cfg.ParentalPinRules = sanitizedRules;
        var securityChanged = NormalizeSecuritySettings(cfg);
        if (rulesChanged || securityChanged)
        {
            plugin.UpdateConfiguration(cfg);
        }

        var userId = NormalizeUserId(request?.UserId);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return BadRequest(new
            {
                ok = false,
                code = "parental_pin_unlock_user_required",
                error = "UserId is required."
            });
        }

        if (!users.TryGetValue(userId, out _))
        {
            return NotFound(new
            {
                ok = false,
                code = "parental_pin_unlock_user_not_found",
                error = "User not found."
            });
        }

        ClearAccessState(userId);
        NoCache();
        return Ok(BuildSettingsResponse(cfg, users, sanitizedRules, userId));
    }

    [HttpGet("policy")]
    public IActionResult GetCurrentUserPolicy()
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        var sanitizedRules = SanitizeRules(cfg.ParentalPinRules, users, out var rulesChanged);
        cfg.ParentalPinRules = sanitizedRules;
        var securityChanged = NormalizeSecuritySettings(cfg);
        if (rulesChanged || securityChanged)
        {
            plugin.UpdateConfiguration(cfg);
        }

        var userId = userCheck.UserId.ToString("D");
        var rule = sanitizedRules.FirstOrDefault(entry =>
            string.Equals(entry.UserId, userId, StringComparison.OrdinalIgnoreCase));
        var hasPin = HasConfiguredPin(cfg);
        if (!hasPin || rule is null)
        {
            ClearAccessState(userId);
        }

        var access = hasPin && rule is not null
            ? GetAccessSnapshot(userId, cfg.ParentalPinMaxAttempts)
            : CreateEmptyAccessSnapshot(cfg.ParentalPinMaxAttempts);

        NoCache();
        return Ok(new
        {
            ok = true,
            hasPin,
            revision = cfg.ParentalPinRevision,
            rule = rule is null ? null : ToRuleResponse(rule),
            maxAttempts = cfg.ParentalPinMaxAttempts,
            lockoutMinutes = cfg.ParentalPinLockoutMinutes,
            trustMinutes = cfg.ParentalPinTrustMinutes,
            remainingAttempts = access.RemainingAttempts,
            lockedUntilUtc = access.LockedUntilUtc,
            trustedUntilUtc = access.TrustedUntilUtc,
            isLocked = access.IsLocked,
            isTrusted = access.IsTrusted
        });
    }

    [HttpPost("verify")]
    public IActionResult VerifyPin([FromBody] VerifyPinRequest? request)
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck.Result;
        }

        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
        var cfg = plugin.Configuration;
        var users = GetKnownUsers();
        var sanitizedRules = SanitizeRules(cfg.ParentalPinRules, users, out var rulesChanged);
        cfg.ParentalPinRules = sanitizedRules;
        var securityChanged = NormalizeSecuritySettings(cfg);
        if (rulesChanged || securityChanged)
        {
            plugin.UpdateConfiguration(cfg);
        }

        var userId = userCheck.UserId.ToString("D");
        var rule = sanitizedRules.FirstOrDefault(entry =>
            string.Equals(entry.UserId, userId, StringComparison.OrdinalIgnoreCase));
        var hasPin = HasConfiguredPin(cfg);
        if (!hasPin || rule is null)
        {
            ClearAccessState(userId);
            NoCache();
            return Ok(new
            {
                ok = true,
                valid = false,
                maxAttempts = cfg.ParentalPinMaxAttempts,
                remainingAttempts = cfg.ParentalPinMaxAttempts,
                lockoutMinutes = cfg.ParentalPinLockoutMinutes,
                trustMinutes = cfg.ParentalPinTrustMinutes,
                lockedUntilUtc = 0,
                trustedUntilUtc = 0,
                isLocked = false,
                isTrusted = false
            });
        }

        var state = GetAccessState(userId);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var maxAttempts = cfg.ParentalPinMaxAttempts;
        var lockoutMinutes = cfg.ParentalPinLockoutMinutes;
        var trustMinutes = cfg.ParentalPinTrustMinutes;
        var pin = NormalizePin(request?.Pin);

        lock (state)
        {
            NormalizeAccessState(state, now);
            var beforeSnapshot = CreateAccessSnapshot(state, now, maxAttempts);

            if (beforeSnapshot.IsTrusted)
            {
                NoCache();
                return Ok(new
                {
                    ok = true,
                    valid = true,
                    maxAttempts,
                    remainingAttempts = beforeSnapshot.RemainingAttempts,
                    lockoutMinutes,
                    trustMinutes,
                    lockedUntilUtc = beforeSnapshot.LockedUntilUtc,
                    trustedUntilUtc = beforeSnapshot.TrustedUntilUtc,
                    isLocked = beforeSnapshot.IsLocked,
                    isTrusted = beforeSnapshot.IsTrusted
                });
            }

            if (beforeSnapshot.IsLocked)
            {
                NoCache();
                return Ok(new
                {
                    ok = true,
                    valid = false,
                    maxAttempts,
                    remainingAttempts = 0,
                    lockoutMinutes,
                    trustMinutes,
                    lockedUntilUtc = beforeSnapshot.LockedUntilUtc,
                    trustedUntilUtc = beforeSnapshot.TrustedUntilUtc,
                    isLocked = true,
                    isTrusted = false
                });
            }

            if (pin is null)
            {
                NoCache();
                return Ok(new
                {
                    ok = true,
                    valid = false,
                    code = "parental_pin_invalid_format",
                    maxAttempts,
                    remainingAttempts = beforeSnapshot.RemainingAttempts,
                    lockoutMinutes,
                    trustMinutes,
                    lockedUntilUtc = 0,
                    trustedUntilUtc = 0,
                    isLocked = false,
                    isTrusted = false
                });
            }

            var valid = VerifyPinHash(pin, cfg.ParentalPinHash, cfg.ParentalPinSalt);
            if (valid)
            {
                state.FailedAttempts = 0;
                state.LockedUntilUtc = 0;
                state.TrustedUntilUtc = trustMinutes > 0
                    ? now + (trustMinutes * 60_000L)
                    : 0;

                var successSnapshot = CreateAccessSnapshot(state, now, maxAttempts);
                NoCache();
                return Ok(new
                {
                    ok = true,
                    valid = true,
                    maxAttempts,
                    remainingAttempts = successSnapshot.RemainingAttempts,
                    lockoutMinutes,
                    trustMinutes,
                    lockedUntilUtc = successSnapshot.LockedUntilUtc,
                    trustedUntilUtc = successSnapshot.TrustedUntilUtc,
                    isLocked = successSnapshot.IsLocked,
                    isTrusted = successSnapshot.IsTrusted
                });
            }

            state.TrustedUntilUtc = 0;
            state.FailedAttempts = Math.Min(maxAttempts, Math.Max(0, state.FailedAttempts) + 1);
            if (state.FailedAttempts >= maxAttempts)
            {
                state.FailedAttempts = maxAttempts;
                state.LockedUntilUtc = now + (lockoutMinutes * 60_000L);
            }

            var failureSnapshot = CreateAccessSnapshot(state, now, maxAttempts);
            NoCache();
            return Ok(new
            {
                ok = true,
                valid = false,
                maxAttempts,
                remainingAttempts = failureSnapshot.RemainingAttempts,
                lockoutMinutes,
                trustMinutes,
                lockedUntilUtc = failureSnapshot.LockedUntilUtc,
                trustedUntilUtc = failureSnapshot.TrustedUntilUtc,
                isLocked = failureSnapshot.IsLocked,
                isTrusted = failureSnapshot.IsTrusted
            });
        }
    }

    private Dictionary<string, KnownUser> GetKnownUsers()
    {
        var map = new Dictionary<string, KnownUser>(StringComparer.OrdinalIgnoreCase);
        AddKnownUsersFromSource(map, TryGetUsersSource());

        if (map.Count == 0)
        {
            AddKnownUsersFromIds(map, TryGetUserIdsSource());
        }

        return map;
    }

    private object? TryGetUsersSource()
        => TryGetMemberValue(_users, "Users", "GetUsers", "GetAllUsers");

    private object? TryGetUserIdsSource()
        => TryGetMemberValue(_users, "UsersIds", "UserIds", "GetUsersIds", "GetUserIds");

    private void AddKnownUsersFromSource(IDictionary<string, KnownUser> map, object? usersSource)
    {
        if (usersSource is not IEnumerable users)
        {
            return;
        }

        foreach (var user in users)
        {
            AddKnownUser(map, user);
        }
    }

    private void AddKnownUsersFromIds(IDictionary<string, KnownUser> map, object? userIdsSource)
    {
        if (userIdsSource is not IEnumerable userIds)
        {
            return;
        }

        foreach (var value in userIds)
        {
            if (!Guid.TryParse(value?.ToString(), out var userId) || userId == Guid.Empty)
            {
                continue;
            }

            AddKnownUser(map, TryGetUserById(userId));
        }
    }

    private static void AddKnownUser(IDictionary<string, KnownUser> map, object? user)
    {
        var userId = NormalizeUserId(TryGetPropertyValue(user, "Id", "UserId")?.ToString());
        if (string.IsNullOrWhiteSpace(userId))
        {
            return;
        }

        map[userId] = new KnownUser(userId, GetUserName(user), IsAdminUser(user));
    }

    private static object ToRuleResponse(ParentalPinRuleEntry entry)
        => new
        {
            userId = entry.UserId,
            userName = entry.UserName,
            ratingThreshold = entry.RatingThreshold,
            requireUnratedPin = entry.RequireUnratedPin,
            updatedAtUtc = entry.UpdatedAtUtc
        };

    private object BuildSettingsResponse(
        JMSFusionConfiguration cfg,
        IReadOnlyDictionary<string, KnownUser> users,
        IReadOnlyList<ParentalPinRuleEntry> rules,
        string? unlockedUserId = null)
    {
        var lockStates = GetLockedUserSnapshots(users, cfg.ParentalPinMaxAttempts)
            .Select(entry => new
            {
                userId = entry.UserId,
                userName = entry.UserName,
                lockedUntilUtc = entry.LockedUntilUtc,
                remainingMinutes = entry.RemainingMinutes
            })
            .ToList();

        return new
        {
            ok = true,
            hasPin = HasConfiguredPin(cfg),
            revision = cfg.ParentalPinRevision,
            thresholds = AllowedThresholds,
            rules = rules.Select(ToRuleResponse).ToList(),
            maxAttempts = cfg.ParentalPinMaxAttempts,
            lockoutMinutes = cfg.ParentalPinLockoutMinutes,
            trustMinutes = cfg.ParentalPinTrustMinutes,
            users = users.Values
                .OrderBy(user => user.UserName, StringComparer.OrdinalIgnoreCase)
                .Select(user => new UserDto
                {
                    UserId = user.UserId,
                    UserName = user.UserName,
                    IsAdmin = user.IsAdmin
                })
                .ToList(),
            lockStates,
            unlockedUserId = string.IsNullOrWhiteSpace(unlockedUserId) ? null : unlockedUserId
        };
    }

    private static List<ParentalPinRuleEntry> SanitizeRules(
        IEnumerable<ParentalPinRuleEntry>? rules,
        IReadOnlyDictionary<string, KnownUser> users,
        out bool changed)
    {
        changed = false;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var output = new List<ParentalPinRuleEntry>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rule in rules ?? Array.Empty<ParentalPinRuleEntry>())
        {
            var userId = NormalizeUserId(rule?.UserId);
            if (string.IsNullOrWhiteSpace(userId))
            {
                changed = true;
                continue;
            }

            if (!users.TryGetValue(userId, out var user))
            {
                changed = true;
                continue;
            }

            if (!seen.Add(userId))
            {
                changed = true;
                continue;
            }

            var threshold = NormalizeThreshold(rule?.RatingThreshold ?? 0);
            var requireUnratedPin = rule?.RequireUnratedPin == true;
            if (threshold <= 0 && !requireUnratedPin)
            {
                changed = true;
                continue;
            }

            var userName = user.UserName;
            var updatedAtUtc = rule?.UpdatedAtUtc ?? 0;
            if (updatedAtUtc <= 0)
            {
                updatedAtUtc = now;
                changed = true;
            }

            var normalized = new ParentalPinRuleEntry
            {
                UserId = userId,
                UserName = userName,
                RatingThreshold = threshold,
                RequireUnratedPin = requireUnratedPin,
                UpdatedAtUtc = updatedAtUtc
            };

            if (!RuleEquals(rule, normalized))
            {
                changed = true;
            }

            output.Add(normalized);
        }

        return output
            .OrderBy(rule => rule.UserName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(rule => rule.UserId, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool AreRulesEqual(
        IReadOnlyList<ParentalPinRuleEntry>? left,
        IReadOnlyList<ParentalPinRuleEntry>? right)
    {
        var leftList = left ?? Array.Empty<ParentalPinRuleEntry>();
        var rightList = right ?? Array.Empty<ParentalPinRuleEntry>();
        if (leftList.Count != rightList.Count)
        {
            return false;
        }

        for (var i = 0; i < leftList.Count; i++)
        {
            if (!RuleEquals(leftList[i], rightList[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static bool RuleEquals(ParentalPinRuleEntry? left, ParentalPinRuleEntry? right)
    {
        if (left is null && right is null)
        {
            return true;
        }

        if (left is null || right is null)
        {
            return false;
        }

        return string.Equals(NormalizeUserId(left.UserId), NormalizeUserId(right.UserId), StringComparison.OrdinalIgnoreCase)
            && string.Equals(left.UserName ?? string.Empty, right.UserName ?? string.Empty, StringComparison.Ordinal)
            && left.RatingThreshold == right.RatingThreshold
            && left.RequireUnratedPin == right.RequireUnratedPin
            && left.UpdatedAtUtc == right.UpdatedAtUtc;
    }

    private static int NormalizeThreshold(int value)
        => AllowedThresholds.Contains(value) ? value : 0;

    private static bool NormalizeSecuritySettings(JMSFusionConfiguration cfg)
    {
        var maxAttempts = NormalizeMaxAttempts(cfg.ParentalPinMaxAttempts);
        var lockoutMinutes = NormalizeLockoutMinutes(cfg.ParentalPinLockoutMinutes);
        var trustMinutes = NormalizeTrustMinutes(cfg.ParentalPinTrustMinutes);
        var changed =
            cfg.ParentalPinMaxAttempts != maxAttempts
            || cfg.ParentalPinLockoutMinutes != lockoutMinutes
            || cfg.ParentalPinTrustMinutes != trustMinutes;

        cfg.ParentalPinMaxAttempts = maxAttempts;
        cfg.ParentalPinLockoutMinutes = lockoutMinutes;
        cfg.ParentalPinTrustMinutes = trustMinutes;
        return changed;
    }

    private static int NormalizeMaxAttempts(int value)
        => value < MinMaxAttempts ? DefaultMaxAttempts : Math.Clamp(value, MinMaxAttempts, MaxMaxAttempts);

    private static int NormalizeLockoutMinutes(int value)
        => value < MinLockoutMinutes ? DefaultLockoutMinutes : Math.Clamp(value, MinLockoutMinutes, MaxLockoutMinutes);

    private static int NormalizeTrustMinutes(int value)
        => value < MinTrustMinutes ? DefaultTrustMinutes : Math.Clamp(value, MinTrustMinutes, MaxTrustMinutes);

    private static List<LockedUserSnapshot> GetLockedUserSnapshots(
        IReadOnlyDictionary<string, KnownUser> users,
        int maxAttempts)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var output = new List<LockedUserSnapshot>();

        foreach (var entry in AccessStates)
        {
            var userId = NormalizeUserId(entry.Key);
            if (string.IsNullOrWhiteSpace(userId) || !users.TryGetValue(userId, out var user))
            {
                continue;
            }

            var state = entry.Value;
            AccessSnapshot snapshot;
            lock (state)
            {
                NormalizeAccessState(state, now);
                snapshot = CreateAccessSnapshot(state, now, maxAttempts);
            }

            if (!snapshot.IsLocked)
            {
                continue;
            }

            output.Add(new LockedUserSnapshot(
                userId,
                user.UserName,
                snapshot.LockedUntilUtc,
                GetRemainingLockMinutes(snapshot.LockedUntilUtc, now)));
        }

        return output
            .OrderBy(entry => entry.UserName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.UserId, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string NormalizeUserId(string? value)
    {
        if (!Guid.TryParse((value ?? string.Empty).Trim(), out var userId) || userId == Guid.Empty)
        {
            return string.Empty;
        }

        return userId.ToString("D");
    }

    private static string? NormalizePin(string? value)
    {
        var pin = string.Concat((value ?? string.Empty).Where(char.IsDigit));
        if (string.IsNullOrWhiteSpace(pin))
        {
            return null;
        }

        return PinRegex.IsMatch(pin) ? pin : null;
    }

    private static bool HasConfiguredPin(JMSFusionConfiguration cfg)
        => !string.IsNullOrWhiteSpace(cfg.ParentalPinHash)
            && !string.IsNullOrWhiteSpace(cfg.ParentalPinSalt);

    private static (string Hash, string Salt) HashPin(string pin)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(pin),
            salt,
            100_000,
            HashAlgorithmName.SHA256,
            32);

        return (Convert.ToBase64String(hash), Convert.ToBase64String(salt));
    }

    private static bool VerifyPinHash(string pin, string? storedHash, string? storedSalt)
    {
        if (string.IsNullOrWhiteSpace(pin)
            || string.IsNullOrWhiteSpace(storedHash)
            || string.IsNullOrWhiteSpace(storedSalt))
        {
            return false;
        }

        try
        {
            var expectedHash = Convert.FromBase64String(storedHash);
            var salt = Convert.FromBase64String(storedSalt);
            var computedHash = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(pin),
                salt,
                100_000,
                HashAlgorithmName.SHA256,
                expectedHash.Length);

            return CryptographicOperations.FixedTimeEquals(computedHash, expectedHash);
        }
        catch
        {
            return false;
        }
    }

    private static ParentalPinAccessState GetAccessState(string userId)
        => AccessStates.GetOrAdd(userId, static _ => new ParentalPinAccessState());

    private static void ClearAccessState(string userId)
    {
        if (!string.IsNullOrWhiteSpace(userId))
        {
            AccessStates.TryRemove(userId, out _);
        }
    }

    private static void NormalizeAccessState(ParentalPinAccessState state, long now)
    {
        if (state.LockedUntilUtc > 0 && state.LockedUntilUtc <= now)
        {
            state.LockedUntilUtc = 0;
            state.FailedAttempts = 0;
        }

        if (state.TrustedUntilUtc > 0 && state.TrustedUntilUtc <= now)
        {
            state.TrustedUntilUtc = 0;
        }

        if (state.FailedAttempts < 0)
        {
            state.FailedAttempts = 0;
        }
    }

    private static int GetRemainingLockMinutes(long lockedUntilUtc, long now)
    {
        var remainingMs = Math.Max(0, lockedUntilUtc - now);
        return Math.Max(1, (int)Math.Ceiling(remainingMs / 60_000d));
    }

    private static AccessSnapshot GetAccessSnapshot(string userId, int maxAttempts)
    {
        var state = GetAccessState(userId);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        lock (state)
        {
            NormalizeAccessState(state, now);
            return CreateAccessSnapshot(state, now, maxAttempts);
        }
    }

    private static AccessSnapshot CreateAccessSnapshot(ParentalPinAccessState state, long now, int maxAttempts)
    {
        var lockedUntilUtc = state.LockedUntilUtc > now ? state.LockedUntilUtc : 0;
        var trustedUntilUtc = state.TrustedUntilUtc > now ? state.TrustedUntilUtc : 0;
        var isLocked = lockedUntilUtc > 0;
        var isTrusted = trustedUntilUtc > 0;
        var remainingAttempts = isLocked
            ? 0
            : Math.Clamp(maxAttempts - Math.Max(0, state.FailedAttempts), 0, maxAttempts);

        return new AccessSnapshot(isLocked, lockedUntilUtc, isTrusted, trustedUntilUtc, remainingAttempts);
    }

    private static AccessSnapshot CreateEmptyAccessSnapshot(int maxAttempts)
        => new(false, 0, false, 0, Math.Max(0, maxAttempts));

    private (object? User, Guid UserId, IActionResult? Result) TryGetAdminUser()
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck;
        }

        if (!IsAdminUser(userCheck.User))
        {
            return (null, Guid.Empty, StatusCode(403, new
            {
                ok = false,
                code = "parental_pin_admin_required",
                error = "This action is only available to administrators."
            }));
        }

        return userCheck;
    }

    private (object? User, Guid UserId, IActionResult? Result) TryGetRequestUser()
    {
        if (!TryGetRequestUserId(out var userId))
        {
            return (null, Guid.Empty, Unauthorized(new
            {
                ok = false,
                code = "parental_pin_user_required",
                error = "X-Emby-UserId is required."
            }));
        }

        var user = TryGetUserById(userId) ?? FindUserByIdInSources(userId);
        if (user is null)
        {
            return (null, Guid.Empty, Unauthorized(new
            {
                ok = false,
                code = "parental_pin_user_not_found",
                error = "User not found."
            }));
        }

        return (user, userId, null);
    }

    private object? TryGetUserById(Guid userId)
    {
        try
        {
            var method = _users.GetType()
                .GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .FirstOrDefault(candidate =>
                {
                    if (!NameMatches(candidate.Name, "GetUserById", "GetUser", "GetUserByIdAsync", "GetUserAsync"))
                    {
                        return false;
                    }

                    var parameters = candidate.GetParameters();
                    return parameters.Length == 1
                        && (parameters[0].ParameterType == typeof(Guid)
                            || parameters[0].ParameterType == typeof(string));
                });

            if (method is null)
            {
                return null;
            }

            var parameterType = method.GetParameters()[0].ParameterType;
            object argument = parameterType == typeof(Guid) ? userId : userId.ToString("D");
            return UnwrapTaskResult(method.Invoke(_users, [argument]));
        }
        catch
        {
            return null;
        }
    }

    private object? FindUserByIdInSources(Guid userId)
    {
        var normalizedUserId = userId.ToString("D");
        if (TryGetUsersSource() is not IEnumerable users)
        {
            return null;
        }

        foreach (var user in users)
        {
            var candidateId = NormalizeUserId(TryGetPropertyValue(user, "Id", "UserId")?.ToString());
            if (string.Equals(candidateId, normalizedUserId, StringComparison.OrdinalIgnoreCase))
            {
                return user;
            }
        }

        return null;
    }

    private bool TryGetRequestUserId(out Guid userId)
    {
        foreach (var candidate in new[]
        {
            Request.Headers["X-Emby-UserId"].FirstOrDefault(),
            Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault(),
            Request.Query["userId"].FirstOrDefault(),
            Request.Query["UserId"].FirstOrDefault(),
            TryGetUserIdFromClaims(),
            TryGetUserIdFromAuthorizationHeader()
        })
        {
            if (Guid.TryParse(candidate, out userId) && userId != Guid.Empty)
            {
                return true;
            }
        }

        userId = Guid.Empty;
        return false;
    }

    private string? TryGetUserIdFromClaims()
    {
        var claimTypes = new[]
        {
            ClaimTypes.NameIdentifier,
            "JellyfinUserId",
            "UserId",
            "user_id",
            "sub"
        };

        foreach (var claimType in claimTypes)
        {
            var claimValue = HttpContext?.User?.FindFirst(claimType)?.Value;
            if (!string.IsNullOrWhiteSpace(claimValue))
            {
                return claimValue;
            }
        }

        return null;
    }

    private string? TryGetUserIdFromAuthorizationHeader()
    {
        var authorization =
            Request.Headers["X-Emby-Authorization"].FirstOrDefault() ??
            Request.Headers["Authorization"].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(authorization))
        {
            return null;
        }

        const string quotedMarker = "UserId=\"";
        var quotedIndex = authorization.IndexOf(quotedMarker, StringComparison.OrdinalIgnoreCase);
        if (quotedIndex >= 0)
        {
            var start = quotedIndex + quotedMarker.Length;
            var end = authorization.IndexOf('"', start);
            if (end > start)
            {
                return authorization[start..end];
            }
        }

        const string plainMarker = "UserId=";
        var plainIndex = authorization.IndexOf(plainMarker, StringComparison.OrdinalIgnoreCase);
        if (plainIndex >= 0)
        {
            var start = plainIndex + plainMarker.Length;
            var tail = authorization[start..];
            var end = tail.IndexOf(',');
            return (end >= 0 ? tail[..end] : tail).Trim().Trim('"');
        }

        return null;
    }

    private static bool IsAdminUser(object? user)
    {
        if (user is null)
        {
            return false;
        }

        var directAdmin = TryReadBoolProperty(user, "IsAdministrator", "IsAdmin");
        if (directAdmin == true)
        {
            return true;
        }

        var policy = TryGetPropertyValue(user, "Policy", "UserPolicy");
        var policyAdmin = TryReadBoolProperty(policy, "IsAdministrator", "IsAdmin");
        if (policyAdmin == true)
        {
            return true;
        }

        if (TryInvokeHasPermission(user, "IsAdministrator", out var hasPermission))
        {
            return hasPermission;
        }

        return TryReadPermissionsCollection(user, "IsAdministrator");
    }

    private static string GetUserName(object? user)
        => PickFirstString(
            TryGetPropertyValue(user, "Username")?.ToString(),
            TryGetPropertyValue(user, "Name")?.ToString(),
            TryGetPropertyValue(user, "UserName")?.ToString(),
            "User");

    private static string PickFirstString(params string?[] values)
    {
        foreach (var value in values)
        {
            var normalized = (value ?? string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(normalized))
            {
                return normalized;
            }
        }

        return string.Empty;
    }

    private static object? TryGetPropertyValue(object? target, params string[] names)
    {
        if (target is null)
        {
            return null;
        }

        var type = target.GetType();
        foreach (var name in names)
        {
            try
            {
                var property = type
                    .GetProperties(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                    .FirstOrDefault(candidate => NameMatches(candidate.Name, name));
                if (property is not null)
                {
                    return UnwrapTaskResult(property.GetValue(target));
                }
            }
            catch
            {
            }
        }

        return null;
    }

    private static object? TryGetMemberValue(object? target, params string[] names)
    {
        var propertyValue = TryGetPropertyValue(target, names);
        if (propertyValue is not null)
        {
            return propertyValue;
        }

        if (target is null)
        {
            return null;
        }

        var type = target.GetType();
        foreach (var name in names)
        {
            try
            {
                var method = type
                    .GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                    .FirstOrDefault(candidate =>
                        NameMatches(candidate.Name, name) &&
                        candidate.GetParameters().Length == 0);
                if (method is not null)
                {
                    return UnwrapTaskResult(method.Invoke(target, []));
                }
            }
            catch
            {
            }
        }

        return null;
    }

    private static bool NameMatches(string candidate, params string[] names)
    {
        foreach (var name in names)
        {
            if (string.Equals(candidate, name, StringComparison.OrdinalIgnoreCase) ||
                candidate.EndsWith("." + name, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static object? UnwrapTaskResult(object? value)
    {
        if (value is not Task task)
        {
            return value;
        }

        try
        {
            task.GetAwaiter().GetResult();
            return TryGetPropertyValue(task, "Result");
        }
        catch
        {
            return null;
        }
    }

    private static bool? TryReadBoolProperty(object? target, params string[] names)
    {
        var value = TryGetPropertyValue(target, names);
        if (value is bool flag)
        {
            return flag;
        }

        if (value is not null && bool.TryParse(value.ToString(), out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static bool TryInvokeHasPermission(object user, string permissionName, out bool isAllowed)
    {
        isAllowed = false;

        try
        {
            var method = user.GetType()
                .GetMethods()
                .FirstOrDefault(candidate =>
                {
                    var parameters = candidate.GetParameters();
                    return string.Equals(candidate.Name, "HasPermission", StringComparison.OrdinalIgnoreCase)
                        && parameters.Length == 1;
                });

            if (method is null)
            {
                return false;
            }

            var parameterType = method.GetParameters()[0].ParameterType;
            object? argument = null;
            if (parameterType.IsEnum)
            {
                argument = Enum.Parse(parameterType, permissionName, ignoreCase: true);
            }
            else if (parameterType == typeof(string))
            {
                argument = permissionName;
            }

            if (argument is null)
            {
                return false;
            }

            var result = method.Invoke(user, [argument]);
            if (result is bool flag)
            {
                isAllowed = flag;
                return true;
            }
        }
        catch
        {
            return false;
        }

        return false;
    }

    private static bool TryReadPermissionsCollection(object user, string permissionName)
    {
        if (TryGetPropertyValue(user, "Permissions") is not IEnumerable permissions)
        {
            return false;
        }

        foreach (var permission in permissions)
        {
            if (permission is null)
            {
                continue;
            }

            var kind = TryGetPropertyValue(permission, "Kind", "Name", "PermissionKind")?.ToString();
            var value = TryReadBoolProperty(permission, "Value", "Enabled", "IsEnabled") == true;
            if (value && string.Equals(kind, permissionName, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private void NoCache()
    {
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";
    }

    private IActionResult InternalError(Exception ex)
    {
        _logger.LogError(ex, "[JMSFusion] Parental PIN settings failed.");
        NoCache();
        return StatusCode(500, new
        {
            ok = false,
            code = "parental_pin_internal_error",
            error = "Parental PIN settings could not be loaded."
        });
    }
}
