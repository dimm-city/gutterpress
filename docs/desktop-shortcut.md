# Desktop Shortcut Documentation

## Overview

The print-md installation scripts create a desktop shortcut that starts the
print-md preview server and opens the rendered book in your default browser.

The install scripts download the **standalone print-md binary** from GitHub
Releases — no Bun, Node, or git is required on the machine. The shortcut
points directly at that binary.

`print-md preview` serves a **headless** HTML preview — there is no toolbar,
page navigation, or folder picker in the browser. For the full interactive
desktop experience (toolbar, page navigation, zoom, folder picker, PDF export),
use the **Electron desktop app** (`packages/viewer`) instead of a browser shortcut.

## Platform Support

### Windows (install.ps1)

**Shortcut Details:**
- **File**: `Print-md Preview.lnk` (created on Desktop)
- **Target**: the installed `print-md.exe` binary, with arguments `preview --open true`
- **Working Directory**: `Documents\print-md` (the examples directory the installer sets up), falling back to the user's Documents folder
- **Icon**: the binary's own embedded icon (`<print-md.exe>,0`)
- **Description**: "Start Print-md Preview Server"

### Linux (install.sh)

**Shortcut Details:**
- **File**: `print-md-preview.desktop` (created in `$XDG_DESKTOP_DIR`, falling back to `~/Desktop`)
- **Exec**: the installed `print-md` binary, with arguments `preview --open true`
- **Working Directory**: `~/Documents/print-md` (the examples directory the installer sets up), falling back to `~/Documents`
- **Terminal**: true (shows server output)
- **Icon**: none is set (the entry uses the desktop environment's default)
- The script marks the file executable and trusted (`gio set ... metadata::trusted true`) where `gio` is available.

**Desktop File Format:**
```ini
[Desktop Entry]
Version=1.0
Type=Application
Name=Print-md Preview
Comment=Start Print-md Preview Server
Exec=/path/to/print-md preview --open true
Path=/home/user/Documents/print-md
Terminal=true
StartupNotify=true
```

### macOS

Currently, macOS users install the binary without a shortcut. Desktop shortcuts are not automatically created.

**Future Enhancement**: Add `.app` bundle creation or Automator workflow for macOS.

## User Experience

### First Launch
1. User runs installation script
2. Script downloads the standalone print-md binary from GitHub Releases
3. Script creates desktop shortcut
4. User sees success message with instructions

### Daily Use
1. User double-clicks "Print-md Preview" shortcut
2. Terminal/PowerShell window opens showing server logs
3. Browser automatically opens to `http://localhost:3579`
4. The rendered book is displayed (headless — no toolbar)
5. Files update live in the browser as they are edited

For the full toolbar UI (page navigation, zoom, folder picker, PDF export),
launch the desktop app from the repo:

```bash
bun run viewer:electron
```

## Customization

Users can modify the shortcut to:
- Change the port: `--port 5000`
- Disable auto-open: replace `--open true` with `--no-open`
- Point to a specific directory: Add path argument

## Troubleshooting

### Windows: Shortcut not working
- Verify print-md is installed: run `print-md --version` in PowerShell
- Check shortcut properties for correct paths
- Reinstall with: `.\install.ps1`

### Linux: Desktop file not showing
- Verify desktop directory: `echo $XDG_DESKTOP_DIR`
- Make executable: `chmod +x ~/Desktop/print-md-preview.desktop`
- Trust the file (GNOME): `gio set ~/Desktop/print-md-preview.desktop metadata::trusted true`
