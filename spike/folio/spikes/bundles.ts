/**
 * Build (or refresh) the two browser bundles the spikes load:
 * `dist/folio.js` (viewer) and `dist/folio-agent.js` (compiler agent).
 *
 * The Gutterpress engine itself now lives at `packages/cli/src/engine/` (the
 * spike/folio 2026-08-06 promotion — see `../README.md`); the CLI package
 * ships its OWN prebuilt/embedded copies of these bundles
 * (`packages/cli/scripts/build-engine-bundles.ts`, embedded via
 * `with { type: "file" }` — CLAUDE.md §4). This file is the SPIKE's own
 * on-demand copy for `spikes/` and `compare/`, which read `dist/folio*.js`
 * directly as strings rather than going through the CLI package — so it
 * rebuilds from the promoted engine source into this repo's local `dist/`,
 * on demand, so a fresh checkout works without a separate build step.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ENGINE_SRC = join(ROOT, "..", "..", "packages", "cli", "src", "engine");

const TARGETS = [
  { entry: join(ENGINE_SRC, "viewer", "global.ts"), out: "dist/folio.js", minify: false },
  { entry: join(ENGINE_SRC, "viewer", "global.ts"), out: "dist/folio.min.js", minify: true },
  { entry: join(ENGINE_SRC, "compiler", "agent.ts"), out: "dist/folio-agent.js", minify: false },
];

function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const p = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestSourceMtime(p) : statSync(p).mtimeMs,
    );
  }
  return newest;
}

export async function ensureBundles(force = false): Promise<string[]> {
  const srcMtime = newestSourceMtime(ENGINE_SRC);
  const built: string[] = [];
  for (const target of TARGETS) {
    const outPath = join(ROOT, target.out);
    if (!force && existsSync(outPath) && statSync(outPath).mtimeMs >= srcMtime) continue;
    const result = await Bun.build({
      entrypoints: [target.entry],
      target: "browser",
      format: "iife",
      minify: target.minify,
      outdir: join(ROOT, "dist"),
      naming: target.out.replace(/^dist\//, ""),
    });
    if (!result.success) {
      throw new Error(
        `failed to build ${target.out}:\n${result.logs.map(String).join("\n")}`,
      );
    }
    built.push(target.out);
  }
  return built;
}

if (import.meta.main) {
  const built = await ensureBundles(process.argv.includes("--force"));
  console.log(built.length ? `built ${built.join(", ")}` : "bundles up to date");
}
