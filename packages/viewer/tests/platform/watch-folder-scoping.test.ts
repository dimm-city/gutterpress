/**
 * P1 review (PR #98, maintainer itlackey) on electron/main.ts:969's
 * `fs:watchFolder` IPC handler:
 *
 *   "An app-origin script can invoke watchFolder on an arbitrary absolute
 *   directory such as the user SSH directory. fsGuardImpl then includes that
 *   watched path in projectRoots, authorizing direct reads there and making
 *   copy-file treat its source as inside the project, bypassing the new
 *   picker capability. Restrict this IPC call to the active preview project
 *   and do not derive authorization from the watcher state."
 *
 * Confirmed: `fsGuardImpl.projectRoots()` used to union
 * `path.resolve(activePreview.inputPath)` with `folderWatch.getWatchedDir()`,
 * and `fs:watchFolder`'s handler accepted ANY absolute path from the
 * renderer (only guard: `path.isAbsolute`). A same-origin script (preview
 * XSS, malicious plugin-injected script) could therefore call
 * `watchFolder("/home/user/.ssh")` and have that directory authorized as a
 * project root for the generic fs routes and copy-file's "src is inside the
 * project" shortcut.
 *
 * `electron/main.ts` is Electron's entry script — module-scope
 * `app.whenReady()`, `app.commandLine.appendSwitch(...)`, etc. — so, matching
 * the established convention for main.ts-only logic in this suite
 * (main-boot-and-splash.test.ts, migrated-ipc-routes.test.ts's "main.ts no
 * longer registers..." test), (a) and (c) below pin the fixed shape of
 * `fsGuardImpl.projectRoots()` and the `fs:watchFolder` handler via
 * source-text assertions rather than importing/executing main.ts. (b)
 * exercises the REAL `fs/read-file` route + the real project-scoping guard
 * (src/routes/api/_lib/fs-guard.ts) with a `projectRoots()` hook shaped like
 * the FIXED main.ts (no watcher-state union) to confirm the route correctly
 * 403s a directory that is merely "being watched" but is not the active
 * preview project — the exact bypass the review demonstrated.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { POST as readFileRoute } from "../../src/routes/api/fs/read-file/+server";

const main = await readFile(path.resolve(import.meta.dir, "../../electron/main.ts"), "utf8");

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

// ── (a) projectRoots() no longer derives authorization from watcher state ──

test("(a) fsGuardImpl.projectRoots() is derived ONLY from activePreview, never folderWatch.getWatchedDir()", () => {
  const implStart = main.indexOf("const fsGuardImpl: FsGuardHooks = {");
  expect(implStart).toBeGreaterThan(-1);
  const rootsStart = main.indexOf("projectRoots(): string[] {", implStart);
  expect(rootsStart).toBeGreaterThan(-1);
  const rootsEnd = main.indexOf("readOnlyRoots(): string[] {", rootsStart);
  expect(rootsEnd).toBeGreaterThan(rootsStart);
  const rootsBody = main.slice(rootsStart, rootsEnd);

  // The exact bug: unioning in the folder watcher's tracked dir let a
  // renderer-driven fs:watchFolder(anyPath) authorize `anyPath` as a project
  // root. That union must be gone.
  expect(rootsBody).not.toContain("folderWatch");
  expect(rootsBody).not.toContain("getWatchedDir");
  // Still gated on the host-set active preview (not falling back to "anywhere").
  expect(rootsBody).toContain("activePreview");
});

// ── (b) an fs route for a dir that's merely "watched" (not the active
//     preview) is rejected — the concrete bypass the review demonstrated ────

let previewDir: string;
let watchedOnlyDir: string; // simulates the dir a compromised renderer got `fs:watchFolder`-ed onto

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "pmd-watch-folder-guard-"));
  previewDir = path.join(base, "open-project");
  watchedOnlyDir = path.join(base, "ssh-like-secret-dir");
  await mkdir(previewDir, { recursive: true });
  await mkdir(watchedOnlyDir, { recursive: true });
  await writeFile(path.join(previewDir, "chapter-01.md"), "# In project", "utf8");
  await writeFile(path.join(watchedOnlyDir, "id_rsa"), "-----BEGIN PRIVATE KEY-----", "utf8");

  const noop = () => {};
  const services = {
    app: { updateSplash: noop, showMainWindowAndCloseSplash: noop, setRendererDirty: noop, sendToRenderer: noop },
    conflictPreview: { getConflictPreview: async () => ({ mine: "", theirs: "", kind: "both-edited" as const, isBinary: false }) },
    desktop: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
      openExternal: async () => {},
      showItemInFolder: noop,
      getNativeTheme: () => ({ shouldUseDarkColors: false }),
      getUserDataPath: () => base,
    },
    doctor: { getViewerVersion: () => "0.0.0-test" },
    // Models the FIXED fsGuardImpl.projectRoots(): only the active preview's
    // dir, NOT a union with a separately-"watched" dir — proving the route
    // itself correctly rejects `watchedOnlyDir` once main.ts stops handing it
    // authorization.
    fsGuard: { projectRoots: () => [previewDir], readOnlyRoots: () => [] },
    media: { createThumbnail: async () => null },
    pickedFiles: { register: noop, consume: () => false },
    prefs: {
      readPrefs: async () => ({}),
      writePrefs: async () => {},
      updatePrefs: async (mutate: (p: object) => object) => mutate({}),
      readSettings: async () => ({}),
      updateSettings: async () => ({}),
      existingDirectory: async () => null,
      readProjectState: () => null,
      writeProjectState: (states: unknown) => states,
      defaultProjectSearchRoots: () => [],
      scanForProjects: async () => [],
      toggleFavoriteFolder: (favorites: unknown) => ({ favorites: (favorites as []) ?? [], favorited: false }),
      removeRecentFolder: () => [],
      loadLib: async () => ({}),
    },
    recovery: { write: async () => ({ ok: true }), clear: async () => ({ ok: true }), list: async () => [] },
    remote: { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" },
    vcs: { loadLib: async () => ({}), operationLogPath: () => "/fake/log" },
    watch: { startFolderWatch: noop, stopFolderWatch: noop, getWatchedDir: () => watchedOnlyDir },
    write: { scheduleAutoSnapshot: noop, scheduleAutoSync: noop, getWatchedDir: () => watchedOnlyDir },
  } as unknown as HostServices;
  registerHostServices(services);
});

afterEach(async () => {
  await rm(path.dirname(previewDir), { recursive: true, force: true });
});

test("(b) fs/read-file: a path inside the active preview project is still allowed", async () => {
  const res = await readFileRoute({
    request: request({ path: path.join(previewDir, "chapter-01.md") }),
  } as Parameters<typeof readFileRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("# In project");
});

test("(b) fs/read-file: a directory the renderer merely got fs:watchFolder-ed onto (not the active preview) is rejected (403)", async () => {
  const { status, message } = await caught(
    readFileRoute({
      request: request({ path: path.join(watchedOnlyDir, "id_rsa") }),
    } as Parameters<typeof readFileRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("fs:readFile: path is outside the open project");
});

// ── (c) fs:watchFolder rejects a dirPath that isn't the active preview ─────

test("(c) fs:watchFolder's IPC handler rejects any dirPath that doesn't match the active preview's project", () => {
  const handlerStart = main.indexOf('secureHandle("fs:watchFolder"');
  expect(handlerStart).toBeGreaterThan(-1);
  const handlerEnd = main.indexOf("});", handlerStart);
  expect(handlerEnd).toBeGreaterThan(handlerStart);
  const handlerBody = main.slice(handlerStart, handlerEnd);

  // Must consult the host-set activePreview — the pre-fix handler's only
  // check was `path.isAbsolute(dirPath)`, which any absolute path passes.
  expect(handlerBody).toContain("activePreview");
  expect(handlerBody).toMatch(/!activePreview/);
  expect(handlerBody).toContain("path.resolve(dirPath)");
  expect(handlerBody).toContain("path.resolve(activePreview.inputPath)");
  // And it must actually throw on mismatch/no-active-preview, not just log.
  expect(handlerBody).toContain("throw new Error(");
});
