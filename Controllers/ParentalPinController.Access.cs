using Jellyfin.Data.Enums;
using Jellyfin.Plugin.JMSFusion.Core;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Controllers;

// Fork ParticularFlix: controle de acesso (nivel 1: politica nativa do Jellyfin por usuario;
// nivel 2: desbloqueio temporario com o PIN global). A rota base vem da classe principal.
public partial class ParentalPinController
{
    public sealed class SaveAccessProfileRequest
    {
        public string? UserId { get; set; }

        public AccessPolicyValues? Restricted { get; set; }

        public bool UnlockEnabled { get; set; }

        public int? UnlockMinutes { get; set; }

        public AccessPolicyValues? Unlocked { get; set; }

        public bool? Apply { get; set; }
    }

    [HttpGet("access/profiles")]
    public IActionResult GetAccessProfiles()
    {
        var adminCheck = TryGetAdminUser();
        if (adminCheck.Result is not null)
        {
            return adminCheck.Result;
        }

        try
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            var users = new List<object>();
            foreach (var u in _users.Users.OrderBy(x => x.Username, StringComparer.OrdinalIgnoreCase))
            {
                var policy = _users.GetUserDto(u).Policy;
                var entry = FindAccessProfile(cfg, u.Id);
                users.Add(new
                {
                    userId = u.Id.ToString("D"),
                    userName = u.Username,
                    isAdmin = policy.IsAdministrator,
                    current = AccessControlCore.Capture(policy),
                    profile = entry is null ? null : ToAccessProfileResponse(entry, now)
                });
            }

            var libraries = new List<object>();
            foreach (var f in _libraries.GetVirtualFolders())
            {
                if (Guid.TryParse(f.ItemId, out var folderId))
                {
                    libraries.Add(new { id = folderId.ToString("N"), name = f.Name });
                }
            }

            NoCache();
            return Ok(new
            {
                ok = true,
                hasPin = HasConfiguredPin(cfg),
                allUnratedItems = AccessControlCore.AllUnratedValues(),
                users,
                libraries
            });
        }
        catch (Exception ex)
        {
            return AccessError(ex);
        }
    }

    [HttpPost("access/profiles")]
    public async Task<IActionResult> SaveAccessProfile([FromBody] SaveAccessProfileRequest? request)
    {
        var adminCheck = TryGetAdminUser();
        if (adminCheck.Result is not null)
        {
            return adminCheck.Result;
        }

        if (request is null || !Guid.TryParse(request.UserId, out var targetId))
        {
            return BadRequest(new { ok = false, code = "access_user_required", error = "userId is required." });
        }

        try
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            await AccessControlCore.Gate.WaitAsync().ConfigureAwait(false);
            try
            {
                var cfg = plugin.Configuration;
                var target = _users.GetUserById(targetId);
                if (target is null)
                {
                    return BadRequest(new { ok = false, code = "access_user_not_found", error = "User not found." });
                }

                var targetPolicy = _users.GetUserDto(target).Policy;
                if (targetPolicy.IsAdministrator)
                {
                    return BadRequest(new { ok = false, code = "access_admin_not_allowed", error = "Administrators cannot be restricted." });
                }

                if (request.UnlockEnabled && !HasConfiguredPin(cfg))
                {
                    return BadRequest(new { ok = false, code = "access_pin_required", error = "Configure the PIN before enabling the temporary unlock." });
                }

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var entry = FindAccessProfile(cfg, targetId);
                if (entry is null)
                {
                    entry = new AccessProfileEntry
                    {
                        UserId = targetId.ToString("D"),
                        Original = AccessControlCore.Capture(targetPolicy)
                    };
                    cfg.AccessProfiles.Add(entry);
                }

                entry.UserName = target.Username;
                entry.Restricted = SanitizeAccessValues(request.Restricted);
                entry.Unlocked = SanitizeAccessValues(request.Unlocked);
                entry.UnlockEnabled = request.UnlockEnabled;
                entry.UnlockMinutes = Math.Clamp(request.UnlockMinutes ?? 30, 1, 480);
                entry.UpdatedAtUtc = now;

                if (request.Apply != false)
                {
                    await AccessControlCore.ApplyAsync(_users, targetId, entry.Restricted).ConfigureAwait(false);
                    entry.UnlockedUntilUtc = 0;
                }

                plugin.UpdateConfiguration(cfg);
                _logger.LogInformation("[JMSFusion] Access control profile saved for user {UserId}.", targetId);

                NoCache();
                return Ok(new { ok = true, profile = ToAccessProfileResponse(entry, now) });
            }
            finally
            {
                AccessControlCore.Gate.Release();
            }
        }
        catch (Exception ex)
        {
            return AccessError(ex);
        }
    }

    [HttpDelete("access/profiles/{userId}")]
    public async Task<IActionResult> DeleteAccessProfile([FromRoute] string userId)
    {
        var adminCheck = TryGetAdminUser();
        if (adminCheck.Result is not null)
        {
            return adminCheck.Result;
        }

        if (!Guid.TryParse(userId, out var targetId))
        {
            return BadRequest(new { ok = false, code = "access_user_required", error = "userId is required." });
        }

        try
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            await AccessControlCore.Gate.WaitAsync().ConfigureAwait(false);
            try
            {
                var cfg = plugin.Configuration;
                var entry = FindAccessProfile(cfg, targetId);
                if (entry is null)
                {
                    NoCache();
                    return Ok(new { ok = true, removed = false });
                }

                // Devolve a politica que o usuario tinha antes de o plugin mexer.
                await AccessControlCore.ApplyAsync(_users, targetId, entry.Original ?? new AccessPolicyValues()).ConfigureAwait(false);
                cfg.AccessProfiles.Remove(entry);
                plugin.UpdateConfiguration(cfg);
                _logger.LogInformation("[JMSFusion] Access control profile removed and original policy restored for user {UserId}.", targetId);

                NoCache();
                return Ok(new { ok = true, removed = true });
            }
            finally
            {
                AccessControlCore.Gate.Release();
            }
        }
        catch (Exception ex)
        {
            return AccessError(ex);
        }
    }

    [HttpGet("access/status")]
    public IActionResult GetAccessStatus()
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck.Result;
        }

        try
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            var cfg = plugin.Configuration;
            NoCache();
            return Ok(BuildAccessStatus(cfg, userCheck.UserId, FindAccessProfile(cfg, userCheck.UserId)));
        }
        catch (Exception ex)
        {
            return AccessError(ex);
        }
    }

    [HttpPost("access/unlock")]
    public async Task<IActionResult> AccessUnlock([FromBody] VerifyPinRequest? request)
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck.Result;
        }

        try
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            await AccessControlCore.Gate.WaitAsync().ConfigureAwait(false);
            try
            {
                var cfg = plugin.Configuration;
                var entry = FindAccessProfile(cfg, userCheck.UserId);
                if (entry is null || !entry.UnlockEnabled || !HasConfiguredPin(cfg))
                {
                    return BadRequest(new { ok = false, code = "access_unlock_unavailable", error = "Temporary unlock is not available for this user." });
                }

                var attempt = CheckAccessPin(userCheck.UserId.ToString("D"), request?.Pin, cfg);
                if (!attempt.Valid)
                {
                    NoCache();
                    return Ok(new
                    {
                        ok = true,
                        valid = false,
                        code = attempt.Code,
                        maxAttempts = cfg.ParentalPinMaxAttempts,
                        remainingAttempts = attempt.Snapshot.RemainingAttempts,
                        isLocked = attempt.Snapshot.IsLocked,
                        lockedUntilUtc = attempt.Snapshot.LockedUntilUtc
                    });
                }

                await AccessControlCore.ApplyAsync(_users, userCheck.UserId, entry.Unlocked).ConfigureAwait(false);
                entry.UnlockedUntilUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + (Math.Clamp(entry.UnlockMinutes, 1, 480) * 60_000L);
                plugin.UpdateConfiguration(cfg);
                _logger.LogInformation("[JMSFusion] Access control: temporary unlock granted to user {UserId} for {Minutes} min.", userCheck.UserId, entry.UnlockMinutes);

                NoCache();
                return Ok(new { ok = true, valid = true, status = BuildAccessStatus(cfg, userCheck.UserId, entry) });
            }
            finally
            {
                AccessControlCore.Gate.Release();
            }
        }
        catch (Exception ex)
        {
            return AccessError(ex);
        }
    }

    [HttpPost("access/lock")]
    public async Task<IActionResult> AccessLock()
    {
        var userCheck = TryGetRequestUser();
        if (userCheck.Result is not null)
        {
            return userCheck.Result;
        }

        try
        {
            var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
            await AccessControlCore.Gate.WaitAsync().ConfigureAwait(false);
            try
            {
                var cfg = plugin.Configuration;
                var entry = FindAccessProfile(cfg, userCheck.UserId);
                if (entry is not null)
                {
                    await AccessControlCore.ApplyAsync(_users, userCheck.UserId, entry.Restricted).ConfigureAwait(false);
                    entry.UnlockedUntilUtc = 0;
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new { ok = true, status = BuildAccessStatus(cfg, userCheck.UserId, entry) });
            }
            finally
            {
                AccessControlCore.Gate.Release();
            }
        }
        catch (Exception ex)
        {
            return AccessError(ex);
        }
    }

    private static AccessProfileEntry? FindAccessProfile(JMSFusionConfiguration cfg, Guid userId)
    {
        return cfg.AccessProfiles.FirstOrDefault(p => Guid.TryParse(p.UserId, out var id) && id == userId);
    }

    private static object ToAccessProfileResponse(AccessProfileEntry entry, long now)
    {
        return new
        {
            userId = entry.UserId,
            userName = entry.UserName,
            original = entry.Original,
            restricted = entry.Restricted,
            unlockEnabled = entry.UnlockEnabled,
            unlockMinutes = entry.UnlockMinutes,
            unlocked = entry.Unlocked,
            isUnlocked = entry.UnlockedUntilUtc > now,
            unlockedUntilUtc = entry.UnlockedUntilUtc > now ? entry.UnlockedUntilUtc : 0,
            updatedAtUtc = entry.UpdatedAtUtc
        };
    }

    private static object BuildAccessStatus(JMSFusionConfiguration cfg, Guid userId, AccessProfileEntry? entry)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var access = GetAccessSnapshot(userId.ToString("D"), cfg.ParentalPinMaxAttempts);
        var unlocked = entry is not null && entry.UnlockedUntilUtc > now;
        return new
        {
            ok = true,
            hasProfile = entry is not null,
            unlockAvailable = entry is not null && entry.UnlockEnabled && HasConfiguredPin(cfg),
            unlockMinutes = entry?.UnlockMinutes ?? 0,
            isUnlocked = unlocked,
            unlockedUntilUtc = unlocked && entry is not null ? entry.UnlockedUntilUtc : 0,
            maxAttempts = cfg.ParentalPinMaxAttempts,
            remainingAttempts = access.RemainingAttempts,
            isLocked = access.IsLocked,
            lockedUntilUtc = access.LockedUntilUtc
        };
    }

    private static AccessPolicyValues SanitizeAccessValues(AccessPolicyValues? values)
    {
        values ??= new AccessPolicyValues();
        int? rating = values.MaxParentalRating;
        if (rating.HasValue)
        {
            rating = Math.Clamp(rating.Value, 0, 100);
        }

        return new AccessPolicyValues
        {
            MaxParentalRating = rating,
            BlockUnratedItems = (values.BlockUnratedItems ?? Array.Empty<int>())
                .Where(v => Enum.IsDefined(typeof(UnratedItem), v))
                .Distinct()
                .ToArray(),
            BlockedTags = CleanTags(values.BlockedTags),
            AllowedTags = CleanTags(values.AllowedTags),
            EnableAllFolders = values.EnableAllFolders,
            EnabledFolders = (values.EnabledFolders ?? Array.Empty<string>())
                .Select(s => Guid.TryParse(s, out var g) ? g.ToString("N") : string.Empty)
                .Where(s => s.Length > 0)
                .Distinct()
                .ToArray()
        };
    }

    private static string[] CleanTags(string[]? tags)
    {
        return (tags ?? Array.Empty<string>())
            .Select(t => (t ?? string.Empty).Trim())
            .Where(t => t.Length > 0 && t.Length <= 64)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(100)
            .ToArray();
    }

    // Mesmo controle de tentativas e bloqueio do PIN de reproducao, sem a janela de confianca.
    private static (bool Valid, string? Code, AccessSnapshot Snapshot) CheckAccessPin(string userId, string? rawPin, JMSFusionConfiguration cfg)
    {
        var state = GetAccessState(userId);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var maxAttempts = cfg.ParentalPinMaxAttempts;
        var lockoutMinutes = cfg.ParentalPinLockoutMinutes;
        var pin = NormalizePin(rawPin);

        lock (state)
        {
            NormalizeAccessState(state, now);
            var before = CreateAccessSnapshot(state, now, maxAttempts);
            if (before.IsLocked)
            {
                return (false, "access_locked", before);
            }

            if (pin is null)
            {
                return (false, "parental_pin_invalid_format", before);
            }

            if (VerifyPinHash(pin, cfg.ParentalPinHash, cfg.ParentalPinSalt))
            {
                state.FailedAttempts = 0;
                state.LockedUntilUtc = 0;
                return (true, null, CreateAccessSnapshot(state, now, maxAttempts));
            }

            state.FailedAttempts = Math.Min(maxAttempts, Math.Max(0, state.FailedAttempts) + 1);
            if (state.FailedAttempts >= maxAttempts)
            {
                state.FailedAttempts = maxAttempts;
                state.LockedUntilUtc = now + (lockoutMinutes * 60_000L);
            }

            return (false, "parental_pin_invalid", CreateAccessSnapshot(state, now, maxAttempts));
        }
    }

    private IActionResult AccessError(Exception ex)
    {
        _logger.LogError(ex, "[JMSFusion] Access control request failed.");
        NoCache();
        return StatusCode(500, new
        {
            ok = false,
            code = "access_internal_error",
            error = "The access control request could not be completed."
        });
    }
}
