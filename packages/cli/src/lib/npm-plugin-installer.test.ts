/**
 * The npm extension installer (`gutterpress ext add` / the desktop's
 * `addExtension`), end to end through `addExtension`: registry resolution to
 * an exact version, SRI integrity verification, safe extraction, vendoring the
 * complete nested dependency tree under `plugins/npm/`, the atomic manifest
 * pin, and the loader reading that tree back through Node's own module
 * resolution. The registry is a fixture `fetch`; nothing here touches the
 * network.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, strToU8 } from "fflate";

import { loadManifest, resolveConfig } from "./manifest";
import {
  addExtension as addNpmPlugin,
  checkExtensionUpdates,
  listNpmVersions,
  updateExtensions,
  listProjectExtensions as listProjectPlugins,
  removeExtension,
  restoreNpmExtension,
  validateProjectExtensions as validateProjectPlugins,
} from "./extension-manager";
import {
  finalizeNpmPluginInstall,
  installNpmPlugin,
} from "./npm-plugin-installer";
import { loadPlugin } from "./markdown/plugins";
import { restoreFailureMessage, restoreForCommand, restorePinnedExtensions, type RestoreProgress } from "./extension-restore";
import { vendoredNpmPluginPackageDir, vendoredNpmPluginRoot } from "./plugin-vendor";

const TMP_ROOT = path.join(process.cwd(), ".tmp", `npm-plugin-installer-${Date.now()}`);
let counter = 0;

interface TarEntry {
  name: string;
  body?: Uint8Array;
  type?: "0" | "1" | "2";
  linkname?: string;
}

function writeText(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = strToU8(value);
  if (bytes.length > length) throw new Error(`tar fixture field is too long: ${value}`);
  target.set(bytes, offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  writeText(target, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

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
    writeText(header, 156, 1, item.type ?? "0");
    if (item.linkname) writeText(header, 157, 100, item.linkname);
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

function packageEntries(
  expectedName: string,
  version: string,
  actualName = expectedName,
): TarEntry[] {
  return [
    {
      name: "package/package.json",
      body: strToU8(JSON.stringify({
        name: actualName,
        version,
        type: "module",
        exports: "./index.js",
        scripts: { install: "touch INSTALL_SCRIPT_RAN" },
      })),
    },
    {
      name: "package/index.js",
      body: strToU8("export default function plugin(md) { md.__npmPluginLoaded = true; }\n"),
    },
  ];
}

function registryFixture(
  name: string,
  version: string,
  entries: TarEntry[],
  options: { badIntegrity?: boolean; registry?: string } = {},
): { fetch: typeof globalThis.fetch; calls: string[]; archive: Uint8Array } {
  const registry = options.registry ?? "https://registry.npmjs.org";
  const archive = gzipSync(tar(entries), { mtime: 0 });
  const tarball = `${registry}/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
  const integrity = options.badIntegrity
    ? `sha512-${Buffer.alloc(64, 7).toString("base64")}`
    : `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  const metadata = {
    name,
    "dist-tags": { latest: version },
    versions: {
      [version]: {
        name,
        version,
        dist: { tarball, integrity },
      },
    },
  };
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url === `${registry}/${encodeURIComponent(name)}`) {
      return new Response(JSON.stringify(metadata), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url === tarball) return new Response(archive);
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls, archive };
}

interface GraphPackageFixture {
  name: string;
  version: string;
  manifest?: Record<string, unknown>;
  files?: Record<string, string>;
  entries?: TarEntry[];
  integrity?: "strong" | "sha1" | "bad-strong-with-valid-sha1";
}

function registryGraphFixture(packages: GraphPackageFixture[]): {
  fetch: typeof globalThis.fetch;
  calls: string[];
} {
  const grouped = new Map<string, GraphPackageFixture[]>();
  const archives = new Map<string, Uint8Array>();
  const versionsByName = new Map<string, Record<string, unknown>>();

  for (const pkg of packages) {
    const group = grouped.get(pkg.name) ?? [];
    group.push(pkg);
    grouped.set(pkg.name, group);

    const entries = pkg.entries ?? [
      {
        name: "package/package.json",
        body: strToU8(JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          type: "module",
          exports: "./index.js",
          ...pkg.manifest,
        })),
      },
      ...Object.entries(pkg.files ?? {
        "index.js": "export default function plugin(md) { md.__fixtureLoaded = true; }\n",
      }).map(([file, body]) => ({ name: `package/${file}`, body: strToU8(body) })),
    ];
    const archive = gzipSync(tar(entries), { mtime: 0 });
    const leaf = pkg.name.split("/").at(-1)!;
    const tarball = `https://registry.npmjs.org/${pkg.name}/-/${leaf}-${pkg.version}.tgz`;
    const sha1 = createHash("sha1").update(archive).digest("hex");
    const strong = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    const dist = pkg.integrity === "sha1"
      ? { tarball, shasum: sha1 }
      : pkg.integrity === "bad-strong-with-valid-sha1"
        ? { tarball, integrity: `sha512-${Buffer.alloc(64, 9).toString("base64")} sha1-${Buffer.from(sha1, "hex").toString("base64")}` }
        : { tarball, integrity: strong };
    const versions = versionsByName.get(pkg.name) ?? {};
    versions[pkg.version] = { name: pkg.name, version: pkg.version, dist };
    versionsByName.set(pkg.name, versions);
    archives.set(tarball, archive);
  }

  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [name, group] of grouped) {
      if (url !== `${NPM_REGISTRY_FOR_TESTS}/${encodeURIComponent(name)}`) continue;
      const versions = versionsByName.get(name)!;
      return new Response(JSON.stringify({
        name,
        "dist-tags": { latest: group.at(-1)!.version },
        versions,
      }), { headers: { "content-type": "application/json" } });
    }
    const archive = archives.get(url);
    return archive ? new Response(archive) : new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const NPM_REGISTRY_FOR_TESTS = "https://registry.npmjs.org";

async function projectDir(): Promise<string> {
  const dir = path.join(TMP_ROOT, `project-${counter++}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function installFixtureOnly(
  dir: string,
  spec: string,
  fetch: typeof globalThis.fetch,
): Promise<void> {
  const installed = await installNpmPlugin(dir, spec, { fetch });
  await finalizeNpmPluginInstall(installed);
}

async function loadedMarker(
  dir: string,
  name: string,
  version: string,
  key: string,
): Promise<unknown> {
  const loaded = await loadPlugin(
    { use: `${name}@${version}`, name, version, options: {} },
    dir,
  );
  const md: Record<string, unknown> = {};
  loaded.plugin(md as never, {});
  return md[key];
}

/** The vendored package folder of `name` inside the root plugin's own tree. */
function vendoredDependencyDir(dir: string, root: string, version: string, ...nested: string[]): string {
  let current = vendoredNpmPluginPackageDir(vendoredNpmPluginRoot(dir, root, version), root);
  for (const dependency of nested) current = path.join(current, "node_modules", ...dependency.split("/"));
  return current;
}

