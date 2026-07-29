/**
 * Unit tests for the `prefs-store` host module (Phase 5b extraction from
 * electron/main.ts). Covers the injected-fs store factory `createPrefsStore`:
 * readPrefs (missing/corrupt file), writePrefs (atomic tmp+rename write),
 * prefsPath, and existingDirectory.
 *
 * #34: writes are atomic (`<file>.tmp` then `rename`) and a JSON-parse
 * failure preserves the corrupt file as `<file>.corrupt-<ts>` instead of
 * silently resetting to `{}` — the old behavior that discarded recents,
 * favorites, and per-project state on any truncated/corrupted write.
 *
 * #30: the legacy top-level `currentPage`/`viewMode` migration fallback
 * (`migrateLegacyProjectState`) is deleted — `DesktopPrefs` no longer has
 * those fields, so there is nothing left to migrate.
 */
import { expect, test } from "bun:test";
import path from "node:path";
import {
  createPrefsStore,
  type PrefsStoreDeps,
  type DesktopPrefs,
} from "../../electron/prefs-store";

// ── Fake fs + userDataDir harness ─────────────────────────────────────────

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
interface StatResult {
  isDirectory(): boolean;
}

function makeStore(opts: {
  userDataDir?: string;
  readFileImpl?: (p: string, enc: string) => Promise<string>;
  statImpl?: (p: string) => Promise<StatResult>;
  renameImpl?: (from: string, to: string) => Promise<void>;
} = {}) {
  const userDataDir = opts.userDataDir ?? "/userdata";
  const writes: WriteCall[] = [];
  const mkdirs: MkdirCall[] = [];
  const renames: RenameCall[] = [];

  const deps: PrefsStoreDeps = {
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
      stat: opts.statImpl
        ? opts.statImpl
        : async () => {
            throw new Error("ENOENT");
          },
      rename: opts.renameImpl
        ? opts.renameImpl
        : async (from: string, to: string) => {
            renames.push({ from, to });
          },
    },
  };

  return {
    store: createPrefsStore(deps),
    writes,
    mkdirs,
    renames,
    userDataDir,
  };
}

// ── prefsPath ─────────────────────────────────────────────────────────────

test("prefsPath joins userDataDir with gutterpress-prefs.json", () => {
  const { store, userDataDir } = makeStore();
  expect(store.prefsPath()).toBe(path.join(userDataDir, "gutterpress-prefs.json"));
});

// ── readPrefs ─────────────────────────────────────────────────────────────

test("(a) readPrefs returns {} when readFile rejects (missing file, nothing preserved)", async () => {
  const { store, renames } = makeStore({
    readFileImpl: async () => {
      throw new Error("ENOENT: no such file");
    },
  });
  expect(await store.readPrefs()).toEqual({});
  // A missing file is normal (first run) — there's nothing to preserve.
  expect(renames).toHaveLength(0);
});

test("(b) readPrefs preserves a corrupt file as <path>.corrupt-<ts> instead of silently discarding it", async () => {
  const { store, renames } = makeStore({
    readFileImpl: async () => "{ not valid json ]",
  });
  const prefs = await store.readPrefs();
  expect(prefs).toEqual({});
  expect(renames).toHaveLength(1);
  expect(renames[0]!.from).toBe(store.prefsPath());
  expect(renames[0]!.to).toMatch(
    new RegExp(`^${store.prefsPath().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.corrupt-\\d+$`),
  );
});

test("(b2) readPrefs still returns {} even when the preserve-rename itself fails", async () => {
  const { store } = makeStore({
    readFileImpl: async () => "{ not valid json ]",
    renameImpl: async () => {
      throw new Error("EACCES: cannot rename");
    },
  });
  // Must not throw — a failed preservation attempt degrades to the old
  // "start fresh" behavior rather than crashing the read path.
  expect(await store.readPrefs()).toEqual({});
});

test("readPrefs round-trips valid stored JSON unchanged", async () => {
  const { store } = makeStore({
    readFileImpl: async () =>
      JSON.stringify({ lastProjectDir: "/book", sidebarOpen: true }),
  });
  expect(await store.readPrefs()).toEqual({
    lastProjectDir: "/book",
    sidebarOpen: true,
  });
});

// ── #30 migration: old-shape file → new shape, nothing lost ───────────────

test("(#30) an old-shape gutterpress-prefs.json (pre-migration top-level currentPage/viewMode) still round-trips recents/favorites/projectStates/lastProjectDir intact", async () => {
  // Shape a real pre-#43 file could have had: the deprecated top-level
  // `currentPage`/`viewMode` migration-fallback fields alongside the fields
  // that matter. `DesktopPrefs` no longer declares the legacy fields, but
  // reading an old file must never discard the data that DOES still map to
  // the current schema — that was the #34/#30 regression (a silent reset to
  // `{}` on anything unexpected).
  const legacyShapeFile = {
    // Deprecated, no longer part of DesktopPrefs — must not crash the read
    // and must not cause any other field to be dropped.
    currentPage: 42,
    viewMode: "two-column",
    // Fields that matter and must survive unchanged.
    lastProjectDir: "/users/book-one",
    recentFolders: [{ path: "/users/book-one", lastOpened: 1700000000000 }],
    favorites: [{ path: "/users/book-two", label: "Book Two" }],
    projectStates: {
      "/users/book-one": { currentPage: 12, viewMode: "single" },
    },
  };
  const { store, renames } = makeStore({
    readFileImpl: async () => JSON.stringify(legacyShapeFile),
  });

  const prefs = await store.readPrefs();

  // A structurally-valid (if outdated) file is not corrupt — it must be read
  // as-is, not preserved-and-reset.
  expect(renames).toHaveLength(0);
  expect(prefs.lastProjectDir).toBe("/users/book-one");
  expect(prefs.recentFolders).toEqual(legacyShapeFile.recentFolders);
  expect(prefs.favorites).toEqual(legacyShapeFile.favorites);
  expect(prefs.projectStates).toEqual(legacyShapeFile.projectStates);
});

