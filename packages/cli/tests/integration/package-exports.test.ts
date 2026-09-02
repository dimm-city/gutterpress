/**
 * Package export surface gate (D11 / SFE-P6c).
 *
 * Proves four things about the PUBLISHED package (not source, `dist/`).
 * The first three are derived directly from `package.json#exports`, so a
 * future subpath ADDITION is covered automatically without touching this
 * file; a future REMOVAL is a different case those derived loops cannot see
 * (they shrink along with `package.json#exports` and stay green) — the
 * fourth item below is what catches that:
 *
 *   1. Every declared subpath resolves under a real Node.js resolver AND a
 *      real Bun resolver, using the package's own self-reference (Node/Bun
 *      both resolve a bare specifier matching the nearest ancestor
 *      package.json's own "name" against that same package.json's "exports"
 *      — no fixture symlink or workspace install required, and this is the
 *      exact mechanism a real dependent (desktop, packages/editor,
 *      packages/vscode-extension) uses through its own node_modules
 *      symlink, per `docs/plans/source-first-editor/capability-map.md`).
 *   2. `gutterpress/render` stays node-free — this test does NOT
 *      reimplement that check. `scripts/check-render-pure.mjs` is the one
 *      source of truth for what "node-free" means (no Node builtins, no
 *      createRequire, no relative chunk imports); this test only proves the
 *      gate is wired to something that actually runs (G-12: "a gate must
 *      prove it ran and can fail") by invoking it as a subprocess and
 *      asserting a clean exit.
 *   3. Every file `package.json#exports` points at ("types" and "default"
 *      for each subpath) is a file `npm pack` would actually ship — a
 *      subpath can resolve locally (dist/ exists in this checkout) while
 *      still being missing from what gets published, if `package.json#files`
 *      drifts. `npm pack --dry-run --json` is the authoritative packing
 *      simulation (no network, no tag, nothing written to disk).
 *   4. The subpath surface itself is exactly the D11-approved set
 *      (`.`, `./api`, `./render`, `./plugins`), each with both a `types` and
 *      a `default` condition — pinned explicitly rather than derived, so
 *      deleting `exports["./plugins"]` (or any other subpath/condition)
 *      fails this assertion instead of just generating fewer tests above.
 *
 * Requires `dist/` to already be built (`bun run build`) — this test proves
 * the export SURFACE, not the build step; a missing dist/ fails loudly with
 * a clear instruction rather than skipping (AP-21: an empty/skipped result
 * must never read as a pass).
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "../..");
const PKG_JSON_PATH = path.join(PKG_ROOT, "package.json");
const PKG = JSON.parse(readFileSync(PKG_JSON_PATH, "utf-8")) as {
  name: string;
  exports: Record<string, { types?: string; default?: string }>;
};

/** subpath key ("." | "./api" | ...) -> the bare specifier a real consumer writes. */
function specifierFor(subpath: string): string {
  return subpath === "." ? PKG.name : `${PKG.name}/${subpath.slice(2)}`;
}

const SUBPATHS = Object.keys(PKG.exports);

beforeAll(() => {
  // Liveness assertion (G-12 / AP-21): a package.json with zero declared
  // exports would make every test below vacuously pass. Fail loudly first.
  expect(SUBPATHS.length).toBeGreaterThan(0);

  const entryFile = PKG.exports["."]?.default;
  if (!entryFile || !existsSync(path.join(PKG_ROOT, entryFile))) {
    throw new Error(
      `package-exports.test.ts: ${entryFile ?? "dist/index.js"} does not exist. ` +
        `This test proves the EXPORT SURFACE against a built dist/ — run "bun run build" in packages/cli first.`,
    );
  }
});

