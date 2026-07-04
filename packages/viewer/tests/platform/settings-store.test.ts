/**
 * Unit tests for the `settings-store` host module (Phase 5b extraction from
 * electron/main.ts). Covers the pure `mergeSettings` deep-merge and the
 * injected-fs store factory `createSettingsStore` (read/write + settingsPath).
 *
 * These are RED before electron/settings-store.ts exists.
 */
import { expect, test } from "bun:test";
import path from "node:path";
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  mergeSettings,
  type AppSettings,
  type DeepPartialSettings,
  type SettingsStoreDeps,
} from "../../electron/settings-store";

// ── mergeSettings (pure) ──────────────────────────────────────────────────

test("mergeSettings patches one field in a section, preserving sibling fields", () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    editor: { fontSize: 22 },
  } as DeepPartialSettings);

  expect(merged.editor.fontSize).toBe(22);
  // Sibling fields in the same section survive.
  expect(merged.editor.lineHeight).toBe(DEFAULT_SETTINGS.editor.lineHeight);
  expect(merged.editor.fontFamily).toBe(DEFAULT_SETTINGS.editor.fontFamily);
  expect(merged.editor.autoSaveDelay).toBe(DEFAULT_SETTINGS.editor.autoSaveDelay);
});

test("mergeSettings leaves untouched sections intact", () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    versionHistory: { autoSyncMinutes: 5 },
  } as DeepPartialSettings);

  expect(merged.versionHistory.autoSyncMinutes).toBe(5);
  // A section not present in the patch is carried through unchanged.
  expect(merged.appearance).toEqual(DEFAULT_SETTINGS.appearance);
  expect(merged.editor).toEqual(DEFAULT_SETTINGS.editor);
});

test("mergeSettings ignores a section whose patch value is a non-object", () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    editor: 42,
  } as unknown as DeepPartialSettings);

  // A malformed (non-object) section patch is skipped entirely.
  expect(merged.editor).toEqual(DEFAULT_SETTINGS.editor);
});

test("mergeSettings does not mutate the base object", () => {
  const baseSnapshot = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    editor: { fontSize: 99 },
  } as DeepPartialSettings);

  expect(merged).not.toBe(DEFAULT_SETTINGS);
  // Base untouched.
  expect(DEFAULT_SETTINGS).toEqual(baseSnapshot);
  expect(DEFAULT_SETTINGS.editor.fontSize).toBe(baseSnapshot.editor.fontSize);
});

// ── createSettingsStore (injected fs + userDataDir) ───────────────────────

interface WriteCall {
  path: string;
  data: string;
  enc: string;
}
interface MkdirCall {
  path: string;
  opts: unknown;
}

function makeStore(opts: {
  userDataDir?: string;
  readFileImpl?: (p: string, enc: string) => Promise<string>;
} = {}) {
  const userDataDir = opts.userDataDir ?? "/userdata";
  const writes: WriteCall[] = [];
  const mkdirs: MkdirCall[] = [];

  const deps: SettingsStoreDeps = {
    getUserDataDir: () => userDataDir,
    fs: {
      readFile: opts.readFileImpl
        ? opts.readFileImpl
        : async () => {
            throw new Error("ENOENT");
          },
      writeFile: async (p: string, data: string, enc: string) => {
        writes.push({ path: p, data, enc });
      },
      mkdir: async (p: string, o: unknown) => {
        mkdirs.push({ path: p, opts: o });
        return undefined;
      },
    },
  };

  return { store: createSettingsStore(deps), writes, mkdirs, userDataDir };
}

test("settingsPath joins userDataDir with app-settings.json", () => {
  const { store, userDataDir } = makeStore();
  expect(store.settingsPath()).toBe(path.join(userDataDir, "app-settings.json"));
});

test("readSettings returns DEFAULT_SETTINGS when the file is missing (readFile rejects)", async () => {
  const { store } = makeStore({
    readFileImpl: async () => {
      throw new Error("ENOENT: no such file");
    },
  });
  const s = await store.readSettings();
  expect(s).toEqual(DEFAULT_SETTINGS);
});

test("readSettings returns DEFAULT_SETTINGS when stored JSON is invalid", async () => {
  const { store } = makeStore({
    readFileImpl: async () => "{ not valid json ]",
  });
  const s = await store.readSettings();
  expect(s).toEqual(DEFAULT_SETTINGS);
});

test("readSettings deep-merges a stored partial over DEFAULT_SETTINGS", async () => {
  const { store } = makeStore({
    readFileImpl: async () =>
      JSON.stringify({ versionHistory: { autoSyncMinutes: 5 } }),
  });
  const s = await store.readSettings();

  expect(s.versionHistory.autoSyncMinutes).toBe(5);
  // Other fields in the patched section keep their defaults.
  expect(s.versionHistory.autoSync).toBe(DEFAULT_SETTINGS.versionHistory.autoSync);
  expect(s.versionHistory.autoSnapshot).toBe(
    DEFAULT_SETTINGS.versionHistory.autoSnapshot,
  );
  // Untouched sections keep their defaults.
  expect(s.editor).toEqual(DEFAULT_SETTINGS.editor);
  expect(s.appearance).toEqual(DEFAULT_SETTINGS.appearance);
});

test("writeSettings mkdirs the userDataDir then writes pretty JSON to settingsPath", async () => {
  const { store, writes, mkdirs, userDataDir } = makeStore();
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    editor: { ...DEFAULT_SETTINGS.editor, fontSize: 18 },
  };

  await store.writeSettings(settings);

  // mkdir(userDataDir, { recursive: true }) fired first.
  expect(mkdirs).toHaveLength(1);
  expect(mkdirs[0]!.path).toBe(userDataDir);
  expect(mkdirs[0]!.opts).toEqual({ recursive: true });

  // writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8").
  expect(writes).toHaveLength(1);
  expect(writes[0]!.path).toBe(store.settingsPath());
  expect(writes[0]!.data).toBe(JSON.stringify(settings, null, 2));
  expect(writes[0]!.enc).toBe("utf8");
});
