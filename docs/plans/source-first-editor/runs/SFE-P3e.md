# SFE-P3e — Plugins in the rich editor for real, and machinery removal

## Product-owner ruling (2026-08-31)

Recorded verbatim in effect: the rich editing surface without plugin regions
is a failure — "that is 90% of the feature" — and the program has been adding
defensive machinery for scenarios that may never happen. The correction is
binding on this run and everything after it:

1. **Fix remaining issues at the root.** The desktop rich editor must build
   its projection plugin-aware through the real pipeline — not have the gap
   recorded as an advisory.
2. **Simplify instead of adding machinery.** Prefer deleting cleverness to
   guarding it. A standing static-analysis gate over a surface P4 deletes is
   machinery we do not need; a hand-rolled markdown scanner next to the real
   parser is machinery we do not need.

This ruling supersedes SFE-P3d-parity's "derived, not hand-listed" standing-
gate requirement (a spec-level choice of this program, not a plan decision)
and answers that run's condition 5: the stakeholder-designated blocker is the
plugin wiring this run closes.

## Objective

Two deliverables, one per lane:

- **A — the feature.** A chapter in a plugin-using project, opened in the
  desktop's rich mode, shows its plugin regions: the projection is built
  host-side with the project's plugins loaded by the real loader and
  `trusted`, and the plugins' CSS reaches the mount. Proven end-to-end on a
  real project fixture with a real local-file plugin — production code the
  whole way.
- **B — the deletion.** The check-parity analyzer and the hand-rolled
  literal-region scanners are removed; what remains is the evidence that has
  behavioral value (the tests, the matrix as a point-in-time record) and one
  question to the real parser.

## Root causes, so the fixes are the small ones

- **Feature:** `+page.svelte`'s `buildRichProjection` calls
  `createEditorProjection(content, { sourceVersion })` — no `md`, no
  `trusted`. Everything else already exists: `loadPlugins`/`loadPluginsWithCss`
  (host, Node, degrade-and-report mode), `createMarkdownRenderer`/
  `applyPlugins`/`collectPluginCss` (exported browser-safe but usable in
  main), `createEditorProjection(content, {sourceVersion, md, trusted})`
  (plugin-aware since P2c), and `RichEditor.svelte` already forwarding
  `projection` and `extraCss` to `mountGutterpressEditor`. The missing piece
  is one host call and one renderer call site.
- **Machinery:** `tools/check-parity.mjs` reimplements a TypeScript parser in
  regexes to guard a surface P4 deletes next run (and errors on the very
  deletion it authorizes). `caret-token-commands.ts` reimplements markdown
  block classification (three scanners plus fence-prefix stripping) beside a
  repo that ships the real parser in its browser-safe render graph.

## Binding decisions

