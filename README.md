<p align="center">
  <img src="https://github.com/user-attachments/assets/29947627-b2ff-4ecd-8a2b-4df932aca657" alt="JMSFusion logo" width="200" />
</p>

<p align="center">
  A modular UI upgrade for Jellyfin that introduces a cinematic home slider, richer metadata,
  hover previews, profile personalization, GMMP music playback, Netflix-style pause and details views,
  studio hubs, notifications, parental PIN control, and a centralized settings experience.
</p>

<p align="center">
  <a href="https://github.com/hebolysouza/ParticularFlix-JMSFusion/releases/latest">
    <img
      alt="Latest release"
      src="https://img.shields.io/github/v/release/hebolysouza/ParticularFlix-JMSFusion?style=for-the-badge&label=Latest&color=16a34a"
    />
  </a>

  <img
    alt="Maintained fork"
    src="https://img.shields.io/badge/Status-Maintained%20fork-16a34a?style=for-the-badge"
  />

  <img
    alt="Jellyfin 12"
    src="https://img.shields.io/badge/Jellyfin-12.x-00a4dc?style=for-the-badge"
  />

  <a href="https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/blob/main/LICENSE">
    <img
      alt="License"
      src="https://img.shields.io/badge/License-GPLv3-7c3aed?style=for-the-badge"
    />
  </a>
</p>

---

