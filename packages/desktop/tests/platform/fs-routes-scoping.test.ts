import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink } from "node:fs/promises";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";
import { POST as readFileRoute } from "../../src/routes/api/fs/read-file/+server";
import { POST as writeFileRoute } from "../../src/routes/api/fs/write-file/+server";
import { POST as listDirRoute } from "../../src/routes/api/fs/list-dir/+server";
import { POST as statFileRoute } from "../../src/routes/api/fs/stat-file/+server";
import { POST as copyFileRoute } from "../../src/routes/api/fs/copy-file/+server";
import { POST as listProjectFilesRoute } from "../../src/routes/api/fs/list-project-files/+server";
import { POST as listImagesRoute } from "../../src/routes/api/media/list-images/+server";
import { POST as inspectImageRoute } from "../../src/routes/api/media/inspect/+server";
import { POST as thumbnailRoute } from "../../src/routes/api/media/thumbnail/+server";
import { POST as logReadRoute } from "../../src/routes/api/log/read/+server";
import { POST as keepImageVersionRoute } from "../../src/routes/api/sync/keep-image-version/+server";

// ARCH review #37: `/api/fs/{read-file,write-file,list-dir,stat-file,
// copy-file}` used to accept ANY absolute path (only guard: isAbsolute).
// These pin the project-scoping guard: inside the open project is allowed,
// a sibling directory with a shared string prefix is rejected (the
// "/home/u/proj" vs "/home/u/proj2" regression), anything else outside is
// rejected, and read-file's crash-recovery sidecar allowance is locked in
// rather than accidentally tightened or loosened later.
//
// `copy-file`'s `src` is deliberately exempt from THIS module's project-root
// allow-lists (it needs to reach anywhere on disk to copy an author-picked
// file in) — but P1 review found that exemption had NOTHING else backing it
// up, so an outside `src` is now gated by a separate one-time picked-file
// capability instead (`electron/server-bridge/picked-files.ts`). See
// picked-files-capability.test.ts for the tests pinning that guard itself;
// the one `copy-file` test below just simulates "the src was picked" via
// `pickedFiles.register(...)` so it can keep testing the allow-list
// interaction (dest confinement) it's actually about.

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

// Probe symlink support ONCE at module load (synchronously, before any
// `test.skipIf` gate is evaluated) — sandboxed/restricted CI runners or
// non-admin Windows can't create symlinks. CI linux can, so this is expected
// to stay `true` there; the skip exists purely so the suite degrades
// gracefully elsewhere rather than failing on an environment limitation.
const canSymlink = (() => {
  const base = mkdtempSync(path.join(tmpdir(), "gutterpress-fs-guard-symlink-probe-"));
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

let projectDir: string;
let siblingDir: string; // shares a string prefix with projectDir but is a DIFFERENT directory
let outsideDir: string;
let recoveryDir: string;
let aliasPath: string; // projectDir/alias — not created by default, see createAlias()
let pickedFiles: ReturnType<typeof createPickedFilesService>;

/**
 * Create a project-LOCAL symlink (`projectDir/alias`) whose real target is
 * OUTSIDE the project — the exact escape the P1 review flagged:
 * `path.resolve()` only normalizes lexical segments (`..`, `.`), so
 * `projectDir/alias/secret.txt` passes a lexical containment check even
 * though the filesystem call that follows lands in `outsideDir`.
 *
 * Created lazily, per-test, rather than in `beforeEach` for every test: an
 * extra `alias` entry under `projectDir` would otherwise change the baseline
 * `fs/list-dir: the open project dir is allowed` listing (unrelated to this
 * guard) for every test in the file, not just the ones about the escape.
 */
async function createAlias(): Promise<string> {
  await symlink(outsideDir, aliasPath, "dir");
  return aliasPath;
}

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "gutterpress-fs-guard-"));
  projectDir = path.join(base, "proj");
  siblingDir = path.join(base, "proj2"); // "proj" + "2" — the sibling-prefix case
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

  pickedFiles = createPickedFilesService();
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [recoveryDir] },
      pickedFiles,
    }),
  );
});

afterEach(async () => {
  await rm(path.dirname(projectDir), { recursive: true, force: true });
});

// ── read-file ────────────────────────────────────────────────────────────