// ── writePrefs (atomic tmp+rename) ─────────────────────────────────────────

test("(e) writePrefs mkdirs the userDataDir, writes pretty (2-space) JSON to <prefsPath>.tmp, then renames over prefsPath", async () => {
  const { store, writes, mkdirs, renames, userDataDir } = makeStore();
  const prefs: DesktopPrefs = { lastProjectDir: "/book", sidebarOpen: true };

  await store.writePrefs(prefs);

  expect(mkdirs).toHaveLength(1);
  expect(mkdirs[0]!.path).toBe(userDataDir);
  expect(mkdirs[0]!.opts).toEqual({ recursive: true });

  expect(writes).toHaveLength(1);
  expect(writes[0]!.path).toBe(`${store.prefsPath()}.tmp`);
  expect(writes[0]!.data).toBe(JSON.stringify(prefs, null, 2));
  expect(writes[0]!.enc).toBe("utf8");

  expect(renames).toHaveLength(1);
  expect(renames[0]!.from).toBe(`${store.prefsPath()}.tmp`);
  expect(renames[0]!.to).toBe(store.prefsPath());
});

// ── existingDirectory ─────────────────────────────────────────────────────

test("(f1) existingDirectory returns the dir when stat().isDirectory() is true", async () => {
  const { store } = makeStore({
    statImpl: async () => ({ isDirectory: () => true }),
  });
  expect(await store.existingDirectory("/book")).toBe("/book");
});

test("(f2) existingDirectory returns null when the path is a file (not a directory)", async () => {
  const { store } = makeStore({
    statImpl: async () => ({ isDirectory: () => false }),
  });
  expect(await store.existingDirectory("/book/file.md")).toBeNull();
});

test("(f3) existingDirectory returns null when stat rejects (missing path)", async () => {
  const { store } = makeStore({
    statImpl: async () => {
      throw new Error("ENOENT");
    },
  });
  expect(await store.existingDirectory("/nope")).toBeNull();
});

test("(f4) existingDirectory returns null when the argument is undefined (no stat call)", async () => {
  let statCalls = 0;
  const { store } = makeStore({
    statImpl: async () => {
      statCalls += 1;
      return { isDirectory: () => true };
    },
  });
  expect(await store.existingDirectory(undefined)).toBeNull();
  expect(statCalls).toBe(0);
});

// ── updatePrefs (atomic read-modify-write) ─────────────────────────────────

test("updatePrefs reads, mutates, and writes in one step, returning the result", async () => {
  const { store, writes } = makeStore({
    readFileImpl: async () => JSON.stringify({ lastProjectDir: "/old" }),
  });
  const next = await store.updatePrefs((prefs) => ({ ...prefs, sidebarOpen: true }));
  expect(next).toEqual({ lastProjectDir: "/old", sidebarOpen: true });
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]!.data)).toEqual({ lastProjectDir: "/old", sidebarOpen: true });
});

test("concurrent updatePrefs calls compose instead of clobbering (the start-screen-toggle vs api:preview race)", async () => {
  // Backing "file" that reflects the last write, with a slow first read so an
  // unserialized second RMW would read the PRE-update state and revert it.
  let fileContents = JSON.stringify({});
  let firstRead = true;
  const { store, writes } = makeStore({
    readFileImpl: async () => {
      if (firstRead) {
        firstRead = false;
        await new Promise((r) => setTimeout(r, 20));
      }
      return fileContents;
    },
  });
  // Keep the fake file in sync with writes (the .tmp write is what carries
  // the new content; the store's own rename is faked as a no-op above).
  const origPush = writes.push.bind(writes);
  writes.push = (...items) => {
    for (const w of items) fileContents = w.data;
    return origPush(...items);
  };

  await Promise.all([
    store.updatePrefs((prefs) => ({ ...prefs, lastProjectDir: "/book-a" })),
    store.updatePrefs((prefs) => ({ ...prefs, showLandingAtStartup: false })),
  ]);

  expect(writes).toHaveLength(2);
  // The second update must see the first one's write: both fields survive.
  expect(JSON.parse(writes[1]!.data)).toEqual({
    lastProjectDir: "/book-a",
    showLandingAtStartup: false,
  });
});

test("writePrefs shares the same queue as updatePrefs (no interleaved writes)", async () => {
  let fileContents = JSON.stringify({ seed: 1 });
  const { store, writes } = makeStore({ readFileImpl: async () => fileContents });
  const origPush = writes.push.bind(writes);
  writes.push = (...items) => {
    for (const w of items) fileContents = w.data;
    return origPush(...items);
  };
  await Promise.all([
    store.updatePrefs((prefs) => ({ ...prefs, sidebarOpen: true })),
    store.writePrefs({ lastProjectDir: "/direct" }),
  ]);
  // Queue order: the update lands first, then the direct write replaces it.
  expect(JSON.parse(writes[0]!.data)).toEqual({ seed: 1, sidebarOpen: true });
  expect(JSON.parse(writes[1]!.data)).toEqual({ lastProjectDir: "/direct" });
});
