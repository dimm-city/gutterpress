import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import * as printMd from "@dimm-city/print-md";
import { POST as createFileRoute } from "../../src/routes/api/fs/create-file/+server";
import { POST as createFolderRoute } from "../../src/routes/api/fs/create-folder/+server";
import { POST as renameRoute } from "../../src/routes/api/fs/rename/+server";
import { POST as deleteRoute } from "../../src/routes/api/fs/delete/+server";

// UX review M9 (WP FT): route-level coverage for the FileTree CRUD routes —
// project-scoping (inside root allowed; sibling-prefix and outside-root
// rejected, mirroring fs-routes-scoping.test.ts's existing routes), name
// validation, create/rename collision handling, and delete's
// snapshot-before-delete discipline (mirrors vcs/restore-snapshot's
// "snapshot before the destructive op" safety net).

function request(body: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function caught(p: Promise<unknown>): Promise<{ status: number; message: unknown }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    if (!isHttpError(e)) throw e;
    return { status: e.status, message: (e.body as { message?: unknown }).message };
  }
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

let projectDir: string;
let siblingDir: string;
let outsideDir: string;

/** Fake lib module for the VCS hooks bag, defaulting to "no version history"
 *  (local-folder) so delete tests that don't care about snapshotting can
 *  ignore it entirely. Individual tests override `vcs.loadLib` for the
 *  snapshot-discipline cases. */
function baseServices(overrides: Partial<HostServices> = {}): HostServices {
  const noop = () => {};
  return {
    app: { updateSplash: noop, showMainWindowAndCloseSplash: noop, setRendererDirty: noop, resolveFlush: noop, sendToRenderer: noop },
    conflictPreview: { getConflictPreview: async () => ({ mine: "", theirs: "", kind: "both-edited" as const, isBinary: false }) },
    desktop: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
      openExternal: async () => {},
      showItemInFolder: noop,
      getNativeTheme: () => ({ shouldUseDarkColors: false }),
      getUserDataPath: () => tmpdir(),
    },
    doctor: { getViewerVersion: () => "0.0.0-test" },
    fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [] },
    media: { createThumbnail: async () => null },
    prefs: {
      readPrefs: async () => ({}),
      writePrefs: async () => {},
      updatePrefs: async (mutate: (p: object) => object) => mutate({}),
      readSettings: async () => ({}),
      writeSettings: async () => {},
      existingDirectory: async () => null,
      readProjectState: () => null,
      writeProjectState: (states: unknown) => states,
      mergeSettings: (b: unknown) => b,
      defaultProjectSearchRoots: () => [],
      scanForProjects: async () => [],
      toggleFavoriteFolder: (favorites: unknown) => ({ favorites: (favorites as []) ?? [], favorited: false }),
      removeRecentFolder: () => [],
      loadLib: async () => ({}),
    },
    recovery: { write: async () => ({ ok: true }), clear: async () => ({ ok: true }), list: async () => [] },
    remote: { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" },
    vcs: {
      loadLib: async () => ({
        detectProjectSource: async () => ({ type: "local-folder" }),
        capabilitiesFor: () => ({ canSnapshot: false }),
        providerFor: () => ({ snapshot: async () => ({ id: "fake", message: "", timestamp: 0 }) }),
        isNoChangesError: () => false,
      }),
      operationLogPath: () => "/fake/log",
    },
    watch: { startFolderWatch: noop, stopFolderWatch: noop, getWatchedDir: () => null },
    write: { scheduleAutoSnapshot: noop, scheduleAutoSync: noop, getWatchedDir: () => null },
    ...overrides,
  } as unknown as HostServices;
}

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "pmd-fs-crud-"));
  projectDir = path.join(base, "proj");
  siblingDir = path.join(base, "proj2");
  outsideDir = path.join(base, "elsewhere");
  await mkdir(projectDir, { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(projectDir, "chapter-01.md"), "# One", "utf8");
  registerHostServices(baseServices());
});

