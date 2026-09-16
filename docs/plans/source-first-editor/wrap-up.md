# Gutterpress Source-First Rich Editor and Enterprise Architecture Simplification — Implementation Wrap-Up

## Result

**Complete**, with one measured performance criterion failed and carried
openly (AC-24, below), one packaged-smoke scope note (win/mac are
CI-runner work), and a short list of stakeholder release actions. All
seven phases (P0–P7) executed; every run has a spec, an adversarial
review to approve, and a recorded gate. 23 of 24 acceptance criteria
PASS (7 with explicit scope), 1 FAIL, 0 NOT APPLICABLE — the full
per-criterion evidence is `docs/plans/source-first-editor/acceptance.md`'s
"Final acceptance sweep — SFE-P7" section.

## Commit range

- Measurement baseline (main at program start): `ea7b60d5`
- Merge-base with current `origin/main`: `5ec25e5a` (main was merged into
  the branch during the program)
- Head (final verified SHA): `dfe75b91` — close-out documentation commits
  follow it, touching no code
- Branch: `claude/sonnet-opus-agent-workflow-4s81ps` (144 commits;
  PR #214)

## Completed phases

- **P0** — baseline record with exact derivation commands; architecture
  fitness functions (prosemirror ban, route ratchet, import direction,
  future-package rules).
- **P1** — shared editor contracts; `@dimm-city/gutterpress-editor` and
  VS Code extension package skeletons; the vendored-fork decision (D5,
  ADR 0014) with `PATCHES.md` + byte-pinned verification; the pure
  document session.
- **P2** — standard Markdown rich editor; the sparse Gutterpress
  projection (`gutterpress/render`'s new projection surface); plugin
  origin + trusted rendering.
- **P3** — desktop rich mode and authoring parity; the VS Code extension;
  the preview↔print parity gate green before any deletion; plugins
  rendering in the rich editor for real (the product-owner ruling run);
  the interaction/a11y/perf sweep and the fork measurement patch.
- **P4** — in-preview editing and its mutation machinery deleted
  (net −6,719 LOC; protocol v8→v9, five mutation messages removed).
- **P5** — dormant PWA deleted (net −2,546); `Platform`/`HostServices`
  locator replaced by twelve feature-owned capability modules over one
  bridge accessor; all 104 desktop HTTP routes migrated to typed IPC;
  the local HTTP server, bearer token, and proxy deleted (all-of-P5:
  313 files, net −3,621).
- **P6** — both composition roots slimmed behaviour-identically
  (`+page.svelte` 4,739→4,543; `main.ts` 2,188→1,965; IPC surface
  byte-identical, reviewer-verified); pinned public export surface;
  ADRs 0012–0017, ownership records.
- **P7** — zero-remnant verification, nine-metric measured before/after,
  release records, real-book/packaged sweeps, and the final acceptance
  sweep.

## User-visible changes

- A source-first **rich editing mode** in the desktop app's Edit pane,
  sharing the document session/autosave/recovery with Source mode; layout
  markers render as chips; project-plugin regions render through the
  plugin's own output with a safe source-mode fallback.
- A new, **Experimental VS Code extension** on the same shared editor
  (optional custom editor, never the `.md` default; workspace-trust-gated
  plugin execution).
- **The paginated preview is read-only** (breaking): in-preview editing is
  gone; navigation, selection/copy, diagnostics, page controls, and
  go-to-source remain.
- The desktop app is **one process** — no local HTTP server; its UI is
  served via a custom `app://` protocol from disk/asar.
- New public subpath **`gutterpress/plugins`**; `gutterpress/render`
  gained the projection surface. Full details: `CHANGELOG.md` and
  `docs/releases/0.11.0.md`.

## Architecture changes

- One host seam: ~120 runtime-validated `secureHandle` IPC channels
  across 26 registrar modules; renderer stays PWA-clean (ADR 0016).
- Narrow feature-owned capability modules replace the service locator
  (ADR 0017); adapter-static + `app://` replace adapter-node + loopback
  server + bearer token.
- Shared editor package consumed by desktop and VS Code; exact source is
  the only authoritative document; sparse projection (ADR 0012/0014).
- A future web product is a separate package, not a mode (ADR 0015).

## Deleted complexity

- P4–P6 production scope: **246 files, +7,608/−10,097 = net −2,489
  production LOC; 124 production files deleted vs 42 added (−82
  modules)** (sweep-derived, `cf5dacda..fc6f543a`).
- Desktop HTTP routes **104 → 0**; preview mutation protocol messages
  **5 → 0**; `Platform`/`HostServices` locator members **31 → 0**;
  IPC handlers 12 → 120 (the routes' replacement).
- The whole program is LOC-net-positive (baseline-scope production
  94,859 → 99,926 across −71 files) because P1–P3 built a major feature;
  the deletion phases are strongly negative and every figure is
  re-derivable from `deletion-ledger.md`'s final section, which also
  carries the repo-wide zero-remnant grep proofs for every deleted
  surface.

## Gate results

All 16 commands of the program gate exit 0 at `dfe75b91`
(full per-command counts in `runs/SFE-P7.md` § Gate results):

- `bun install --frozen-lockfile` — PASS
- `bun run typecheck` (4 workspaces) — PASS
- cli `bun run build` (render-pure) + `bun run test` (1931 pass / 60
  skip / 0 fail) — PASS
- editor `bun run test` (3038) + `test:browser` (121, 9 suites) — PASS
- vscode-extension `bun run test` (228) — PASS
- desktop `test` (5915 pass / 1 skip / 0 fail) + `check` (693 files, 0
  errors) + `lint` + `build` (renderer purity, 144 files) +
  `electron:build` — PASS
- `check:architecture` (4/4) + `check:generated-files` (1,271) +
  `check:vendored` (26 hashes / 33 files) + `knip` — PASS

The plan's five named-but-scriptless gates are covered by the recorded
name→command mapping (`p7-sweeps.md` §4), each command re-run fresh.

CI at `dfe75b91` additionally runs the preview/print parity gate on a
real runner (the sandbox lacks Chromium 148+); the parity step's first
recorded green run in this program is CI run 33579455024 at `ea2610b3`,
and `git diff ea7b60d5..HEAD -- packages/cli/src/engine` is empty — the
engine the gate measures is untouched by the whole program.
CI run 33583966490 at `dfe75b91` is green across all four jobs, with that
parity step completing SUCCESS (14s) — the parity gate is green at the
final SHA.

## Review disposition

- Confirmed findings fixed: **152** across 21 reviewed runs (each run's
  review log names them; every one verified fixed in-tree by the
  reviewer before approve, many mutation- or sabotage-proven).
- Open advisories: recorded per-run in the run specs' review logs and
  the workflow journals; the P7 close-out's carried items are the four
  sweep findings (F-1 fixed at `dfe75b91`; F-2/F-3/F-4 below).
- Deferred / explicitly out of scope: the three ordered D13 performance
  follow-ups (SFE-P3f close-out); two a11y items (no ARIA landmark on
  the rich surface; no `<main>`/skip-link); real-`@vscode/test-electron`
  activation (network-blocked in sandbox — harness-suite evidence
  stands in); win/mac packaged smokes (CI runners); the two
  test-support `.d.ts` files leaking into the npm tarball (p7-sweeps
  §3.1); `PlatformAdapter` as dead exported surface (public-contract
  change, not taken unilaterally).

## Acceptance sweep

- Passed: **23** (AC-01–AC-23; seven with explicit scope notes)
- Failed: **1** (AC-24 — D13: 250 KiB p95 edit-to-paint measured
  ~545–632 ms vs the 100 ms budget; root cause in the vendored fork's
  whole-document geometry remeasurement; three ordered follow-ups
  recorded)
- Not applicable: **0**

## Net complexity

- Production LOC (baseline scope): 94,859 → 99,926 (−71 files); P4–P6
  deletion scope net −2,489.
- Modules: baseline-scope production files 471 → 400; +51 files in the
  two new packages (editor 35, vscode-extension 16).
- Dependencies: cli 28 → 28; desktop 13 → 14 (the added one is the
  workspace editor package); new packages 2 + 2; the private vendored
  fork carries 11.
- Desktop routes: 104 → 0.
- Preview mutation protocol: 5 messages → 0.

## Remaining stakeholder actions

1. **Merge decision** on [PR #214](https://github.com/dimm-city/gutterpress/pull/214).
2. **Version bump + publish**: no version number changed in-tree by
   design; bump to 0.11.0, npm publish (`gutterpress`), and the VS Code
   marketplace decision for the Experimental extension.
3. **Release branch**: `origin/release/0.11.0` still points at
   `ea7b60d5` while `origin/main` is `5ec25e5a` (sweep F-2) — a
   release-management action.
4. **CI-runner work**: win/mac packaged smokes (`dist:win`/`dist:mac`);
   keep the parity gate green in CI.
5. **Tracked follow-ups**: the D13 perf follow-ups, the two a11y items,
   the tarball `.d.ts` exclusion, and a real-VS-Code activation run in a
   network-open environment.
