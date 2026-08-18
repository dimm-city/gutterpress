/**
 * Load the PROJECT'S plugins for the rich editor, in the renderer.
 *
 * The rich editor must parse with the dialect that prints — and that dialect
 * includes the project's manifest plugins (`@sidebar`, `@callout`, whatever
 * the book brands). Without them a plugin's marker lines tokenize as plain
 * paragraphs: content-safe on save, but rendered as raw text, which is
 * exactly the "markdown syntax instead of my book" failure.
 *
 * The host resolves each manifest entry to a same-origin module URL
 * (`api/project/editor-plugins`); this loader `import()`s them and returns
 * `LoadedPlugin`s for `createEditorRenderer(plugins)`, which applies them at
 * the print path's own pipeline position. Loading is degrade-and-REPORT,
 * never silent (§5's preview rule): a plugin the browser cannot import is
 * returned as an issue the host surfaces next to the editor, and the rest of
 * the dialect still loads.
 */
import { api, type EditorPluginEntry } from "$lib/api";
import type { LoadedPlugin } from "./markdown-doc";

export interface ProjectPluginIssue {
  ref: string;
  error: string;
}

export interface ProjectPluginReport {
  plugins: LoadedPlugin[];
  issues: ProjectPluginIssue[];
}

/**
 * The plugin function inside a loaded module — the same interop shapes the
 * host loader accepts (`extractPluginExports` in the lib): a named export
 * when the manifest selects one, else the default export, else a module that
 * IS the function, else a double-wrapped default.
 */
export function pickPluginExport(mod: unknown, exportName?: string): LoadedPlugin["plugin"] {
  const m =
    mod !== null && (typeof mod === "object" || typeof mod === "function")
      ? (mod as Record<string, unknown>)
      : {};
  if (exportName) {
    if (typeof m[exportName] === "function") return m[exportName] as LoadedPlugin["plugin"];
    throw new Error(`module has no function export named "${exportName}"`);
  }
  if (typeof m.default === "function") return m.default as LoadedPlugin["plugin"];
  if (typeof mod === "function") return mod as LoadedPlugin["plugin"];
  const inner = m.default as Record<string, unknown> | undefined;
  if (inner && typeof inner.default === "function") return inner.default as LoadedPlugin["plugin"];
  throw new Error("module does not export a plugin function (default or named)");
}

/** Fetch the project's plugin list and import every loadable module. */
export async function loadProjectPlugins(projectDir: string): Promise<ProjectPluginReport> {
  const plugins: LoadedPlugin[] = [];
  const issues: ProjectPluginIssue[] = [];

  let entries: EditorPluginEntry[];
  try {
    entries = (await api.project.editorPlugins(projectDir)).plugins;
  } catch (e) {
    return {
      plugins,
      issues: [{ ref: "(manifest)", error: e instanceof Error ? e.message : String(e) }],
    };
  }

  for (const entry of entries) {
    if (!entry.url) {
      issues.push({ ref: entry.ref, error: entry.error ?? "not loadable" });
      continue;
    }
    try {
      const mod: unknown = await import(/* @vite-ignore */ entry.url);
      plugins.push({
        name: entry.ref,
        plugin: pickPluginExport(mod, entry.exportName),
        options: entry.options ?? {},
      });
    } catch (e) {
      issues.push({ ref: entry.ref, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { plugins, issues };
}
