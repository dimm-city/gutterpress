/**
 * Project-configuration IPC handler for the "project-config" capability
 * (SFE-P5c2). Ports `src/routes/api/project/list-styles/+server.ts`
 * verbatim: same validation order (`projectDir`, then the optional
 * `repoRoot` under the same containment check), same lib call.
 */
import { loadLib } from "./lib-loader";
import { requireProjectDir } from "./validation";
import type { SecureHandle } from "../server-bridge/secure-handle";

/**
 * The project's editable stylesheets for the Design panel's picker.
 *
 * `repoRoot` (optional) lets a book that lives inside a repository also
 * offer the repository's SHARED stylesheets — guarded exactly like
 * `projectDir`, so it cannot become a directory-enumeration primitive: only
 * a path inside the host-owned `projectRoots()` allow-list is accepted.
 */
export async function projectListStyles(
  rawProjectDir: unknown,
  rawRepoRoot?: unknown,
): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "project:listStyles");
  const repoRoot =
    typeof rawRepoRoot === "string" && rawRepoRoot
      ? await requireProjectDir(rawRepoRoot, "project:listStyles")
      : undefined;
  const lib = await loadLib();
  return lib.listProjectStyles(projectDir, repoRoot ? { repoRoot } : {});
}

/** Register the project:* IPC channels (SFE-P6b). */
export function registerProjectHandlers(secureHandle: SecureHandle): void {
  secureHandle("project:listStyles", (_e, projectDir: unknown, repoRoot?: unknown) =>
    projectListStyles(projectDir, repoRoot),
  );
}
