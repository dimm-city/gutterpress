/**
 * Publishing plugins (EXPERIMENTAL, #381): discovery, lookup, restore and the
 * adapter that runs a plugin's `publish(outputDir, context)` through
 * runPublish. Fixtures are local-folder and pre-vendored npm publishers;
 * `fetch` is stubbed to throw, so every test also proves when the network is
 * (and isn't) touched.
 */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FileTokenStore } from "../remote-auth/token-store";
import { artifactName, BOOK_HTML, resolveOutputDir } from "../output-paths";
import { vendoredNpmPluginPackageDir, vendoredNpmPluginRoot } from "../plugin-vendor";
import { setPublishProviderConfig } from "./manifest-publish";
import { listBookPublishProviders, resolvePublishProvider } from "./plugin-provider";
import { listPublishProviders } from "./registry";
import { runPublish } from "./run-publish";
import type { PublishDeps } from "./types";

const BUILT_IN_IDS = listPublishProviders().map((p) => p.id);

/** Writes what it was given to `received.json` in the book, then returns `result`. */
const RECORDING_PUBLISH = `
import { writeFile } from "node:fs/promises";
import path from "node:path";
export async function publish(outputDir, context) {
  context.log("uploading");
  await writeFile(
    path.join(context.project.dir, "received.json"),
    JSON.stringify({ outputDir, project: context.project, artifacts: context.artifacts, settings: context.settings }),
  );
  return globalThis.__gpPublishResult ?? { url: "https://example.com/my book", detail: "Sent" };
}
`;

let dir: string;
let fetchCalls = 0;
let fetchSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-plugin-"));
  fetchCalls = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
    fetchCalls++;
    throw new TypeError("fetch failed: ECONNREFUSED");
  }) as never);
  errSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  fetchSpy.mockRestore();
  errSpy.mockRestore();
  delete (globalThis as Record<string, unknown>).__gpPublishResult;
  await rm(dir, { recursive: true, force: true });
});

async function writeManifest(body: string): Promise<void> {
  await writeFile(path.join(dir, "manifest.yaml"), `title: Test Book\nauthors: [Tester]\n${body}`, "utf8");
}

async function writePackage(rel: string, pkg: Record<string, unknown>, entry: string): Promise<void> {
  const pkgDir = path.join(dir, rel);
  await mkdir(pkgDir, { recursive: true });
  await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ type: "module", main: "index.js", ...pkg }));
  await writeFile(path.join(pkgDir, "index.js"), entry);
}

const publisher = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `${name} destination`,
  gutterpress: { publish: true },
  ...extra,
});

async function withPdf(): Promise<string> {
  const out = resolveOutputDir(dir, "Test Book");
  await mkdir(out, { recursive: true });
  const pdf = path.join(out, artifactName("Test Book", "pdf"));
  await writeFile(pdf, "%PDF-1.4 fake");
  return pdf;
}

function deps(progress: string[] = []): PublishDeps {
  return {
    tokenStore: new FileTokenStore(path.join(dir, ".creds", "credentials.json")),
    env: {},
    onProgress: (m) => progress.push(m),
  };
}

const received = async () => JSON.parse(await readFile(path.join(dir, "received.json"), "utf8"));

// ── discovery ───────────────────────────────────────────────────────────────

test("lists built-ins first, then the book's enabled publishers, marked experimental", async () => {
  await writePackage("pub", publisher("gp-demo"), RECORDING_PUBLISH);
  await writePackage("off", publisher("gp-off"), RECORDING_PUBLISH);
  await writePackage("look", { name: "a-look", gutterpress: { styles: [] } }, "export default () => {};");
  await writeManifest("extensions:\n  - ./pub\n  - ./look\n  - use: ./off\n    enabled: false\n");

  const infos = await listBookPublishProviders({ projectDir: dir });

  expect(infos.map((p) => p.id)).toEqual([...BUILT_IN_IDS, "gp-demo"]);
  expect(infos.at(-1)).toMatchObject({
    id: "gp-demo",
    label: "gp-demo",
    description: "gp-demo destination",
    kind: "api",
    formats: ["pdf", "html"],
    credential: { required: false },
    experimental: true,
  });
  expect(infos.slice(0, -1).some((p) => p.experimental)).toBe(false);
});

