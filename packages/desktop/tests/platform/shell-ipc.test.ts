/**
 * IPC-handler contract for `electron/api/shell.ts` (SFE-P5c1 — migrated off
 * `src/routes/api/shell/{open-external,show-in-folder}/+server.ts`, deleted).
 *
 * Ports the deleted `open-external-scheme.test.ts` (http(s)-only gate, audit
 * C1) verbatim, and the `shell/show-in-folder` section of the deleted
 * `route-scoping.test.ts` (project + read-only roots + picked-path reveal —
 * that file's other ~36 route cases are outside this subrun's scope and stay
 * in route-scoping.test.ts unchanged).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";
import { shellOpenExternal, shellShowInFolder } from "../../electron/api/shell";

async function caught(p: Promise<unknown>): Promise<{ message: string }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
  }
}

// ── shell:openExternal — http(s)-only gate (audit C1) ───────────────────────

let openedUrls: string[];
beforeEach(() => {
  openedUrls = [];
  registerHostServices(
    makeHostServices({
      desktop: { openExternal: async (url: string) => void openedUrls.push(url) },
    }),
  );
});

test("shell:openExternal rejects a file:// URL", async () => {
  const { message } = await caught(shellOpenExternal("file:///etc/passwd"));
  expect(message).toBe("url must be http(s)");
});

test("shell:openExternal rejects a custom-scheme URL", async () => {
  const { message } = await caught(shellOpenExternal("app://internal/secret"));
  expect(message).toBe("url must be http(s)");
});

test("shell:openExternal rejects a mailto: URL", async () => {
  const { message } = await caught(shellOpenExternal("mailto:someone@example.com"));
  expect(message).toBe("url must be http(s)");
});

test("shell:openExternal rejects a missing url", async () => {
  const { message } = await caught(shellOpenExternal(undefined));
  expect(message).toBe("url is required");
});

test("shell:openExternal accepts an https URL and forwards it to the host", async () => {
  await shellOpenExternal("https://example.com/docs");
  expect(openedUrls).toEqual(["https://example.com/docs"]);
});

// ── shell:showInFolder — the reveal target ──────────────────────────────────
//
// This op had NO path validation at all — not even requireAbsolute — and
// handed whatever it was given to the OS file manager. It has three
// legitimate callers: a project media file, a crash-recovery backup zip
// under userData, and the exported PDF at the destination the author picked
// in the Save dialog (deliberately OUTSIDE the project). Same shape as
// publish/run's artifact: project + read-only roots, plus a path a native
// dialog produced.

let base: string;
let bookDir: string;
let outsideDir: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "gutterpress-shell-ipc-"));
  bookDir = path.join(base, "book");
  outsideDir = path.join(base, "elsewhere");
  await mkdir(bookDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function revealHost(picked: ReturnType<typeof createPickedFilesService>, revealed: string[]): void {
  registerHostServices(
    makeHostServices({
      desktop: {
        getUserDataPath: () => base,
        showItemInFolder: (p: string) => {
          revealed.push(p);
        },
      },
      fsGuard: {
        projectRoots: () => [bookDir],
        readOnlyRoots: () => [path.join(base, "recovery")],
      },
      pickedFiles: picked,
    }),
  );
}

test("shell:showInFolder: a project file is revealed", async () => {
  const revealed: string[] = [];
  revealHost(createPickedFilesService(), revealed);
  const target = path.join(bookDir, "images", "cover.png");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "png", "utf8");
  await shellShowInFolder(target);
  expect(revealed).toEqual([target]);
});

test("shell:showInFolder: a crash-recovery backup under userData is revealed", async () => {
  const revealed: string[] = [];
  revealHost(createPickedFilesService(), revealed);
  const zip = path.join(base, "recovery", "backup.zip");
  await mkdir(path.dirname(zip), { recursive: true });
  await writeFile(zip, "zip", "utf8");
  await shellShowInFolder(zip);
  expect(revealed).toEqual([zip]);
});

test("shell:showInFolder: an unrelated outside path is rejected and never revealed", async () => {
  const revealed: string[] = [];
  revealHost(createPickedFilesService(), revealed);
  const { message } = await caught(shellShowInFolder(path.join(outsideDir, "secret.txt")));
  expect(message).toBe(
    "shell:showInFolder: path is outside the open project and was not chosen from a file dialog",
  );
  expect(revealed).toEqual([]);
});

test("shell:showInFolder: the exported PDF's chosen destination is revealed (twice)", async () => {
  const revealed: string[] = [];
  const picked = createPickedFilesService();
  revealHost(picked, revealed);
  const exported = path.join(outsideDir, "book.pdf");
  await writeFile(exported, "%PDF-1.4", "utf8");
  picked.register([exported]);
  for (const _ of [1, 2]) {
    await shellShowInFolder(exported);
  }
  expect(revealed).toEqual([exported, exported]);
});

test("shell:showInFolder: a relative path is rejected, not a silent reveal", async () => {
  const revealed: string[] = [];
  revealHost(createPickedFilesService(), revealed);
  const { message } = await caught(shellShowInFolder("rel/path.pdf"));
  expect(message).toBe("shell:showInFolder requires an absolute path, got: rel/path.pdf");
  expect(revealed).toEqual([]);
});
