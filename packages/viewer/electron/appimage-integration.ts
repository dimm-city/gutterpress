// ──────────────────────────────────────────────────────────────────────────
// appimage-integration.ts — opt-in KDE/GNOME application-menu integration for
// the Linux AppImage build (#119).
//
// An AppImage is a bare portable executable: `chmod +x` and run. It never
// appears in the desktop environment's application menu, and the file the user
// launches lives wherever their browser dropped it. This service installs the
// three per-user files that make the packaged viewer a first-class desktop
// application — a stable managed copy of the AppImage, the packaged icon in
// the hicolor theme, and an XDG `.desktop` entry — with NO elevation and NO
// external tooling (`update-desktop-database`, `kbuildsycoca6`,
// AppImageLauncher and friends are all deliberately un-required; KDE and GNOME
// already watch the per-user applications/icons directories).
//
// Integration is OPT-IN. A portable executable must not silently copy itself
// into the user's home or mutate their desktop environment on first launch, so
// nothing here runs unless the user picks "Add to application menu" in
// Settings → App.
//
// The module owns no Electron imports — it takes a plain {@link AppImageEnv}
// snapshot (platform, isPackaged, $APPIMAGE, home, $XDG_DATA_HOME, packaged
// icon path) and an injectable fs facade, so every path/rendering/atomicity
// rule below is unit-testable without a packaged app
// (tests/platform/appimage-integration.test.ts).
// ──────────────────────────────────────────────────────────────────────────

import path from "node:path";
import * as nodeFs from "node:fs/promises";

/** The app id — shared by the desktop filename, the icon basename, `StartupWMClass`, and package.json's `desktopName`. */
export const APP_ID = "city.dimm.print-md-viewer";
/** The managed AppImage filename. Deliberately distinct from the CLI's `~/.local/bin/print-md`. */
export const APPIMAGE_FILE_NAME = "print-md-viewer.AppImage";
/** The installed desktop entry's filename — must equal package.json `desktopName`. */
export const DESKTOP_FILE_NAME = `${APP_ID}.desktop`;
/** The installed icon's basename (the `Icon=` key names it WITHOUT the extension). */
export const ICON_FILE_NAME = `${APP_ID}.png`;

const APPIMAGE_MODE = 0o755;
const DATA_FILE_MODE = 0o644;

/** Why the action is unavailable, or `null` when it is supported. */
export type UnsupportedReason = "not-linux" | "not-packaged" | "not-appimage";

/** The immutable host facts the service is constructed from. */
export interface AppImageEnv {
  /** `process.platform`. */
  platform: string;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `process.env.APPIMAGE` — the absolute path of the running AppImage, when there is one. */
  appImagePath?: string | undefined;
  /** `app.getPath("home")`. */
  home: string;
  /** `process.env.XDG_DATA_HOME` — unset/empty/relative is invalid and falls back to `$HOME/.local/share`. */
  xdgDataHome?: string | undefined;
  /** Absolute path of the packaged 512×512 icon (`build-resources/icon.png`). */
  iconSourcePath: string;
}

/** The three fixed per-user destinations. Never renderer-supplied. */
export interface AppImagePaths {
  appImage: string;
  desktopEntry: string;
  icon: string;
}

export interface AppImageStatus {
  /** Linux + packaged + running from an AppImage. The UI shows the action only when true. */
  supported: boolean;
  /** Set when `supported` is false; `null` otherwise. */
  reason: UnsupportedReason | null;
  /** All three managed files exist and the desktop entry matches what we would write today. */
  installed: boolean;
  /** Some managed state exists but is incomplete or stale — re-running install repairs it. */
  needsRepair: boolean;
  /** The process is already running the managed copy (so a menu launch is what the user is using). */
  runningManagedCopy: boolean;
  /** The fixed destinations, for display. Present even when unsupported (they are pure path math). */
  paths: AppImagePaths;
}

