/**
 * Linux AppImage application-menu integration (#119).
 *
 * Covers the whole contract of `electron/appimage-integration.ts`:
 * XDG resolution (custom / empty / relative / unset), the EXACT desktop-entry
 * fields, Desktop Entry escaping, atomic install + permissions, failure
 * cleanup (no half-published menu entry), repair, idempotent removal, and
 * every unsupported environment. Real files in a real temp dir wherever the
 * behaviour under test is a filesystem effect (modes, atomicity); an injected
 * fs facade only where a failure has to be forced.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, readFile, writeFile, stat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  APP_ID,
  AppImageIntegration,
  escapeExecArgument,
  nodeAppImageFs,
  renderDesktopEntry,
  resolveAppImagePaths,
  resolveXdgDataHome,
  type AppImageEnv,
  type AppImageFs,
  type UnsupportedReason,
} from "../../electron/appimage-integration";

let tmpRoot = "";
let home = "";
let sourceAppImage = "";
let sourceIcon = "";

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "printmd-appimage-"));
  home = path.join(tmpRoot, "home");
  await mkdir(path.join(tmpRoot, "downloads"), { recursive: true });
  await mkdir(path.join(tmpRoot, "resources"), { recursive: true });
  await mkdir(home, { recursive: true });
  sourceAppImage = path.join(tmpRoot, "downloads", "print-md-viewer-0.8.3.AppImage");
  sourceIcon = path.join(tmpRoot, "resources", "icon.png");
  await writeFile(sourceAppImage, "APPIMAGE-BYTES");
  await writeFile(sourceIcon, "PNG-BYTES");
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function env(overrides: Partial<AppImageEnv> = {}): AppImageEnv {
  return {
    platform: "linux",
    isPackaged: true,
    appImagePath: sourceAppImage,
    home,
    xdgDataHome: undefined,
    iconSourcePath: sourceIcon,
    ...overrides,
  };
}

async function modeOf(file: string): Promise<number> {
  return (await stat(file)).mode & 0o777;
}

// ── XDG path resolution ─────────────────────────────────────────────────────

describe("XDG_DATA_HOME resolution", () => {
  test("an absolute XDG_DATA_HOME is honoured", () => {
    expect(resolveXdgDataHome("/home/w", "/custom/data")).toBe("/custom/data");
  });

  test("unset, empty, and whitespace-only fall back to $HOME/.local/share", () => {
    expect(resolveXdgDataHome("/home/w", undefined)).toBe("/home/w/.local/share");
    expect(resolveXdgDataHome("/home/w", "")).toBe("/home/w/.local/share");
    expect(resolveXdgDataHome("/home/w", "   ")).toBe("/home/w/.local/share");
  });

  test("a RELATIVE XDG_DATA_HOME is invalid per the spec and falls back (never resolves against cwd)", () => {
    expect(resolveXdgDataHome("/home/w", "share")).toBe("/home/w/.local/share");
    expect(resolveXdgDataHome("/home/w", "./share")).toBe("/home/w/.local/share");
    expect(resolveXdgDataHome("/home/w", "../share")).toBe("/home/w/.local/share");
  });

  test("the managed destinations are the fixed per-user paths", () => {
    expect(resolveAppImagePaths("/home/w")).toEqual({
      appImage: "/home/w/.local/bin/print-md-viewer.AppImage",
      desktopEntry: "/home/w/.local/share/applications/city.dimm.print-md-viewer.desktop",
      icon: "/home/w/.local/share/icons/hicolor/512x512/apps/city.dimm.print-md-viewer.png",
    });
  });

  test("a custom XDG_DATA_HOME moves the desktop entry and icon but NOT the AppImage (~/.local/bin is not an XDG data dir)", () => {
    const paths = resolveAppImagePaths("/home/w", "/custom/data");
    expect(paths.desktopEntry).toBe("/custom/data/applications/city.dimm.print-md-viewer.desktop");
    expect(paths.icon).toBe("/custom/data/icons/hicolor/512x512/apps/city.dimm.print-md-viewer.png");
    expect(paths.appImage).toBe("/home/w/.local/bin/print-md-viewer.AppImage");
  });

  test("the managed AppImage filename never collides with the CLI's ~/.local/bin/print-md", () => {
    expect(path.basename(resolveAppImagePaths("/home/w").appImage)).toBe("print-md-viewer.AppImage");
  });
});

// ── Desktop entry contract ──────────────────────────────────────────────────

describe("desktop entry", () => {
  const entry = renderDesktopEntry("/home/w/.local/bin/print-md-viewer.AppImage");

  test("contains exactly the agreed fields", () => {
    expect(entry).toBe(
      [
        "[Desktop Entry]",
        "Version=1.0",
        "Type=Application",
        "Name=print-md-viewer",
        "Comment=Write books in Markdown and export print-ready PDFs",
        'Exec="/home/w/.local/bin/print-md-viewer.AppImage"',
        "TryExec=/home/w/.local/bin/print-md-viewer.AppImage",
        "Icon=city.dimm.print-md-viewer",
        "Terminal=false",
        "Categories=Office;Publishing;",
        "StartupNotify=true",
        "StartupWMClass=city.dimm.print-md-viewer",
        "",
      ].join("\n"),
    );
  });

  test("Exec holds an EXPANDED absolute path — .desktop launchers do not expand ~", () => {
    const execLine = entry.split("\n").find((l) => l.startsWith("Exec="))!;
    expect(execLine).not.toContain("~");
    expect(execLine).toContain("/home/w/.local/bin/");
  });

  test("claims no file/URL handling: no field codes, no MimeType, no scheme", () => {
    expect(entry).not.toMatch(/%[fFuU]/);
    expect(entry).not.toContain("MimeType");
    expect(entry).not.toContain("x-scheme-handler");
    expect(entry).not.toContain("app://");
  });

  test("StartupWMClass, Icon, and the desktop filename all derive from the one app id", () => {
    expect(entry).toContain(`StartupWMClass=${APP_ID}`);
    expect(entry).toContain(`Icon=${APP_ID}`);
    expect(path.basename(resolveAppImagePaths("/home/w").desktopEntry)).toBe(`${APP_ID}.desktop`);
    expect(path.basename(resolveAppImagePaths("/home/w").icon)).toBe(`${APP_ID}.png`);
  });

  test("Exec quotes a path with spaces so it stays ONE argument", () => {
    expect(escapeExecArgument("/home/My Apps/print-md-viewer.AppImage")).toBe(
      '"/home/My Apps/print-md-viewer.AppImage"',
    );
  });

  test("Exec escapes the spec's reserved characters at BOTH layers (quoting, then desktop-string)", () => {
    // Quoting escapes `"` to `\"`; the desktop-entry string layer then doubles
    // that backslash — a launcher unescapes the string first, then parses quotes.
    expect(escapeExecArgument('/home/w/a"b')).toBe('"/home/w/a\\\\"b"');
    expect(escapeExecArgument("/home/w/a$b")).toBe('"/home/w/a\\\\$b"');
    expect(escapeExecArgument("/home/w/a`b")).toBe('"/home/w/a\\\\`b"');
    expect(escapeExecArgument("/home/w/a\\b")).toBe('"/home/w/a\\\\\\\\b"');
  });

  test("TryExec escapes a literal backslash as a desktop-entry string (it is not quoted)", () => {
    const weird = renderDesktopEntry("/home/w/a\\b.AppImage");
    expect(weird).toContain("TryExec=/home/w/a\\\\b.AppImage");
  });
});

// ── Unsupported environments ────────────────────────────────────────────────

describe("unsupported environments", () => {
  const cases: Array<[string, Partial<AppImageEnv>, UnsupportedReason]> = [
    ["non-Linux", { platform: "darwin" }, "not-linux"],
    ["development (not packaged)", { isPackaged: false }, "not-packaged"],
    ["packaged but not an AppImage", { appImagePath: undefined }, "not-appimage"],
    ["an empty APPIMAGE value", { appImagePath: "" }, "not-appimage"],
    ["a relative APPIMAGE value", { appImagePath: "./viewer.AppImage" }, "not-appimage"],
  ];

  for (const [label, overrides, reason] of cases) {
    test(`${label} reports supported:false (${reason}) and refuses both actions`, async () => {
      const service = new AppImageIntegration(env(overrides));
      const status = await service.status();
      expect(status.supported).toBe(false);
      expect(status.reason).toBe(reason);
      expect(status.installed).toBe(false);
      expect(status.needsRepair).toBe(false);
      // The paths are pure math and stay available for display.
      expect(status.paths.desktopEntry).toContain("applications");
      await expect(service.install()).rejects.toThrow();
      await expect(service.remove()).rejects.toThrow();
    });
  }

  test("an unsupported environment writes nothing to disk", async () => {
    const service = new AppImageIntegration(env({ platform: "win32" }));
    await service.install().catch(() => {});
    await expect(readdir(home)).resolves.toEqual([]);
  });
});

// ── Install ─────────────────────────────────────────────────────────────────

describe("install", () => {
  test("installs all three managed files with the required permissions", async () => {
    const service = new AppImageIntegration(env());
    const result = await service.install();

    expect(result.ok).toBe(true);
    expect(await readFile(service.paths.appImage, "utf8")).toBe("APPIMAGE-BYTES");
    expect(await readFile(service.paths.icon, "utf8")).toBe("PNG-BYTES");
    expect(await readFile(service.paths.desktopEntry, "utf8")).toBe(
      renderDesktopEntry(service.paths.appImage),
    );

    expect(await modeOf(service.paths.appImage)).toBe(0o755);
    expect(await modeOf(service.paths.icon)).toBe(0o644);
    expect(await modeOf(service.paths.desktopEntry)).toBe(0o644);

    expect(result.status.installed).toBe(true);
    expect(result.status.needsRepair).toBe(false);
  });

  test("respects a custom XDG_DATA_HOME", async () => {
    const dataHome = path.join(tmpRoot, "xdg-data");
    const service = new AppImageIntegration(env({ xdgDataHome: dataHome }));
    await service.install();

    expect(service.paths.desktopEntry.startsWith(dataHome)).toBe(true);
    expect(await readFile(service.paths.desktopEntry, "utf8")).toContain("Exec=");
    expect(await readFile(service.paths.icon, "utf8")).toBe("PNG-BYTES");
  });

  test("the Exec path points at the MANAGED copy, not the download the user launched", async () => {
    const service = new AppImageIntegration(env());
    await service.install();
    const entry = await readFile(service.paths.desktopEntry, "utf8");
    expect(entry).toContain(`Exec="${service.paths.appImage}"`);
    expect(entry).not.toContain(sourceAppImage);
  });

  test("run from a downloaded copy, it tells the user to launch from the menu next time", async () => {
    const result = await new AppImageIntegration(env()).install();
    expect(result.runningManagedCopy).toBe(false);
    expect(result.message).toContain("Launch it there next time");
  });

  test("run from the managed copy it skips the self-copy, re-asserts the mode, and drops the nudge", async () => {
    const managed = resolveAppImagePaths(home).appImage;
    await mkdir(path.dirname(managed), { recursive: true });
    await writeFile(managed, "MANAGED-BYTES", { mode: 0o644 });

    const result = await new AppImageIntegration(env({ appImagePath: managed })).install();

    expect(result.runningManagedCopy).toBe(true);
    expect(result.message).not.toContain("Launch it there next time");
    // Not overwritten by a copy of itself, but the executable bit is restored.
    expect(await readFile(managed, "utf8")).toBe("MANAGED-BYTES");
    expect(await modeOf(managed)).toBe(0o755);
  });

  test("leaves no temp files behind", async () => {
    const service = new AppImageIntegration(env());
    await service.install();
    for (const dir of [
      path.dirname(service.paths.appImage),
      path.dirname(service.paths.icon),
      path.dirname(service.paths.desktopEntry),
    ]) {
      expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    }
  });
});

// ── Atomicity / failure cleanup ─────────────────────────────────────────────

describe("atomic installation", () => {
  /** Wrap the real fs, failing ONE named operation the Nth time it is called. */
  function failingFs(failOn: keyof AppImageFs, onCall = 1): AppImageFs {
    let seen = 0;
    return new Proxy(nodeAppImageFs, {
      get(target, prop: string & keyof AppImageFs) {
        const fn = target[prop];
        if (prop !== failOn) return fn;
        return (...args: unknown[]) => {
          seen += 1;
          if (seen === onCall) return Promise.reject(new Error(`boom: ${prop}`));
          return (fn as (...a: unknown[]) => unknown)(...args);
        };
      },
    });
  }

  test("the desktop entry is published LAST — an icon failure never leaves a menu entry", async () => {
    const service = new AppImageIntegration(env(), failingFs("copyFile", 2));
    await expect(service.install()).rejects.toThrow("boom: copyFile");

    const status = await service.status();
    expect(status.installed).toBe(false);
    // Nothing points at a half-installed app: no desktop entry exists at all.
    await expect(readFile(service.paths.desktopEntry, "utf8")).rejects.toThrow();
  });

  test("a failed install cleans up its temp files", async () => {
    const service = new AppImageIntegration(env(), failingFs("rename", 3));
    await expect(service.install()).rejects.toThrow("boom: rename");

    const leftovers = (await readdir(path.dirname(service.paths.desktopEntry))).filter((n) =>
      n.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
  });

  test("a failed install leaves a PREVIOUSLY installed entry intact", async () => {
    const good = new AppImageIntegration(env());
    await good.install();

    const failing = new AppImageIntegration(env(), failingFs("copyFile", 1));
    await expect(failing.install()).rejects.toThrow("boom: copyFile");

    expect(await readFile(good.paths.desktopEntry, "utf8")).toBe(
      renderDesktopEntry(good.paths.appImage),
    );
    expect((await good.status()).installed).toBe(true);
  });
});

