/**
 * Pure, presentation-only helpers for the Extensions surface (the Look and
 * Features views) and its controller.
 *
 * Browser-safe strings/derivations with no host coupling — only `import type`
 * from `$lib/platform/dtos`, so this module stays PWA-clean (§8). Kept out of
 * the controller so bun can unit-test them without the `$state` shim, and out
 * of the components so both views share one implementation.
 */

import type {
  ProjectExtensionEntry,
  ExtensionValidationResult,
} from "$lib/platform/dtos";

/**
 * Build the srcdoc for a look thumbnail iframe (ported verbatim from the
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

/**
 * #106 hover preview: a FIXED, built-in two-page sample spread. This is NEVER
 * the author's document — it's a constant sample so the hover preview
 * structurally cannot re-paginate or leak the real manuscript. Full-document
 * re-pagination only happens through the preview pipeline.
 *
 * Rendered exactly like the per-row thumbnail (`readCss` → inline `<style>` →
 * sandboxed `<iframe srcdoc>`), just larger and with two facing "pages" of
 * representative content so the author can judge a look at a glance.
 */
const SAMPLE_SPREAD_BODY = `
<article class="pm-sample-page">
  <h1>Chapter One</h1>
  <h2>The Opening Section</h2>
  <p>The quick brown fox jumps over the lazy dog. This sample shows how body
  text, headings, and spacing render with the selected theme &mdash; a fixed
  preview, not your document.</p>
  <blockquote>A pull quote demonstrates callout, accent, and emphasis styling
  as the theme defines it.</blockquote>
  <h3>A Subheading</h3>
  <ul><li>First list item</li><li>Second list item</li><li>Third item</li></ul>
  <p>A closing paragraph with <a href="#">a themed link</a> and some
  <code>inline code</code> to preview monospace treatment.</p>
</article>
<article class="pm-sample-page">
  <h2>Continuing On</h2>
  <p>Facing pages let you judge running heads, margins, and how the theme
  balances a two-page spread before you commit to applying it.</p>
  <ol><li>Ordered item one</li><li>Ordered item two</li></ol>
  <h3>Table &amp; Emphasis</h3>
  <p>Body copy with <strong>bold</strong> and <em>italic</em> emphasis, plus a
  second <blockquote>short blockquote near the foot of the page.</blockquote></p>
  <p>The end of the sample spread.</p>
</article>`;

/** Build the srcdoc for the enlarged hover preview (a fixed 2-page spread). */
export function hoverPreviewSrcdoc(css: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;} *{box-sizing:border-box;}
body{display:flex;gap:12px;padding:12px;background:#8883;align-items:flex-start;justify-content:center;}
.pm-sample-page{flex:1 1 0;min-width:0;background:#fff;color:#111;padding:18px 20px;box-shadow:0 1px 6px rgba(0,0,0,0.25);overflow:hidden;}
${css}
</style></head><body>
${SAMPLE_SPREAD_BODY}
</body></html>`;
}

/**
 * Where an entry comes from, as a short row caption: "built in" for a bundled
 * feature, "npm 1.2.3" (or "npm" while unpinned) for a package, and the path
 * as written — minus a leading `./` — for a folder or file the author owns
 * (`extensions/clean-book`, `../shared/house-style`).
 */
export function extensionSourceLabel(entry: ProjectExtensionEntry): string {
  if (entry.kind === "bundled") return "built in";
  if (entry.kind === "npm") return entry.version ? `npm ${entry.version}` : "npm";
  return entry.name.replace(/^\.\//, "");
}

/**
 * The full `use` order after moving `entry` one slot up (`delta` -1) or down
 * (+1) WITHIN `view` — a filtered projection of `entries`, such as the looks.
 * The Look and Features views each show a subset of the one list, so "move
 * up" means "past my neighbour in this view", expressed as the complete
 * order (every entry of `entries` exactly once) the lib's `reorderExtensions`
 * insists on. Entries outside the view keep their relative places. Returns
 * null when the move is impossible: `entry` is not in the view, or is already
 * at the edge it would move past.
 */
export function orderAfterMove(
  entries: ProjectExtensionEntry[],
  view: ProjectExtensionEntry[],
  entry: ProjectExtensionEntry,
  delta: -1 | 1,
): string[] | null {
  const at = view.findIndex((e) => e.use === entry.use);
  const neighbour = at < 0 ? undefined : view[at + delta];
  if (!neighbour) return null;
  const order = entries.map((e) => e.use).filter((u) => u !== entry.use);
  const slot = order.indexOf(neighbour.use);
  if (slot < 0) return null;
  order.splice(delta < 0 ? slot : slot + 1, 0, entry.use);
  return order;
}

export interface ExtensionStatus {
  label: string;
  kind: "ok" | "error" | "disabled" | "checking" | "stale";
  detail?: string;
  raw?: string;
}

/** The lib's "Not installed — …" / "Not pinned — …" notices on an npm entry
 *  whose vendored copy is absent: the one warning class with an in-app fix. */
const NEEDS_INSTALL_RE = /^not (installed|pinned)\b/i;

/**
 * Status text/icon for one configured feature row. Pure over its inputs —
 * the entry's own warnings, the current validation map (keyed by `use`), and
 * the in-flight flag.
 *
 * Precedence: a disabled entry reads Disabled whatever else is true; an npm
 * entry the lib reported as not installed / not pinned reads "Needs install"
 * with the in-app fix (ahead of any load-test result, which for such an entry
 * is only ever a less specific failure); then the load-test result.
 *
 * Tri-state (M34): `validating` is true only while a validate round-trip is
 * in flight. If it is `false` and there is still no result for this `use`,
 * the validate call threw (or never ran) — that must NOT read the same as "in
 * progress", since it will never resolve on its own. It gets its own "stale"
 * kind with a distinct label pointing at the fix (Re-check).
 */
export function extensionStatus(
  entry: ProjectExtensionEntry,
  validation: Record<string, ExtensionValidationResult>,
  validating: boolean,
): ExtensionStatus {
  if (!entry.enabled) return { label: "Disabled", kind: "disabled" };
  const needsInstall = entry.warnings?.find((w) => NEEDS_INSTALL_RE.test(w));
  if (needsInstall) {
    return {
      label: "Needs install",
      kind: "error",
      detail: `This project's downloaded copy is missing. Enter ${entry.use} under Install from npm below, then click Re-check.`,
      raw: needsInstall,
    };
  }
  const v = validation[entry.use];
  if (!v) {
    if (validating) return { label: "Checking…", kind: "checking" };
    return {
      label: "Check failed — click Re-check",
      kind: "stale",
      detail: "The last check didn't finish, so this extension's status is unknown. Click Re-check to try again.",
    };
  }
  if (v.ok) return { label: "Loads OK", kind: "ok" };
  return {
    label: "Error",
    kind: "error",
    detail:
      entry.kind === "npm"
        ? "This installed npm package couldn't load. See details below, then reinstall it or click Re-check."
        : "This extension couldn't load. See details below, then click Re-check.",
    raw: v.error ?? "Unknown load error",
  };
}
