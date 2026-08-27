# SFE-P0b — Architecture Fitness Function Guardrail Catalog

> Lane C deliverable for run `SFE-P0b` (see
> `docs/plans/source-first-editor/runs/SFE-P0b.md`, behavior-table row "Knip
> exemption audit," owned by Lane C).
>
> Purpose: one catalog of every architecture fitness function now protecting
> this repository — what it protects, how it runs, where its sabotage
> (deliberate-failure) proof lives, and which future plan phase changes or
> retires it. Guardrail G-12 / anti-pattern AP-20
> (`docs/plans/source-first-editor/pr158-lessons.md`) require every gate to
> prove it ran and prove it can fail; this document is the index a reviewer
> uses to find that proof without re-deriving it per run.
>
> Companion section 2 below is the knip exemption audit this run performed:
> every `knip.jsonc` entry/ignore line, checked against the current tree.
> Section 3 is the P5 knip-exemption removal checklist, cross-referencing
> `docs/plans/source-first-editor/platform-inventory.md` §14.

---

## 1. Fitness function catalog

| Check | What it protects | How invoked | Sabotage proof | Plan phase that changes/retires it |
|---|---|---|---|---|
| `tools/check-render-purity.mjs` | CLAUDE.md §8: the desktop SPA client bundle must value-import only `gutterpress/render` and stay free of host/Node code (named leak identifiers, quoted `node:*` specifiers, bare builtin `require`). Pre-existing, not an SFE-P0b deliverable. | `node tools/check-render-purity.mjs [buildDir] [--strict]`; CI `build` job step "Check renderer purity (CLAUDE.md §8)" scans `packages/desktop/build/client --strict` after the desktop build step; the desktop app's own `npm run build` also runs it with `--strict`. | `tools/check-render-purity.test.mjs`, run standalone (`node tools/check-render-purity.test.mjs`) and as its own CI "Check renderer purity self-test" step immediately before the real gate — the convention this run's two new checks (below) copy. | Not directly retired by any SFE phase. D10/P5d removes `@sveltejs/adapter-node` and the `build/server` vs `build/client` split the `--strict` scope depends on; the gate's `buildDir` argument and scope comment will need re-deriving against whatever the post-P5d static-SPA build emits. Until P5d lands, unaffected. |
| `tools/check-generated-files.mjs` (Lane A, this run) | SFE-P0b's hygiene requirement: regenerated build output (`.svelte-kit/`, `build/`, `out/`, `*.tsbuildinfo`, `packages/*/dist/`) must never be tracked in git — the exact failure the 7 tracked root `.svelte-kit/` files demonstrated at baseline. | `node tools/check-generated-files.mjs [--root <path>]`. Root script (`bun run check:generated-files`) and CI `build`-job step are **integrator-owned, not yet wired** as of this run (see §1a below) — the run spec assigns root `package.json` + `.github/workflows/ci.yml` to the integrator. | `tools/check-generated-files.test.mjs` (`node tools/check-generated-files.test.mjs`) — 12 assertions against temp-dir git fixtures, covering all 5 patterns, `--root` scoping, and the 2/usage-error path. Verified green in this run (see §4). | No SFE phase retires this — generated-output hygiene is permanent. The pattern list could grow if a future build tool introduces a new output directory shape; that is a maintenance addition, not a phase-triggered retirement. |
| `tools/check-architecture.mjs` (Lane B, this run) | Plan D4 (module ownership/import direction, no service locator), D10 (desktop HTTP route ratchet — no new route during P5), and the Lane rules ban on ProseMirror/Tiptap/Milkdown dependencies. Four independent rules, each with its own PASS/FAIL/SKIP/WARN line. | `node tools/check-architecture.mjs [--root <path>]`. Root script (`bun run check:architecture`) and CI `build`-job step are **integrator-owned, not yet wired** as of this run (see §1a below). | `tools/check-architecture.test.mjs` (`node tools/check-architecture.test.mjs`) — 26 assertions: prosemirror-family deps in `package.json`/`bun.lock`/imports; route-ratchet over/under baseline and missing-baseline error; cli→desktop and desktop→cli import-direction violations in both bare-specifier and relative-path form; the future-package rules for a fake `packages/editor` and `packages/vscode-extension` (including the AP-21 liveness-WARN case for a present-but-empty `src`). Verified green in this run (see §4). | Rule 2's ratchet number in `tools/architecture-baseline.json` (currently 104) is lowered every time P5c deletes desktop HTTP routes, reaching 0 after P5d — at that point Rule 2 could be simplified or retired (nothing left to ratchet). Rule 4 activates its `packages/editor` branch once P1a creates that package, and its `packages/vscode-extension` branch once that package exists (per D9). Rules 1 and 3 are permanent (Lane rules ban + D4 import direction do not expire). |
| `packages/cli/scripts/check-render-pure.mjs` | CLAUDE.md Monorepo layout: `src/render.ts` is built as a separate non-split `bun build` graph so the node-free `gutterpress/render` subpath never shares a chunk with Node code (the 2026-07 shared-chunk `createRequire` regression). Bans any relative import, any Node builtin specifier, and `createRequire` inside `dist/render.js`. Pre-existing, not an SFE-P0b deliverable. | `node scripts/check-render-pure.mjs`, run from `packages/cli` as part of the `build:library` script chain (`bun run build:library` / `bun run build`), which CI's `build` job invokes via "Build CLI npm bundle" (`bun run build`, working-directory `packages/cli`). | No dedicated `.test.mjs`. Its proof is structural: the CLI build step hard-fails (non-zero exit propagates through the `&&`-chained `build:library` script) if `dist/render.js` contains a banned pattern, so a reintroduced shared-chunk leak cannot pass CI silently — but this does not meet the G-12 fixture-sabotage bar the two new SFE-P0b tools meet. **Advisory, not remediated by this run**: `scripts/**` under `packages/cli` is out of Lane C's write ownership for this run. | Plan D4 makes `packages/editor` a second consumer of `gutterpress/render` (P1a onward), which raises this gate's stakes rather than retiring it — a regression here would now break the shared editor mount too, not only the desktop SPA. No SFE phase removes it. |
| Knip gate (`knip.jsonc` + root `knip` script) | Dead-code/dependency hygiene repo-wide; specifically documents (via the annotated PWA-scaffolding exemption, §2 below) which desktop platform-seam files are intentionally kept alive pending D10's P5a/P5b/P5d deletions, so knip does not flag them as false-positive dead code while they are still load-bearing. | `bun run knip` (root script: `(cd packages/desktop && bunx svelte-kit sync) && knip --include files,dependencies,unlisted,binaries`); CI `build` job step "Check for unused files/dependencies (knip)", gated before the build steps. | No `.test.mjs` — knip itself is the third-party tool under test; its "sabotage proof" is structural: any of the exempted files being genuinely deleted without updating `knip.jsonc` immediately fails the gate (a stale entry referencing a removed file/glob is not itself a failure mode knip reports, which is exactly why this run's manual audit — §2 — exists instead of relying on knip to self-detect it). | The PWA-scaffolding exemption lines shrink at P5a (removes `web-store.ts` and the `service-worker.{ts,js}` entry) and at P5d (removes `src/lib/api.ts`); P5b may further narrow or remove the remaining `index/contract/dtos/shared-types.ts` line. See §3. |
| Preview↔print parity gate (`packages/cli/scripts/native-parity-gate.ts`) | CLAUDE.md's Chromium-only/print-fidelity rule: "the preview↔print parity gate is what proves it [the viewer] still agrees with the PDF — and it must stay green with an empty allowlist." Compares the in-browser viewer fragmenter against Chromium's `printToPDF` measurement for page count, per-id page mapping, `target-counter()` resolution, and per-heading page mapping. | `bun scripts/native-parity-gate.ts`, run from `packages/cli`; CI `test` job step "Preview/print parity gate" (working-directory `packages/cli`). Root `package.json` script `parity:gate` in `packages/cli/package.json` (not root — pre-existing). | No dedicated `.test.mjs`. Self-proving by construction: `KNOWN_DIVERGENCES` is an explicit allowlist that is empty today (verified in this run, §4); any unlisted divergence fails the run (exit 1), and — the sabotage-relevant half — an allowlisted divergence that stops reproducing *also* fails the run (forcing the allowlist entry to be deleted rather than surviving as a stale exemption, per AP-32). | D8 keeps preview as the exact-pagination/PDF-parity authority through the whole SFE effort — this script's scope (preview vs. print) is not expected to change. P2d/P3 add sibling parity tools for different questions (rich-editor-vs-preview, revision-diff, cross-browser — pr158-lessons.md G-08/AP-23) rather than modifying this one. P4 removes preview's own mutation capabilities but not its pagination-authority role this gate measures. |

