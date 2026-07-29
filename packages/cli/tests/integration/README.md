# Integration Testing for Gutterpress

This directory contains Docker-based integration tests for validating the Gutterpress installation process across different platforms.

## Windows Installation Testing

### Prerequisites

**Important**: Windows containers require a Windows host:
- Windows 10/11 Pro, Enterprise, or Education with Docker Desktop
- Windows Server 2016 or later with Docker EE
- **Note**: Windows containers cannot run on Linux hosts or macOS

Verify your Docker can run Windows containers:
```powershell
docker version
# Look for "OS/Arch: windows/amd64" in Server section
```

Switch Docker Desktop to Windows containers (if needed):
- Right-click Docker Desktop system tray icon
- Select "Switch to Windows containers..."

### Quick Start

Build the Windows test image:
```bash
docker build -f tests/integration/Dockerfile.windows -t gutterpress-windows-test .
```

Run the full test suite:
```bash
docker run -it gutterpress-windows-test powershell -File C:\gutterpress\tests\integration\run-install-test.ps1
```

### Available Test Modes

#### 1. Full Test Suite (Recommended)
Runs complete installation and validation:
```bash
docker run -it gutterpress-windows-test powershell -File C:\gutterpress\tests\integration\run-install-test.ps1
```

Tests performed:
- Check Install script execution
- Check Bun installation verification
- Check gutterpress global installation
- Check Command availability checks
- Check Desktop shortcut creation
- Check Version output validation

#### 2. Quick Test (Faster Iteration)
Runs basic installation without extensive validation:
```bash
docker run -it gutterpress-windows-test powershell -File C:\gutterpress\tests\integration\run-install-test.ps1 -Quick
```

#### 3. Interactive Shell
Open PowerShell session for manual testing:
```bash
docker run -it gutterpress-windows-test
```

Inside the container, you can run:
```powershell
# Run full test suite
.\tests\integration\run-install-test.ps1

# Run quick test
.\tests\integration\run-install-test.ps1 -Quick

# Run install script directly
.\scripts\install.ps1

# Manual validation
bun --version
gutterpress --version
gutterpress --help
gutterpress build --help
```

#### 4. Test Modified Install Script
To test local changes to `install.ps1`:
```bash
# Rebuild image with your changes
docker build -f tests/integration/Dockerfile.windows -t gutterpress-windows-test .

# Run tests
docker run -it gutterpress-windows-test powershell -File C:\gutterpress\tests\integration\run-install-test.ps1
```

### Test Environment Details

The Docker container provides:
- **Base Image**: Windows Server Core LTSC 2022
- **PowerShell**: Version 5.1 (Windows PowerShell)
- **Git**: Pre-installed for repository operations
- **User Simulation**: Test user directories at `C:\Users\TestUser\`
- **Working Directory**: `C:\gutterpress` (contains repository code)

### Troubleshooting

#### Container won't start
```
Error: "image operating system "windows" cannot be used on this platform"
```
**Solution**: Ensure Docker Desktop is switched to Windows containers mode.

#### Installation fails in container
1. Run interactive mode for debugging:
   ```bash
   docker run -it gutterpress-windows-test
   ```

2. Check detailed logs:
   ```powershell
   .\scripts\install.ps1 -Verbose
   ```

3. Verify network connectivity:
   ```powershell
   Test-NetConnection bun.sh -Port 443
   Test-NetConnection github.com -Port 443
   ```

#### Bun installation times out
The container may need proxy configuration if behind a corporate firewall:
```dockerfile
# Add to Dockerfile before Bun installation
ENV HTTP_PROXY=http://proxy.example.com:8080
ENV HTTPS_PROXY=http://proxy.example.com:8080
```

### CI/CD Integration

For automated testing in CI/CD pipelines:

```yaml
# GitHub Actions example (requires Windows runner)
- name: Build Windows test image
   run: docker build -f tests/integration/Dockerfile.windows -t gutterpress-windows-test .

- name: Run installation tests
  run: |
       docker run gutterpress-windows-test powershell -File C:\gutterpress\tests\integration\run-install-test.ps1

- name: Capture test logs
  if: failure()
   run: docker logs gutterpress-windows-test > test-logs.txt
```

**Note**: This requires a Windows-based CI runner. For GitHub Actions, use `runs-on: windows-latest`.

### Development Workflow

Typical workflow for testing install script changes:

1. **Make changes** to `scripts/install.ps1`

2. **Rebuild image**:
   ```bash
   docker build -f tests/integration/Dockerfile.windows -t gutterpress-windows-test .
   ```

3. **Run quick test**:
   ```bash
   docker run -it gutterpress-windows-test powershell -File C:\gutterpress\tests\integration\run-install-test.ps1 -Quick
   ```

4. **Run full test suite**:
   ```bash
   docker run -it gutterpress-windows-test powershell -File C:\gutterpress\tests\integration\run-install-test.ps1
   ```

5. **Interactive debugging** (if needed):
   ```bash
   docker run -it gutterpress-windows-test
   ```

### Cleaning Up

Remove test containers and images:
```bash
# Remove stopped containers
docker container prune

# Remove test image
docker rmi gutterpress-windows-test

# Remove all Windows images (careful!)
docker images --filter "label=os=windows" -q | ForEach-Object { docker rmi $_ }
```

## Future Testing Additions

Planned additions to the integration test suite:
- [ ] Linux installation tests (shell script)
- [ ] macOS installation tests (when script is created)
- [ ] Multi-version Windows testing (Server 2019, 2022)
- [ ] Network failure simulation tests
- [ ] Offline installation tests
- [ ] Upgrade/reinstallation tests

## Resources

- [Docker Windows Containers Documentation](https://docs.microsoft.com/en-us/virtualization/windowscontainers/)
- [Windows Container Base Images](https://hub.docker.com/_/microsoft-windows-servercore)
- [GitHub Actions Windows Runners](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners#supported-runners-and-hardware-resources)
