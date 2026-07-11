import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { POST as readFileRoute } from "../../src/routes/api/fs/read-file/+server";
import { POST as writeFileRoute } from "../../src/routes/api/fs/write-file/+server";
import { POST as listDirRoute } from "../../src/routes/api/fs/list-dir/+server";
import { POST as statFileRoute } from "../../src/routes/api/fs/stat-file/+server";
import { POST as copyFileRoute } from "../../src/routes/api/fs/copy-file/+server";

// ARCH review #37: `/api/fs/{read-file,write-file,list-dir,stat-file,
// copy-file}` used to accept ANY absolute path (only guard: isAbsolute).
// These pin the project-scoping guard: inside the open project is allowed,
// a sibling directory with a shared string prefix is rejected (the
// "/home/u/proj" vs "/home/u/proj2" regression), anything else outside is
// rejected, and the two deliberately-exempt behaviors — read-file's
// crash-recovery sidecar allowance, and copy-file's unrestricted `src` — are
// locked in rather than accidentally tightened or loosened later.

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

let projectDir: string;
let siblingDir: string; // shares a string prefix with projectDir but is a DIFFERENT directory
let outsideDir: string;
let recoveryDir: string;

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "pmd-fs-guard-"));
  projectDir = path.join(base, "proj");
  siblingDir = path.join(base, "proj2"); // "proj" + "2" — the sibling-prefix case
  outsideDir = path.join(base, "elsewhere");
  recoveryDir = path.join(base, "recovery");
  await mkdir(projectDir, { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await writeFile(path.join(projectDir, "chapter-01.md"), "# In project", "utf8");
  await writeFile(path.join(siblingDir, "secret.md"), "# Sibling project", "utf8");
  await writeFile(path.join(outsideDir, "secret.txt"), "outside content", "utf8");
  await writeFile(path.join(recoveryDir, "snap.md"), "# Recovered", "utf8");

  const fsGuard = { projectRoots: () => [projectDir], readOnlyRoots: () => [recoveryDir] };
  const noop = () => {};
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

test("fs/copy-file: src OUTSIDE the project is a PINNED exemption (the image-picker import flow) — dest inside is allowed", async () => {
  const res = await copyFileRoute({
    request: request({ src: path.join(outsideDir, "secret.txt"), dest: path.join(projectDir, "assets") }),
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
