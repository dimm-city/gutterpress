# Desktop Shortcut Documentation

## Two different things, don't mix them up

Gutterpress ships two separate desktop entries, for two separate programs:

| | **Application-menu integration** | **CLI preview shortcut** |
|---|---|---|
| What it launches | The **full Electron desktop app** (toolbar, editor, page navigation, zoom, folder picker, Save PDF) | The **headless `gutterpress preview` server** + your default browser |
| Where it comes from | Opt-in, from inside the app: **Settings → App → Desktop integration** | The `install.sh` / `install.ps1` CLI installers |
| Platforms | Linux AppImage only (Windows and macOS installers already create their own entries) | Linux and Windows |
| Documented in | [Linux AppImage application-menu integration](#linux-appimage-application-menu-integration-desktop-app) (below) | [CLI preview shortcut](#cli-preview-shortcut-headless-preview-server) (below) |

If you want the app in your KDE/GNOME menu, you want the **first** one.

## Linux AppImage application-menu integration (desktop app)

The released `gutterpress-<version>.AppImage` is a portable executable: it
runs from wherever you downloaded it, and — like every AppImage — it does not
register itself with your desktop environment. That is deliberate; a portable
file should not copy itself into your home directory or edit your desktop
configuration behind your back.

When you want it in the application menu, turn it on explicitly:

**Settings → App → Desktop integration → Add to application menu**

The action appears **only** in a packaged Linux AppImage build (it is hidden on
Windows, macOS, in development, and in the browser build). It needs no
administrator access, no `sudo`, and no extra packages — no
`update-desktop-database`, `kbuildsycoca6`, or AppImageLauncher. KDE and GNOME
watch the per-user directories below, so the entry usually appears within a few
seconds.

### What it installs

| File | Path | Mode |
|---|---|---|
| A managed copy of the AppImage | `$HOME/.local/bin/gutterpress.AppImage` | `0755` |
| The XDG desktop entry | `${XDG_DATA_HOME:-$HOME/.local/share}/applications/city.dimm.gutterpress.desktop` | `0644` |
| The application icon | `${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps/city.dimm.gutterpress.png` | `0644` |

An unset, empty, or relative `XDG_DATA_HOME` is treated as invalid and falls
back to `$HOME/.local/share` (the Base Directory spec requires an absolute
path). The managed filename is deliberately distinct from the CLI's
`~/.local/bin/gutterpress` binary, so the two never collide.

Because the entry points at the **managed copy**, the menu launcher keeps
working after you move or delete the file you originally downloaded.

**Desktop entry contents:**

```ini
[Desktop Entry]
Version=1.0
Type=Application
Name=Gutterpress
Comment=Write books in Markdown and export print-ready PDFs
Exec="/home/you/.local/bin/gutterpress.AppImage"
TryExec=/home/you/.local/bin/gutterpress.AppImage
Icon=city.dimm.gutterpress
Terminal=false
Categories=Office;Publishing;
StartupNotify=true
StartupWMClass=city.dimm.gutterpress
```

There is intentionally **no** `%f`/`%F`/`%u`/`%U` field code, no `MimeType`,
and no protocol handler: the desktop app does not process startup arguments today,
so advertising file or URL associations would register handlers that do
nothing. (The app's internal `app://` scheme is renderer transport, not an OS
protocol.)

`StartupWMClass` matches `desktopName` in `packages/desktop/package.json`
(`city.dimm.gutterpress.desktop`), which Electron uses as the Wayland
application id and the X11 `WM_CLASS`. That is what lets KDE and GNOME group
the running window under this launcher and show the right icon in the
taskbar/dock.

### Repair and removal

Running the action again is safe: it repairs stale or missing managed files
(for example after an upgrade changed the entry's contents). Installation is
atomic — every file is staged as a temporary sibling and renamed into place,
with the desktop entry published **last**, so a failed install can never leave
a menu entry pointing at a missing app.

**Remove from menu** deletes exactly two files — the desktop entry and the icon
— and is idempotent. It never touches other applications' entries and never
removes the shared XDG directories. The managed AppImage itself is left in
place (deleting the executable a running process was launched from would
strand an in-flight update); that leftover copy is *not* treated as a broken
install, so after removing, Settings simply offers **Add to application menu**
again.

### Updates

`electron-updater` enables Linux updates only when `$APPIMAGE` is set. Once you
launch the managed copy from the menu, `$APPIMAGE` points at the stable path,
so the updater replaces that same file and the desktop entry stays valid. The
first time you run the action from a downloaded AppImage, nothing is restarted
— the app just tells you to launch it from the menu next time.

## CLI preview shortcut (headless preview server)

### Overview

The Gutterpress installation scripts create a desktop shortcut that starts the
gutterpress preview server and opens the rendered book in your default browser.

The install scripts download the **standalone gutterpress binary** from GitHub
Releases — no Bun, Node, or git is required on the machine. The shortcut
points directly at that binary.

`gutterpress preview` serves a **headless** HTML preview — there is no toolbar,
page navigation, or folder picker in the browser. For the full interactive
desktop experience (toolbar, page navigation, zoom, folder picker, PDF export),
use the **Gutterpress desktop app** (`packages/desktop`) instead of a browser shortcut.

### Platform Support

#### Windows (install.ps1)

**Shortcut Details:**
- **File**: `Gutterpress Preview.lnk` (created on Desktop)
- **Target**: the installed `gutterpress.exe` binary, with arguments `preview --open true`
- **Working Directory**: `Documents\gutterpress` (the examples directory the installer sets up), falling back to the user's Documents folder
- **Icon**: the binary's own embedded icon (`<gutterpress.exe>,0`)
- **Description**: "Start Gutterpress Preview Server"

#### Linux (install.sh)

**Shortcut Details:**
- **File**: `gutterpress-preview.desktop` (created in `$XDG_DESKTOP_DIR`, falling back to `~/Desktop`)
- **Exec**: the installed `gutterpress` binary, with arguments `preview --open true`
- **Working Directory**: `~/Documents/gutterpress` (the examples directory the installer sets up), falling back to `~/Documents`
- **Terminal**: true (shows server output)
- **Icon**: none is set (the entry uses the desktop environment's default)
- The script marks the file executable and trusted (`gio set ... metadata::trusted true`) where `gio` is available.

**Desktop File Format:**
```ini
[Desktop Entry]
Version=1.0
Type=Application
Name=Gutterpress Preview
Comment=Start Gutterpress Preview Server
Exec=/path/to/gutterpress preview --open true
Path=/home/user/Documents/gutterpress
Terminal=true
StartupNotify=true
```

#### macOS

Currently, macOS users install the binary without a shortcut. Desktop shortcuts are not automatically created.

**Future Enhancement**: Add `.app` bundle creation or Automator workflow for macOS.

### User Experience

#### First Launch
1. User runs installation script
2. Script downloads the standalone gutterpress binary from GitHub Releases
3. Script creates desktop shortcut
4. User sees success message with instructions

#### Daily Use
1. User double-clicks "Gutterpress Preview" shortcut
2. Terminal/PowerShell window opens showing server logs
3. Browser automatically opens to `http://localhost:3579`
4. The rendered book is displayed (headless — no toolbar)
5. Files update live in the browser as they are edited

For the full toolbar UI (page navigation, zoom, folder picker, PDF export),
launch the desktop app from the repo:

```bash
bun --cwd packages/desktop run electron:dev
```

### Customization

Users can modify the shortcut to:
- Change the port: `--port 5000`
- Disable auto-open: replace `--open true` with `--no-open`
- Point to a specific directory: Add path argument

### Troubleshooting

#### Windows: Shortcut not working
- Verify gutterpress is installed: run `gutterpress --version` in PowerShell
- Check shortcut properties for correct paths
- Reinstall with: `.\install.ps1`

#### Linux: Desktop file not showing
- Verify desktop directory: `echo $XDG_DESKTOP_DIR`
- Make executable: `chmod +x ~/Desktop/gutterpress-preview.desktop`
- Trust the file (GNOME): `gio set ~/Desktop/gutterpress-preview.desktop metadata::trusted true`