afterEach(async () => {
  await rm(path.dirname(projectDir), { recursive: true, force: true });
});

// ── create-file ──────────────────────────────────────────────────────────

test("fs/create-file: creates a new file inside the open project", async () => {
  const res = await createFileRoute({
    request: request({ dir: projectDir, name: "chapter-02.md", content: "# Two" }),
  } as Parameters<typeof createFileRoute>[0]);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { path: string; mtimeMs: number };
  expect(body.path).toBe(path.join(projectDir, "chapter-02.md"));
  expect(await readFile(body.path, "utf8")).toBe("# Two");
});

test("fs/create-file: a sibling dir with a shared string prefix is rejected (403)", async () => {
  const { status } = await caught(
    createFileRoute({
      request: request({ dir: siblingDir, name: "pwned.md", content: "x" }),
    } as Parameters<typeof createFileRoute>[0]),
  );
  expect(status).toBe(403);
  expect(await exists(path.join(siblingDir, "pwned.md"))).toBe(false);
});

test("fs/create-file: an outside dir is rejected (403)", async () => {
  const { status } = await caught(
    createFileRoute({
      request: request({ dir: outsideDir, name: "pwned.md", content: "x" }),
    } as Parameters<typeof createFileRoute>[0]),
  );
  expect(status).toBe(403);
});

test("fs/create-file: a name containing a path separator is rejected (400), no traversal", async () => {
  const { status } = await caught(
    createFileRoute({
      request: request({ dir: projectDir, name: "../escape.md", content: "x" }),
    } as Parameters<typeof createFileRoute>[0]),
  );
  expect(status).toBe(400);
  expect(await exists(path.join(path.dirname(projectDir), "escape.md"))).toBe(false);
});

test("fs/create-file: an existing file is rejected (409), original content untouched", async () => {
  const target = path.join(projectDir, "chapter-01.md");
  const { status } = await caught(
    createFileRoute({
      request: request({ dir: projectDir, name: "chapter-01.md", content: "overwritten" }),
    } as Parameters<typeof createFileRoute>[0]),
  );
  expect(status).toBe(409);
  expect(await readFile(target, "utf8")).toBe("# One");
});

// ── create-folder ────────────────────────────────────────────────────────

test("fs/create-folder: creates a new folder inside the open project", async () => {
  const res = await createFolderRoute({
    request: request({ dir: projectDir, name: "assets" }),
  } as Parameters<typeof createFolderRoute>[0]);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { path: string };
  expect(body.path).toBe(path.join(projectDir, "assets"));
  expect((await stat(body.path)).isDirectory()).toBe(true);
});

test("fs/create-folder: an existing name is rejected (409)", async () => {
  await mkdir(path.join(projectDir, "assets"));
  const { status } = await caught(
    createFolderRoute({
      request: request({ dir: projectDir, name: "assets" }),
    } as Parameters<typeof createFolderRoute>[0]),
  );
  expect(status).toBe(409);
});

test("fs/create-folder: outside the project is rejected (403)", async () => {
  const { status } = await caught(
    createFolderRoute({
      request: request({ dir: outsideDir, name: "assets" }),
    } as Parameters<typeof createFolderRoute>[0]),
  );
  expect(status).toBe(403);
});

// ── rename ───────────────────────────────────────────────────────────────

test("fs/rename: renames a file within the same directory", async () => {
  const from = path.join(projectDir, "chapter-01.md");
  const res = await renameRoute({
    request: request({ path: from, newName: "intro.md" }),
  } as Parameters<typeof renameRoute>[0]);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { path: string };
  expect(body.path).toBe(path.join(projectDir, "intro.md"));
  expect(await exists(from)).toBe(false);
  expect(await readFile(body.path, "utf8")).toBe("# One");
});

