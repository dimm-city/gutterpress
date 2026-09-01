/**
 * P1 review (PR #98, maintainer itlackey) on electron/main.ts:969's
 * `fs:watchFolder` IPC handler:
 *
 *   "An app-origin script can invoke watchFolder on an arbitrary absolute
 *   directory such as the user SSH directory. fsGuardImpl then includes that
 *   watched path in projectRoots, authorizing direct reads there and making
 *   copy-file treat its source as inside the project, bypassing the new
 *   picker capability. Restrict this IPC call to the active workspace project
 *   and do not derive authorization from the watcher state."
 *
 * Confirmed: `fsGuardImpl.projectRoots()` used to union
 * the host-owned project root with `folderWatch.getWatchedDir()`,
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
 * exercises the REAL `fs:readFile` IPC handler (SFE-P5c1: migrated off the
 * `fs/read-file` HTTP route to `electron/api/fs.ts`; the underlying guard —
 * `electron/api/validation.ts`'s `requireWithinProjectRoot`, ported verbatim
 * from the deleted route-side `_lib/fs-guard.ts` — is unchanged) with a
 * `projectRoots()` hook shaped like the FIXED main.ts (no watcher-state
 * union) to confirm the handler correctly rejects a directory that is
 * merely "being watched" but is not the active workspace project — the
 * exact bypass the review demonstrated.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { fsReadFile } from "../../electron/api/fs";

const main = await readFile(path.resolve(import.meta.dir, "../../electron/main.ts"), "utf8");

async function caught(p: Promise<unknown>): Promise<{ message: unknown }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
  }
}

// ── (a) projectRoots() no longer derives authorization from watcher state ──

test("(a) fsGuardImpl.projectRoots() uses host-detected workspace roots, never folderWatch.getWatchedDir()", () => {
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
  // Still gated on the host-set workspace capability (not falling back to "anywhere").
  expect(rootsBody).toContain("activeWorkspaceRoot");
  expect(rootsBody).toContain("activeRepositoryRoot");
});

// ── (b) an fs route for a dir that's merely "watched" (not the active
//     preview) is rejected — the concrete bypass the review demonstrated ────

let previewDir: string;
let watchedOnlyDir: string; // simulates the dir a compromised renderer got `fs:watchFolder`-ed onto

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "gutterpress-watch-folder-guard-"));
  previewDir = path.join(base, "open-project");
  watchedOnlyDir = path.join(base, "ssh-like-secret-dir");
  await mkdir(previewDir, { recursive: true });
  await mkdir(watchedOnlyDir, { recursive: true });
  await writeFile(path.join(previewDir, "chapter-01.md"), "# In project", "utf8");
  await writeFile(path.join(watchedOnlyDir, "id_rsa"), "-----BEGIN PRIVATE KEY-----", "utf8");

  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      // Models the FIXED fsGuardImpl.projectRoots(): only the active workspace's
      // dir, NOT a union with a separately-"watched" dir — proving the route
      // itself correctly rejects `watchedOnlyDir` once main.ts stops handing it
      // authorization.
      fsGuard: { projectRoots: () => [previewDir], readOnlyRoots: () => [] },
      watch: { getWatchedDir: () => watchedOnlyDir },
      write: { getWatchedDir: () => watchedOnlyDir },
    }),
  );
});

afterEach(async () => {
  await rm(path.dirname(previewDir), { recursive: true, force: true });
});

test("(b) fs:readFile: a path inside the active workspace is still allowed", async () => {
  expect(await fsReadFile(path.join(previewDir, "chapter-01.md"))).toBe("# In project");
});

test("(b) fs:readFile: a directory merely watched outside the active workspace is rejected", async () => {
  const { message } = await caught(fsReadFile(path.join(watchedOnlyDir, "id_rsa")));
  expect(message).toBe("fs:readFile: path is outside the open project");
});

// ── (c) fs:watchFolder rejects a dirPath that isn't the active preview ─────

test("(c) fs:watchFolder rejects any dirPath that does not match the active workspace", () => {
  const handlerStart = main.indexOf('secureHandle("fs:watchFolder"');
  expect(handlerStart).toBeGreaterThan(-1);
  const handlerEnd = main.indexOf("});", handlerStart);
  expect(handlerEnd).toBeGreaterThan(handlerStart);
  const handlerBody = main.slice(handlerStart, handlerEnd);

  // Must consult the host-set activeWorkspaceRoot — the pre-fix handler's only
  // check was `path.isAbsolute(dirPath)`, which any absolute path passes.
  expect(handlerBody).toContain("activeWorkspaceRoot");
  expect(handlerBody).toMatch(/!activeWorkspaceRoot/);
  expect(handlerBody).toContain("path.resolve(dirPath)");
  expect(handlerBody).toContain("activeWorkspaceRoot");
  // And it must actually throw on mismatch/no-active-preview, not just log.
  expect(handlerBody).toContain("throw new Error(");
});
