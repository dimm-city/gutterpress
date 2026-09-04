/**
 * Project-scoping guard coverage for the `project`/`manifest`/`tpl`/`snip`/
 * `plugin`/`theme`/`style` IPC handlers (SFE-P5c2 — migrated off
 * `src/routes/api/{project,manifest,tpl,snip,plugin,theme,style}/**`,
 * all deleted). Ports the corresponding rows of the deleted
 * `route-scoping.test.ts`'s `ROUTES` table (2026-07-29 file-operations
 * audit, Theme 1) to call the `electron/api/*.ts` handler functions
 * directly instead of a `+server.ts` HTTP handler — same guard, same
 * fixture shape, same cases: outside → rejected, sibling directory with a
 * shared string prefix → rejected, no project open → rejected, and the
 * enclosing REPO ROOT passes (multi-project sessions).
 *
 * `plugin:addNpm`'s own scoping + trust-confirmation coverage lives in
 * `plugin-ipc.test.ts` (SPECIAL WEIGHT per the run's dispatch note); this
 * file covers the rest of `plugin`. `vcs`'s scoping coverage lives in
 * `vcs-ipc.test.ts`. `manifest:read`/`manifest:setFields`/`style:setActive`'s
 * real positive round-trips (an actual manifest.yaml on disk) live in
 * `manifest-style-ipc.test.ts` — this file only re-covers `manifest:
 * setFields` as a SIBLING_CASES representative and the symlink-escape case,
 * matching the deleted file's own reuse of that route for the same purpose.
 *
 * Error semantics: IPC has no HTTP status code, so every assertion here
 * checks the REJECTED promise's message — the same text the deleted routes
 * used to send as the response body.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";

import { projectListStyles } from "../../electron/api/project";
import { manifestRead, manifestSetFields } from "../../electron/api/manifest";
import { tplSaveAsTemplate } from "../../electron/api/tpl";
import { snipList, snipRead, snipSave, snipDelete } from "../../electron/api/snip";
import { pluginList, pluginSetEnabled, pluginAddLocal, pluginValidate } from "../../electron/api/plugin";
import {
  themeListProject,
  themeGetActive,
  themeApply,
  themeImportFromFolder,
  themeImportFromFile,
  themeImportFromUrl,
  themeReadCss,
  themeRemove,
  themeGetPrevious,
  themeRevert,
} from "../../electron/api/theme";
import { styleSetActive } from "../../electron/api/style";

/**
 * Every handler that takes a renderer-supplied `projectDir` and does real
 * filesystem work with it. `call` supplies whatever ELSE each handler's
 * validation requires, so a rejection can only come from the path guard —
 * never from a missing argument.
 */
const ROUTES: Array<{ name: string; call: (dir: string) => Promise<unknown> }> = [
  { name: "project:listStyles", call: (d) => projectListStyles(d) },
  { name: "manifest:read", call: (d) => manifestRead(d) },
  { name: "manifest:setFields", call: (d) => manifestSetFields(d, { title: "pwned" }) },
  { name: "tpl:saveAsTemplate", call: (d) => tplSaveAsTemplate(d, "tpl") },
  { name: "snip:list", call: (d) => snipList(d) },
  { name: "snip:read", call: (d) => snipRead(d, "snip.md") },
  { name: "snip:save", call: (d) => snipSave(d, "snip", "text") },
  { name: "snip:delete", call: (d) => snipDelete(d, "snip.md") },
  { name: "plugin:list", call: (d) => pluginList(d) },
  { name: "plugin:setEnabled", call: (d) => pluginSetEnabled(d, "some-plugin", true) },
  { name: "plugin:addLocal", call: (d) => pluginAddLocal(d) },
  { name: "plugin:validate", call: (d) => pluginValidate(d) },
  { name: "theme:apply", call: (d) => themeApply(d, { kind: "builtin", id: "classic" }) },
  { name: "theme:remove", call: (d) => themeRemove(d, "some-theme") },
  { name: "theme:readCss", call: (d) => themeReadCss(d, { kind: "project", id: "some-theme" }) },
  { name: "theme:importFromUrl", call: (d) => themeImportFromUrl(d, "https://example.test/theme.css") },
  { name: "theme:importFromFile", call: (d) => themeImportFromFile(d) },
  { name: "theme:importFromFolder", call: (d) => themeImportFromFolder(d) },
  { name: "theme:getActive", call: (d) => themeGetActive(d) },
  { name: "theme:listProject", call: (d) => themeListProject(d) },
  { name: "theme:getPrevious", call: (d) => themeGetPrevious(d) },
  { name: "theme:revert", call: (d) => themeRevert(d) },
  { name: "style:setActive", call: (d) => styleSetActive(d, []) },
];

