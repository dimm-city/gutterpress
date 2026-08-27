# SFE-P1c — Pure document session and desktop host adapter

## Objective

Separate the authoritative source lifecycle from Svelte presentation and
filesystem infrastructure: a pure TypeScript document-session state machine, a
desktop `EditorDocumentHost` adapter over it, and a thinned Svelte buffer layer
— with existing autosave, recovery, and external-conflict behavior preserved
byte-for-byte.

## Allowed behavior changes

- New modules `packages/desktop/src/lib/document-session/**` and
  `packages/desktop/src/lib/editor-host/**` (+ tests).
- `EditorBuffer` internals may delegate to the pure session; its public
  surface, observable phases, callback semantics, and timings stay identical.
- Editor command types may move from Svelte components into
  `packages/editor/src/core/commands.ts` (type-only relocation; desktop gains
  a `@dimm-city/gutterpress-editor` **workspace dependency** for type/value
  imports of the shared contract — the first sanctioned consumer edge).

## Behavior that must remain unchanged

- Every existing desktop test — especially
  `packages/desktop/tests/editor/buffer-state.test.ts`,
  `editor-file-session.test.ts`, recovery and platform suites — passes
  UNMODIFIED. They are the characterization net for this run.
- Autosave debounce (500 ms), recovery snapshot debounce (1000 ms), the
  clean/dirty/saving/error phase machine, external-change Reload/Keep-mine
  flow, flush-before-close, and file-switch semantics.
- CodeMirror source editing behavior.
- No change to preview, build, or any HTTP/IPC surface.

## Binding decisions

- **D7** — `EditorDocumentHost` owns snapshot/edits/replacements/persistence
  integration; autosave/recovery/conflicts are HOST responsibilities outside
  `packages/editor`. Desktop adapts its current session semantics through a
  narrow adapter. Only one editing surface mounts per document. Mode switches
  establish an undo epoch and never alter source.
- **D2** — exact source authority; the session state machine carries
  `DocumentSnapshot` semantics (version increments exactly once per accepted
  edit or external replacement).
- **D4** — no service locator in new code; the host adapter receives its
  dependencies explicitly (no `getPlatform()` inside the pure session).
- **CLAUDE.md §8** — `$effect` is banned; Svelte layer uses the sanctioned
  patterns. The pure session and host adapter are framework-free files
  (no `.svelte.ts` runes) so they are testable without the shim.

## Behavior table

| Case | Baseline | Required result | Owner |
|---|---|---|---|
| Pure session state machine | Logic embedded in `EditorBuffer` (`buffer-state.svelte.ts`) | `DocumentSession` pure class: snapshot+version, phase transitions (clean/dirty/saving/error), accepted edit, external replacement, flush intent, file switch — no Svelte, no I/O, no timers (time injected) | A |
| Phase parity | Pinned by `buffer-state.test.ts` | Session transitions reproduce the pinned semantics exactly; new unit tests assert the same transition table | A |
| Desktop host | none | `DesktopDocumentHost implements EditorDocumentHost` (from `@dimm-city/gutterpress-editor`) adapting the session + existing persistence callbacks; stale/readonly/invalid-range verdicts identical to the D3 memory host (Liskov: same contract tests pass against it) | B |
| Host contract substitutability | Memory host passes core contract tests | The SAME contract test suite (imported/shared, not copied) runs against `DesktopDocumentHost` with mocked persistence | B |
| Svelte thinning | `EditorBuffer` owns logic | `EditorBuffer` delegates state transitions to the session; its file shrinks; public API and reactive behavior unchanged (existing tests prove it) | C |
| Command types | Defined in/near Svelte components | Shared command union in `packages/editor/src/core/commands.ts` (D1 vocabulary; smallest union covering EXISTING desktop toolbar/source actions — no speculative commands); desktop imports it | C |
| Undo epoch | implicit | Mode-switch/file-switch undo boundary documented + asserted where current behavior already implies it (no new UX this run) | C |

## Lane ownership (Lane A FIRST, then B and C in parallel)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/desktop/src/lib/document-session/**`, `packages/desktop/tests/editor/document-session.test.ts` | `buffer-state.svelte.ts`, `packages/editor/**`, other packages | Pure session + transition-table unit tests |
| B | `packages/desktop/src/lib/editor-host/**`, `packages/desktop/tests/editor/desktop-document-host.test.ts`, `packages/editor/src/core/contract-tests.ts` (shared host contract suite, exported for reuse), `packages/editor/tests/core/contract-tests.test.ts` | `buffer-state.svelte.ts`, session files (Lane A's), other packages | Desktop host + shared contract suite green on memory AND desktop hosts |
| C | `packages/desktop/src/lib/editor/buffer-state.svelte.ts`, `packages/desktop/src/lib/editor/toolbar-actions.ts` (imports only), `packages/editor/src/core/commands.ts`, `packages/editor/src/core/index.ts` (export line), `packages/desktop/package.json` (add workspace dep) | tests (none may be edited), session/host files, other packages | Thinned buffer + shared command types + dep edge |
| Integrator | `bun.lock`, milestone commits | — | Install, wiring, commits |

## Caller and consumer inventory

- `EditorBuffer` consumers: `editor-file-session.svelte.ts`, `+page.svelte`
  (unchanged — the buffer's public surface is frozen this run).
- `packages/desktop` gains dependency `@dimm-city/gutterpress-editor`
  (workspace). Architecture Rule 4 must stay green (editor still imports
  nothing from desktop; the new edge points desktop→editor, the D4 direction).

## Persistence and compatibility

- Zero change to on-disk formats, recovery sidecars, autosave timing, or
  public contracts.

## Security and trust

- No new I/O paths; the pure session takes injected callbacks.

## Determinism and resource limits

- The session is synchronous and pure; timers/debounce stay in the host layer
  (existing code), injected as intent callbacks.

## Test plan

- Transition-table unit tests for the pure session (every phase × event).
- Shared host contract suite run against memory + desktop hosts (Liskov, D7).
- Full existing desktop suite unmodified and green (the real gate).

## Review dimensions

- Is the state machine genuinely independent of Svelte and I/O (grep for
  `$state`, `svelte`, `node:`, `getPlatform` in the new modules)?
- Are existing conflict/recovery semantics pinned and unchanged (existing
  tests untouched — verify via git diff)?
- Did source stay byte-identical through the refactor (no behavior change)?
- Is the desktop host substitutable for the memory host under the SAME
  contract tests (not a copied, weakened variant)?
- Is the command union the smallest covering existing actions (no speculative
  members — plan's abstraction rubric)?

## Gate

> Use `cd <pkg> && bun run <script>` — never `bun --cwd`.

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/editor && bun run test`
- `cd packages/desktop && bun run test`
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun run lint`
- `bun run check:architecture`
- `bun run knip`

## Review log

<!-- Appended by the review stage. -->