export interface AppImageInstallResult {
  ok: true;
  /** True when the running process IS the managed copy — no "launch it from the menu next time" nudge needed. */
  runningManagedCopy: boolean;
  message: string;
  status: AppImageStatus;
}

export interface AppImageRemoveResult {
  ok: true;
  /** The managed files actually deleted by this call (empty when nothing was installed). */
  removed: string[];
  message: string;
  status: AppImageStatus;
}

/** The narrow fs surface the service uses — injectable so failure/cleanup paths are testable. */
export interface AppImageFs {
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>;
  copyFile(src: string, dest: string): Promise<void>;
  writeFile(file: string, data: string): Promise<void>;
  chmod(file: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(file: string, options: { force: true }): Promise<void>;
  readFile(file: string, encoding: "utf8"): Promise<string>;
  access(file: string): Promise<void>;
}

/** The real `node:fs/promises` implementation — the default, and the base a test wrapper decorates. */
export const nodeAppImageFs: AppImageFs = {
  mkdir: (dir, options) => nodeFs.mkdir(dir, options),
  copyFile: (src, dest) => nodeFs.copyFile(src, dest),
  writeFile: (file, data) => nodeFs.writeFile(file, data),
  chmod: (file, mode) => nodeFs.chmod(file, mode),
  rename: (from, to) => nodeFs.rename(from, to),
  rm: (file, options) => nodeFs.rm(file, options),
  readFile: (file, encoding) => nodeFs.readFile(file, encoding),
  access: (file) => nodeFs.access(file),
};

// ── XDG path resolution ─────────────────────────────────────────────────────

/**
 * `$XDG_DATA_HOME`, or `$HOME/.local/share`. Per the Base Directory spec an
 * unset OR empty value falls back — and a RELATIVE value is explicitly invalid
 * (the spec requires an absolute path), so it falls back too rather than
 * resolving against whatever cwd the app happened to launch from.
 */
export function resolveXdgDataHome(home: string, xdgDataHome?: string | undefined): string {
  const raw = (xdgDataHome ?? "").trim();
  if (raw && path.isAbsolute(raw)) return path.normalize(raw);
  return path.join(home, ".local", "share");
}

/** The fixed managed destinations for a given home + `$XDG_DATA_HOME`. */
export function resolveAppImagePaths(home: string, xdgDataHome?: string | undefined): AppImagePaths {
  const dataHome = resolveXdgDataHome(home, xdgDataHome);
  return {
    appImage: path.join(home, ".local", "bin", APPIMAGE_FILE_NAME),
    desktopEntry: path.join(dataHome, "applications", DESKTOP_FILE_NAME),
    icon: path.join(dataHome, "icons", "hicolor", "512x512", "apps", ICON_FILE_NAME),
  };
}

// ── Desktop entry rendering ─────────────────────────────────────────────────

/**
 * Desktop Entry *string* escaping (spec §"Value types"): a literal backslash
 * is doubled, and the ASCII control characters that would otherwise terminate
 * or split the value are escaped.
 */
function escapeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Serialize one `Exec` argument.
 *
 * Two escaping layers apply, in this order when a launcher READS the file:
 * the whole value is first unescaped as a desktop-entry string, and the result
 * is then parsed for quoting. So we quote first (inside double quotes the spec
 * reserves `"`, `` ` ``, `$` and `\`, each escaped with a backslash) and then
 * run the whole thing through the string escaper, which doubles every
 * backslash we just added. Quoting unconditionally keeps a path containing
 * spaces — `~/My Apps/…` — from being split into two argv entries.
 */
export function escapeExecArgument(argument: string): string {
  const quoted = `"${argument.replace(/(["`$\\])/g, "\\$1")}"`;
  return escapeValue(quoted);
}

/**
 * The exact desktop entry we install.
 *
 * Deliberately carries NO `%f`/`%F`/`%u`/`%U` field code, no `MimeType`, and
 * no custom scheme: the viewer does not process startup argv (its
 * `second-instance` handler only focuses the existing window), so advertising
 * file or URL handling here would register associations that silently do
 * nothing. `StartupWMClass` matches package.json's `desktopName`-derived
 * application id so KDE/GNOME group the running window under this launcher on
 * both X11 and Wayland.
 */
export function renderDesktopEntry(appImagePath: string): string {
  return [
    "[Desktop Entry]",
    "Version=1.0",
    "Type=Application",
    "Name=print-md-viewer",
    "Comment=Write books in Markdown and export print-ready PDFs",
    `Exec=${escapeExecArgument(appImagePath)}`,
    `TryExec=${escapeValue(appImagePath)}`,
    `Icon=${APP_ID}`,
    "Terminal=false",
    "Categories=Office;Publishing;",
    "StartupNotify=true",
    `StartupWMClass=${APP_ID}`,
    "",
  ].join("\n");
}

// ── The service ─────────────────────────────────────────────────────────────

let tmpCounter = 0;

/** A unique sibling temp name, so a failed install never half-writes the real target. */
function tempSibling(target: string): string {
  tmpCounter += 1;
  const dir = path.dirname(target);
  return path.join(dir, `.${path.basename(target)}.${process.pid}-${tmpCounter}.tmp`);
}

export class AppImageIntegration {
  private readonly env: AppImageEnv;
  private readonly fs: AppImageFs;
  readonly paths: AppImagePaths;

