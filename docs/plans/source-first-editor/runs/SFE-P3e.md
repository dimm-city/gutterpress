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
| C | `packages/cli/package.json`, `packages/cli/src/plugins.ts` (new subpath barrel), `packages/cli/src/index.ts`/`src/api/index.ts` (only if the barrel needs them), the `build` script's entrypoints, `knip.json`, `packages/desktop/electron/editor-projection.ts`, `packages/desktop/tests/editor/editor-projection-host.test.ts`, `packages/desktop/tests/editor/real-book-plugin-*.test.ts` | `packages/desktop/src/**`, `packages/editor/**`, `tools/**`, everything else | Replace Lane A's duplicated local-file loader with the real one via the `gutterpress/plugins` subpath D11 already names |

| Integrator | `bun.lock`, wiring, commits | — | Install, verification, commits |

Lane C was added after the first phase reported (spec amended before it ran).
Its cause: Lane A could not call the real `loadPlugins`/`loadPluginsWithCss`
because the gutterpress package exports only `.`, `./api` and `./render` —
so, boxed in by its write boundary, it shipped a narrower duplicate loader
(local-file only, npm entries reported as failures). A second plugin loader
is exactly the duplication the product-owner ruling forbids, and its
local-file-only scope is a real behavior gap: a vendored npm plugin loads in
the preview but would fail in rich mode. D11 pre-approves the fix — the
`gutterpress/plugins` subpath, added now that it has a real consumer — after
which the duplicate is deleted and the desktop host calls the one loader the
preview uses, degrade-and-report mode included.

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

## Review log

### Round 1 — repair (6 CONFIRMED findings)

1. **The headline feature was inert in the app** — `rebuildRichDocHost`
   published `richDocHost` synchronously while the host projection arrived an
   IPC round trip later, so `{#key richDocHost}` mounted with
   `projection === undefined` and took `mountEditor`, never
   `mountGutterpressEditor` (`RichEditor.svelte` reads its props once in
   `onMount`, correctly — `$effect` is banned — so nothing ever remounted).
   This also regressed P3ab's marker chips, which had mounted only because
   the old projection was assigned in the same tick. Fixed by publishing
   host + projection + plugin CSS together inside the resolve callback,
   guarded by an epoch counter bumped on rebuild AND dispose; the template's
   existing loading branch covers the round trip.
2. **The parser-evidence gate was block-scoped, not caret-scoped** — "does
   any matching token exist in this block" accepted the CODE-SPAN occurrence
   of ``a real ![a](b.png) and a literal `![a](b.png)` sample`` (a regression
   vs. the deleted scanner). Fixed by reusing the pipeline's own per-token
   identity: `inline-source.ts`'s occurrence stamper is now exported
   (browser-safe via `gutterpress/render`) and the caret's candidate must
   match a real token's stamped `{token, occurrence}` exactly — no
   normalization involved at all, killing the `normalizeLink`-collision class
   by construction.
3. **New over-refusal in table cells** — `td_open`/`inline`/`td_close` carry
   no `.map`, so every image/link in a GFM table refused. Fixed by walking to
   the innermost mapped ancestor (the row) and collecting its inline tokens.
4. **The de-duplicated loader was re-duplicated at build level** —
   electron-vite externalized only the bare `'gutterpress'` string, so
   `gutterpress/render` and `gutterpress/plugins` were BUNDLED into
   `out/main/main.js` (827 KB). One-line fix: externalize
   `/^gutterpress(\/.*)?$/`; main.js dropped to 197 KB with all three
   specifiers external and zero inlined loader internals.
5. **Fixture docs described the deleted loader**, quoting a header that no
   longer exists — rewritten in all three places.
6. **Host-projection failure degraded silently** and D13's 2 MiB ceiling had
   no user-visible effect — both now surface typed diagnostics with the safe
   next action ("Switch to source mode").

### Round 2 — repair (2 not-fixed + 1 new defect from round 1's own fix)

- **Occurrence numbers were counted in two coordinate spaces** (candidate:
  whole document; stamp: the block's own `state.src`) — the false accept
  still reproduced, and ordinary repeated tokens across blocks now falsely
  refused. Fixed by resolving the enclosing container's absolute offset and
  counting both occurrences in the same string.
- **The `.code`-tagged thrown Error never crossed IPC** — Electron
  stringifies rejected `ipcMain.handle` errors, so round 1's branches were
  unreachable. Fixed by having `resolveEditorProjection` RESOLVE a
  discriminated `{ok:false, code, message}` outcome instead of throwing,
  threaded through the whole seam.
- **Round 1's deferred publication re-opened a fixed data-loss bug** — the
  cross-chapter `CommitEngine` path runs as a synchronous continuation of
  file selection; with `richDocHost` withheld across the round trip the
  commit fell through to `buf.edit`, invisible to the rich host, which then
  reverted it. Fixed by `richDocHostPending`: `selectEditorFile` awaits the
  projection round trip so the window closes instead of widening the seam.
  One existing structural test updated (it pinned the literal pre-fix source
  text `return editorFiles.select(path)`; intent preserved as
  `await editorFiles.select(path)`).

### Round 3 — repair (1 remaining)

- **The same inversion reproduced inside a GFM table row** (row-scoped
  counting vs. per-cell stamps). Fixed by one `InlineScope` per inline token:
  per-cell bounds recovered from each inline token's own `.content` — the
  exact string its stamp was computed against, so both occurrence numbers are
  counted in the same string by construction; recovery fails closed.

### Verdict

**approve** after round 3 — 0 confirmed remaining. Carried advisories, all
recorded rather than machined away, per the product-owner ruling: an escaped
pipe in a table row refuses every image/link in that row (fail-closed,
broader than necessary); per-cell scope recovery is positional string
matching, not a parser range; images inside a raw `html_block` now refuse
(fail-closed behavior change vs. baseline); a full-document reparse
(~80–105 ms at 250 KiB) runs per toolbar invocation on the UI thread; rich
mode feeds plugin code a slightly wider input set than the preview (unsaved
buffer content vs. saved files — same project, same trust decision); and
deleting the analyzer removes the ratchet that would catch a NEW
mutation-capable preview action added between now and P4 — accepted
explicitly by the ruling, and P4's own review re-verifies the matrix once,
at deletion time.

## Gate

PASS — all 16 commands exit 0: install; typecheck (4 workspaces); cli build
(render purity) + test (1913 pass / 60 skip); editor test (3038) +
test:browser (109 across 8 suites) + browser-purity (35 files); desktop test
(**6017 pass / 1 skip**), check (896 files / 0 errors), lint, build (render
purity, 145 files), and **electron:build** (added to this run's gate because
the review changed `electron.vite.config.ts` — `out/main/main.js` builds with
every `gutterpress` subpath external and passes `node --check`); architecture
(route ratchet 104 == 104); generated-files (1276 tracked); vendored (26
hashes / 33 files); knip.
