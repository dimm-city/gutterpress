/**
 * #501: a snap browser cannot read the OS temp dir, so a `--out` build staged
 * its pages there and rendered unstyled. Detection, naming and the scratch dir.
 */
import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  chooseScratchParent,
  isSnapReadable,
  snapNameOf,
  snapUnreadableWarning,
} from "./chromium.ts";
import { resolveBuildContext } from "./build-runner.ts";

const cleanup: string[] = [];
const realHome = process.env.HOME;
afterEach(async () => {
  delete process.env.CHROMIUM_PATH;
  process.env.HOME = realHome;
  for (const d of cleanup.splice(0)) await rm(d, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "gp-snap-"));
  cleanup.push(d);
  return d;
}

test("snapNameOf derives the snap from the path, the launcher link, or the apt shim", async () => {
  expect(snapNameOf("/snap/bin/brave")).toBe("brave");
  expect(snapNameOf("/snap/chromium/3000/usr/lib/chromium-browser/chrome")).toBe("chromium");
  const dir = await scratch();
  await writeFile(join(dir, "snapd"), "");
  await symlink(join(dir, "snapd"), join(dir, "chromium"));
  expect(snapNameOf(join(dir, "chromium"))).toBe("chromium");
  await writeFile(join(dir, "shim"), '#!/bin/sh\nexec /snap/bin/brave "$@"\n');
  expect(snapNameOf(join(dir, "shim"))).toBe("brave");
  await writeFile(join(dir, "chrome"), "");
  expect(snapNameOf(join(dir, "chrome"))).toBeUndefined();
  expect(snapNameOf("/usr/bin/google-chrome")).toBeUndefined();
});

test("isSnapReadable: home yes, hidden top-level and ~/snap no, the snap's own folder yes", () => {
  const h = "/home/u";
  expect(isSnapReadable("/home/u/books/a", h)).toBe(true);
  expect(isSnapReadable("/home/u/.cache/x", h)).toBe(false);
  expect(isSnapReadable("/tmp/x", h)).toBe(false);
  expect(isSnapReadable("/home/u", h)).toBe(false);
  expect(isSnapReadable("/home/other/x", h)).toBe(false);
  expect(isSnapReadable("/home/u/snap/brave/common/x", h)).toBe(false);
  expect(isSnapReadable("/home/u/snap/brave/common/x", h, "chromium")).toBe(false);
  expect(isSnapReadable("/home/u/snap/brave/common/x", h, "brave")).toBe(true);
});

test("chooseScratchParent: the temp dir normally; the snap's own data folder for a snap", () => {
  expect(chooseScratchParent({ tmpDir: "/tmp", home: "/home/u" })).toBe("/tmp");
  expect(chooseScratchParent({ snapName: "brave", tmpDir: "/tmp", home: "/home/u" })).toBe(
    "/home/u/snap/brave/common"
  );
});

test("snapUnreadableWarning: only for a snap whose scratch dir it cannot read", () => {
  expect(snapUnreadableWarning("/tmp/x", undefined, "/home/u")).toBeUndefined();
  expect(snapUnreadableWarning("/home/u/snap/brave/common/x", "brave", "/home/u")).toBeUndefined();
  expect(snapUnreadableWarning("/tmp/book/.dist-build-x", "brave", "/home/u")).toContain("render unstyled");
});

test("resolveBuildContext with --out stages in the snap's data folder, nothing in the book; a non-snap browser is unchanged", async () => {
  const root = await scratch();
  const book = join(root, "book");
  await mkdir(book, { recursive: true });
  await writeFile(join(book, "manifest.yaml"), "title: T\n");
  const out = join(root, "out");

  await writeFile(join(root, "shim"), '#!/bin/sh\nexec /snap/bin/brave "$@"\n');
  process.env.CHROMIUM_PATH = join(root, "shim");
  const ctx = await resolveBuildContext({ inputDir: book, format: "pdf", outDir: out, rawArgs: {} });
  expect(ctx.workDir).toBe(join(homedir(), "snap", "brave", "common", ctx.workDir.split("/").pop()!));
  expect(ctx.workDir.split("/").pop()).toMatch(/^gutterpress-build-/);
  expect(ctx.workDir.startsWith(book)).toBe(false);

  await writeFile(join(root, "plain"), "#!/bin/sh\n");
  process.env.CHROMIUM_PATH = join(root, "plain");
  const ctx2 = await resolveBuildContext({ inputDir: book, format: "pdf", outDir: out, rawArgs: {} });
  expect(ctx2.workDir.startsWith(join(tmpdir(), "gutterpress-build-"))).toBe(true);
});
