/**
 * #501: a snap browser cannot read the OS temp dir, so a `--out` build staged
 * its pages there and rendered unstyled. Detection and the scratch-dir choice.
 */
import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chooseScratchParent, isSnapExecutable, isSnapReadable } from "./chromium.ts";
import { resolveBuildContext } from "./build-runner.ts";

const cleanup: string[] = [];
afterEach(async () => {
  delete process.env.CHROMIUM_PATH;
  for (const d of cleanup.splice(0)) await rm(d, { recursive: true, force: true });
});

test("isSnapExecutable: snap paths, the launcher symlink, and ordinary browsers", async () => {
  expect(isSnapExecutable("/snap/chromium/3000/usr/lib/chromium-browser/chrome")).toBe(true);
  expect(isSnapExecutable("/usr/bin/google-chrome")).toBe(false);
  const dir = await mkdtemp(join(tmpdir(), "gp-snap-"));
  cleanup.push(dir);
  // /snap/bin/chromium is a symlink to the `snap` launcher.
  await writeFile(join(dir, "snap"), "");
  await symlink(join(dir, "snap"), join(dir, "chromium"));
  expect(isSnapExecutable(join(dir, "chromium"))).toBe(true);
  await writeFile(join(dir, "snapd"), "");
  await symlink(join(dir, "snapd"), join(dir, "chromium2"));
  expect(isSnapExecutable(join(dir, "chromium2"))).toBe(true);
  // Ubuntu's apt /usr/bin/chromium-browser: a shell script that execs the snap.
  await writeFile(join(dir, "shim"), '#!/bin/sh\nexec /snap/bin/chromium "$@"\n');
  expect(isSnapExecutable(join(dir, "shim"))).toBe(true);
  await writeFile(join(dir, "chrome"), "");
  expect(isSnapExecutable(join(dir, "chrome"))).toBe(false);
});

test("isSnapReadable: under home but not in a hidden top-level folder", () => {
  expect(isSnapReadable("/home/u/books/a", "/home/u")).toBe(true);
  expect(isSnapReadable("/home/u/books/.dist-build-x", "/home/u")).toBe(true);
  expect(isSnapReadable("/home/u/.cache/x", "/home/u")).toBe(false);
  expect(isSnapReadable("/tmp/x", "/home/u")).toBe(false);
  expect(isSnapReadable("/home/u", "/home/u")).toBe(false);
  expect(isSnapReadable("/home/other/x", "/home/u")).toBe(false);
});

test("chooseScratchParent: temp dir normally; beside the book, else the snap data folder, for a snap", () => {
  const base = { bookDir: "/home/u/book", tmpDir: "/tmp", home: "/home/u" };
  expect(chooseScratchParent({ ...base, snapBrowser: false })).toBe("/tmp");
  expect(chooseScratchParent({ ...base, snapBrowser: true })).toBe("/home/u/book");
  expect(chooseScratchParent({ ...base, snapBrowser: true, bookDir: "/tmp/book" })).toBe(
    "/home/u/snap/chromium/common"
  );
});

test("resolveBuildContext with --out stages under a snap-readable folder when the browser is a snap", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-snap-"));
  cleanup.push(dir);
  await mkdir(join(dir, "snap-root"));
  await writeFile(join(dir, "manifest.yaml"), "title: T\n");
  // A fake browser at a /snap/ real path is not creatable; use the launcher name.
  await writeFile(join(dir, "snap"), "");
  process.env.CHROMIUM_PATH = join(dir, "snap");
  const out = join(dir, "out");
  const ctx = await resolveBuildContext({ inputDir: dir, format: "pdf", outDir: out, rawArgs: {} });
  expect(ctx.workDir.startsWith(tmpdir())).toBe(false);
  expect(ctx.workDir).toContain(dir);
  process.env.CHROMIUM_PATH = "/usr/bin/true";
  const ctx2 = await resolveBuildContext({ inputDir: dir, format: "pdf", outDir: out, rawArgs: {} });
  expect(ctx2.workDir.startsWith(tmpdir())).toBe(true);
});