// ── Status / repair ─────────────────────────────────────────────────────────

describe("status and repair", () => {
  test("a clean environment is supported, not installed, and needs no repair", async () => {
    const status = await new AppImageIntegration(env()).status();
    expect(status).toMatchObject({
      supported: true,
      reason: null,
      installed: false,
      needsRepair: false,
      runningManagedCopy: false,
    });
  });

  test("a missing icon marks the install as needing repair", async () => {
    const service = new AppImageIntegration(env());
    await service.install();
    await rm(service.paths.icon);

    const status = await service.status();
    expect(status.installed).toBe(false);
    expect(status.needsRepair).toBe(true);
  });

  test("a STALE desktop entry (old Exec path) marks the install as needing repair", async () => {
    const service = new AppImageIntegration(env());
    await service.install();
    await writeFile(
      service.paths.desktopEntry,
      renderDesktopEntry("/somewhere/else/print-md-viewer.AppImage"),
    );

    expect((await service.status()).needsRepair).toBe(true);
  });

  test("re-running install is idempotent and repairs stale/missing files", async () => {
    const service = new AppImageIntegration(env());
    await service.install();
    await rm(service.paths.icon);
    await writeFile(service.paths.desktopEntry, "[Desktop Entry]\nName=stale\n");

    const repaired = await service.install();
    expect(repaired.status.installed).toBe(true);
    expect(repaired.status.needsRepair).toBe(false);
    expect(await readFile(service.paths.icon, "utf8")).toBe("PNG-BYTES");
    expect(await readFile(service.paths.desktopEntry, "utf8")).toBe(
      renderDesktopEntry(service.paths.appImage),
    );

    // And again over a fully healthy install — same result, no error.
    expect((await service.install()).status.installed).toBe(true);
  });

  test("the menu launch survives the original download being deleted", async () => {
    const service = new AppImageIntegration(env());
    await service.install();
    await rm(sourceAppImage);

    const status = await service.status();
    expect(status.installed).toBe(true);
    expect(await readFile(status.paths.appImage, "utf8")).toBe("APPIMAGE-BYTES");
  });
});

