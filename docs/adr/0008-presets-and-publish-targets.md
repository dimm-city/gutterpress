# ADR 0008 — Presets are trim, targets are policy

Date: 2026-07-30 · Status: accepted

## Context

Gutterpress's primary audience is TTRPG authors producing print-on-demand
content for DriveThruRPG, itch.io, and similar indie publishing services.
Novels, manuals, and other long-form books are the secondary audience.

Until now one manifest key — `preset:` — bundled two unrelated decisions:

1. **How the book is designed**: page/trim geometry (`page.width`/`height`).
2. **Where the book will be published**: ink limits (TAC), PDF/X
   requirements, and which validation checks are errors.

That fusion breaks exactly where the primary audience lives. A digest-sized
6×9 supplement still needs DriveThruRPG's ink and PDF/X policy; the same
book released digitally on itch.io needs neither; an author shipping to
both from one source needs each destination validated on its own terms.
The proto-form of the split already existed as `validate --profile dtrpg`
(`validation-profile.ts`) — a policy overlay applied to a resolved config —
but it was a hardcoded one-off, not a model.

## Decision

Two registries, one concern each. Both live in the shared lib and are
consumed identically by the CLI and the desktop (one implementation, two
thin front-ends).

### Presets (`lib/presets.ts`) — how the book is designed

A preset supplies the *base* resolved-config defaults, chiefly page
geometry. Ids: `dtrpg`, `book`, `custom`.

- **Every preset value is overridable from the manifest** (and CLI), leaf
  by leaf — this is `resolveConfig`'s existing `mergeShape` precedence
  (cli → manifest → preset) and is now a documented contract, not an
  accident.
- **`custom` supplies no geometry.** A `preset: custom` manifest MUST
  declare `page.width` and `page.height` (points); `page.tolerance`
  defaults to 0.5. Missing fields are a `UsageError` naming exactly what to
  add. Custom's policy defaults are the neutral `book` ones.
- **A manifest with no `preset:` resolves to `dtrpg`.** That is the product
  default for the primary audience — print-ready out of the box — not a
  backward-compatibility accident, and the one-line notice says so. Every
  creation flow writes an explicit `preset:`, so this default only applies
  to hand-written manifests.
- Each preset carries `defaultTargets` (below): `dtrpg → ["dtrpg"]`,
  `book`/`custom` → `[]`.

### Publish targets (`lib/targets.ts`) — where the book is published

A target is a named validation-policy overlay. It never changes how the
book renders — only what the validator demands of the output. Ids today:
`dtrpg`, `itch`.

- **A target's overlay is data merged BETWEEN the preset and the
  manifest** (`overlayPreset` + `resolveConfigForTarget`), giving one
  precedence chain everywhere: **cli > manifest > target > preset**. The
  author's explicit manifest values therefore always win — there is no
  "profile lock" that overrides the author. The only hard enforcement a
  target adds is `requiredChecks` (below).
- `manifest.targets: string[]` selects them; absent = the preset's
  `defaultTargets`; an explicit `targets: []` opts out. Unknown ids are a
  `UsageError` listing the registry.
- `gutterpress validate --target <id[,id]>` (also on `preflight`)
  overrides the manifest for one run. It replaces `--profile` (removed,
  not aliased — two users, no legacy surface).
- Each target owns: a config `overlay`, and `requiredChecks` — the check
  ids that become synthetic errors when tool availability forces them to
  be skipped (generalizing the old dtrpg-only rule). An author who
  explicitly disables one of these in the manifest owns that choice; the
  guard exists for silent environment gaps, not deliberate configuration.
- **Multi-target validation** runs the target-independent categories
  (`source`, `heuristic`) once against the base config, then the
  target-dependent categories (`asset`, `pdf`) once per target with that
  target's overlay. The report labels each target's section; the summary
  is combined. Zero targets = today's single-run behavior.
- `itch` is a *digital-readiness* policy: structure and embedded-fonts
  checks stay errors; PDF/X markers/metadata, CMYK-only color spaces, and
  the TAC cap do not apply.

### Creation requires a preset — and records the targets

`scaffoldProject` (the one implementation behind `gutterpress new` and the
desktop wizard) refuses to scaffold a built-in template without a `preset`,
and requires `customPage` (`width`/`height`, optional `tolerance`) when the
preset is `custom`. The chosen preset (and custom geometry) is written into
the generated manifest through the comment-preserving YAML document
helpers, overwriting the template's placeholder value.

**Publish targets are recorded explicitly at creation too.** The scaffold
always writes a `targets:` list — the caller's choice, else the preset's
`defaultTargets` — including an explicit `targets: []` when nothing is
selected, so "no destination policies" is a visible, editable decision and
never an accident of omission. The preset-derived fallback in
`resolveConfig` therefore only ever applies to hand-written manifests.

- CLI: `gutterpress new --preset <dtrpg|book|custom>` is required;
  `--page-width`/`--page-height` (points) required with `custom`;
  `--targets <ids|none>` overrides the preset's default list. When a chosen
  target's `requiredTools` (a declared field on `PublishTarget` — qpdf/gs
  for dtrpg, nothing for itch) are missing on the machine, the command
  prints the consequence up front: a print-compliant (PDF/X) file can't be
  built or verified until they're installed, with the `targets: []` opt-out
  named.
- Desktop wizard: a required preset choice with no preselection (Create
  stays disabled until one is picked); choosing Custom reveals the
  width/height form. Below it, a "Where will you publish it?" checkbox
  list, pre-checked from the preset's defaults and freely uncheckable —
  when a checked destination's tools are missing (from the same
  `/api/doctor` data the Help tab shows), the same explanation appears
  inline, so opting out of print checks is an informed choice rather than a
  surprise error later.
- **Saved custom templates are the exception**: a template saved from a
  real project carries its manifest — preset and targets included — as part
  of the captured design, so scaffolding from `templateDir` keeps it and
  the wizard hides both pickers for those.
- `adoptFolder` (turning a loose folder into a book) writes an explicit
  `preset: dtrpg` and `targets: [dtrpg]` — it is a one-click rescue
  affordance, not the primary creation path, and the explicit lines make
  the defaults visible and editable rather than implicit.

## Consequences

- Authors can validate one source against several destinations
  (`targets: [dtrpg, itch]`) without duplicating projects or fighting the
  preset.
- New presets are data (`PRESETS` entry + schema enum), and new targets are
  data (`TARGETS` entry); neither requires touching resolution or the
  validation runner again.
- The manifest `preset` union and CLI flag choices derive from the
  registries, so the registries are the single source of truth.
- `validation-profile.ts` and `--profile` are deleted; DriveThruRPG's
  publish-provider tip points at `--target dtrpg`.
- Presets keep carrying *policy defaults* (ink/pdfx/validate) as base
  config so a bare `preset: dtrpg` remains fully print-ready with zero
  targets configured; targets are the mechanism the moment more than one
  destination matters.
