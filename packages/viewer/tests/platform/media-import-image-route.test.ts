import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";
import { POST as importImageRoute } from "../../src/routes/api/media/import-image/+server";

// UX review M10: EditorToolbar's "Insert Image" dialog and MediaPanel's "Add
// images…" used to each hand-roll project-relative path math in the
// renderer, disagreed on destination (`assets/` vs `images/`), and the
// toolbar's "already inside the project" check was a raw `startsWith` prefix
// match — so a SIBLING directory that merely shares a string prefix
// (`/tmp/x/proj2` vs `/tmp/x/proj`) was wrongly treated as "inside" and
// silently skipped the copy, producing a src that pointed at a nonexistent
// file. These tests pin the ONE host-side route that now owns that policy:
// inside/outside/sibling-prefix containment, images/-vs-assets/ destination
// selection, and name-collision de-duplication.
//
// P1 review: a `src` OUTSIDE the project must now be a one-time picked-file
// capability (`electron/server-bridge/picked-files.ts`) — see
// picked-files-capability.test.ts for the tests pinning that requirement
// itself (an un-picked src is rejected, a picked one is consumed on first
// use). The destination/dedup tests below aren't about that guard, so they
// call `pickedFiles.register([src])` first to simulate "the native dialog
// just returned this path" and keep exercising the behavior they're actually
// about.

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

let base: string;
let projectDir: string;
let siblingDir: string; // shares a string prefix with projectDir but is a DIFFERENT directory
let outsideDir: string;
let savedHostServices: HostServices | null;
let pickedFiles: ReturnType<typeof createPickedFilesService>;

beforeEach(async () => {
  // This suite intentionally calls registerHostServices (like the sibling
  // fs-routes-scoping.test.ts does) to exercise the project-scoping guard.
  // Host services are process-global (electron/server-bridge/host-services.ts),
  // so this saves and restores whatever was registered before this file ran —
  // the same defensive convention `sveltekit-host.test.ts` / other route-test
  // files use — so this file's fixture never leaks into a sibling test file's
  // "nothing registered yet" assertions (e.g. doctor-route.test.ts,
  // host-services.test.ts).
  savedHostServices = (await import("../../electron/server-bridge/host-services")).getHostServices();

  base = await mkdtemp(path.join(tmpdir(), "pmd-media-import-"));
  projectDir = path.join(base, "proj");
  siblingDir = path.join(base, "proj2"); // "proj" + "2" — the sibling-prefix case
  outsideDir = path.join(base, "elsewhere");
  await mkdir(projectDir, { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });

  const fsGuard = { projectRoots: () => [projectDir], readOnlyRoots: () => [] };
  const noop = () => {};
  pickedFiles = createPickedFilesService();
  const services = {
    app: { updateSplash: noop, showMainWindowAndCloseSplash: noop, setRendererDirty: noop, resolveFlush: noop, sendToRenderer: noop },
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
    fsGuard,
    media: { createThumbnail: async () => null },
    pickedFiles,
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
    vcs: { loadLib: async () => ({}), operationLogPath: () => "/fake/log" },
    watch: { startFolderWatch: noop, stopFolderWatch: noop, getWatchedDir: () => null },
    write: { scheduleAutoSnapshot: noop, scheduleAutoSync: noop, getWatchedDir: () => null },
  } as unknown as HostServices;
  registerHostServices(services);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

// ── already inside the project ──────────────────────────────────────────────

test("src already inside the project: returns the relative path, copies nothing", async () => {
  await mkdir(path.join(projectDir, "sub"), { recursive: true });
  const src = path.join(projectDir, "sub", "img.png");
  await writeFile(src, "already-here", "utf8");

  const res = await importImageRoute({
    request: request({ projectDir, src }),
  } as Parameters<typeof importImageRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ src: "sub/img.png", copied: false });
});

// ── sibling-prefix containment (the regression this route fixes) ───────────

test("sibling dir with a shared string prefix is NOT treated as inside — it gets copied in", async () => {
  const src = path.join(siblingDir, "cover.png");
  await writeFile(src, "sibling-content", "utf8");
  pickedFiles.register([src]); // simulate: the native dialog just returned this path

  const res = await importImageRoute({
    request: request({ projectDir, src }),
  } as Parameters<typeof importImageRoute>[0]);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { src: string; copied: boolean };
  expect(body.copied).toBe(true);
  expect(body.src).toBe("assets/cover.png");
  expect(await readFile(path.join(projectDir, "assets", "cover.png"), "utf8")).toBe(
    "sibling-content",
  );
});

// ── outside-project destination selection ──────────────────────────────────

test("outside the project, no images/ dir yet: copies into assets/ (created on demand)", async () => {
  const src = path.join(outsideDir, "photo.jpg");
  await writeFile(src, "outside-content", "utf8");
  pickedFiles.register([src]);

  const res = await importImageRoute({
    request: request({ projectDir, src }),
  } as Parameters<typeof importImageRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ src: "assets/photo.jpg", copied: true });
  expect(await readFile(path.join(projectDir, "assets", "photo.jpg"), "utf8")).toBe(
    "outside-content",
  );
});

