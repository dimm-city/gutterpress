# Remaining work — 0.10.0 native-engine migration

**Living document.** Update it when a decision is made or an item lands; do not
let it drift into a historical record. Spans two repos: `gutterpress`
(this one) and `dc-op-manual` (DC design guide + field guide).

Last updated 2026-08-19.

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
| Sync/conflict model | **Convergent, never interactive** (owner directive 2026-08-14, ADR 0010) | Both-edited text keeps both versions in the file with standard git markers; deletes lose to edits; binaries keep the newer side (images get a non-blocking picker). The conflict dialog, "(online copy)" files, conflict latch, and 16-handler recovery subsystem are DELETED — do not re-expand them "for symmetry" |

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
      - [ ] **The gate was merged and then deleted from `main` by our own sync
            (found 2026-08-19).** It is intact on `origin/refactor/native`
            (90 baseline files under `dc-design-guide/baseline/gallery/`, plus
            `tools/book-diff.sh`, `book-diff-compare.py`,
            `gallery-invariants.py`, `skill-card-fragment-policy.test.py`,
            `field-guide-bottom-art.test.py`) — nothing is lost. See the
            book-repo section below: restoring it is a revert, not a rebuild.
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
- [x] **`--allow-shrink` exposed on the CLI** (2026-08-19): the width guard's
      escape hatch was API-only (`allowShrink`) while its own error message
      told authors to pass it. `gutterpress build --allow-shrink` now
      downgrades offenders to `engine.width.overflow` warnings; the guard
      still fails builds by default.
- [x] **Audit categories B/C/E reconciled** against current source and the
      rendered gallery. Earlier panel/column/dead-rule findings have landed;
      fresh built-DOM counts are recorded in the audit. The two live
      `.two-column-list` instances are component-internal, both obsolete
      generic column classes and both deleted component classes have zero
      matches, and the credits/intro/chapter-opener pseudo suppression only
      matches sections inside explicit panel-policy scopes. The one inert
      `filter:none` reset on `.dc-card-grid` was removed.

---

## RELEASE BLOCKER: our sync reverted the merged migration on dc-op-manual

**Found 2026-08-19. This is a Gutterpress defect, not book debt.**

`refactor/native` **was** squash-merged into `dc-op-manual`'s `main` on
2026-08-15 (`d500a405`, itlackey — confirmed an ancestor of `main`). One day
later a single commit reverted essentially all of it:

> `c84d16e` — 2026-08-16 — **"Snapshot before syncing"** — 161 files changed,
> 4419 insertions, **7203 deletions**

That message is ours: `SYNC_SNAPSHOT_MESSAGE` in
`packages/cli/src/lib/remote-auth/sync-messages.ts:42`. The pre-sync snapshot
committed a stale local working folder over merged remote work and pushed it.
Cumulatively `d500a40..origin/main` differs by 163 files / 7394 deletions.
What that one commit removed:

- the entire release gate — `tools/book-diff.sh`, `book-diff-compare.py`,
  `gallery-invariants.py`, `skill-card-fragment-policy.test.py`,
  `field-guide-bottom-art.test.py`, `dimm-city-plugin.test.mjs`;
- the owner-approved gallery baseline — all 90 files under
  `dc-design-guide/baseline/gallery/` (rasters, `page-count.txt`, `dpi.txt`);
- the CSS fixes, including the `.dc-sidebar.inset` repair. The merged version
  carries the rationale verbatim: *"An inset is still an in-flow float.
  Absolute positioning anchored it to the top of the nearest long-lived
  `@page` wrapper, not to its authored paragraph, so a late sidebar could
  paint over the first physical page of that wrapper."* `main` today is back
  to `position:absolute; top:0; right:-0.15in`;
- book markdown across the field guide and design guide (the gallery chapter
  alone differs by 204 lines).

**This reproduces the fixed defect exactly.** Building today's `main`, the
design guide fails the width guard with 4 offenders (`div.dc-sidebar.inset`
at 842px vs the 828px content box — the 0.15in overhang; three
`h1.dc-chevron` up to 948px), and forcing it through with `--allow-shrink`
renders the inset sidebar painting over the gallery opener on P.98 — the
precise failure the reverted comment describes.

Nothing is lost: `origin/refactor/native` (`915826c`) still holds all of it.

**Owner action — a tested one-revert recovery (simulated end-to-end
2026-08-19; every claim below was measured, not guessed):**