test("a publisher named like a built-in is skipped, and the built-in is unchanged", async () => {
  await writePackage("pub", publisher("itch"), RECORDING_PUBLISH);
  await writeManifest("extensions:\n  - ./pub\n");

  const infos = await listBookPublishProviders({ projectDir: dir });

  expect(infos.map((p) => p.id)).toEqual(BUILT_IN_IDS);
  expect((await resolvePublishProvider("itch", { projectDir: dir })).info.label).toBe("itch.io");
});

test("an unreadable manifest lists the built-ins", async () => {
  const infos = await listBookPublishProviders({ projectDir: dir, manifestPath: path.join(dir, "missing.yaml") });
  expect(infos.map((p) => p.id)).toEqual(BUILT_IN_IDS);
});

// ── publishing through runPublish ───────────────────────────────────────────

test("publishes a pdf: outputDir is the PDF's folder, and the context carries the book, one artifact and its settings", async () => {
  await writePackage("pub", publisher("gp-demo"), RECORDING_PUBLISH);
  await writeManifest("extensions:\n  - ./pub\npublish:\n  gp-demo:\n    dest: somewhere\n");
  const pdf = await withPdf();
  const progress: string[] = [];

  const result = await runPublish({ projectDir: dir, providerId: "gp-demo" }, deps(progress));

  expect(result).toMatchObject({
    ok: true,
    providerId: "gp-demo",
    outcome: { kind: "published", url: "https://example.com/my%20book", detail: "Sent" },
  });
  expect(await received()).toEqual({
    outputDir: path.dirname(pdf),
    project: { dir, title: "Test Book", authors: ["Tester"] },
    artifacts: { pdf },
    settings: { dest: "somewhere" },
  });
  expect(progress).toEqual(["gp-demo is an experimental publishing plugin.", "uploading"]);
  expect(fetchCalls).toBe(0);
});

test("publish.<id>.format: html hands the plugin the website export directory", async () => {
  await writePackage("pub", publisher("gp-demo"), RECORDING_PUBLISH);
  await writeManifest("extensions:\n  - ./pub\npublish:\n  gp-demo:\n    format: html\n");
  const site = resolveOutputDir(dir, "Test Book");
  await mkdir(site, { recursive: true });
  await writeFile(path.join(site, BOOK_HTML), "<html></html>");

  const result = await runPublish({ projectDir: dir, providerId: "gp-demo" }, deps());

  expect(result.ok).toBe(true);
  expect(await received()).toMatchObject({ outputDir: site, artifacts: { html: site } });
});

test("a scoped package name works as its manifest key, written quoted by setPublishProviderConfig", async () => {
  await writePackage("pub", publisher("@scope/pub"), RECORDING_PUBLISH);
  await writeManifest("extensions:\n  - ./pub\n");
  await setPublishProviderConfig(dir, "@scope/pub", { dest: "scoped" });
  await withPdf();

  const result = await runPublish({ projectDir: dir, providerId: "@scope/pub" }, deps());

  expect(result.ok).toBe(true);
  expect((await received()).settings).toEqual({ dest: "scoped" });
  expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toContain('"@scope/pub":');
});

test("a returned url that is not http(s) is dropped, and a void return publishes with no url", async () => {
  await writePackage("pub", publisher("gp-demo"), RECORDING_PUBLISH);
  await writeManifest("extensions:\n  - ./pub\n");
  await withPdf();

  (globalThis as Record<string, unknown>).__gpPublishResult = { url: "file:///etc/passwd", detail: "x" };
  expect((await runPublish({ projectDir: dir, providerId: "gp-demo" }, deps())).outcome).toEqual({
    kind: "published",
    detail: "x",
  });

  (globalThis as Record<string, unknown>).__gpPublishResult = null;
  await writePackage(
    "pub",
    publisher("gp-demo"),
    `export async function publish() {}\n// edited ${Date.now()}\n`,
  );
  expect((await runPublish({ projectDir: dir, providerId: "gp-demo" }, deps())).outcome).toEqual({
    kind: "published",
  });
});

