// Per-project lint rule levels (`lint.rules` in manifest.yaml) and the inline
// `gutterpress-disable-next-line` directive, shared by every check that reports
// a lint rule (printsafe's CSS rules, the markdown heading-order check).
//
//   lint:
//     rules:
//       printsafe/no-risky-print-effects: off      # off | warn | error
//
//   /* gutterpress-disable-next-line printsafe/page-containment -- reason */
//   <!-- gutterpress-disable-next-line source.accessibility.heading-order -->
//
// A rule id is the id the finding already carries: `printsafe/*` for CSS
// rules, the check id (e.g. `source.accessibility.heading-order`) for the
// rest. An id that matches no rule is ignored — nothing is looked up, so a
// stale entry costs nothing and a typo simply has no effect.

export type LintLevel = "off" | "warn" | "error";

/** Read one rule's configured level; unrecognised values are ignored. */
export function ruleLevel(
  rules: Readonly<Record<string, unknown>> | undefined,
  id: string,
): LintLevel | undefined {
  const v = rules?.[id];
  // YAML 1.1 readers turn a bare `off` into `false`; accept both spellings.
  if (v === "off" || v === false) return "off";
  if (v === "warn" || v === "warning") return "warn";
  if (v === "error") return "error";
  return undefined;
}

const DIRECTIVE = /^\s*gutterpress-disable-next-line\s+(.*?)\s*$/;

/**
 * The rule ids named by a `gutterpress-disable-next-line <id>[, <id>...]
 * [-- reason]` comment body (the text between the comment delimiters), or
 * null when the comment is not such a directive.
 */
export function parseDisableDirective(commentText: string): string[] | null {
  const m = DIRECTIVE.exec(commentText);
  if (!m) return null;
  const ids = m[1]!.split(/\s--(?:\s|$)/)[0]!.split(/[\s,]+/).filter(Boolean);
  return ids.length > 0 ? ids : null;
}