test("fs/rename: a destination collision is rejected (409), nothing renamed", async () => {
  await writeFile(path.join(projectDir, "intro.md"), "# Existing", "utf8");
  const from = path.join(projectDir, "chapter-01.md");
  const { status } = await caught(
    renameRoute({ request: request({ path: from, newName: "intro.md" }) } as Parameters<typeof renameRoute>[0]),
  );
  expect(status).toBe(409);
  expect(await exists(from)).toBe(true);
  expect(await readFile(path.join(projectDir, "intro.md"), "utf8")).toBe("# Existing");
});

test("fs/rename: a path outside the project is rejected (403)", async () => {
  const outsideFile = path.join(outsideDir, "secret.md");
  await writeFile(outsideFile, "secret", "utf8");
  const { status } = await caught(
    renameRoute({
      request: request({ path: outsideFile, newName: "renamed.md" }),
    } as Parameters<typeof renameRoute>[0]),
  );
  expect(status).toBe(403);
});

test("fs/rename: renaming to the same name is a no-op", async () => {
  const from = path.join(projectDir, "chapter-01.md");
  const res = await renameRoute({
    request: request({ path: from, newName: "chapter-01.md" }),
  } as Parameters<typeof renameRoute>[0]);
  expect(res.status).toBe(200);
  expect(await readFile(from, "utf8")).toBe("# One");
});

// ── delete ───────────────────────────────────────────────────────────────

test("fs/delete: deletes a file inside the open project (local-folder: no version history, no snapshot)", async () => {
  const target = path.join(projectDir, "chapter-01.md");
  const res = await deleteRoute({
    request: request({ path: target, projectDir }),
  } as Parameters<typeof deleteRoute>[0]);
  expect(res.status).toBe(200);
  expect(await exists(target)).toBe(false);
});

test("fs/delete: deletes a folder recursively", async () => {
  const dir = path.join(projectDir, "assets");
  await mkdir(dir);
  await writeFile(path.join(dir, "img.png"), "x", "utf8");
  const res = await deleteRoute({
    request: request({ path: dir, projectDir }),
  } as Parameters<typeof deleteRoute>[0]);
  expect(res.status).toBe(200);
  expect(await exists(dir)).toBe(false);
});

test("fs/delete: a sibling dir with a shared string prefix is rejected (403)", async () => {
  const target = path.join(siblingDir, "secret.md");
  await writeFile(target, "x", "utf8");
  const { status } = await caught(
    deleteRoute({ request: request({ path: target, projectDir }) } as Parameters<typeof deleteRoute>[0]),
  );
  expect(status).toBe(403);
  expect(await exists(target)).toBe(true);
});

test("fs/delete: an outside path is rejected (403)", async () => {
  const target = path.join(outsideDir, "secret.md");
  await writeFile(target, "x", "utf8");
  const { status } = await caught(
    deleteRoute({ request: request({ path: target, projectDir }) } as Parameters<typeof deleteRoute>[0]),
  );
  expect(status).toBe(403);
  expect(await exists(target)).toBe(true);
});

test("fs/delete: cannot delete the project root itself (400)", async () => {
  const { status } = await caught(
    deleteRoute({
      request: request({ path: projectDir, projectDir }),
    } as Parameters<typeof deleteRoute>[0]),
  );
  expect(status).toBe(400);
  expect(await exists(projectDir)).toBe(true);
});

// ── delete: snapshot-before-delete discipline ─────────────────────────────

test("fs/delete: with version history, snapshots the working tree BEFORE deleting", async () => {
  const snapshotCalls: Array<{ projectDir: string; message: string }> = [];
  registerHostServices(
    baseServices({
      vcs: {
        loadLib: async () => ({
          detectProjectSource: async () => ({ type: "local-git-folder" }),
          capabilitiesFor: () => ({ canSnapshot: true }),
          providerFor: () => ({
            snapshot: async (opts: { projectDir: string; message: string }) => {
              snapshotCalls.push({ projectDir: opts.projectDir, message: opts.message });
              // The delete must not have happened yet when the snapshot runs.
              expect(await exists(path.join(projectDir, "chapter-01.md"))).toBe(true);
              return { id: "abc123", message: opts.message, timestamp: 0 };
            },
          }),
          isNoChangesError: () => false,
        }),
        operationLogPath: () => "/fake/log",
      },
    }),
  );
  const target = path.join(projectDir, "chapter-01.md");
  const res = await deleteRoute({
    request: request({ path: target, projectDir }),
  } as Parameters<typeof deleteRoute>[0]);
  expect(res.status).toBe(200);
  expect(await exists(target)).toBe(false);
  expect(snapshotCalls).toHaveLength(1);
  expect(snapshotCalls[0]!.message).toBe("Before deleting chapter-01.md");
});

