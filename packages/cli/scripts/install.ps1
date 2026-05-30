# print-md installer for Windows
#
# Downloads the standalone print-md binary for the current platform from
# GitHub Releases and drops it in %LOCALAPPDATA%\Programs\print-md. No bun,
# node, or git required.
#
#   irm https://raw.githubusercontent.com/dimm-city/print-md/main/packages/cli/scripts/install.ps1 | iex
#
# Optional environment variables:
#   PRINTMD_VERSION        override the version to install (e.g. v0.2.0-beta.5)
#   GITHUB_TOKEN           auth token (only needed while the repo is private)
#   PRINTMD_PREFIX         install dir override
#                          (default: %LOCALAPPDATA%\Programs\print-md)
#   PRINTMD_LOCAL_BINARY   path to a locally-built print-md.exe. When set,
#                          the script skips the GitHub Release download and
#                          installs from this path instead. Used by CI to
#                          verify the binary produced by the current branch.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- configuration ---------------------------------------------------------

$Repo = "dimm-city/print-md"
$GithubToken = $env:GITHUB_TOKEN
$RequestedVersion = $env:PRINTMD_VERSION
$DefaultPrefix = Join-Path $env:LOCALAPPDATA "Programs\print-md"
$InstallPrefix = if ($env:PRINTMD_PREFIX) { $env:PRINTMD_PREFIX } else { $DefaultPrefix }

# ---- output helpers --------------------------------------------------------