  constructor(env: AppImageEnv, fs: AppImageFs = nodeAppImageFs) {
    this.env = env;
    this.fs = fs;
    this.paths = resolveAppImagePaths(env.home, env.xdgDataHome);
  }

  /** `null` when the action is available; the blocking reason otherwise. */
  private unsupportedReason(): UnsupportedReason | null {
    if (this.env.platform !== "linux") return "not-linux";
    if (!this.env.isPackaged) return "not-packaged";
    const appImage = (this.env.appImagePath ?? "").trim();
    if (!appImage || !path.isAbsolute(appImage)) return "not-appimage";
    return null;
  }

  private async exists(file: string): Promise<boolean> {
    try {
      await this.fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  /** True when the running AppImage already IS the managed copy. */
  private isRunningManagedCopy(): boolean {
    const running = (this.env.appImagePath ?? "").trim();
    if (!running || !path.isAbsolute(running)) return false;
    return path.resolve(running) === path.resolve(this.paths.appImage);
  }

  async status(): Promise<AppImageStatus> {
    const reason = this.unsupportedReason();
    if (reason) {
      return {
        supported: false,
        reason,
        installed: false,
        needsRepair: false,
        runningManagedCopy: false,
        paths: this.paths,
      };
    }

    const [appImageExists, iconExists, desktopContent] = await Promise.all([
      this.exists(this.paths.appImage),
      this.exists(this.paths.icon),
      this.fs.readFile(this.paths.desktopEntry, "utf8").catch(() => null),
    ]);

    // A desktop entry that no longer matches what we would write (an older
    // Exec path, a renamed key) is stale, not installed — re-running the
    // action rewrites it.
    const desktopMatches = desktopContent === renderDesktopEntry(this.paths.appImage);
    const installed = appImageExists && iconExists && desktopMatches;
    const anyPresent = appImageExists || iconExists || desktopContent !== null;

    return {
      supported: true,
      reason: null,
      installed,
      needsRepair: anyPresent && !installed,
      runningManagedCopy: this.isRunningManagedCopy(),
      paths: this.paths,
    };
  }

  /**
   * Install (or repair) the managed AppImage, icon, and desktop entry.
   *
   * Atomic by construction: every file is staged as a unique sibling temp,
   * given its final mode, and `rename()`d into place (same directory, so the
   * rename is atomic on any POSIX filesystem). The DESKTOP ENTRY IS PUBLISHED
   * LAST — the menu entry can therefore never appear pointing at a missing or
   * half-copied AppImage. Any failure unlinks the temps it created and
   * rethrows, leaving whatever was already installed untouched.
   */
  async install(): Promise<AppImageInstallResult> {
    const reason = this.unsupportedReason();
    if (reason) throw new Error(unsupportedMessage(reason));

    const source = path.resolve((this.env.appImagePath ?? "").trim());
    const temps: string[] = [];

    try {
      await this.fs.mkdir(path.dirname(this.paths.appImage), { recursive: true });
      await this.fs.mkdir(path.dirname(this.paths.icon), { recursive: true });
      await this.fs.mkdir(path.dirname(this.paths.desktopEntry), { recursive: true });

      // Repair case: when the running process already IS the managed copy,
      // copying the file onto itself would be pointless work on a multi-hundred
      // MB executable — only the mode is (re-)asserted.
      if (path.resolve(this.paths.appImage) === source) {
        await this.fs.chmod(this.paths.appImage, APPIMAGE_MODE);
      } else {
        const tmp = tempSibling(this.paths.appImage);
        temps.push(tmp);
        await this.fs.copyFile(source, tmp);
        await this.fs.chmod(tmp, APPIMAGE_MODE);
        await this.fs.rename(tmp, this.paths.appImage);
        temps.pop();
      }

      const iconTmp = tempSibling(this.paths.icon);
      temps.push(iconTmp);
      await this.fs.copyFile(this.env.iconSourcePath, iconTmp);
      await this.fs.chmod(iconTmp, DATA_FILE_MODE);
      await this.fs.rename(iconTmp, this.paths.icon);
      temps.pop();

      const desktopTmp = tempSibling(this.paths.desktopEntry);
      temps.push(desktopTmp);
      await this.fs.writeFile(desktopTmp, renderDesktopEntry(this.paths.appImage));
      await this.fs.chmod(desktopTmp, DATA_FILE_MODE);
      await this.fs.rename(desktopTmp, this.paths.desktopEntry);
      temps.pop();
    } catch (err) {
      await Promise.all(
        temps.map((tmp) => this.fs.rm(tmp, { force: true }).catch(() => {})),
      );
      throw err;
    }

    const runningManagedCopy = this.isRunningManagedCopy();
    return {
      ok: true,
      runningManagedCopy,
      message: runningManagedCopy
        ? "Added to your application menu. It may take a few seconds to appear."
        : "Added to your application menu. Launch it there next time to use the managed copy. It may take a few seconds to appear.",
      status: await this.status(),
    };
  }

  /**
   * Remove the menu entry and its icon. Idempotent, and scoped to the two
   * EXACT files this integration owns — the shared XDG `applications/` and
   * `icons/hicolor/…` directories are never removed, recursively or otherwise,
   * because they hold other applications' entries.
   *
   * The managed AppImage is deliberately left in place: deleting the file the
   * process is currently executing would strand a staged install-on-quit
   * update mid-flight, which is out of scope here (see #119 — full uninstall
   * is a follow-up).
   */
  async remove(): Promise<AppImageRemoveResult> {
    const reason = this.unsupportedReason();
    if (reason) throw new Error(unsupportedMessage(reason));

    const removed: string[] = [];
    for (const file of [this.paths.desktopEntry, this.paths.icon]) {
      if (await this.exists(file)) {
        await this.fs.rm(file, { force: true });
        removed.push(file);
      }
    }

    return {
      ok: true,
      removed,
      message: removed.length
        ? "Removed from your application menu. The app itself is still installed at " +
          `${this.paths.appImage}.`
        : "There was nothing to remove — this app is not in your application menu.",
      status: await this.status(),
    };
  }
}

/** The user-facing explanation for an unsupported environment. */
export function unsupportedMessage(reason: UnsupportedReason): string {
  switch (reason) {
    case "not-linux":
      return "Application-menu integration is only available on Linux.";
    case "not-packaged":
      return "Application-menu integration is only available in a packaged build.";
    case "not-appimage":
      return "Application-menu integration is only available when running the Linux AppImage.";
  }
}