// SFE-P6 round-1 repair: every loop above derives its target set FROM
// `package.json#exports` itself (`SUBPATHS = Object.keys(PKG.exports)`), so
// this file proves addition is covered automatically but is structurally
// blind to REMOVAL — deleting a subpath (or a `types`/`default` condition
// under one) just shrinks the derived set and the whole suite stays green,
// with one fewer test silently generated. `./plugins` in particular is the
// D11 subpath SFE-P6c added specifically because it has real consumers
// (packages/desktop/electron/editor-projection.ts,
// packages/vscode-extension/src/project/projection.ts) — losing it would be
// a real regression this file's derived loops cannot catch. This assertion
// pins the approved surface explicitly, independent of whatever
// `package.json#exports` currently says, so a removal fails loudly here
// instead of just generating fewer tests. `./viewer` is the on-screen
// pagination engine, added for the desktop's paged editor
// (`packages/desktop/src/lib/editor/paged-surface.ts`), which fragments the
// live editor document with the SAME engine the preview uses — that shared
// engine is what makes editor and preview agree, so losing this subpath
// would be a real regression too.
test("the public subpath surface is exactly the D11-approved set", () => {
  expect(new Set(SUBPATHS)).toEqual(new Set([".", "./api", "./render", "./plugins", "./viewer"]));
  for (const sp of SUBPATHS) {
    expect(Object.keys(PKG.exports[sp]!).sort()).toEqual(["default", "types"]);
  }
});

describe("package.json#exports resolves under Node", () => {
  for (const subpath of SUBPATHS) {
    test(`node can import "${specifierFor(subpath)}"`, () => {
      const specifier = specifierFor(subpath);
      const proc = Bun.spawnSync({
        cmd: [
          "node",
          "--input-type=module",
          "-e",
          `import(${JSON.stringify(specifier)}).then((m) => { if (!m || typeof m !== "object") { console.error("import resolved to a non-module value"); process.exit(1); } process.exit(0); }, (e) => { console.error(e); process.exit(1); });`,
        ],
        cwd: PKG_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (proc.exitCode !== 0) {
        throw new Error(
          `node failed to import "${specifier}" (exit ${proc.exitCode}):\n${proc.stderr.toString()}`,
        );
      }
    }, 20_000);
  }
});

describe("package.json#exports resolves under Bun", () => {
  for (const subpath of SUBPATHS) {
    test(`bun can import "${specifierFor(subpath)}"`, () => {
      const specifier = specifierFor(subpath);
      const proc = Bun.spawnSync({
        cmd: ["bun", "-e", `await import(${JSON.stringify(specifier)});`],
        cwd: PKG_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (proc.exitCode !== 0) {
        throw new Error(
          `bun failed to import "${specifier}" (exit ${proc.exitCode}):\n${proc.stderr.toString()}`,
        );
      }
    }, 20_000);
  }
});

test("gutterpress/render stays node-free (scripts/check-render-pure.mjs)", () => {
  // Reference the existing gate, don't duplicate its parsing logic — see
  // this file's header. build:library already runs this script after
  // building dist/render.js; this assertion proves it is a real,
  // independently-runnable gate, not dead scaffolding.
  const scriptPath = path.join(PKG_ROOT, "scripts", "check-render-pure.mjs");
  expect(existsSync(scriptPath)).toBe(true);
  const proc = Bun.spawnSync({
    cmd: ["node", scriptPath],
    cwd: PKG_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(
      `check-render-pure.mjs failed (exit ${proc.exitCode}):\n${proc.stdout.toString()}${proc.stderr.toString()}`,
    );
  }
});

describe("package-content: every exported file ships (npm pack --dry-run)", () => {
  let packedPaths: Set<string>;

  beforeAll(() => {
    const proc = Bun.spawnSync({
      cmd: ["npm", "pack", "--dry-run", "--json"],
      cwd: PKG_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      throw new Error(`npm pack --dry-run failed (exit ${proc.exitCode}):\n${proc.stderr.toString()}`);
    }
    const parsed = JSON.parse(proc.stdout.toString()) as Array<{ files: Array<{ path: string }> }>;
    // Liveness assertion (AP-21): a pack producing zero files is a fixture
    // error, not a pass.
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]!.files.length).toBeGreaterThan(0);
    packedPaths = new Set(parsed[0]!.files.map((f) => f.path.replace(/\\/g, "/")));
  }, 30_000);

  for (const subpath of SUBPATHS) {
    const decl = PKG.exports[subpath]!;
    for (const [condition, declPath] of Object.entries(decl)) {
      if (!declPath) continue;
      test(`"${subpath}" (${condition}) — ${declPath} is packed`, () => {
        const normalized = declPath.replace(/^\.\//, "");
        expect(packedPaths.has(normalized)).toBe(true);
      });
    }
  }
});
