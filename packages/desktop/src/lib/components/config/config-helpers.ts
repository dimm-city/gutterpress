/**
 * Pure, presentation-only helpers for the Looks & features tab (id
 * `extensions`) and its controller.
 *
 * Browser-safe strings/derivations with no host coupling — only `import type`
 * from `#lib/platform/dtos.ts`, so this module stays PWA-clean (§8). Kept out of
 * the controller and the component so bun can unit-test them without the
 * `$state` shim.
 */

import type {
  ProjectExtensionEntry,
  ExtensionValidationResult,
} from "#lib/platform/dtos.ts";

/**
 * Build the srcdoc for a look thumbnail iframe.
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
 * A look is an extension that carries styles and no markdown. A component
 * library ships styles too, but for its own markdown, not as the book's design.
 */
export function isLook(entry: ProjectExtensionEntry): boolean {
  return entry.carries.styles && !entry.carries.markdown;
}

/**
 * The badge per kind of thing an extension carries, in a fixed order — the
 * one list shows a look, a feature and a component library side by side, and
 * these say which is which. A component library's styles read "Styles", not
 * "Look" (`isLook`).
 */
export function carriedKinds(entry: ProjectExtensionEntry): string[] {
  const c = entry.carries;
  return [
    ...(c.markdown ? ["Feature"] : []),
    ...(c.styles ? [isLook(entry) ? "Look" : "Styles"] : []),
    ...(c.snippets ? ["Snippets"] : []),
    ...(c.components ? ["Components"] : []),
    ...(c.publish ? ["Publish destination"] : []),
  ];
}

/**
 * Split a feature description on its backtick spans — the lib writes "what to
 * type" that way ("Subscript text with `H~2~O`.") — so the template can set
 * those spans in code type instead of showing the raw backticks.
 */
export function describeSegments(description: string): Array<{ text: string; code: boolean }> {
  return description
    .split("`")
    .map((text, i) => ({ text, code: i % 2 === 1 }))
    .filter((segment) => segment.text !== "");
}

/**
 * The ids of the built-in looks a book still carries as COPIES: a path entry
 * at `./extensions/<id>`, the folder older Gutterpress versions copied a
 * built-in look into. A bundled look is listed by its bare name today, but a
 * book with such a copy must not be offered the same look a second time.
 */
export function addedBuiltInIds(entries: ProjectExtensionEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.kind !== "path") continue;
    const m = e.use
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .match(/^\.\/extensions\/([^/]+)$/);
    if (m) ids.add(m[1]!);
  }
  return ids;
}

/**
 * The full `use` order after moving `entry` one slot up (`delta` -1) or down
 * (+1) — the complete order (every entry exactly once) the lib's
 * `reorderExtensions` insists on. Returns null when the move is impossible:
 * `entry` is not in the list, or is already at the edge it would move past.
 */
export function orderAfterMove(
  entries: ProjectExtensionEntry[],
  entry: ProjectExtensionEntry,
  delta: -1 | 1,
): string[] | null {
  const order = entries.map((e) => e.use);
  const at = order.indexOf(entry.use);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= order.length) return null;
  [order[at], order[to]] = [order[to]!, order[at]!];
  return order;
}

export interface ExtensionStatus {
  label: string;
  kind: "ok" | "error" | "disabled" | "checking" | "stale";
  detail?: string;
  raw?: string;
  /** The in-app fix, when there is one: install a missing npm copy, or reinstall one that will not load. */
  fix?: "install" | "reinstall";
}

/** The lib's "Not installed — …" / "Not pinned — …" notices on an npm entry
 *  whose vendored copy is absent: the one warning class with an in-app fix.
 *  (Their text is the CLI's — `gutterpress ext add …` — so the desktop only
 *  matches it and never shows it.) */
const NEEDS_INSTALL_RE = /^not (installed|pinned)\b/i;

/**
 * Status text/icon for one configured extension row. Pure over its inputs —
 * the entry's own warnings, the current validation map (keyed by `use`), and
 * the in-flight flag.
 *
 * Precedence: a disabled entry reads Disabled whatever else is true; an npm
 * entry the lib reported as not installed / not pinned reads "Needs install"
 * with the in-app fix (ahead of any load-test result, which for such an entry
 * is only ever a less specific failure); then the load-test result.
 *
 * Tri-state: `validating` is true only while a validate round-trip is
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
      detail: "This book's downloaded copy is missing. Install it to download this version again.",
      fix: "install",
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
  if (v.ok) return { label: "Working", kind: "ok" };
  return {
    label: "Error",
    kind: "error",
    detail:
      entry.kind === "npm"
        ? "This installed npm package couldn't load. See details below, then reinstall it or click Re-check."
        : "This extension couldn't load. See details below, then click Re-check.",
    raw: v.error ?? "Unknown load error",
    ...(entry.kind === "npm" ? { fix: "reinstall" as const } : {}),
  };
}

/** A pre-release version (`1.2.0-alpha.2`)? Build metadata (`+…`) does not make one. */
const isPrereleaseVersion = (version: string): boolean => version.split("+")[0]!.includes("-");

/**
 * The versions a row's picker offers: the registry's published versions as
 * given (already newest first), stable only unless `includePrerelease`, and
 * ALWAYS the version the book pins — even a pre-release the toggle would hide —
 * so the select can show what is actually in use. A pin the registry no longer
 * lists (or a list that has not loaded) still appears, in its place by
 * position: first, as the newest thing we know of.
 */
export function pickerVersions(
  published: readonly string[],
  pinned: string | undefined,
  includePrerelease: boolean,
): string[] {
  const shown = published.filter((v) => v === pinned || includePrerelease || !isPrereleaseVersion(v));
  return pinned && !shown.includes(pinned) ? [pinned, ...shown] : shown;
}
