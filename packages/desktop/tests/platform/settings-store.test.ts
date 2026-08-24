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

test("mergeSettings patches preview.splitRatio, preserving sibling preview fields (#103)", () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    preview: { splitRatio: 0.3 },
  } as DeepPartialSettings);

  expect(merged.preview.splitRatio).toBe(0.3);
  // Sibling preview fields survive the section-level spread.
  expect(merged.preview.mode).toBe(DEFAULT_SETTINGS.preview.mode);
  expect(merged.preview.paneMode).toBe(DEFAULT_SETTINGS.preview.paneMode);
  expect(merged.preview.defaultZoom).toBe(DEFAULT_SETTINGS.preview.defaultZoom);
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

test("mergeSettings ignores an ARRAY-valued section patch (audit A1 array guard)", () => {
  // The host copy used to lack the `!Array.isArray` guard, so an array-shaped
  // section patch spread into `{0:…,1:…}` and corrupted the section. The single
  // reconciled implementation ignores it, leaving the section untouched.
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    editor: [1, 2, 3],
  } as unknown as DeepPartialSettings);

  expect(merged.editor).toEqual(DEFAULT_SETTINGS.editor);
  expect(Array.isArray(merged.editor)).toBe(false);
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
            throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
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
      throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
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

test("readSettings migrates the old persisted 2500ms default once", async () => {
  const legacy = makeStore({
    readFileImpl: async () => JSON.stringify({ editor: { autoSaveDelay: 2500 } }),
  });
  expect((await legacy.store.readSettings()).editor.autoSaveDelay).toBe(500);

  const current = makeStore({
    readFileImpl: async () => JSON.stringify({
      settingsSchemaVersion: 2,
      editor: { autoSaveDelay: 2500 },
    }),
  });
  expect((await current.store.readSettings()).editor.autoSaveDelay).toBe(2500);
});

test("readSettings fills in preview.splitRatio default for a stored file missing it (#103)", async () => {
  const { store } = makeStore({
    readFileImpl: async () =>
      JSON.stringify({ preview: { mode: "editor" } }),
  });
  const s = await store.readSettings();

  // The stored partial's field is honoured…
  expect(s.preview.mode).toBe("editor");
  // …and the new field a pre-existing file never wrote picks up the default.
  expect(s.preview.splitRatio).toBe(DEFAULT_SETTINGS.preview.splitRatio);
});

test("readSettings defaults the update channel to stable for existing settings files", async () => {
  const { store } = makeStore({
    readFileImpl: async () => JSON.stringify({ appearance: { theme: "dark" } }),
  });

  expect((await store.readSettings()).updates.channel).toBe("stable");
});

test("readSettings migrates the legacy includePrereleases flag to a channel", async () => {
  // Pre-0.8.2 files stored a boolean opt-in; true maps to the beta channel.
  const optedIn = makeStore({
    readFileImpl: async () => JSON.stringify({ updates: { includePrereleases: true } }),
  });
  expect((await optedIn.store.readSettings()).updates.channel).toBe("beta");

  const optedOut = makeStore({
    readFileImpl: async () => JSON.stringify({ updates: { includePrereleases: false } }),
  });
  expect((await optedOut.store.readSettings()).updates.channel).toBe("stable");
});

test("readSettings prefers an explicit channel over a leftover legacy flag", async () => {
  const { store } = makeStore({
    readFileImpl: async () =>
      JSON.stringify({ updates: { channel: "alpha", includePrereleases: false } }),
  });

  expect((await store.readSettings()).updates.channel).toBe("alpha");
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

  // The schema marker makes the old-default migration one-time while keeping
  // a later explicit 2500ms choice intact.
  expect(writes).toHaveLength(1);
  expect(writes[0]!.path).toBe(`${store.settingsPath()}.tmp`);
  expect(JSON.parse(writes[0]!.data)).toEqual({ settingsSchemaVersion: 2, ...settings });
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

// ── updateSettings (atomic read-merge-write, audit A2) ────────────────────

test("updateSettings composes concurrent patches instead of dropping one", async () => {
  // Two patches to DIFFERENT fields fired back-to-back. A readSettings()+
  // writeSettings() pair would read the same on-disk snapshot twice and the
  // second write would revert the first patch. updateSettings runs read-merge-
  // write inside one queue slot, so both land.
  // Minimal atomic-write fs fake: writeFile stashes the tmp payload, rename
  // commits it to `stored` (mirroring the store's write-then-rename protocol).
  let stored = JSON.stringify(DEFAULT_SETTINGS);
  let tmpPayload = "";
  const deps: SettingsStoreDeps = {
    getUserDataDir: () => "/userdata",
    fs: {
      readFile: async () => stored,
      writeFile: async (p: string, data: string) => {
        if (p.endsWith(".tmp")) tmpPayload = data;
      },
      mkdir: async () => undefined,
      rename: async () => {
        stored = tmpPayload;
      },
    },
  };

  const store = createSettingsStore(deps);
  const [a, b] = await Promise.all([
    store.updateSettings({ editor: { fontSize: 21 } } as never),
    store.updateSettings({ preview: { splitRatio: 0.42 } } as never),
  ]);

  // Both patches survive in the final persisted object.
  const final = JSON.parse(stored) as AppSettings;
  expect(final.editor.fontSize).toBe(21);
  expect(final.preview.splitRatio).toBe(0.42);
  // The second update's return value reflects both merged patches.
  expect(b.editor.fontSize).toBe(21);
  expect(b.preview.splitRatio).toBe(0.42);
  // The first return value has its own patch (and not yet the second's, since
  // it committed first).
  expect(a.editor.fontSize).toBe(21);
});

// ── transient read errors must not wipe settings (audit G3 parity) ─────────
// Only ENOENT means "no file yet" (first run). Any OTHER read error (EACCES
// from an AV/backup tool holding the file, EIO, EMFILE) is transient: if
// readSettings returned DEFAULT_SETTINGS for it, updateSettings would merge
// the one-field patch over defaults and rename-write the result — silently
// wiping every other customized setting. Same standard as FileTokenStore.read.

test("updateSettings rejects WITHOUT writing when readFile fails with a non-ENOENT error", async () => {
  const { store, writes, renames } = makeStore({
    readFileImpl: async () => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    },
  });

  await expect(store.updateSettings({ editor: { fontSize: 22 } } as never)).rejects.toThrow(
    "EACCES",
  );
  // Nothing was persisted — no tmp write, no rename (neither atomic-commit
  // nor corrupt-preserve).
  expect(writes).toHaveLength(0);
  expect(renames).toHaveLength(0);
});

test("readSettings rethrows a non-ENOENT read error instead of masking it as defaults", async () => {
  const { store } = makeStore({
    readFileImpl: async () => {
      throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
    },
  });
  await expect(store.readSettings()).rejects.toThrow("EIO");
});

test("first-run updateSettings (ENOENT) still writes defaults merged with the patch", async () => {
  // ENOENT is the legitimate no-file-yet case — updateSettings must keep
  // working: defaults + patch, written atomically.
  const { store, writes, renames } = makeStore();

  const next = await store.updateSettings({ editor: { fontSize: 22 } } as never);

  expect(next.editor.fontSize).toBe(22);
  expect(next.preview).toEqual(DEFAULT_SETTINGS.preview);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]!.data)).toEqual({ settingsSchemaVersion: 2, ...next });
  expect(renames).toHaveLength(1);
  expect(renames[0]!.to).toBe(store.settingsPath());
});
