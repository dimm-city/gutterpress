import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, strToU8 } from "fflate";

import { loadManifest, resolveConfig } from "./manifest";
import {
  addNpmPluginWithOptions as addNpmPlugin,
  listProjectPlugins,
  validateProjectPlugins,
} from "./plugin-manager";
import {
  finalizeNpmPluginInstall,
  installNpmPlugin,
} from "./npm-plugin-installer";
import { __setVendorSnapshotHookForTests, loadPlugin } from "./markdown/plugins";
import {
  computeVendorTreeDigest,
  vendoredNpmPluginPackageDir,
  vendoredNpmPluginRoot,
  VENDOR_RECEIPT_FILE,
  type VendorReceipt,
} from "./plugin-vendor";

const TMP_ROOT = path.join(process.cwd(), ".tmp", `npm-plugin-installer-${Date.now()}`);
const TMP_AMBIENT_PACKAGES = new Set<string>();
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
  options: { badIntegrity?: boolean } = {},
): { fetch: typeof globalThis.fetch; calls: string[]; archive: Uint8Array } {
  const archive = gzipSync(tar(entries), { mtime: 0 });
  const tarball = `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
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
    if (url === `https://registry.npmjs.org/${encodeURIComponent(name)}`) {
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

async function receipt(projectDir: string, name: string, version: string): Promise<VendorReceipt> {
  return JSON.parse(
    await readFile(path.join(vendoredNpmPluginRoot(projectDir, name, version), VENDOR_RECEIPT_FILE), "utf8"),
  ) as VendorReceipt;
}

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
    { name, version, priority: 100, options: {} },
    dir,
  );
  const md: Record<string, unknown> = {};
  loaded.plugin(md as never, {});
  return md[key];
}

beforeEach(async () => {
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await Promise.all(
    [...TMP_AMBIENT_PACKAGES].map((packageDir) => rm(packageDir, { recursive: true, force: true })),
  );
  TMP_AMBIENT_PACKAGES.clear();
});

