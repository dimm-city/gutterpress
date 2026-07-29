/**
 * Project-scoping guard coverage for the route families that ARC review #37
 * never reached (2026-07-29 file-operations audit, Theme 1).
 *
 * `fs/*`, `media/*`, `log/read`, `sync/get-conflict-preview` and
 * `plugin/add-npm` confined their renderer-supplied path to the host-owned
 * `projectRoots()` allow-list; every OTHER route taking a `projectDir`
 * validated it with `requireAbsolute` alone — a bare `isAbsolute` check. Any
 * code that can issue a same-origin fetch inside the renderer (a preview XSS,
 * a malicious plugin-injected script, a compromised dependency — the threat
 * model `electron/server-bridge/fs-guard.ts` documents) could therefore drive
 * real filesystem work at ANY absolute path on disk:
 *
 *   - `vcs/restore-snapshot` force-checks-out any git repo
 *     (`git.checkout({ force: true })`)
 *   - `remote/sync` runs a CREDENTIALED push/pull against any repo
 *   - `publish/run` uploads a file to a configured provider
 *   - `theme/remove` `rm -rf`s a `themes/<slug>` subtree
 *   - `theme/apply` / `style/set-active` / `manifest/set-fields` /
 *     `plugin/set-enabled` rewrite any `manifest.yaml`
 *   - `plugin/validate` dynamic-`import()`s whatever JS the target
 *     directory's manifest names — an execute primitive
 *   - `tpl/save-as-template` recursively copies any folder into app storage
 *
 * The table below pins the guard on every one of them: outside → 403, sibling
 * directory with a shared string prefix → 403 (the `/proj` vs `/proj2`
 * regression), no project open → 403, and — the multi-project half of the
 * contract — the enclosing REPO ROOT is allowed, because `projectRoots()` is
 * the opened book PLUS its host-detected repo root, which is what lets a book
 * subfolder session act on repo-root shared files.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";

import { POST as vcsSaveSnapshot } from "../../src/routes/api/vcs/save-snapshot/+server";
import { POST as vcsRestoreSnapshot } from "../../src/routes/api/vcs/restore-snapshot/+server";
import { POST as vcsListSnapshotsPage } from "../../src/routes/api/vcs/list-snapshots-page/+server";
import { POST as vcsEnableVersionHistory } from "../../src/routes/api/vcs/enable-version-history/+server";
import { POST as remoteSync } from "../../src/routes/api/remote/sync/+server";
import { POST as remoteResolveSyncConflicts } from "../../src/routes/api/remote/resolve-sync-conflicts/+server";
import { POST as remoteDiagnoseProject } from "../../src/routes/api/remote/diagnose-project/+server";
import { POST as publishRun } from "../../src/routes/api/publish/run/+server";
import { POST as publishSetConfig } from "../../src/routes/api/publish/set-config/+server";
import { POST as publishConnect } from "../../src/routes/api/publish/connect/+server";
import { POST as publishList } from "../../src/routes/api/publish/list/+server";
import { POST as publishPreflight } from "../../src/routes/api/publish/preflight/+server";
import { POST as themeApply } from "../../src/routes/api/theme/apply/+server";
import { POST as themeRemove } from "../../src/routes/api/theme/remove/+server";
import { POST as themeReadCss } from "../../src/routes/api/theme/read-css/+server";
import { POST as themeImportFromUrl } from "../../src/routes/api/theme/import-from-url/+server";
import { POST as themeImportFromFile } from "../../src/routes/api/theme/import-from-file/+server";
import { POST as themeImportFromFolder } from "../../src/routes/api/theme/import-from-folder/+server";
import { POST as themeActive } from "../../src/routes/api/theme/active/+server";
import { POST as themeProject } from "../../src/routes/api/theme/project/+server";
import { POST as themePrevious } from "../../src/routes/api/theme/previous/+server";
import { POST as themeRevert } from "../../src/routes/api/theme/revert/+server";
import { POST as styleSetActive } from "../../src/routes/api/style/set-active/+server";
import { POST as projectListStyles } from "../../src/routes/api/project/list-styles/+server";
import { POST as manifestRead } from "../../src/routes/api/manifest/read/+server";
import { POST as manifestSetFields } from "../../src/routes/api/manifest/set-fields/+server";
import { POST as pluginSetEnabled } from "../../src/routes/api/plugin/set-enabled/+server";
import { POST as pluginList } from "../../src/routes/api/plugin/list/+server";
import { POST as pluginAddLocal } from "../../src/routes/api/plugin/add-local/+server";
import { POST as pluginValidate } from "../../src/routes/api/plugin/validate/+server";
import { POST as snipSave } from "../../src/routes/api/snip/save/+server";
import { POST as snipRead } from "../../src/routes/api/snip/read/+server";
import { POST as snipDelete } from "../../src/routes/api/snip/delete/+server";
import { POST as snipList } from "../../src/routes/api/snip/list/+server";
import { POST as tplSaveAsTemplate } from "../../src/routes/api/tpl/save-as-template/+server";
import { POST as lintProject } from "../../src/routes/api/lint/project/+server";
import { POST as showInFolder } from "../../src/routes/api/shell/show-in-folder/+server";

type RouteHandler = (event: { request: Request }) => Promise<Response>;

const HEX40_A = "a".repeat(40);
const HEX40_B = "b".repeat(40);

/**
 * Every route that takes a renderer-supplied `projectDir` and does real
 * filesystem (or git, or network-with-credentials) work with it. `body`
 * supplies whatever ELSE each route's validation requires, so a rejection can
 * only come from the path guard — never from a missing field.
 */
