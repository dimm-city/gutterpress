# Desktop Shortcut Documentation

## Overview

The print-md installation scripts create a desktop shortcut that automatically:
- Starts the print-md preview server
- Opens the preview UI in your default browser
- Uses a custom favicon icon for visual identification

## Platform Support

### Windows (install.ps1)

**Shortcut Details:**
- **File**: `Pagedmd Preview.lnk` (created on Desktop)
- **Target**: `bun run print-md preview --open true`
- **Working Directory**: User's Documents folder
- **Icon**: `favicon.ico` from package installation
- **Description**: "Start Pagedmd Preview Server"

**Icon Resolution:**
1. First tries: `%APPDATA%\npm\node_modules\@dimm-city\print-md\dist\assets\favicon.ico`
2. Falls back to: Package bin directory + `\assets\favicon.ico`
3. Uses default Windows icon if not found

### Linux (install.sh)

**Shortcut Details:**
- **File**: `print-md-preview.desktop` (created on Desktop)
- **Exec**: `bun run print-md preview --open true`
- **Working Directory**: User's Documents folder
- **Icon**: `favicon.ico` from package installation
- **Terminal**: true (shows server output)

**Icon Resolution:**
1. First tries: `~/.bun/install/global/node_modules/@dimm-city/print-md/dist/assets/favicon.ico`
2. Falls back to: Package bin directory + `/assets/favicon.ico`
3. Omits icon if not found

**Desktop File Format:**
```ini
[Desktop Entry]
Version=1.0
Type=Application
Name=Pagedmd Preview
Comment=Start Pagedmd Preview Server
Exec=/path/to/bun run print-md preview --open true
Path=/home/user/Documents
Terminal=true
StartupNotify=true
Icon=/path/to/favicon.ico
```

### macOS

Currently, macOS users install manually via Bun. Desktop shortcuts are not automatically created.

**Future Enhancement**: Add `.app` bundle creation or Automator workflow for macOS.

## User Experience

### First Launch
1. User runs installation script
2. Script installs Bun + print-md
3. Script creates desktop shortcut with icon
4. User sees success message with instructions

### Daily Use
1. User double-clicks "Pagedmd Preview" shortcut
2. Terminal/PowerShell window opens showing server logs
3. Browser automatically opens to `http://localhost:3000`
4. User can select a folder containing markdown files
5. Preview updates live as files are edited

## Customization

Users can modify the shortcut to:
- Change the port: `--port 5000`
- Disable auto-open: `--open false`
- Point to a specific directory: Add path argument

## Troubleshooting

### Windows: Shortcut not working
- Verify Bun is in PATH: `bun --version`
- Check shortcut properties for correct paths
- Reinstall with: `.\install.ps1`

### Linux: Desktop file not showing
- Verify desktop directory: `echo $XDG_DESKTOP_DIR`
- Make executable: `chmod +x ~/Desktop/print-md-preview.desktop`
- Trust the file (GNOME): `gio set ~/Desktop/print-md-preview.desktop metadata::trusted true`

### Icon not displaying
- Verify icon exists at expected path
- On Windows: Check .lnk properties → Change Icon
- On Linux: Edit .desktop file Icon= line with absolute path
