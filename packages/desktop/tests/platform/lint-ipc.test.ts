/**
 * IPC-handler tests for `electron/api/lint.ts` (SFE-P5c4 — migrated off
 * `src/routes/api/lint/{check-css,project}/+server.ts`, deleted).
 *
 * `lint:project`'s project-scoping guard coverage is ported from the
 * deleted `route-scoping.test.ts` (2026-07-29 file-operations audit, Theme
 * 1) — same outside/sibling-prefix/no-project-open/repo-root cases, calling
 * `electron/api/lint.ts`'s `lintProject` directly instead of a SvelteKit
 * route handler. `lint:project` was the last route left in that file's
 * table; this file is its replacement.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { lintCheckCss, lintProject } from "../../electron/api/lint";

async function messageOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ── lint:checkCss — no project scoping (CSS text + an optional label path) ──

test("lint:checkCss rejects a non-string content field", async () => {
  const message = await messageOf(lintCheckCss("book.css", undefined));
  expect(message).toBe("'content' string is required");
});

test("lint:checkCss returns the lib's print-safety warnings for the given CSS", async () => {
  const warnings = await lintCheckCss("book.css", '@page { background: url("http://example.com/x.png"); }');
  expect(Array.isArray(warnings)).toBe(true);
});

// ── lint:project — project-scoping guard (ARC review #37 / 2026-07-29 audit) ─

const canSymlink = (() => {
  const base = mkdtempSync(path.join(tmpdir(), "gutterpress-lint-ipc-probe-"));
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

let base: string;
let repoRoot: string;
let bookDir: string;
let siblingBook: string; // "<repo>/books/field-guide" + "2" — inside the repo
let siblingRepo: string; // "<base>/repo" + "2" — a DIFFERENT repo, shared prefix
let outsideDir: string;
let savedHostServices: HostServices | null;

function openProject(roots: string[]): void {
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => roots, readOnlyRoots: () => [] as string[] },
    }),
  );
}

beforeEach(async () => {
  savedHostServices = getHostServices();

  base = await mkdtemp(path.join(tmpdir(), "gutterpress-lint-ipc-"));
  repoRoot = path.join(base, "repo");
  bookDir = path.join(repoRoot, "books", "field-guide");
  siblingBook = path.join(repoRoot, "books", "field-guide2");
  siblingRepo = path.join(base, "repo2");
  outsideDir = path.join(base, "elsewhere");
  await mkdir(bookDir, { recursive: true });
  await mkdir(siblingBook, { recursive: true });
  await mkdir(siblingRepo, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(bookDir, "manifest.yaml"), "title: Field Guide\n", "utf8");
  await writeFile(path.join(siblingBook, "manifest.yaml"), "title: Other Book\n", "utf8");
  await writeFile(path.join(siblingRepo, "manifest.yaml"), "title: Other Repo\n", "utf8");
  await writeFile(path.join(outsideDir, "manifest.yaml"), "title: Not Ours\n", "utf8");
  // The repo-root session shape: the opened book PLUS its enclosing repo root.
  openProject([bookDir, repoRoot]);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

test("lint:project: an unrelated outside path is rejected", async () => {
  const message = await messageOf(lintProject(outsideDir));
  expect(message).toBe("lint:project: path is outside the open project");
});

test("lint:project: a sibling REPO with a shared string prefix is rejected", async () => {
  const message = await messageOf(lintProject(siblingRepo));
  expect(message).toBe("lint:project: path is outside the open project");
});

test("lint:project: a sibling BOOK is rejected when only that book's own root is open", async () => {
  openProject([bookDir]);
  const message = await messageOf(lintProject(siblingBook));
  expect(message).toBe("lint:project: path is outside the open project");
});

test("lint:project: with no project open the handler rejects, including its own book dir", async () => {
  openProject([]);
  const message = await messageOf(lintProject(bookDir));
  expect(message).toBe("lint:project: path is outside the open project");
});

test("lint:project: the opened book dir passes the guard", async () => {
  const message = await messageOf(lintProject(bookDir));
  // May still fail for its own reasons downstream — it must simply never be
  // the guard that stops it.
  expect(message).not.toBe("lint:project: path is outside the open project");
});

test("lint:project: the enclosing REPO ROOT passes the guard (multi-project sessions)", async () => {
  const message = await messageOf(lintProject(repoRoot));
  expect(message).not.toBe("lint:project: path is outside the open project");
});

test.skipIf(!canSymlink)(
  "lint:project: a book-local symlink pointing outside the project is rejected",
  async () => {
    const alias = path.join(bookDir, "alias");
    await symlink(outsideDir, alias, "dir");
    const message = await messageOf(lintProject(alias));
    expect(message).toBe("lint:project: path is outside the open project");
  },
);

test("lint:project: maps validation results to relative project paths (untouched behavior)", async () => {
  const problems = await lintProject(bookDir);
  expect(Array.isArray(problems)).toBe(true);
});