### 1a. Wiring status as of this run

`tools/check-generated-files.mjs` and `tools/check-architecture.mjs` (with
their `.test.mjs` self-tests and `tools/architecture-baseline.json`) already
exist in the working tree — Lanes A and B landed them concurrently with this
run. Root `package.json` has no `check:generated-files` or `check:architecture`
script yet, and `.github/workflows/ci.yml` has no step invoking either tool.
Per the run's lane-ownership table, both root `package.json` scripts and CI
`build`-job steps are **integrator-owned**; this run verified both tools
directly (`node tools/check-generated-files.mjs`, `node
tools/check-architecture.mjs`, plus their `.test.mjs` files — §4) since the
root scripts the run's own Gate section names (`bun run
check:generated-files`, `bun run check:architecture`) do not exist yet.
**Wired by integrator** — not a Lane C deliverable.

---

## 2. Knip exemption audit

Every `knip.jsonc` entry/ignore/exemption line was checked against the
current tree. Result: **all are still load-bearing; nothing was provably dead
today; nothing was removed.** Two exemption comments tied to the SFE plan's
PWA-scaffolding deletion were annotated with their deletion phase, per the
run spec's example. No entry outside the PWA-scaffolding block is tied to any
SFE plan phase — those are ordinary, permanent repository conventions
(engine bundle entrypoints, self-registering check modules, Playwright compat
suite, the open-design-plugin fixture-tree exclusion, the `pdftoppm` external
tool) and were left as-is once verified current.

| Line | Verification | Result |
|---|---|---|
| root `entry: ["tools/*.mjs"]` / `project` | `ls tools/*.mjs` — 11 files present, all real, all match the glob. | Load-bearing, unchanged. Not SFE-tied. |
| root `ignore: ["packages/open-design-plugin/**"]` | `ls packages/open-design-plugin` — directory exists with `docs/`, `plugin/`, `plugin.test.ts`, `test-fixtures/`, matching the comment's description. | Load-bearing, unchanged. Not SFE-tied. |
| root `ignoreBinaries: ["pdftoppm"]` | `grep -n pdftoppm tools/page-background-mechanism.mjs tools/page-background-repro.mjs` — both files exist and both invoke `pdftoppm` via `execFileSync`. | Load-bearing, unchanged. Not SFE-tied. |
| `packages/cli` entries: `src/cli.ts`, `src/index.ts`, `src/api/index.ts`, `src/render.ts`, `src/engine/viewer/global.ts`, `src/engine/compiler/agent.ts`, `src/engine/dev-cli.ts` | Existence check on each named path — all present. `grep -n "viewer/global\|compiler/agent" packages/cli/scripts/build-engine-bundles.mjs` confirms the comment's claim that both are its `Bun.build` entrypoints. | Load-bearing, unchanged. Not SFE-tied. |
| `packages/cli` entry: `tests/compat/*.pw.ts` | `ls packages/cli/tests/compat/*.pw.ts` → `preview-smoke.pw.ts` exists; `grep -n "compat/playwright" .github/workflows/preview-smoke.yml` confirms the CI reference the comment names. | Load-bearing, unchanged. Not SFE-tied. |
| `packages/cli` entry: `src/checks/{asset,heuristic,pdf,source}/*.ts` | `ls` on all four directories — populated with real check modules matching the comment's self-registration description. | Load-bearing, unchanged. Not SFE-tied. |
| `packages/desktop` entry: `src/service-worker.{ts,js}` | `[ -f packages/desktop/src/service-worker.ts ]` — present. D10 names it for P5a deletion; platform-inventory.md §13 confirms it as PWA-only. | **Load-bearing today, SFE-tied.** Annotated with "P5a deletes this entry" (previously uncommented). |
| `packages/desktop` entry: `src/lib/platform/{index,contract,dtos,shared-types,web-store}.ts`, `src/lib/api.ts` | All 6 named files exist (`index.ts`, `contract.ts`, `dtos.ts`, `shared-types.ts`, `web-store.ts`, `api.ts`). `WebAdapter` (`packages/desktop/src/lib/platform/web-adapter.ts`) still exists and is still referenced from `contract.ts`/`index.ts`/`web-fs.ts`/`web-store.ts`; `getPlatform()` has 18 call-site files, `isDesktop()` has 27 — both still widely used in production code, confirming these exports are not dead today. | **Load-bearing today, SFE-tied.** Comment expanded per-file with exact deletion ties from platform-inventory.md §14 (§3 below). |
| `packages/desktop` entry: `src/routes/**/+*.{ts,svelte}`, `tools/*.mjs`, `tests/**/*.{ts,js,mjs}`, `src/**/*.type-test.ts` | Generic globs; `src/**/*.type-test.ts` comment ("compile-time type assertion gates … type-checked by svelte-check") verified against the pattern's presence in `project` scope. | Load-bearing, unchanged. Not SFE-tied. |

**`bun run knip` before and after these edits: exit 0 both times** (see §4)
— the annotations are comment-only; no glob, ignore, or entry value changed,
so behavior is unaffected by construction. No entry was removed, matching
the run's constraint: "Do NOT remove anything whose removal depends on P4/P5
deletions" — nothing surviving in `knip.jsonc` today depends on a deletion
that hasn't happened yet without already carrying that tie documented.

---

## 3. P5 knip-exemption removal checklist

Cross-referencing `docs/plans/source-first-editor/platform-inventory.md` §14
("The knip dead-code exemption D10 tells P5a/P5d to remove"). This is the
exact set of `knip.jsonc` line-level edits each future subrun must make —
listed here so the subrun's Lane C (or equivalent) does not have to
re-derive it:

**P5a** (deletes `WebAdapter`, `web-fs.ts`, `web-store.ts`,
`service-worker.ts`, and the 4 PWA-only test files):

- Remove `src/service-worker.{ts,js}` from the `packages/desktop.entry` array
  (and its accompanying comment added by this run).
- Remove `web-store` from the brace group
  `src/lib/platform/{index,contract,dtos,shared-types,web-store}.ts`, leaving
  `src/lib/platform/{index,contract,dtos,shared-types}.ts` — **only if**
  `web-store.ts` is fully deleted in the same subrun (it is, per D10).
- Update the multi-line comment above that entry to drop the `web-store.ts —
  P5a deletes` line.

**P5b** (Platform narrowing — 31 `getPlatform()` + 65 `isDesktop()` call
sites migrated to feature-owned imports, per platform-inventory.md §10):

- Re-check whether `index.ts` / `contract.ts` / `dtos.ts` / `shared-types.ts`
  still have zero in-repo importers after narrowing. If any file's exports
  are now fully consumed by real imports (no longer relying on the knip
  entry to avoid a false "unused file" finding), drop that filename from the
  brace group. If all four are fully deleted, drop the entry line entirely.
  If some members survive as the narrowed contract's own types, keep only
  those filenames and update the comment accordingly.

**P5d** (deletes `src/routes/api/**` and `src/lib/api.ts`, plus
`@sveltejs/adapter-node`):

- Remove the `"src/lib/api.ts"` entry line entirely.
- Update or remove the shared comment block above the `platform/{...}.ts`
  line if `api.ts` was the last line the comment referred to.

**Search proof required at each subrun** (per platform-inventory.md §14):
`grep -n "web-store\|src/lib/api.ts" knip.jsonc` must return no hits once
both P5a and P5d have landed; a hit surviving past P5d is a stale exemption
(anti-pattern AP-32, pr158-lessons.md). Run `bun run knip` after every edit
in this section and confirm it stays exit 0 — a newly-dead file that knip
does NOT flag because a stale entry still shadows it is exactly the failure
mode this checklist exists to prevent.

---

## 4. Commands and exit codes recorded this run

All run from the repository root unless noted.

| Command | Exit code | Notes |
|---|---|---|
| `bun run knip` (baseline, before edits) | 0 | Confirms starting state green. |
| `bun run knip` (after `knip.jsonc` comment edits) | 0 | Confirms the annotation-only edit did not change behavior. |
| `node tools/check-generated-files.mjs` | 0 | No tracked generated-output paths (the 7 root `.svelte-kit/` files were already untracked before this run, per SFE-P0b's "Allowed behavior changes," owned by Lane A). |
| `node tools/check-generated-files.test.mjs` | 0 | 12/12 sabotage-fixture assertions pass. |
| `node tools/check-architecture.mjs` | 0 | All 4 rules PASS; Rule 4 SKIPs `packages/editor` and `packages/vscode-extension` (neither exists yet — correct per D9/P1). |
| `node tools/check-architecture.test.mjs` | 0 | 26/26 sabotage-fixture assertions pass. |
| `grep -n "web-store\|src/lib/api.ts" knip.jsonc` | n/a (grep, not a gate) | 4 hits today (the functional entry line, the `src/lib/api.ts` entry line, and two comment lines this run added that name `web-store.ts` explicitly) — all still load-bearing, all now annotated with a deletion phase. Expected to go to 0 only after P5a (removes the `web-store.ts` mentions) and P5d (removes the `src/lib/api.ts` mentions) both land; recorded here as the pre-P5 baseline for that future search proof. |

