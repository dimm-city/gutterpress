# print-md Installation Script for Windows 11
# This script installs Bun and print-md globally for end users

$ErrorActionPreference = "Stop"

# Configuration
$PRINTMD_REPO = "https://github.com/dimm-city/print-md.git"
$PRINTMD_PACKAGE = "@dimm-city/print-md"

# Color output functions
function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host ">>> $Message" -ForegroundColor Yellow
}

# Check and install Bun
function Install-Bun {
    Write-Step "Checking for Bun..."

    try {
        $bunVersion = bun --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Bun is already installed (version $bunVersion)"
            return $true
        }
    } catch {
        # Bun not found, continue to installation
    }

    Write-Info "Bun not found. Installing now..."
    Write-Info "This will download and install Bun from bun.sh"

    try {
        irm bun.sh/install.ps1 | iex

        # Refresh PATH in current session
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

        # Verify installation
        $bunVersion = bun --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Bun installed successfully!"
            return $true
        } else {
            Write-Error "Installation completed but Bun is not available yet"
            Write-Info "Please close this window and open a new PowerShell window, then run this script again"
            return $false
        }
    } catch {
        Write-Error "Failed to install Bun: $_"
        Write-Info "Visit https://bun.sh for manual installation instructions"
        return $false
    }
}

# Install print-md globally
function Install-PrintMd {
    Write-Step "Installing print-md..."
    Write-Info "This may take a minute..."

    try {
        # Install from npm registry (when published) or from GitHub
        # For now, using GitHub installation
        Write-Info "Installing from GitHub repository..."
        bun add -g $PRINTMD_REPO

        if ($LASTEXITCODE -eq 0) {
            Write-Success "print-md installed successfully!"
            return $true
        } else {
            Write-Error "Failed to install print-md"
            return $false
        }
    } catch {
        Write-Error "Failed to install print-md: $_"
        return $false
    }
}

# Verify installation
function Test-Installation {
    Write-Step "Verifying installation..."

    try {
        $version = print-md --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "print-md is working! (version $version)"
            return $true
        } else {
            Write-Error "print-md command not found"
            Write-Info "You may need to restart your terminal"
            return $false
        }
    } catch {
        Write-Error "print-md command not found"
        Write-Info "You may need to restart your terminal"
        return $false
    }
}

