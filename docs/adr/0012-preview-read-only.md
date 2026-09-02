# ADR 0012 — The paginated preview is read-only

Date: 2026-09-01 · Status: accepted · Implemented by: SFE-P4

> **Supersedes, in part:** [ADR 0009](0009-inline-editing-source-ranges.md)'s
> decision 3 (the `CommitEngine` clean-buffer/generation commit gate) and the
> v8 bridge-protocol addition folded into decision 5 (`beginBlockEdit`/
> `endBlockEdit` and their three events). ADR 0009's decisions 1-2
> (`data-source-range` carrying `token.map` verbatim; layout markers
> threading `token.meta.line`) are **not** superseded — they continue to
> serve navigation, source reveal, and editor threading unchanged, and ADR
> 0009 itself is not marked superseded (see its own 2026-09-01 status note,
> which cross-references this ADR).

## Context

Before the source-first rich editor existed, the paginated preview was the
only surface with in-flow editing affordances: `InlineEditController`
captured authoritative source and preview generation state,
`CommitEngine` validated chapter identity, buffer cleanliness, and expected
source before writing a patch, and the preview bridge protocol grew a
`beginBlockEdit`/`endBlockEdit` command pair plus three events
(`blockEditRequested`/`blockEditFinished`/`blockEditStateChanged`) to
support it (protocol v8; see ADR 0009 for the full mechanism this replaced).

That design put source-mutation logic in the one surface whose job is to
prove what the PDF will look like: the preview DOM is rendered from *saved*
content, so any live-typing state elsewhere (the source or rich editor) put
the preview's line/character indexing at risk of resolving against the
wrong occurrence of a repeated block — `CommitEngine`'s clean-buffer gate
existed specifically because no slice comparison can detect that
misalignment (ADR 0009 §3). Once a real rich editor exists with its own
source-edit contract (ADR 0011), the preview no longer needs to be a second,
harder-to-verify place authors mutate source from.

## Decision

**The preview is read-only** (plan D8). After rich-editor parity (P3), it
supports exactly: navigation, selection/copy, open link/image, diagnostics,
page controls, and source reveal (`go-to-source`, `image-reveal`,
`link-copy`, `selection-copy` — the four items the read-only context menu
keeps). Every context-menu action that used to change source either moved to
a rich/source editor command or was deleted outright; none survive as a
preview affordance.

`InlineEditController`, `CommitEngine`, the preview's context-menu mutation
finders (`findImageToken`/`resolveLinkToken`/`makeLinkToken`), and the
`beginBlockEdit`/`endBlockEdit` protocol pair with its three events were
deleted in P4, not deprecated in place — the plan's deletion policy is that
"compatibility code may not survive past its named deletion run." The
preview bridge protocol version advanced from v8 to v9 (`getProtocolVersion()`
now returns `9`, `packages/cli/src/assets/preview/scripts/preview-interface.js:754`)
to record the removal — the version number moved up, not down; "dropped"
here names what was removed from the protocol, not the direction the version
counter moved.
Shared image/link editing logic that both preview and the editors used
(`findImageWrapper`/`rewriteImageToken`/`rewriteLinkToken`/`spliceToken`/
`findImageTokenAtOffset`/`findLinkTokenAtOffset`, in
`context-menu-actions.ts`) survives — its real consumers are the rich/source
editor's shared command layer (`caret-token-commands.ts`), not the preview.

**Preview owns pagination; the rich editor does not have to reproduce it**
(plan D8). Exact pagination, print CSS, margin boxes, page furniture, and
PDF parity stay the preview's sole responsibility. The rich editor optimizes
writing and structural editing and is judged against the standards ADR 0011
sets, not against pixel-identical page layout.

**A PDF-preview mode is not a substitute for the live viewer.** Showing the
built PDF instead would make preview↔print fidelity tautological, but it
would defeat the live viewer's actual purpose — hot-reload editing, where a
word changed in the source or rich editor must appear immediately, not after
a PDF build. A PDF-preview inspection mode may be added later as an
*additional* way to check the final artifact; it must never replace the
live, editable-source-backed viewer (see root `CLAUDE.md`, "The preview is
not a PDF viewer").

## Consequences

- Only the rich/source editor's explicit source edits change bytes; the
  preview cannot be a second, less-verified write path into a project's
  Markdown.
- The preview↔print parity gate
  (`scripts/native-parity-gate.ts`) stays meaningful specifically because
  the preview no longer mutates the DOM it measures against print —
  divergence it reports is real divergence, not an artifact of an in-flight
  edit.
- Deleting the mutation machinery removed an entire class of "stale conflict
  state" bugs from the preview (~6,700 net lines across production and
  tests, deletion-ledger "SFE-P4" entry) without weakening what a
  non-technical author can do in preview: the four read-only actions D8
  keeps cover navigation and copy, and everything else routes to an editor
  that already has a verified source-edit contract (ADR 0011).
- One residual from this deletion is tracked, not silently dropped: the
  `data-gp-source-token`/`data-gp-source-occurrence` HTML attributes
  `inline-source.ts` still emits (and `preview-interface.js` still reads
  into `contextMenuRequested` payloads) have no remaining consumer now that
  `findImageToken`/`resolveLinkToken` are gone — recorded as a named,
  scoped follow-up in the deletion ledger's SFE-P4 section rather than
  claimed done under the wrong lane's authority.

## Alternatives rejected

- **Keep in-flow preview editing alongside the rich editor** — rejected by
  plan D8/AC-13; two editable surfaces showing the same content
  (`pr158-lessons.md` AP-16/AP-17) means either duplicated authoring logic
  or a preview that lags the editor's real command vocabulary, and the
  clean-buffer gate's fragility (ADR 0009 §3) is a cost worth paying only
  while there is no other write path.
- **Replace the live viewer with a rendered-PDF preview** — rejected as a
  default; it collapses preview↔print parity into a tautology and removes
  hot-reload editing, the viewer's whole reason to exist as PERMANENT
  tooling (root `CLAUDE.md`'s "Boundary rulings"). Left open as a possible
  additional inspection mode, never a replacement.
