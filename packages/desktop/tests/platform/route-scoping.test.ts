/**
 * Project-scoping guard coverage for the route families that ARC review #37
 * never reached (2026-07-29 file-operations audit, Theme 1).
 *
 * `fs/*`, `media/*`, `log/read` and `plugin/add-npm` confined their
 * renderer-supplied path to the host-owned `projectRoots()` allow-list;
 * every OTHER route taking a `projectDir` validated it with `requireAbsolute`
 * alone — a bare `isAbsolute` check. Any code that can issue a same-origin
 * fetch inside the renderer (a preview XSS, a malicious plugin-injected
 * script, a compromised dependency — the threat model
 * `electron/server-bridge/fs-guard.ts` documents) could therefore drive real
 * filesystem work at ANY absolute path on disk.
 *
 * The table below pins the guard on every ROUTE that remains HTTP after
 * SFE-P5c3: outside → rejected, sibling directory with a shared string
 * prefix → rejected (the `/proj` vs `/proj2` regression), no project open →
 * rejected, and — the multi-project half of the contract — the enclosing
 * REPO ROOT is allowed, because `projectRoots()` is the opened book PLUS its
 * host-detected repo root, which is what lets a book subfolder session act
 * on repo-root shared files.
 *
 * SFE-P5c2 migrated `vcs`, `theme`, `style`, `project`, `manifest`,
 * `plugin`, `snip`, and `tpl` off these HTTP routes to typed IPC — their
 * scoping-guard coverage moved to `project-config-ipc.test.ts` /
 * `vcs-ipc.test.ts`. SFE-P5c3 migrated `remote` and `publish` (including
 * `publish/run`'s CREDENTIALED upload — a config that used to run a
 * credentialed push/pull or upload at any renderer-supplied path is exactly
 * the risk this file's header describes) — that coverage, run against
 * `electron/api/remote.ts`/`publish.ts` instead of a `+server.ts` handler,
 * moved to `remote-ipc.test.ts` / `publish-ipc.test.ts`. `lint/project` is
 * the only route left in this table (P5c4's territory, out of scope here).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";

import { POST as lintProject } from "../../src/routes/api/lint/project/+server";
// shell/show-in-folder migrated to typed IPC (SFE-P5c1) — see shell-ipc.test.ts.
// vcs/theme/style/project/manifest/plugin/snip/tpl migrated to typed IPC
// (SFE-P5c2) — see project-config-ipc.test.ts / vcs-ipc.test.ts.
// remote/publish migrated to typed IPC (SFE-P5c3) — see remote-ipc.test.ts /
// publish-ipc.test.ts.

type RouteHandler = (event: { request: Request }) => Promise<Response>;

/**
 * Every route that takes a renderer-supplied `projectDir` and does real
 * filesystem work with it. `body` supplies whatever ELSE each route's
 * validation requires, so a rejection can only come from the path guard —
 * never from a missing field.
 */
const ROUTES: Array<{ name: string; handler: RouteHandler; body: (dir: string) => unknown }> = [
  { name: "lint/project", handler: lintProject as RouteHandler, body: (d) => ({ projectDir: d }) },
];

const canSymlink = (() => {
  const base = mkdtempSync(path.join(tmpdir(), "gutterpress-route-scoping-probe-"));
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

function request(body: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** The status of an HttpError thrown by a route, or null when it didn't throw one. */
async function statusOf(p: Promise<unknown>): Promise<number | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (isHttpError(e)) return e.status;
    return null; // a non-HTTP failure (lib error) — not a guard rejection
  }
}

/** Register the host fake with `roots` as the fs-guard allow-list. */
function openProject(roots: string[]): void {
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => roots, readOnlyRoots: () => [] as string[] },
    }),
  );
}