const ROUTES: Array<{ name: string; handler: RouteHandler; body: (dir: string) => unknown }> = [
  { name: "vcs/save-snapshot", handler: vcsSaveSnapshot as RouteHandler, body: (d) => ({ projectDir: d, message: "snap" }) },
  { name: "vcs/restore-snapshot", handler: vcsRestoreSnapshot as RouteHandler, body: (d) => ({ projectDir: d, id: HEX40_A }) },
  { name: "vcs/list-snapshots-page", handler: vcsListSnapshotsPage as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "vcs/enable-version-history", handler: vcsEnableVersionHistory as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "remote/sync", handler: remoteSync as RouteHandler, body: (d) => ({ projectDir: d }) },
  {
    name: "remote/resolve-sync-conflicts",
    handler: remoteResolveSyncConflicts as RouteHandler,
    body: (d) => ({
      projectDir: d,
      resolutions: [{ path: "chapter-01.md", choice: "mine" }],
      localId: HEX40_A,
      remoteId: HEX40_B,
    }),
  },
  { name: "remote/diagnose-project", handler: remoteDiagnoseProject as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "publish/run", handler: publishRun as RouteHandler, body: (d) => ({ projectDir: d, providerId: "itch" }) },
  { name: "publish/set-config", handler: publishSetConfig as RouteHandler, body: (d) => ({ projectDir: d, providerId: "itch", values: {} }) },
  { name: "publish/connect", handler: publishConnect as RouteHandler, body: (d) => ({ projectDir: d, providerId: "itch", token: "tok" }) },
  { name: "publish/list", handler: publishList as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "publish/preflight", handler: publishPreflight as RouteHandler, body: (d) => ({ projectDir: d, providerIds: [] }) },
  { name: "theme/apply", handler: themeApply as RouteHandler, body: (d) => ({ projectDir: d, target: { kind: "builtin", id: "classic" } }) },
  { name: "theme/remove", handler: themeRemove as RouteHandler, body: (d) => ({ projectDir: d, id: "some-theme" }) },
  { name: "theme/read-css", handler: themeReadCss as RouteHandler, body: (d) => ({ projectDir: d, source: { kind: "project", id: "some-theme" } }) },
  { name: "theme/import-from-url", handler: themeImportFromUrl as RouteHandler, body: (d) => ({ projectDir: d, url: "https://example.test/theme.css" }) },
  { name: "theme/import-from-file", handler: themeImportFromFile as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "theme/import-from-folder", handler: themeImportFromFolder as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "theme/active", handler: themeActive as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "theme/project", handler: themeProject as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "theme/previous", handler: themePrevious as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "theme/revert", handler: themeRevert as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "style/set-active", handler: styleSetActive as RouteHandler, body: (d) => ({ projectDir: d, paths: [] }) },
  { name: "project/list-styles", handler: projectListStyles as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "manifest/read", handler: manifestRead as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "manifest/set-fields", handler: manifestSetFields as RouteHandler, body: (d) => ({ projectDir: d, updates: { title: "pwned" } }) },
  { name: "plugin/set-enabled", handler: pluginSetEnabled as RouteHandler, body: (d) => ({ projectDir: d, ref: "some-plugin", enabled: true }) },
  { name: "plugin/list", handler: pluginList as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "plugin/add-local", handler: pluginAddLocal as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "plugin/validate", handler: pluginValidate as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "snip/save", handler: snipSave as RouteHandler, body: (d) => ({ projectDir: d, name: "snip", body: "text" }) },
  { name: "snip/read", handler: snipRead as RouteHandler, body: (d) => ({ projectDir: d, fileName: "snip.md" }) },
  { name: "snip/delete", handler: snipDelete as RouteHandler, body: (d) => ({ projectDir: d, fileName: "snip.md" }) },
  { name: "snip/list", handler: snipList as RouteHandler, body: (d) => ({ projectDir: d }) },
  { name: "tpl/save-as-template", handler: tplSaveAsTemplate as RouteHandler, body: (d) => ({ projectDir: d, name: "tpl" }) },
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
// handling without re-running 36 near-identical cases).

const SIBLING_CASES = [
  "vcs/restore-snapshot",
  "remote/sync",
  "publish/run",
  "theme/remove",
  "manifest/set-fields",
  "plugin/validate",
  "snip/save",
  "tpl/save-as-template",
];

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

test("a sibling book IS in scope for a repo-root session (both share the repo)", async () => {
  // The multi-project half: sibling books of the same repo are inside
  // `repoRoot`, so a repo-root session reaches them by design. This is not a
  // containment hole — it is R9's "a project is its git repo".
  const status = await statusOf(
    manifestRead({ request: request({ projectDir: siblingBook }) } as Parameters<typeof manifestRead>[0]),
  );
  expect(status).not.toBe(403);
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

// ── Real positive round-trips (200), not just "not 403" ──────────────────

test("manifest/read returns the open book's manifest fields", async () => {
  const res = (await manifestRead({ request: request({ projectDir: bookDir }) } as Parameters<
    typeof manifestRead
  >[0])) as Response;
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ title: "Field Guide" });
});

test("project/list-styles works for a repo-root-keyed project dir", async () => {
  await writeFile(path.join(repoRoot, "shared", "styles", "components.css"), "body{}", "utf8");
  const res = (await projectListStyles({ request: request({ projectDir: repoRoot }) } as Parameters<
    typeof projectListStyles
  >[0])) as Response;
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test("manifest/set-fields still writes inside the open book", async () => {
  const res = (await manifestSetFields({
    request: request({ projectDir: bookDir, updates: { title: "Renamed" } }),
  } as Parameters<typeof manifestSetFields>[0])) as Response;
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ title: "Renamed" });
});

// ── publish/run's artifactPath: the upload SOURCE, not just projectDir ────
//
// `artifactPath` is forwarded to `lib.runPublish`, which uploads that file to
// the configured provider with the author's stored credential — so an
// unchecked renderer-supplied value is a local-file-to-network exfiltration
// primitive, not merely an out-of-project read. It cannot simply be confined
// to the project either: desktop PDF exports go wherever the author chose in
// the Save dialog, which is the documented common case. So an out-of-project
// artifact must be a path a native picker actually returned — the same
// one-time-capability model `media:importImage`/`fs:copyFile` use for `src`.

function publishHost(roots: string[], picked: ReturnType<typeof createPickedFilesService>) {
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => roots, readOnlyRoots: () => [] as string[] },
      pickedFiles: picked,
      remote: {
        loadLib: async () => ({ runPublish: async () => ({ ok: true, outcome: { kind: "api" } }) }),
        tokenStore: {},
        GITHUB_HOST: "github.com",
      } as never,
    }),
  );
}

