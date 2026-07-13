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
  RecommendedPlugin,
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
  kind: "ok" | "error" | "disabled" | "checking" | "stale";
  detail?: string;
  raw?: string;
  /** Copyable `npm install <name>` command — only set for a not-installed npm plugin (M33). */
  installCommand?: string;
  /** Link to the plugins guide chapter — only set for a not-installed npm plugin (M33). */
  guideHref?: string;
}

/** Chapter 6 of the user guide — "how do I install a plugin" (M33). */
export const PLUGINS_GUIDE_URL =
  "https://github.com/dimm-city/print-md/blob/main/examples/print-md-user-guide/06-plugins.md";

/**
 * Friendly display name for a configured plugin entry (M33): the recommended
 * list already carries a plain-language label ("Highlight") for every
 * built-in feature, fetched in the same `loadPlugins()` round-trip that
 * populates the configured list — but the configured-list row previously
 * rendered `entry.ref` (the raw npm id, e.g. "markdown-it-mark") verbatim,
 * losing that label the moment "Turn on" adds the entry. Look the ref up in
 * `recommended` and fall back to the raw ref for anything not on that curated
 * list (manually added npm packages, local files).
 */
export function pluginLabel(
  entry: ProjectPluginEntry,
  recommended: RecommendedPlugin[],
): string {
  const rec = recommended.find((r) => r.name === entry.ref);
  return rec?.label ?? entry.ref;
}

/**
 * Status text/icon for one plugin (ported from the retired PluginManager).
 * Pure over its inputs — reads the current validation map + in-flight flag.
 *
 * Tri-state fix (M34): `pluginValidating` is true only while a validate
 * round-trip is in flight. If it's `false` and there's still no result for
 * this ref, `api.plugin.validate` threw (or never ran) — that must NOT read
 * the same as "in progress", since it will never resolve on its own. It gets
 * its own "stale" kind with a distinct label pointing at the fix (Re-check).
 */
export function pluginStatus(
  entry: ProjectPluginEntry,
  validation: Record<string, PluginValidationResult>,
  pluginValidating: boolean,
): PluginStatus {
  if (!entry.enabled) return { label: "Disabled", kind: "disabled" };
  const v = validation[entry.ref];
  if (!v) {
    if (pluginValidating) return { label: "Checking…", kind: "checking" };
    return {
      label: "Check failed — click Re-check",
      kind: "stale",
      detail: "The last plugin check didn't finish, so this plugin's status is unknown. Click Re-check to try again.",
    };
  }
  if (v.ok) return { label: "Loads OK", kind: "ok" };
  const needsInstall = entry.kind === "npm";
  return {
    label: needsInstall ? "Not installed" : "Error",
    kind: "error",
    detail: needsInstall
      ? "This plugin isn't installed yet, so it's skipped in the preview. Run the install command below in your project folder, then click Re-check."
      : "This plugin couldn't load. See details below, then click Re-check.",
    raw: v.error,
    installCommand: needsInstall ? `npm install ${entry.ref}` : undefined,
    guideHref: needsInstall ? PLUGINS_GUIDE_URL : undefined,
  };
}