test("fs/read-file: a path inside the open project is allowed", async () => {
  const res = await readFileRoute({
    request: request({ path: path.join(projectDir, "chapter-01.md") }),
  } as Parameters<typeof readFileRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("# In project");
});

test("fs/read-file: a sibling dir with a shared string prefix is rejected (403)", async () => {
  const { status, message } = await caught(
    readFileRoute({ request: request({ path: path.join(siblingDir, "secret.md") }) } as Parameters<typeof readFileRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("fs:readFile: path is outside the open project");
});

test("fs/read-file: an unrelated outside path is rejected (403)", async () => {
  const { status } = await caught(
    readFileRoute({ request: request({ path: path.join(outsideDir, "secret.txt") }) } as Parameters<typeof readFileRoute>[0]),
  );
  expect(status).toBe(403);
});

test("fs/read-file: the crash-recovery sidecar dir is a PINNED exemption", async () => {
  const res = await readFileRoute({
    request: request({ path: path.join(recoveryDir, "snap.md") }),
  } as Parameters<typeof readFileRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("# Recovered");
});

// ── write-file ───────────────────────────────────────────────────────────

test("fs/write-file: a path inside the open project is allowed", async () => {
  const target = path.join(projectDir, "new-chapter.md");
  const res = await writeFileRoute({
    request: request({ path: target, content: "# New" }),
  } as Parameters<typeof writeFileRoute>[0]);
  expect(res.status).toBe(200);
  expect(await readFile(target, "utf8")).toBe("# New");
});

test("fs/write-file: notifies the active preview after the write is settled", async () => {
  const target = path.join(projectDir, "saved-chapter.md");
  const notifications: Array<{ path: string; content: string }> = [];
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [recoveryDir] },
      pickedFiles,
      write: {
        notifyPreviewSettledWrite: (writtenPath: string, content: string) => {
          notifications.push({ path: writtenPath, content });
        },
      },
    }),
  );

  const res = await writeFileRoute({
    request: request({ path: target, content: "# Saved now" }),
  } as Parameters<typeof writeFileRoute>[0]);

  expect(res.status).toBe(200);
  expect(await readFile(target, "utf8")).toBe("# Saved now");
  expect(notifications).toEqual([{ path: target, content: "# Saved now" }]);
});

