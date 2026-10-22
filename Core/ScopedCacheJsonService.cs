using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    public sealed class ScopedCacheJsonService
    {
        private static readonly string EmptyPayload = "{}";
        private static readonly string[] AllowedCacheTypes =
        {
            "recentRows",
            "directorRows",
            "personalRecommendations",
            "collectionCache",
            "sliderCache",
            "gmmpMusic"
        };
        private static readonly HashSet<string> VolatileCacheFields = new(StringComparer.OrdinalIgnoreCase)
        {
            "fetchedAt",
            "expiresAt",
            "updatedAt"
        };
        private static readonly JsonSerializerOptions CompactJsonOptions = new()
        {
            WriteIndented = false
        };
        private const int SliderCacheMaxItemDetails = 160;
        private const int SliderCacheMaxQueryRecords = 20;
        private const int SliderCacheMaxMetaRecords = 100;
        private static readonly TimeSpan SliderCacheMetaTtl = TimeSpan.FromDays(30);
        private static readonly string[] SliderDetailItemDropFields =
        {
            "ImageBlurHashes",
            "GenreItems",
            "MediaSources",
            "Chapters",
            "Path"
        };
        private static readonly string[] SliderPersonKeepFields =
        {
            "Name",
            "Id",
            "Role",
            "Type",
            "PrimaryImageTag"
        };
        private static readonly string[] SliderMediaStreamKeepFields =
        {
            "Type",
            "Codec",
            "Language",
            "Title",
            "DisplayTitle",
            "IsDefault",
            "IsForced",
            "IsHearingImpaired",
            "Height",
            "Width",
            "VideoRange",
            "VideoRangeType",
            "BitDepth",
            "Profile",
            "Channels",
            "ChannelLayout",
            "Index"
        };
        private static readonly string[] SliderStudioKeepFields =
        {
            "Name",
            "Id"
        };
        private static readonly string[] SliderPoolItemKeepFields =
        {
            "Name",
            "OriginalTitle",
            "ServerId",
            "Id",
            "Type",
            "MediaType",
            "RunTimeTicks",
            "ProductionYear",
            "CommunityRating",
            "CriticRating",
            "OfficialRating",
            "ImageTags",
            "BackdropImageTags",
            "PrimaryImageAspectRatio",
            "UserData",
            "SeriesId",
            "SeriesName",
            "CollectionIds",
            "AlbumId",
            "Album",
            "AlbumArtist",
            "Artists",
            "PrimaryImageTag",
            "ChildCount",
            "ParentIndexNumber",
            "IndexNumber"
        };

        private readonly ILogger<ScopedCacheJsonService> _logger;
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks =
            new(StringComparer.OrdinalIgnoreCase);

        public ScopedCacheJsonService(ILogger<ScopedCacheJsonService> logger)
        {
            _logger = logger;
        }

        public bool TryNormalizeCacheType(string? cacheType, out string normalizedCacheType)
        {
            var value = (cacheType ?? string.Empty).Trim();
            foreach (var allowed in AllowedCacheTypes)
            {
                if (string.Equals(allowed, value, StringComparison.OrdinalIgnoreCase))
                {
                    normalizedCacheType = allowed;
                    return true;
                }
            }

            normalizedCacheType = string.Empty;
            return false;
        }

        public async Task<string> ReadAsync(string cacheType, string scope, CancellationToken cancellationToken)
        {
            var filePath = GetFilePath(cacheType, scope);
            var gate = _locks.GetOrAdd(filePath, static _ => new SemaphoreSlim(1, 1));

            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!File.Exists(filePath))
                {
                    return EmptyPayload;
                }

                var raw = await File.ReadAllTextAsync(filePath, Encoding.UTF8, cancellationToken).ConfigureAwait(false);
                if (string.IsNullOrWhiteSpace(raw))
                {
                    return EmptyPayload;
                }

                try
                {
                    var normalizedRaw = NormalizeCachePayload(cacheType, raw);
                    if (!string.Equals(raw, normalizedRaw, StringComparison.Ordinal))
                    {
                        await WriteRawFileAsync(filePath, normalizedRaw, cancellationToken).ConfigureAwait(false);
                    }

                    return normalizedRaw;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[JMSFusion] Scoped cache JSON invalid, returning empty payload for {CacheType} {Scope}", cacheType, scope);
                    return EmptyPayload;
                }
            }
            finally
            {
                gate.Release();
            }
        }

        public async Task<bool> WriteAsync(string cacheType, string scope, string rawJson, CancellationToken cancellationToken)
        {
            var filePath = GetFilePath(cacheType, scope);
            var directory = Path.GetDirectoryName(filePath) ?? JMSFusionPlugin.Instance.GetStorageDirectory("scoped-cache", cacheType);
            Directory.CreateDirectory(directory);

            string normalizedJson;
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(rawJson) ? EmptyPayload : rawJson);
                normalizedJson = doc.RootElement.GetRawText();
            }
            catch (Exception ex)
            {
                throw new ArgumentException("Cache payload must be valid JSON.", nameof(rawJson), ex);
            }

            normalizedJson = NormalizeCachePayload(cacheType, normalizedJson);

            var gate = _locks.GetOrAdd(filePath, static _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (File.Exists(filePath))
                {
                    var existingRaw = await File.ReadAllTextAsync(filePath, Encoding.UTF8, cancellationToken).ConfigureAwait(false);
                    if (string.Equals(existingRaw, normalizedJson, StringComparison.Ordinal) ||
                        (AreStableEquivalent(cacheType, existingRaw, normalizedJson) &&
                         !ShouldRewriteStableEquivalent(cacheType, existingRaw, normalizedJson)))
                    {
                        return false;
                    }
                }

                var tempPath = Path.Combine(directory, $"{Path.GetFileName(filePath)}.{Guid.NewGuid():N}.tmp");
                try
                {
                    await File.WriteAllTextAsync(
                        tempPath,
                        normalizedJson,
                        new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                        cancellationToken).ConfigureAwait(false);

                    File.Move(tempPath, filePath, true);
                    return true;
                }
                finally
                {
                    try
                    {
                        if (File.Exists(tempPath))
                        {
                            File.Delete(tempPath);
                        }
                    }
                    catch
                    {
                    }
                }
            }
            finally
            {
                gate.Release();
            }
        }

        private static string NormalizeCachePayload(string cacheType, string rawJson)
        {
            if (string.IsNullOrWhiteSpace(rawJson))
            {
                return EmptyPayload;
            }

            if (!IsSliderCache(cacheType))
            {
                using var _ = JsonDocument.Parse(rawJson);
                return rawJson;
            }

            return CompactSliderCachePayload(rawJson);
        }

        private static string CompactSliderCachePayload(string rawJson)
        {
            var node = JsonNode.Parse(rawJson);
            if (node is not JsonObject root)
            {
                return EmptyPayload;
            }

            var currentMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            var itemDetails = EnsureJsonObject(root, "itemDetails");
            CompactSliderItemDetails(itemDetails);
            PruneExpiringMap(itemDetails, SliderCacheMaxItemDetails, currentMs);

            var queryCache = EnsureJsonObject(root, "queryCache");
            CompactSliderQueryCache(queryCache);
            PruneExpiringMap(
                queryCache,
                SliderCacheMaxQueryRecords,
                currentMs,
                removeHomeItemUserData: true);
            root["userData"] = new JsonObject();
            PruneMetaMap(EnsureJsonObject(root, "meta"), SliderCacheMaxMetaRecords, currentMs);

            return root.ToJsonString(CompactJsonOptions);
        }

        private static bool IsSliderCache(string cacheType)
        {
            return string.Equals(cacheType, "sliderCache", StringComparison.OrdinalIgnoreCase);
        }

        private static bool ShouldRewriteStableEquivalent(string cacheType, string existingRaw, string incomingRaw)
        {
            return IsSliderCache(cacheType) && incomingRaw.Length + 1024 < existingRaw.Length;
        }

        private static JsonObject EnsureJsonObject(JsonObject root, string propertyName)
        {
            if (root.TryGetPropertyValue(propertyName, out var node) && node is JsonObject existing)
            {
                return existing;
            }

            var replacement = new JsonObject();
            root[propertyName] = replacement;
            return replacement;
        }

        private static void CompactSliderItemDetails(JsonObject itemDetails)
        {
            foreach (var property in itemDetails.ToList())
            {
                if (property.Value is not JsonObject row ||
                    !row.TryGetPropertyValue("data", out var dataNode) ||
                    dataNode is not JsonObject data)
                {
                    continue;
                }

                CompactSliderDetailItem(data);
            }
        }

        private static void CompactSliderDetailItem(JsonObject item)
        {
            foreach (var field in SliderDetailItemDropFields)
            {
                item.Remove(field);
            }

            if (item.TryGetPropertyValue("People", out var peopleNode) && peopleNode is JsonArray people)
            {
                item["People"] = CompactSliderPeople(people);
            }

            if (item.TryGetPropertyValue("MediaStreams", out var mediaStreamsNode) && mediaStreamsNode is JsonArray mediaStreams)
            {
                item["MediaStreams"] = CompactSliderMediaStreams(mediaStreams);
            }

            if (item.TryGetPropertyValue("Studios", out var studiosNode) && studiosNode is JsonArray studios)
            {
                item["Studios"] = CompactSliderStudios(studios);
            }
        }

        private static JsonArray CompactSliderPeople(JsonArray people)
        {
            var output = new JsonArray();
            var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            foreach (var node in people)
            {
                if (node is not JsonObject person)
                {
                    continue;
                }

                var type = GetStringProperty(person, "Type");
                var limit = type switch
                {
                    "Actor" => 12,
                    "Director" => 4,
                    "Writer" => 4,
                    _ => 0
                };

                if (limit <= 0)
                {
                    continue;
                }

                counts.TryGetValue(type, out var count);
                if (count >= limit)
                {
                    continue;
                }

                var compact = CopyDefinedProperties(person, SliderPersonKeepFields);
                if (compact.Count == 0)
                {
                    continue;
                }

                output.Add(compact);
                counts[type] = count + 1;
            }

            return output;
        }

        private static JsonArray CompactSliderMediaStreams(JsonArray mediaStreams)
        {
            var output = new JsonArray();
            var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            foreach (var node in mediaStreams)
            {
                if (node is not JsonObject stream)
                {
                    continue;
                }

                var type = GetStringProperty(stream, "Type");
                var limit = type switch
                {
                    "Video" => 1,
                    "Audio" => 4,
                    "Subtitle" => 8,
                    _ => 0
                };

                if (limit <= 0)
                {
                    continue;
                }

                counts.TryGetValue(type, out var count);
                if (count >= limit)
                {
                    continue;
                }

                var compact = CopyDefinedProperties(stream, SliderMediaStreamKeepFields);
                if (compact.Count == 0)
                {
                    continue;
                }

                output.Add(compact);
                counts[type] = count + 1;
            }

            return output;
        }

        private static JsonArray CompactSliderStudios(JsonArray studios)
        {
            var output = new JsonArray();

            foreach (var node in studios.Take(8))
            {
                if (node is JsonObject studio)
                {
                    var compact = CopyDefinedProperties(studio, SliderStudioKeepFields);
                    if (compact.Count > 0)
                    {
                        output.Add(compact);
                    }
                }
                else if (node is not null)
                {
                    output.Add(node.DeepClone());
                }
            }

            return output;
        }

        private static void CompactSliderQueryCache(JsonObject queryCache)
        {
            foreach (var property in queryCache.ToList())
            {
                if (property.Value is not JsonObject row ||
                    !IsItemsPoolRow(row) ||
                    !row.TryGetPropertyValue("data", out var wrapperNode) ||
                    wrapperNode is not JsonObject wrapper ||
                    !string.Equals(GetStringProperty(wrapper, "__type"), "json", StringComparison.Ordinal))
                {
                    continue;
                }

                if (!wrapper.TryGetPropertyValue("data", out var payloadNode) || payloadNode is null)
                {
                    continue;
                }

                if (payloadNode is JsonObject payload &&
                    payload.TryGetPropertyValue("Items", out var itemsNode) &&
                    itemsNode is JsonArray items)
                {
                    payload["Items"] = CompactSliderPoolItems(items);
                }
                else if (payloadNode is JsonArray payloadItems)
                {
                    wrapper["data"] = CompactSliderPoolItems(payloadItems);
                }
            }
        }

        private static JsonArray CompactSliderPoolItems(JsonArray items)
        {
            var output = new JsonArray();

            foreach (var node in items)
            {
                if (node is JsonObject item)
                {
                    output.Add(CopyDefinedProperties(item, SliderPoolItemKeepFields));
                }
                else if (node is not null)
                {
                    output.Add(node.DeepClone());
                }
            }

            return output;
        }

        private static bool IsItemsPoolRow(JsonObject row)
        {
            if (!row.TryGetPropertyValue("meta", out var metaNode) || metaNode is not JsonObject meta)
            {
                return false;
            }

            return string.Equals(GetStringProperty(meta, "kind"), "itemsPool", StringComparison.Ordinal);
        }

        private static JsonObject CopyDefinedProperties(JsonObject source, IEnumerable<string> propertyNames)
        {
            var output = new JsonObject();

            foreach (var propertyName in propertyNames)
            {
                if (!source.TryGetPropertyValue(propertyName, out var node) || node is null)
                {
                    continue;
                }

                output[propertyName] = node.DeepClone();
            }

            return output;
        }

        private static void PruneExpiringMap(
            JsonObject map,
            int maxItems,
            long currentMs,
            bool removeHomeItemUserData = false)
        {
            var removeKeys = new List<string>();

            foreach (var property in map)
            {
                if (property.Value is not JsonObject row)
                {
                    removeKeys.Add(property.Key);
                    continue;
                }

                var expiresAt = GetLongProperty(row, "expiresAt");
                if (expiresAt > 0 && expiresAt <= currentMs)
                {
                    removeKeys.Add(property.Key);
                    continue;
                }

                if (removeHomeItemUserData && IsHomeItemUserDataRow(row))
                {
                    removeKeys.Add(property.Key);
                }
            }

            RemoveKeys(map, removeKeys);
            TrimMapByOldest(map, maxItems, "expiresAt", "fetchedAt");
        }

        private static void PruneMetaMap(JsonObject map, int maxItems, long currentMs)
        {
            var cutoffMs = currentMs - (long)SliderCacheMetaTtl.TotalMilliseconds;
            var removeKeys = new List<string>();

            foreach (var property in map)
            {
                if (property.Value is not JsonObject row)
                {
                    removeKeys.Add(property.Key);
                    continue;
                }

                var updatedAt = GetLongProperty(row, "updatedAt");
                if (updatedAt > 0 && updatedAt < cutoffMs)
                {
                    removeKeys.Add(property.Key);
                }
            }

            RemoveKeys(map, removeKeys);
            TrimMapByOldest(map, maxItems, "updatedAt", "updatedAt");
        }

        private static void TrimMapByOldest(JsonObject map, int maxItems, string primaryTimestamp, string secondaryTimestamp)
        {
            if (maxItems <= 0)
            {
                map.Clear();
                return;
            }

            var overflow = map.Count - maxItems;
            if (overflow <= 0)
            {
                return;
            }

            var removeKeys = map
                .Select(property =>
                {
                    var row = property.Value as JsonObject;
                    return new
                    {
                        property.Key,
                        Primary = row is null ? 0 : GetLongProperty(row, primaryTimestamp),
                        Secondary = row is null ? 0 : GetLongProperty(row, secondaryTimestamp)
                    };
                })
                .OrderBy(entry => entry.Primary)
                .ThenBy(entry => entry.Secondary)
                .Take(overflow)
                .Select(entry => entry.Key)
                .ToList();

            RemoveKeys(map, removeKeys);
        }

        private static bool IsHomeItemUserDataRow(JsonObject row)
        {
            if (!row.TryGetPropertyValue("meta", out var metaNode) || metaNode is not JsonObject meta)
            {
                return false;
            }

            return string.Equals(GetStringProperty(meta, "kind"), "homeItemUserData", StringComparison.Ordinal);
        }

        private static long GetLongProperty(JsonObject obj, string propertyName)
        {
            if (!obj.TryGetPropertyValue(propertyName, out var node) || node is null)
            {
                return 0;
            }

            try
            {
                if (node is JsonValue value)
                {
                    if (value.TryGetValue<long>(out var longValue))
                    {
                        return longValue;
                    }

                    if (value.TryGetValue<double>(out var doubleValue) && double.IsFinite(doubleValue))
                    {
                        return (long)doubleValue;
                    }

                    if (value.TryGetValue<string>(out var stringValue) &&
                        long.TryParse(stringValue, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
                    {
                        return parsed;
                    }
                }
            }
            catch
            {
            }

            return 0;
        }

        private static string GetStringProperty(JsonObject obj, string propertyName)
        {
            if (!obj.TryGetPropertyValue(propertyName, out var node) || node is null)
            {
                return string.Empty;
            }

            try
            {
                return node is JsonValue value && value.TryGetValue<string>(out var stringValue)
                    ? stringValue
                    : string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static void RemoveKeys(JsonObject map, IReadOnlyCollection<string> keys)
        {
            foreach (var key in keys)
            {
                map.Remove(key);
            }
        }

        private static async Task WriteRawFileAsync(string filePath, string rawJson, CancellationToken cancellationToken)
        {
            var directory = Path.GetDirectoryName(filePath) ?? Path.GetTempPath();
            Directory.CreateDirectory(directory);

            var tempPath = Path.Combine(directory, $"{Path.GetFileName(filePath)}.{Guid.NewGuid():N}.tmp");
            try
            {
                await File.WriteAllTextAsync(
                    tempPath,
                    rawJson,
                    new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                    cancellationToken).ConfigureAwait(false);

                File.Move(tempPath, filePath, true);
            }
            finally
            {
                try
                {
                    if (File.Exists(tempPath))
                    {
                        File.Delete(tempPath);
                    }
                }
                catch
                {
                }
            }
        }

        private static bool AreStableEquivalent(string cacheType, string existingRaw, string incomingRaw)
        {
            try
            {
                using var existingDoc = JsonDocument.Parse(existingRaw);
                using var incomingDoc = JsonDocument.Parse(incomingRaw);
                return AreStableEquivalent(
                    existingDoc.RootElement,
                    incomingDoc.RootElement,
                    cacheType,
                    depth: 0);
            }
            catch
            {
                return false;
            }
        }

        private static bool AreStableEquivalent(JsonElement existing, JsonElement incoming, string cacheType, int depth)
        {
            if (existing.ValueKind != incoming.ValueKind)
            {
                return false;
            }

            switch (existing.ValueKind)
            {
                case JsonValueKind.Object:
                    return AreStableObjectsEquivalent(existing, incoming, cacheType, depth);
                case JsonValueKind.Array:
                    if (existing.GetArrayLength() != incoming.GetArrayLength())
                    {
                        return false;
                    }

                    using (var existingItems = existing.EnumerateArray())
                    using (var incomingItems = incoming.EnumerateArray())
                    {
                        while (existingItems.MoveNext() && incomingItems.MoveNext())
                        {
                            if (!AreStableEquivalent(existingItems.Current, incomingItems.Current, cacheType, depth + 1))
                            {
                                return false;
                            }
                        }
                    }

                    return true;
                case JsonValueKind.String:
                    return string.Equals(existing.GetString(), incoming.GetString(), StringComparison.Ordinal);
                case JsonValueKind.Number:
                    return string.Equals(existing.GetRawText(), incoming.GetRawText(), StringComparison.Ordinal);
                case JsonValueKind.True:
                case JsonValueKind.False:
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    return true;
                default:
                    return string.Equals(existing.GetRawText(), incoming.GetRawText(), StringComparison.Ordinal);
            }
        }

        private static bool AreStableObjectsEquivalent(JsonElement existing, JsonElement incoming, string cacheType, int depth)
        {
            var existingCount = 0;
            var incomingCount = 0;

            foreach (var property in existing.EnumerateObject())
            {
                if (ShouldIgnoreStableProperty(cacheType, property.Name, depth))
                {
                    continue;
                }

                existingCount++;
                if (!incoming.TryGetProperty(property.Name, out var incomingProperty) ||
                    !AreStableEquivalent(property.Value, incomingProperty, cacheType, depth + 1))
                {
                    return false;
                }
            }

            foreach (var property in incoming.EnumerateObject())
            {
                if (!ShouldIgnoreStableProperty(cacheType, property.Name, depth))
                {
                    incomingCount++;
                }
            }

            return existingCount == incomingCount;
        }

        private static bool ShouldIgnoreStableProperty(string cacheType, string propertyName, int depth)
        {
            if (VolatileCacheFields.Contains(propertyName))
            {
                if (string.Equals(cacheType, "sliderCache", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(propertyName, "expiresAt", StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }

                return true;
            }

            if (depth == 1 &&
                string.Equals(cacheType, "personalRecommendations", StringComparison.OrdinalIgnoreCase) &&
                propertyName.StartsWith("prc:", StringComparison.OrdinalIgnoreCase) &&
                propertyName.Contains(":lastShown:", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return depth == 0 &&
                string.Equals(cacheType, "sliderCache", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(propertyName, "userData", StringComparison.Ordinal);
        }

        public async Task<bool> DeleteAsync(string cacheType, string scope, CancellationToken cancellationToken)
        {
            var filePath = GetFilePath(cacheType, scope);
            var gate = _locks.GetOrAdd(filePath, static _ => new SemaphoreSlim(1, 1));

            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!File.Exists(filePath))
                {
                    return false;
                }

                File.Delete(filePath);
                return true;
            }
            finally
            {
                gate.Release();
            }
        }

        // Tipos de cache que guardam listas de itens e dependem das permissoes do usuario.
        public static readonly string[] GenerationCacheTypes =
        {
            "sliderCache", "recentRows", "directorRows", "personalRecommendations", "collectionCache"
        };

        // Os escopos dos caches sao "serverId|userId"; a geracao e a do usuario citado no escopo.
        public static long CurrentGeneration(string cacheType, string? scope)
        {
            if (string.IsNullOrWhiteSpace(scope)
                || !GenerationCacheTypes.Contains(cacheType, StringComparer.OrdinalIgnoreCase))
            {
                return 0;
            }

            var entries = JMSFusionPlugin.Instance?.Configuration?.AccessCacheGenerations;
            if (entries is null || entries.Count == 0)
            {
                return 0;
            }

            var compact = scope.Replace("-", string.Empty, StringComparison.Ordinal);
            foreach (var entry in entries)
            {
                if (!string.IsNullOrEmpty(entry.UserId)
                    && compact.Contains(entry.UserId, StringComparison.OrdinalIgnoreCase))
                {
                    return entry.Generation;
                }
            }

            return 0;
        }

        private static string GetFilePath(string cacheType, string scope)
        {
            var normalizedScope = NormalizeScope(scope);
            var generation = CurrentGeneration(cacheType, normalizedScope);
            if (generation > 0)
            {
                normalizedScope = $"{normalizedScope}#g{generation}";
            }

            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedScope))).ToLowerInvariant();
            var directory = JMSFusionPlugin.Instance.GetStorageDirectory("scoped-cache", cacheType);
            return Path.Combine(directory, $"{hash}.json");
        }

        private static string NormalizeScope(string scope)
        {
            var normalized = (scope ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalized))
            {
                throw new ArgumentException("Scope is required.", nameof(scope));
            }

            return normalized;
        }
    }
}