- **Transport is typed IPC, not a new HTTP route.** The desktop route ratchet
  (104) forbids new routes and D10 migrates request/reply to typed IPC anyway;
  adding this as a route would create P5 work. One `secureHandle` channel with
  runtime-validated arguments (D10: "runtime validation is required at every
  IPC request boundary"), following `api:preview`/`api:build`'s existing
  pattern. This is a recorded D10-consistent exception to CLAUDE.md §8's
  route-first default, chosen because the route surface is frozen.
- **Trust (D12):** in the desktop, an opened project is the trust decision —
  the preview already executes that project's plugins on exactly that basis.
  The host builds `trusted: true` projections for the open project and no new
  trust machinery is added. (VS Code workspace trust remains P3c's concern.)
- **Degrade-and-report, like the live preview:** a plugin that fails to load
  is skipped with a diagnostic that reaches the editor's `onDiagnostic`
  (`EDITOR_PLUGIN_LOAD_FAILED`); it must not blank the projection or the
  document (§5's rationale: one uninstalled plugin must not blank a
  non-technical author's preview — the same holds for their editor).
- **One renderer path:** with a project open on the desktop, the projection
  comes from the host; with no project (plain file), the existing local
  plugin-less build stays. No third path, no cache layer, no speculative
  invalidation machinery — rebuilds happen at the existing
  `rebuildRichDocHost` points, not per keystroke.
- **The parser is the authority (G-05, restated for deletion):** "is the
  caret on a real image/link token" is answered by whether the real
  markdown-it pipeline produces that token for the enclosing block — one
  rule that subsumes fenced, indented, blockquoted, list-nested and
  inline-code cases without a bespoke scanner for each.

## Behavior table

| Case | Required result | Owner |
|---|---|---|
| End-to-end plugin regions | A real project fixture with a real **local-file plugin** (`plugins: ["./plugins/….js"]` — supported by the manifest schema), loaded by the REAL `loadPlugins`, produces a projection whose `plugin-region` blocks appear through the DESKTOP's own host call — no hand-built `md`, no injected plugin functions | A |
| Renderer wiring | `buildRichProjection` uses the host projection when a project is open; plugin CSS reaches the mount as `extraCss`; the no-project path is unchanged | A |
| Degradation | A manifest naming an uninstalled npm plugin or a broken local plugin yields a projection WITHOUT that plugin plus an `EDITOR_PLUGIN_LOAD_FAILED` diagnostic surfaced through `onDiagnostic` — never a blank editor, never a silent omission | A |
| IPC validation | The channel rejects malformed arguments (wrong types, non-finite version, absent project) with typed errors; oversized content respects D13's 2 MiB rich-mode ceiling | A |
| Staleness | A projection answered for version N against a document now at N+k falls through exactly as the mount's existing G-11 contract dictates — no new mechanism | A |
| check-parity removal | `tools/check-parity.mjs`, `tools/check-parity.test.mjs`, the root `check:parity` script and both CI steps are deleted; `parity-matrix.md` is retitled a point-in-time evidence record naming the verifying commit and the behavioral tests, which all remain | B |
| Caret-token simplification | The three literal-region scanners and fence-prefix stripping are replaced by parser evidence: refuse unless the enclosing block is prose whose inline token stream contains a matching image/link token. The real-book case (`design-guide/05-layout.md`'s code sample) must still refuse; the over-refusal advisory's two ordinary shapes should now resolve | B |
| No behavior regressions | Every existing byte-exactness, refusal and staleness test for the caret commands still passes (updated only where they pinned the deleted mechanism's message text) | B |

## Lane ownership (A and B in parallel — disjoint)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/desktop/electron/**`, `packages/desktop/src/routes/+page.svelte`, `packages/desktop/src/lib/platform/**`, `packages/desktop/tests/fixtures/plugin-book/**`, `packages/desktop/tests/editor/real-book-plugin-*.test.ts`, new `packages/desktop/tests/editor/editor-projection-host.test.ts` | `packages/cli/**`, `packages/editor/**`, `packages/desktop/src/lib/editor/**`, `tools/**`, `docs/plans/source-first-editor/parity-matrix.md` | Host-built plugin-aware projection, wired and proven end-to-end |
| B | `tools/check-parity.mjs` (delete), `tools/check-parity.test.mjs` (delete), root `package.json`, `.github/workflows/ci.yml`, `docs/plans/source-first-editor/parity-matrix.md`, `packages/desktop/src/lib/editor/caret-token-commands.ts`, `packages/desktop/tests/editor/parity-caret-token-*.test.ts` | `packages/desktop/electron/**`, `+page.svelte`, `packages/desktop/src/lib/editor/toolbar-actions.ts`, `rich-commands.ts`, other lanes' tests | The deletions and the parser-evidence rewrite |
| Integrator | `bun.lock`, wiring, commits | — | Install, verification, commits |

Lane A may update the plugin-book fixture's manifest from the uninstallable
npm reference to a real local-file plugin, and adjust the three
`real-book-plugin-*.test.ts` files to load it through the real pipeline —
that is the point of the fixture change, and those files are in its list.

## Review dimensions

- Does the end-to-end proof actually traverse the IPC-reachable host code
  path, or does it re-test `createEditorProjection` with extra steps?
- Can a plugin-load failure blank the editor or vanish silently?
- Does the renderer stay PWA-clean (no new host imports; `bun run build`'s
  purity gate)?
- Did the caret-token rewrite change any refusal outcome the tests pinned for
  a real reason, and does `05-layout.md` still refuse?
- Is anything left of the deleted machinery — scripts, CI steps, doc claims,
  stale comments describing it?
- Net line count of the run: it should be strongly negative outside the
  feature lane.

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/editor && bun run test && bun run test:browser && bun run check:browser-purity`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Review log

<!-- Appended by the review stage. -->
