/**
 * Unit tests for the `prefs-store` host module (Phase 5b extraction from
 * electron/main.ts). Covers the injected-fs store factory `createPrefsStore`:
 * readPrefs (missing/invalid file, legacy projectStates migration), writePrefs
 * (mkdir + pretty JSON), prefsPath, and existingDirectory.
 *
 * These are RED before electron/prefs-store.ts exists.
 */
import { expect, test } from "bun:test";
import path from "node:path";
import {
  createPrefsStore,
  type PrefsStoreDeps,
  type ViewerPrefs,
} from "../../electron/prefs-store";
import type { ProjectStateMap } from "../../electron/project-state";

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
interface StatResult {
  isDirectory(): boolean;
}

function makeStore(opts: {
  userDataDir?: string;
  readFileImpl?: (p: string, enc: string) => Promise<string>;
  statImpl?: (p: string) => Promise<StatResult>;
  migrate?: (prefs: ViewerPrefs) => ProjectStateMap | null;
} = {}) {
  const userDataDir = opts.userDataDir ?? "/userdata";
  const writes: WriteCall[] = [];
  const mkdirs: MkdirCall[] = [];
  const migrateCalls: ViewerPrefs[] = [];

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
    },
    migrateLegacyProjectState: (prefs: ViewerPrefs) => {
      migrateCalls.push(prefs);
      return opts.migrate ? opts.migrate(prefs) : null;
    },
  };

  return {
    store: createPrefsStore(deps),
    writes,
    mkdirs,
    migrateCalls,
    userDataDir,
  };
}

const SAMPLE_MAP: ProjectStateMap = {
  "/book": { currentPage: 3, viewMode: "single" },
} as unknown as ProjectStateMap;

// ── prefsPath ─────────────────────────────────────────────────────────────

test("prefsPath joins userDataDir with viewer-prefs.json", () => {
  const { store, userDataDir } = makeStore();
  expect(store.prefsPath()).toBe(path.join(userDataDir, "viewer-prefs.json"));
});

// ── readPrefs ─────────────────────────────────────────────────────────────

test("(a) readPrefs returns {} when readFile rejects (missing file)", async () => {
  const { store } = makeStore({
    readFileImpl: async () => {
      throw new Error("ENOENT: no such file");
    },
  });
  expect(await store.readPrefs()).toEqual({});
});

test("(b) readPrefs returns {} when stored JSON is invalid", async () => {
  const { store } = makeStore({
    readFileImpl: async () => "{ not valid json ]",
  });
  expect(await store.readPrefs()).toEqual({});
});

test("(c) readPrefs seeds projectStates from migrate() when stored prefs have none", async () => {
  const { store, migrateCalls } = makeStore({
    readFileImpl: async () => JSON.stringify({ lastProjectDir: "/book" }),
    migrate: () => SAMPLE_MAP,
  });
  const prefs = await store.readPrefs();
  expect(prefs.projectStates).toEqual(SAMPLE_MAP);
  // migrate was consulted with the parsed prefs.
  expect(migrateCalls).toHaveLength(1);
  expect(migrateCalls[0]!.lastProjectDir).toBe("/book");
});

test("(d) readPrefs does NOT overwrite an existing projectStates even if migrate() returns a map", async () => {
  const existing: ProjectStateMap = {
    "/other": { currentPage: 9, viewMode: "two-column" },
  } as unknown as ProjectStateMap;
  const { store } = makeStore({
    readFileImpl: async () =>
      JSON.stringify({ lastProjectDir: "/book", projectStates: existing }),
    migrate: () => SAMPLE_MAP,
  });
  const prefs = await store.readPrefs();
  expect(prefs.projectStates).toEqual(existing);
});

test("readPrefs leaves projectStates undefined when migrate() returns null", async () => {
  const { store } = makeStore({
    readFileImpl: async () => JSON.stringify({ sidebarOpen: true }),
    migrate: () => null,
  });
  const prefs = await store.readPrefs();
  expect(prefs.projectStates).toBeUndefined();
  expect(prefs.sidebarOpen).toBe(true);
});

// ── writePrefs ────────────────────────────────────────────────────────────

test("(e) writePrefs mkdirs the userDataDir then writes pretty (2-space) JSON to prefsPath", async () => {
  const { store, writes, mkdirs, userDataDir } = makeStore();
  const prefs: ViewerPrefs = { lastProjectDir: "/book", sidebarOpen: true };

  await store.writePrefs(prefs);

  expect(mkdirs).toHaveLength(1);
  expect(mkdirs[0]!.path).toBe(userDataDir);
  expect(mkdirs[0]!.opts).toEqual({ recursive: true });

  expect(writes).toHaveLength(1);
  expect(writes[0]!.path).toBe(store.prefsPath());
  expect(writes[0]!.data).toBe(JSON.stringify(prefs, null, 2));
  expect(writes[0]!.enc).toBe("utf8");
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
