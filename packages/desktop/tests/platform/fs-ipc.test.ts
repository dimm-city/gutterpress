/**
 * IPC-handler contract for `electron/api/fs.ts` (SFE-P5c1 — migrated off
 * `src/routes/api/fs/{read-file,write-file,stat-file,list-dir,
 * list-project-files,create-file,create-folder,rename,delete}/+server.ts`).
 *
 * Combines the former `fs-crud-routes.test.ts` (create-file/create-folder/
 * rename/delete) and the fs-specific cases of `fs-routes-scoping.test.ts`
 * (read-file/write-file/list-dir/list-project-files, project-scoping,
 * symlink escapes) — both deleted, their route-level coverage ported here
 * calling the IPC handler functions directly. `fs/copy-file` is NOT ported:
 * it had zero callers (no `api.fs.*` wrapper ever existed for it) — see the
 * run report's "dead route" note; `electron/api/fs.ts` does not implement it.
 *
 * ARCH review #37's project-scoping guard (inside the open project allowed;
 * a sibling directory with a shared string prefix rejected; symlink escapes
 * rejected via the canonicalizing containment check) is exercised exactly as
 * the deleted route tests exercised it — `requireWithinProjectRoot` moved
 * verbatim into `electron/api/validation.ts` (see that file's header).
 *
 * Error semantics: IPC has no HTTP status code, so every assertion here
 * checks the REJECTED promise's message — the same text the deleted routes
 * used to send as the response body (`api.ts`'s `post()` already discarded
 * the status and kept only that text, so no caller ever branched on status).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, stat, symlink } from "node:fs/promises";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";
import { makeHostServices, type HostServicesOverrides } from "../support/host-services-fake";
import {
  fsReadFile,
  fsWriteFile,
  fsStatFile,
  fsListDir,
  fsListProjectFiles,
  fsCreateFile,
  fsCreateFolder,
  fsRename,
  fsDeletePath,
} from "../../electron/api/fs";
import * as gutterpress from "gutterpress";

async function caught(p: Promise<unknown>): Promise<{ message: string }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
  }
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

const canSymlink = (() => {
  const base = mkdtempSync(path.join(tmpdir(), "gutterpress-fs-ipc-symlink-probe-"));
  try {
    const target = path.join(base, "target");
    mkdirSync(target);
    symlinkSync(target, path.join(base, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
})();

// ── read/write/stat/list-dir/list-project-files scoping ────────────────────

describe("fs:readFile/writeFile/statFile/listDir/listProjectFiles scoping", () => {

let projectDir: string;
let siblingDir: string;
let outsideDir: string;
let recoveryDir: string;
let aliasPath: string;
let savedHostServices: HostServices | null;

async function createAlias(): Promise<string> {
  await symlink(outsideDir, aliasPath, "dir");
  return aliasPath;
}

beforeEach(async () => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file (and never depends on leftover
  // state from one that ran before it).
  savedHostServices = getHostServices();

  const base = await mkdtemp(path.join(tmpdir(), "gutterpress-fs-ipc-"));
  projectDir = path.join(base, "proj");
  siblingDir = path.join(base, "proj2");
  outsideDir = path.join(base, "elsewhere");
  recoveryDir = path.join(base, "recovery");
  aliasPath = path.join(projectDir, "alias");
  await mkdir(projectDir, { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await writeFile(path.join(projectDir, "chapter-01.md"), "# In project", "utf8");
  await writeFile(path.join(siblingDir, "secret.md"), "# Sibling project", "utf8");
  await writeFile(path.join(outsideDir, "secret.txt"), "outside content", "utf8");
  await writeFile(path.join(recoveryDir, "snap.md"), "# Recovered", "utf8");

  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [recoveryDir] },
    }),
  );
});

afterEach(async () => {
  await rm(path.dirname(projectDir), { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

test("fs:readFile: a path inside the open project is allowed", async () => {
  expect(await fsReadFile(path.join(projectDir, "chapter-01.md"))).toBe("# In project");
});

test("fs:readFile: a sibling dir with a shared string prefix is rejected", async () => {
  const { message } = await caught(fsReadFile(path.join(siblingDir, "secret.md")));
  expect(message).toBe("fs:readFile: path is outside the open project");
});

test("fs:readFile: an unrelated outside path is rejected", async () => {
  const { message } = await caught(fsReadFile(path.join(outsideDir, "secret.txt")));
  expect(message).toBe("fs:readFile: path is outside the open project");
});

test("fs:readFile: the crash-recovery sidecar dir is a PINNED exemption", async () => {
  expect(await fsReadFile(path.join(recoveryDir, "snap.md"))).toBe("# Recovered");
});

test("fs:writeFile: a path inside the open project is allowed", async () => {
  const target = path.join(projectDir, "new-chapter.md");
  await fsWriteFile(target, "# New");
  expect(await readFile(target, "utf8")).toBe("# New");
});

test("fs:writeFile: notifies the active preview after the write is settled", async () => {
  const target = path.join(projectDir, "saved-chapter.md");
  const notifications: Array<{ path: string; content: string }> = [];
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [recoveryDir] },
      write: {
        notifyPreviewSettledWrite: (writtenPath: string, content: string) => {
          notifications.push({ path: writtenPath, content });
        },
      },
    }),
  );
  await fsWriteFile(target, "# Saved now");
  expect(await readFile(target, "utf8")).toBe("# Saved now");
  expect(notifications).toEqual([{ path: target, content: "# Saved now" }]);
});

test("fs:writeFile: a sibling dir with a shared string prefix is rejected, file untouched", async () => {
  const target = path.join(siblingDir, "overwrite.md");
  const { message } = await caught(fsWriteFile(target, "pwned"));
  expect(message).toBe("fs:writeFile: path is outside the open project");
  await expect(readFile(target, "utf8")).rejects.toThrow();
});

test("fs:writeFile: the crash-recovery dir is NOT a write exemption", async () => {
  const { message } = await caught(fsWriteFile(path.join(recoveryDir, "snap.md"), "pwned"));
  expect(message).toBe("fs:writeFile: path is outside the open project");
});

test("fs:listDir: the open project dir is allowed", async () => {
  const entries = await fsListDir(projectDir);
  expect(entries.map((e) => e.name)).toEqual(["chapter-01.md"]);
});

test("fs:listDir: a sibling dir with a shared string prefix is rejected", async () => {
  const { message } = await caught(fsListDir(siblingDir));
  expect(message).toBe("fs:listDir: path is outside the open project");
});

test("fs:statFile: a path inside the open project is allowed", async () => {
  const s = await fsStatFile(path.join(projectDir, "chapter-01.md"));
  expect(s.exists).toBe(true);
});

test("fs:statFile: an outside path is rejected", async () => {
  const { message } = await caught(fsStatFile(path.join(outsideDir, "secret.txt")));
  expect(message).toBe("fs:statFile: path is outside the open project");
});

test("fs:listProjectFiles: an in-project dir is allowed", async () => {
  expect(await fsListProjectFiles(projectDir)).toEqual({ md: ["chapter-01.md"], css: [] });
});

test("fs:listProjectFiles: a directory outside the open project is rejected", async () => {
  const { message } = await caught(fsListProjectFiles(outsideDir));
  expect(message).toBe("fs:listProjectFiles: path is outside the open project");
});

test("fs:listProjectFiles: a sibling-prefix dir is rejected", async () => {
  const { message } = await caught(fsListProjectFiles(siblingDir));
  expect(message).toBe("fs:listProjectFiles: path is outside the open project");
});

test("fs:readFile: fails closed when no project is open (empty projectRoots)", async () => {
  registerHostServices(makeHostServices({ fsGuard: { projectRoots: () => [], readOnlyRoots: () => [] } }));
  const { message } = await caught(fsReadFile(path.join(projectDir, "chapter-01.md")));
  expect(message).toBe("fs:readFile: path is outside the open project");
});

// ── symlink escape (P1 review on isWithinRoot) ──────────────────────────────

test.skipIf(!canSymlink)(
  "fs:readFile: reading through a project-local symlink aliasing an outside dir is rejected",
  async () => {
    await createAlias();
    const { message } = await caught(fsReadFile(path.join(aliasPath, "secret.txt")));
    expect(message).toBe("fs:readFile: path is outside the open project");
  },
);

test.skipIf(!canSymlink)(
  "fs:listDir: listing through a project-local symlink aliasing an outside dir is rejected",
  async () => {
    await createAlias();
    const { message } = await caught(fsListDir(aliasPath));
    expect(message).toBe("fs:listDir: path is outside the open project");
  },
);

test.skipIf(!canSymlink)(
  "fs:writeFile: writing through a project-local symlink aliasing an outside dir is rejected, nothing lands in outsideDir",
  async () => {
    await createAlias();
    const target = path.join(aliasPath, "pwned.txt");
    const { message } = await caught(fsWriteFile(target, "pwned"));
    expect(message).toBe("fs:writeFile: path is outside the open project");
    await expect(readFile(path.join(outsideDir, "pwned.txt"), "utf8")).rejects.toThrow();
  },
);

test.skipIf(!canSymlink)(
  "fs:writeFile: writing through a project-local DANGLING symlink (target leaf absent) is rejected, nothing lands outside",
  async () => {
    const danglingTarget = path.join(outsideDir, "planted.txt");
    const evilLink = path.join(projectDir, "evil");
    await symlink(danglingTarget, evilLink, "file");
    const { message } = await caught(fsWriteFile(evilLink, "PWNED"));
    expect(message).toBe("fs:writeFile: path is outside the open project");
    await expect(readFile(danglingTarget, "utf8")).rejects.toThrow();
  },
);

}); // end describe: read/write/stat/list-dir/list-project-files scoping

// ── create/rename/delete CRUD (UX review M9) ────────────────────────────────

describe("fs:createFile/createFolder/rename/delete CRUD", () => {

let crudProjectDir: string;
let crudSiblingDir: string;
let crudOutsideDir: string;
let savedCrudHostServices: HostServices | null;

function baseServices(overrides: HostServicesOverrides = {}): HostServices {
  return makeHostServices({
    desktop: { getUserDataPath: () => tmpdir() },
    fsGuard: { projectRoots: () => [crudProjectDir], readOnlyRoots: () => [] },
    vcs: {
      loadLib: async () => ({
        detectProjectSource: async () => ({ type: "local-folder" }),
        capabilitiesFor: () => ({ canSnapshot: false }),
        providerFor: () => ({ snapshot: async () => ({ id: "fake", message: "", timestamp: 0 }) }),
        isNoChangesError: () => false,
      }),
    },
    ...overrides,
  });
}

beforeEach(async () => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file (and never depends on leftover
  // state from one that ran before it).
  savedCrudHostServices = getHostServices();

  const base = await mkdtemp(path.join(tmpdir(), "gutterpress-fs-ipc-crud-"));
  crudProjectDir = path.join(base, "proj");
  crudSiblingDir = path.join(base, "proj2");
  crudOutsideDir = path.join(base, "elsewhere");
  await mkdir(crudProjectDir, { recursive: true });
  await mkdir(crudSiblingDir, { recursive: true });
  await mkdir(crudOutsideDir, { recursive: true });
  await writeFile(path.join(crudProjectDir, "chapter-01.md"), "# One", "utf8");
  registerHostServices(baseServices());
});

test("fs:createFile: creates a new file inside the open project", async () => {
  const result = await fsCreateFile(crudProjectDir, "chapter-02.md", "# Two");
  expect(result.path).toBe(path.join(crudProjectDir, "chapter-02.md"));
  expect(await readFile(result.path, "utf8")).toBe("# Two");
});

test("fs:createFile: a sibling dir with a shared string prefix is rejected", async () => {
  const { message } = await caught(fsCreateFile(crudSiblingDir, "pwned.md", "x"));
  expect(message).toBe("fs:createFile: path is outside the open project");
  expect(await exists(path.join(crudSiblingDir, "pwned.md"))).toBe(false);
});

test("fs:createFile: an outside dir is rejected", async () => {
  const { message } = await caught(fsCreateFile(crudOutsideDir, "pwned.md", "x"));
  expect(message).toBe("fs:createFile: path is outside the open project");
});

test("fs:createFile: a name containing a path separator is rejected, no traversal", async () => {
  const { message } = await caught(fsCreateFile(crudProjectDir, "../escape.md", "x"));
  expect(message).toBe("fs:createFile name must be a single name, not a path");
  expect(await exists(path.join(path.dirname(crudProjectDir), "escape.md"))).toBe(false);
});

test("fs:createFile: an existing file is rejected, original content untouched", async () => {
  const target = path.join(crudProjectDir, "chapter-01.md");
  const { message } = await caught(fsCreateFile(crudProjectDir, "chapter-01.md", "overwritten"));
  expect(message).toBe('"chapter-01.md" already exists here.');
  expect(await readFile(target, "utf8")).toBe("# One");
});

test("fs:createFolder: creates a new folder inside the open project", async () => {
  const result = await fsCreateFolder(crudProjectDir, "assets");
  expect(result.path).toBe(path.join(crudProjectDir, "assets"));
  expect((await stat(result.path)).isDirectory()).toBe(true);
});

test("fs:createFolder: an existing name is rejected", async () => {
  await mkdir(path.join(crudProjectDir, "assets"));
  const { message } = await caught(fsCreateFolder(crudProjectDir, "assets"));
  expect(message).toBe('"assets" already exists here.');
});

test("fs:createFolder: outside the project is rejected", async () => {
  const { message } = await caught(fsCreateFolder(crudOutsideDir, "assets"));
  expect(message).toBe("fs:createFolder: path is outside the open project");
});

test("fs:rename: renames a file within the same directory", async () => {
  const from = path.join(crudProjectDir, "chapter-01.md");
  const result = await fsRename(from, "intro.md");
  expect(result.path).toBe(path.join(crudProjectDir, "intro.md"));
  expect(await exists(from)).toBe(false);
  expect(await readFile(result.path, "utf8")).toBe("# One");
});

test("fs:rename: a destination collision is rejected, nothing renamed", async () => {
  await writeFile(path.join(crudProjectDir, "intro.md"), "# Existing", "utf8");
  const from = path.join(crudProjectDir, "chapter-01.md");
  const { message } = await caught(fsRename(from, "intro.md"));
  expect(message).toBe('"intro.md" already exists here.');
  expect(await exists(from)).toBe(true);
  expect(await readFile(path.join(crudProjectDir, "intro.md"), "utf8")).toBe("# Existing");
});

test("fs:rename: a path outside the project is rejected", async () => {
  const outsideFile = path.join(crudOutsideDir, "secret.md");
  await writeFile(outsideFile, "secret", "utf8");
  const { message } = await caught(fsRename(outsideFile, "renamed.md"));
  expect(message).toBe("fs:rename: path is outside the open project");
});

test("fs:rename: renaming to the same name is a no-op", async () => {
  const from = path.join(crudProjectDir, "chapter-01.md");
  await fsRename(from, "chapter-01.md");
  expect(await readFile(from, "utf8")).toBe("# One");
});

test("fs:delete: deletes a file inside the open project (local-folder: no version history, no snapshot)", async () => {
  const target = path.join(crudProjectDir, "chapter-01.md");
  await fsDeletePath(target, crudProjectDir);
  expect(await exists(target)).toBe(false);
});

test("fs:delete: deletes a folder recursively", async () => {
  const dir = path.join(crudProjectDir, "assets");
  await mkdir(dir);
  await writeFile(path.join(dir, "img.png"), "x", "utf8");
  await fsDeletePath(dir, crudProjectDir);
  expect(await exists(dir)).toBe(false);
});

test("fs:delete: a sibling dir with a shared string prefix is rejected", async () => {
  const target = path.join(crudSiblingDir, "secret.md");
  await writeFile(target, "x", "utf8");
  const { message } = await caught(fsDeletePath(target, crudProjectDir));
  expect(message).toBe("fs:delete: path is outside the open project");
  expect(await exists(target)).toBe(true);
});

test("fs:delete: an outside path is rejected", async () => {
  const target = path.join(crudOutsideDir, "secret.md");
  await writeFile(target, "x", "utf8");
  const { message } = await caught(fsDeletePath(target, crudProjectDir));
  expect(message).toBe("fs:delete: path is outside the open project");
  expect(await exists(target)).toBe(true);
});

test("fs:delete: cannot delete the project root itself", async () => {
  const { message } = await caught(fsDeletePath(crudProjectDir, crudProjectDir));
  expect(message).toBe("fs:delete cannot delete the project root");
  expect(await exists(crudProjectDir)).toBe(true);
});

// ── fs:delete's own hooks-unavailable path (checked BEFORE validation,
// matching the deleted route's `defineRoute({ hooks, validate, call })` order,
// same fail-closed discipline as vcs:saveSnapshot's own test) ──

test("fs:delete: rejects with 'VCS hooks not registered' and deletes nothing when hooks are absent", async () => {
  registerHostServices(baseServices({ vcs: undefined }));
  const target = path.join(crudProjectDir, "chapter-01.md");
  const { message } = await caught(fsDeletePath(target, crudProjectDir));
  expect(message).toBe("VCS hooks not registered");
  expect(await exists(target)).toBe(true);
});

test("fs:delete: with version history, snapshots the working tree BEFORE deleting", async () => {
  const snapshotCalls: Array<{ projectDir: string; message: string }> = [];
  registerHostServices(
    baseServices({
      vcs: {
        loadLib: async () => ({
          detectProjectSource: async () => ({ type: "local-git-folder" }),
          capabilitiesFor: () => ({ canSnapshot: true }),
          repoRootForSource: (s: { type?: string; repoRoot?: string }, d: string) =>
            s?.type === "local-git-folder" ? s.repoRoot || d : d,
          providerFor: () => ({
            snapshot: async (opts: { projectDir: string; message: string }) => {
              snapshotCalls.push({ projectDir: opts.projectDir, message: opts.message });
              expect(await exists(path.join(crudProjectDir, "chapter-01.md"))).toBe(true);
              return { id: "abc123", message: opts.message, timestamp: 0 };
            },
          }),
          isNoChangesError: () => false,
        }),
        operationLogPath: () => "/fake/log",
      },
    }),
  );
  const target = path.join(crudProjectDir, "chapter-01.md");
  await fsDeletePath(target, crudProjectDir);
  expect(await exists(target)).toBe(false);
  expect(snapshotCalls).toHaveLength(1);
  expect(snapshotCalls[0]!.message).toBe("Before deleting chapter-01.md");
});

test("fs:delete: a real 'no changes since last snapshot' rejection is swallowed and the delete proceeds", async () => {
  registerHostServices(
    baseServices({
      vcs: {
        loadLib: async () => ({
          detectProjectSource: async () => ({ type: "local-git-folder" }),
          capabilitiesFor: () => ({ canSnapshot: true }),
          repoRootForSource: (s: { type?: string; repoRoot?: string }, d: string) =>
            s?.type === "local-git-folder" ? s.repoRoot || d : d,
          providerFor: () => ({
            snapshot: async () => {
              throw new Error("no changes since the last snapshot");
            },
          }),
          isNoChangesError: (e: unknown) => e instanceof Error && /no changes since the last snapshot/i.test(e.message),
        }),
        operationLogPath: () => "/fake/log",
      },
    }),
  );
  const target = path.join(crudProjectDir, "chapter-01.md");
  await fsDeletePath(target, crudProjectDir);
  expect(await exists(target)).toBe(false);
});

test("fs:delete: a REAL snapshot failure aborts the delete — nothing is deleted", async () => {
  registerHostServices(
    baseServices({
      vcs: {
        loadLib: async () => ({
          detectProjectSource: async () => ({ type: "local-git-folder" }),
          capabilitiesFor: () => ({ canSnapshot: true }),
          repoRootForSource: (s: { type?: string; repoRoot?: string }, d: string) =>
            s?.type === "local-git-folder" ? s.repoRoot || d : d,
          providerFor: () => ({
            snapshot: async () => {
              throw new Error("git object database is corrupt");
            },
          }),
          isNoChangesError: () => false,
        }),
        operationLogPath: () => "/fake/log",
      },
    }),
  );
  const target = path.join(crudProjectDir, "chapter-01.md");
  const { message } = await caught(fsDeletePath(target, crudProjectDir));
  expect(message).toContain("Could not save a safety snapshot");
  expect(await exists(target)).toBe(true);
});

test("fs:delete: end-to-end against a REAL git repo — the deleted file's content is recoverable from history", async () => {
  await gutterpress.providerFor({ type: "local-folder", path: crudProjectDir }).initVersionHistory({
    projectDir: crudProjectDir,
    initialMessage: "Initial snapshot",
  });
  const gitSource = await gutterpress.detectProjectSource(crudProjectDir);
  expect(gitSource.type).toBe("local-git-folder");

  const target = path.join(crudProjectDir, "chapter-01.md");
  await writeFile(target, "# One (edited)", "utf8");

  registerHostServices(
    baseServices({
      vcs: {
        loadLib: async () => gutterpress as unknown as Record<string, unknown>,
        operationLogPath: () => "/fake/log",
      },
    }),
  );

  await fsDeletePath(target, crudProjectDir);
  expect(await exists(target)).toBe(false);

  const history = await gutterpress.providerFor(gitSource).listHistory(crudProjectDir);
  expect(history.length).toBe(2);
  expect(history[0]!.message).toBe("Before deleting chapter-01.md");

  await gutterpress.providerFor(gitSource).restore({ projectDir: crudProjectDir, id: history[0]!.id });
  expect(await readFile(target, "utf8")).toBe("# One (edited)");
});

afterEach(async () => {
  await rm(path.dirname(crudProjectDir), { recursive: true, force: true }).catch(() => {});
  registerHostServices(savedCrudHostServices as HostServices);
});

}); // end describe: create/rename/delete CRUD
