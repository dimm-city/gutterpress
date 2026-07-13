/**
 * Unit tests for the `settings-store` host module (Phase 5b extraction from
 * electron/main.ts). Covers the pure `mergeSettings` deep-merge and the
 * injected-fs store factory `createSettingsStore` (read/write + settingsPath).
 *
 * #29: `AppSettings`/`DEFAULT_SETTINGS` are imported from the shared module
 * (`./bridge-types` → `src/lib/platform/shared-types.ts`) instead of being
 * hand-duplicated here — this file re-imports them from `../../electron/
 * settings-store` (which re-exports them) so a regression that reintroduces
 * a local copy still shows up as a type/value mismatch here.
 *
 * #34: writes are atomic (`<file>.tmp` then `rename`) and a JSON-parse
 * failure preserves the corrupt file as `<file>.corrupt-<ts>` instead of
 * silently falling back to defaults with no trace of what was lost.
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
interface RenameCall {
  from: string;
  to: string;
}

function makeStore(opts: {
  userDataDir?: string;
  readFileImpl?: (p: string, enc: string) => Promise<string>;
  renameImpl?: (from: string, to: string) => Promise<void>;
} = {}) {
  const userDataDir = opts.userDataDir ?? "/userdata";
  const writes: WriteCall[] = [];
  const mkdirs: MkdirCall[] = [];
  const renames: RenameCall[] = [];

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
      rename: opts.renameImpl
        ? opts.renameImpl
        : async (from: string, to: string) => {
            renames.push({ from, to });
          },
    },
  };

  return { store: createSettingsStore(deps), writes, mkdirs, renames, userDataDir };
}

test("settingsPath joins userDataDir with app-settings.json", () => {
  const { store, userDataDir } = makeStore();
  expect(store.settingsPath()).toBe(path.join(userDataDir, "app-settings.json"));
});

test("readSettings returns DEFAULT_SETTINGS when the file is missing (readFile rejects)", async () => {
  const { store, renames } = makeStore({
    readFileImpl: async () => {
      throw new Error("ENOENT: no such file");
    },
  });
  const s = await store.readSettings();
  expect(s).toEqual(DEFAULT_SETTINGS);
  // Missing file is normal (first run) — nothing to preserve.
  expect(renames).toHaveLength(0);
});

test("readSettings preserves a corrupt file as <path>.corrupt-<ts> instead of silently discarding it", async () => {
  const { store, renames } = makeStore({
    readFileImpl: async () => "{ not valid json ]",
  });
  const s = await store.readSettings();
  expect(s).toEqual(DEFAULT_SETTINGS);
  expect(renames).toHaveLength(1);
  expect(renames[0]!.from).toBe(store.settingsPath());
  expect(renames[0]!.to).toMatch(
    new RegExp(`^${store.settingsPath().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.corrupt-\\d+$`),
  );
});

test("readSettings still returns DEFAULT_SETTINGS when the preserve-rename itself fails", async () => {
  const { store } = makeStore({
    readFileImpl: async () => "{ not valid json ]",
    renameImpl: async () => {
      throw new Error("EACCES: cannot rename");
    },
  });
  expect(await store.readSettings()).toEqual(DEFAULT_SETTINGS);
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

test("writeSettings mkdirs the userDataDir, writes pretty JSON to <settingsPath>.tmp, then renames over settingsPath", async () => {
  const { store, writes, mkdirs, renames, userDataDir } = makeStore();
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    editor: { ...DEFAULT_SETTINGS.editor, fontSize: 18 },
  };

  await store.writeSettings(settings);

  // mkdir(userDataDir, { recursive: true }) fired first.
  expect(mkdirs).toHaveLength(1);
  expect(mkdirs[0]!.path).toBe(userDataDir);
  expect(mkdirs[0]!.opts).toEqual({ recursive: true });

  // writeFile(settingsPath + ".tmp", JSON.stringify(settings, null, 2), "utf8").
  expect(writes).toHaveLength(1);
  expect(writes[0]!.path).toBe(`${store.settingsPath()}.tmp`);
  expect(writes[0]!.data).toBe(JSON.stringify(settings, null, 2));
  expect(writes[0]!.enc).toBe("utf8");

  // rename(settingsPath + ".tmp", settingsPath).
  expect(renames).toHaveLength(1);
  expect(renames[0]!.from).toBe(`${store.settingsPath()}.tmp`);
  expect(renames[0]!.to).toBe(store.settingsPath());
});

// ── write serialization (code-review finding: concurrent writers) ──────────
// Two writers share app-settings.json (the main-process open flow and the
// app/* settings routes). Without serialization they race on the shared
// `<file>.tmp` path — the second writeFile truncates the tmp the first is
// mid-rename on — and the last full-object writer silently reverts the other.
// writeSettings serializes on one chain, exactly like prefs-store.

test("writeSettings serializes overlapping writers (no interleaved tmp writes)", async () => {
  const order: string[] = [];
  let releaseFirstWrite: (() => void) | undefined;
  const firstWriteGate = new Promise<void>((r) => (releaseFirstWrite = r));
  let signalFirstWriteStarted: (() => void) | undefined;
  const firstWriteStarted = new Promise<void>((r) => (signalFirstWriteStarted = r));
  let writeCount = 0;

  const deps: SettingsStoreDeps = {
    getUserDataDir: () => "/userdata",
    fs: {
      readFile: async () => {
        throw new Error("ENOENT");
      },
      writeFile: async (_p: string, data: string) => {
        const which = (JSON.parse(data) as AppSettings).editor.fontSize;
        order.push(`write:${which}`);
        // Hold the FIRST write open so the second writer, if unserialized,
        // would push its own write before the first's rename.
        if (++writeCount === 1) {
          signalFirstWriteStarted!();
          await firstWriteGate;
        }
      },
      mkdir: async () => undefined,
      rename: async () => {
        order.push("rename");
      },
    },
  };
  const store = createSettingsStore(deps);

  const a: AppSettings = { ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, fontSize: 1 } };
  const b: AppSettings = { ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, fontSize: 2 } };

  const p1 = store.writeSettings(a);
  const p2 = store.writeSettings(b);
  // Wait until the first write is genuinely in flight (past its mkdir), then
  // assert the second writer has NOT started while the first is still open.
  await firstWriteStarted;
  expect(order).toEqual(["write:1"]);
  releaseFirstWrite!();
  await Promise.all([p1, p2]);

  // First write→rename fully completes before the second write begins.
  expect(order).toEqual(["write:1", "rename", "write:2", "rename"]);
});
