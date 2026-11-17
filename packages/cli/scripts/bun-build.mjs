// `bun build` with every declared dependency kept external except the ones in
// BUNDLED, which are compiled into dist/ instead. A patched dependency
// (patches/ at the repo root) must be bundled: npm installs the unpatched
// release from the registry, so a published package that imported it would
// run without the fix.
//
// Usage: bun scripts/bun-build.mjs <bun build args>  (instead of --packages=external)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BUNDLED = new Set(["isomorphic-git"]);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })
  .filter((name) => !BUNDLED.has(name))
  .flatMap((name) => ["-e", name, "-e", `${name}/*`]);

const { status } = spawnSync(process.execPath, ["build", ...process.argv.slice(2), ...external], { stdio: "inherit" });
process.exit(status ?? 1);
