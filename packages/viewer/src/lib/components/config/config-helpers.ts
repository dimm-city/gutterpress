/**
 * Pure, presentation-only helpers extracted from ProjectConfigPanel.svelte.
 *
 * These are browser-safe strings/derivations with no host coupling — only
 * `import type` from `$lib/api`, so this module stays PWA-clean (§8). They were
 * lifted verbatim from the panel so the composition root and its section
 * children can share one implementation.
 */

import type {
  ThemeInfo,
  ProjectPluginEntry,
  PluginValidationResult,
} from "$lib/api";

/** Stable key for a theme card (kind + id), used for `{#each}` keying + thumbs. */
export const keyOf = (t: ThemeInfo): string => `${t.kind}:${t.id}`;

/**
 * Build the srcdoc for a theme thumbnail iframe (ported verbatim from the
 * retired ThemeManager).
 */
export function sampleSrcdoc(css: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;} body{padding:14px 16px;} *{box-sizing:border-box;}
${css}
</style></head><body>
<h1>Chapter Title</h1>
<h2>A Section Heading</h2>
<p>The quick brown fox jumps over the lazy dog. Typography, color, and
spacing preview rendered with this theme&rsquo;s stylesheet.</p>
<blockquote>A short pull quote shows callout and accent styling.</blockquote>
<h3>Subheading</h3>
<ul><li>First list item</li><li>Second list item</li></ul>
<p><a href="#">A themed link</a> with <code>inline code</code>.</p>
</body></html>`;
}

export interface PluginStatus {
  label: string;
  kind: "ok" | "error" | "disabled" | "checking";
  detail?: string;
  raw?: string;
}

/**
 * Status text/icon for one plugin (ported from the retired PluginManager).
 * Pure over its inputs — reads the current validation map + in-flight flag.
 */
export function pluginStatus(
  entry: ProjectPluginEntry,
  validation: Record<string, PluginValidationResult>,
  pluginValidating: boolean,
): PluginStatus {
  if (!entry.enabled) return { label: "Disabled", kind: "disabled" };
  const v = validation[entry.ref];
  if (pluginValidating && !v) return { label: "Checking…", kind: "checking" };
  if (!v) return { label: "Checking…", kind: "checking" };
  if (v.ok) return { label: "Loads OK", kind: "ok" };
  const needsInstall = entry.kind === "npm";
  return {
    label: needsInstall ? "Not installed" : "Error",
    kind: "error",
    detail: needsInstall
      ? "This plugin isn't installed yet, so it's skipped in the preview. Install it in your project, then click Re-check."
      : "This plugin couldn't load. See details below, then click Re-check.",
    raw: v.error,
  };
}
