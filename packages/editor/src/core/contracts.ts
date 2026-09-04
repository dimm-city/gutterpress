/**
 * D3 — Source-edit and binding contract.
 *
 * These shapes are BINDING and VERBATIM from
 * docs/plans/source-first-editor-enterprise-refactor.md (D1, D3) and
 * docs/plans/source-first-editor/runs/SFE-P1a.md. Do not add fields, rename
 * members, or change the `reason` union without an explicit decision-record
 * amendment — hosts across desktop, VS Code, and tests all reject
 * identically against this exact shape.
 *
 * Vocabulary (D1 — one meaning each, used consistently across this package):
 *   source      — exact Markdown string.
 *   snapshot    — source plus monotonic document version.
 *   source edit — explicit [from, to) replacement against an expected version.
 *   host        — desktop, VS Code, or test implementation of the document
 *                 boundary (see hosts.ts).
 * Do not use "rich document", "canonicalized source", or "normalized editor
 * document" to describe authoritative state (D1).
 */

/**
 * Editor protocol version (D1). Every protocol message this package's
 * runtime validators accept is versioned against this constant. Bump only
 * via an explicit decision-record amendment — never silently.
 */
export const EDITOR_PROTOCOL_VERSION = 1 as const;

/**
 * Gutterpress sparse-projection schema version (D1/D6). Not yet produced by
 * this run (projection creation lands in P2b) — declared here now because
 * D1 fixes its value as part of the shared vocabulary every later run must
 * agree on.
 */
export const PROJECTION_SCHEMA_VERSION = 1 as const;

/**
 * The authoritative document: exact Markdown source plus a monotonically
 * increasing version (D2: "Exact Markdown source is the only authoritative
 * document"). No editor-owned value ever exists outside a snapshot returned
 * by a host.
 */
export interface DocumentSnapshot {
  readonly text: string;
  readonly version: number;
}

/**
 * An explicit `[from, to)` replacement against an expected document
 * version. Offsets are UTF-16 code-unit offsets (D1), matching JavaScript's
 * own `String` indexing and VS Code's offset model — `applyEdit` (see
 * apply-edit.ts) splices with `text.slice(0, from) + insert + text.slice(to)`
 * by construction, so surrogate-pair/code-point boundaries are never
 * special-cased.
 */
export interface SourceEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly expectedVersion: number;
}

/**
 * Result of applying a `SourceEdit` (D3). On failure, `snapshot` is the
 * CURRENT, unchanged snapshot — never a partial application and never the
 * caller's proposed edit echoed back. `reason` has exactly three values;
 * see apply-edit.ts for the binding check order that produces each one.
 */
export type ApplyEditResult =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot }
  | {
      readonly ok: false;
      readonly reason: "stale" | "readonly" | "invalid-range";
      readonly snapshot: DocumentSnapshot;
    };
