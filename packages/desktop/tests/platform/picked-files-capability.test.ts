import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";
import { mediaImportImage } from "../../electron/api/media";
import { dialogPickImageFile } from "../../electron/api/dialog";

// P1 review (maintainer comment on media/import-image#L30, echoed on the now
// deleted fs/copy-file — dead route, no callers): `media:importImage`
// accepted an arbitrary absolute `src` on the theory that it "came from the
// native file dialog" — nothing enforced that. An app-origin script could
// POST any known local path and have it copied into the project, then read
// it back out through fs:readFile. This suite pins the fix: `dialog:
// pickImageFile[s]` (SFE-P5c1: typed IPC — see dialog-ipc.test.ts for the
// dialog-route half of this suite) REGISTER every path the native dialog
// itself returns (`electron/server-bridge/picked-files.ts`); `media:
// importImage` (SFE-P5c2: typed IPC too — see media-ipc.test.ts for the rest
// of that handler's own coverage) must CONSUME that one-time capability
// before copying anything from OUTSIDE the project — a `src` no picker call
// produced (or one already spent) is rejected.

async function caught(p: Promise<unknown>): Promise<{ message: unknown }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
  }
}

let base: string;
let projectDir: string;
let outsideDir: string;
let savedHostServices: HostServices | null;
let pickedFiles: ReturnType<typeof createPickedFilesService>;
/** What the mocked native dialog returns on its next `showOpenDialog` call. */
let nextFilePaths: string[];

beforeEach(async () => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file (same convention as
  // media-ipc.test.ts).
  savedHostServices = getHostServices();

  base = await mkdtemp(path.join(tmpdir(), "gutterpress-picked-files-"));
  projectDir = path.join(base, "proj");
  outsideDir = path.join(base, "elsewhere");
  await mkdir(projectDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });

  pickedFiles = createPickedFilesService();
  nextFilePaths = [];
  registerHostServices(
    makeHostServices({
      desktop: {
        showOpenDialog: async () => ({ canceled: nextFilePaths.length === 0, filePaths: nextFilePaths }),
        getUserDataPath: () => base,
      },
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [] },
      pickedFiles,
    }),
  );
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

// ── media/import-image: the actual bypass ───────────────────────────────────

test("media/import-image: a src OUTSIDE the project that was NEVER returned by the picker is rejected (403)", async () => {
  // This is the escape the P1 review flagged: an app-origin script POSTing a
  // known local path directly, with no picker round-trip at all.
  const src = path.join(outsideDir, "planted.jpg");
  await writeFile(src, "not-picked", "utf8");

  const { message } = await caught(mediaImportImage(projectDir, src));
  expect(message).toBe("media:importImage: src was not returned by a recent file picker");
});

test("media/import-image: a src registered via the picker IS accepted, and consumed — a second import of the same src is rejected", async () => {
  const src = path.join(outsideDir, "cover.png");
  await writeFile(src, "picked-content", "utf8");
  pickedFiles.register([src]);

  const first = await mediaImportImage(projectDir, src);
  expect(first).toEqual({ src: "assets/cover.png", copied: true });
  expect(await readFile(path.join(projectDir, "assets", "cover.png"), "utf8")).toBe("picked-content");

  // The capability was consumed by the first call — a second attempt with
  // the exact same (still-existing) outside src must be rejected, not
  // silently re-copied.
  const { message } = await caught(mediaImportImage(projectDir, src));
  expect(message).toBe("media:importImage: src was not returned by a recent file picker");
});

test("media/import-image: a src already INSIDE the project needs no picker capability", async () => {
  await mkdir(path.join(projectDir, "sub"), { recursive: true });
  const src = path.join(projectDir, "sub", "img.png");
  await writeFile(src, "already-here", "utf8");

  expect(await mediaImportImage(projectDir, src)).toEqual({ src: "sub/img.png", copied: false });
});

// ── end-to-end: pick → import round trip (the intended, legitimate flow) ────
//
// The pick half (`dialog:pickImageFile`, SFE-P5c1) and the import half
// (`media:importImage`, SFE-P5c2) are both typed IPC now, calling different
// `electron/api/*.ts` handlers that share the SAME main-process
// `pickedFiles` capability singleton (`electron/server-bridge/
// picked-files.ts`, unchanged) — this proves the capability still connects
// the two correctly.

test("end-to-end: dialog:pickImageFile's result is accepted by media:importImage exactly once", async () => {
  const picked = path.join(outsideDir, "photo.jpg");
  await writeFile(picked, "photo-bytes", "utf8");
  nextFilePaths = [picked];

  const src = await dialogPickImageFile();
  expect(src).toBe(picked);

  const importResult = await mediaImportImage(projectDir, src!);
  expect(importResult).toEqual({ src: "assets/photo.jpg", copied: true });

  // Re-submitting the SAME picked path a second time (e.g. a script replaying
  // the request) must not get a second free import out of one dialog pick.
  const { message } = await caught(mediaImportImage(projectDir, src!));
  expect(message).toBe("media:importImage: src was not returned by a recent file picker");
});
