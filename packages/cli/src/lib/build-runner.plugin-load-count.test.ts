/**
 * Regression coverage for #262 — "a build loads plugins twice, and
 * validate/preflight never sees plugin CSS."
 *
 * Both fixes are pinned here against a REAL, receipt-verified npm-vendored
 * plugin (a hand-built tarball fixture, the same shape
 * npm-plugin-installer.test.ts uses) — a path plugin would not exercise this
 * at all, since path plugins already have their own separate mtime cache
 * (markdown/plugins.ts's `pathPluginCache`) and never touch
 * `verifyVendoredPlugin`/`computeVendorTreeDigest` (plugin-vendor.ts), the
 * uncached, expensive (recursive walk + full read-and-SHA-256 of the vendored
 * tree) operation #262 is about.
 *
 * `engineBrowser` is injected as a callback that throws the instant it is
 * invoked (mirrors build-runner.browser-lifecycle.test.ts's
 * `fakeEngineBrowser`): this skips the Chromium preflight AND
 * `verifyNativeChromiumMilestone` entirely (`rendersInPooledChromium` is
 * false whenever `opts.engineBrowser` is set — build-preflight.ts), so these
 * tests need no real browser and run in any environment, while still
 * exercising runQualityGates' real lint gate, the real preValidate gate
 * (executeAndReport/validation-exec.ts), and the real renderBook — the throw
 * only cuts in at the LAST stage (PdfOutput.finish's buildNativePdf call),
 * strictly after every plugin-loading call site under test has already run.
 *
 * Measured on this exact fixture (see the PR description for the full
 * numbers): before this fix, a build with only the lint gate on (preValidate
 * skipped) called `verifyVendoredPlugin` twice — once from the lint gate's
 * own `loadPluginsWithCss`, once from `renderBook`'s; after, once. With BOTH
 * gates on (the default), the total additionally includes two calls from
 * `source.layout-markers`/`source.local-refs` (checks/source/*.ts) — a
 * PRE-EXISTING, unrelated duplication (those checks call the lower-level
 * `loadPlugins` directly, resolved against `ctx.inputDir`, not
 * `loadPluginsWithCss`) that #262 does not name and this fix does not touch.
 * That is why the assertions below spy on `loadPluginsWithCss` specifically
 * (the one function `loadBuildPlugins` — and therefore this fix — actually
 * controls) rather than on the raw, gate-count-sensitive
 * `verifyVendoredPlugin` total.
 */
import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, strToU8 } from "fflate";
import { addNpmPluginWithOptions } from "./plugin-manager";
import * as pluginsMod from "./markdown/plugins";
import * as pluginVendorMod from "./plugin-vendor";
import { runBuild, type EngineBrowser } from "./build-runner";

const fakeEngineBrowser = async (): Promise<EngineBrowser> => {
  throw new Error("engine build should not be reached in this test");
};

interface TarEntry {
  name: string;
  body?: Uint8Array;
}

function writeText(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(strToU8(value), offset);
}
function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  writeText(target, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}
/** Minimal ustar tar writer — trimmed copy of npm-plugin-installer.test.ts's
 * fixture builder (that file predates this one and is not a module other
 * test files import from). */
function tar(entries: TarEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 1024;
  for (const item of entries) {
    const body = item.body ?? new Uint8Array();
    const header = new Uint8Array(512);
    writeText(header, 0, 100, item.name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    writeText(header, 156, 1, "0");
    writeText(header, 257, 6, "ustar\0");
    writeText(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    const padded = Math.ceil(body.length / 512) * 512;
    const data = new Uint8Array(padded);
    data.set(body);
    chunks.push(header, data);
    total += header.length + data.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function registryFixture(
  name: string,
  version: string,
  entries: TarEntry[],
): { fetch: typeof globalThis.fetch } {
  const archive = gzipSync(tar(entries), { mtime: 0 });
  const tarball = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  const metadata = {
    name,
    "dist-tags": { latest: version },
    versions: { [version]: { name, version, dist: { tarball, integrity } } },
  };
  const fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `https://registry.npmjs.org/${encodeURIComponent(name)}`) {
      return new Response(JSON.stringify(metadata), { headers: { "content-type": "application/json" } });
    }
    if (url === tarball) return new Response(archive);
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch };
}

/** Vendors a real npm plugin (declaring a `styles` file, #238) into `dir` and
 * writes a complete manifest.yaml (title + project stylesheet + the plugin),
 * replacing whatever addNpmPluginWithOptions itself wrote — vendoring is
 * keyed by (project dir, name, version) on disk, not by the manifest text, so
 * this is safe. */
async function makeVendoredPluginProject(label: string): Promise<{
  dir: string;
  outDir: string;
  name: string;
  version: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), `gutterpress-262-${label}-in-`));
  const outDir = await mkdtemp(join(tmpdir(), `gutterpress-262-${label}-out-`));
  const name = `markdown-it-262-${label}-fixture`;
  const version = "1.0.0";
  const entries: TarEntry[] = [
    {
      name: "package/package.json",
      body: strToU8(JSON.stringify({ name, version, type: "module", exports: "./index.js" })),
    },
    {
      name: "package/index.js",
      body: strToU8("export default function plugin() {}\nexport const styles = ['./plugin.css'];\n"),
    },
    {
      name: "package/plugin.css",
      // A print-unsafe rule (checks/source/stylelint.ts's risky-props rule) so
      // a check that DOES see this file produces a findable, distinguishing
      // effect from one that doesn't (used by the validate-gap test below).
      body: strToU8("@page { background-blend-mode: multiply; }\n"),
    },
  ];
  const fixture = registryFixture(name, version, entries);
  await addNpmPluginWithOptions(dir, name, { fetch: fixture.fetch });

  await mkdir(join(dir, "styles"), { recursive: true });
  await writeFile(join(dir, "styles", "book.css"), "body { color: black; }\n", "utf8");
  await writeFile(join(dir, "chapter-01.md"), "# Hello\n\n#262 fixture.\n", "utf8");
  await writeFile(
    join(dir, "manifest.yaml"),
    `title: ${label}\nstyles:\n  - styles/book.css\nplugins:\n  - name: ${name}\n    version: ${version}\n`,
    "utf8",
  );
  return { dir, outDir, name, version };
}