test("fs/write-file: a sibling dir with a shared string prefix is rejected (403), file untouched", async () => {
  const target = path.join(siblingDir, "overwrite.md");
  const { status, message } = await caught(
    writeFileRoute({ request: request({ path: target, content: "pwned" }) } as Parameters<typeof writeFileRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("fs:writeFile: path is outside the open project");
  await expect(readFile(target, "utf8")).rejects.toThrow();
});

test("fs/write-file: the crash-recovery dir is NOT a write exemption (403)", async () => {
  const { status } = await caught(
    writeFileRoute({
      request: request({ path: path.join(recoveryDir, "snap.md"), content: "pwned" }),
    } as Parameters<typeof writeFileRoute>[0]),
  );
  expect(status).toBe(403);
});

// ── list-dir ─────────────────────────────────────────────────────────────

test("fs/list-dir: the open project dir is allowed", async () => {
  const res = await listDirRoute({ request: request({ path: projectDir }) } as Parameters<typeof listDirRoute>[0]);
  expect(res.status).toBe(200);
  const entries = (await res.json()) as Array<{ name: string }>;
  expect(entries.map((e) => e.name)).toEqual(["chapter-01.md"]);
});

test("fs/list-dir: a sibling dir with a shared string prefix is rejected (403)", async () => {
  const { status } = await caught(
    listDirRoute({ request: request({ path: siblingDir }) } as Parameters<typeof listDirRoute>[0]),
  );
  expect(status).toBe(403);
});

// ── stat-file ────────────────────────────────────────────────────────────

test("fs/stat-file: a path inside the open project is allowed", async () => {
  const res = await statFileRoute({
    request: request({ path: path.join(projectDir, "chapter-01.md") }),
  } as Parameters<typeof statFileRoute>[0]);
  expect(res.status).toBe(200);
  expect((await res.json()) as { exists: boolean }).toMatchObject({ exists: true });
});

test("fs/stat-file: an outside path is rejected (403)", async () => {
  const { status } = await caught(
    statFileRoute({ request: request({ path: path.join(outsideDir, "secret.txt") }) } as Parameters<typeof statFileRoute>[0]),
  );
  expect(status).toBe(403);
});

// ── copy-file ────────────────────────────────────────────────────────────

test("fs/copy-file: a PICKED src OUTSIDE the project is allowed (the image-picker import flow) — dest inside is allowed", async () => {
  const src = path.join(outsideDir, "secret.txt");
  pickedFiles.register([src]); // simulate: the native dialog just returned this path
  const res = await copyFileRoute({
    request: request({ src, dest: path.join(projectDir, "assets") }),
  } as Parameters<typeof copyFileRoute>[0]);
  expect(res.status).toBe(200);
  const destPath = (await res.json()) as string;
  expect(await readFile(destPath, "utf8")).toBe("outside content");
});

test("fs/copy-file: dest OUTSIDE the project is rejected (403) even with an in-project src", async () => {
  const { status, message } = await caught(
    copyFileRoute({
      request: request({ src: path.join(projectDir, "chapter-01.md"), dest: siblingDir }),
    } as Parameters<typeof copyFileRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("fs:copyFile: path is outside the open project");
});

// `validate` only confines the DESTINATION DIRECTORY — the FINAL write path
// (`dest/basename(src)`) was never re-checked before `copyFile`. `copyFile`
// follows destination symlinks the same way `open(path, "w")` does, so if an
// attacker (or a stray leftover file) already planted a symlink at that exact
// path pointing OUTSIDE the project, the pre-fix route would silently
// overwrite the external target while still reporting 200 (maintainer
// review, PR #98, finding #6a).
test.skipIf(!canSymlink)(
  "fs/copy-file: <dest>/<basename(src)> is itself a symlink to an outside target — rejected (403), outside target untouched",
  async () => {
    const destDir = path.join(projectDir, "assets");
    await mkdir(destDir, { recursive: true });
    const outsideTarget = path.join(outsideDir, "victim.txt");
    await writeFile(outsideTarget, "original outside content", "utf8");
    const src = path.join(projectDir, "chapter-01.md"); // in-project src — needs no picker capability
    // Plant a symlink at the EXACT computed destination path
    // (destDir/basename(src)) pointing outside the project.
    await symlink(outsideTarget, path.join(destDir, path.basename(src)), "file");

    const { status, message } = await caught(
      copyFileRoute({
        request: request({ src, dest: destDir }),
      } as Parameters<typeof copyFileRoute>[0]),
    );
    expect(status).toBe(403);
    expect(message).toBe("fs:copyFile: path is outside the open project");
    expect(await readFile(outsideTarget, "utf8")).toBe("original outside content");
  },
);

// ── no project open ─────────────────────────────────────────────────────

test("fs/read-file: fails closed (403) when no project is open (empty projectRoots)", async () => {
  registerHostServices({
    ...(await import("../../electron/server-bridge/host-services")).getHostServices()!,
    fsGuard: { projectRoots: () => [], readOnlyRoots: () => [] },
  } as HostServices);
  const { status } = await caught(
    readFileRoute({ request: request({ path: path.join(projectDir, "chapter-01.md") }) } as Parameters<typeof readFileRoute>[0]),
  );
  expect(status).toBe(403);
});

// ── fs/list-project-files (code-review: the one generic fs route the #37
//    sweep missed — a readdir on any absolute path) ────────────────────────

test("fs/list-project-files: an in-project dir is allowed", async () => {
  const res = await listProjectFilesRoute({
    request: request({ projectDir }),
  } as Parameters<typeof listProjectFilesRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ md: ["chapter-01.md"], css: [] });
});

test("fs/list-project-files: a directory outside the open project is rejected (403)", async () => {
  const { status, message } = await caught(
    listProjectFilesRoute({ request: request({ projectDir: outsideDir }) } as Parameters<typeof listProjectFilesRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("fs:listProjectFiles: path is outside the open project");
});

test("fs/list-project-files: a sibling-prefix dir is rejected (403)", async () => {
  const { status } = await caught(
    listProjectFilesRoute({ request: request({ projectDir: siblingDir }) } as Parameters<typeof listProjectFilesRoute>[0]),
  );
  expect(status).toBe(403);
});

// ── media routes (code-review: thumbnail/inspect/list-images read arbitrary
//    image bytes/trees without the #37 guard) ───────────────────────────────

test("media/list-images: an in-project dir is allowed", async () => {
  const res = await listImagesRoute({
    request: request({ projectDir }),
  } as Parameters<typeof listImagesRoute>[0]);
  expect(res.status).toBe(200);
});

test("media/list-images: a directory outside the open project is rejected (403)", async () => {
  const { status, message } = await caught(
    listImagesRoute({ request: request({ projectDir: outsideDir }) } as Parameters<typeof listImagesRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("media:listImages: path is outside the open project");
});

test("media/inspect: an image path outside the open project is rejected (403)", async () => {
  const { status, message } = await caught(
    inspectImageRoute({ request: request({ imagePath: path.join(outsideDir, "secret.txt") }) } as Parameters<typeof inspectImageRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("media:inspect: path is outside the open project");
});

test("media/thumbnail: an image path outside the open project is rejected (403)", async () => {
  const { status, message } = await caught(
    thumbnailRoute({ request: request({ imagePath: path.join(siblingDir, "secret.md") }) } as Parameters<typeof thumbnailRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("media:thumbnail: path is outside the open project");
});

// ── log/read (code-review: read any absolute path's full contents) ─────────

test("log/read: a path under the read-only root (operation logs / recovery) is allowed", async () => {
  await writeFile(path.join(recoveryDir, "op.log"), "log line", "utf8");
  const res = await logReadRoute({
    request: request({ logPath: path.join(recoveryDir, "op.log") }),
  } as Parameters<typeof logReadRoute>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("log line");
});

test("log/read: an absolute path outside the read-allow-list is rejected (403)", async () => {
  const { status, message } = await caught(
    logReadRoute({ request: request({ logPath: path.join(outsideDir, "secret.txt") }) } as Parameters<typeof logReadRoute>[0]),
  );
  expect(status).toBe(403);
  expect(message).toBe("log:read: path is outside the open project");
});

// ── sync/keep-image-version: `projectDir` is confined to the open project,
//    and the derived WRITE target (`projectDir` + the caller-supplied
//    relative `path`) is confined CANONICALLY — a project-local symlink
//    aliasing an outside directory must not receive the written bytes
//    (same policy the plain fs routes enforce). ──────────────────────────

test("sync/keep-image-version: a projectDir outside the open project is rejected (403)", async () => {
  const { status } = await caught(
    keepImageVersionRoute({
      request: request({ projectDir: outsideDir, path: "cover.png", oid: "c".repeat(40) }),
    } as Parameters<typeof keepImageVersionRoute>[0]),
  );
  expect(status).toBe(403);
});

test("sync/keep-image-version: a sibling-prefix projectDir is rejected (403)", async () => {
  const { status } = await caught(
    keepImageVersionRoute({
      request: request({ projectDir: siblingDir, path: "cover.png", oid: "c".repeat(40) }),
    } as Parameters<typeof keepImageVersionRoute>[0]),
  );
  expect(status).toBe(403);
});

test("sync/keep-image-version: fails closed (403) when no project is open (empty projectRoots)", async () => {
  registerHostServices({
    ...(await import("../../electron/server-bridge/host-services")).getHostServices()!,
    fsGuard: { projectRoots: () => [], readOnlyRoots: () => [] },
  } as HostServices);
  const { status } = await caught(
    keepImageVersionRoute({
      request: request({ projectDir, path: "cover.png", oid: "c".repeat(40) }),
    } as Parameters<typeof keepImageVersionRoute>[0]),
  );
  expect(status).toBe(403);
});

test.skipIf(!canSymlink)(
  "sync/keep-image-version: a `path` escaping through a project-local symlink is rejected (403)",
  async () => {
    await createAlias(); // projectDir/alias -> outsideDir
    const { status, message } = await caught(
      keepImageVersionRoute({
        request: request({ projectDir, path: "alias/secret.txt", oid: "c".repeat(40) }),
      } as Parameters<typeof keepImageVersionRoute>[0]),
    );
    expect(status).toBe(403);
    expect(message).toBe("sync:keepImageVersion: path is outside the open project");
  },
);

// ── symlink escape (P1 review on isWithinRoot): path.resolve() normalizes
//    lexical segments but leaves symlinks intact. A project-local symlink
//    (`projectDir/alias`) whose real target is `outsideDir` must still be
//    REJECTED once containment is checked against the canonicalized path —
//    on the pre-fix lexical-only check, all of these would have PASSED
//    containment and then had the underlying fs call follow the symlink
//    outside the project. ─────────────────────────────────────────────────

test.skipIf(!canSymlink)(
  "fs/read-file: reading through a project-local symlink aliasing an outside dir is rejected (403)",
  async () => {
    await createAlias();
    const { status, message } = await caught(
      readFileRoute({
        request: request({ path: path.join(aliasPath, "secret.txt") }),
      } as Parameters<typeof readFileRoute>[0]),
    );
    expect(status).toBe(403);
    expect(message).toBe("fs:readFile: path is outside the open project");
  },
);

test.skipIf(!canSymlink)(
  "fs/read-file: reading the symlink entry itself (projectDir/alias) is rejected (403)",
  async () => {
    await createAlias();
    const { status } = await caught(
      readFileRoute({ request: request({ path: aliasPath }) } as Parameters<typeof readFileRoute>[0]),
    );
    expect(status).toBe(403);
  },
);

test.skipIf(!canSymlink)(
  "fs/list-dir: listing through a project-local symlink aliasing an outside dir is rejected (403)",
  async () => {
    await createAlias();
    const { status } = await caught(
      listDirRoute({ request: request({ path: aliasPath }) } as Parameters<typeof listDirRoute>[0]),
    );
    expect(status).toBe(403);
  },
);

test.skipIf(!canSymlink)(
  "fs/write-file: writing through a project-local symlink aliasing an outside dir is rejected (403), nothing lands in outsideDir",
  async () => {
    await createAlias();
    const target = path.join(aliasPath, "pwned.txt");
    const { status, message } = await caught(
      writeFileRoute({ request: request({ path: target, content: "pwned" }) } as Parameters<typeof writeFileRoute>[0]),
    );
    expect(status).toBe(403);
    expect(message).toBe("fs:writeFile: path is outside the open project");
    await expect(readFile(path.join(outsideDir, "pwned.txt"), "utf8")).rejects.toThrow();
  },
);

test.skipIf(!canSymlink)(
  "fs/stat-file: stat-ing through a project-local symlink aliasing an outside dir is rejected (403)",
  async () => {
    await createAlias();
    const { status } = await caught(
      statFileRoute({
        request: request({ path: path.join(aliasPath, "secret.txt") }),
      } as Parameters<typeof statFileRoute>[0]),
    );
    expect(status).toBe(403);
  },
);

// ── dangling-symlink escape (fix round 2): a project-local symlink whose
//    TARGET'S PARENT exists but whose target LEAF does not yet exist. The
//    earlier `createAlias()` cases only cover a symlink whose target already
//    exists (`outsideDir` itself); `fs.realpath` throws ENOENT on that kind of
//    dangling link the same way it throws ENOENT on a plain missing path, so
//    the tolerant-realpath walk-up used to (wrongly) treat the link's own
//    basename as an inert non-existent tail segment and re-append it to the
//    already-canonicalized PARENT — producing a canonical path back INSIDE
//    the project even though `write-file`'s `open(path, "w")` follows the
//    link and creates the file OUTSIDE. On the pre-fix code this test
//    observes a 200 and a planted file in `outsideDir`. ────────────────────

test.skipIf(!canSymlink)(
  "fs/write-file: writing through a project-local DANGLING symlink (target leaf absent) is rejected (403), nothing lands outside",
  async () => {
    const danglingTarget = path.join(outsideDir, "planted.txt"); // parent (outsideDir) exists, leaf does not
    const evilLink = path.join(projectDir, "evil");
    await symlink(danglingTarget, evilLink, "file");

    const { status, message } = await caught(
      writeFileRoute({
        request: request({ path: evilLink, content: "PWNED" }),
      } as Parameters<typeof writeFileRoute>[0]),
    );
    expect(status).toBe(403);
    expect(message).toBe("fs:writeFile: path is outside the open project");
    await expect(readFile(danglingTarget, "utf8")).rejects.toThrow();
  },
);
