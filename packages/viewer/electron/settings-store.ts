// ──────────────────────────────────────────────────────────────────────────
// User settings (#45) — persisted, section-organised user preferences in a
// SEPARATE file from viewer-prefs.json so session/per-project state and durable
// user settings don't collide. The AppSettings shape and DEFAULT_SETTINGS
// (#29) are no longer hand-duplicated here — both are imported from
// `src/lib/platform/shared-types.ts` (via `./bridge-types`), the single
// shared module both the host and the renderer side consume.
//
// Phase 5b: extracted (behavior-identical) from electron/main.ts. The pure
// merge helpers live here alongside an injected-fs store factory so the
// read/write path can be unit-tested with fakes (tests/platform/settings-store).
// Writes are atomic (write `<file>.tmp` then rename) and a parse failure
// preserves the corrupt file as `<file>.corrupt-<ts>` instead of silently
// discarding it (#34).
// ──────────────────────────────────────────────────────────────────────────

import path from "node:path";
import type { AppSettings } from "./bridge-types";
import { DEFAULT_SETTINGS } from "./bridge-types";

export type { AppSettings };
export { DEFAULT_SETTINGS };

export type DeepPartialSettings = {
  [K in keyof AppSettings]?: Partial<AppSettings[K]>;
};

function mergeSettingsSection<K extends keyof AppSettings>(
  target: AppSettings,
  base: AppSettings,
  key: K,
  value: DeepPartialSettings[K],
): void {
  if (value && typeof value === "object") {
    target[key] = { ...base[key], ...value } as AppSettings[K];
  }
}

export function mergeSettings(base: AppSettings, patch: DeepPartialSettings): AppSettings {
  const out: AppSettings = { ...base };
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    mergeSettingsSection(out, base, key, patch[key]);
  }
  return out;
}

export interface SettingsStoreDeps {
  getUserDataDir(): string;
  fs: {
    readFile(p: string, enc: BufferEncoding): Promise<string>;
    writeFile(p: string, data: string, enc: BufferEncoding): Promise<void>;
    mkdir(p: string, opts: unknown): Promise<unknown>;
    /** Used for the atomic `<file>.tmp` → `<file>` write and to preserve a
     * corrupt file as `<file>.corrupt-<ts>` instead of discarding it (#34). */
    rename(oldPath: string, newPath: string): Promise<void>;
  };
}

export function createSettingsStore(deps: SettingsStoreDeps): {
  readSettings(): Promise<AppSettings>;
  writeSettings(s: AppSettings): Promise<void>;
  settingsPath(): string;
} {
  function settingsPath(): string {
    return path.join(deps.getUserDataDir(), "app-settings.json");
  }

  async function readSettings(): Promise<AppSettings> {
    let raw: string;
    try {
      raw = await deps.fs.readFile(settingsPath(), "utf8");
    } catch {
      // No readable file yet (first run, or removed) — nothing to preserve.
      return DEFAULT_SETTINGS;
    }
    try {
      const stored = JSON.parse(raw) as DeepPartialSettings;
      return mergeSettings(DEFAULT_SETTINGS, stored);
    } catch (err) {
      // The file exists but isn't valid JSON. Preserve it instead of
      // silently falling back to defaults and losing whatever the author
      // had configured (#34) — a corrupt write must not look like a reset.
      await preserveCorruptFile(settingsPath(), err).catch(() => {});
      return DEFAULT_SETTINGS;
    }
  }

  async function preserveCorruptFile(target: string, err: unknown): Promise<void> {
    const corruptPath = `${target}.corrupt-${Date.now()}`;
    try {
      await deps.fs.rename(target, corruptPath);
      console.warn(
        `[settings-store] ${target} contained invalid JSON; preserved as ${corruptPath} instead of being discarded.`,
        err,
      );
    } catch (renameErr) {
      console.warn(
        `[settings-store] ${target} contained invalid JSON but could not be preserved (rename failed):`,
        renameErr,
      );
    }
  }

  async function writeSettings(settings: AppSettings): Promise<void> {
    await deps.fs.mkdir(deps.getUserDataDir(), { recursive: true });
    const target = settingsPath();
    const tmp = `${target}.tmp`;
    // Atomic write (#34): write the full JSON to a sibling temp file, then
    // rename over the real path. A crash/kill mid-`writeFile` leaves the
    // `.tmp` truncated but the real settings file untouched; `rename` on
    // POSIX and Windows (NTFS) both replace the destination in one syscall,
    // so readers never observe a partially-written app-settings.json.
    await deps.fs.writeFile(tmp, JSON.stringify(settings, null, 2), "utf8");
    await deps.fs.rename(tmp, target);
  }

  return { readSettings, writeSettings, settingsPath };
}