const dirsToClean: string[] = [];
// Top-level spy handles + an unconditional afterEach restore (rather than a
// `mockRestore()` at the tail of each test body) — a FAILED assertion throws
// and skips any cleanup written after it, which would otherwise leak that
// test's spy into every later test in this file (spyOn patches the shared
// `pluginsMod`/`pluginVendorMod` module objects, not a per-test copy) and
// silently inflate their counts. This mirrors
// build-runner.browser-lifecycle.test.ts's and validation-exec.test.ts's own
// spy-cleanup pattern.
let loadSpy: ReturnType<typeof spyOn> | undefined;
let verifySpy: ReturnType<typeof spyOn> | undefined;
afterEach(async () => {
  loadSpy?.mockRestore();
  verifySpy?.mockRestore();
  loadSpy = undefined;
  verifySpy = undefined;
  for (const d of dirsToClean.splice(0)) await rm(d, { recursive: true, force: true });
});

test("#262: a build loads/verifies an npm-vendored plugin ONCE via loadPluginsWithCss, not once per gate/render", async () => {
  const { dir, outDir } = await makeVendoredPluginProject("count");
  dirsToClean.push(dir, outDir);

  loadSpy = spyOn(pluginsMod, "loadPluginsWithCss");

  // Both gates on (the default — no skipLint/skipPreValidate), so this
  // exercises the lint gate, the preValidate gate, AND renderBook, all
  // against the SAME BuildContext. Before the fix this alone made
  // `loadPluginsWithCss` run twice (lint gate, then render); this asserts it
  // now runs exactly once regardless of how many of those three consumers
  // are active — the ONE thing `loadBuildPlugins`'s memoization controls.
  // (verifyVendoredPlugin's own raw total is a less precise assertion here:
  // it also picks up source.layout-markers/source.local-refs's independent,
  // pre-existing, out-of-scope `loadPlugins` calls during preValidate — see
  // this file's header comment — so it is asserted only in the isolated test
  // below, where skipPreValidate removes that interference entirely.)
  await expect(
    runBuild({
      inputDir: dir,
      format: "pdf",
      outDir,
      engineBrowser: fakeEngineBrowser,
      rawArgs: {},
    })
  ).rejects.toThrow(/engine build should not be reached/);

  expect(loadSpy).toHaveBeenCalledTimes(1);
});

test("#262: --skip-pre-validate isolates the exact pair the issue names — lint gate + renderBook share one verifyVendoredPlugin call", async () => {
  const { dir, outDir } = await makeVendoredPluginProject("isolated");
  dirsToClean.push(dir, outDir);

  verifySpy = spyOn(pluginVendorMod, "verifyVendoredPlugin");

  await expect(
    runBuild({
      inputDir: dir,
      format: "pdf",
      outDir,
      skipPreValidate: true,
      engineBrowser: fakeEngineBrowser,
      rawArgs: {},
    })
  ).rejects.toThrow(/engine build should not be reached/);

  // With preValidate out of the picture, verifyVendoredPlugin's count is a
  // direct, unambiguous measurement of just the lint gate + renderBook pair
  // #262 names (no unrelated check-registry loads to account for) — was 2,
  // now 1.
  expect(verifySpy).toHaveBeenCalledTimes(1);
});

test("#262: validate sees a plugin's declared styles file (fails before the fix)", async () => {
  const { dir, outDir } = await makeVendoredPluginProject("validate-gap");
  dirsToClean.push(dir, outDir);

  const { executeValidation } = await import("./validation-exec");
  const execution = await executeValidation({ input: dir });

  const cssFiles = execution.context.cssFiles ?? [];
  expect(cssFiles.some((f) => f.endsWith("plugin.css"))).toBe(true);

  // Not just present in the file SET — actually inspected: the plugin's
  // risky `background-blend-mode` (checks/source/stylelint.ts) must show up
  // in the pre-build report, exactly as it already does under
  // `gutterpress lint` (lint-runner.test.ts's matching plugin-styles case).
  const riskyOnPlugin = execution.report.results.some(
    (r) => r.checkId === "source.stylelint" && r.file?.endsWith("plugin.css"),
  );
  expect(riskyOnPlugin).toBe(true);
});
