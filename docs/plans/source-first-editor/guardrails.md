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
> every `knip.jsonc` entry/ignore line, removal-tested (not merely checked
> for existence) against the current tree, gated and ungated. Section 3 is
> the P5 knip-exemption removal checklist, cross-referencing
> `docs/plans/source-first-editor/platform-inventory.md` §14.

---

## 1. Fitness function catalog

| Check | What it protects | How invoked | Sabotage proof | Plan phase that changes/retires it |
|---|---|---|---|---|
| `tools/check-render-purity.mjs` | CLAUDE.md §8: the desktop SPA client bundle must value-import only `gutterpress/render` and stay free of host/Node code (named leak identifiers, quoted `node:*` specifiers, bare builtin `require`). Pre-existing, not an SFE-P0b deliverable. | `node tools/check-render-purity.mjs [buildDir] [--strict]`; CI `build` job step "Check renderer purity (CLAUDE.md §8)" scans `packages/desktop/build/client --strict` after the desktop build step; the desktop app's own `npm run build` also runs it with `--strict`. | `tools/check-render-purity.test.mjs`, run standalone (`node tools/check-render-purity.test.mjs`) and as its own CI "Check renderer purity self-test" step immediately before the real gate — the convention this run's two new checks (below) copy. | Not directly retired by any SFE phase. D10/P5d removes `@sveltejs/adapter-node` and the `build/server` vs `build/client` split the `--strict` scope depends on; the gate's `buildDir` argument and scope comment will need re-deriving against whatever the post-P5d static-SPA build emits. Until P5d lands, unaffected. |
| `tools/check-generated-files.mjs` (Lane A, this run) | SFE-P0b's hygiene requirement: regenerated build output (`.svelte-kit/`, `build/`, `out/`, `*.tsbuildinfo`, `packages/*/dist/`) must never be tracked in git — the exact failure the 7 tracked root `.svelte-kit/` files demonstrated at baseline. | `node tools/check-generated-files.mjs [--root <path>]`, and the root script `bun run check:generated-files` (`package.json`). **Wired into CI**: `.github/workflows/ci.yml`'s `build` job runs the self-test step "Check generated-file hygiene self-test" (`node tools/check-generated-files.test.mjs`) immediately followed by the live-gate step "Check generated-file hygiene (no tracked build output)" (`bun run check:generated-files`), both before the knip step. | `tools/check-generated-files.test.mjs` (`node tools/check-generated-files.test.mjs`) — 16 assertions against temp-dir git fixtures, covering sabotage-fail proof for all 5 patterns (`.svelte-kit/`, `build/`, `out/`, `.tsbuildinfo`, `packages/*/dist/`), `--root` scoping, and the 2/usage-error path. Verified green in this run (see §4). | No SFE phase retires this — generated-output hygiene is permanent. The pattern list could grow if a future build tool introduces a new output directory shape; that is a maintenance addition, not a phase-triggered retirement. |
| `tools/check-architecture.mjs` (Lane B, this run) | Plan D4 (module ownership/import direction, no service locator), D10 (desktop HTTP route ratchet — no new route during P5), and the Lane rules ban on ProseMirror/Tiptap/Milkdown dependencies. Four independent rules, each with its own PASS/FAIL/SKIP/WARN line, and (Rules 1/3) printed scanned-target counts so a clean pass can be told apart from a vacuous one (AP-21/AP-20). | `node tools/check-architecture.mjs [--root <path>]`, and the root script `bun run check:architecture` (`package.json`). **Wired into CI**: `.github/workflows/ci.yml`'s `build` job runs the self-test step "Check architecture boundaries self-test" (`node tools/check-architecture.test.mjs`) immediately followed by the live-gate step "Check architecture boundaries (plan D4/D10 + ProseMirror ban)" (`bun run check:architecture`), both before the knip step. | `tools/check-architecture.test.mjs` (`node tools/check-architecture.test.mjs`) — 36 assertions: prosemirror-family deps in `package.json`/`bun.lock`/imports (with printed package.json/bun.lock/code-file counts); route-ratchet over/under baseline and missing-baseline error; cli→desktop and desktop→cli import-direction violations in both bare-specifier and relative-path form (with printed cli/desktop scanned-file counts); a positive-control case asserting those counts are nonzero on the clean fixture; two liveness-FAIL cases (AP-21) proving Rule 3 fails — not silently passes — when `packages/cli/src` is entirely absent or `packages/desktop/{src,electron}` has zero scannable files; the future-package rules for a fake `packages/editor` and `packages/vscode-extension` (including the AP-21 liveness-WARN case for a present-but-empty `src`). Verified green in this run (see §4). | Rule 2's ratchet number in `tools/architecture-baseline.json` (currently 104) is lowered every time P5c deletes desktop HTTP routes, reaching 0 after P5d — at that point Rule 2 could be simplified or retired (nothing left to ratchet). Rule 4 activates its `packages/editor` branch once P1a creates that package, and its `packages/vscode-extension` branch once that package exists (per D9). Rules 1 and 3 are permanent (Lane rules ban + D4 import direction do not expire); Rule 3's liveness check is exactly what protects it through P1a/P6 package moves. |
| `packages/cli/scripts/check-render-pure.mjs` | CLAUDE.md Monorepo layout: `src/render.ts` is built as a separate non-split `bun build` graph so the node-free `gutterpress/render` subpath never shares a chunk with Node code (the 2026-07 shared-chunk `createRequire` regression). Bans any relative import, any Node builtin specifier, and `createRequire` inside `dist/render.js`. Pre-existing, not an SFE-P0b deliverable. | `node scripts/check-render-pure.mjs`, run from `packages/cli` as part of the `build:library` script chain (`bun run build:library` / `bun run build`), which CI's `build` job invokes via "Build CLI npm bundle" (`bun run build`, working-directory `packages/cli`). | No dedicated `.test.mjs`. Its proof is structural: the CLI build step hard-fails (non-zero exit propagates through the `&&`-chained `build:library` script) if `dist/render.js` contains a banned pattern, so a reintroduced shared-chunk leak cannot pass CI silently — but this does not meet the G-12 fixture-sabotage bar the two new SFE-P0b tools meet. **Advisory, not remediated by this run**: `scripts/**` under `packages/cli` is out of Lane C's write ownership for this run. | Plan D4 makes `packages/editor` a second consumer of `gutterpress/render` (P1a onward), which raises this gate's stakes rather than retiring it — a regression here would now break the shared editor mount too, not only the desktop SPA. No SFE phase removes it. |
| Knip gate (`knip.jsonc` + root `knip` script) | Dead-code/dependency hygiene repo-wide; specifically documents (via the annotated PWA-scaffolding exemption, §2 below) which desktop platform-seam files are intentionally kept alive pending D10's P5a/P5b/P5d deletions, so knip does not flag them as false-positive dead code while they are still load-bearing. | `bun run knip` (root script: `(cd packages/desktop && bunx svelte-kit sync) && knip --include files,dependencies,unlisted,binaries`); CI `build` job step "Check for unused files/dependencies (knip)", gated before the build steps. | No `.test.mjs` — knip itself is the third-party tool under test; its "sabotage proof" is structural: any of the exempted files being genuinely deleted without updating `knip.jsonc` immediately fails the gate (a stale entry referencing a removed file/glob is not itself a failure mode knip reports, which is exactly why this run's manual audit — §2 — exists instead of relying on knip to self-detect it). | The PWA-scaffolding exemption lines shrink at P5a (removes `web-store.ts` and the `service-worker.{ts,js}` entry) and at P5d (removes `src/lib/api.ts`); P5b may further narrow or remove the remaining `index/contract/dtos/shared-types.ts` line. See §3. |
| Preview↔print parity gate (`packages/cli/scripts/native-parity-gate.ts`) | CLAUDE.md's Chromium-only/print-fidelity rule: "the preview↔print parity gate is what proves it [the viewer] still agrees with the PDF — and it must stay green with an empty allowlist." Compares the in-browser viewer fragmenter against Chromium's `printToPDF` measurement for page count, per-id page mapping, `target-counter()` resolution, and per-heading page mapping. | `bun scripts/native-parity-gate.ts`, run from `packages/cli`; CI `test` job step "Preview/print parity gate" (working-directory `packages/cli`). Root `package.json` script `parity:gate` in `packages/cli/package.json` (not root — pre-existing). | No dedicated `.test.mjs`. Self-proving by construction: `KNOWN_DIVERGENCES` is an explicit allowlist that is empty today (verified in this run, §4); any unlisted divergence fails the run (exit 1), and — the sabotage-relevant half — an allowlisted divergence that stops reproducing *also* fails the run (forcing the allowlist entry to be deleted rather than surviving as a stale exemption, per AP-32). | D8 keeps preview as the exact-pagination/PDF-parity authority through the whole SFE effort — this script's scope (preview vs. print) is not expected to change. P2d/P3 add sibling parity tools for different questions (rich-editor-vs-preview, revision-diff, cross-browser — pr158-lessons.md G-08/AP-23) rather than modifying this one. P4 removes preview's own mutation capabilities but not its pagination-authority role this gate measures. |