The facts that make it easy: `refactor/native`'s tip (`915826c`) is
byte-identical to the squash-merge tree (`git diff 915826c d500a40` is
empty); `c84d16e` is the *only* mass-deletion commit; and the sum of all
writing since the clobber is three field-guide chapter files plus two new
images. Reverting `c84d16e` on today's `main` auto-merges 160 of 161 files —
restoring the gate scripts, the 44-page gallery baseline, the CSS fixes, AND
the two post-merge itlackey snapshots the clobber had also wiped
(`7e237a7`, `029bd84`) — while keeping every post-clobber edit (the Burning
condition, the new images, all snapshot writing). Exactly ONE conflict
remains, and it resolves itself: keep `main`'s completed sentence in
`chapter-02 7 Technosorcerer.md` ("choose the Practical Power, Reality
Skewer, … abilities") over the pre-clobber unfinished placeholder.

1. **Before anything else**: on the machine whose sync clobbered (`Hern`),
   do not sync again until step 5 — a sync from the stale folder would
   re-clobber the restore.
2. `git branch backup/pre-restore-2026-08-19 origin/main && git push origin backup/pre-restore-2026-08-19`
3. ```
   git checkout -b restore/re-land-refactor-native origin/main
   git revert c84d16e
   git checkout --ours "field-guide/chapter-02 7 Technosorcerer.md"
   git add "field-guide/chapter-02 7 Technosorcerer.md"
   git revert --continue
   ```
4. Verify, then merge to `main` via PR — an ordinary merge, no force-push,
   so no machine's history is invalidated. Verified in simulation: the
   restored tree builds the design guide **strict-clean (width guard
   passes, no `--allow-shrink`, 170pp)** and the previously damaged gallery
   opener renders correctly. Re-run `tools/book-diff.sh` against the
   restored baseline and rebuild the field guide before merging.
5. On the `Hern` machine, pull/sync so the local folder fast-forwards to
   the restored state — only then resume normal syncing.

Until this lands, "both books build clean" cannot be reproduced from
`origin/main`, and the gallery baseline cannot be re-frozen because the
gallery chapter on `main` is not the approved artifact.

**Product action (this repo)** — a pre-sync snapshot must never silently
commit wholesale deletions of files the author did not touch. Working rule 8
applies directly: silent degradation is the expensive failure. The guard has
to live at SNAPSHOT time: once the stale tree is committed on top of the
pulled history, it is simply the newest commit — the sync's merge machinery
sees nothing to conflict on, which is exactly how `c84d16e` sailed through.
At minimum the snapshot path needs to refuse, or require explicit
confirmation, when the tree it is about to commit deletes files that exist
at the remote head and were not deleted by the author's own edits. A
regression test should pin it: local folder stale + remote advanced ⇒ sync
must not push deletions.

### Field guide, measured on today's `main`

Builds clean under the strict gate — 296pp (content has grown since the 273pp
reading), width guard silent, zero literal-marker leaks in the text layer,
the only empty-text pages are three intentional full-art plates (6, 206,
210), outcome ladders render the five canonical tiers, and the two accepted
missing-art placeholders are the only substitutions. Its CSS carries 37
warn-level risky print properties (lint exit 0; rasterization is re-checked
post-build).

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

- **Screen-preview text metrics can differ slightly from native PDF metrics.**
  On the Field Guide's embedded Titillium face, Chromium screen layout measures
  some word advances about 2% wider than raw-CDP `printToPDF`. The preview and
  PDF both total 269 pages after the 0.10 pagination fixes, and the reported
  page-7/pinned-art regressions are resolved, but a few specialty headings can
  move one or two physical pages before the flows reconverge. Chromium's
  `text-rendering`, kerning, and optical-sizing controls do not close the gap;
  a global letter-spacing correction over-compresses later content. Treat this
  as print-metric calibration work, not a reason to add element-specific break
  rules or book typography overrides.
- **`/tmp/.git` writer unidentified.** The damage path is fixed (ancestor walk
  now validates `HEAD`); the cause is not known. If it recurs, the file mtime
  plus the running command pins it immediately.
- **`implicitPage` latent bug** — removed, recorded here in case
  page-assignment is ever genuinely wanted: build it against a measured
  symptom, and remember that `.page { break-before: page }` applies to any
  synthetic wrapper.

---

## Verified-and-closed this cycle

**Fresh-environment re-verification, 2026-08-19** (clean container, Chromium
148.0.7778.96, gs/qpdf/poppler installed): lib suite 1922 pass / 11 skip / 0
fail — the two `bundle-freshness` failures a fresh clone shows are mtime
artifacts, and rebuilding proved the committed engine bundles byte-identical ·
open-design-plugin 7 pass · desktop 2398 pass, eslint + app-token check,
svelte-check 0/0 across 884 files, electron tsc clean · CLI `tsc --noEmit` +
engine-browser tsconfig clean · preview/PDF parity gate PASSES with an empty
allowlist (fixtures 7/7, user guide 68/68, advanced book 14/14 pp) · renderer
purity strict gate OK (148 client files) · release tooling checks pass ·
both books rendered and inspected page-by-page samples. The tool side is
green; the release is blocked on the sync regression recorded above, which
that verification is what surfaced.

Drop-shadow `filter` removal (71.4s → 5.6s per chapter, text layer restored) ·
`{.class}` marker spelling accepted · fail-loud marker diagnostics + problems
panel · missing images no longer fail the build · junk `.git` no longer
captures descendants · panel chrome inverted to opt-in · column vocabulary
unified · card break quality (tab/body glue, outcome-row atomicity) · dead
`.section.col-split` / `.dc-rules-definition` / `.dc-distance-tags` removed.