beforeEach(async () => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file.
  savedHostServices = getHostServices();

  base = await mkdtemp(path.join(tmpdir(), "gutterpress-route-scoping-"));
  repoRoot = path.join(base, "repo");
  bookDir = path.join(repoRoot, "books", "field-guide");
  siblingBook = path.join(repoRoot, "books", "field-guide2"); // "…guide" + "2"
  siblingRepo = path.join(base, "repo2"); // "repo" + "2"
  outsideDir = path.join(base, "elsewhere");
  await mkdir(bookDir, { recursive: true });
  await mkdir(siblingBook, { recursive: true });
  await mkdir(siblingRepo, { recursive: true });
  await mkdir(path.join(repoRoot, "shared", "styles"), { recursive: true });
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

// ── Every guarded route: outside the open project is 403 ──────────────────

for (const route of ROUTES) {
  test(`${route.name}: an unrelated outside path is rejected (403)`, async () => {
    const status = await statusOf(route.handler({ request: request(route.body(outsideDir)) }));
    expect(status).toBe(403);
  });
}

// ── The sibling-prefix regression, per route family ───────────────────────
//
// `siblingRepo` is `repoRoot + "2"`, so a bare `startsWith(root)` containment
// test would accept it as "inside the repo". One representative route per
// family (the whole set shares one guard, so this pins the guard's separator
// handling without re-running every near-identical case) — the equivalent
// `remote`/`publish` cases now run against `electron/api/*.ts` in
// `remote-ipc.test.ts`/`publish-ipc.test.ts` (SFE-P5c3).

const SIBLING_CASES = ["lint/project"];

for (const name of SIBLING_CASES) {
  test(`${name}: a sibling REPO with a shared string prefix is rejected (403)`, async () => {
    const route = ROUTES.find((r) => r.name === name)!;
    const status = await statusOf(route.handler({ request: request(route.body(siblingRepo)) }));
    expect(status).toBe(403);
  });
}

test("a sibling BOOK is rejected when only that book's own root is open", async () => {
  // With a repo-root session both books are legitimately in scope (they share
  // the repo). Narrow the allow-list to one book and the prefix-sibling
  // `field-guide2` must be refused — the `/proj` vs `/proj2` regression at
  // book granularity.
  openProject([bookDir]);
  for (const name of SIBLING_CASES) {
    const route = ROUTES.find((r) => r.name === name)!;
    const status = await statusOf(route.handler({ request: request(route.body(siblingBook)) }));
    expect(status).toBe(403);
  }
});

// ── No project open → fail closed, never "anywhere" ───────────────────────

test("with no project open every guarded route rejects, including its own book dir", async () => {
  openProject([]);
  for (const route of ROUTES) {
    const status = await statusOf(route.handler({ request: request(route.body(bookDir)) }));
    expect(status).toBe(403);
  }
});

// ── The guard must not OVER-block: the open book and its repo root pass ───

test("the opened book dir passes the guard on every route", async () => {
  for (const route of ROUTES) {
    const status = await statusOf(route.handler({ request: request(route.body(bookDir)) }));
    // A route may still fail for its own reasons (no such theme, no remote,
    // unknown provider) — it must simply never be the guard that stops it.
    expect(status).not.toBe(403);
  }
});

test("the enclosing REPO ROOT passes the guard on every route (multi-project sessions)", async () => {
  // R1/R11: `projectRoots()` is the opened book PLUS the host-detected repo
  // root, which is what lets a book-subfolder session reach repo-root shared
  // files. A guard keyed only to the book would 403 every repo-root-keyed
  // call and break the multi-book workflow this audit is about.
  for (const route of ROUTES) {
    const status = await statusOf(route.handler({ request: request(route.body(repoRoot)) }));
    expect(status).not.toBe(403);
  }
});

// publish/run's artifactPath (the upload SOURCE, not just projectDir) —
// CREDENTIALED upload primitive coverage moved to publish-ipc.test.ts
// (SFE-P5c3: migrated to typed IPC).

// shell/show-in-folder's project + read-only-roots + picked-path-reveal
// coverage moved to shell-ipc.test.ts (SFE-P5c1: migrated to typed IPC).

// ── Symlink escape (the P1 canonicalization requirement) ─────────────────

test.skipIf(!canSymlink)(
  "a book-local symlink pointing outside the project is rejected (403)",
  async () => {
    // Lexical containment would accept `<book>/alias` — the guard has to
    // canonicalize first, exactly as `requireWithinProjectRoot` does for the
    // fs routes.
    const alias = path.join(bookDir, "alias");
    await symlink(outsideDir, alias, "dir");
    const status = await statusOf(
      lintProject({
        request: request({ projectDir: alias }),
      } as Parameters<typeof lintProject>[0]),
    );
    expect(status).toBe(403);
  },
);
