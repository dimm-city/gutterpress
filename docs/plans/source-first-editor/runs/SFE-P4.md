# SFE-P4 — Delete preview editing and the mutation machinery

## Objective

Make the paginated preview read-only and delete everything that existed only
to mutate source from it: the in-flow `contenteditable` path, the block-edit
protocol, `InlineEditController`, `CommitEngine`, and the context menu's
mutation half. The parity gate (SFE-P3d-parity, conditions 1–5) is what
authorizes this; every deleted capability has a mapped, tested replacement in
`parity-matrix.md`.

## What must survive, byte-for-byte in behavior

D8's read-only preview: navigation, selection/copy, open link/image,
diagnostics, page controls, and source reveal ("go-to-source"). The
separability proofs from SFE-P3d-parity Lane C define this surface; the
tests that pin it must stay green through every deletion. `data-source-range`
survives — it serves navigation, source reveal, and editor threading (ADR
0009), not just mutation.

## Deletion targets (from `mutation-inventory.md`, which is the map)

- Book side (`packages/cli/src/assets/preview/scripts/`): the in-flow editing
  block in `preview-interface.js` (`startEdit`/`finishEdit`/`contenteditable`),
  `beginBlockEdit`/`endBlockEdit` command handling, the three block-edit
  events, `preview-shell.js`'s `beginBlockEdit` focus special case and
  `blockEditOpen` swap gating, `preview-bridge.js`'s block-edit event relays.
- Desktop side: `InlineEditController` and all its wiring (the context menu's
  `"block-edit"` item, the four `endActive(true)` call sites), `CommitEngine`
  + `commitRangePatch` + generation counter + gates, `ContextMenuController`'s
  mutation items and its private `commit()` (the read-only items and their
  `getContextTargetAt`-derived targeting stay), `PreviewClient`'s block-edit
  command/event surface and the TEST-ONLY `getContextTargetAt()` wrapper the
  inventory flagged, `context-menu-actions.ts`'s mutation-only exports IF
  nothing else consumes them — the caret-token commands now import several
  (`findImageWrapper`, `rewriteImageToken`, `rewriteLinkToken`, `spliceToken`,
  `resolveLinkToken`…): those MOVE or STAY as shared code, never get deleted
  with the file. Verify each export's real consumers before deciding.
- Tests that exist to pin the deleted behavior (the P0a characterization
  suites say in their own headers they die in P4) are deleted; tests that pin
  surviving behavior are kept and must not be weakened.

## Binding decisions

- **Deletion only.** No new features, no refactors beyond what the deletions
  force. Net LOC strongly negative.
- **D15 deletion proof:** every deletion claim needs search proof, dependency
  proof, and passing behavior tests. Required zero-occurrence searches (in
  production source and live tests — the docs/plans history and this spec
  keep the names): `InlineEditController`, `blockEditRequested`,
  `blockEditFinished`, `beginBlockEdit`, `endBlockEdit`, `CommitEngine`,
  `commitRangePatch`, the `contenteditable` authoring path in preview
  scripts.
- **Protocol honesty:** the preview protocol version bumps once; the shell's
  hot-reload swap logic loses its `blockEditOpen` gate cleanly (a swap can no
  longer destroy a live edit because live edits no longer exist).
- **The one-time proofs are one-time** (P3e ruling): recorded in the run
  close-out, not enshrined as a standing scanner.
- **ContextMenuController keeps working** for its read-only half with
  `commitEngine` and `openInlineEdit` REMOVED from its dependencies — this is
  the constructor-signature change P3d-parity's separability proof said P4
  owns.

## Lane ownership (SEQUENTIAL: B first, then A, then C)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| B | `packages/desktop/src/**`, `packages/desktop/tests/**` | `packages/cli/**`, `packages/editor/**`, docs | Desktop-side deletion: controllers, engine, wiring, affordances, and the desktop tests that pinned them |
| A | `packages/cli/src/assets/preview/scripts/**`, `packages/cli/src/preview/**` (only if it references the deleted protocol), `packages/cli/tests/**`, `packages/desktop/tests/preview-*.test.mjs`, `packages/desktop/tests/editor/preview-*.test.ts` (updating pins of the deleted book-side behavior) | other desktop source, `packages/editor/**` | Book-side deletion: contenteditable path, protocol messages, shell/bridge special cases; protocol version bump; embedded-bundle regeneration if applicable |
| C | `docs/**`, `docs/plans/source-first-editor/deletion-ledger.md` | production source | Docs statused, ledger totals updated, the zero-occurrence search proofs recorded |
| Integrator | commits, verification, P4c | — | PR 158 closure per the plan, ADR/doc statusing that needs judgment |

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/editor && bun run test && bun run test:browser && bun run check:browser-purity`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Review log

<!-- Appended by the review stage. -->
