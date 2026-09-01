import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as listImagesRoute } from "../../src/routes/api/media/list-images/+server";
import { POST as inspectImageRoute } from "../../src/routes/api/media/inspect/+server";
import { POST as thumbnailRoute } from "../../src/routes/api/media/thumbnail/+server";

// ARCH review #37 (code review: thumbnail/inspect/list-images read arbitrary
// image bytes/trees without the guard). These pin the media/* project-scoping
// guard: inside the open project is allowed, anything outside is rejected.
//
// SFE-P5c1: this file used to be `fs-routes-scoping.test.ts` and also covered
// `fs/*` and `log/read` (both migrated to typed IPC this run — see
// `fs-ipc.test.ts` / `log-ipc.test.ts`) and `fs/copy-file` (deleted — dead
// route, no callers). Renamed to reflect what remains: the `media/*` routes,
// which stay HTTP this subrun (P5c4).

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
let siblingDir: string;
let outsideDir: string;

beforeEach(async () => {
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

  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [] },
    }),
  );
});

afterEach(async () => {
  await rm(path.dirname(projectDir), { recursive: true, force: true });
});

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
