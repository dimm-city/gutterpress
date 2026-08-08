#!/usr/bin/env bun
// ──────────────────────────────────────────────────────────────────────────
// Prebuild the Gutterpress engine's two browser-side bundles:
//   src/assets/engine/gutterpress-viewer.js  (viewer — src/engine/viewer/global.ts)
//   src/assets/engine/gutterpress-agent.js   (compiler agent — src/engine/compiler/agent.ts)
//
// This is the ONE place `Bun.build` is invoked for the engine. Root CLAUDE.md
// §1 bans importing a bundler at runtime inside `packages/cli/src/` — the
// compiled `bun build --compile` binary cannot carry a live bundler. So the
// bundles are produced HERE, at package build time (wired into the `build`
// script in package.json), and committed as ordinary generated assets under
// `src/assets/engine/`, exactly like the vendored `paged.polyfill.js`.
// `src/lib/embedded-assets.ts` then embeds them via `with { type: "file" }`
// (CLAUDE.md §4) so both `bun packages/cli/src/cli.ts` (source checkout —
// the files are already on disk, no build step required) and the compiled
// binary see the same mechanism.
//
// Run directly (`bun scripts/build-engine-bundles.mjs`) to refresh the
// committed bundles after an engine source change.
// ──────────────────────────────────────────────────────────────────────────
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_SRC = join(PKG_ROOT, "src", "engine");
const OUT_DIR = join(PKG_ROOT, "src", "assets", "engine");

const TARGETS = [
  { entry: join(ENGINE_SRC, "viewer", "global.ts"), outName: "gutterpress-viewer.js", minify: false },
  { entry: join(ENGINE_SRC, "compiler", "agent.ts"), outName: "gutterpress-agent.js", minify: false },
];

function newestSourceMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestSourceMtime(p) : statSync(p).mtimeMs,
    );
  }
  return newest;
}

export async function buildEngineBundles(force = false) {
  const srcMtime = newestSourceMtime(ENGINE_SRC);
  const built = [];
  for (const target of TARGETS) {
    const outPath = join(OUT_DIR, target.outName);
    if (!force) {
      try {
        if (statSync(outPath).mtimeMs >= srcMtime) continue;
      } catch {
        // outPath doesn't exist yet — fall through and build it.
      }
    }
    const result = await Bun.build({
      entrypoints: [target.entry],
      target: "browser",
      format: "iife",
      minify: target.minify,
      outdir: OUT_DIR,
      naming: target.outName,
    });
    if (!result.success) {
      throw new Error(
        `failed to build ${target.outName}:\n${result.logs.map(String).join("\n")}`,
      );
    }
    built.push(target.outName);
  }
  return built;
}

if (import.meta.main) {
  const built = await buildEngineBundles(process.argv.includes("--force"));
  console.log(
    built.length
      ? `built engine bundle(s): ${built.join(", ")}`
      : "engine bundles up to date",
  );
}