> [!NOTE]
> **Maintained ParticularFlix fork.** This is an actively maintained fork of the original
> [Jellyfin-MonWUI-Plugin](https://github.com/G-grbz/Jellyfin-MonWUI-Plugin), which has been archived by its author.
> It keeps the same plugin GUID, so it upgrades an existing JMSFusion install in place. It fixes a configuration security hole,
> adds per-profile settings, new slider sources, native trailers, a "New season" badge, section ordering that works together with
> Home Screen Sections, and many performance improvements. Version 4.0 is built for **Jellyfin 12.x** (net10.0, tested on 12.3). Jellyfin 10.11.x users should stay on 3.8.2.45, which remains available in the plugin catalog.
> See [CHANGELOG.md](CHANGELOG.md) for the full list and the upgrade notes, and the
> [Releases](https://github.com/hebolysouza/ParticularFlix-JMSFusion/releases) page for the latest version.

## Install and update

Add this repository to Jellyfin once, then install and update the plugin from the catalog like any other plugin:

1. Open **Jellyfin Dashboard**, then **Plugins**, then **Repositories**, and click **+**.
2. Use any name (for example `ParticularFlix JMSFusion`) and this URL:

```
https://raw.githubusercontent.com/hebolysouza/ParticularFlix-JMSFusion/main/manifest.json
```

3. Go to **Catalog**, find **JMSFusion**, install the latest version and restart Jellyfin.
4. Hard refresh the web interface with **Ctrl + F5**.

Already running the original JMSFusion? The plugin GUID is the same, so installing from this repository upgrades it in place.
Back up your Jellyfin configuration before the first upgrade, as for any plugin change.

<p align="center">
  <a href="#install-and-update">Install and update</a> •
  <a href="#overview">Overview</a> •
  <a href="#client-compatibility">Client Compatibility</a> •
  <a href="#highlights">Highlights</a> •
  <a href="#core-modules">Core Modules</a> •
  <a href="docs/seerr-arr-integration.md">Seerr & Arr Integration</a> •
  <a href="#uninstall">Uninstall</a> •
  <a href="#acknowledgment">Acknowledgment</a> •
  <a href="#license">License</a>
</p>

---

## Overview

**Jellyfin MonWUI Plugin**, displayed in Jellyfin as **JMSFusion**, is an all-in-one frontend enhancement layer built around a modular slider system located in `Resources/slider/`.

Rather than applying a single visual modification, JMSFusion expands the Jellyfin Web experience across home screen presentation, metadata, hover interactions, profile management, music playback, pause behavior, library discovery, notifications, and centralized UI configuration.

The project was designed to make Jellyfin feel more polished, personal, and cinematic while keeping the interface cohesive.

---

## Client Compatibility

JMSFusion works by injecting JavaScript and CSS into the **Jellyfin Web UI**.

### Compatible clients

* Web browsers using Jellyfin Web
* Mobile clients that embed the Jellyfin Web interface, including:

  * **Jellyfin for Android**
  * **Jellyfin for iOS**

### Not compatible

* **Jellyfin for Android TV**
* Native TV clients that do not load the server's `jellyfin-web` frontend
* Other clients using an independent native interface

In short, if a client does not render the server's `/web/index.html`, JMSFusion cannot modify its interface.

Compatibility: 4.0.x targets Jellyfin 12.x; 3.8.2.45 is the last build for Jellyfin 10.11.x. Newer Jellyfin major versions are checked when they are released, and fixes are published as new releases of this fork.

---

## Highlights

| Area               | What it adds                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home screen**    | User-specific slider lists, automatic row refresh, custom API query control, manual positioning, and Compact, Normal, Full Screen, and Peak slider layouts |
| **Discovery**      | Details overlays, hover trailers, compact popover previews, personal recommendations, genre/director/recent rows, and studio hubs                          |
| **Metadata**       | Quality badges, ratings, maturity indicators, richer information blocks, cast/director data, subtitle and language information, and provider links         |
| **Profiles**       | Netflix-style profile chooser, avatar generation, built-in avatar selection, and profile-specific customization                                            |
| **Playback**       | GMMP music player, lyrics support, subtitle customization, Netflix-style pause screen, parental PIN control, and Smart Pause                               |
| **Administration** | Centralized configuration, multilingual UI, backup/restore utilities, notifications, and admin-level controls                                              |

---

## Core Modules

* **Slider engine**

  * Per-profile list control
  * Random or manual content sourcing
  * Custom API queries
  * Content balancing rules
  * Automatic refresh logic

* **Visual layouts**

  * Compact
  * Normal
  * Full Screen
  * Peak
  * Optional diagonal presentation
  * Manual positioning controls

* **Home enhancements**

  * Cinematic hero presentation
  * Enhanced details views
  * Personal recommendations
  * Metadata-rich content cards
  * Custom home sections

* **Hover preview system**

  * Trailer playback
  * Lightweight popover previews
  * Expanded metadata presentation

* **Playback enhancements**

  * Smart Pause
  * Metadata overlays
  * GMMP music playback
  * Lyrics support
  * Subtitle customization
  * Parental PIN control

* **Profile personalization**

  * Netflix-style profile selection
  * Avatar generation
  * Built-in avatar library
  * Fast profile switching
  * Profile-specific preferences

* **Library and discovery**

  * Studio hubs
  * Watchlist integration
  * Genre and director discovery
  * Recently added content sections
  * Notification system

* **Trailer utilities**

  * Trailer downloading through `yt-dlp`
  * Trailer integration through NFO metadata
  * Hover video support

* **Advanced utilities**

  * Backup and restore
  * Multilingual interface
  * Centralized settings
  * Administrative controls

---

## Automatic trailers (fork)

The fork can download the trailer of every movie and series by itself, with no external script and no Windows scheduled task.
It adds one scheduled task, **JMSFusion: sincronizar trailers** (Dashboard > Scheduled Tasks > JMSFusion), which runs every 6 hours
and fills in every movie or series folder that has no trailer. A watcher also runs it about 3 minutes after a new movie or series
is added to the library. Folders that already have a trailer are never touched.

**Requirements**

- A TMDb API key saved in the plugin settings (the same key the plugin already uses).
- The library folders must be writable by the Jellyfin container or service. Read-only folders are skipped silently.
- One folder per movie or series (`Movie (2024)/movie.mkv`). The trailer is written as `trailer.mp4` inside that folder.
- Folders named `xxx`, `adult` or `adultos` are always skipped.

**Order of preference** (the first one that downloads wins; nothing is downloaded if no candidate passes the checks)

1. Official Brazilian (pt-BR) trailer listed on TMDb.
2. YouTube search in Portuguese: dubbed first, then subtitled.
3. Official Portuguese trailer from another country listed on TMDb.
4. Official English trailer listed on TMDb.
5. Trailer from the IMDb page.
6. YouTube search in English.

Every YouTube result is checked against the movie title, the year and the duration. Store and rental channels are refused, and
reviews, reactions and fan-made videos are rejected. yt-dlp is updated automatically before every run, trailers are written with
fast start, a title that failed is retried only after 5 hours, and the log lines (prefix `[JMS trailers]`) go to the normal Jellyfin
log, not to a separate file.

**YouTube cookies (optional, but recommended on a server)**

YouTube often asks servers and VPN addresses to sign in, and some trailers then fail. Without cookies the task still works for
the videos YouTube allows, and logs a warning. To fix it:

1. In a browser where you are signed in to YouTube, export the cookies of `youtube.com` in the Netscape `cookies.txt` format
   (any "cookies.txt" export extension for your browser works). A private window with a throwaway account is safer than your main one.
2. Save the file as `cookies.txt` in the Jellyfin configuration folder, the one mounted at `/config` in Docker. Or save it anywhere
   the container can read and point the environment variable `JMSFUSION_COOKIES` to its full path inside the container.
3. Run the task once. The log shows `Cookies do YouTube: ... (copia temporaria)` when the file was found.

The plugin only reads the file and works on a temporary copy, so it is never modified or uploaded. When the YouTube session
expires, export the cookies again and replace the file.

**Moving from an external script**: disable the old scheduled task before enabling this one, so two programs do not download
into the same folders at the same time.

## Custom scripts and styles (fork)

Drop your own `.js` or `.css` files in the plugin's `custom` folder and JMSFusion injects them into the Jellyfin web page, in
alphabetical order. The folder is `JMSFusion/custom` inside the Jellyfin plugin configurations directory (the plugin creates it;
on the official Docker image this is under `/config/data/plugins/configurations/JMSFusion/custom`). Edits show up after the next
page load because the URL carries the file's modification date. Use it for logos, small CSS tweaks or any script you used to
patch into `index.html` by hand. Only plain file names (letters, digits, dot, dash, underscore) are served, and nothing in this
folder is uploaded anywhere.

## Uninstall

For existing installations:

1. Open **Jellyfin Dashboard**
2. Go to **Plugins**
3. Uninstall **JMSFusion**
4. Restart Jellyfin
5. Hard refresh the Jellyfin Web interface using **Ctrl + F5** or **Ctrl + Shift + R**

If browser-cached JMSFusion assets remain visible after uninstalling, clear the Jellyfin site's cached data and reload the page.

---

## Acknowledgment

The original idea behind the **JMS slider concept**, which influenced parts of JMSFusion, was created by **BobHasNoSoul**.

https://github.com/BobHasNoSoul

---

## License

JMSFusion is released under the **GNU General Public License v3.0**.

See [LICENSE](LICENSE) for details.

---

## Disclaimer

This software is provided **"as is"**, without warranty of any kind.

This fork is maintained on a best-effort basis by a single maintainer. The upstream project is archived and is not affiliated with this fork.

Use at your own risk.
