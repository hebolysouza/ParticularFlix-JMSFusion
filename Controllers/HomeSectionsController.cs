using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Plugin.JMSFusion.Core;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    // Fork ParticularFlix 4.0.0.12: Home do Home Screen Sections por usuario, sem reiniciar o Jellyfin (ver HomeSectionsBridge).
    // Somente administrador ou chave de API (para o gestor de acessos e os scripts pf-vm-*).
    //   GET  /Plugins/JMSFusion/HomeSections            usuarios, se tem Home propria, secoes ligadas, modelo atual
    //   POST /Plugins/JMSFusion/HomeSections/Template   { "userId": "<id>" | "" }  define (ou desliga) o usuario modelo
    //   POST /Plugins/JMSFusion/HomeSections/Copy       { "sourceUserId", "targetUserIds": [], "allUsers", "onlyMissing", "dryRun" }
    [ApiController]
    [Route("Plugins/JMSFusion/HomeSections")]
    public class HomeSectionsController : ControllerBase
    {
        private readonly IUserManager _users;
        private readonly IApplicationPaths _paths;
        private readonly IServiceProvider _services;
        private readonly ILogger<HomeSectionsController> _logger;

        public HomeSectionsController(IUserManager users, IApplicationPaths paths, IServiceProvider services, ILogger<HomeSectionsController> logger)
        {
            _users = users;
            _paths = paths;
            _services = services;
            _logger = logger;
            AccessControlCore.Services ??= services;
        }

        private IActionResult? RequireAdmin()
        {
            var level = RequestAuth.GetLevel(HttpContext, _users);
            if (level == RequestAuth.Level.Admin) return null;
            return level == RequestAuth.Level.Anonymous
                ? Unauthorized(new { ok = false, error = "Authentication required." })
                : StatusCode(403, new { ok = false, error = "This action is only available to administrators." });
        }

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        }

        [HttpGet]
        public IActionResult Status()
        {
            var denied = RequireAdmin();
            if (denied is not null) return denied;

            var available = HomeSectionsBridge.TryGetManager(_services, out var manager, out var managerType);
            var withEntry = HomeSectionsBridge.UsersWithEntry(_paths);
            var template = JMSFusionPlugin.Instance.Configuration.HomeSectionsTemplateUserId ?? string.Empty;

            var users = _users.Users
                .OrderBy(u => u.Username, StringComparer.OrdinalIgnoreCase)
                .Select(u =>
                {
                    var sections = available ? HomeSectionsBridge.GetEnabledSections(manager, managerType, u.Id) : null;
                    return new
                    {
                        id = u.Id.ToString("N"),
                        name = u.Username,
                        hasOwnHome = withEntry.Contains(u.Id.ToString("N")),
                        enabledSections = sections?.Count ?? 0,
                        sections
                    };
                })
                .ToList();

            NoCache();
            return Ok(new { ok = true, available, templateUserId = template, users });
        }

        public sealed class TemplateReq
        {
            public string? UserId { get; set; }
        }

        [HttpPost("Template")]
        public IActionResult SetTemplate([FromBody] TemplateReq req)
        {
            var denied = RequireAdmin();
            if (denied is not null) return denied;

            var raw = (req?.UserId ?? string.Empty).Trim();
            var value = string.Empty;
            if (raw.Length > 0)
            {
                if (!Guid.TryParse(raw, out var id) || _users.GetUserById(id) is null)
                {
                    NoCache();
                    return BadRequest(new { ok = false, error = "user-not-found" });
                }

                value = id.ToString("N");
            }

            var plugin = JMSFusionPlugin.Instance;
            var cfg = plugin.Configuration;
            cfg.HomeSectionsTemplateUserId = value;
            plugin.UpdateConfiguration(cfg);
            _logger.LogInformation("[JMSFusion] Home Screen Sections: usuario modelo = {Template}", value.Length > 0 ? value : "(desligado)");

            NoCache();
            return Ok(new { ok = true, templateUserId = value });
        }

        public sealed class CopyReq
        {
            public string? SourceUserId { get; set; }
            public List<string>? TargetUserIds { get; set; }
            public bool? AllUsers { get; set; }

            // Padrao true: so quem ainda nao tem Home propria. false sobrescreve a Home dos alvos.
            public bool? OnlyMissing { get; set; }
            public bool? DryRun { get; set; }
        }

        [HttpPost("Copy")]
        public IActionResult Copy([FromBody] CopyReq req)
        {
            var denied = RequireAdmin();
            if (denied is not null) return denied;

            req ??= new CopyReq();
            if (!HomeSectionsBridge.TryGetManager(_services, out var manager, out var managerType))
            {
                NoCache();
                return Conflict(new { ok = false, error = "home-screen-sections-not-available" });
            }

            var sourceRaw = string.IsNullOrWhiteSpace(req.SourceUserId)
                ? JMSFusionPlugin.Instance.Configuration.HomeSectionsTemplateUserId
                : req.SourceUserId;
            if (!Guid.TryParse(sourceRaw, out var sourceId) || _users.GetUserById(sourceId) is null)
            {
                NoCache();
                return BadRequest(new { ok = false, error = "source-not-found" });
            }

            var onlyMissing = req.OnlyMissing != false;
            var withEntry = HomeSectionsBridge.UsersWithEntry(_paths);

            IEnumerable<Jellyfin.Database.Implementations.Entities.User> targets;
            if (req.AllUsers == true)
            {
                targets = _users.Users.ToList();
            }
            else
            {
                var list = new List<Jellyfin.Database.Implementations.Entities.User>();
                foreach (var raw in req.TargetUserIds ?? new List<string>())
                {
                    if (Guid.TryParse(raw, out var tid) && _users.GetUserById(tid) is { } u) list.Add(u);
                }

                targets = list;
            }

            var results = new List<object>();
            foreach (var user in targets)
            {
                if (user.Id == sourceId) continue;
                var has = withEntry.Contains(user.Id.ToString("N"));
                if (onlyMissing && has)
                {
                    results.Add(new { id = user.Id.ToString("N"), name = user.Username, result = "skipped-has-own-home" });
                    continue;
                }

                if (req.DryRun == true)
                {
                    results.Add(new { id = user.Id.ToString("N"), name = user.Username, result = has ? "would-overwrite" : "would-copy" });
                    continue;
                }

                var ok = HomeSectionsBridge.Copy(manager, managerType, sourceId, user.Id, out var error);
                _logger.LogInformation("[JMSFusion] Home Screen Sections: copia da Home para {User}: {Result}", user.Username, ok ? "ok" : error);
                results.Add(new { id = user.Id.ToString("N"), name = user.Username, result = ok ? (has ? "overwritten" : "copied") : "failed", error });
            }

            NoCache();
            return Ok(new { ok = true, dryRun = req.DryRun == true, source = sourceId.ToString("N"), onlyMissing, results });
        }
    }
}