test("publish/run: an artifact inside the project is allowed", async () => {
  const picked = createPickedFilesService();
  publishHost([bookDir, repoRoot], picked);
  const artifact = path.join(bookDir, "dist", "book.pdf");
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, "%PDF-1.4", "utf8");
  const status = await statusOf(
    publishRun({ request: request({ projectDir: bookDir, providerId: "itch", artifactPath: artifact }) } as Parameters<
      typeof publishRun
    >[0]),
  );
  expect(status).not.toBe(403);
});

test("publish/run: an out-of-project artifact that was never picked is rejected (403)", async () => {
  const picked = createPickedFilesService();
  publishHost([bookDir, repoRoot], picked);
  const secret = path.join(outsideDir, "id_rsa");
  await writeFile(secret, "PRIVATE KEY", "utf8");
  const status = await statusOf(
    publishRun({ request: request({ projectDir: bookDir, providerId: "itch", artifactPath: secret }) } as Parameters<
      typeof publishRun
    >[0]),
  );
  expect(status).toBe(403);
});

test("publish/run: an out-of-project artifact the native picker returned is allowed", async () => {
  const picked = createPickedFilesService();
  publishHost([bookDir, repoRoot], picked);
  const exported = path.join(outsideDir, "book.pdf");
  await writeFile(exported, "%PDF-1.4", "utf8");
  picked.register([exported]); // what dialog/pick-pdf-file does with its result
  const status = await statusOf(
    publishRun({ request: request({ projectDir: bookDir, providerId: "itch", artifactPath: exported }) } as Parameters<
      typeof publishRun
    >[0]),
  );
  expect(status).not.toBe(403);
});

