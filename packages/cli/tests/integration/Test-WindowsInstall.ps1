# Test gutterpress Windows Installation in Docker
# 
# This script simplifies running the Windows Docker-based installation tests.
# It handles building the image and running different test scenarios.
#
# Usage:
#   .\Test-WindowsInstall.ps1                    # Run full test suite
#   .\Test-WindowsInstall.ps1 -Quick             # Run quick test
#   .\Test-WindowsInstall.ps1 -Interactive       # Open interactive shell
#   .\Test-WindowsInstall.ps1 -Rebuild           # Force rebuild image
#   .\Test-WindowsInstall.ps1 -Clean             # Clean up Docker resources

[CmdletBinding()]
param(
    [Parameter(HelpMessage="Run quick test instead of full suite")]
    [switch]$Quick,
    
    [Parameter(HelpMessage="Open interactive PowerShell session in container")]
    [switch]$Interactive,
    
    [Parameter(HelpMessage="Force rebuild Docker image")]
    [switch]$Rebuild,
    
    [Parameter(HelpMessage="Clean up Docker containers and images")]
    [switch]$Clean,
    
    [Parameter(HelpMessage="Show verbose Docker output")]
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

# Configuration
$ImageName = "gutterpress-windows-test"
$DockerfilePath = "tests/integration/Dockerfile.windows"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# Color output helpers
function Write-Step {
    param([string]$Message)
    Write-Host "`n>>> $Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Info-Custom {
    param([string]$Message)
    Write-Host "[i] $Message" -ForegroundColor Cyan
}

# Check if Docker is available and in Windows container mode
function Test-DockerWindows {
    Write-Step "Checking Docker environment..."
    
    try {
        $dockerVersion = docker version --format '{{.Server.Os}}' 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Error-Custom "Docker is not running or not installed"
            Write-Info-Custom "Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/"
            exit 1
        }
        
        if ($dockerVersion -ne "windows") {
            Write-Error-Custom "Docker is in Linux container mode"
            Write-Info-Custom "Switch to Windows containers:"
            Write-Info-Custom "  1. Right-click Docker Desktop system tray icon"
            Write-Info-Custom "  2. Select 'Switch to Windows containers...'"
            exit 1
        }
        
        Write-Success "Docker is running in Windows container mode"
        return $true
    } catch {
        Write-Error-Custom "Failed to check Docker: $_"
        exit 1
    }
}

# Build Docker image
function Build-TestImage {
    param([bool]$Force = $false)
    
    # Check if image exists
    $imageExists = docker images -q $ImageName 2>$null
    
    if ($imageExists -and -not $Force) {
        Write-Info-Custom "Docker image '$ImageName' already exists (use -Rebuild to force rebuild)"
        return $true
    }
    
    Write-Step "Building Docker image..."
    Write-Info-Custom "This may take several minutes on first run..."
    
    $buildArgs = @(
        "build",
        "-f", $DockerfilePath,
        "-t", $ImageName
    )
    
    if ($Verbose) {
        $buildArgs += "--progress=plain"
    }
    
    $buildArgs += "."
    
    try {
        Push-Location $ProjectRoot
        & docker @buildArgs
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error-Custom "Docker build failed"
            exit 1
        }
        
        Write-Success "Docker image built successfully"
        return $true
    } catch {
        Write-Error-Custom "Build error: $_"
        exit 1
    } finally {
        Pop-Location
    }
}

# Run full test suite
function Invoke-FullTest {
    Write-Step "Running full installation test suite..."
    
    try {
        docker run --rm -it $ImageName powershell -File C:\gutterpress\tests\integration\run-install-test.ps1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "All tests passed!"
        } else {
            Write-Error-Custom "Tests failed with exit code: $LASTEXITCODE"
            exit 1
        }
    } catch {
        Write-Error-Custom "Test execution failed: $_"
        exit 1
    }
}

# Run quick test
function Invoke-QuickTest {
    Write-Step "Running quick installation test..."
    
    try {
        docker run --rm -it $ImageName powershell -File C:\gutterpress\tests\integration\run-install-test.ps1 -Quick
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Quick test completed!"
        } else {
            Write-Error-Custom "Quick test failed with exit code: $LASTEXITCODE"
            exit 1
        }
    } catch {
        Write-Error-Custom "Test execution failed: $_"
        exit 1
    }
}

# Open interactive shell
function Invoke-InteractiveShell {
    Write-Step "Opening interactive PowerShell session..."
    Write-Info-Custom "Available commands:"
    Write-Info-Custom "  .\tests\integration\run-install-test.ps1       - Run full test"
    Write-Info-Custom "  .\tests\integration\run-install-test.ps1 -Quick - Skip help checks"
    Write-Info-Custom "  .\scripts\install.ps1   - Run install script"
    Write-Info-Custom ""
    Write-Info-Custom "Type 'exit' to leave the container"
    Write-Info-Custom ""
    
    try {
        docker run --rm -it $ImageName
    } catch {
        Write-Error-Custom "Failed to start interactive session: $_"
        exit 1
    }
}

# Clean up Docker resources
function Invoke-Cleanup {
    Write-Step "Cleaning up Docker resources..."
    
    # Remove containers
    $containers = docker ps -a --filter "ancestor=$ImageName" -q
    if ($containers) {
        Write-Info-Custom "Removing containers..."
        docker rm -f $containers
        Write-Success "Containers removed"
    } else {
        Write-Info-Custom "No containers to remove"
    }
    
    # Remove image
    $image = docker images -q $ImageName
    if ($image) {
        Write-Info-Custom "Removing image '$ImageName'..."
        docker rmi $ImageName
        Write-Success "Image removed"
    } else {
        Write-Info-Custom "Image not found"
    }
    
    Write-Success "Cleanup complete"
}

# Main execution
function Main {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  gutterpress Windows Install Test Runner" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta
    
    # Handle cleanup mode
    if ($Clean) {
        Invoke-Cleanup
        return
    }
    
    # Check Docker environment
    Test-DockerWindows | Out-Null
    
    # Build image
    Build-TestImage -Force:$Rebuild | Out-Null
    
    # Run appropriate test mode
    if ($Interactive) {
        Invoke-InteractiveShell
    } elseif ($Quick) {
        Invoke-QuickTest
    } else {
        Invoke-FullTest
    }
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Test Run Complete" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
}

# Run main function
try {
    Main
} catch {
    Write-Error-Custom "Unexpected error: $_"
    Write-Host $_.ScriptStackTrace -ForegroundColor Red
    exit 1
}
