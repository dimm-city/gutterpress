import path from "node:path";

/**
 * Repair round 1 (finding "Manifest plugin paths are not workspace-root-
 * scoped"). Extracted out of `./discover.ts` into its OWN, deliberately
 * `vscode`-free module: `discover.ts` imports `"vscode"` as a VALUE (for
 * `currentActiveProjectDirParams`), and ES modules resolve a file's ENTIRE
 * top-level import graph the moment ANYTHING is imported from it — so a
 * `./projection.ts` (or its `vscode`-free test suite,
 * `tests/project/projection.test.ts`, which relies on needing no
 * `mock.module("vscode", ...)` at all) importing this containment check
 * FROM `discover.ts` would have dragged that `vscode` import in too. This
 * file has none, so both `discover.ts` and `projection.ts` can share it
 * without either constraint on the other.
 */

/** True when `filePath` is `folderPath` itself or a descendant of it.
 *  `path.relative` is the standard, symlink-agnostic way to ask this: a
 *  relative path that is empty, or that does not start with `..` and is not
 *  itself absolute (which `path.relative` only returns on Windows when the
 *  two inputs are on different drives), means `filePath` is inside
 *  `folderPath`. */
export function isPathInsideFolder(filePath: string, folderPath: string): boolean {
  const rel = path.relative(folderPath, filePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