const canSymlink = (() => {
  const base = mkdtempSync(path.join(tmpdir(), "gutterpress-project-config-ipc-probe-"));
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

/** The rejection message of a promise, or null when it resolved. */
async function messageOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** True when `message` is the project-scoping guard's own rejection for `routeName`. */
function isGuardRejection(message: string | null, routeName: string): boolean {
  return message === `${routeName}: path is outside the open project`;
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
  // never leaks into a sibling test file's "nothing registered yet" (or
  // differently-scoped) assertions.
  savedHostServices = getHostServices();

  base = await mkdtemp(path.join(tmpdir(), "gutterpress-project-config-ipc-"));
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

// ── Every guarded handler: outside the open project is rejected ───────────

for (const route of ROUTES) {
  test(`${route.name}: an unrelated outside path is rejected`, async () => {
    const message = await messageOf(route.call(outsideDir));
    expect(message).toBe(`${route.name}: path is outside the open project`);
  });
}

// ── The sibling-prefix regression, per handler family ──────────────────────
//
// `siblingRepo` is `repoRoot + "2"`, so a bare `startsWith(root)` containment
// test would accept it as "inside the repo". One representative handler per
// family (the whole set shares one guard, so this pins the guard's separator
// handling without re-running every near-identical case).

const SIBLING_CASES = ["theme:remove", "manifest:setFields", "plugin:validate", "snip:save", "tpl:saveAsTemplate"];

for (const name of SIBLING_CASES) {
  test(`${name}: a sibling REPO with a shared string prefix is rejected`, async () => {
    const route = ROUTES.find((r) => r.name === name)!;
    const message = await messageOf(route.call(siblingRepo));
    expect(message).toBe(`${name}: path is outside the open project`);
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
    const message = await messageOf(route.call(siblingBook));
    expect(message).toBe(`${name}: path is outside the open project`);
  }
});

// ── No project open → fail closed, never "anywhere" ───────────────────────

test("with no project open every guarded handler rejects, including its own book dir", async () => {
  openProject([]);
  for (const route of ROUTES) {
    const message = await messageOf(route.call(bookDir));
    expect(message).toBe(`${route.name}: path is outside the open project`);
  }
});

// ── The guard must not OVER-block: the open book and its repo root pass ───

test("the opened book dir passes the guard on every handler", async () => {
  for (const route of ROUTES) {
    const message = await messageOf(route.call(bookDir));
    // A handler may still fail for its own reasons (no such theme, no
    // remote, unknown provider) — it must simply never be the guard that
    // stops it.
    expect(isGuardRejection(message, route.name)).toBe(false);
  }
});

test("the enclosing REPO ROOT passes the guard on every handler (multi-project sessions)", async () => {
  // R1/R11: `projectRoots()` is the opened book PLUS the host-detected repo
  // root, which is what lets a book-subfolder session reach repo-root shared
  // files. A guard keyed only to the book would reject every repo-root-keyed
  // call and break the multi-book workflow this audit is about.
  for (const route of ROUTES) {
    const message = await messageOf(route.call(repoRoot));
    expect(isGuardRejection(message, route.name)).toBe(false);
  }
});

// ── Real positive round-trips, not just "not rejected" ────────────────────

test("project:listStyles offers the repo's shared stylesheets for a nested book", async () => {
  // 2026-07-29 audit: shared stylesheets were only listable while they sat in
  // the manifest, so unchecking one removed it from the UI for good. The
  // handler now forwards the session's repo root — guarded exactly like
  // projectDir, so a renderer cannot turn it into a directory-enumeration
  // primitive.
  await writeFile(path.join(repoRoot, "shared", "styles", "components.css"), "body{}", "utf8");
  const styles = (await projectListStyles(bookDir, repoRoot)) as Array<{ displayName: string; active: boolean }>;
  expect(styles.map((s) => s.displayName)).toContain("../../shared/styles/components.css");
});

test("project:listStyles rejects a repoRoot outside the open project", async () => {
  const message = await messageOf(projectListStyles(bookDir, outsideDir));
  expect(message).toBe("project:listStyles: path is outside the open project");
});

test("project:listStyles works for a repo-root-keyed project dir", async () => {
  await writeFile(path.join(repoRoot, "shared", "styles", "components.css"), "body{}", "utf8");
  expect(Array.isArray(await projectListStyles(repoRoot))).toBe(true);
});

// ── Symlink escape (the P1 canonicalization requirement) ─────────────────

test.skipIf(!canSymlink)(
  "a book-local symlink pointing outside the project is rejected",
  async () => {
    // Lexical containment would accept `<book>/alias` — the guard has to
    // canonicalize first, exactly as `requireWithinProjectRoot` does for the
    // fs handlers.
    const alias = path.join(bookDir, "alias");
    await symlink(outsideDir, alias, "dir");
    const message = await messageOf(manifestSetFields(alias, { title: "pwned" }));
    expect(message).toBe("manifest:setFields: path is outside the open project");
  },
);
