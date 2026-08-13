# Remaining work — 0.10.0 native-engine migration

**Living document.** Update it when a decision is made or an item lands; do not
let it drift into a historical record. Spans two repos: `gutterpress`
(this one) and `dc-op-manual` (DC design guide + field guide).

Last updated 2026-08-13.

---

## Decisions made (do not relitigate)

| Decision | Ruling | Why |
|---|---|---|
| Panel chrome on `.section` | **Opt-in.** `.dc-panel` on one element, or `.dc-panel-sections` on a chapter (book policy), `.dc-bare` to opt out | Theme appearance must never key on a class core emits for structure. 191 elements affected; four reset rules existed to undo the default |
| Column vocabulary | **Core owns it.** `.gp-columns-2/3`; the book's `.two-column`/`.three-column` deleted, gutter kept as `--gp-column-gap` | Two names for one thing is what produced the Augmerc defect |
| Core `.section` CSS | **Keep** `:where(.section, figure) > :where(:first-child) { break-before: avoid }` | Break behavior is fragmentation semantics — core's job, not decoration |
| `@section` with no `@page` | **Valid authoring.** Warning and `implicitPage` both removed | Audited: 17/17 occurrences were `.gp-columns-2` layout wrappers, none rendered wrong. Auto-wrapping was implemented, measured, and **rejected** — a `.page` matches every bare `.page` selector, so wrapping silently exposes content to page-scoped rules |
| Skill-card splitting | **Split by default stays**; quality comes from break rules, not from a boolean | `48c381c` flip retained; tab/body glue + row atomicity landed instead |
| Outcome ladders | **Exactly five mechanical d20 rows.** Fixed ranges/tiers/colors; `@outcome` may customize display labels | Count/range mismatches fail loudly; non-d20 five-row lookups use ordinary tables |
| Streetwarden `<br>` | **Leave them.** A `<br>` in a table cell is legitimate markdown | The earlier flag was over-eager |
| Missing art placeholders | **Leave them.** Loud magenta placeholders act as the to-do list | Build no longer fails; the gap stays visible |
| Visual regression gate | **Gallery baseline + invariants**, owner-approved 2026-08-13 | The reviewed 44-page gallery is now the portable release gate; future changes still require an explained diff before re-approval |

---

## Accepted — nonblocking for 0.10.0

- [x] **Missing art**: `images/chapter-02/cybersurgeon.png`,
      `images/chapter-03/etherlock.png` (3 markdown refs, 2 files) intentionally
      render as visible placeholders until the real art lands.

---

## Open — actionable now

### Verification (highest value — this is the debt that caused the 0.10.0 defects)
- [x] **Owner sign-off on the gallery baseline**: the focused 44-page gallery
      manifest and portable 3.7MB baseline were approved on 2026-08-13 after
      review of the final PDF (`sha256 4c16dedcfd6d9b65bfb31c7c4fb820962a210c932caf44acd550aeb56872b73b`).
      The promoted baseline passes the text, raster, and semantic/paint gates.
- [x] **Invariant gates**: page-edge plate paint, populated multicol fragments,
      skill tab/body glue, final-fragment border/notch geometry, marker leaks
      with an explicit code-specimen exemption, and the one intentional
      image-only page are checked alongside text/raster. A static policy test
      also keeps the Field Guide's default split selector aligned with the
      decoration selector; the gallery alone only exercises `.allow-split`.
- [x] **`book-diff.sh` contract**: the committed gallery is the fast default;
      full books are explicit local modes under `.book-baseline/`, so the stale
      local 292-page field-guide baseline cannot masquerade as the release gate.
- [x] **Desktop problems panel**: real Electron E2E proves malformed marker
      file/line navigation and an exported `engine.multicol.dead-column`
      finding through the Problems panel.

### Cleanup (mechanical)
- [x] Stale `.two-column` vocabulary in non-built files (`docs/`,
      `.archive/`, `.backup/`, `README.md`) and the design guide's own markdown
      reference updated to the core vocabulary; distinct `.two-column-list`
      and `.two-column-grid` component names were preserved.
- [x] Core documents `.gp-columns-2/3`, `{.class}` marker spelling, and valid
      bare `@section` authoring in `CLAUDE.md` §6 and the user guide.
- [x] Duplicate marker warnings suppressed on a pre-validated PDF build without
      hiding warnings when no prevalidation result exists.
- [x] Dead `data-break-inside="avoid"` removed from skill-card wrappers; CSS is
      the authoritative card break policy.
- [x] Failsafe tests clean their repository and isolated backup fixtures.
- [x] Stale tracked `.claude/worktrees/` copy and plugin hot-reload snapshot
      removed (recoverable from git).
- [x] Paged.js-era AKM guidance superseded/reframed as history; current native
      fragmentation and field-guide ownership policies are indexed.

### Engineering
- [x] **Split card corner notch**: fragmentable cards use final-slice decoration;
      explicit `.allow-split` cards and the Field Guide's default-splitting
      specialty cards share that rule, while `.no-split` remains atomic. Gallery
      pages 29–30 and real Field Guide pages 49–50 were inspected; final slices
      have their bottom rule/notch and non-final slices remain open.
- [x] **Outcome ladder contract**: exactly five canonical ranges are required;
      malformed counts/ranges throw instead of recycling `hit`. Emphasized GFM
      range cells are normalized without weakening the mechanical comparison.
- [x] **Outcome labels reconciled**: GFM uses canonical labels; `@outcome`
      retains author-supplied display labels over the same fixed five tiers.
- [x] **Placeholder PNG path**: missing images now point to generated `.png`
      assets; real CSS contexts are rewritten without mutating code/script
      specimens.
- [x] **#151 — authoritative build-time DOM check**: `engine.layer.trapped`
      inspects computed live ancestors. The fast CSS-source lint remains with
      an explicit limited-scope message.
- [x] **Audit categories B/C/E reconciled** against current source and the
      rendered gallery. Earlier panel/column/dead-rule findings have landed;
      fresh built-DOM counts are recorded in the audit. The two live
      `.two-column-list` instances are component-internal, both obsolete
      generic column classes and both deleted component classes have zero
      matches, and the credits/intro/chapter-opener pseudo suppression only
      matches sections inside explicit panel-policy scopes. The one inert
      `filter:none` reset on `.dc-card-grid` was removed.

---

## Upstream Chromium gaps — documented, not fixable here

Labelled `upstream` and written up for authors in
[`docs/known-limitations.md`](./known-limitations.md). All three fail
**silently**; each entry carries a workaround and a removal trigger. No shims —
"Chrome wins once it ships."

- [ ] **#149** gradient-only `@page { background }` paints nothing (solid and
      `url()` paint the full sheet)
- [ ] **#150** `box-shadow` and `transform` dropped in `@page` margin boxes
      (`border`/`background` on the same element paint fine)
- [ ] **#152** large rasters dropped from `@page { background }` — bounded at
      450×582 paints / 638×825 dropped; workaround shipped in `dc-op-manual`
- [ ] A maintainer with a crbug.com account should file all three against
      Chromium; our issues stay open as the citable reference and re-test trigger

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
