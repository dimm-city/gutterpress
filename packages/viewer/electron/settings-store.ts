// ──────────────────────────────────────────────────────────────────────────
// User settings (#45) — persisted, section-organised user preferences in a
// SEPARATE file from viewer-prefs.json so session/per-project state and durable
// user settings don't collide. Shape mirrors AppSettings in
// src/lib/platform/contract.ts (kept in sync manually).
//
// Phase 5b: extracted (behavior-identical) from electron/main.ts. The pure
// merge helpers live here alongside an injected-fs store factory so the
// read/write path can be unit-tested with fakes (tests/platform/settings-store).
// ──────────────────────────────────────────────────────────────────────────

import path from "node:path";

export interface AppSettings {
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    spellCheckLanguage: string;
    autoSaveDelay: number;
    crashRecovery: boolean;
  };
  appearance: {
    theme: "light" | "dark" | "system";
    previewBg: string;
  };
  preview: {
    defaultZoom: string;
    viewMode: "single" | "two-column";
    paneMode: "edit" | "view";
  };
  versionHistory: {
    /** Save automatic snapshots after edits settle (RC1-3). Default ON. */
    autoSnapshot: boolean;
    /** Minutes of quiet after the last edit before a snapshot fires. */
    autoSnapshotMinutes: number;
    /**
     * Automatically sync to the remote when a remote is configured (transparent-
     * sync plan §6). Defaults ON for projects with canSync; local-only projects
     * are never auto-synced regardless of this setting.
     */
    autoSync: boolean;
    /** Periodic safety-sync cadence in minutes (clamped to [1, 1440]). */
    autoSyncMinutes: number;
  };
  gitIdentity: {
    authorName: string;
    authorEmail: string;
  };
  advanced: {
    fileWatcherInterval: number;
    logLevel: "error" | "warn" | "info" | "debug";
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  editor: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14,
    lineHeight: 1.6,
    spellCheckLanguage: "en-US",
    autoSaveDelay: 2500,
    crashRecovery: true,
  },
  appearance: {
    theme: "system",
    previewBg: "#5a5a5a",
  },
  preview: {
    defaultZoom: "fit-width",
    viewMode: "two-column",
    // Keep in sync with the renderer's canonical DEFAULT_SETTINGS (contract.ts).
    paneMode: "view",
  },
  versionHistory: {
    autoSnapshot: true,
    autoSnapshotMinutes: 10,
    autoSync: true,      // transparent-sync plan §6: ON by default when canSync
    autoSyncMinutes: 2,  // ~2 min periodic safety cadence
  },
  gitIdentity: {
    authorName: "",
    authorEmail: "",
  },
  advanced: {
    fileWatcherInterval: 300,
    logLevel: "warn",
  },
};

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
    readFile(p: string, enc: string): Promise<string>;
    writeFile(p: string, data: string, enc: string): Promise<void>;
    mkdir(p: string, opts: unknown): Promise<unknown>;
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
    try {
      const stored = JSON.parse(
        await deps.fs.readFile(settingsPath(), "utf8"),
      ) as DeepPartialSettings;
      return mergeSettings(DEFAULT_SETTINGS, stored);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async function writeSettings(settings: AppSettings): Promise<void> {
    await deps.fs.mkdir(deps.getUserDataDir(), { recursive: true });
    await deps.fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  }

  return { readSettings, writeSettings, settingsPath };
}
