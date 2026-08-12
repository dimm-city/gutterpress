# Remaining work — 0.10.0 native-engine migration

**Living document.** Update it when a decision is made or an item lands; do not
let it drift into a historical record. Spans two repos: `gutterpress`
(this one) and `dc-op-manual` (DC design guide + field guide).

Last updated 2026-08-12.

---

## Decisions made (do not relitigate)

| Decision | Ruling | Why |
|---|---|---|
| Panel chrome on `.section` | **Opt-in.** `.dc-panel` on one element, or `.dc-panel-sections` on a chapter (book policy), `.dc-bare` to opt out | Theme appearance must never key on a class core emits for structure. 191 elements affected; four reset rules existed to undo the default |
| Column vocabulary | **Core owns it.** `.gp-columns-2/3`; the book's `.two-column`/`.three-column` deleted, gutter kept as `--gp-column-gap` | Two names for one thing is what produced the Augmerc defect |
| Core `.section` CSS | **Keep** `:where(.section, figure) > :where(:first-child) { break-before: avoid }` | Break behavior is fragmentation semantics — core's job, not decoration |
| `@section` with no `@page` | **Valid authoring.** Warning and `implicitPage` both removed | Audited: 17/17 occurrences were `.gp-columns-2` layout wrappers, none rendered wrong. Auto-wrapping was implemented, measured, and **rejected** — a `.page` matches every bare `.page` selector, so wrapping silently exposes content to page-scoped rules |
| Skill-card splitting | **Split by default stays**; quality comes from break rules, not from a boolean | `48c381c` flip retained; tab/body glue + row atomicity landed instead |
| Outcome ladders | **Multiple ladders are supported today** — `@outcome` takes the author's label verbatim, tier by row position | No work needed. See limits below |
| Streetwarden `<br>` | **Leave them.** A `<br>` in a table cell is legitimate markdown | The earlier flag was over-eager |
| Missing art placeholders | **Leave them.** Loud magenta placeholders act as the to-do list | Build no longer fails; the gap stays visible |
| Visual regression gate | **Gallery baseline + invariants**, deferred until the architecture settled — **now unblocked** | A book baseline needs re-approval so often it decays into rubber-stamping |

---

## Open — needs the owner

- [ ] **Missing art**: `images/chapter-02/cybersurgeon.png`,
      `images/chapter-03/etherlock.png` (3 markdown refs, 2 files). Render as
      placeholders until real art lands.

---

## Open — actionable now

### Verification (highest value — this is the debt that caused the 0.10.0 defects)
- [ ] **Gallery baseline**: freeze `dc-design-guide/09-component-gallery.md`
      (~12 pages, seconds to build) as the approved visual reference. Needs the
      gallery itself reviewed once and signed off first.
- [ ] **Invariant gates** (no baseline needed): nothing painted outside the page
      box, no dead columns, no card split leaving an orphan tab, no literal
      `@markers` in the text layer, no page whose text layer is empty (the
      rasterization tell).
- [ ] **Re-baseline `book-diff.sh`** — still 292pp from many commits ago, gates
      nothing today.
- [ ] **Desktop problems panel**: verified CLI-side only; the Electron app was
      never launched, so the last hop of the chain is unproven.

### Cleanup (mechanical)
- [ ] Stale `.two-column` vocabulary in ~23 non-built files (`docs/`,
      `.archive/`, `.backup/`, `README.md`) and the design guide's own markdown
      reference — they document a vocabulary that no longer exists.
- [ ] Document the new contracts in gutterpress: `.gp-columns-2/3` and the
      `{.class}` marker spelling are in neither `CLAUDE.md` §6 nor the user
      guide. The DC theme's header is updated; core's is not.
- [ ] Duplicate marker warnings on a pre-validated PDF build (one-line gate in
      `build-runner.ts`; deferred to avoid a concurrent-edit collision).
- [ ] Dead `data-break-inside="avoid"` emitted on every skill card, consumed by
      no CSS.
- [ ] `/tmp/failsafe-test-*` leak — `failsafe.test.ts` does not clean up.
- [ ] Stale `.claude/worktrees/` copy of the design guide inside `field-guide/`.
- [ ] Two Paged.js-era AKM knowledge docs
      (`paged-js-043-css-gaps-and-patching`, `fg-overrides-break-control-policy`)
      still advise about an engine this project no longer uses.

### Engineering
- [ ] **Split card's last fragment loses its corner notch** — ends square
      instead of the diagonal cut. Clip-path geometry on the ink layers;
      restructuring, not a break rule.
- [ ] **Outcome ladder cap**: `OUTCOME_TIER_ORDER` has 5 entries, so a 6th row
      silently falls back to `hit` colouring. Silent degradation — the exact
      failure class this release tightened. Warn or support N rungs.
- [ ] **GFM `Roll`/`Outcome` tables force canonical labels** from a fixed map,
      unlike `@outcome` blocks which take the author's label. Inconsistent
      authoring surface.
- [ ] **Placeholder PNG at a non-PNG extension** may not decode (a stand-in for
      `.jpg`). Fix by rewriting the `src` to the placeholder's own path.
- [ ] **#151 — move `printsafe/page-containment` to a build-time DOM check.**
      Implementation design is now on the issue: it belongs in the existing
      in-page audit block in `engine/compiler/build.ts` (no extra round trip),
      as a new `engine.layer.trapped` diagnostic. One decision left — whether
      the CSS-source rule is deleted or kept with an honest scope note.
- [ ] **Audit categories B/C/E** from the layer-boundary audit — resets/undo
      rules, generic behavior stranded in the book layer, duplicate
      definitions. Measured but unchecked by me; the audit was wrong on 2 of
      its 3 headline findings, so verify before acting.

---

## Known-unresolved, low priority

- **`/tmp/.git` writer unidentified.** The damage path is fixed (ancestor walk
  now validates `HEAD`); the cause is not known. If it recurs, the file mtime
  plus the running command pins it immediately.
- **`implicitPage` latent bug** — removed, recorded here in case
  page-assignment is ever genuinely wanted: build it against a measured
  symptom, and remember that `.page { break-before: page }` applies to any
  synthetic wrapper.

---

## Verified-and-closed this cycle

Drop-shadow `filter` removal (71.4s → 5.6s per chapter, text layer restored) ·
`{.class}` marker spelling accepted · fail-loud marker diagnostics + problems
panel · missing images no longer fail the build · junk `.git` no longer
captures descendants · panel chrome inverted to opt-in · column vocabulary
unified · card break quality (tab/body glue, outcome-row atomicity) · dead
`.section.col-split` / `.dc-rules-definition` / `.dc-distance-tags` removed.