describe("npm plugin installation", () => {
  test("resolves latest, verifies and vendors the tarball, pins the manifest, and loads without running scripts", async () => {
    const dir = await projectDir();
    const name = "markdown-it-print-md-fixture";
    const version = "1.2.3";
    const fixture = registryFixture(name, version, packageEntries(name, version));

    const result = await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(result).toEqual({ ref: name, kind: "npm", enabled: true, version });
    expect(fixture.calls).toEqual([
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    ]);
    const installRoot = vendoredNpmPluginRoot(dir, name, version);
    const packageDir = vendoredNpmPluginPackageDir(installRoot, name);
    expect(existsSync(path.join(packageDir, "index.js"))).toBe(true);
    expect(existsSync(path.join(packageDir, "INSTALL_SCRIPT_RAN"))).toBe(false);
    expect(existsSync(path.join(dir, "INSTALL_SCRIPT_RAN"))).toBe(false);

    const listed = await listProjectPlugins(dir);
    expect(listed).toEqual([{ ref: name, kind: "npm", enabled: true, version }]);
    const resolved = resolveConfig({}, await loadManifest(dir));
    expect(resolved.plugins[0]?.version).toBe(version);
    expect((await validateProjectPlugins(dir))[0]?.ok).toBe(true);
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toContain(`version: ${version}`);
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
    const npmEntries = await readdir(path.join(dir, "plugins", "npm"));
    expect(npmEntries.some((entry) => entry.startsWith(".install-"))).toBe(false);
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

    expect(result).toMatchObject({ ref: name, version: "1.0.0", export: "full" });
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toContain("export: full");
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("vendors and loads a complete transitive dependency tree", async () => {
    const dir = await projectDir();
    const name = "markdown-it-transitive-fixture";
    const dependency = "print-md-transitive-dependency";
    const fixture = registryGraphFixture([
      {
        name,
        version: "1.0.0",
        manifest: { dependencies: { [dependency]: "^2.0.0" } },
        files: {
          "index.js": `import { answer } from "${dependency}";\nif (answer !== 42) throw new Error("dependency did not load");\nexport default function plugin() {}\n`,
        },
      },
      {
        name: dependency,
        version: "2.1.0",
        files: { "index.js": "export const answer = 42;\n" },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    const installed = await receipt(dir, name, "1.0.0");
    expect(installed.packages.map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual([
      `${name}@1.0.0`,
      `${dependency}@2.1.0`,
    ]);
    expect(installed.packages[0]?.dependencies[dependency]).toBe(
      `node_modules/${name}/node_modules/${dependency}`,
    );
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("loads CommonJS dependencies through the verified graph resolver", async () => {
    const dir = await projectDir();
    const name = "markdown-it-commonjs-graph-fixture";
    const dependency = "print-md-commonjs-dependency";
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
          "index.cjs": `const value = require("${dependency}");\nif (value !== 42) throw new Error("dependency did not load");\nmodule.exports = function plugin() {};\n`,
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

    const installed = await receipt(dir, name, "1.0.0");
    expect(installed.root.format).toBe("commonjs");
    expect(installed.packages[1]?.requireEntry).toEndWith("/index.cjs");
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("honors require conditions, wildcard subpaths, and JSON export targets", async () => {
    const dir = await projectDir();
    const name = "markdown-it-commonjs-exports-fixture";
    const dependency = "print-md-commonjs-exports-dependency";
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
            `if (feature !== 42 || data.label !== "receipt-data") throw new Error("exports mismatch");`,
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
          "data.json": JSON.stringify({ label: "receipt-data" }),
          "wrong.mjs": "throw new Error('import condition selected for require');\n",
        },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("never substitutes undeclared project packages for vendored ESM or CommonJS imports", async () => {
    for (const format of ["module", "commonjs"] as const) {
      const dir = await projectDir();
      const name = `markdown-it-ambient-${format}-fixture`;
      const ambient = `print-md-ambient-${format}-dependency`;
      const pluginManifest = format === "module"
        ? { type: "module", exports: "./index.js" }
        : { type: "commonjs", main: "index.cjs", exports: "./index.cjs" };
      const pluginFiles: Record<string, string> = format === "module"
        ? {
            "index.js": `import value from "${ambient}";\nexport default function plugin(md) { md.ambient = value; }\n`,
          }
        : {
            "index.cjs": `const value = require("${ambient}");\nmodule.exports = function plugin(md) { md.ambient = value; };\n`,
          };
      const fixture = registryGraphFixture([{
        name,
        version: "1.0.0",
        manifest: pluginManifest,
        files: pluginFiles,
      }]);
      await installFixtureOnly(dir, name, fixture.fetch);

      const ambientDir = path.join(dir, "node_modules", ambient);
      await mkdir(ambientDir, { recursive: true });
      await writeFile(
        path.join(ambientDir, "package.json"),
        JSON.stringify({
          name: ambient,
          version: "9.9.9",
          type: format,
          main: format === "module" ? "index.js" : "index.cjs",
          exports: format === "module" ? "./index.js" : "./index.cjs",
        }),
      );
      await writeFile(
        path.join(ambientDir, format === "module" ? "index.js" : "index.cjs"),
        format === "module" ? "export default 'ambient';\n" : "module.exports = 'ambient';\n",
      );

      await expect(
        loadPlugin({ name, version: "1.0.0", priority: 100, options: {} }, dir),
      ).rejects.toThrow(/ambient|undeclared|Cannot find package/i);
    }
  });

  test("only validates imports reachable from the plugin entry", async () => {
    const dir = await projectDir();
    const name = "markdown-it-unreachable-test-fixture";
    const fixture = registryGraphFixture([{
      name,
      version: "1.0.0",
      files: {
        "index.js": "export default function plugin(md) { md.loaded = true; }\n",
        "test.js": "import 'chai';\n",
      },
    }]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect(await loadedMarker(dir, name, "1.0.0", "loaded")).toBe(true);
  });

  test("rewrites literal dynamic imports and rejects nonliteral import or require expressions", async () => {
    const dir = await projectDir();
    const name = "markdown-it-dynamic-import-fixture";
    const dependency = "print-md-dynamic-import-dependency";
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
        files: { "index.js": "export const value = 'receipt-dynamic';\n" },
      },
    ]);
    await addNpmPlugin(dir, name, { fetch: fixture.fetch });
    expect(await loadedMarker(dir, name, "1.0.0", "dynamic")).toBe("receipt-dynamic");

    const rejectedDir = await projectDir();
    const rejectedName = "markdown-it-nonliteral-import-fixture";
    const rejectedFixture = registryGraphFixture([{
      name: rejectedName,
      version: "1.0.0",
      files: {
        "index.js": "const target = './local.js';\nawait import(target);\nexport default function plugin() {}\n",
        "local.js": "export const value = true;\n",
      },
    }]);
    await expect(addNpmPlugin(rejectedDir, rejectedName, {
      fetch: rejectedFixture.fetch,
    })).rejects.toThrow(/dynamic import.*string literal/i);

    const cjsDir = await projectDir();
    const cjsName = "markdown-it-nonliteral-require-fixture";
    const cjsFixture = registryGraphFixture([{
      name: cjsName,
      version: "1.0.0",
      manifest: { type: "commonjs", main: "index.cjs", exports: "./index.cjs" },
      files: {
        "index.cjs": "const target = './local.cjs';\nrequire(target);\nmodule.exports = function plugin() {};\n",
        "local.cjs": "module.exports = true;\n",
      },
    }]);
    await expect(addNpmPlugin(cjsDir, cjsName, {
      fetch: cjsFixture.fetch,
    })).rejects.toThrow(/dynamic require.*string literal/i);
  });

  test("keeps conflicting transitive versions in their parents' nested node_modules", async () => {
    const dir = await projectDir();
    const name = "markdown-it-conflict-fixture";
    const left = "print-md-left-fixture";
    const right = "print-md-right-fixture";
    const shared = "print-md-shared-fixture";
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

    const paths = (await receipt(dir, name, "1.0.0")).packages
      .filter((pkg) => pkg.name === shared)
      .map((pkg) => `${pkg.path}:${pkg.version}`);
    expect(paths).toEqual([
      `node_modules/${name}/node_modules/${left}/node_modules/${shared}:1.4.0`,
      `node_modules/${name}/node_modules/${right}/node_modules/${shared}:2.3.0`,
    ]);
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("reconciles receipt edges with dependency, optional, peer, name, and semver declarations", async () => {
    async function expectCorruptReceipt(
      name: string,
      packages: GraphPackageFixture[],
      mutate: (installed: VendorReceipt) => void,
      expected: RegExp,
    ): Promise<void> {
      const dir = await projectDir();
      const fixture = registryGraphFixture(packages);
      await addNpmPlugin(dir, name, { fetch: fixture.fetch });
      const installed = await receipt(dir, name, "1.0.0");
      mutate(installed);
      await writeFile(
        path.join(vendoredNpmPluginRoot(dir, name, "1.0.0"), VENDOR_RECEIPT_FILE),
        `${JSON.stringify(installed, null, 2)}\n`,
      );
      const validation = await validateProjectPlugins(dir);
      expect(validation[0]).toMatchObject({ ok: false });
      expect(validation[0]?.error).toMatch(expected);
    }

    const missingName = "markdown-it-missing-edge-fixture";
    const required = "print-md-required-edge";
    await expectCorruptReceipt(
      missingName,
      [
        { name: missingName, version: "1.0.0", manifest: { dependencies: { [required]: "^1.0.0" } } },
        { name: required, version: "1.2.0" },
      ],
      (installed) => {
        delete installed.packages.find((pkg) => pkg.name === missingName)!.dependencies[required];
      },
      /missing required dependency edge/i,
    );

    const undeclaredName = "markdown-it-undeclared-edge-fixture";
    const parent = "print-md-edge-parent";
    const transitive = "print-md-edge-transitive";
    await expectCorruptReceipt(
      undeclaredName,
      [
        { name: undeclaredName, version: "1.0.0", manifest: { dependencies: { [parent]: "1.0.0" } } },
        { name: parent, version: "1.0.0", manifest: { dependencies: { [transitive]: "1.0.0" } } },
        { name: transitive, version: "1.0.0" },
      ],
      (installed) => {
        const root = installed.packages.find((pkg) => pkg.name === undeclaredName)!;
        root.dependencies[transitive] = installed.packages.find((pkg) => pkg.name === transitive)!.path;
      },
      /undeclared dependency edge/i,
    );

    const wrongName = "markdown-it-wrong-name-edge-fixture";
    const firstDependency = "print-md-first-edge";
    const secondDependency = "print-md-second-edge";
    await expectCorruptReceipt(
      wrongName,
      [
        {
          name: wrongName,
          version: "1.0.0",
          manifest: { dependencies: { [firstDependency]: "1.0.0", [secondDependency]: "1.0.0" } },
        },
        { name: firstDependency, version: "1.0.0" },
        { name: secondDependency, version: "1.0.0" },
      ],
      (installed) => {
        const root = installed.packages.find((pkg) => pkg.name === wrongName)!;
        root.dependencies[firstDependency] = installed.packages.find(
          (pkg) => pkg.name === secondDependency,
        )!.path;
      },
      /broken dependency edge/i,
    );

    const incompatibleName = "markdown-it-incompatible-edge-fixture";
    const left = "print-md-range-left";
    const right = "print-md-range-right";
    const shared = "print-md-range-shared";
    await expectCorruptReceipt(
      incompatibleName,
      [
        {
          name: incompatibleName,
          version: "1.0.0",
          manifest: { dependencies: { [left]: "1.0.0", [right]: "1.0.0" } },
        },
        { name: left, version: "1.0.0", manifest: { dependencies: { [shared]: "^1.0.0" } } },
        { name: right, version: "1.0.0", manifest: { dependencies: { [shared]: "^2.0.0" } } },
        { name: shared, version: "1.5.0" },
        { name: shared, version: "2.5.0" },
      ],
      (installed) => {
        const leftPackage = installed.packages.find((pkg) => pkg.name === left)!;
        leftPackage.dependencies[shared] = installed.packages.find(
          (pkg) => pkg.name === shared && pkg.version === "2.5.0",
        )!.path;
      },
      /does not satisfy/i,
    );

    const optionalName = "markdown-it-optional-skip-edge-fixture";
    const optional = "print-md-unavailable-edge-optional";
    await expectCorruptReceipt(
      optionalName,
      [{
        name: optionalName,
        version: "1.0.0",
        manifest: { optionalDependencies: { [optional]: "1.0.0" } },
      }],
      (installed) => {
        installed.skipped = [];
      },
      /neither installed nor skipped/i,
    );

    const peerName = "markdown-it-required-peer-edge-fixture";
    const peer = "print-md-required-edge-peer";
    await expectCorruptReceipt(
      peerName,
      [
        { name: peerName, version: "1.0.0", manifest: { peerDependencies: { [peer]: "^3.0.0" } } },
        { name: peer, version: "3.1.0" },
      ],
      (installed) => {
        delete installed.packages.find((pkg) => pkg.name === peerName)!.dependencies[peer];
      },
      /missing required dependency edge/i,
    );

    const disconnectedName = "markdown-it-disconnected-edge-fixture";
    const disconnected = "print-md-disconnected-edge";
    const disconnectedDir = await projectDir();
    const disconnectedFixture = registryGraphFixture([
      {
        name: disconnectedName,
        version: "1.0.0",
        manifest: { dependencies: { [disconnected]: "1.0.0" } },
      },
      {
        name: disconnected,
        version: "1.0.0",
        manifest: { dependencies: { [disconnected]: "1.0.0" } },
      },
    ]);
    await addNpmPlugin(disconnectedDir, disconnectedName, { fetch: disconnectedFixture.fetch });
    const installRoot = vendoredNpmPluginRoot(disconnectedDir, disconnectedName, "1.0.0");
    const rootManifestPath = path.join(
      vendoredNpmPluginPackageDir(installRoot, disconnectedName),
      "package.json",
    );
    const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8")) as Record<string, unknown>;
    delete rootManifest.dependencies;
    await writeFile(rootManifestPath, JSON.stringify(rootManifest));
    const disconnectedReceipt = await receipt(disconnectedDir, disconnectedName, "1.0.0");
    disconnectedReceipt.packages.find((pkg) => pkg.name === disconnectedName)!.dependencies = {};
    disconnectedReceipt.tree = {
      algorithm: "sha256",
      ...await computeVendorTreeDigest(installRoot),
    };
    await writeFile(
      path.join(installRoot, VENDOR_RECEIPT_FILE),
      `${JSON.stringify(disconnectedReceipt, null, 2)}\n`,
    );

    const disconnectedValidation = await validateProjectPlugins(disconnectedDir);
    expect(disconnectedValidation[0]).toMatchObject({ ok: false });
    expect(disconnectedValidation[0]?.error).toMatch(/not reachable from its root/i);
  });

  test("records cycles without downloading a duplicate ancestor", async () => {
    const dir = await projectDir();
    const name = "markdown-it-cycle-fixture";
    const dependency = "print-md-cycle-dependency";
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
        files: { "index.js": "export const loaded = true;\n" },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    const installed = await receipt(dir, name, "1.0.0");
    expect(installed.packages).toHaveLength(2);
    expect(installed.packages[1]?.dependencies[name]).toBe(`node_modules/${name}`);
    expect(fixture.calls.filter((url) => url.endsWith(`${name}-1.0.0.tgz`))).toHaveLength(1);
  });

  test("selects the import condition for an ESM-only root entry", async () => {
    const dir = await projectDir();
    const name = "markdown-it-esm-entry-fixture";
    const fixture = registryGraphFixture([{
      name,
      version: "1.0.0",
      manifest: {
        exports: { ".": { import: "./esm.mjs", require: "./wrong.cjs" } },
      },
      files: {
        "esm.mjs": "export default function plugin() {}\n",
        "wrong.cjs": "throw new Error('require entry must not run');\n",
      },
    }]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    expect((await receipt(dir, name, "1.0.0")).root.entry).toBe(
      `node_modules/${name}/esm.mjs`,
    );
  });

  test("installs required peers and records unavailable optional dependencies and optional peers", async () => {
    const dir = await projectDir();
    const name = "markdown-it-peer-fixture";
    const requiredPeer = "print-md-required-peer";
    const optional = "print-md-missing-optional";
    const optionalParent = "print-md-optional-parent";
    const optionalPeer = "print-md-optional-peer";
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
        manifest: { dependencies: { "print-md-missing-child": "1.0.0" } },
      },
    ]);

    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    const installed = await receipt(dir, name, "1.0.0");
    expect(installed.packages.some((pkg) => pkg.name === requiredPeer)).toBe(true);
    expect(installed.skipped.map((item) => [item.name, item.kind])).toEqual([
      [optional, "optional"],
      [optionalParent, "optional"],
      [optionalPeer, "optional-peer"],
    ]);
    expect(installed.packages.some((pkg) => pkg.name === optionalParent)).toBe(false);
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

    const installed = await receipt(dir, name, "1.0.0");
    expect(installed.packages.some((pkg) => pkg.name === typesName)).toBe(true);
    expect((await validateProjectPlugins(dir))[0]).toMatchObject({ ok: true });
  });

  test("fails a missing required dependency but skips an unsupported optional selector", async () => {
    const requiredDir = await projectDir();
    const requiredName = "markdown-it-missing-required-fixture";
    const requiredFixture = registryGraphFixture([{
      name: requiredName,
      version: "1.0.0",
      manifest: { dependencies: { "print-md-not-published": "^1.0.0" } },
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
      manifest: { optionalDependencies: { "print-md-local-only": "file:../local" } },
    }]);
    await addNpmPlugin(optionalDir, optionalName, { fetch: optionalFixture.fetch });
    expect((await receipt(optionalDir, optionalName, "1.0.0")).skipped[0]).toMatchObject({
      name: "print-md-local-only",
      kind: "optional",
    });
  });

  test("records optional network failures and timeouts without hiding required failures", async () => {
    const dir = await projectDir();
    const name = "markdown-it-optional-network-fixture";
    const offline = "print-md-optional-offline";
    const timedOut = "print-md-optional-timeout";
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

    const skipped = (await receipt(dir, name, "1.0.0")).skipped;
    expect(skipped.map((item) => item.name)).toEqual([offline, timedOut]);
    expect(skipped[0]?.reason).toMatch(/socket unavailable|failed/i);
    expect(skipped[1]?.reason).toMatch(/timed out/i);

    const requiredDir = await projectDir();
    const requiredName = "markdown-it-required-network-fixture";
    const required = "print-md-required-offline";
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
    const dependency = "print-md-unsafe-optional";
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
    const integrityDependency = "print-md-integrity-optional";
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
    const limitedDependency = "print-md-oversized-optional";
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
    const dependency = "print-md-package-limit-dependency";
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
    expect((await receipt(legacyDir, legacyName, "1.0.0")).packages[0]).toMatchObject({
      legacySha1: true,
      integrity: expect.stringMatching(/^sha1-/),
    });
  });

  test("a corrupt receipt-backed tree fails closed instead of using project node_modules", async () => {
    const dir = await projectDir();
    const name = "markdown-it-corrupt-tree-fixture";
    const fixture = registryGraphFixture([{ name, version: "1.0.0" }]);
    await addNpmPlugin(dir, name, { fetch: fixture.fetch });
    const installRoot = vendoredNpmPluginRoot(dir, name, "1.0.0");
    await writeFile(path.join(vendoredNpmPluginPackageDir(installRoot, name), "index.js"), "corrupt\n");

    const fallback = path.join(dir, "node_modules", name);
    await mkdir(fallback, { recursive: true });
    await writeFile(path.join(fallback, "package.json"), JSON.stringify({ name, version: "9.9.9", type: "module" }));
    await writeFile(path.join(fallback, "index.js"), "export default function plugin() {}\n");

    const validation = await validateProjectPlugins(dir);
    expect(validation[0]).toMatchObject({ ok: false });
    expect(validation[0]?.error).toMatch(/tree hash|failed verification/i);
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

  test("same-version reinstalls load changed ESM and CommonJS bytes in the same process", async () => {
    for (const format of ["module", "commonjs"] as const) {
      const dir = await projectDir();
      const name = `markdown-it-fresh-${format}-cache-fixture`;
      const manifest = format === "module"
        ? { type: "module", exports: "./index.js" }
        : { type: "commonjs", main: "index.cjs", exports: "./index.cjs" };
      const file = format === "module" ? "index.js" : "index.cjs";
      const source = (revision: number) => format === "module"
        ? `export default function plugin(md) { md.revision = ${revision}; }\n`
        : `module.exports = function plugin(md) { md.revision = ${revision}; };\n`;

      const first = registryGraphFixture([{
        name,
        version: "1.0.0",
        manifest,
        files: { [file]: source(1) },
      }]);
      await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: first.fetch });
      expect(await loadedMarker(dir, name, "1.0.0", "revision")).toBe(1);

      const second = registryGraphFixture([{
        name,
        version: "1.0.0",
        manifest,
        files: { [file]: source(2) },
      }]);
      await addNpmPlugin(dir, `${name}@1.0.0`, { fetch: second.fetch });
      expect(await loadedMarker(dir, name, "1.0.0", "revision")).toBe(2);
    }
  });

  test("loads the verified snapshot when the source tree mutates before verification", async () => {
    const dir = await projectDir();
    const name = "markdown-it-snapshot-race-fixture";
    const fixture = registryGraphFixture([{
      name,
      version: "1.0.0",
      files: { "index.js": "export default function plugin(md) { md.revision = 1; }\n" },
    }]);
    await installFixtureOnly(dir, name, fixture.fetch);
    const sourceEntry = path.join(
      vendoredNpmPluginPackageDir(vendoredNpmPluginRoot(dir, name, "1.0.0"), name),
      "index.js",
    );

    __setVendorSnapshotHookForTests(async () => {
      await writeFile(sourceEntry, "export default function plugin(md) { md.revision = 2; }\n");
    });
    try {
      expect(await loadedMarker(dir, name, "1.0.0", "revision")).toBe(1);
    } finally {
      __setVendorSnapshotHookForTests();
    }
    expect(await readFile(sourceEntry, "utf8")).toContain("revision = 2");
  });

  test("rejects a receipt entry that no longer matches verified package.json metadata", async () => {
    const dir = await projectDir();
    const name = "markdown-it-entry-reconcile-fixture";
    const fixture = registryGraphFixture([{ name, version: "1.0.0" }]);
    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    const installRoot = vendoredNpmPluginRoot(dir, name, "1.0.0");
    const packageDir = vendoredNpmPluginPackageDir(installRoot, name);
    const packageJsonPath = path.join(packageDir, "package.json");
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
    manifest.exports = "./replacement.js";
    await writeFile(packageJsonPath, JSON.stringify(manifest));
    await writeFile(
      path.join(packageDir, "replacement.js"),
      "export default function replacement() {}\n",
    );

    const installedReceipt = await receipt(dir, name, "1.0.0");
    installedReceipt.tree = { algorithm: "sha256", ...await computeVendorTreeDigest(installRoot) };
    await writeFile(
      path.join(installRoot, VENDOR_RECEIPT_FILE),
      `${JSON.stringify(installedReceipt, null, 2)}\n`,
    );

    const validation = await validateProjectPlugins(dir);
    expect(validation[0]).toMatchObject({ ok: false });
    expect(validation[0]?.error).toMatch(/entries do not match package\.json/i);
  });

  test("rejects normalized bundled node_modules content even with a recomputed tree digest", async () => {
    const dir = await projectDir();
    const name = "markdown-it-normalized-bundle-fixture";
    const fixture = registryGraphFixture([{ name, version: "1.0.0" }]);
    await addNpmPlugin(dir, name, { fetch: fixture.fetch });

    const installRoot = vendoredNpmPluginRoot(dir, name, "1.0.0");
    const bundled = path.join(
      vendoredNpmPluginPackageDir(installRoot, name),
      "lib",
      "NoDe_MoDuLeS",
    );
    await mkdir(bundled, { recursive: true });
    await writeFile(path.join(bundled, "hidden.js"), "module.exports = 'ambient';\n");
    const installed = await receipt(dir, name, "1.0.0");
    installed.tree = { algorithm: "sha256", ...await computeVendorTreeDigest(installRoot) };
    await writeFile(
      path.join(installRoot, VENDOR_RECEIPT_FILE),
      `${JSON.stringify(installed, null, 2)}\n`,
    );

    const validation = await validateProjectPlugins(dir);
    expect(validation[0]).toMatchObject({ ok: false });
    expect(validation[0]?.error).toMatch(/non-canonical node_modules|bundled node_modules/i);
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
    expect(validation[0]?.error).toMatch(/install root.*normal directory|outside the project/i);
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

    expect((await listProjectPlugins(dir)).map((entry) => entry.ref)).toEqual([first, second]);
  });

  test("blocks /tmp/node_modules ESM and CommonJS substitution under Node and compiled Bun", async () => {
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
        "  const loaded = await loadPlugin({ name, version, priority: 100, options: {} }, projectDir);",
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
      dependency: string;
      expected?: string;
    }
    const projects: RuntimeProject[] = [];
    for (const format of ["module", "commonjs"] as const) {
      for (const declared of [true, false]) {
        const dir = await projectDir();
        const suffix = `${format}-${declared ? "declared" : "ambient"}`;
        const name = `markdown-it-runtime-${suffix}-fixture`;
        const dependency = `print-md-runtime-${suffix}-dependency`;
        const rootManifest = format === "module"
          ? {
              type: "module",
              exports: "./index.js",
              ...(declared ? { dependencies: { [dependency]: "1.0.0" } } : {}),
            }
          : {
              type: "commonjs",
              main: "index.cjs",
              exports: "./index.cjs",
              ...(declared ? { dependencies: { [dependency]: "1.0.0" } } : {}),
            };
        const rootFiles: Record<string, string> = format === "module"
          ? {
              "index.js": `import value from "${dependency}";\nexport default function plugin(md) { md.result = value; }\n`,
            }
          : declared
            ? {
                "index.cjs": [
                  `const feature = require("${dependency}/features/value");`,
                  `const data = require("${dependency}/data");`,
                  "module.exports = function plugin(md) { md.result = `${feature}:${data.label}`; };",
                ].join("\n"),
              }
            : {
                "index.cjs": `const value = require("${dependency}");\nmodule.exports = function plugin(md) { md.result = value; };\n`,
              };
        const packages: GraphPackageFixture[] = [{
          name,
          version: "1.0.0",
          manifest: rootManifest,
          files: rootFiles,
        }];
        if (declared && format === "module") {
          packages.push({
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
          });
        } else if (declared) {
          packages.push({
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
          });
        }
        const fixture = registryGraphFixture(packages);
        await installFixtureOnly(dir, name, fixture.fetch);

        if (!declared) {
          const ambientManifest = JSON.stringify({
            name: dependency,
            version: "9.9.9",
            type: format,
            main: format === "module" ? "index.js" : "index.cjs",
            exports: format === "module" ? "./index.js" : "./index.cjs",
          });
          const ambientEntry = format === "module"
            ? "export default 'ambient-substitution';\n"
            : "module.exports = 'ambient-substitution';\n";
          for (const ambientDir of [
            path.join(dir, "node_modules", dependency),
            path.join("/tmp", "node_modules", dependency),
          ]) {
            await rm(ambientDir, { recursive: true, force: true });
            await mkdir(ambientDir, { recursive: true });
            await writeFile(path.join(ambientDir, "package.json"), ambientManifest);
            await writeFile(
              path.join(ambientDir, format === "module" ? "index.js" : "index.cjs"),
              ambientEntry,
            );
            if (ambientDir.startsWith("/tmp/node_modules/")) {
              TMP_AMBIENT_PACKAGES.add(ambientDir);
            }
          }
        }
        projects.push({
          dir,
          name,
          dependency,
          ...(declared
            ? { expected: format === "module" ? "esm-declared" : "cjs-declared:json" }
            : {}),
        });
      }
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
        if (project.expected) {
          expect(result.exitCode, `${runtime.label}: ${result.stderr.toString()}`).toBe(0);
          expect(JSON.parse(result.stdout.toString())).toMatchObject({ result: project.expected });
        } else {
          expect(result.exitCode, `${runtime.label} loaded an ambient package`).not.toBe(0);
          expect(result.stderr.toString()).toContain(project.dependency);
          expect(result.stdout.toString()).not.toContain("ambient-substitution");
        }
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
