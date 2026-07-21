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
// Audit A1 / conf-27: the settings merge lives in exactly ONE place now — the
// reconciled, array-safe `deepMergeSettings` in the pure (PWA-clean) renderer
// module. This host store used to carry a THIRD, divergent copy that lacked the
// `!Array.isArray(value)` guard, so an array-shaped section patch spread into
// `{0:…,1:…}` and corrupted app-settings.json on the LIVE desktop path (the POST
// /api/app/settings route runs this copy). `mergeSettings` stays as a thin,
// same-signature delegator so every caller is unchanged.
import { deepMergeSettings } from "../src/lib/settings-merge";

export type { AppSettings };
export { DEFAULT_SETTINGS };

export type DeepPartialSettings = {
  [K in keyof AppSettings]?: Partial<AppSettings[K]>;
};

export function mergeSettings(base: AppSettings, patch: DeepPartialSettings): AppSettings {
  return deepMergeSettings(base, patch);
}

/**
 * Legacy-shape migration, applied to the parsed on-disk JSON before the
 * defaults merge. Pre-0.8.2 files stored `updates.includePrereleases`
 * (boolean); the schema is now `updates.channel` ("stable" | "beta" |
 * "alpha"). An old opt-in maps to "beta" — the closest match for what the
 * toggle meant ("get prereleases before the stable release"). A file that
 * already has `channel` is left alone, so this cannot fight the new setting.
 */
export function migrateLegacySettings(stored: DeepPartialSettings): DeepPartialSettings {
  const updates = stored.updates as
    | { channel?: unknown; includePrereleases?: unknown }
    | undefined;
  if (updates && updates.channel === undefined && typeof updates.includePrereleases === "boolean") {
    const { includePrereleases, ...rest } = updates;
    return {
      ...stored,
      updates: { ...rest, channel: includePrereleases ? "beta" : "stable" },
    } as DeepPartialSettings;
  }
  return stored;
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
  updateSettings(patch: DeepPartialSettings): Promise<AppSettings>;
  settingsPath(): string;
} {
  function settingsPath(): string {
    return path.join(deps.getUserDataDir(), "app-settings.json");
  }

  async function readSettings(): Promise<AppSettings> {
    let raw: string;
    try {
      raw = await deps.fs.readFile(settingsPath(), "utf8");
    } catch (err) {
      // ENOENT = no file yet (first run, or removed) — nothing to preserve.
      // ANY OTHER read error (EACCES from an AV/backup tool holding the file,
      // EIO, EMFILE) is TRANSIENT: returning defaults here would let
      // updateSettings merge its patch over DEFAULT_SETTINGS and rename-write
      // the result, silently wiping every other customized setting. Rethrow so
      // the write aborts — same standard as FileTokenStore.read (audit G3).
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return DEFAULT_SETTINGS;
      throw err;
    }
    try {
      const stored = migrateLegacySettings(JSON.parse(raw) as DeepPartialSettings);
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

  async function writeNow(settings: AppSettings): Promise<void> {
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

  // Serialize every write on one chain, exactly like prefs-store (#34): the
  // main-process open flow and the app/* settings routes the renderer calls
  // can both write concurrently. Without serialization two overlapping writers
  // race on the shared `<file>.tmp` path — the second `writeFile` can truncate
  // the tmp the first is mid-`rename` on (ENOENT / a corrupt merge), and the
  // last full-object writer silently reverts the other's change (lost update).
  let chain: Promise<unknown> = Promise.resolve();
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = chain.then(op);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function writeSettings(settings: AppSettings): Promise<void> {
    return enqueue(() => writeNow(settings));
  }

  /**
   * Atomic read-modify-write (audit A2 / conf-14): the read, merge, and write
   * all happen inside ONE queue slot, so two settings patches fired close
   * together compose instead of the second silently reverting the first. The
   * POST /api/app/settings route previously did readSettings()+writeSettings()
   * as two unserialized steps — a lost update. Mirrors prefs-store.updatePrefs.
   */
  function updateSettings(patch: DeepPartialSettings): Promise<AppSettings> {
    return enqueue(async () => {
      const next = mergeSettings(await readSettings(), patch);
      await writeNow(next);
      return next;
    });
  }

  return { readSettings, writeSettings, updateSettings, settingsPath };
}
