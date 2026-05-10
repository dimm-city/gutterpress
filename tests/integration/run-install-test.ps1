[CmdletBinding()]
param(
    [switch]$Quick,
    [switch]$SkipInstall,
    [switch]$RequireShortcut
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Write-Section {
    param([string]$Message)
    Write-Host "`n== $Message ==" -ForegroundColor Cyan
}

function Refresh-UserPath {
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ($machine, $user -join ';').Trim(';')
}

function Invoke-Process {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    $output = & $Command @Arguments 2>&1
    [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = [string]::Join("`n", $output)
    }
}

function Invoke-PrintMd {
    param(
        [pscustomobject]$Descriptor,
        [string[]]$Arguments
    )

    $args = @()
    if ($Descriptor.Args) {
        $args += $Descriptor.Args
    }

    if ($Descriptor.UseSeparator -and $null -ne $Arguments -and $Arguments.Count -gt 0) {
        $args += '--'
    }

    if ($null -ne $Arguments) {
        $args += $Arguments
    }

    Invoke-Process -Command $Descriptor.Command -Arguments $args
}

function Get-PrintMdDescriptor {
    $candidates = @(
        [pscustomobject]@{ Display = 'print-md'; Command = 'print-md'; Args = @(); UseSeparator = $false }
    )

    # The standalone installer drops the binary in a known location. Fall
    # back to invoking it by absolute path so a missing PATH entry doesn't
    # mask a successful install.
    $installedExe = Join-Path $env:LOCALAPPDATA "Programs\print-md\print-md.exe"
    if (Test-Path $installedExe) {
        $candidates += [pscustomobject]@{
            Display = $installedExe
            Command = $installedExe
            Args = @()
            UseSeparator = $false
        }
    }

    foreach ($candidate in $candidates) {
        $result = Invoke-PrintMd -Descriptor $candidate -Arguments @('--version')
        if ($result.ExitCode -eq 0) {
            $versionLine = ($result.Output -split "`r?`n")[0]
            return [pscustomobject]@{
                Candidate = $candidate
                Version = $versionLine
            }
        }
    }

    throw "Unable to find a working print-md command"
}

function Require-Success {
    param(
        [pscustomobject]$Result,
        [string]$FailureMessage
    )

    if ($Result.ExitCode -ne 0) {
        $details = if ([string]::IsNullOrWhiteSpace($Result.Output)) { '' } else { "`n$($Result.Output)" }
        throw "$FailureMessage (exit code $($Result.ExitCode))$details"
    }
}

try {
    Write-Section "print-md Windows install test"

    if ($SkipInstall) {
        Write-Host "Skipping install step"
    } else {
    Write-Host "Running install script..."
    $installScript = Resolve-Path (Join-Path $repoRoot 'scripts\install.ps1')
    & $installScript
    }

    Refresh-UserPath

    Write-Section "Resolving print-md command"
    $printmd = Get-PrintMdDescriptor
    Write-Host "Using command: $($printmd.Candidate.Display)"
    Write-Host "print-md version: $($printmd.Version)"

    if ($Quick) {
        Write-Host "Quick mode enabled; skipping extended help checks"
    } else {
        Write-Section "Checking print-md --help"
        $helpResult = Invoke-PrintMd -Descriptor $printmd.Candidate -Arguments @('--help')
        Require-Success -Result $helpResult -FailureMessage 'print-md --help failed'
        if ($helpResult.Output -notmatch 'build' -or $helpResult.Output -notmatch 'preview') {
            throw 'Help output missing expected commands'
        }

        Write-Section "Checking print-md build --help"
        $buildResult = Invoke-PrintMd -Descriptor $printmd.Candidate -Arguments @('build', '--help')
        Require-Success -Result $buildResult -FailureMessage 'print-md build --help failed'
        if ($buildResult.Output -notmatch '--output' -or $buildResult.Output -notmatch '--format') {
            throw 'Build help output missing expected flags'
        }

        Write-Section "Checking print-md preview --help"
        $previewResult = Invoke-PrintMd -Descriptor $printmd.Candidate -Arguments @('preview', '--help')
        Require-Success -Result $previewResult -FailureMessage 'print-md preview --help failed'
        if ($previewResult.Output -notmatch '--port') {
            throw 'Preview help output missing expected flags'
        }
    }

    if ($RequireShortcut -and $SkipInstall) {
        Write-Host 'Shortcut verification requested'
    }

    if ($RequireShortcut) {
        Write-Section "Checking desktop shortcut"
        $desktop = [Environment]::GetFolderPath('Desktop')
        if ([string]::IsNullOrWhiteSpace($desktop)) {
            throw 'Desktop path not available for current user'
        }

        $shortcutPath = Join-Path $desktop 'Print-md Preview.lnk'
        if (-not (Test-Path $shortcutPath)) {
            throw "Desktop shortcut not found at $shortcutPath"
        }

        Write-Host "Shortcut found at: $shortcutPath"
    } else {
        Write-Host 'Skipping desktop shortcut requirement'
    }

    Write-Section "All checks passed"
}
catch {
    Write-Error $_
    exit 1
}
