import { describe, expect, test } from "bun:test";
import { readFileSync, statSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildEngineBundles } from "../../../scripts/build-engine-bundles.mjs";

// `gutterpress-viewer.js` / `gutterpress-agent.js` are GENERATED from
// src/engine (see scripts/build-engine-bundles.mjs) and committed, because
// the runtime may not bundle (CLAUDE.md §1). Nothing rebuilds them when you
// run the CLI from source — `bun packages/cli/src/cli.ts build` loads the
// committed bytes — so an engine source change that isn't followed by a
// bundle refresh ships the OLD engine while the source reads correct. That
// failure is silent and expensive: a stale gutterpress-agent.js once cost a
// debugging cycle by dropping the string-set value evaluator, which put a
// chapter's entire text in every footer chip while agent.ts looked right.
// import.meta.dir is <pkg>/src/assets/engine
const SRC_ROOT = resolve(import.meta.dir, "..", "..");
const PKG_ROOT = resolve(SRC_ROOT, "..");
const ENGINE_SRC = join(SRC_ROOT, "engine");
const BUNDLES = ["gutterpress-viewer.js", "gutterpress-agent.js"];

function newestSourceMtime(dir: string): { ms: number; file: string } {
  let newest = { ms: 0, file: "" };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    // Tests don't reach the browser bundles; ignore them so a test edit
    // doesn't read as an engine change.
    if (!entry.isDirectory() && /\.test\.ts$/.test(entry.name)) continue;
    const candidate = entry.isDirectory()
      ? newestSourceMtime(p)
      : { ms: statSync(p).mtimeMs, file: p };
    if (candidate.ms > newest.ms) newest = candidate;
  }
  return newest;
}

describe("committed engine bundles", () => {
  // The real invariant: the committed bundle equals what the source produces
  // right now. Rebuild into a scratch dir and byte-compare — this holds up
  // on a fresh clone, where `git checkout` rewrites every file's mtime in
  // arbitrary order and makes an mtime comparison meaningless.
  test("committed bundles match a fresh build from src/engine", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "gutterpress-engine-bundle-"));
    try {
      await buildEngineBundles(true, scratch);
      for (const name of BUNDLES) {
        const committed = readFileSync(join(import.meta.dir, name), "utf8");
        const fresh = readFileSync(join(scratch, name), "utf8");
        if (committed !== fresh) {
          throw new Error(
            `${name} does not match a fresh build from src/engine — the engine ` +
              `source changed but the committed bundle was not refreshed, so the CLI ` +
              `still runs the OLD engine. Run: bun scripts/build-engine-bundles.mjs --force`,
          );
        }
        expect(committed).toBe(fresh);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // Local-only developer aid: catches a forgotten rebuild fast, without
  // waiting for CI. Skipped in CI because `git checkout` on a fresh clone
  // rewrites mtimes in arbitrary order, making this comparison meaningless
  // there — the content check above is the real invariant everywhere.
  test.skipIf(!!process.env.CI).each(BUNDLES)(
    "%s is newer than every engine source file (local only)",
    (name) => {
      const bundle = join(import.meta.dir, name);
      const newest = newestSourceMtime(ENGINE_SRC);
      const bundleMs = statSync(bundle).mtimeMs;
      if (bundleMs < newest.ms) {
        throw new Error(
          `${name} is older than ${newest.file.replace(PKG_ROOT, "")} — the engine ` +
            `source changed but the committed bundle was not refreshed, so the CLI ` +
            `still runs the OLD engine. Run: bun scripts/build-engine-bundles.mjs`,
        );
      }
      expect(bundleMs).toBeGreaterThanOrEqual(newest.ms);
    },
  );

  // A content check the mtime rule can't make: git checkout / a fresh clone
  // rewrites mtimes wholesale, so mtime alone can pass on a bundle that is
  // substantively stale. These are the engine features whose absence produced
  // silently-wrong PDFs rather than an error.
  test("gutterpress-agent.js carries the content-value evaluator string-set depends on", () => {
    const agent = readFileSync(join(import.meta.dir, "gutterpress-agent.js"), "utf8");
    expect(agent).toContain("function evaluateContent");
    expect(agent).toContain("function parseContent");
  });

  // Content check for the Phase 0 window.Gutterpress collapse (mtime alone
  // can't catch a fresh clone where the old window.Folio/window.folio split
  // bundle happens to still be newer than its source).
  test("gutterpress-viewer.js exposes window.Gutterpress", () => {
    const viewer = readFileSync(join(import.meta.dir, "gutterpress-viewer.js"), "utf8");
    expect(viewer).toContain("window.Gutterpress");
  });
});