### 1a. Wiring status as of this run

`tools/check-generated-files.mjs` and `tools/check-architecture.mjs` (with
their `.test.mjs` self-tests and `tools/architecture-baseline.json`) exist in
the working tree — Lanes A and B landed them — and are **fully wired**:

- Root `package.json` (`scripts`) declares `check:generated-files` (`node
  tools/check-generated-files.mjs`) and `check:architecture` (`node
  tools/check-architecture.mjs`).
- `.github/workflows/ci.yml`'s `build` job runs four steps, self-test before
  live gate for each tool, both before the "Check for unused files/dependencies
  (knip)" step: "Check generated-file hygiene self-test" (`node
  tools/check-generated-files.test.mjs`), "Check generated-file hygiene (no
  tracked build output)" (`bun run check:generated-files`), "Check
  architecture boundaries self-test" (`node tools/check-architecture.test.mjs`),
  "Check architecture boundaries (plan D4/D10 + ProseMirror ban)" (`bun run
  check:architecture`).

Both `bun run check:generated-files` and `bun run check:architecture` were
run directly and verified green in this run (§4), alongside the `node
tools/*.test.mjs` self-test invocations. The integrator's wiring work (per
the run's lane-ownership table, which assigned root `package.json` +
`.github/workflows/ci.yml` to the integrator, not Lane C) has landed —
this section now describes the wired state, not a still-pending one.

---

## 2. Knip exemption audit

Every `knip.jsonc` entry/ignore/exemption line was tested against the current
tree, not merely checked for existence. **Existence is not removability**: a
referenced path being real only proves a comment is accurate, it proves
nothing about whether the exemption changes knip's output. The methodology
below instead removes each line (or line group) one at a time from a scratch
copy of `knip.jsonc` and re-runs both the CI-gated invocation (`knip
--include files,dependencies,unlisted,binaries`, matching the root `knip`
script) and the full ungated `knip` (which additionally surfaces the
advisory `exports`/`types` categories the file's own header documents as
intentionally left unsuppressed). A positive control — deleting the
`src/engine/dev-cli.ts` entry — was run first to confirm the harness detects
real redundancy: it flips the gated run to exit 1 ("Unused files (1)"), so a
row reported as "gated exit 0 after removal" below is a genuine finding, not
a harness gap.

Each row is classified into exactly one of four buckets:

- **Load-bearing** — removing the line flips the gated run to exit 1. This
  is the exemption doing its documented job.
- **Inert in gated scope, suppresses ungated advisory noise** — removing the
  line leaves the gated run at exit 0, but changes the ungated (ordinary
  `bunx knip`) output, typically by exposing new `exports`/`types` advisory
  findings for a file that is genuinely reachable through the import graph
  but was previously exempted from the "unused export" check. Real purpose,
  just not one the CI gate depends on.
- **Fully inert — removed this run** — removing the line produces a
  byte-identical diff against baseline in *both* the gated and the full
  ungated `knip` output. Nothing anywhere in knip's analysis depends on the
  line; it was dead configuration and is deleted below, satisfying the
  run's "removable ones removed" requirement.
- **Inert today, retained by run-spec instruction** — removing the line is
  gated-inert (and, where noted, also ungated-inert), but the run spec's
  "Behavior that must remain unchanged" section requires it to stay until a
  named future phase regardless of its current effect on knip.

| Line | Path exists? | Removal test (gated / ungated) | Result |
|---|---|---|---|
| root `entry: ["tools/*.mjs"]` | Yes — `ls tools/*.mjs` → 13 files. | Emptying the entry array: gated exit 1 (10-line diff: root `tools/*.mjs` files become unlisted/unused). | **Load-bearing.** |
| root `ignore: ["packages/open-design-plugin/**"]` | Yes. | Removing the ignore: gated exit 1 — `Unused files (1)`, `packages/open-design-plugin/test-fixtures/.../publisher-components.js` named. | **Load-bearing.** |
| root `ignoreBinaries: ["pdftoppm"]` | Yes — both `tools/page-background-mechanism.mjs` and `tools/page-background-repro.mjs` invoke it via `execFileSync`. | Removing the ignore: gated exit 1 — `Unlisted binaries (2)`, both call sites named. | **Load-bearing.** |
| `packages/cli` entry: `src/cli.ts` | Yes. | Removed alone: gated exit 1 — `Unused files (3)` (`cli.ts` + 2 command modules it alone roots). | **Load-bearing.** |
| `packages/cli` entry: `src/index.ts` | Yes. | Removed alone: gated exit 0 (the file stays reachable — other files import it directly); ungated diff +72 lines, all new `Unused exports`/`Unused exported types` on `index.ts` itself. | **Inert in gated scope, suppresses ungated advisory noise** — this is the package's public-API surface; without the entry, knip starts flagging its intentionally-unused-elsewhere exports. |
| `packages/cli` entry: `src/api/index.ts` | — | Removed alone: gated exit 0, **ungated diff 0 lines** (byte-identical). Already reachable via `src/index.ts:13`'s `export * from "./api/index.ts"` — the explicit entry added nothing. | **Fully inert — removed this run** (see below). |
| `packages/cli` entry: `src/render.ts` | Yes. | Removed alone: gated exit 1 — `Unused files (1)`. | **Load-bearing.** |
| `packages/cli` entries: `src/engine/viewer/global.ts`, `src/engine/compiler/agent.ts` | Yes — both are `scripts/build-engine-bundles.mjs`'s `Bun.build` entrypoints (`grep -n "viewer/global\|compiler/agent"` confirms). | Removed individually: `global.ts` → gated exit 1, `Unused files (3)` (pulls in `decorate.ts`/`index.ts` too); `agent.ts` → gated exit 1, `Unused files (1)`. | **Load-bearing.** |
| `packages/cli` entry: `src/engine/dev-cli.ts` | Yes. | Positive control for this whole audit: removed alone → gated exit 1, `Unused files (1)`. | **Load-bearing.** |
| `packages/cli` entry: `tests/compat/*.pw.ts` | — | Removed alone: gated exit 0, **ungated diff 0 lines**. `node_modules/.bin/knip --debug` shows knip's built-in Playwright plugin auto-detects `tests/compat/playwright.config.ts`'s `testMatch` (`**/*.pw.ts`) as an entry pattern independent of this manual declaration — confirmed by the debug trace logging `entry:tests/compat/**/*.pw.ts (…/playwright.config.ts)` even with the line removed. | **Fully inert — removed this run** (see below). |
| `packages/cli` entry: `src/checks/{asset,heuristic,pdf,source}/*.ts` | Yes — populated with real check modules. | Removed alone (glob replaced with a non-matching placeholder): gated exit 0; ungated diff +101 lines (new advisory findings). These modules are loaded via a computed-path dynamic `import()` in `checks/register-builtins` that knip's static scanner cannot trace. | **Inert in gated scope, suppresses ungated advisory noise** — genuinely doing a job, just not a gated one. |
| `packages/desktop` entry: `src/routes/**/+*.{ts,svelte}` | — | Removed alone: gated exit 0, **ungated diff 0 lines**. knip's SvelteKit plugin already treats `+page`/`+server` route files as entries by default — same mechanism as the `service-worker` row below. | **Fully inert — removed this run** (see below). |
| `packages/desktop` entry: `src/service-worker.{ts,js}` | Yes. | Removed alone: gated exit 0, ungated diff 0 lines. knip's SvelteKit plugin already treats it as a default entry (matches the finding that first identified this). D10 names it for P5a deletion; platform-inventory.md §13 confirms it as PWA-only. | **Inert today, retained by run-spec instruction** ("Knip exemptions tied to PWA scaffolding remain until P5a"). Comment annotated with "P5a deletes this entry." |
| `packages/desktop` entry: `tools/*.mjs` | — | Removed alone: gated exit 0, **ungated diff 0 lines**. `packages/desktop/tools/check-app-tokens.mjs` is the only file the glob covers, and it is already referenced from `package.json`'s `"lint"` script (`node tools/check-app-tokens.mjs`) — knip detects package-script references independently of this entry. | **Fully inert — removed this run** (see below). |
| `packages/desktop` entry: `tests/**/*.{ts,js,mjs}` | Yes. | Not individually isolated this run (bundled with the `tools/*.mjs` removal test above; the combined removal of both stayed gated exit 0 only because `tools/*.mjs` was the inert half — left unchanged and unverified in isolation). | Unchanged; not re-classified. |
| `packages/desktop` entry: `src/**/*.type-test.ts` | Yes. | Removed alone: gated exit 1 — `Unused files (3)`, all three `.type-test.ts` files named. | **Load-bearing** (svelte-check type-checks these in place; nothing else roots them). |
| `packages/desktop` entry: `src/lib/platform/{index,contract,dtos,shared-types,web-store}.ts` | Yes — all 5 files exist. `WebAdapter` (`web-adapter.ts`) is still referenced from `contract.ts`/`index.ts`/`web-fs.ts`/`web-store.ts`. `getPlatform()`/`isDesktop()` call-site counts per platform-inventory.md §10's own methodology (`grep -rn "getPlatform("/"isDesktop(" packages/desktop/src --include="*.ts" --include="*.svelte" \| grep -v "platform/index.ts" \| grep -vE '^\s*[^:]+:[0-9]+:\s*(//\|\*\|/\*\*)' \| wc -l`, matching that document's §10.1/10.2 exactly): **31** / **65** call sites — both still widely used in production code. | Removed alone: gated exit 0; ungated diff +77 lines (new `Unused exports`/`Unused exported types` across all 5 files, e.g. `WEB_STORE_NAMES` in `web-store.ts`). | **Inert in gated scope, suppresses ungated advisory noise, AND retained by run-spec instruction** until P5a (drops `web-store.ts`) / P5b (may narrow the rest). Per-file deletion ties from platform-inventory.md §14 kept in the comment (§3 below). |
| `packages/desktop` entry: `src/lib/api.ts` | Yes. | Removed alone: gated exit 0; ungated diff +37 lines (new `Unused exported types` on `api.ts`, e.g. `PublishIssue`, `PluginKind`). | **Inert in gated scope, suppresses ungated advisory noise, AND retained by run-spec instruction** until P5d. |

### Removed this run

Four lines were **fully inert** (zero effect on knip's output in either the
gated or the full ungated scope) and are not tied to any P5 deletion, so they
were removed from `knip.jsonc` per the behavior table's "removable ones
removed" requirement:

- `packages/cli` entry `"tests/compat/*.pw.ts"` — redundant with knip's
  built-in Playwright plugin.
- `packages/cli` entry `"src/api/index.ts"` — already reachable via
  `src/index.ts`'s re-export.
- `packages/desktop` entry `"src/routes/**/+*.{ts,svelte}"` — redundant with
  knip's SvelteKit plugin.
- `packages/desktop` entry `"tools/*.mjs"` — redundant with knip detecting
  the one file it covers via its `package.json` `"lint"` script reference.

**`bun run knip` after all four removals combined: exit 0.
`node_modules/.bin/knip` (full, ungated) after all four removals combined:
byte-identical to the pre-removal baseline (0-line diff)** — see §4. Removing
all four together, not just individually, rules out one masking another's
redundancy.

Every remaining entry is either load-bearing (verified by an actual gated
failure on removal), doing real work suppressing ungated advisory noise, or
explicitly retained by the run spec pending a named future phase — no entry
is kept on the strength of an existence check alone.

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

**Caveat, per §2's own measurements above: a green `bun run knip` after these
deletions is not by itself proof the deletion was correct.** §2 measured that
removing the `service-worker` entry and the `platform/{...}.ts` /
`src/lib/api.ts` entries is *already* gated-inert today (exit 0 before the
files they cover are even deleted) — the gated scope simply does not exercise
what these entries protect against. A newly-dead file left behind by an
incomplete P5a/P5b/P5d deletion would not turn `bun run knip` red either.
The actual proof each subrun needs is the **ungated** comparison §2 used:
run `node_modules/.bin/knip` (no `--include` flag) before and after the
subrun's edits and confirm the diff is the expected one (the deleted file's
findings disappearing), not silence. Recording that ungated diff — not just
the gated exit code — in that subrun's own guardrails-catalog update is what
closes this gap.

---

## 4. Commands and exit codes recorded this run

All run from the repository root unless noted.

| Command | Exit code | Notes |
|---|---|---|
| `bun run knip` (baseline, before this run's edits) | 0 | Confirms starting state green. |
| `bun run knip` (after `knip.jsonc` comment edits + the 4 line removals in §2) | 0 | Confirms the edits did not regress the gated scope. |
| `node_modules/.bin/knip` (full, ungated; baseline vs. after all 4 §2 removals combined) | 1 both times (pre-existing advisory findings; see `knip.jsonc`'s header comment) | `diff` between the two full outputs: **0 lines** — byte-identical. Proves the 4 removed lines were truly inert, not just gated-inert, and that removing them together doesn't expose an interaction the individual tests missed. |
| `node tools/check-generated-files.mjs` | 0 | Scanned 1083 tracked file(s); no generated-output paths tracked (the 7 root `.svelte-kit/` files were already untracked before this run, per SFE-P0b's "Allowed behavior changes," owned by Lane A). |
| `bun run check:generated-files` | 0 | Same check via the wired root script (§1a) — output identical to the direct `node` invocation above. |
| `node tools/check-generated-files.test.mjs` | 0 | 16/16 sabotage-fixture assertions pass — one pair (PASS/name-the-path) per each of the 5 declared patterns (`.svelte-kit/`, `build/`, `out/`, `.tsbuildinfo`, `packages/*/dist/`), plus the substring-no-false-positive, `--root`-isolation, and non-git/missing-root usage-error cases. |
| `node tools/check-architecture.mjs` | 0 | All 4 rules PASS. Rule 1: scanned 4 `package.json` file(s) (bun.lock: found), 620 code file(s). Rule 2: 104 == baseline 104. Rule 3: scanned 338 `packages/cli/src` file(s), 282 `packages/desktop/{src,electron}` file(s) — both nonzero, no liveness FAIL. Rule 4 SKIPs `packages/editor` and `packages/vscode-extension` (neither exists yet — correct per D9/P1). |
| `bun run check:architecture` | 0 | Same check via the wired root script (§1a) — output identical to the direct `node` invocation above. |
| `node tools/check-architecture.test.mjs` | 0 | 36/36 sabotage-fixture assertions pass, including the two new AP-21 liveness-FAIL cases (`packages/cli` entirely absent; `packages/desktop` present with zero `src`/`electron` files) and the positive-control case asserting Rule 1/3's printed scanned-target counts are nonzero on the clean fixture. |
| `node tools/check-architecture.mjs --root <fixture with desktop-only, no packages/cli>` | 1 | Reproduces the exact liveness gap this run's Rule 3 fix closes: `RULE 3 [d4-import-direction]: FAIL (liveness) — scanned 0 packages/cli/src file(s), 1 packages/desktop/{src,electron} file(s)`, naming `packages/cli/src` in the FAIL detail — this is now a real FAIL, not a silent PASS. |
| `grep -n "web-store\|src/lib/api.ts" knip.jsonc` | n/a (grep, not a gate) | 4 hits today (the functional entry line, the `src/lib/api.ts` entry line, and two comment lines naming `web-store.ts` explicitly) — per §2, these are gated-inert but ungated-consequential, and retained by run-spec instruction regardless of either. Expected to go to 0 only after P5a (removes the `web-store.ts` mentions) and P5d (removes the `src/lib/api.ts` mentions) both land; recorded here as the pre-P5 baseline for that future search proof. Per §3's caveat, a green `bun run knip` at that point will not itself prove the removal was correct — the ungated diff must be checked too. |