test("publish/run: a picked artifact survives the dry-run → publish sequence", async () => {
  // The wizard's "Check readiness" (dryRun) and the real publish are two
  // separate calls with the SAME artifactPath. A strictly one-time consume
  // would 403 the second one.
  const picked = createPickedFilesService();
  publishHost([bookDir, repoRoot], picked);
  const exported = path.join(outsideDir, "book.pdf");
  await writeFile(exported, "%PDF-1.4", "utf8");
  picked.register([exported]);
  const dry = await statusOf(
    publishRun({
      request: request({ projectDir: bookDir, providerId: "itch", artifactPath: exported, dryRun: true }),
    } as Parameters<typeof publishRun>[0]),
  );
  expect(dry).not.toBe(403);
  const real = await statusOf(
    publishRun({ request: request({ projectDir: bookDir, providerId: "itch", artifactPath: exported }) } as Parameters<
      typeof publishRun
    >[0]),
  );
  expect(real).not.toBe(403);
});

test("publish/run: a RELATIVE artifactPath resolves against the project, as the lib does", async () => {
  // run-publish.ts does `path.resolve(projectDir, artifactPath)`, so a
  // relative artifact is project-relative and must not need a picker.
  const picked = createPickedFilesService();
  publishHost([bookDir, repoRoot], picked);
  await mkdir(path.join(bookDir, "dist"), { recursive: true });
  await writeFile(path.join(bookDir, "dist", "book.pdf"), "%PDF-1.4", "utf8");
  const status = await statusOf(
    publishRun({
      request: request({ projectDir: bookDir, providerId: "itch", artifactPath: "dist/book.pdf" }),
    } as Parameters<typeof publishRun>[0]),
  );
  expect(status).not.toBe(403);
});

test("publish/run: a relative artifactPath cannot ../ its way out of the project", async () => {
  const picked = createPickedFilesService();
  publishHost([bookDir], picked); // book-only session, so the repo is outside
  const status = await statusOf(
    publishRun({
      request: request({
        projectDir: bookDir,
        providerId: "itch",
        artifactPath: path.join("..", "..", "..", "elsewhere", "id_rsa"),
      }),
    } as Parameters<typeof publishRun>[0]),
  );
  expect(status).toBe(403);
});

