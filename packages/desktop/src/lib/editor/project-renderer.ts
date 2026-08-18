/**
 * The PER-PROJECT editor pipeline: `createEditorRenderer` built with the
 * project's own plugins — one dialect for everything the rich editor does
 * (the mount, the per-file preflight, reseeds).
 *
 * Cached per project directory: plugin modules are static for a session, and
 * every consumer must hold the SAME instance or the preflight could accept a
 * file the mounted editor then refuses. `resetProjectRenderers()` drops the
 * cache on project close (and in tests).
 */
import type MarkdownIt from "markdown-it";
import { createEditorRenderer } from "./markdown-doc";
import { loadProjectPlugins, type ProjectPluginIssue } from "./project-plugins";

export interface ProjectRenderer {
  md: MarkdownIt;
  issues: ProjectPluginIssue[];
}

const cache = new Map<string, Promise<ProjectRenderer>>();

export function getProjectRenderer(projectDir: string | null): Promise<ProjectRenderer> {
  if (!projectDir) return Promise.resolve({ md: createEditorRenderer(), issues: [] });
  let entry = cache.get(projectDir);
  if (!entry) {
    entry = (async () => {
      const { plugins, issues } = await loadProjectPlugins(projectDir);
      return { md: createEditorRenderer(plugins), issues };
    })();
    cache.set(projectDir, entry);
  }
  return entry;
}

export function resetProjectRenderers(): void {
  cache.clear();
}
