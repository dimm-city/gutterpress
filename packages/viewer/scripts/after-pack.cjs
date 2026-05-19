/**
 * electron-builder afterPack hook.
 *
 * Replaces the Bun workspace symlink for @dimm-city/print-md-lib with the
 * real compiled dist/ + installs runtime deps so they're available in the
 * packaged app's node_modules.
 */

const { rm, cp, mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const { existsSync, readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

/** @param {{ appOutDir: string }} context */
exports.default = async function afterPack({ appOutDir }) {
  const appDir = join(appOutDir, "resources", "app");
  const libDest = join(appDir, "node_modules", "@dimm-city", "print-md-lib");
  const libSrc = join(__dirname, "..", "..", "lib");

  // Replace the workspace symlink with real compiled files.
  await rm(libDest, { recursive: true, force: true });
  await mkdir(libDest, { recursive: true });

  for (const item of ["dist", "profiles", "package.json"]) {
    const src = join(libSrc, item);
    if (existsSync(src)) {
      await cp(src, join(libDest, item), { recursive: true });
    }
  }

  // Install lib's runtime deps (ws, chokidar, yaml, etc.) into the app.
  const libPkg = JSON.parse(readFileSync(join(libSrc, "package.json"), "utf8"));
  const viewerPkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

  const runtimeDeps = { ...(libPkg.dependencies ?? {}) };
  const tmpPkg = {
    name: "print-md-app",
    private: true,
    type: viewerPkg.type ?? "module",
    main: viewerPkg.main,
    version: viewerPkg.version,
    dependencies: runtimeDeps,
  };

  await writeFile(join(appDir, "package.json"), JSON.stringify(tmpPkg, null, 2));

  // Use shell:true on Windows so cmd.exe resolves bun.cmd correctly.
  const result = spawnSync("bun", ["install", "--production"], {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`bun install failed with exit code ${result.status}`);
  }

  // Restore real package.json.
  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify({ name: viewerPkg.name, private: true, type: viewerPkg.type, main: viewerPkg.main, version: viewerPkg.version }, null, 2)
  );

  console.log("[afterPack] @dimm-city/print-md-lib replaced with compiled dist/");
};