// ── shell/show-in-folder: the reveal target ───────────────────────────────
//
// This route had NO path validation at all — not even `requireAbsolute` — and
// handed whatever it was given to the OS file manager. It has three legitimate
// callers: a project media file, a crash-recovery backup zip under userData,
// and the exported PDF at the destination the author picked in the Save dialog
// (which is deliberately OUTSIDE the project). So it takes the same shape as
// publish/run's artifact: project + read-only roots, plus a path a native
// dialog produced.

function revealHost(picked: ReturnType<typeof createPickedFilesService>, revealed: string[]) {
  registerHostServices(
    makeHostServices({
      desktop: {
        getUserDataPath: () => base,
        showItemInFolder: (p: string) => {
          revealed.push(p);
        },
      },
      fsGuard: {
        projectRoots: () => [bookDir, repoRoot],
        readOnlyRoots: () => [path.join(base, "recovery")],
      },
      pickedFiles: picked,
    }),
  );
}

test("shell/show-in-folder: a project file is revealed", async () => {
  const revealed: string[] = [];
  revealHost(createPickedFilesService(), revealed);
  const target = path.join(bookDir, "images", "cover.png");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "png", "utf8");
  const res = (await showInFolder({ request: request({ filePath: target }) } as Parameters<
    typeof showInFolder
  >[0])) as Response;
  expect(res.status).toBe(200);
  expect(revealed).toEqual([target]);
});

test("shell/show-in-folder: a crash-recovery backup under userData is revealed", async () => {
  const revealed: string[] = [];
  revealHost(createPickedFilesService(), revealed);
  const zip = path.join(base, "recovery", "backup.zip");
  await mkdir(path.dirname(zip), { recursive: true });
  await writeFile(zip, "zip", "utf8");
  const res = (await showInFolder({ request: request({ filePath: zip }) } as Parameters<
    typeof showInFolder
  >[0])) as Response;
  expect(res.status).toBe(200);
  expect(revealed).toEqual([zip]);
});

test("shell/show-in-folder: an unrelated outside path is rejected and never revealed", async () => {
  const revealed: string[] = [];
  revealHost(createPickedFilesService(), revealed);
  const status = await statusOf(
    showInFolder({ request: request({ filePath: path.join(outsideDir, "secret.txt") }) } as Parameters<
      typeof showInFolder
    >[0]),
  );
  expect(status).toBe(403);
  expect(revealed).toEqual([]);
});

test("shell/show-in-folder: the exported PDF's chosen destination is revealed (twice)", async () => {
  // The export flow's "Show in Folder" toast action. The export controller
  // registers the PDF it actually wrote, so the reveal is authorized without
  // trusting the renderer's path — and the toast can be clicked more than once.
  const revealed: string[] = [];
  const picked = createPickedFilesService();
  revealHost(picked, revealed);
  const exported = path.join(outsideDir, "book.pdf");
  await writeFile(exported, "%PDF-1.4", "utf8");
  picked.register([exported]);
  for (const _ of [1, 2]) {
    const res = (await showInFolder({ request: request({ filePath: exported }) } as Parameters<
      typeof showInFolder
    >[0])) as Response;
    expect(res.status).toBe(200);
  }
  expect(revealed).toEqual([exported, exported]);
});

test("shell/show-in-folder: a relative path is a 400, not a silent reveal", async () => {
  const revealed: string[] = [];
  revealHost(createPickedFilesService(), revealed);
  const status = await statusOf(
    showInFolder({ request: request({ filePath: "rel/path.pdf" }) } as Parameters<typeof showInFolder>[0]),
  );
  expect(status).toBe(400);
  expect(revealed).toEqual([]);
});

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
      manifestSetFields({
        request: request({ projectDir: alias, updates: { title: "pwned" } }),
      } as Parameters<typeof manifestSetFields>[0]),
    );
    expect(status).toBe(403);
  },
);