# Create the user's print-md directory and seed it with the bundled examples
# so the viewer's "Open Project" picker has something to show out of the box.
function Initialize-PrintMdDirectory {
    Write-Step "Setting up print-md directory..."

    try {
        $documentsPath = [Environment]::GetFolderPath("MyDocuments")
        if ([string]::IsNullOrEmpty($documentsPath)) {
            $documentsPath = Join-Path $env:USERPROFILE "Documents"
        }

        $script:PrintMdDir = Join-Path $documentsPath "print-md"
        if (-not (Test-Path $script:PrintMdDir)) {
            New-Item -ItemType Directory -Path $script:PrintMdDir -Force | Out-Null
        }
        Write-Info "print-md directory: $script:PrintMdDir"

        $examplesDir = Join-Path $script:PrintMdDir "examples"
        if (Test-Path $examplesDir) {
            $existing = Get-ChildItem -Path $examplesDir -Force -ErrorAction SilentlyContinue
            if ($existing -and $existing.Count -gt 0) {
                Write-Info "Examples already present at $examplesDir (skipping)"
                return $true
            }
        }

        $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        if (-not $gitCmd) {
            Write-Info "git not found - skipping examples download"
            Write-Info "You can clone examples manually from $PRINTMD_REPO"
            return $true
        }

        Write-Info "Cloning examples from $PRINTMD_REPO..."
        $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("print-md-install-" + [System.Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        try {
            $repoDir = Join-Path $tempDir "repo"
            git clone --depth 1 --quiet $PRINTMD_REPO $repoDir 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Info "Could not clone repository for examples"
                return $true
            }

            $sourceExamples = Join-Path $repoDir "examples"
            if (Test-Path $sourceExamples) {
                if (-not (Test-Path $examplesDir)) {
                    New-Item -ItemType Directory -Path $examplesDir -Force | Out-Null
                }
                Copy-Item -Path (Join-Path $sourceExamples "*") -Destination $examplesDir -Recurse -Force
                Write-Success "Examples installed to $examplesDir"
            } else {
                Write-Info "No examples directory found in repository"
            }
        } finally {
            Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }

        return $true
    } catch {
        Write-Info "Could not set up print-md directory: $_"
        return $false
    }
}

# Create desktop shortcut
function New-DesktopShortcut {
    Write-Step "Creating desktop shortcut..."

    try {
        # Get desktop path
        $desktopPath = [Environment]::GetFolderPath("Desktop")
        $shortcutPath = Join-Path $desktopPath "Print-md Preview.lnk"

        # Find print-md installation path
        $printmdPath = (Get-Command print-md -ErrorAction Stop).Source
        $bunPath = (Get-Command bun -ErrorAction Stop).Source

        # Find icon file (should be in node_modules after global install)
        $globalModulesPath = Split-Path (Split-Path $printmdPath -Parent) -Parent
        $iconPath = Join-Path $globalModulesPath "node_modules\@dimm-city\print-md\dist\assets\favicon.ico"

        # Fallback: try to find icon in package installation
        if (-not (Test-Path $iconPath)) {
            $packagePath = Split-Path $printmdPath -Parent
            $iconPath = Join-Path $packagePath "assets\favicon.ico"
        }

        # Create WScript Shell object
        $WScriptShell = New-Object -ComObject WScript.Shell
        $shortcut = $WScriptShell.CreateShortcut($shortcutPath)

        # Determine working directory: prefer the print-md folder we created
        $workingDir = if ($script:PrintMdDir -and (Test-Path $script:PrintMdDir)) {
            $script:PrintMdDir
        } else {
            [Environment]::GetFolderPath("MyDocuments")
        }

        # Set shortcut properties
        $shortcut.TargetPath = $bunPath
        $shortcut.Arguments = "run print-md preview --open true"
        $shortcut.WorkingDirectory = $workingDir
        $shortcut.Description = "Start Print-md Preview Server"

        # Set icon if found
        if (Test-Path $iconPath) {
            $shortcut.IconLocation = $iconPath
            Write-Info "Using icon: $iconPath"
        } else {
            Write-Info "Icon not found at $iconPath, using default"
        }

        # Save shortcut
        $shortcut.Save()

        Write-Success "Desktop shortcut created: $shortcutPath"
        Write-Info "Double-click 'Print-md Preview' on your desktop to start the preview server"
        return $true

    } catch {
        Write-Error "Failed to create desktop shortcut: $_"
        Write-Info "You can manually create a shortcut to run: bun run print-md preview --open true"
        return $false
    }
}

# Main installation flow
function Main {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  print-md Installation" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Info "This will install print-md globally on your system"
    Write-Host ""

    # Step 1: Install Bun
    if (-not (Install-Bun)) {
        Write-Error "Installation failed. Please try again."
        exit 1
    }

    # Step 2: Install print-md globally
    if (-not (Install-PrintMd)) {
        Write-Error "Installation failed. Please try again."
        exit 1
    }

    # Step 3: Verify
    if (-not (Test-Installation)) {
        Write-Info "Installation completed but verification failed"
        Write-Info "Try closing this window and running 'print-md --version' in a new terminal"
        exit 0
    }

    # Step 4: Set up Documents\print-md and seed examples
    Initialize-PrintMdDirectory | Out-Null

    # Step 5: Create desktop shortcut
    New-DesktopShortcut

    # Success!
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Installation Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Success "print-md is ready to use!"
    Write-Host ""
    if ($script:PrintMdDir) {
        Write-Info "Examples are available at: $(Join-Path $script:PrintMdDir 'examples')"
        Write-Host ""
    }
    Write-Info "Quick Start Options:"
    Write-Host ""
    Write-Host "  Option 1: Use Desktop Shortcut" -ForegroundColor Yellow
    Write-Host "    - Double-click 'Print-md Preview' on your desktop" -ForegroundColor White
    Write-Host "    - The viewer's 'Open Project' picker starts in $script:PrintMdDir" -ForegroundColor White
    Write-Host "      so you can browse the bundled examples right away" -ForegroundColor White
    Write-Host ""
    Write-Host "  Option 2: Use Command Line" -ForegroundColor Yellow
    Write-Host "    1. Create a folder with your markdown files" -ForegroundColor White
    Write-Host "    2. Open PowerShell in that folder" -ForegroundColor White
    Write-Host "    3. Run:" -ForegroundColor White
    Write-Host ""
    Write-Host "       print-md build" -ForegroundColor Cyan
    Write-Host ""
    Write-Info "This will create a PDF from your markdown files."
    Write-Host ""
    Write-Info "For more options: print-md --help"
    Write-Host ""
}

# Run main installation
Main
