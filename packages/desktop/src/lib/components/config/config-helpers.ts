/**
 * Pure, presentation-only helpers for Book setup's Look, Extensions and
 * Advanced tabs and their controllers.
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
 * Build the srcdoc for a look's sample page: a gallery thumbnail, or the Look
 * tab's live sample. It never scrolls; the frame shows its top.
 */
export function sampleSrcdoc(css: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;overflow:hidden;} body{padding:14px 16px;} *{box-sizing:border-box;}
${css}
</style></head><body>
<h1>Chapter One</h1>
<h2>The Harbor at Dusk</h2>
<p>The lamps along the quay came on one by one as the last boats rounded the
breakwater. Mara counted them from the window, the way her father had taught her.</p>
<blockquote>&ldquo;Every light is someone waiting to come home.&rdquo;</blockquote>
<h3>The Keeper&rsquo;s Log</h3>
<ul><li>Wind from the west, rising</li><li>Two boats still out</li></ul>
<p>She wrote the hour in the log, <code>18:42</code>, and turned to <a href="#">the next page</a>.</p>
</body></html>`;
}

/**
 * Where an entry comes from, in words for its Extensions row caption: "built in"
 * for a bundled name, "npm 1.2.3" (or "npm" while unpinned) for a package, and
 * "folder" or "file" and the path as written — minus a leading `./` — for one
 * the author owns (`folder extensions/clean-book`, `file plugins/x.js`).
 */
export function extensionSourceLabel(entry: ProjectExtensionEntry): string {
  if (entry.kind === "bundled") return "built in";
  if (entry.kind === "npm") return entry.version ? `npm ${entry.version}` : "npm";
  const where = entry.name.replace(/^\.\//, "");
  return `${/\.[cm]?js$/i.test(where) ? "file" : "folder"} ${where}`;
}

/**
 * A look is an extension that carries styles and no markdown. A component
 * library ships styles too, but for its own markdown, not as the book's design.
 */
export function isLook(entry: ProjectExtensionEntry): boolean {
  return entry.carries.styles && !entry.carries.markdown;
}

/**
 * Each kind of thing an extension carries, in words and a fixed order, for its
 * Extensions row caption — the list shows a look, an extra and a component
 * library side by side, and these say which is which. A component library's
 * styles read "Styles", not "Look" (`isLook`).
 */
export function carriedKinds(entry: ProjectExtensionEntry): string[] {
  const c = entry.carries;
  return [
    ...(c.markdown ? ["Extra"] : []),
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
 * `order` after moving `item` one slot up (`delta` -1) or down (+1): the whole
 * list, every item exactly once, which is what the lib's `reorderExtensions`
 * and a rewrite of the manifest's `styles:` both take. Returns null when the
 * move is impossible: `item` is not in the list, or is already at the edge it
 * would move past.
 */
export function orderAfterMove(order: string[], item: string, delta: -1 | 1): string[] | null {
  const at = order.indexOf(item);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}

/** The lib's "Not installed — …" / "Not pinned — …" notices on an npm entry
 *  whose vendored copy is absent: the one warning class with an in-app fix.
 *  (Their text is the CLI's — `gutterpress ext add …` — so the desktop only
 *  matches it and never shows it.) */
const NEEDS_INSTALL_RE = /^not (installed|pinned)\b/i;

/** What is wrong with one configured extension, and the in-app fix. */
export interface ExtensionProblem {
  label: string;
  /** The loader's own message, behind Show details. */
  raw?: string;
  /** Install a missing npm copy, reinstall one that will not load, or check again. */
  fix: "install" | "reinstall" | "check";
}

/**
 * What is wrong with one configured extension, or null when nothing is: a
 * working, switched-off or still-checking entry shows no status at all
 * (silence is success). Pure over the entry's own warnings, the load-test
 * results (keyed by `use`) and the in-flight flag.
 *
 * An npm entry the lib reported as not installed / not pinned is "Not
 * downloaded yet." with Install, ahead of any load-test result (for such an
 * entry that is only a less specific failure). A failed load is "Couldn't
 * load." with the loader's message, and Reinstall for npm or Check again for
 * anything else. A check that never finished (not `validating`, and still no
 * result) is not success either: it offers Check again.
 */
export function extensionProblem(
  entry: ProjectExtensionEntry,
  validation: Record<string, ExtensionValidationResult>,
  validating: boolean,
): ExtensionProblem | null {
  if (!entry.enabled) return null;
  if (entry.warnings?.some((w) => NEEDS_INSTALL_RE.test(w))) return { label: "Not downloaded yet.", fix: "install" };
  const v = validation[entry.use];
  if (!v) return validating ? null : { label: "Couldn't check it.", fix: "check" };
  if (v.ok) return null;
  return {
    label: "Couldn't load.",
    raw: v.error ?? "Unknown load error",
    fix: entry.kind === "npm" ? "reinstall" : "check",
  };
}
