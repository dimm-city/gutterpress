/**
 * Manifest-field IPC handlers for the "project-config" capability
 * (SFE-P5c2). Ports `src/routes/api/manifest/{read,set-fields}/+server.ts`
 * verbatim — both use the narrower `gutterpress/api` surface (not the full
 * lib), same as the deleted routes did via `loadApiLib()`.
 */
import { loadApiLib } from "./lib-loader";
import { requireProjectDir } from "./validation";

/** Read the author-facing manifest subset for the Config view's Details section. */
export async function manifestRead(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "manifest:read");
  const lib = await loadApiLib();
  return lib.readManifestFields(projectDir);
}

/** Apply the author-facing manifest field updates (one yaml round-trip). */
export async function manifestSetFields(rawProjectDir: unknown, rawUpdates: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "manifest:setFields");
  if (!rawUpdates || typeof rawUpdates !== "object") {
    throw new Error("manifest:setFields requires an updates object");
  }
  const lib = await loadApiLib();
  return lib.setManifestFields(projectDir, rawUpdates as Parameters<typeof lib.setManifestFields>[1]);
}