test("fs/delete: a real 'no changes since last snapshot' rejection is swallowed and the delete proceeds", async () => {
  registerHostServices(
    baseServices({
      vcs: {
        loadLib: async () => ({
          detectProjectSource: async () => ({ type: "local-git-folder" }),
          capabilitiesFor: () => ({ canSnapshot: true }),
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
  const target = path.join(projectDir, "chapter-01.md");
  const res = await deleteRoute({
    request: request({ path: target, projectDir }),
  } as Parameters<typeof deleteRoute>[0]);
  expect(res.status).toBe(200);
  expect(await exists(target)).toBe(false);
});

test("fs/delete: a REAL snapshot failure aborts the delete — nothing is deleted", async () => {
  registerHostServices(
    baseServices({
      vcs: {
        loadLib: async () => ({
          detectProjectSource: async () => ({ type: "local-git-folder" }),
          capabilitiesFor: () => ({ canSnapshot: true }),
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
  const target = path.join(projectDir, "chapter-01.md");
  const { status, message } = await caught(
    deleteRoute({ request: request({ path: target, projectDir }) } as Parameters<typeof deleteRoute>[0]),
  );
  expect(status).toBe(500);
  expect(String(message)).toContain("Could not save a safety snapshot");
  expect(await exists(target)).toBe(true);
});

test("fs/delete: end-to-end against a REAL git repo — the deleted file's content is recoverable from history", async () => {
  // Real @dimm-city/print-md (isomorphic-git) end-to-end, not a fake: turn
  // the temp project into an actual local-git-folder, delete a file through
  // the route, then verify a real commit exists whose tree still has the
  // pre-delete content, and that restoring it brings the file back.
  await printMd.providerFor({ type: "local-folder", path: projectDir }).initVersionHistory({
    projectDir,
    initialMessage: "Initial snapshot",
  });
  const gitSource = await printMd.detectProjectSource(projectDir);
  expect(gitSource.type).toBe("local-git-folder");

  // Edit the file we're about to delete AFTER the initial commit, so the
  // working tree has something new to capture — otherwise `snapshot()`
  // correctly rejects with "no changes" (the pre-delete state is already
  // the last commit) and no NEW commit is expected; this variant proves the
  // snapshot actually runs and captures the LATEST pre-delete content, not
  // just the initial commit's.
  const target = path.join(projectDir, "chapter-01.md");
  await writeFile(target, "# One (edited)", "utf8");

  registerHostServices(
    baseServices({
      vcs: {
        loadLib: async () => printMd as unknown as Record<string, unknown>,
        operationLogPath: () => "/fake/log",
      },
    }),
  );

  const res = await deleteRoute({
    request: request({ path: target, projectDir }),
  } as Parameters<typeof deleteRoute>[0]);
  expect(res.status).toBe(200);
  expect(await exists(target)).toBe(false);

  const history = await printMd.providerFor(gitSource).listHistory(projectDir);
  // Newest-first: the safety snapshot taken right before the delete, then
  // the initial snapshot from initVersionHistory above.
  expect(history.length).toBe(2);
  expect(history[0]!.message).toBe("Before deleting chapter-01.md");

  // Recoverable: restoring to the pre-delete snapshot brings the EDITED
  // content back, proving the snapshot ran before the file was removed.
  await printMd.providerFor(gitSource).restore({ projectDir, id: history[0]!.id });
  expect(await readFile(target, "utf8")).toBe("# One (edited)");
});
