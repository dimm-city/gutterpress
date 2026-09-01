/**
 * Project-styling IPC handler for the "project-config" capability
 * (SFE-P5c2). Ports `src/routes/api/style/set-active/+server.ts` verbatim.
 *
 * This is the CSS editor's project-styling surface (the manifest's active
 * `styles:` list) — not `checkCss` print-safety linting, which stays
 * `api.lint.checkCss` (a server route; P5c4).
 */
import { loadApiLib } from "./lib-loader";
import { requireProjectDir } from "./validation";

/** Replace the manifest's active `styles:` list (reorder + toggle). */
export async function styleSetActive(rawProjectDir: unknown, rawPaths: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "style:setActive");
  if (!Array.isArray(rawPaths)) {
    throw new Error("style:setActive requires a paths array");
  }
  const lib = await loadApiLib();
  return lib.setActiveStyles(projectDir, rawPaths as string[]);
}
