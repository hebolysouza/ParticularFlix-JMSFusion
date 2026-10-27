# ParticularFlix fork of JMSFusion

Jellyfin plugin (C#, net10.0, Jellyfin 12.x, targetAbi 12.0.0.0) that injects the JMS slider and modules into the web client. JS and CSS live in `Resources/slider` and are embedded in the DLL, so any JS change needs a rebuild.

## Before doing anything

- Load the `particularflix-fork-release` skill. It holds the environment map (containers, volumes, paths), the Jellyfin 12 test/production/release scripts (`jms-teste12.ps1`, `jms-janela12.ps1`, `jms-release12.ps1`, `jms-limpeza12.ps1`, `jms-comparar12.ps1`) and the working rules. This session cannot see the owner's PC or claude.ai project notes; never guess the environment.
- Reply to the owner in Portuguese, without em dashes. Public texts (CHANGELOG, README, release notes, manifest) are in English.

## Development

- Version of a build: `JMSFusion.csproj` `<Version>`, `Resources/slider/modules/config.js` (`version: "vX"`), `meta.json`, new CHANGELOG section. `manifest.json` changes only at release time, after the zip exists.
- No .NET SDK in the cloud session: review C# carefully; check JS with `node --check <file>` before committing.
- Brand/header scripts: source in `extras/`; on Jellyfin 12 they run from the JMS `custom` folder (see the skill), not from the plugin DLL.
- Match the surrounding code: fork comments start with `Fork ParticularFlix` and explain the why; keep the comment language of the file.
- Do not reduce the slider card count or remove features to gain performance; measure instead.

## After each commit

Give the owner, in this order: all PowerShell blocks for the next step at once (each wrapped in `& { ... }` with single-line `if (...) { "PARADO: ..." ; return }` guards, never `else`/`elseif` on its own line), then the exact checklist of what to verify in the test for every fix, plus quick regressions.