test("an error thrown by publish() fails the run with the plugin named", async () => {
  await writePackage("pub", publisher("gp-demo"), 'export async function publish() { throw new Error("quota exceeded"); }\n');
  await writeManifest("extensions:\n  - ./pub\n");
  await withPdf();

  const result = await runPublish({ projectDir: dir, providerId: "gp-demo" }, deps());

  expect(result).toMatchObject({ ok: false, error: 'Publishing plugin "gp-demo": quota exceeded' });
});

test("a publisher without a publish export is a preflight error, also on a dry run", async () => {
  await writePackage("pub", publisher("gp-demo"), "export const nothing = 1;\n");
  await writeManifest("extensions:\n  - ./pub\n");
  await withPdf();

  for (const dryRun of [false, true]) {
    const result = await runPublish({ projectDir: dir, providerId: "gp-demo", dryRun }, deps());
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "error",
      id: "plugin/load-failed",
      message: expect.stringContaining('does not export a `publish` function'),
    });
  }
});

test("an unknown id is a failed result that names every destination the book has", async () => {
  await writePackage("pub", publisher("gp-demo"), RECORDING_PUBLISH);
  await writeManifest("extensions:\n  - ./pub\n");

  const result = await runPublish({ projectDir: dir, providerId: "nope" }, deps());

  expect(result).toEqual({
    ok: false,
    providerId: "nope",
    issues: [],
    error: `Unknown publish provider "nope". Available: ${[...BUILT_IN_IDS, "gp-demo"].join(", ")}.`,
  });
});

// ── npm publishers and restore ──────────────────────────────────────────────

test("a vendored npm publisher publishes under its package name, offline", async () => {
  const name = "gp-npm-demo";
  const pkgDir = vendoredNpmPluginPackageDir(vendoredNpmPluginRoot(dir, name, "1.0.0"), name);
  await writePackage(path.relative(dir, pkgDir), { ...publisher(name), version: "1.0.0", exports: "./index.js" }, RECORDING_PUBLISH);
  await writeManifest(`extensions:\n  - ${name}@1.0.0\n`);
  await withPdf();

  const result = await runPublish({ projectDir: dir, providerId: name }, deps());

  expect(result).toMatchObject({ ok: true, providerId: name });
  expect(fetchCalls).toBe(0);
});

test("an npm entry that is not a publisher says so", async () => {
  const name = "markdown-it-not-a-publisher";
  const pkgDir = vendoredNpmPluginPackageDir(vendoredNpmPluginRoot(dir, name, "1.0.0"), name);
  await writePackage(path.relative(dir, pkgDir), { name, version: "1.0.0", exports: "./index.js" }, "export default () => {};\n");
  await writeManifest(`extensions:\n  - ${name}@1.0.0\n`);

  const result = await runPublish({ projectDir: dir, providerId: name }, deps());

  expect(result.ok).toBe(false);
  expect(result.error).toContain("is not a publishing plugin");
});

test("a fresh clone restores first; offline, the run fails with the restore's own message", async () => {
  await writeManifest("extensions:\n  - gp-not-downloaded@1.0.0\n");

  const result = await runPublish({ projectDir: dir, providerId: "gp-not-downloaded" }, deps());

  expect(fetchCalls).toBeGreaterThan(0);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/offline.*gp-not-downloaded@1\.0\.0/s);
});

test("a built-in publish never restores or loads plugins, even when the book's copies are missing", async () => {
  await writeManifest("extensions:\n  - gp-not-downloaded@1.0.0\npublish:\n  local:\n    dir: out\n");
  await withPdf();

  const result = await runPublish({ projectDir: dir, providerId: "local" }, deps());

  expect(result.ok).toBe(true);
  expect(fetchCalls).toBe(0);
});