async function installedVersion(packageDir: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

beforeEach(async () => {
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe("npm plugin installation", () => {
  test("resolves latest, verifies and vendors the tarball, pins the manifest, and loads without running scripts", async () => {
    const dir = await projectDir();
    const name = "markdown-it-gutterpress-fixture";
    const version = "1.2.3";
    const fixture = registryFixture(name, version, packageEntries(name, version));

    const result = await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(result).toMatchObject({ use: `${name}@${version}`, name, kind: "npm", enabled: true, version });
    expect(fixture.calls).toEqual([
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    ]);
    const installRoot = vendoredNpmPluginRoot(dir, name, version);
    const packageDir = vendoredNpmPluginPackageDir(installRoot, name);
    expect(existsSync(path.join(packageDir, "index.js"))).toBe(true);
    expect(existsSync(path.join(packageDir, "INSTALL_SCRIPT_RAN"))).toBe(false);
    expect(existsSync(path.join(dir, "INSTALL_SCRIPT_RAN"))).toBe(false);
    // The vendored root is a plain npm layout and nothing else: no marker,
    // receipt, or lockfile for anything to verify later.
    expect(await readdir(installRoot)).toEqual(["node_modules"]);

    const listed = await listProjectPlugins(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ use: `${name}@${version}`, kind: "npm", enabled: true, version });
    // An installed npm package IS a markdown-it plugin (its entry is what the
    // installer load-tested), whether or not its package.json says so.
    expect(listed[0]?.carries.markdown).toBe(true);
    const resolved = resolveConfig({}, await loadManifest(dir));
    expect(resolved.extensions[0]?.version).toBe(version);
    expect((await validateProjectPlugins(dir))[0]?.ok).toBe(true);
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toContain(`${name}@${version}`);
    expect(await loadedMarker(dir, name, version, "__npmPluginLoaded")).toBe(true);
  });

  test("keeps downloaded extensions out of the book's version history: appends plugins/npm/ to .gitignore", async () => {
    const dir = await projectDir();
    await writeFile(path.join(dir, ".gitignore"), "*.log", "utf8");
    const name = "markdown-it-ignore-fixture";
    const fixture = registryFixture(name, "1.0.0", packageEntries(name, "1.0.0"));

    const result = await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toBe("*.log\ndist/\nplugins/npm/\n");
    expect(result.warnings ?? []).toEqual([]);
    // A second install finds both covered and writes nothing more.
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toBe("*.log\ndist/\nplugins/npm/\n");
  });

  test("an author's own re-include of plugins/npm/ is respected, and the install warns about it", async () => {
    const dir = await projectDir();
    const original = "dist/\n!**/plugins/npm/**\n";
    await writeFile(path.join(dir, ".gitignore"), original, "utf8");
    const name = "markdown-it-negated-fixture";
    const fixture = registryFixture(name, "1.0.0", packageEntries(name, "1.0.0"));

    const result = await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toBe(original);
    expect(result).toMatchObject({ use: `${name}@1.0.0` });
    expect(result.warnings?.some((w) => /re-includes plugins\/npm\/.*shouldn't/.test(w))).toBe(true);
  });

  test("GUTTERPRESS_NPM_REGISTRY: a package vendored from a private mirror installs and loads", async () => {
    const mirror = "http://127.0.0.1:4873";
    const previous = process.env.GUTTERPRESS_NPM_REGISTRY;
    process.env.GUTTERPRESS_NPM_REGISTRY = mirror;
    try {
      const dir = await projectDir();
      const name = "markdown-it-mirror-fixture";
      const version = "1.0.0";
      const fixture = registryFixture(name, version, packageEntries(name, version), { registry: mirror });

      const result = await addNpmPlugin(dir, name, { fetch: fixture.fetch });

      expect(result).toMatchObject({ use: `${name}@${version}`, name, kind: "npm", version });
      expect(fixture.calls).toEqual([
        `${mirror}/${encodeURIComponent(name)}`,
        `${mirror}/${name}/-/${name}-${version}.tgz`,
      ]);
      expect((await validateProjectPlugins(dir))[0]?.ok).toBe(true);
      expect(await loadedMarker(dir, name, version, "__npmPluginLoaded")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.GUTTERPRESS_NPM_REGISTRY;
      else process.env.GUTTERPRESS_NPM_REGISTRY = previous;
    }
  });

  test("rejects an integrity mismatch and leaves no partial install or manifest entry", async () => {
    const dir = await projectDir();
    const name = "markdown-it-bad-integrity-fixture";
    const version = "2.0.0";
    const fixture = registryFixture(name, version, packageEntries(name, version), {
      badIntegrity: true,
    });

    await expect(addNpmPlugin(dir, `${name}@${version}`, { fetch: fixture.fetch })).rejects.toThrow(
      /integrity check/i,
    );

    expect(existsSync(vendoredNpmPluginRoot(dir, name, version))).toBe(false);
    expect(await listProjectPlugins(dir)).toEqual([]);
    // Nothing of the failed attempt is left: not its staging folder, and not
    // the empty plugins/npm/<name>/ folders it created.
    expect(existsSync(path.join(dir, "plugins"))).toBe(false);
  });

  test("a failed install removes only the folders it created, and nothing that was already there", async () => {
    const name = "markdown-it-cleanup-fixture";
    const failing = registryFixture(name, "1.0.0", packageEntries(name, "1.0.0"), { badIntegrity: true });

    // A local plugin already lives in plugins/: it and plugins/ stay, plugins/npm/ goes.
    const withLocal = await projectDir();
    await mkdir(path.join(withLocal, "plugins"), { recursive: true });
    await writeFile(path.join(withLocal, "plugins", "local.js"), "export default () => {};\n", "utf8");
    await expect(addNpmPlugin(withLocal, name, { fetch: failing.fetch })).rejects.toThrow(/integrity/i);
    expect(await readdir(path.join(withLocal, "plugins"))).toEqual(["local.js"]);

    // Another package's copy already lives in plugins/npm/: it stays, this package's folder goes.
    const withOther = await projectDir();
    const other = "markdown-it-cleanup-other";
    await addNpmPlugin(withOther, other, { fetch: registryFixture(other, "2.0.0", packageEntries(other, "2.0.0")).fetch });
    await expect(addNpmPlugin(withOther, name, { fetch: failing.fetch })).rejects.toThrow(/integrity/i);
    expect(await readdir(path.join(withOther, "plugins", "npm"))).toEqual([other]);

    // A failure to even reach the registry cleans up the same way.
    const offline = await projectDir();
    const dead = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof globalThis.fetch;
    await expect(addNpmPlugin(offline, name, { fetch: dead })).rejects.toThrow();
    expect(existsSync(path.join(offline, "plugins"))).toBe(false);
  });

  test("an install that downloads fine but will not load is rolled back without leaving its folders", async () => {
    const dir = await projectDir();
    const name = "markdown-it-rollback-cleanup";
    const entries = packageEntries(name, "1.0.0");
    entries[1] = { name: "package/index.js", body: strToU8("export const notAPlugin = true;\n") };
    const fixture = registryFixture(name, "1.0.0", entries);

    await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(/not a loadable markdown-it plugin/i);

    expect(existsSync(path.join(dir, "plugins"))).toBe(false);
  });

  test("removing the only extension also removes its now-empty package folder", async () => {
    const dir = await projectDir();
    const name = "markdown-it-remove-cleanup";
    await addNpmPlugin(dir, name, { fetch: registryFixture(name, "1.0.0", packageEntries(name, "1.0.0")).fetch });

    await removeExtension(dir, `${name}@1.0.0`);

    expect(await readdir(path.join(dir, "plugins", "npm"))).toEqual([]);
  });

  test("rejects path traversal and links and cleans staging", async () => {
    for (const [suffix, unsafe] of [
      ["traversal", { name: "package/../../escaped.js", body: strToU8("bad") }],
      ["symlink", { name: "package/link.js", type: "2" as const, linkname: "../../escaped.js" }],
      ["hardlink", { name: "package/link.js", type: "1" as const, linkname: "../../escaped.js" }],
    ] as const) {
      const dir = await projectDir();
      const name = `markdown-it-${suffix}-fixture`;
      const version = "1.0.0";
      const fixture = registryFixture(name, version, [...packageEntries(name, version), unsafe]);

      await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(
        /unsafe|symbolic link|hard link|safely extracted/i,
      );
      expect(existsSync(path.join(dir, "escaped.js"))).toBe(false);
      expect(existsSync(vendoredNpmPluginRoot(dir, name, version))).toBe(false);
      expect(await listProjectPlugins(dir)).toEqual([]);
    }
  });

  test("rejects a tarball whose package identity does not match registry metadata", async () => {
    const dir = await projectDir();
    const name = "markdown-it-identity-fixture";
    const version = "4.5.6";
    const fixture = registryFixture(
      name,
      version,
      packageEntries(name, version, "markdown-it-different-package"),
    );

    await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(
      /instead of.*markdown-it-identity-fixture@4\.5\.6/i,
    );
    expect(existsSync(vendoredNpmPluginRoot(dir, name, version))).toBe(false);
    expect(await listProjectPlugins(dir)).toEqual([]);
  });

  test("removes a downloaded package when its module is not a markdown-it plugin", async () => {
    const dir = await projectDir();
    const name = "markdown-it-invalid-export-fixture";
    const version = "1.0.0";
    const entries = packageEntries(name, version);
    entries[1] = {
      name: "package/index.js",
      body: strToU8("export const notAPlugin = true;\n"),
    };
    const fixture = registryFixture(name, version, entries);

    await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(
      /not a loadable markdown-it plugin/i,
    );
    expect(existsSync(vendoredNpmPluginRoot(dir, name, version))).toBe(false);
    expect(await listProjectPlugins(dir)).toEqual([]);
  });

  test("rejects a root package with no JavaScript entry before anything is published", async () => {
    const dir = await projectDir();
    const name = "markdown-it-no-entry-fixture";
    const fixture = registryGraphFixture([{
      name,
      version: "1.0.0",
      entries: [
        { name: "package/package.json", body: strToU8(JSON.stringify({ name, version: "1.0.0" })) },
        { name: "package/README.md", body: strToU8("# nothing to run\n") },
      ],
    }]);

    await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(
      /no JavaScript plugin entry/i,
    );
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(false);
    expect(await listProjectPlugins(dir)).toEqual([]);
  });

  test("installs, records, and loads an explicitly selected named export", async () => {
    const dir = await projectDir();
    const name = "markdown-it-named-export-fixture";
    const fixture = registryGraphFixture([{
      name,
      version: "1.0.0",
      files: {
        "index.js": "export function full() {}\nexport function light() {}\n",
      },
    }]);

    const result = await addNpmPlugin(dir, name, {
      fetch: fixture.fetch,
      exportName: "full",
    });

    expect(result).toMatchObject({ use: `${name}@1.0.0`, version: "1.0.0", export: "full" });
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toContain("export: full");
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("vendors a complete transitive dependency tree that the plugin's own imports resolve through", async () => {
    const dir = await projectDir();
    const name = "markdown-it-transitive-fixture";
    const dependency = "gutterpress-transitive-dependency";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: { dependencies: { [dependency]: "^2.0.0" } },
        files: {
          "index.js": `import { answer } from "${dependency}";\nif (answer !== 42) throw new Error("dependency did not load");\nexport default function plugin(md) { md.answer = answer; }\n`,
        },
      },
      {
        name: dependency,
        version: "2.1.0",
        files: { "index.js": "export const answer = 42;\n" },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    // npm's nested layout: the dependency sits in the plugin's OWN
    // node_modules, where Node's resolution finds it with no help from us.
    const dependencyDir = vendoredDependencyDir(dir, name, "1.0.0", dependency);
    expect(await installedVersion(dependencyDir)).toBe("2.1.0");
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
    expect(await loadedMarker(dir, name, "1.0.0", "answer")).toBe(42);
  });

  test("loads a CommonJS plugin and its CommonJS dependencies through a plain import()", async () => {
    const dir = await projectDir();
    const name = "markdown-it-commonjs-graph-fixture";
    const dependency = "gutterpress-commonjs-dependency";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: {
          type: "commonjs",
          main: "index.cjs",
          exports: "./index.cjs",
          dependencies: { [dependency]: "1.0.0" },
        },
        files: {
          "index.cjs": `const value = require("${dependency}");\nif (value !== 42) throw new Error("dependency did not load");\nmodule.exports = function plugin(md) { md.value = value; };\n`,
        },
      },
      {
        name: dependency,
        version: "1.0.0",
        manifest: { type: "commonjs", main: "index.cjs", exports: "./index.cjs" },
        files: { "index.cjs": "module.exports = 42;\n" },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
    expect(await loadedMarker(dir, name, "1.0.0", "value")).toBe(42);
  });

  test("honors require conditions, wildcard subpaths, and JSON export targets", async () => {
    const dir = await projectDir();
    const name = "markdown-it-commonjs-exports-fixture";
    const dependency = "gutterpress-commonjs-exports-dependency";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: {
          type: "commonjs",
          main: "index.cjs",
          exports: "./index.cjs",
          dependencies: { [dependency]: "1.0.0" },
        },
        files: {
          "index.cjs": [
            `const feature = require("${dependency}/features/answer");`,
            `const data = require("${dependency}/data");`,
            `if (feature !== 42 || data.label !== "json-data") throw new Error("exports mismatch");`,
            "module.exports = function plugin() {};",
          ].join("\n"),
        },
      },
      {
        name: dependency,
        version: "1.0.0",
        manifest: {
          type: "commonjs",
          exports: {
            ".": { import: "./wrong.mjs", require: "./index.cjs" },
            "./features/*": { import: "./wrong/*.mjs", require: "./features/*.cjs" },
            "./data": "./data.json",
          },
        },
        files: {
          "index.cjs": "module.exports = true;\n",
          "features/answer.cjs": "module.exports = 42;\n",
          "data.json": JSON.stringify({ label: "json-data" }),
          "wrong.mjs": "throw new Error('import condition selected for require');\n",
        },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("a plugin's own dynamic import() of a dependency resolves through the vendored tree", async () => {
    const dir = await projectDir();
    const name = "markdown-it-dynamic-import-fixture";
    const dependency = "gutterpress-dynamic-import-dependency";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: { dependencies: { [dependency]: "1.0.0" } },
        files: {
          "index.js": `const loaded = await import("${dependency}");\nexport default function plugin(md) { md.dynamic = loaded.value; }\n`,
        },
      },
      {
        name: dependency,
        version: "1.0.0",
        files: { "index.js": "export const value = 'vendored-dynamic';\n" },
      },
    ]);
    await addNpmPlugin(dir, name, { fetch: fixture.fetch });
    expect(await loadedMarker(dir, name, "1.0.0", "dynamic")).toBe("vendored-dynamic");
  });

  test("keeps conflicting transitive versions in their parents' nested node_modules", async () => {
    const dir = await projectDir();
    const name = "markdown-it-conflict-fixture";
    const left = "gutterpress-left-fixture";
    const right = "gutterpress-right-fixture";
    const shared = "gutterpress-shared-fixture";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: { dependencies: { [left]: "1.0.0", [right]: "1.0.0" } },
        files: {
          "index.js": `import "${left}";\nimport "${right}";\nexport default function plugin() {}\n`,
        },
      },
      {
        name: left,
        version: "1.0.0",
        manifest: { dependencies: { [shared]: "^1.0.0" } },
        files: {
          "index.js": `import value from "${shared}";\nif (value !== "one") throw new Error("wrong left version");\n`,
        },
      },
      {
        name: right,
        version: "1.0.0",
        manifest: { dependencies: { [shared]: "^2.0.0" } },
        files: {
          "index.js": `import value from "${shared}";\nif (value !== "two") throw new Error("wrong right version");\n`,
        },
      },
      { name: shared, version: "1.4.0", files: { "index.js": "export default \"one\";\n" } },
      { name: shared, version: "2.3.0", files: { "index.js": "export default \"two\";\n" } },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(await installedVersion(vendoredDependencyDir(dir, name, "1.0.0", left, shared))).toBe("1.4.0");
    expect(await installedVersion(vendoredDependencyDir(dir, name, "1.0.0", right, shared))).toBe("2.3.0");
    // Each side's import found its own copy (the throws above would otherwise
    // have failed the load-test and the validation).
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("handles cycles without downloading or nesting a duplicate ancestor", async () => {
    const dir = await projectDir();
    const name = "markdown-it-cycle-fixture";
    const dependency = "gutterpress-cycle-dependency";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: { dependencies: { [dependency]: "1.0.0" } },
        files: { "index.js": `import "${dependency}";\nexport default function plugin() {}\n` },
      },
      {
        name: dependency,
        version: "1.0.0",
        manifest: { dependencies: { [name]: "1.0.0" } },
        files: { "index.js": `import "${name}";\nexport const loaded = true;\n` },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(existsSync(vendoredDependencyDir(dir, name, "1.0.0", dependency))).toBe(true);
    // The ancestor is reached by walking back up the tree, not re-vendored.
    expect(existsSync(vendoredDependencyDir(dir, name, "1.0.0", dependency, name))).toBe(false);
    expect(fixture.calls.filter((url) => url.endsWith(`${name}-1.0.0.tgz`))).toHaveLength(1);
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("loads the import condition of an ESM-only root entry", async () => {
    const dir = await projectDir();
    const name = "markdown-it-esm-entry-fixture";
    const fixture = registryGraphFixture([{
      name,
      version: "1.0.0",
      manifest: {
        exports: { ".": { import: "./esm.mjs", require: "./wrong.cjs" } },
      },
      files: {
        "esm.mjs": "export default function plugin(md) { md.entry = 'esm'; }\n",
        "wrong.cjs": "throw new Error('require entry must not run');\n",
      },
    }]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(await loadedMarker(dir, name, "1.0.0", "entry")).toBe("esm");
  });

  test("installs required peers and leaves out unavailable optional dependencies and optional peers", async () => {
    const dir = await projectDir();
    const name = "markdown-it-peer-fixture";
    const requiredPeer = "gutterpress-required-peer";
    const optional = "gutterpress-missing-optional";
    const optionalParent = "gutterpress-optional-parent";
    const optionalPeer = "gutterpress-optional-peer";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: {
          optionalDependencies: { [optional]: "^1.0.0", [optionalParent]: "1.0.0" },
          peerDependencies: { [requiredPeer]: "^3.0.0", [optionalPeer]: "^1.0.0" },
          peerDependenciesMeta: { [optionalPeer]: { optional: true } },
        },
      },
      { name: requiredPeer, version: "3.2.0" },
      {
        name: optionalParent,
        version: "1.0.0",
        manifest: { dependencies: { "gutterpress-missing-child": "1.0.0" } },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(existsSync(vendoredDependencyDir(dir, name, "1.0.0", requiredPeer))).toBe(true);
    expect(existsSync(vendoredDependencyDir(dir, name, "1.0.0", optional))).toBe(false);
    // An optional dependency whose OWN required child is unavailable is
    // dropped whole, not left half-installed.
    expect(existsSync(vendoredDependencyDir(dir, name, "1.0.0", optionalParent))).toBe(false);
    expect(existsSync(vendoredDependencyDir(dir, name, "1.0.0", optionalPeer))).toBe(false);
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("accepts the legacy package-name tar root used by @types dependencies", async () => {
    const dir = await projectDir();
    const name = "markdown-it-types-root-fixture";
    const typesName = "@types/markdown-it";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: { peerDependencies: { [typesName]: "14.1.2" } },
      },
      {
        name: typesName,
        version: "14.1.2",
        entries: [
          {
            name: "markdown-it/package.json",
            body: strToU8(JSON.stringify({ name: typesName, version: "14.1.2" })),
          },
          {
            name: "markdown-it/index.d.ts",
            body: strToU8("declare class MarkdownIt {}\nexport = MarkdownIt;\n"),
          },
        ],
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(await installedVersion(vendoredDependencyDir(dir, name, "1.0.0", typesName))).toBe("14.1.2");
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("fails a missing required dependency but skips an unsupported optional selector", async () => {
    const requiredDir = await projectDir();
    const requiredName = "markdown-it-missing-required-fixture";
    const requiredFixture = registryGraphFixture([{
      name: requiredName,
      version: "1.0.0",
      manifest: { dependencies: { "gutterpress-not-published": "^1.0.0" } },
    }]);
    await expect(addNpmPlugin(requiredDir, requiredName, { fetch: requiredFixture.fetch })).rejects.toThrow(
      /not found/i,
    );
    expect(await listProjectPlugins(requiredDir)).toEqual([]);

    const optionalDir = await projectDir();
    const optionalName = "markdown-it-selector-fixture";
    const optionalFixture = registryGraphFixture([{
      name: optionalName,
      version: "1.0.0",
      manifest: { optionalDependencies: { "gutterpress-local-only": "file:../local" } },
    }]);
    await addNpmPlugin(optionalDir, optionalName, { fetch: optionalFixture.fetch });
    expect(
      existsSync(vendoredDependencyDir(optionalDir, optionalName, "1.0.0", "gutterpress-local-only")),
    ).toBe(false);
    expect((await validateProjectPlugins(optionalDir))[0]).toMatchObject({ ok: true });
  });

  test("tolerates optional network failures and timeouts without hiding required failures", async () => {
    const dir = await projectDir();
    const name = "markdown-it-optional-network-fixture";
    const offline = "gutterpress-optional-offline";
    const timedOut = "gutterpress-optional-timeout";
    const fixture = registryGraphFixture([{
      name,
      version: "1.0.0",
      manifest: {
        optionalDependencies: {
          [offline]: "1.0.0",
          [timedOut]: "1.0.0",
        },
      },
    }]);
    const optionalFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith(encodeURIComponent(offline))) throw new TypeError("socket unavailable");
      if (url.endsWith(encodeURIComponent(timedOut))) {
        throw new DOMException("registry deadline", "TimeoutError");
      }
      return fixture.fetch(input, init);
    }) as typeof globalThis.fetch;

    await addNpmPlugin(dir, name, { fetch: optionalFetch });

    expect(existsSync(vendoredDependencyDir(dir, name, "1.0.0", offline))).toBe(false);
    expect(existsSync(vendoredDependencyDir(dir, name, "1.0.0", timedOut))).toBe(false);
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });

    const requiredDir = await projectDir();
    const requiredName = "markdown-it-required-network-fixture";
    const required = "gutterpress-required-offline";
    const requiredFixture = registryGraphFixture([{
      name: requiredName,
      version: "1.0.0",
      manifest: { dependencies: { [required]: "1.0.0" } },
    }]);
    const requiredFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith(encodeURIComponent(required))) throw new TypeError("required socket unavailable");
      return requiredFixture.fetch(input, init);
    }) as typeof globalThis.fetch;
    await expect(
      addNpmPlugin(requiredDir, requiredName, { fetch: requiredFetch }),
    ).rejects.toThrow(/required socket unavailable|failed/i);
  });

  test("never suppresses a security failure in an optional dependency", async () => {
    const dir = await projectDir();
    const name = "markdown-it-unsafe-optional-fixture";
    const dependency = "gutterpress-unsafe-optional";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: { optionalDependencies: { [dependency]: "1.0.0" } },
      },
      {
        name: dependency,
        version: "1.0.0",
        entries: [
          ...packageEntries(dependency, "1.0.0"),
          { name: "package/../../escape.js", body: strToU8("bad") },
        ],
      },
    ]);

    await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(/unsafe path/i);
    expect(await listProjectPlugins(dir)).toEqual([]);

    const integrityDir = await projectDir();
    const integrityName = "markdown-it-integrity-optional-fixture";
    const integrityDependency = "gutterpress-integrity-optional";
    const integrityFixture = registryGraphFixture([
      {
        name: integrityName,
        version: "1.0.0",
        manifest: { optionalDependencies: { [integrityDependency]: "1.0.0" } },
      },
      {
        name: integrityDependency,
        version: "1.0.0",
        integrity: "bad-strong-with-valid-sha1",
      },
    ]);
    await expect(addNpmPlugin(integrityDir, integrityName, {
      fetch: integrityFixture.fetch,
    })).rejects.toThrow(/integrity check/i);
    expect(await listProjectPlugins(integrityDir)).toEqual([]);

    const limitedDir = await projectDir();
    const limitedName = "markdown-it-oversized-optional-fixture";
    const limitedDependency = "gutterpress-oversized-optional";
    const limitedFixture = registryGraphFixture([
      {
        name: limitedName,
        version: "1.0.0",
        manifest: { optionalDependencies: { [limitedDependency]: "1.0.0" } },
      },
      {
        name: limitedDependency,
        version: "1.0.0",
        files: { "index.js": "x".repeat(2048) },
      },
    ]);
    await expect(addNpmPlugin(limitedDir, limitedName, {
      fetch: limitedFixture.fetch,
      limits: { packageFileBytes: 1024 },
    })).rejects.toThrow(/file exceeds/i);
    expect(await listProjectPlugins(limitedDir)).toEqual([]);
  });

  test("rejects bundled node_modules and Windows aliases before publication", async () => {
    for (const [suffix, unsafe] of [
      ["bundled", "package/node_modules/hidden/index.js"],
      ["nested-bundled", "package/lib/node_modules/hidden.js"],
      ["case-bundled", "package/lib/NoDe_MoDuLeS/hidden.js"],
      ["nfkc-bundled", "package/lib/ｎｏｄｅ＿ｍｏｄｕｌｅｓ/hidden.js"],
      ["reserved", "package/con.js"],
      ["trailing", "package/file. "],
    ] as const) {
      const dir = await projectDir();
      const name = `markdown-it-${suffix}-path-fixture`;
      const fixture = registryGraphFixture([{
        name,
        version: "1.0.0",
        entries: [...packageEntries(name, "1.0.0"), { name: unsafe, body: strToU8("bad") }],
      }]);
      await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(
        /node_modules|Windows|invalid/i,
      );
      expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(false);
    }

    const collisionDir = await projectDir();
    const collisionName = "markdown-it-case-collision-fixture";
    const collisionFixture = registryGraphFixture([{
      name: collisionName,
      version: "1.0.0",
      entries: [
        ...packageEntries(collisionName, "1.0.0"),
        { name: "package/INDEX.JS", body: strToU8("duplicate") },
      ],
    }]);
    await expect(addNpmPlugin(collisionDir, collisionName, { fetch: collisionFixture.fetch })).rejects.toThrow(
      /Windows-colliding/i,
    );
  });

  test("enforces metadata, file-count, expansion, and package-count limits", async () => {
    const cases: Array<{
      suffix: string;
      limits: Record<string, number>;
      expected: RegExp;
      packages?: GraphPackageFixture[];
    }> = [
      { suffix: "metadata-limit", limits: { metadataBytes: 32 }, expected: /too large/i },
      { suffix: "file-limit", limits: { packageFileBytes: 64 }, expected: /file exceeds/i },
      { suffix: "count-limit", limits: { totalFiles: 1 }, expected: /exceeds 1 files/i },
      { suffix: "expand-limit", limits: { totalUnpackedBytes: 512 }, expected: /expands beyond/i },
    ];
    for (const item of cases) {
      const dir = await projectDir();
      const name = `markdown-it-${item.suffix}-fixture`;
      const fixture = registryGraphFixture(item.packages ?? [{ name, version: "1.0.0" }]);
      await expect(addNpmPlugin(dir, name, {
        fetch: fixture.fetch,
        limits: item.limits,
      })).rejects.toThrow(item.expected);
      expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(false);
    }

    const dir = await projectDir();
    const name = "markdown-it-package-limit-fixture";
    const dependency = "gutterpress-package-limit-dependency";
    const fixture = registryGraphFixture([
      { name, version: "1.0.0", manifest: { dependencies: { [dependency]: "1.0.0" } } },
      { name: dependency, version: "1.0.0" },
    ]);
    await expect(addNpmPlugin(dir, name, {
      fetch: fixture.fetch,
      limits: { totalPackages: 1 },
    })).rejects.toThrow(/exceeds 1 packages/i);
  });

  test("cancels a response before writing a chunk beyond the remaining graph budget", async () => {
    const dir = await projectDir();
    const name = "markdown-it-stream-budget-fixture";
    const fixture = registryFixture(name, "1.0.0", packageEntries(name, "1.0.0"));
    const metadataUrl = `${NPM_REGISTRY_FOR_TESTS}/${encodeURIComponent(name)}`;
    const metadataResponse = await fixture.fetch(metadataUrl);
    const metadataBytes = new TextEncoder().encode(await metadataResponse.text()).length;
    let cancelled = false;
    const budgetedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith(`${name}-1.0.0.tgz`)) return fixture.fetch(input, init);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(fixture.archive.slice(0, 10));
          controller.enqueue(fixture.archive.slice(10));
        },
        cancel() {
          cancelled = true;
        },
      }));
    }) as typeof globalThis.fetch;

    await expect(addNpmPlugin(dir, name, {
      fetch: budgetedFetch,
      limits: { totalNetworkBytes: metadataBytes + 10 },
    })).rejects.toThrow(/total.*limit/i);
    expect(cancelled).toBe(true);
    expect(await listProjectPlugins(dir)).toEqual([]);
  });

  test("uses the strongest registry integrity and warns when only legacy SHA-1 exists", async () => {
    const badDir = await projectDir();
    const badName = "markdown-it-strongest-integrity-fixture";
    const badFixture = registryGraphFixture([{
      name: badName,
      version: "1.0.0",
      integrity: "bad-strong-with-valid-sha1",
    }]);
    await expect(addNpmPlugin(badDir, badName, { fetch: badFixture.fetch })).rejects.toThrow(
      /integrity check/i,
    );

    const legacyDir = await projectDir();
    const legacyName = "markdown-it-legacy-sha-fixture";
    const legacyFixture = registryGraphFixture([{
      name: legacyName,
      version: "1.0.0",
      integrity: "sha1",
    }]);
    const result = await addNpmPlugin(legacyDir, legacyName, { fetch: legacyFixture.fetch });
    expect(result.warnings?.[0]).toMatch(/SHA-1/i);
    expect((await validateProjectPlugins(legacyDir))[0]).toMatchObject({ ok: true });
  });

  test("a vendored copy that will not load fails closed instead of using project node_modules", async () => {
    const dir = await projectDir();
    const name = "markdown-it-corrupt-tree-fixture";
    const fixture = registryGraphFixture([{ name, version: "1.0.0" }]);
    await installFixtureOnly(dir, name, fixture.fetch);
    const installRoot = vendoredNpmPluginRoot(dir, name, "1.0.0");
    await writeFile(path.join(vendoredNpmPluginPackageDir(installRoot, name), "index.js"), "throw new Error('corrupt');\n");

    const fallback = path.join(dir, "node_modules", name);
    await mkdir(fallback, { recursive: true });
    await writeFile(path.join(fallback, "package.json"), JSON.stringify({ name, version: "9.9.9", type: "module" }));
    await writeFile(path.join(fallback, "index.js"), "export default function plugin() {}\n");

    await expect(
      loadPlugin({ use: `${name}@1.0.0`, name, version: "1.0.0", options: {} }, dir),
    ).rejects.toThrow(/corrupt/);
  });

  test("a vendored copy missing its package.json reports reinstall, not the fallback package", async () => {
    const dir = await projectDir();
    const name = "markdown-it-missing-manifest-fixture";
    const fixture = registryGraphFixture([{ name, version: "1.0.0" }]);
    await installFixtureOnly(dir, name, fixture.fetch);
    await rm(path.join(vendoredNpmPluginPackageDir(vendoredNpmPluginRoot(dir, name, "1.0.0"), name), "package.json"));
    const fallback = path.join(dir, "node_modules", name);
    await mkdir(fallback, { recursive: true });
    await writeFile(path.join(fallback, "package.json"), JSON.stringify({ name, version: "9.9.9", type: "module" }));
    await writeFile(path.join(fallback, "index.js"), "export default function plugin() {}\n");

    await expect(
      loadPlugin({ use: `${name}@1.0.0`, name, version: "1.0.0", options: {} }, dir),
    ).rejects.toThrow(/incomplete.*Reinstall it with `gutterpress ext add/i);
  });

  test("explicit reinstall downloads fresh bytes and replaces a corrupt same-version tree", async () => {
    const dir = await projectDir();
    const name = "markdown-it-fresh-reinstall-fixture";
    const fixture = registryGraphFixture([{ name, version: "1.0.0" }]);
    await addNpmPlugin(dir, name, { fetch: fixture.fetch });
    const installRoot = vendoredNpmPluginRoot(dir, name, "1.0.0");
    const entry = path.join(vendoredNpmPluginPackageDir(installRoot, name), "index.js");
    await writeFile(entry, "corrupt\n");

    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });

    expect(await readFile(entry, "utf8")).toContain("export default function plugin");
    expect(fixture.calls.filter((url) => url.endsWith(`${name}-1.0.0.tgz`))).toHaveLength(2);
    expect((await readdir(path.dirname(installRoot))).some((item) => item.includes(".backup-"))).toBe(false);
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("rejects a vendor install root symlink that redirects outside the project", async () => {
    const dir = await projectDir();
    const name = "markdown-it-install-root-symlink-fixture";
    const fixture = registryGraphFixture([{ name, version: "1.0.0" }]);
    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    const installRoot = vendoredNpmPluginRoot(dir, name, "1.0.0");
    const externalRoot = path.join(TMP_ROOT, `external-vendor-${counter++}`);
    await rename(installRoot, externalRoot);
    await symlink(
      externalRoot,
      installRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    const validation = await validateProjectPlugins(dir);
    expect(validation[0]).toMatchObject({ ok: false });
    expect(validation[0]?.error).toMatch(/install root.*normal directory|outside the book folder/i);
  });

  test("rolls the vendor tree and manifest back when activation fails before commit", async () => {
    const dir = await projectDir();
    const name = "markdown-it-transaction-fixture";
    const fixture = registryGraphFixture([
      { name, version: "1.0.0" },
      { name, version: "2.0.0" },
    ]);
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
    const manifestBefore = await readFile(path.join(dir, "manifest.yaml"), "utf8");

    await expect(addNpmPlugin(dir, `${name}@2.0.0`, {
      fetch: fixture.fetch,
      __testFailBeforeManifestCommit: () => {
        throw new Error("forced manifest failure");
      },
    })).rejects.toThrow(/forced manifest failure/i);

    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toBe(manifestBefore);
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(true);
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "2.0.0"))).toBe(false);
  });

  test("serializes concurrent mutations for the same project without losing manifest entries", async () => {
    const dir = await projectDir();
    const first = "markdown-it-concurrent-first-fixture";
    const second = "markdown-it-concurrent-second-fixture";
    const fixture = registryGraphFixture([
      { name: first, version: "1.0.0" },
      { name: second, version: "1.0.0" },
    ]);
    let releaseFirst!: () => void;
    let firstAtCommit!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const atCommit = new Promise<void>((resolve) => { firstAtCommit = resolve; });

    const firstInstall = addNpmPlugin(dir, first, {
      fetch: fixture.fetch,
      __testFailBeforeManifestCommit: async () => {
        firstAtCommit();
        await release;
      },
    });
    await atCommit;
    const secondInstall = addNpmPlugin(dir, second, { fetch: fixture.fetch });
    await Bun.sleep(10);
    expect(fixture.calls.some((url) => url.includes(second))).toBe(false);
    releaseFirst();
    await Promise.all([firstInstall, secondInstall]);

    expect((await listProjectPlugins(dir)).map((entry) => entry.name)).toEqual([first, second]);
  });

  // #262 — validate/preflight must see a vendored plugin's declared styles
  // exactly as `gutterpress lint` does; before the fix, only lint ever looked
  // at them. Pinned against a real vendored plugin (a path plugin would pass
  // through a different code path).
  test("#262: validate sees a vendored plugin's declared styles file", async () => {
    const dir = await projectDir();
    const name = "markdown-it-262-validate-gap-fixture";
    const fixture = registryGraphFixture([{
      name,
      version: "1.0.0",
      files: {
        "index.js": "export default function plugin() {}\nexport const styles = ['./plugin.css'];\n",
        // A print-unsafe rule (checks/source/stylelint.ts's risky-props rule)
        // so a check that DOES see this file produces a findable effect.
        "plugin.css": "@page { background-blend-mode: multiply; }\n",
      },
    }]);
    await addNpmPlugin(dir, name, { fetch: fixture.fetch });
    await mkdir(path.join(dir, "styles"), { recursive: true });
    await writeFile(path.join(dir, "styles", "book.css"), "body { color: black; }\n", "utf8");
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\n#262 fixture.\n", "utf8");
    await writeFile(
      path.join(dir, "manifest.yaml"),
      `title: validate-gap\nstyles:\n  - styles/book.css\nextensions:\n  - ${name}@1.0.0\n`,
      "utf8",
    );

    const { executeValidation } = await import("./validation-exec");
    const execution = await executeValidation({ input: dir });

    const cssFiles = execution.context.cssFiles ?? [];
    expect(cssFiles.some((f) => f.endsWith("plugin.css"))).toBe(true);
    const riskyOnPlugin = execution.report.results.some(
      (r) => r.checkId === "source.stylelint" && r.file?.endsWith("plugin.css"),
    );
    expect(riskyOnPlugin).toBe(true);
  });

  // The desktop host is Electron's Node, not Bun, and the shipped CLI is a
  // compiled Bun binary: the vendored tree has to load through BOTH runtimes'
  // own module resolution — an ESM dependency through its import condition,
  // a CommonJS one through require conditions, wildcard subpaths and JSON.
  test("loads vendored ESM and CommonJS dependency graphs under Node and compiled Bun", async () => {
    const runnerDir = path.join(TMP_ROOT, `runtime-runner-${counter++}`);
    await mkdir(runnerDir, { recursive: true });
    const runnerSource = path.join(runnerDir, "runner.ts");
    const loaderPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "markdown",
      "plugins.ts",
    );
    await writeFile(
      runnerSource,
      [
        `import { loadPlugin } from ${JSON.stringify(loaderPath)};`,
        "const [projectDir, name, version] = process.argv.slice(2);",
        "try {",
        "  const loaded = await loadPlugin({ use: `${name}@${version}`, name, version, options: {} }, projectDir);",
        "  const md = {};",
        "  loaded.plugin(md, {});",
        "  process.stdout.write(JSON.stringify(md));",
        "} catch (error) {",
        "  console.error(error instanceof Error ? error.stack ?? error.message : String(error));",
        "  process.exitCode = 1;",
        "}",
      ].join("\n"),
    );

    const nodeRunner = path.join(runnerDir, "runner.mjs");
    const compiledRunner = path.join(
      runnerDir,
      process.platform === "win32" ? "runner.exe" : "runner",
    );
    for (const args of [
      ["bun", "build", runnerSource, "--target=node", `--outfile=${nodeRunner}`],
      ["bun", "build", runnerSource, "--compile", `--outfile=${compiledRunner}`],
    ]) {
      const built = Bun.spawnSync({ cmd: args, stdout: "pipe", stderr: "pipe" });
      expect(built.exitCode, built.stderr.toString()).toBe(0);
    }
    const node = Bun.which("node");
    expect(node).not.toBeNull();

    interface RuntimeProject {
      dir: string;
      name: string;
      expected: string;
    }
    const projects: RuntimeProject[] = [];
    for (const format of ["module", "commonjs"] as const) {
      const dir = await projectDir();
      const name = `markdown-it-runtime-${format}-fixture`;
      const dependency = `gutterpress-runtime-${format}-dependency`;
      const shaped = `gutterpress-runtime-${format}-shaped.js`;
      const packages: GraphPackageFixture[] = format === "module"
        ? [
            {
              name,
              version: "1.0.0",
              // The entry sits in dist/ and imports a second dependency shaped
              // like highlight.js (commonjs-typed, `main` + an `exports` map
              // with a leading `types` condition) — exactly the shape the
              // compiled binary's own resolver fails on (0.11.10-alpha.4).
              manifest: {
                type: "module",
                exports: "./dist/index.js",
                dependencies: { [dependency]: "1.0.0", [shaped]: "1.0.0" },
              },
              files: {
                "dist/index.js": `import value from "${dependency}";\nimport shaped from "${shaped}";\nexport default function plugin(md) { md.result = value + "+" + shaped; }\n`,
              },
            },
            {
              name: shaped,
              version: "1.0.0",
              manifest: {
                type: "commonjs",
                main: "./lib/index.js",
                exports: { ".": { types: "./types/index.d.ts", require: "./lib/index.js", import: "./es/index.js" } },
              },
              files: {
                // highlight.js marks its ESM build with a nested package.json.
                "es/package.json": '{"type":"module"}',
                "es/index.js": "export default 'shaped-esm';\n",
                "lib/index.js": "module.exports = 'shaped-cjs';\n",
              },
            },
            {
              name: dependency,
              version: "1.0.0",
              manifest: {
                type: "module",
                exports: { ".": { import: "./index.js", require: "./wrong.cjs" } },
              },
              files: {
                "index.js": "export default 'esm-declared';\n",
                "wrong.cjs": "throw new Error('wrong require condition');\n",
              },
            },
          ]
        : [
            {
              name,
              version: "1.0.0",
              manifest: {
                type: "commonjs",
                main: "index.cjs",
                exports: "./index.cjs",
                dependencies: { [dependency]: "1.0.0" },
              },
              files: {
                "index.cjs": [
                  `const feature = require("${dependency}/features/value");`,
                  `const data = require("${dependency}/data");`,
                  "module.exports = function plugin(md) { md.result = `${feature}:${data.label}`; };",
                ].join("\n"),
              },
            },
            {
              name: dependency,
              version: "1.0.0",
              manifest: {
                type: "commonjs",
                exports: {
                  "./features/*": { import: "./wrong/*.mjs", require: "./features/*.cjs" },
                  "./data": "./data.json",
                },
              },
              files: {
                "features/value.cjs": "module.exports = 'cjs-declared';\n",
                "data.json": JSON.stringify({ label: "json" }),
              },
            },
          ];
      const fixture = registryGraphFixture(packages);
      await installFixtureOnly(dir, name, fixture.fetch);
      projects.push({
        dir,
        name,
        expected: format === "module" ? "esm-declared+shaped-esm" : "cjs-declared:json",
      });
    }

    for (const runtime of [
      { label: "Node", command: [node!, nodeRunner] },
      { label: "compiled Bun", command: [compiledRunner] },
    ]) {
      for (const project of projects) {
        const result = Bun.spawnSync({
          cmd: [...runtime.command, project.dir, project.name, "1.0.0"],
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(result.exitCode, `${runtime.label}: ${result.stderr.toString()}`).toBe(0);
        expect(JSON.parse(result.stdout.toString())).toMatchObject({ result: project.expected });
      }
    }
  }, 180_000);

  // npm treats the `os`/`cpu` selector `["any"]` as UNRESTRICTED. The installer
  // originally turned every selector into a positive allow-list, so a portable
  // package declaring `os: ["any"]` was rejected on every platform. These pin
  // npm-install-checks' `checkList` semantics, including the nuance that `any`
  // is only special when it is the SOLE entry.
  describe("npm os/cpu platform selectors", () => {
    const foreignOs = process.platform === "linux" ? "darwin" : "linux";
    const foreignCpu = process.arch === "x64" ? "arm64" : "x64";

    test('os: ["any"] installs on the current platform', async () => {
      const dir = await projectDir();
      const name = "markdown-it-any-os-fixture";
      const fixture = registryGraphFixture([
        { name, version: "1.0.0", manifest: { os: ["any"] } },
      ]);

      await addNpmPlugin(dir, name, { fetch: fixture.fetch });

      expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
    });

    test('cpu: ["any"] installs on the current architecture', async () => {
      const dir = await projectDir();
      const name = "markdown-it-any-cpu-fixture";
      const fixture = registryGraphFixture([
        { name, version: "1.0.0", manifest: { cpu: ["any"] } },
      ]);

      await addNpmPlugin(dir, name, { fetch: fixture.fetch });

      expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
    });

    // `any` is unrestricted ONLY as a single-element list. With a second entry
    // npm falls through to the negation rules, so this must still be rejected —
    // a plain "does the list contain any" check would wrongly accept it.
    test('os: ["any", "!<current>"] is still rejected on the excluded platform', async () => {
      const dir = await projectDir();
      const name = "markdown-it-any-negated-fixture";
      const fixture = registryGraphFixture([
        { name, version: "1.0.0", manifest: { os: ["any", `!${process.platform}`] } },
      ]);

      await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(
        /does not support/,
      );
    });

    test("a bare string selector is treated as a one-element list", async () => {
      const dir = await projectDir();
      const name = "markdown-it-string-os-fixture";
      const fixture = registryGraphFixture([
        { name, version: "1.0.0", manifest: { os: process.platform } },
      ]);

      await addNpmPlugin(dir, name, { fetch: fixture.fetch });

      expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
    });

    test("a positive selector for another platform is still rejected", async () => {
      const dir = await projectDir();
      const name = "markdown-it-foreign-os-fixture";
      const fixture = registryGraphFixture([
        { name, version: "1.0.0", manifest: { os: [foreignOs], cpu: [foreignCpu] } },
      ]);

      await expect(addNpmPlugin(dir, name, { fetch: fixture.fetch })).rejects.toThrow(
        /does not support/,
      );
    });

    test("a negation-only selector for another platform installs", async () => {
      const dir = await projectDir();
      const name = "markdown-it-negated-foreign-fixture";
      const fixture = registryGraphFixture([
        { name, version: "1.0.0", manifest: { os: [`!${foreignOs}`] } },
      ]);

      await addNpmPlugin(dir, name, { fetch: fixture.fetch });

      expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
    });
  });

});

describe("updates", () => {
  const name = "markdown-it-gutterpress-updating";
  const twoVersions = () =>
    registryGraphFixture([
      { name, version: "1.0.0" },
      { name, version: "1.1.0" }, // the group's last entry is the fixture's `latest`
    ]);

  test("re-pinning to a newer version removes the old version's vendored folder", async () => {
    const dir = await projectDir();
    const fixture = twoVersions();
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(true);

    await addNpmPlugin(dir, `${name}@1.1.0`, { fetch: fixture.fetch });

    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.1.0"))).toBe(true);
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(false);
    expect(await readdir(path.dirname(vendoredNpmPluginRoot(dir, name, "1.1.0")))).toEqual(["1.1.0"]);
    const listed = await listProjectPlugins(dir);
    expect(listed.map((e) => e.use)).toEqual([`${name}@1.1.0`]);
  });

  test("checkExtensionUpdates compares each pin with npm's latest, skipping what npm cannot answer for", async () => {
    const dir = await projectDir();
    const fixture = twoVersions();
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
    await addNpmPlugin(dir, "markdown-it-mark", { fetch: fixture.fetch }); // bundled: not npm's

    const checks = await checkExtensionUpdates(dir, { fetch: fixture.fetch });
    expect(checks).toEqual([
      { use: `${name}@1.0.0`, name, current: "1.0.0", latest: "1.1.0", outdated: true },
    ]);
  });

  test("checkExtensionUpdates names the package a lookup fails for", async () => {
    const dir = await projectDir();
    const fixture = twoVersions();
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
    const offline = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    await expect(checkExtensionUpdates(dir, { fetch: offline })).rejects.toThrow(
      `Looking up ${name} on npm failed (ECONNREFUSED).`,
    );
  });

  // Pre-releases: `latest` stays the stable dist-tag unless asked otherwise.
  const withPrerelease = () =>
    registryGraphFixture([
      { name, version: "1.0.0" },
      { name, version: "1.2.0-alpha.1" },
      { name, version: "1.2.0-alpha.2" },
      { name, version: "1.1.0" }, // last = the fixture's `latest` dist-tag
    ]);

  test("checkExtensionUpdates compares with the newest pre-release only when asked", async () => {
    const dir = await projectDir();
    const fixture = withPrerelease();
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });

    const stable = await checkExtensionUpdates(dir, { fetch: fixture.fetch });
    expect(stable[0]).toMatchObject({ latest: "1.1.0", outdated: true });
    const pre = await checkExtensionUpdates(dir, { fetch: fixture.fetch, includePrerelease: true });
    expect(pre[0]).toMatchObject({ current: "1.0.0", latest: "1.2.0-alpha.2", outdated: true });
  });

  test("listNpmVersions lists every published version, newest first", async () => {
    const fixture = withPrerelease();
    expect(await listNpmVersions(name, { fetch: fixture.fetch })).toEqual([
      "1.2.0-alpha.2",
      "1.2.0-alpha.1",
      "1.1.0",
      "1.0.0",
    ]);
  });

  test("listNpmVersions names the package a lookup fails for", async () => {
    const fixture = withPrerelease();
    await expect(listNpmVersions("markdown-it-not-published", { fetch: fixture.fetch })).rejects.toThrow(
      'npm package "markdown-it-not-published" was not found.',
    );
  });

  test("switching to a version that fails leaves the old pin and its vendored copy in place", async () => {
    const dir = await projectDir();
    const broken = "markdown-it-gutterpress-switching";
    const fixture = registryGraphFixture([
      { name: broken, version: "1.0.0" },
      { name: broken, version: "1.1.0", files: { "index.js": "throw new Error('boom');\n" } },
    ]);
    await addNpmPlugin(dir, `${broken}@1.0.0`, { fetch: fixture.fetch });
    const manifestBefore = await readFile(path.join(dir, "manifest.yaml"), "utf8");

    // Loads badly: downloaded, vendored, load-tested, rolled back.
    await expect(addNpmPlugin(dir, `${broken}@1.1.0`, { fetch: fixture.fetch })).rejects.toThrow(
      /not a loadable markdown-it plugin/,
    );
    // Not published at all: refused before anything is written.
    await expect(addNpmPlugin(dir, `${broken}@9.9.9`, { fetch: fixture.fetch })).rejects.toThrow();

    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toBe(manifestBefore);
    expect(existsSync(vendoredNpmPluginRoot(dir, broken, "1.0.0"))).toBe(true);
    expect(existsSync(vendoredNpmPluginRoot(dir, broken, "1.1.0"))).toBe(false);
    const [entry] = await listProjectPlugins(dir);
    expect(entry).toMatchObject({ use: `${broken}@1.0.0`, version: "1.0.0" });
    expect(entry!.warnings).toBeUndefined();
  });

  test("updateExtensions re-pins what is behind, keeps the entry's export, and reports the move", async () => {
    const dir = await projectDir();
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        files: { "index.js": "export function full(md) { md.__v = 1; }\n" },
      },
      {
        name,
        version: "1.1.0",
        files: { "index.js": "export function full(md) { md.__v = 2; }\n" },
      },
    ]);
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch, exportName: "full" });

    expect(await updateExtensions(dir, { fetch: fixture.fetch })).toEqual([
      { name, from: "1.0.0", to: "1.1.0" },
    ]);
    const [entry] = await listProjectPlugins(dir);
    expect(entry).toMatchObject({ use: `${name}@1.1.0`, version: "1.1.0", export: "full" });
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(false);
    // Idempotent: nothing left to move.
    expect(await updateExtensions(dir, { fetch: fixture.fetch })).toEqual([]);
    expect((await checkExtensionUpdates(dir, { fetch: fixture.fetch }))[0]!.outdated).toBe(false);
  });

  test("updateExtensions --only refuses a package the book does not pin", async () => {
    const dir = await projectDir();
    const fixture = twoVersions();
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
    await expect(updateExtensions(dir, { fetch: fixture.fetch, only: "something-else" })).rejects.toThrow(
      '"something-else" is not a pinned npm extension of this book.',
    );
  });
});

describe("restorePinnedExtensions", () => {
  const name = "markdown-it-gutterpress-restoring";
  const manifestOf = (...extensions: string[]) =>
    `title: Restored\nextensions:\n${extensions.map((e) => `  - ${e}`).join("\n")}\n`;
  const noNetwork = (() => {
    throw new Error("the network must not be touched");
  }) as unknown as typeof globalThis.fetch;

  /** A book that pinned `name@1.0.0` while 1.1.0 is already the registry's latest. */
  async function pinnedBook() {
    const fixture = registryGraphFixture([
      { name, version: "1.0.0" },
      { name, version: "1.1.0" },
    ]);
    const dir = await projectDir();
    await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
    fixture.calls.length = 0;
    const manifest = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    return { dir, fixture, manifest };
  }

  test("does nothing, and never touches the network, when every copy is present", async () => {
    const { dir, manifest } = await pinnedBook();
    const result = await restorePinnedExtensions(dir, { fetch: noNetwork });
    expect(result).toMatchObject({ installed: [], failed: [], warnings: [] });
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toBe(manifest);
  });

  test("a missing copy is downloaded at exactly the pinned version, and the manifest is untouched", async () => {
    const { dir, fixture, manifest } = await pinnedBook();
    await rm(path.join(dir, "plugins"), { recursive: true });
    const events: RestoreProgress[] = [];

    const result = await restorePinnedExtensions(dir, {
      fetch: fixture.fetch,
      onProgress: (event) => events.push(event),
    });

    expect(result).toMatchObject({ manifestFile: "manifest.yaml", installed: [`${name}@1.0.0`], failed: [] });
    expect(events).toEqual([
      { type: "start", specs: [`${name}@1.0.0`] },
      { type: "package", spec: `${name}@1.0.0`, index: 0, total: 1, state: "downloading" },
      { type: "package", spec: `${name}@1.0.0`, index: 0, total: 1, state: "done" },
      { type: "end", installed: [`${name}@1.0.0`], failed: [] },
    ]);
    // The pinned version, not npm's `latest` (1.1.0).
    expect(fixture.calls).toEqual([
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
    ]);
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.1.0"))).toBe(false);
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toBe(manifest);
    expect((await validateProjectPlugins(dir))[0]?.ok).toBe(true);
    expect(await loadedMarker(dir, name, "1.0.0", "__fixtureLoaded")).toBe(true);
    // And it is a one-time cost: the next call finds everything.
    expect(await restorePinnedExtensions(dir, { fetch: noNetwork })).toMatchObject({ installed: [], failed: [] });
  });

  test("an incomplete copy is downloaded again", async () => {
    const { dir, fixture } = await pinnedBook();
    await rm(path.join(vendoredNpmPluginPackageDir(vendoredNpmPluginRoot(dir, name, "1.0.0"), name), "package.json"));

    const result = await restorePinnedExtensions(dir, { fetch: fixture.fetch });

    expect(result.installed).toEqual([`${name}@1.0.0`]);
    expect((await validateProjectPlugins(dir))[0]?.ok).toBe(true);
  });

  test("honours the entry's named export when it load-tests the download", async () => {
    const exportName = "markdown-it-gutterpress-restoring-export";
    const fixture = registryGraphFixture([
      { name: exportName, version: "1.0.0", files: { "index.js": "export function full(md) { md.__v = 1; }\n" } },
    ]);
    const dir = await projectDir();
    await addNpmPlugin(dir, `${exportName}@1.0.0`, { fetch: fixture.fetch, exportName: "full" });
    await rm(path.join(dir, "plugins"), { recursive: true });

    expect(await restorePinnedExtensions(dir, { fetch: fixture.fetch })).toMatchObject({
      installed: [`${exportName}@1.0.0`],
      failed: [],
    });
  });

  test("a registry failure is reported with the extension and why, leaves no partial copy, and changes nothing", async () => {
    const { dir, manifest } = await pinnedBook();
    await rm(path.join(dir, "plugins"), { recursive: true });
    const offline = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;

    const result = await restorePinnedExtensions(dir, { fetch: offline });

    expect(result.installed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.use).toBe(`${name}@1.0.0`);
    expect(result.failed[0]!.message).toContain("ECONNREFUSED");
    const sentence = restoreFailureMessage(result.failed[0]!, "manifest.yaml");
    expect(sentence).toContain(`Could not download ${name}@1.0.0 (pinned in manifest.yaml)`);
    expect(sentence).toContain("ECONNREFUSED");
    expect(sentence).toContain(`run the command again`);
    expect(sentence).toContain(`gutterpress ext add ${name}@1.0.0`);
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(false);
    // No empty plugins/npm/<name>/ folder either: a failed first open leaves the book as it was.
    expect(existsSync(path.join(dir, "plugins"))).toBe(false);
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toBe(manifest);
  });

  test("an integrity mismatch is a failure, never an install", async () => {
    const { dir } = await pinnedBook();
    await rm(path.join(dir, "plugins"), { recursive: true });
    const bad = registryFixture(name, "1.0.0", packageEntries(name, "1.0.0"), { badIntegrity: true });

    const result = await restorePinnedExtensions(dir, { fetch: bad.fetch });

    expect(result.installed).toEqual([]);
    expect(result.failed[0]!.message).toMatch(/integrity check/i);
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(false);
  });

  test("one failure does not stop the other packages from being restored", async () => {
    const other = "markdown-it-gutterpress-restoring-other";
    const fixture = registryGraphFixture([{ name: other, version: "2.0.0" }]); // `name` is unknown to this registry
    const dir = await projectDir();
    await writeFile(path.join(dir, "manifest.yaml"), manifestOf(`${name}@1.0.0`, `${other}@2.0.0`), "utf8");

    const result = await restorePinnedExtensions(dir, { fetch: fixture.fetch });

    expect(result.installed).toEqual([`${other}@2.0.0`]);
    expect(result.failed.map((f) => f.use)).toEqual([`${name}@1.0.0`]);
  });

  test("local paths, unpinned names, version ranges, bundled names and disabled entries are never fetched", async () => {
    const dir = await projectDir();
    await writeFile(
      path.join(dir, "manifest.yaml"),
      "title: Ignored\nextensions:\n" +
        "  - ./plugins/local.js\n" +
        "  - some-unpinned-package\n" +
        "  - some-ranged-package@^1.0.0\n" +
        "  - some-tagged-package@latest\n" +
        "  - markdown-it-mark\n" +
        "  - use: disabled-package@1.0.0\n" +
        "    enabled: false\n" +
        "  - not a valid specifier at all\n",
      "utf8",
    );
    expect(await restorePinnedExtensions(dir, { fetch: noNetwork })).toMatchObject({
      installed: [],
      failed: [],
      warnings: [],
    });
    expect(existsSync(path.join(dir, "plugins"))).toBe(false);
  });

  test("no manifest, no extensions list, or an unreadable manifest restores nothing", async () => {
    const dir = await projectDir();
    expect(await restorePinnedExtensions(dir, { fetch: noNetwork })).toMatchObject({ manifestFile: null, installed: [] });
    await writeFile(path.join(dir, "manifest.yaml"), "title: No extensions\n", "utf8");
    expect(await restorePinnedExtensions(dir, { fetch: noNetwork })).toMatchObject({ installed: [], failed: [] });
    await writeFile(path.join(dir, "manifest.yaml"), "title: [unclosed\n", "utf8");
    expect(await restorePinnedExtensions(dir, { fetch: noNetwork })).toMatchObject({ manifestFile: null, installed: [] });
  });

  test("an explicit manifest file restores into that file's folder", async () => {
    const { dir, fixture } = await pinnedBook();
    await rename(path.join(dir, "manifest.yaml"), path.join(dir, "book.yaml"));
    await rm(path.join(dir, "plugins"), { recursive: true });

    const result = await restorePinnedExtensions(dir, { fetch: fixture.fetch, manifestPath: path.join(dir, "book.yaml") });

    expect(result).toMatchObject({ manifestFile: "book.yaml", installed: [`${name}@1.0.0`] });
    expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(true);
  });

  test("concurrent restores of one book share a single download", async () => {
    const { dir, fixture } = await pinnedBook();
    await rm(path.join(dir, "plugins"), { recursive: true });

    const [a, b] = await Promise.all([
      restorePinnedExtensions(dir, { fetch: fixture.fetch }),
      restorePinnedExtensions(dir, { fetch: fixture.fetch }),
    ]);

    expect(a.installed).toEqual([`${name}@1.0.0`]);
    expect(b).toBe(a);
    expect(fixture.calls.filter((url) => url.endsWith(".tgz"))).toHaveLength(1);
  });

  test("restoring keeps the downloaded copy out of git, like any install", async () => {
    const { dir, fixture } = await pinnedBook();
    await rm(path.join(dir, "plugins"), { recursive: true });
    await rm(path.join(dir, ".gitignore"));

    await restorePinnedExtensions(dir, { fetch: fixture.fetch });

    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toContain("plugins/npm/");
  });

  test("restoreForCommand prints one line per downloaded package; nothing when everything is present or when quiet", async () => {
    const { dir, fixture } = await pinnedBook();
    await rm(path.join(dir, "plugins"), { recursive: true });
    const lines: string[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fixture.fetch as never);
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    try {
      await restoreForCommand(dir, { failFast: true });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`Downloaded ${name}@1.0.0 (pinned in manifest.yaml)`);
      await restoreForCommand(dir, { failFast: true });
      expect(lines).toHaveLength(1);

      await rm(path.join(dir, "plugins"), { recursive: true });
      await restoreForCommand(dir, { failFast: true, quiet: true });
      expect(lines).toHaveLength(1);
      expect(existsSync(vendoredNpmPluginRoot(dir, name, "1.0.0"))).toBe(true);
    } finally {
      fetchSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  describe("one pruning rule: a restored package keeps only its pinned version", () => {
    const versions = () =>
      registryGraphFixture([
        { name, version: "1.0.0" },
        { name, version: "1.1.0" },
      ]);
    const folders = async (dir: string, pkg = name) =>
      (await readdir(path.dirname(vendoredNpmPluginRoot(dir, pkg, "0.0.0")))).sort();

    test("pulling a new pin downloads it and prunes the old version of that package", async () => {
      const fixture = versions();
      const dir = await projectDir();
      await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
      // A pull moved the pin; the downloaded copy of 1.1.0 is not there yet.
      await writeFile(path.join(dir, "manifest.yaml"), manifestOf(`${name}@1.1.0`), "utf8");

      const result = await restorePinnedExtensions(dir, { fetch: fixture.fetch });

      expect(result.installed).toEqual([`${name}@1.1.0`]);
      expect(await folders(dir)).toEqual(["1.1.0"]);
      expect(result.warnings).toEqual([]);
    });

    test("never touches another package, a staging folder, or a folder that is not an exact version", async () => {
      const other = "markdown-it-gutterpress-restoring-neighbour";
      const fixture = registryGraphFixture([{ name, version: "1.0.0" }, { name: other, version: "3.0.0" }]);
      const dir = await projectDir();
      await addNpmPlugin(dir, `${other}@3.0.0`, { fetch: fixture.fetch });
      await mkdir(path.join(dir, "plugins", "npm", name, "9.9.9"), { recursive: true });
      await mkdir(path.join(dir, "plugins", "npm", name, "notes"), { recursive: true });
      await writeFile(path.join(dir, "manifest.yaml"), manifestOf(`${other}@3.0.0`, `${name}@1.0.0`), "utf8");

      await restorePinnedExtensions(dir, { fetch: fixture.fetch });

      expect(await folders(dir)).toEqual(["1.0.0", "notes"]);
      expect(await folders(dir, other)).toEqual(["3.0.0"]);
    });

    test("never prunes a version another enabled manifest entry still pins", async () => {
      const fixture = versions();
      const dir = await projectDir();
      await addNpmPlugin(dir, `${name}@1.1.0`, { fetch: fixture.fetch });
      // Two enabled entries for one package (hand-written); 1.0.0's copy is missing.
      await writeFile(path.join(dir, "manifest.yaml"), manifestOf(`${name}@1.0.0`, `${name}@1.1.0`), "utf8");

      const result = await restorePinnedExtensions(dir, { fetch: fixture.fetch });

      expect(result.installed).toEqual([`${name}@1.0.0`]);
      expect(await folders(dir)).toEqual(["1.0.0", "1.1.0"]);
    });

    test("a disabled entry's pin does not keep its version", async () => {
      const fixture = versions();
      const dir = await projectDir();
      await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
      await writeFile(
        path.join(dir, "manifest.yaml"),
        `title: T\nextensions:\n  - ${name}@1.1.0\n  - use: ${name}@1.0.0\n    enabled: false\n`,
        "utf8",
      );

      await restorePinnedExtensions(dir, { fetch: fixture.fetch });

      expect(await folders(dir)).toEqual(["1.1.0"]);
    });

    test("a failed download prunes nothing: the old copy stays until the new one is in", async () => {
      const fixture = versions();
      const dir = await projectDir();
      await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
      await writeFile(path.join(dir, "manifest.yaml"), manifestOf(`${name}@1.1.0`), "utf8");
      const offline = (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof globalThis.fetch;

      const result = await restorePinnedExtensions(dir, { fetch: offline });

      expect(result.failed).toHaveLength(1);
      expect(await folders(dir)).toEqual(["1.0.0"]);
    });

    test("`ext add` keeps the same rule: it prunes the old version but not another enabled pin", async () => {
      const fixture = versions();
      const dir = await projectDir();
      await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: fixture.fetch });
      await addNpmPlugin(dir, `${name}@1.1.0`, { fetch: fixture.fetch });
      expect(await folders(dir)).toEqual(["1.1.0"]);
    });
  });

  test("two restores of one copy that race through different spellings of the path download it once", async () => {
    const { dir, fixture } = await pinnedBook();
    await rm(path.join(dir, "plugins"), { recursive: true });

    // Not the in-flight share (same key): the mutation lock alone must stop the second download.
    await Promise.all([
      restoreNpmExtension(dir, name, "1.0.0", undefined, { fetch: fixture.fetch }),
      restoreNpmExtension(path.join(dir, "."), name, "1.0.0", undefined, { fetch: fixture.fetch }),
    ]);

    expect(fixture.calls.filter((url) => url.endsWith(".tgz"))).toHaveLength(1);
  });
});
