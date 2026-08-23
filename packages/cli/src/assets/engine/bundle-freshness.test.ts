import { describe, expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
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
const BUNDLES = ["gutterpress-viewer.js", "gutterpress-agent.js"];

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

  // A content check the mtime rule can't make: git checkout / a fresh clone
  // rewrites mtimes wholesale, so mtime alone can pass on a bundle that is
  // substantively stale. These are the engine features whose absence produced
  // silently-wrong PDFs rather than an error.
  test("gutterpress-agent.js carries the content-value evaluator string-set depends on", () => {
    const agent = readFileSync(join(import.meta.dir, "gutterpress-agent.js"), "utf8");
    expect(agent).toContain("function evaluateContent");
    expect(agent).toContain("function parseContent");
  });

  // Content check for the single window.Gutterpress global (mtime alone
  // can't catch a fresh clone where a stale bundle happens to still be newer
  // than its source).
  test("gutterpress-viewer.js exposes window.Gutterpress", () => {
    const viewer = readFileSync(join(import.meta.dir, "gutterpress-viewer.js"), "utf8");
    expect(viewer).toContain("window.Gutterpress");
  });
});
