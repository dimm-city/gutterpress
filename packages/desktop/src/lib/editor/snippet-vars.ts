/**
 * Snippet `{{variable}}` helpers (#29) — renderer-side mirror of the lib's pure
 * `snippets` functions.
 *
 * These are intentionally duplicated (a handful of lines, zero node deps) rather
 * than value-imported from `gutterpress`: §8 / ADR 0004 keeps the SPA
 * bundle free of the Node-target lib. The host (electron/main.ts) uses the lib's
 * copy for `listSnippets`; the renderer uses this copy to substitute values the
 * author typed into the prompt dialog before inserting at the cursor.
 */

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** Distinct `{{variable}}` names in first-seen order. */
export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  return order;
}

/**
 * Replace every `{{name}}` with `values[name]` (a missing key → empty string).
 * Non-placeholder braces are left intact.
 */
export function substituteVariables(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER_RE, (_full, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : "",
  );
}
