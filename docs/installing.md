# Installing Gutterpress

The desktop app is the recommended install for authors. It contains its own
Chromium runtime and does not require Node, Bun, or a separate browser. The
standalone CLI is intended for terminal, automation, and CI use.

## Desktop app

Download the matching file from the [latest GitHub
release](https://github.com/dimm-city/gutterpress/releases/latest):

| Platform | Release file | Support note |
| --- | --- | --- |
| macOS Apple Silicon | `gutterpress-<version>-arm64.dmg` | Native ARM64 build |
| macOS Intel | `gutterpress-<version>-x64.dmg` | Native Intel build |
| Windows x64 | `gutterpress-setup-win-x64.exe` | Native x64 installer; Windows ARM64 can use x64 emulation |
| Linux x64 | `gutterpress-<version>.AppImage` | Native x64 AppImage |

There is currently no native Windows ARM64 or Linux ARM64 desktop build; those are
accepted support-matrix gaps until demand justifies new release targets. The
Windows installer deliberately keeps the same basename across releases to help
unsigned SmartScreen reputation accumulate. The separately attached
`gutterpress-<version>-win-x64.zip` is a portable extract-and-run build: it
does not install shortcuts or an uninstaller and is not the installed app's
auto-update channel.

## Command-line interface

### Homebrew (macOS and Linux)

This repository is a Homebrew tap. Its formula installs the correct ARM64 or
x64 standalone binary and updates through normal `brew update` / `brew
upgrade` commands.

```sh
brew tap dimm-city/gutterpress https://github.com/dimm-city/gutterpress.git
 brew install dimm-city/gutterpress/gutterpress
```

### Scoop (Windows)

This repository is also a Scoop bucket for the x64 standalone CLI:

```powershell
scoop bucket add gutterpress https://github.com/dimm-city/gutterpress.git
 scoop install gutterpress/gutterpress
```

### npm

With Node.js 22 or newer installed:

```sh
npm install -g gutterpress
```

### Standalone binaries

| Platform | Release file |
| --- | --- |
| Linux x64 (glibc) | `gutterpress-linux-x64` |
| Linux ARM64 (glibc) | `gutterpress-linux-arm64` |
| macOS Apple Silicon | `gutterpress-macos-arm64` |
| macOS Intel | `gutterpress-macos-x64` |
| Windows x64 | `gutterpress-windows-x64.exe` |

Windows ARM64 can run the x64 CLI through emulation. Alpine and other musl
Linux systems are not supported by the standalone binaries; use the
[Docker image](./docker.md) there instead.

The CLI needs a Chromium-based browser for PDF rendering. Some PDF/X and
validation features also need Ghostscript or qpdf; see [System
Setup](../examples/gutterpress-user-guide/08-system-setup.md).

## Verify downloads

Releases produced by the current release workflow attach `SHA256SUMS.txt` and
also print the same hashes in the release notes. Compare the line for the file
you downloaded before bypassing an operating-system security warning.

The `install.sh` and `install.ps1` scripts do this for you: each fetches
`SHA256SUMS.txt` and checks the download against it *before* installing, and
refuses to install a file whose hash does not match. Releases published before
`SHA256SUMS.txt` existed have no hashes to check, so installing one of those
(`GUTTERPRESS_VERSION=<older tag>`) still works but ends with an explicit warning
that the download was not verified. Manual downloads are unchecked — use the
commands below.

```sh
# Linux
sha256sum gutterpress-linux-x64

# macOS
shasum -a 256 gutterpress-<version>-arm64.dmg
```

```powershell
# Windows PowerShell
Get-FileHash .\gutterpress-setup-win-x64.exe -Algorithm SHA256
```

## Unsigned applications

Code signing and Apple notarization are intentionally deferred until their
cost is affordable. The published desktop installers and standalone CLI
binaries are therefore unsigned.

### macOS Gatekeeper

Try to open the app once. Then open **System Settings > Privacy & Security**,
find the blocked Gutterpress app, and choose **Open Anyway**. After verifying
the SHA-256 checksum, the command-line alternative is:

```sh
xattr -dr com.apple.quarantine "/Applications/Gutterpress.app"
# CLI example:
xattr -d com.apple.quarantine /path/to/gutterpress-macos-arm64
```

### Windows SmartScreen

If Windows displays "Windows protected your PC", verify the checksum, then
choose **More info > Run anyway**. This applies to both the desktop installer
and the standalone CLI executable.

## Git install policy

Installing the npm package directly from this repository with an npm git URL
is not supported. This is a Bun workspace whose generated `dist/` directory is
not committed, and the repository root is not the published CLI package. Use
npm, Homebrew, Scoop, or a standalone release binary. To develop Gutterpress
itself, clone the repository and run `bun install` instead.

## Package-manager publication status

Stable releases automatically refresh this repository's Homebrew formula and
Scoop manifest from the release's published checksums. A submission-ready
winget manifest is generated under `packaging/winget/`, but it is not available
through the public winget community source until that manifest is submitted to
and accepted by the external `microsoft/winget-pkgs` repository.
