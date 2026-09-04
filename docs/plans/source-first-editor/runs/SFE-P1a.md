# SFE-P1a — Shared editor contracts and package skeletons

## Objective

Create the smallest portable core shared by desktop, VS Code, and tests:
`packages/editor` (`@dimm-city/gutterpress-editor`) with the D3 source-edit
contract, D14 diagnostics, host interfaces, runtime validators, and a
framework-free mount shell — plus the `packages/vscode-extension` skeleton that
proves host portability from day one.

## Allowed behavior changes

- Two new private workspace packages (both **Experimental**, not published in this run).
- Root `bun.lock` updated by the integrator's `bun install`.

## Behavior that must remain unchanged

- `packages/cli`, `packages/desktop`, `packages/open-design-plugin`: untouched.
- No production consumer imports the new packages yet.

## Binding decisions

- **D1** — names `@dimm-city/gutterpress-editor` / `@dimm-city/gutterpress-vscode`;
  editor protocol version `1`; projection schema version `1`; offsets are UTF-16
  code units. Vocabulary: source, snapshot, source edit, projection, generated
  view, host, preview — one meaning each. `@vscode/markdown-editor` is NOT added
  in this run (that is P1b's decision gate).
- **D2** — exact Markdown source is the only authoritative document; no ProseMirror.
- **D3** — contract (final TypeScript in this run):

  ```ts
  interface DocumentSnapshot { readonly text: string; readonly version: number }
  interface SourceEdit { readonly from: number; readonly to: number; readonly insert: string; readonly expectedVersion: number }
  type ApplyEditResult =
    | { readonly ok: true; readonly snapshot: DocumentSnapshot }
    | { readonly ok: false; readonly reason: "stale" | "readonly" | "invalid-range"; readonly snapshot: DocumentSnapshot }
  ```

  Rules: `0 <= from <= to <= text.length`; `expectedVersion` must equal current;
  stale/invalid edits change nothing and return the current snapshot; hosts
  increment version exactly once per accepted edit or external replacement; all
  protocol messages runtime-validated at process/webview boundaries; no editor
  component writes files.
- **D4** — `packages/editor` imports NOTHING from Svelte, Electron, `vscode`,
  `node:*`, or desktop. Framework-free, browser-safe.
- **D7** — `EditorDocumentHost` owns snapshot/edits/replacements/persistence
  integration; `EditorProjectHost` owns project resolution/CSS/assets/trust/
  projection creation. Autosave/recovery/conflicts stay OUTSIDE `packages/editor`.
- **D14** — diagnostic categories: `EDITOR_STALE_EDIT`, `EDITOR_INVALID_RANGE`,
  `EDITOR_READONLY`, `EDITOR_FILE_TOO_LARGE`, `EDITOR_UNSUPPORTED_PROJECTION`,
  `EDITOR_PROJECTION_LIMIT`, `EDITOR_PLUGIN_UNTRUSTED`, `EDITOR_PLUGIN_LOAD_FAILED`,
  `EDITOR_CUSTOM_VIEW_UNAVAILABLE`, `EDITOR_HOST_DISCONNECTED`,
  `EDITOR_EXTERNAL_REPLACEMENT`.
- **D9** — extension registers `gutterpress.markdownEditor` as an OPTIONAL custom
  text editor; never the default for all Markdown.
- **Guardrails** — G-01 (source authority), G-04 (authored/generated/view-only are
  distinct types), G-11 (async results carry revision identity).

## Behavior table

| Case | Baseline | Required result | Diagnostic/state | Test owner |
|---|---|---|---|---|
| Accepted edit | n/a | Version +1, text spliced at `[from,to)`, snapshot returned | ok:true | A |
| Stale edit (`expectedVersion` mismatch) | n/a | Zero change; current snapshot returned | reason:"stale" + `EDITOR_STALE_EDIT` | A |
| Invalid range (from>to, to>length, negative, NaN, non-integer) | n/a | Zero change | reason:"invalid-range" + `EDITOR_INVALID_RANGE` | A |
| Readonly host | n/a | Zero change | reason:"readonly" + `EDITOR_READONLY` | A |
| External replacement | n/a | Full snapshot replace, version +1 exactly once, subscribers notified | `EDITOR_EXTERNAL_REPLACEMENT` | A |
| Malformed protocol message at boundary | n/a | Rejected by runtime validator, never partially applied | typed validation error | A |
| UTF-16 offsets | n/a | Edits inside surrogate pairs/emoji splice by code units exactly as JS `slice` | corpus test | A |
| Mount/dispose | n/a | `mount()` returns handle; `dispose()` releases listeners (no leaks on remount); no Svelte/Electron/vscode/node imports anywhere in the closure | memory-host test | B |
| Mount with memory host | n/a | Edits round-trip host→view; stale/readonly/invalid surface as diagnostics, not throws | memory-host test | B |
| Extension skeleton | n/a | `gutterpress.markdownEditor` provider registered on activation; standard Markdown passthrough stub; protocol version constant imported from `@dimm-city/gutterpress-editor` | unit test with mocked `vscode` | C |

## Lane ownership (Lane A runs FIRST, sequentially; B and C then run in parallel)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/editor/**` (package.json, tsconfig, `src/core/**`, `src/index.ts`, core tests, `scripts/check-browser-purity.mjs`) | other packages, root files | Contracts, diagnostics, validators, `MemoryDocumentHost`, package config with `typecheck`/`test`/`check:browser-purity` scripts |
| B | `packages/editor/src/web/**`, `packages/editor/tests/web/**` | `packages/editor/src/core/**`, `packages/editor/package.json`, other packages | Framework-free mount/dispose shell + memory-host integration tests (no Gutterpress projections yet) |
| C | `packages/vscode-extension/**` | other packages, root files | Extension skeleton: manifest, activation, no-op custom text editor provider, mocked-vscode unit tests, `typecheck`/`test` scripts |
| Integrator | root `bun.lock` (via `bun install`), `tools/architecture-baseline.json` if D4 rules need activation data | — | Install, wiring, milestone commits |

## Caller and consumer inventory

- `packages/vscode-extension` depends on `@dimm-city/gutterpress-editor`
  (workspace protocol/type imports only in this run).
- No existing package gains a dependency on either new package.

## Persistence and compatibility

- No published-package changes; both packages `"private": true` in this run
  (publishing decisions belong to later runs/release).

## Security and trust

- Runtime validators reject malformed messages at the boundary (never throw raw).
- No secrets, no filesystem access from `packages/editor`.

## Determinism and resource limits

- Core is pure and synchronous; no timers, no I/O, no ambient state.
- `applyEdit` is O(text length) worst case; validators are O(message size).

## Test plan

- Contract tests against `MemoryDocumentHost` covering the whole behavior table,
  including property-style randomized range cases (seeded, deterministic).
- Validator negative tests (fuzzy malformed payloads, prototype-pollution shapes).
- Browser-purity self-check: scan `packages/editor/src` for `node:`/builtin/
  svelte/electron/vscode imports (sabotage-proof self-test).
- Extension provider unit tests with a mocked `vscode` module.

## Review dimensions

- Is every interface at a real host boundary (memory/desktop/VS Code), nothing
  speculative (plan's abstraction rubric)?
- Can the memory host prove stale, readonly, invalid-range, and
  external-replacement behavior exactly as D3 words them?
- Does anything in `packages/editor` import a framework or Node builtin?
- Are the diagnostics the D14 names verbatim, with safe user-facing next actions?
- Do C's tests exercise the provider contract rather than mocking it into vacuity?

## Gate

> Never use `bun --cwd <pkg> run <script>` for any gate command below. On
> Bun 1.3.x that form prints the `bun run` usage banner and EXITS 0 without
> running the script at all — a gate reading only the exit code would report
> green having run nothing (verified on this tree with bun 1.3.11: both
> `bun --cwd packages/open-design-plugin run test` and
> `bun --cwd packages/desktop run test` exit 0 and print the usage banner,
> not test output). Use `cd packages/<pkg> && bun run <script>` or
> `bun --filter <pkg> run <script>` instead — see the identical NOTE at
> `.github/workflows/ci.yml` (added after this exact defect made the
> desktop-build and type-check CI steps silent no-ops). A gate command that
> produces no test or typecheck output is a failed gate, not a pass —
> record the actual test/type-check counts, not just the exit code.

- `bun install --frozen-lockfile` (integrator refreshes lockfile first)
- `bun run typecheck`
- `cd packages/editor && bun run typecheck`
- `cd packages/editor && bun run test`
- `cd packages/editor && bun run check:browser-purity`
- `cd packages/vscode-extension && bun run typecheck`
- `cd packages/vscode-extension && bun run test`
- `bun run check:architecture`
- `bun run test` (workspace — proves no regression elsewhere)

## Review log

- **Round 1** (adversarial review of `ebe2c24f..42189c13^`, four batches): 8 CONFIRMED
  findings — an applyEdit TOCTOU via accessor-backed edit objects; a disposed-mount
  re-entrancy hole; unproven dispose/class/invalid-range assertions; fabricated doc
  quotations in comments; a vacuous provider disposal test; a vacuously-passing,
  .svelte-blind purity checker; a dead CLI flag; and missing CI invocation of the new
  packages' gates (AP-20). All fixed in `42189c13` with sabotage verification.
  Verdict: **approve**, 0 confirmed remaining, 3 advisories (recorded in
  acceptance.md).
- **Gate**: PASS — all 13 commands exit 0 (both editor programs typecheck; editor
  118/0; extension 22/0; architecture/generated/knip green; desktop 2132/0;
  cli 1810/0).
