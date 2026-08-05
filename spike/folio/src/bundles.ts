/**
 * Build (or refresh) the two browser bundles the CLI and the spikes load:
 * `dist/folio.js` (viewer) and `dist/folio-agent.js` (compiler agent).
 *
 * Called on demand so a fresh checkout works without a separate build step —
 * `dist/` is a build artifact, not source.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const TARGETS = [
  { entry: "src/viewer/global.ts", out: "dist/folio.js", minify: false },
  { entry: "src/viewer/global.ts", out: "dist/folio.min.js", minify: true },
  { entry: "src/compiler/agent.ts", out: "dist/folio-agent.js", minify: false },
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
  const srcMtime = newestSourceMtime(join(ROOT, "src"));
  const built: string[] = [];
  for (const target of TARGETS) {
    const outPath = join(ROOT, target.out);
    if (!force && existsSync(outPath) && statSync(outPath).mtimeMs >= srcMtime) continue;
    const result = await Bun.build({
      entrypoints: [join(ROOT, target.entry)],
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
