/**
 * electron-builder afterPack hook.
 *
 * Replaces the workspace symlink for @dimm-city/print-md-lib with the real
 * compiled dist/ + installs the lib's runtime deps so they're available in
 * the packaged app's node_modules.
 *
 * Ordering matters:
 *
 *   1. Write a temporary package.json listing the lib's runtime deps
 *      (ws, chokidar, yaml, etc.).
 *   2. Run `npm install --omit=dev` against that temp manifest. This
 *      will prune any pre-existing `node_modules/@dimm-city/print-md-lib`
 *      directory because it isn't listed as a dependency.
 *   3. ONLY THEN copy the real compiled lib dist/ into
 *      node_modules/@dimm-city/print-md-lib so that npm install can't
 *      touch it afterwards.
 *   4. Restore the original package.json.
 *
 * The original implementation did (3) before (2) and npm install silently
 * deleted the lib, producing the runtime "Cannot find package
 * '@dimm-city/print-md-lib'" error on Windows. CI's win-unpacked happened
 * to work in some configurations because we copied a workspace-derived
 * tree there before zipping, but the zip extracted on the user's machine
 * was missing the lib entirely.
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

  const libPkg = JSON.parse(readFileSync(join(libSrc, "package.json"), "utf8"));
  const viewerPkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8")
  );

  // 1. Temp package.json with lib's runtime deps (without the lib itself —
  //    we install the lib's compiled files manually after npm install).
  const tmpPkg = {
    name: "print-md-app",
    private: true,
    type: viewerPkg.type ?? "module",
    main: viewerPkg.main,
    version: viewerPkg.version,
    dependencies: { ...(libPkg.dependencies ?? {}) },
  };
  await writeFile(join(appDir, "package.json"), JSON.stringify(tmpPkg, null, 2));

  // 2. Run npm install first. This installs the deps AND prunes whatever
  //    @dimm-city/print-md-lib placeholder electron-builder left here
  //    (workspace symlink target). After this step, the lib path is empty.
  const result = spawnSync(
    "npm",
    ["install", "--omit=dev", "--ignore-scripts"],
    {
      cwd: appDir,
      stdio: "inherit",
      shell: true,
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm install failed with exit code ${result.status}`);
  }

  // 3. NOW write the real lib files in. npm install is done, so it can't
  //    prune them. Subsequent runs of the packaged app see a real package.
  await rm(libDest, { recursive: true, force: true });
  await mkdir(libDest, { recursive: true });
  for (const item of ["dist", "profiles", "package.json"]) {
    const src = join(libSrc, item);
    if (existsSync(src)) {
      await cp(src, join(libDest, item), { recursive: true });
    }
  }

  // 4. Restore the real app package.json.
  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify(
      {
        name: viewerPkg.name,
        private: true,
        type: viewerPkg.type,
        main: viewerPkg.main,
        version: viewerPkg.version,
      },
      null,
      2
    )
  );

  console.log(
    "[afterPack] installed runtime deps, then wrote @dimm-city/print-md-lib dist/"
  );
};