// ── Removal ─────────────────────────────────────────────────────────────────

describe("removal", () => {
  test("removes the desktop entry and icon, and only those", async () => {
    const service = new AppImageIntegration(env());
    await service.install();
    const siblingEntry = path.join(
      path.dirname(service.paths.desktopEntry),
      "someone-elses-app.desktop",
    );
    const siblingIcon = path.join(path.dirname(service.paths.icon), "someone-elses-app.png");
    await writeFile(siblingEntry, "[Desktop Entry]\n");
    await writeFile(siblingIcon, "OTHER-PNG");

    const result = await service.remove();

    expect(result.removed.sort()).toEqual([service.paths.desktopEntry, service.paths.icon].sort());
    await expect(readFile(service.paths.desktopEntry, "utf8")).rejects.toThrow();
    await expect(readFile(service.paths.icon, "utf8")).rejects.toThrow();
    // Other applications' files, and the shared XDG directories, are untouched.
    expect(await readFile(siblingEntry, "utf8")).toBe("[Desktop Entry]\n");
    expect(await readFile(siblingIcon, "utf8")).toBe("OTHER-PNG");
  });

  test("leaves the managed AppImage in place (full uninstall is out of scope, #119)", async () => {
    const service = new AppImageIntegration(env());
    await service.install();
    await service.remove();

    expect(await readFile(service.paths.appImage, "utf8")).toBe("APPIMAGE-BYTES");
    // Some managed state remains, so status reports "repair needed", not "clean".
    const status = await service.status();
    expect(status.installed).toBe(false);
    expect(status.needsRepair).toBe(true);
  });

  test("is idempotent — a second removal is a no-op, not an error", async () => {
    const service = new AppImageIntegration(env());
    await service.install();

    expect((await service.remove()).removed.length).toBe(2);
    const second = await service.remove();
    expect(second.ok).toBe(true);
    expect(second.removed).toEqual([]);
    expect(second.message).toContain("nothing to remove");
  });

  test("removing when nothing was ever installed succeeds and reports nothing removed", async () => {
    const result = await new AppImageIntegration(env()).remove();
    expect(result.removed).toEqual([]);
  });
});
