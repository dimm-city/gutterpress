/**
 * IPC-handler tests for `electron/api/media.ts` (SFE-P5c2 — migrated off
 * `src/routes/api/media/{list-images,inspect,thumbnail,import-image}/
 * +server.ts`, all deleted). Combines the deleted `media-routes-scoping.
 * test.ts` (ARCH review #37's project-scoping guard on list-images/
 * inspect/thumbnail) and `media-import-image-route.test.ts` (UX review M10's
 * import-policy pinning: inside/outside/sibling-prefix containment,
 * images/-vs-assets/ destination selection, name-collision de-duplication,
 * and the PR #98 symlink-escape fixes) into one suite calling the IPC
 * handler functions directly.
 *
 * Error semantics: IPC has no HTTP status code, so every assertion here
 * checks the REJECTED promise's message — the same text the deleted routes
 * used to send as the response body.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink, readdir } from "node:fs/promises";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, type HostServices, getHostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";
import { mediaListImages, mediaInspect, mediaThumbnail, mediaImportImage } from "../../electron/api/media";

async function caught(p: Promise<unknown>): Promise<{ message: string }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
  }
}

// ── project-scoping guard (list-images/inspect/thumbnail) ─────────────────

let projectDir: string;
let siblingDir: string;
let outsideDir: string;

async function withScopingFixture(fn: () => Promise<void>): Promise<void> {
  const base = await mkdtemp(path.join(tmpdir(), "gutterpress-media-guard-"));
  projectDir = path.join(base, "proj");
  siblingDir = path.join(base, "proj2");
  outsideDir = path.join(base, "elsewhere");
  await mkdir(projectDir, { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(projectDir, "chapter-01.md"), "# In project", "utf8");
  await writeFile(path.join(siblingDir, "secret.md"), "# Sibling project", "utf8");
  await writeFile(path.join(outsideDir, "secret.txt"), "outside content", "utf8");

  // Host services are process-global — save/restore so this fixture never
  // leaks into a sibling test file.
  const saved = getHostServices();
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [] },
    }),
  );
  try {
    await fn();
  } finally {
    registerHostServices(saved as HostServices);
    await rm(base, { recursive: true, force: true });
  }
}

test("media:listImages: an in-project dir is allowed", async () => {
  await withScopingFixture(async () => {
    expect(await mediaListImages(projectDir)).toBeInstanceOf(Array);
  });
});

test("media:listImages: a directory outside the open project is rejected", async () => {
  await withScopingFixture(async () => {
    const { message } = await caught(mediaListImages(outsideDir));
    expect(message).toBe("media:listImages: path is outside the open project");
  });
});

test("media:inspect: an image path outside the open project is rejected", async () => {
  await withScopingFixture(async () => {
    const { message } = await caught(mediaInspect(path.join(outsideDir, "secret.txt")));
    expect(message).toBe("media:inspect: path is outside the open project");
  });
});

test("media:thumbnail: an image path outside the open project is rejected", async () => {
  await withScopingFixture(async () => {
    const { message } = await caught(mediaThumbnail(path.join(siblingDir, "secret.md")));
    expect(message).toBe("media:thumbnail: path is outside the open project");
  });
});

// ── media:importImage — import policy (UX review M10) ─────────────────────

const canSymlink = (() => {
  const probeBase = mkdtempSync(path.join(tmpdir(), "gutterpress-media-import-symlink-probe-"));
  try {
    const target = path.join(probeBase, "target");
    mkdirSync(target);
    symlinkSync(target, path.join(probeBase, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeBase, { recursive: true, force: true });
  }
})();

let base: string;
let importProjectDir: string;
let importSiblingDir: string; // shares a string prefix with importProjectDir but is a DIFFERENT directory
let importOutsideDir: string;
let savedHostServices: HostServices | null;
let pickedFiles: ReturnType<typeof createPickedFilesService>;

beforeEach(async () => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file.
  savedHostServices = getHostServices();

  base = await mkdtemp(path.join(tmpdir(), "gutterpress-media-import-"));
  importProjectDir = path.join(base, "proj");
  importSiblingDir = path.join(base, "proj2"); // "proj" + "2" — the sibling-prefix case
  importOutsideDir = path.join(base, "elsewhere");
  await mkdir(importProjectDir, { recursive: true });
  await mkdir(importSiblingDir, { recursive: true });
  await mkdir(importOutsideDir, { recursive: true });

  pickedFiles = createPickedFilesService();
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => [importProjectDir], readOnlyRoots: () => [] },
      pickedFiles,
    }),
  );
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

test("src already inside the project: returns the relative path, copies nothing", async () => {
  await mkdir(path.join(importProjectDir, "sub"), { recursive: true });
  const src = path.join(importProjectDir, "sub", "img.png");
  await writeFile(src, "already-here", "utf8");

  expect(await mediaImportImage(importProjectDir, src)).toEqual({ src: "sub/img.png", copied: false });
});

test("sibling dir with a shared string prefix is NOT treated as inside — it gets copied in", async () => {
  const src = path.join(importSiblingDir, "cover.png");
  await writeFile(src, "sibling-content", "utf8");
  pickedFiles.register([src]); // simulate: the native dialog just returned this path

  const body = await mediaImportImage(importProjectDir, src);
  expect(body).toEqual({ src: "assets/cover.png", copied: true });
  expect(await readFile(path.join(importProjectDir, "assets", "cover.png"), "utf8")).toBe("sibling-content");
});

test("outside the project, no images/ dir yet: copies into assets/ (created on demand)", async () => {
  const src = path.join(importOutsideDir, "photo.jpg");
  await writeFile(src, "outside-content", "utf8");
  pickedFiles.register([src]);

  expect(await mediaImportImage(importProjectDir, src)).toEqual({ src: "assets/photo.jpg", copied: true });
  expect(await readFile(path.join(importProjectDir, "assets", "photo.jpg"), "utf8")).toBe("outside-content");
});

test("outside the project, an existing images/ dir wins over assets/", async () => {
  await mkdir(path.join(importProjectDir, "images"), { recursive: true });
  const src = path.join(importOutsideDir, "photo.jpg");
  await writeFile(src, "outside-content", "utf8");
  pickedFiles.register([src]);

  expect(await mediaImportImage(importProjectDir, src)).toEqual({ src: "images/photo.jpg", copied: true });
  expect(await readFile(path.join(importProjectDir, "images", "photo.jpg"), "utf8")).toBe("outside-content");
});

test("a colliding basename in the destination gets a de-duplicated name, original untouched", async () => {
  await mkdir(path.join(importProjectDir, "assets"), { recursive: true });
  await writeFile(path.join(importProjectDir, "assets", "cover.png"), "original", "utf8");
  const src = path.join(importOutsideDir, "cover.png");
  await writeFile(src, "new-cover", "utf8");
  pickedFiles.register([src]);

  expect(await mediaImportImage(importProjectDir, src)).toEqual({ src: "assets/cover-2.png", copied: true });
  expect(await readFile(path.join(importProjectDir, "assets", "cover.png"), "utf8")).toBe("original");
  expect(await readFile(path.join(importProjectDir, "assets", "cover-2.png"), "utf8")).toBe("new-cover");
});

test("two successive imports of differently-named files never collide with each other", async () => {
  const srcA = path.join(importOutsideDir, "cover.png");
  await writeFile(srcA, "a", "utf8");
  pickedFiles.register([srcA]);
  expect(await mediaImportImage(importProjectDir, srcA)).toEqual({ src: "assets/cover.png", copied: true });

  const srcB = path.join(importOutsideDir, "cover-b.png");
  await writeFile(srcB, "b", "utf8");
  pickedFiles.register([srcB]);
  expect(await mediaImportImage(importProjectDir, srcB)).toEqual({ src: "assets/cover-b.png", copied: true });
});

test("project/assets symlinked to an outside directory: import is REJECTED, nothing written outside", async () => {
  const outsideTarget = path.join(base, "outside-assets-target");
  await mkdir(outsideTarget, { recursive: true });
  await symlink(outsideTarget, path.join(importProjectDir, "assets"), "dir");

  const src = path.join(importOutsideDir, "photo.png");
  await writeFile(src, "escape-payload", "utf8");
  pickedFiles.register([src]);

  const { message } = await caught(mediaImportImage(importProjectDir, src));
  expect(message).toBe("media:importImage: path is outside the open project");

  // Nothing should have been written into the symlink target outside the project.
  expect(await readdir(outsideTarget)).toEqual([]);
});

test.skipIf(!canSymlink)(
  "a dangling symlink at the computed destPath, pointing outside the project, is rejected; nothing is created outside",
  async () => {
    await mkdir(path.join(importProjectDir, "assets"), { recursive: true });
    const outsideTargetParent = path.join(base, "outside-dangling-parent");
    await mkdir(outsideTargetParent, { recursive: true });
    const danglingTarget = path.join(outsideTargetParent, "planted.png"); // parent exists, leaf does not
    // Plant the dangling symlink at the EXACT name the import will try to use.
    await symlink(danglingTarget, path.join(importProjectDir, "assets", "cover.png"), "file");

    const src = path.join(importOutsideDir, "cover.png");
    await writeFile(src, "escape-payload", "utf8");
    pickedFiles.register([src]);

    const { message } = await caught(mediaImportImage(importProjectDir, src));
    expect(message).toBe("media:importImage: path is outside the open project");

    // Nothing should have been created at the dangling symlink's outside target.
    await expect(readFile(danglingTarget, "utf8")).rejects.toThrow();
  },
);

test("project/assets is a normal (non-symlink) directory: import still succeeds", async () => {
  const src = path.join(importOutsideDir, "photo.png");
  await writeFile(src, "normal-content", "utf8");
  pickedFiles.register([src]);

  expect(await mediaImportImage(importProjectDir, src)).toEqual({ src: "assets/photo.png", copied: true });
  expect(await readFile(path.join(importProjectDir, "assets", "photo.png"), "utf8")).toBe("normal-content");
});

test("projectDir outside the currently-open project is rejected", async () => {
  const src = path.join(importOutsideDir, "photo.jpg");
  await writeFile(src, "x", "utf8");
  const { message } = await caught(mediaImportImage(importSiblingDir, src));
  expect(message).toBe("media:importImage: path is outside the open project");
});

test("fails closed when no project is open (empty projectRoots)", async () => {
  registerHostServices({
    ...(getHostServices()!),
    fsGuard: { projectRoots: () => [], readOnlyRoots: () => [] },
  } as HostServices);
  const src = path.join(importOutsideDir, "photo.jpg");
  await writeFile(src, "x", "utf8");
  const { message } = await caught(mediaImportImage(importProjectDir, src));
  expect(message).toBe("media:importImage: path is outside the open project");
});

test("relative projectDir/src are rejected", async () => {
  const { message } = await caught(mediaImportImage("relative/dir", "relative/img.png"));
  expect(message).toBe("media:importImage requires an absolute path, got: relative/dir");
});
