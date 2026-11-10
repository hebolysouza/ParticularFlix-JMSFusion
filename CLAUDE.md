# ParticularFlix fork of JMSFusion

Jellyfin plugin (C#, net10.0, Jellyfin 12.x, targetAbi 12.0.0.0) that injects the JMS slider and modules into the web client. JS and CSS live in `Resources/slider` and are embedded in the DLL, so any JS change needs a rebuild.

This repository is PUBLIC (the Jellyfin plugin catalog and release zips are served from it). Operational notes, environment maps and deploy scripts live in the owner's private repository; when it is attached to the session, read its `CLAUDE.md` first. Never commit environment details here: local paths, server addresses, SSH ports or users, tester names, or the state of the owner's servers.

## Development

- Version of a build: `JMSFusion.csproj` `<Version>`, `Resources/slider/modules/config.js` (`version: "vX"`), `meta.json`, new CHANGELOG section. `manifest.json` changes only at release time, after the zip exists.
- No .NET SDK in the cloud session: review C# carefully; check JS with `node --check <file>` before committing.
- Brand/header script source: `extras/particularflix-modern-header.js`. On Jellyfin 12 it runs from the JMS `custom` folder, not from the plugin DLL.
- Match the surrounding code: fork comments start with `Fork ParticularFlix` and explain the why; keep the comment language of the file.
- Do not reduce the slider card count or remove features to gain performance; measure instead.
- Reply to the owner in Portuguese, without em dashes. Public texts (CHANGELOG, README, release notes, manifest) are in English.
