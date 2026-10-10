---
title: Install
description: Download the self-contained Gutterpress desktop app, or install the CLI with Homebrew, Scoop, npm, a standalone binary or Docker.
og:title: Install Gutterpress
og:description: Download the desktop app, or install the CLI with Homebrew, Scoop, npm, a standalone binary or Docker.
---

# Install

## Desktop app

Every download is on the [latest release](https://github.com/dimm-city/gutterpress/releases/latest),
with SHA-256 checksums. The app bundles its own Chromium; no Node, Bun, or browser setup is needed.

| Platform | File | Notes |
| --- | --- | --- |
| Windows | `Gutterpress-setup-win-x64.exe` | Installer. The versioned `.zip` is a portable extract-and-run copy. |
| macOS, Apple Silicon | `Gutterpress-<version>-arm64.dmg` | Open the disk image, drag the app to Applications. |
| macOS, Intel | `Gutterpress-<version>-x64.dmg` | Same as above. |
| Linux | `Gutterpress-<version>.AppImage` | `chmod +x` the file, then run it. |

The downloads are unsigned for now. Each release includes Gatekeeper and SmartScreen instructions;
see [installing and verifying](https://github.com/dimm-city/gutterpress/blob/main/docs/installing.md).

## Command line

The same engine, for scripts and CI.

### Homebrew (macOS and Linux)

```
brew tap dimm-city/gutterpress https://github.com/dimm-city/gutterpress.git
brew install dimm-city/gutterpress/gutterpress
```

### Scoop (Windows)

```
scoop bucket add gutterpress https://github.com/dimm-city/gutterpress.git
scoop install gutterpress/gutterpress
```

### npm

Node.js 22 or newer.

```
npm install -g gutterpress
```

### Standalone binaries and Docker

Single-file binaries for Linux, macOS, and Windows are on every release, and a
[Docker image](https://github.com/dimm-city/gutterpress/blob/main/docs/docker.md)
ships with all the print tools preinstalled.

The CLI renders PDFs through a Chromium-based browser on the machine it runs on; some PDF/X and
validation features also use Ghostscript or qpdf. See
[System setup](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/07-system-setup.md).
