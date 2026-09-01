# ADR 0011 — Source-first editor: exact Markdown plus a sparse projection

Date: 2026-09-01 · Status: accepted · Implemented by: SFE-P1a, P1c, P2a, P2b, P2c

## Context

The prior rich-editor experiment (PR 158, superseded — see
`docs/plans/source-first-editor/pr158-lessons.md`) made ProseMirror the
active editing representation and regenerated Markdown from it on every
change. That created a second document model with its own schema, parser
adapter, and serializer, and a large share of that machinery existed only to
recover source fidelity a second model had no reason to lose in the first
place: entities, bullet style, attribute order, raw HTML, continuation
markers, reference definitions, and plugin wrappers all became
source-fidelity problems the moment a serializer stood between the author
and the file on disk.

Gutterpress markdown is also not CommonMark: the renderer stacks
`markdown-it-attrs`, `markdown-it-footnote`, `markdown-it-deflist`,
`markdown-it-source-map`, the `@marker` family (`markers.js`), `html: true`,
`typographer: true`, and arbitrary manifest plugins. A generic Markdown
document model has no way to represent that dialect without either dropping
information or growing Gutterpress-specific schema nodes — reproducing the
same second-model problem from a different direction.

## Decision

**Exact Markdown source is the only authoritative document** (plan D2). Every
other representation — the CodeMirror source view, the rich editor's DOM, the
Gutterpress projection, the paginated preview, outline, and diagnostics — is
a projection derived from that source and may be discarded and rebuilt at
any time.

- **The source-edit contract is `[from, to)` plus an expected version**
  (`DocumentSnapshot` / `SourceEdit` / `ApplyEditResult`, plan D3,
  `packages/editor/src/core/`). A stale or invalid edit changes nothing and
  returns the current snapshot; a command needing multiple changes returns
  one replacement over the smallest safe common range rather than a batch
  protocol. No ordinary edit serializes a semantic tree back into Markdown.
  Opening and closing a document without an explicit edit changes zero
  bytes — this is a hard product invariant (D2), not a best-effort goal, and
  is pinned by corpus byte-identity tests (P2a) across non-normalized valid
  Markdown.
- **`GutterpressProjection` (plan D6, `packages/cli/src/lib/markdown/`,
  exported from `gutterpress/render` as `createEditorProjection`) is not a
  second complete Markdown AST.** It carries only what the base source
  editor cannot already derive: `chapter` / `page` / `spread` / `section` /
  `page-break` / `column-break` / `plugin-region` / `raw-html` blocks, each
  with an exact source range, plus `GeneratedView`s (anchor only, no
  writable range) and typed `ProjectionDiagnostic`s. Every writable
  projected block's range comes from the configured markdown-it pipeline's
  own token maps, marker metadata, or a proven transform-origin record
  (P2c) — never from rendered-DOM ancestry, text equality, tag matching, or
  approximate line counts (G-05). An origin that cannot be proven produces a
  named diagnostic and a source-mode fallback instead of a guessed edit
  (G-06).
- **Resource limits are enforced, not aspirational** (plan D13): rich mode
  caps at 2 MiB (larger files open in source mode with a diagnostic),
  10,000 projected blocks, 1 MiB per inactive-HTML payload, 8 MiB aggregate
  generated/plugin HTML per document. Exceeding a cap fails closed to source
  mode or a safe placeholder; source stays editable regardless.
- **Plugin regions get two projections of the same source, not two document
  states** (G-07, P2c): inactive shows the plugin's own rendered HTML;
  active exposes source-aware editable interior while keeping the safe
  wrapper attributes; unsupported interiors stay read-only with an explicit
  source-mode action. The transition is derived from selection/activation,
  never stored as a second document.

## Consequences

- No `prosemirror-*`, Tiptap, or Milkdown dependency exists anywhere in the
  tree, and none is introduced by this design — there is no second document
  model for one to serialize.
- Projection creation is pure and re-derivable: it can be thrown away and
  rebuilt from source on every keystroke without correctness risk, which is
  what makes external-change handling (replace the snapshot, rebuild every
  derived view) simple rather than a merge problem.
- Editing precision is bounded by what the projection can prove a range for.
  Extending coverage (a new marker kind, a new plugin-origin case) is
  additive work on the projection, never a redesign of the source-edit core.
- The same contract is reusable by any host (desktop, VS Code, or a test
  harness) because it depends on nothing but a snapshot and an edit
  function — see ADR 0013 for how the desktop and VS Code hosts share the
  editor built on this contract.

## Alternatives rejected

- **A ProseMirror (or Tiptap/Milkdown) document model with a Markdown
  serializer** — PR 158's own approach; rejected because it makes every
  syntax detail the schema or serializer does not fully represent a
  source-fidelity bug, and requires project-wide "normalize on adoption" to
  make the resulting churn survivable (see `pr158-lessons.md` AP-01/AP-02/
  AP-03).
- **A full Gutterpress-specific AST alongside the base editor's model** —
  rejected by plan non-goal; a sparse projection covering only what the base
  editor cannot derive keeps the projection deletable when Chrome or the
  base editor eventually cover more of it natively (CLAUDE.md's "design for
  deletion" principle for shims applies here by the same logic).
- **Inferring plugin-region source ranges from rendered HTML shape** —
  PR 158 tried this and found real cases (consumed-and-replaced tokens,
  map-less close tokens, cross-region wrapper pairing) where the heuristic
  silently produced wrong or destructive edits (`pr158-lessons.md` §4.4,
  AP-05/AP-14). Ambiguity is a named refusal instead (G-06).