test("outside the project, an existing images/ dir wins over assets/", async () => {
  await mkdir(path.join(projectDir, "images"), { recursive: true });
  const src = path.join(outsideDir, "photo.jpg");
  await writeFile(src, "outside-content", "utf8");
  pickedFiles.register([src]);

  const res = await importImageRoute({
    request: request({ projectDir, src }),
  } as Parameters<typeof importImageRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ src: "images/photo.jpg", copied: true });
  expect(await readFile(path.join(projectDir, "images", "photo.jpg"), "utf8")).toBe(
    "outside-content",
  );
});

// ── name collisions ──────────────────────────────────────────────────────────

test("a colliding basename in the destination gets a de-duplicated name, original untouched", async () => {
  await mkdir(path.join(projectDir, "assets"), { recursive: true });
  await writeFile(path.join(projectDir, "assets", "cover.png"), "original", "utf8");
  const src = path.join(outsideDir, "cover.png");
  await writeFile(src, "new-cover", "utf8");
  pickedFiles.register([src]);

  const res = await importImageRoute({
    request: request({ projectDir, src }),
  } as Parameters<typeof importImageRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ src: "assets/cover-2.png", copied: true });
  expect(await readFile(path.join(projectDir, "assets", "cover.png"), "utf8")).toBe("original");
  expect(await readFile(path.join(projectDir, "assets", "cover-2.png"), "utf8")).toBe("new-cover");
});

test("two successive imports of differently-named files never collide with each other", async () => {
  const srcA = path.join(outsideDir, "cover.png");
  await writeFile(srcA, "a", "utf8");
  pickedFiles.register([srcA]);
  const resA = await importImageRoute({
    request: request({ projectDir, src: srcA }),
  } as Parameters<typeof importImageRoute>[0]);
  expect(await resA.json()).toEqual({ src: "assets/cover.png", copied: true });

  const srcB = path.join(outsideDir, "cover-b.png");
  await writeFile(srcB, "b", "utf8");
  pickedFiles.register([srcB]);
  const resB = await importImageRoute({
    request: request({ projectDir, src: srcB }),
  } as Parameters<typeof importImageRoute>[0]);
  expect(await resB.json()).toEqual({ src: "assets/cover-b.png", copied: true });
});

// ── destDir containment (symlinked assets/, PR #98 maintainer review) ──────
//
// `projectDir` is canonicalized, but the destination this route computes
// (`projectDir/assets` or `projectDir/images`) was NOT — a `call`-derived path
// assembled AFTER validate, never re-checked. If the project's `assets/` is a
// symlink aliasing a directory OUTSIDE the project, the pre-fix route still
// returns 200 with a project-relative `src` while `copyFile` actually writes
// the image outside the project tree entirely.

test("project/assets symlinked to an outside directory: import is REJECTED (403), nothing written outside", async () => {
  const outsideTarget = path.join(base, "outside-assets-target");
  await mkdir(outsideTarget, { recursive: true });
  await symlink(outsideTarget, path.join(projectDir, "assets"), "dir");

  const src = path.join(outsideDir, "photo.png");
  await writeFile(src, "escape-payload", "utf8");
  pickedFiles.register([src]);

  const { status, message } = await caught(
    importImageRoute({
      request: request({ projectDir, src }),
    } as Parameters<typeof importImageRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("media:importImage: path is outside the open project");

  // Nothing should have been written into the symlink target outside the project.
  const outsideEntries = await readdir(outsideTarget);
  expect(outsideEntries).toEqual([]);
});

test("project/assets is a normal (non-symlink) directory: import still succeeds", async () => {
  const src = path.join(outsideDir, "photo.png");
  await writeFile(src, "normal-content", "utf8");
  pickedFiles.register([src]);

  const res = await importImageRoute({
    request: request({ projectDir, src }),
  } as Parameters<typeof importImageRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ src: "assets/photo.png", copied: true });
  expect(await readFile(path.join(projectDir, "assets", "photo.png"), "utf8")).toBe(
    "normal-content",
  );
});

// ── project-scoping guard ───────────────────────────────────────────────────

test("projectDir outside the currently-open project is rejected (403)", async () => {
  const src = path.join(outsideDir, "photo.jpg");
  await writeFile(src, "x", "utf8");
  const { status, message } = await caught(
    importImageRoute({
      request: request({ projectDir: siblingDir, src }),
    } as Parameters<typeof importImageRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("media:importImage: path is outside the open project");
});

test("fails closed (403) when no project is open (empty projectRoots)", async () => {
  registerHostServices({
    ...(await import("../../electron/server-bridge/host-services")).getHostServices()!,
    fsGuard: { projectRoots: () => [], readOnlyRoots: () => [] },
  } as HostServices);
  const src = path.join(outsideDir, "photo.jpg");
  await writeFile(src, "x", "utf8");
  const { status } = await caught(
    importImageRoute({
      request: request({ projectDir, src }),
    } as Parameters<typeof importImageRoute>[0]),
  );
  expect(status).toBe(403);
});

test("relative projectDir/src are rejected (400)", async () => {
  const { status } = await caught(
    importImageRoute({
      request: request({ projectDir: "relative/dir", src: "relative/img.png" }),
    } as Parameters<typeof importImageRoute>[0]),
  );
  expect(status).toBe(400);
});