function Write-Success { param([string]$Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Info    { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Err     { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Write-Step    {
    param([string]$Message)
    Write-Host ""
    Write-Host ">>> $Message" -ForegroundColor Yellow
}

# ---- platform detection ----------------------------------------------------
#
# Bun's --target=bun-windows-x64 is currently the only Windows target the
# release workflow builds. ARM64 Windows runs x64 binaries via emulation, so
# we ship the same asset there.

function Get-PrintMdAsset {
    # Must match the release.yml build-cli matrix `artifact` name. The `-cli`
    # infix distinguishes the standalone CLI binary from the print-md-viewer-*
    # desktop assets in the same release.
    return "print-md-cli-windows-x64.exe"
}

# ---- HTTP helpers ----------------------------------------------------------
#
# All GitHub fetches go through Invoke-GhRest / Invoke-GhDownload so the same
# code path covers public and private repos: when GITHUB_TOKEN is set, the
# token is sent on the Authorization header (the only path that works for
# private repos).

function New-GhHeaders {
    param([string]$Accept = "application/vnd.github+json")
    $headers = @{
        "Accept" = $Accept
        "X-GitHub-Api-Version" = "2022-11-28"
        "User-Agent" = "print-md-installer"
    }
    if ($GithubToken) {
        $headers["Authorization"] = "Bearer $GithubToken"
    }
    return $headers
}

function Invoke-GhRest {
    param([string]$Url, [string]$Accept = "application/vnd.github+json")
    return Invoke-RestMethod -Uri $Url -Headers (New-GhHeaders $Accept)
}

function Invoke-GhDownload {
    param(
        [string]$Url,
        [string]$OutFile,
        [string]$Accept = "application/octet-stream"
    )
    $progressBackup = $ProgressPreference
    try {
        # Continue keeps the progress bar visible; SilentlyContinue is much
        # faster on PS 5.x but we're on PS 7+ where the difference is small.
        $ProgressPreference = "Continue"
        Invoke-WebRequest -Uri $Url `
                          -Headers (New-GhHeaders $Accept) `
                          -OutFile $OutFile `
                          -UseBasicParsing
    } finally {
        $ProgressPreference = $progressBackup
    }
}

# ---- release resolution ----------------------------------------------------

function Resolve-Release {
    if ($RequestedVersion) {
        $tag = $RequestedVersion.TrimStart('v')
        $tag = "v$tag"
        $url = "https://api.github.com/repos/$Repo/releases/tags/$tag"
        try {
            return Invoke-GhRest $url
        } catch {
            throw "Could not fetch release $tag from $Repo : $_"
        }
    }

    # /releases/latest skips prereleases — fall back to /releases?per_page=1
    # for repos whose only published release is still a prerelease.
    $latestUrl = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        return Invoke-GhRest $latestUrl
    } catch {
        # 404 or similar — try the listing endpoint
    }

    $listUrl = "https://api.github.com/repos/$Repo/releases?per_page=1"
    try {
        $list = Invoke-GhRest $listUrl
        if ($list -and $list.Count -gt 0) {
            return $list[0]
        }
    } catch {
        if (-not $GithubToken) {
            throw "Could not fetch releases from $Repo. If the repository is private, set `$env:GITHUB_TOKEN."
        }
        throw "Could not fetch releases from $Repo : $_"
    }
    throw "No releases found in $Repo"
}

function Get-AssetUrl {
    param($Release, [string]$AssetName)
    $asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
    if (-not $asset) {
        throw "Release $($Release.tag_name) has no asset named $AssetName"
    }
    # Use the API URL (works for both public and private repos when paired
    # with Accept: application/octet-stream).
    return $asset.url
}

# ---- install steps ---------------------------------------------------------

function Install-Binary {
    param([string]$Url, [string]$Tag, [string]$AssetName)

    Write-Step "Downloading print-md $Tag (windows-x64)..."

    if (-not (Test-Path $InstallPrefix)) {
        New-Item -ItemType Directory -Path $InstallPrefix -Force | Out-Null
    }
    $script:PrintMdBin = Join-Path $InstallPrefix "print-md.exe"
    $tempPath = "$($script:PrintMdBin).download"

    try {
        Invoke-GhDownload -Url $Url -OutFile $tempPath
    } catch {
        if (Test-Path $tempPath) { Remove-Item $tempPath -Force -ErrorAction SilentlyContinue }
        throw "Failed to download binary: $_"
    }

    if (Test-Path $script:PrintMdBin) {
        Remove-Item $script:PrintMdBin -Force
    }
    Move-Item -Path $tempPath -Destination $script:PrintMdBin -Force
    Write-Success "Installed binary to $($script:PrintMdBin)"
}

function Test-Install {
    Write-Step "Verifying installation..."
    try {
        $version = & $script:PrintMdBin --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "print-md --version failed with exit code $LASTEXITCODE"
        }
        Write-Success "print-md is working! ($version)"
    } catch {
        throw "print-md installed but failed to run: $_"
    }
}

# Add the install dir to the user PATH (persistent) and to the current
# session's $env:Path. setx caps user PATH at 1024 chars on some systems, so
# write the registry value directly.
function Add-ToUserPath {
    param([string]$Dir)

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    $entries = $userPath -split ';' | Where-Object { $_ -ne '' }

    if ($entries -contains $Dir) {
        Write-Info "$Dir already on user PATH"
    } else {
        $newPath = if ($userPath) { "$userPath;$Dir" } else { $Dir }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Success "Added $Dir to your user PATH"
    }

    if (($env:Path -split ';') -notcontains $Dir) {
        $env:Path = "$Dir;$env:Path"
    }
}

# Create %USERPROFILE%\Documents\print-md and seed it with the bundled
# examples so the viewer's "Open Project" picker has something to show out of
# the box.
function Initialize-PrintMdDirectory {
    param([string]$Tag)

    Write-Step "Setting up print-md directory..."

    $documentsPath = [Environment]::GetFolderPath("MyDocuments")
    if ([string]::IsNullOrEmpty($documentsPath)) {
        $documentsPath = Join-Path $env:USERPROFILE "Documents"
    }

    $script:PrintMdDir = Join-Path $documentsPath "print-md"
    if (-not (Test-Path $script:PrintMdDir)) {
        New-Item -ItemType Directory -Path $script:PrintMdDir -Force | Out-Null
    }
    Write-Info "print-md directory: $($script:PrintMdDir)"

    $examplesDir = Join-Path $script:PrintMdDir "examples"
    if (Test-Path $examplesDir) {
        $existing = @(Get-ChildItem -Path $examplesDir -Force -ErrorAction SilentlyContinue)
        if ($existing.Count -gt 0) {
            Write-Info "Examples already present at $examplesDir (skipping)"
            return
        }
    }

    # "local" tag = installed from a local binary (no published release to
    # pull a zipball from). Skip the examples download cleanly.
    if ($Tag -eq "local") {
        Write-Info "Local binary install — skipping examples download"
        return
    }

    # Pull the source archive for the same tag and extract just `examples/`.
    $archiveUrl = "https://api.github.com/repos/$Repo/zipball/$Tag"
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("print-md-archive-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    Write-Info "Downloading examples..."
    try {
        $zipPath = Join-Path $tempDir "source.zip"
        try {
            Invoke-GhDownload -Url $archiveUrl -OutFile $zipPath
        } catch {
            Write-Info "Could not download source archive (skipping examples)"
            return
        }

        $extractDir = Join-Path $tempDir "extracted"
        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        # GitHub zipballs unpack to a single directory named like
        # <owner>-<repo>-<sha>. Find it.
        $extracted = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
        if (-not $extracted) {
            Write-Info "Source archive was empty"
            return
        }

        $sourceExamples = Join-Path $extracted.FullName "examples"
        if (Test-Path $sourceExamples) {
            if (-not (Test-Path $examplesDir)) {
                New-Item -ItemType Directory -Path $examplesDir -Force | Out-Null
            }
            Copy-Item -Path (Join-Path $sourceExamples '*') -Destination $examplesDir -Recurse -Force
            Write-Success "Examples installed to $examplesDir"
        } else {
            Write-Info "examples/ not found in source archive"
        }
    } finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function New-DesktopShortcut {
    Write-Step "Creating desktop shortcut..."

    try {
        $desktopPath = [Environment]::GetFolderPath("Desktop")
        if ([string]::IsNullOrEmpty($desktopPath) -or -not (Test-Path $desktopPath)) {
            Write-Info "Desktop directory not found, skipping shortcut"
            return
        }
        $shortcutPath = Join-Path $desktopPath "Print-md Preview.lnk"

        $workingDir = if ($script:PrintMdDir -and (Test-Path $script:PrintMdDir)) {
            $script:PrintMdDir
        } else {
            [Environment]::GetFolderPath("MyDocuments")
        }

        $WScriptShell = New-Object -ComObject WScript.Shell
        $shortcut = $WScriptShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $script:PrintMdBin
        $shortcut.Arguments = "preview --open true"
        $shortcut.WorkingDirectory = $workingDir
        $shortcut.IconLocation = "$($script:PrintMdBin),0"
        $shortcut.Description = "Start Print-md Preview Server"
        $shortcut.Save()

        Write-Success "Desktop shortcut created: $shortcutPath"
    } catch {
        Write-Info "Could not create desktop shortcut: $_"
    }
}

# ---- main ------------------------------------------------------------------

function Main {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  print-md Installation" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host ""

    $assetName = Get-PrintMdAsset
    Write-Info "Detected platform: windows-x64"

    $localBinary = $env:PRINTMD_LOCAL_BINARY
    if ($localBinary) {
        Write-Step "Installing local binary..."
        if (-not (Test-Path -LiteralPath $localBinary -PathType Leaf)) {
            throw "PRINTMD_LOCAL_BINARY is set but the file does not exist: $localBinary"
        }
        if (-not (Test-Path $InstallPrefix)) {
            New-Item -ItemType Directory -Path $InstallPrefix -Force | Out-Null
        }
        $script:PrintMdBin = Join-Path $InstallPrefix "print-md.exe"
        Copy-Item -LiteralPath $localBinary -Destination $script:PrintMdBin -Force
        Write-Success "Installed binary to $($script:PrintMdBin)"
        $tag = "local"
    } else {
        Write-Step "Resolving release..."
        $release = Resolve-Release
        $tag = $release.tag_name
        Write-Info "Release: $tag"

        $assetUrl = Get-AssetUrl -Release $release -AssetName $assetName

        Install-Binary -Url $assetUrl -Tag $tag -AssetName $assetName
    }
    Test-Install
    Add-ToUserPath -Dir $InstallPrefix
    try { Initialize-PrintMdDirectory -Tag $tag } catch { Write-Info "Examples setup failed: $_" }
    try { New-DesktopShortcut } catch { Write-Info "Shortcut creation failed: $_" }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Installation Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Success "print-md is ready to use!"
    if ($script:PrintMdDir) {
        Write-Host ""
        Write-Info "Examples are at: $(Join-Path $script:PrintMdDir 'examples')"
    }
    Write-Host ""
    Write-Info "Double-click 'Print-md Preview' on your desktop to start the viewer."
    Write-Host ""
}

Main
