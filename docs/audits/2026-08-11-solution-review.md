# Solution review — critique of the 2026-08-11 alignment audit's proposed fixes

**Date:** 2026-08-11
**Subject:** `docs/audits/2026-08-11-book-and-examples-alignment-audit.md`
**Scope of this document:** the *proposed solutions and sequencing*, not the findings. Where a finding is re-examined it is only because the fix built on it is affected.

---

## What I would change about this plan (summary)

The audit's diagnosis is strong and its verification discipline (Appendix G, three self-rejections) is better than most audits ever manage. Most of the fixes are the right fixes. Five things need to change before anyone executes it:

1. **The plan's flagship fix may step on the plan's flagship bug.** The proposed brick-wall one-liner (§1) is written as `@page { background: var(--bg) url(...) }` — a `var()` inside an `@page` declaration, in the same audit that proves `var()` in `@page` fails silently two different ways (B1, B2). The Appendix G fixture that "confirmed" `@page { background }` used a **literal hex**, not a token. Nobody has verified that `var()` resolves in `@page { background }` on this engine. Until that is measured — or until the B1/B2 fix resolves custom properties across *all* `@page` declarations, not just `size` and `margin` — step 2 risks shipping a book with no brick wall and no error.
2. **There is no regression harness, and this plan cannot be executed safely without one.** The audit itself demonstrates the stakes: a single `column-fill` rule is worth 3 pages (302pp vs 299pp, §3/B §10), and the parity gate (`packages/cli/scripts/native-parity-gate.ts`) asserts page counts and page maps on *print-md fixtures only* — it makes **no paint assertions** and **never builds the book**. The audit already invented the right instruments ad hoc (byte-identical raster for F3, page-map deltas for §10, x-extent measurement in 6b); the plan never turns them into a gate. Step −1b below fixes that.
3. **The doc rewrite is sequenced to be done twice.** Step 1 rewrites 1,390 lines of governing docs "before doing any further CSS work", then steps 2–3 restructure the very file layout those docs describe (8 files → 5, `native-furniture.css` deleted). Split it: purge the demonstrably false claims now (a ~1-hour edit), write the real docs once, after the structure they must describe exists.
4. **The B1/B2 fix should be specified, and its minimal safe form is "fail loudly", not "resolve `var()`".** The audit says "fix the two bugs" without saying what the fix is. Full custom-property resolution in the page context is the standards-correct end state (the page context inherits from the root element, so `var()` against `:root` is what Chrome itself does), but it touches `gcpm-extract.ts`'s whole parsing model. The shippable step −1 is: **any `var()` the extractor cannot resolve in an `@page` declaration is a hard build error**, killing both silent failure modes in one small change. Resolution can follow at leisure. Per CLAUDE.md, silent wrong-artifact production is the worst failure class this project has; silent fallback to `letter` is exactly that.
5. **One recommendation should be dropped (F6, logical properties) and one replaced with a subtraction** (chapter-class derivation → ancestor selectors on the existing `data-chapter-label`). Details below.

Everything else I would keep, most of it exactly as written.

---

## Per-recommendation critique

### §1 / B §1–§4 — collapse the brick wall to one `@page { background }` rule

**Right call, wrong spelling.** The two-layer paint (html content-box + 14 hand-fed margin boxes) is precisely the kind of Paged.js-era scar tissue the constitution says to delete, the fixture evidence (f2/f3/f8) is solid, and the cascade wins in §3 (sticker fit-content) and §4 (`content: none`) are real simplifications, not new machinery.

Three conditions before execution:

- **Verify `var()` in `@page { background }` first** (see summary point 1). If it silently drops, either use literals with a comment (ugly but safe, same policy as the `size:` literal in F2) or land the extractor fix first. Given the B1/B2 root cause is a lexical `toPt` in `gcpm-extract.ts:448-469`, there is no reason to assume `background` parsing is any smarter.
- **Gate on raster + page map.** This change should be *paint-only*: page count and page map identical, raster identical except margin-band pixels. If pagination moves at all, something else changed and the commit should be split.
- **The gradient caveat belongs in two places, not zero.** The audit says the gradient-paints-nothing behavior (f1) "should be added" to the styling guide but never schedules it, and CLAUDE.md's boundary rulings say to *file upstream Chromium bugs, not maintain corrective shims*. Add both to the sequence: a styling-guide note and an upstream report. §5 of native-furniture (front-matter partial band) stays on margin boxes *because* of this bug — that rule needs a comment naming the Chromium issue as its removal trigger, per "design for deletion".

### §2 — rewrite the two governing docs

**Right target, wrong sequencing and wrong scope.** "Stale doctrine reproduces itself" is exactly correct — the audit's own §3 CORRECTED finding (the `.section { break-inside: avoid }` misread) shows even the auditor got burned by not reading a rationale, and the false `counter-set` / `text-wrap` claims will keep steering authors wrong. But rewriting 1,390 lines against an 8-file layout that steps 2–3 immediately turn into 5 files means writing the architecture chapter twice.

Do instead:

1. **Now (before any CSS work):** delete or strike-through the verified-false claims — the "what Paged.js silently ignores" table, the `.pagedjs_sheet` advice, the Paged.js pipeline framing — replacing each with one line: "obsolete, native engine, see [new doc]". This is the part that must precede CSS work; it is small.
2. **After step 3 lands:** write the real docs once, against the 5-file layout, folding in the new material this audit generated (the gradient caveat, the `var()`-in-`@page` traps until fixed, the §3 margin-box `box-shadow`/`rotate()` gap with its removal trigger).

### §3 / §3b — dissolve `native-furniture.css`; 8 files → 5

**Agree with the dissolution, agree with the target shape, with two execution constraints and one underweighted risk.**

The structural argument (§3b) is the best paragraph in the audit: a file whose only mechanism is "load last and undo" manufactures the L2/L3 undo-pairs, and the L1 split means the book that documents the system doesn't render the system. One engine ⇒ no engine layer. The per-section disposition table is careful — it keeps every VERIFIED-REAL Chromium gap and demands removal-trigger comments, which is "design for deletion" done properly. The 5-file target is also right: merging `page-rules` + `page-templates` + the page half of native-furniture is what actually ends L3/L4, because "every named page lives in one file" is the invariant that prevents the identical-specificity manifest-order coin-flips (A4).

Constraints:

- **Pure-move commits.** Each dissolution commit either *moves* rules verbatim or *edits* rules — never both. Moves must be raster- and page-map-identical by construction; edits (collapsing L2, L3, A10, A12) get their own commits with their own diffs. Otherwise a 3-page pagination shift in a 900-line diff is undebuggable.
- **Cascade-order audit before the move.** native-furniture wins today by loading last. Moving a rule into `dc-components.css` (§13 glue) or `page-templates.css` (§5) changes its cascade position. The audit's zero-`!important` baseline (A22) cuts both ways: fights are fought by qualification, so a moved rule at the same specificity can silently flip winners. The raster gate catches this — which is another reason the gate must exist first.
- **The underweighted risk: descoping `dg-overrides.css` from the field guide.** A16 documents that `dg-overrides` leaks unscoped rules (`.toc`, `.page.credits strong`, `hr`, `.page:is(…) p`) into the field guide *today*. The proposal to remove it from the shared stack means the field guide loses whatever those leaks were doing — and given the file's own SCOPING clause was written *after a leak restyled field-guide `<hr>`s*, some leaks are plausibly load-bearing by accident. Before descoping: raster-diff the field guide with and without `dg-overrides`, and deliberately adopt any wanted rules into `fg-overrides`/shared layers. Do not treat this as a free deletion.

The L5/L6 fixes (fg-overrides violating its own token contract) are straightforwardly right; note L5 is *two* fixes — use the token, and delete or define the phantom `.dc-table` selector.

### §4 / C — plugin shrinks by half

**The deletions are right; the migration mechanics need one decision and one check.**

- **Zero-use macros, aliases, dead `@continue` branch: clean break, no ceremony.** This is a project-private plugin consumed by two books in a sibling repo — there is no public API, no third-party consumers, and a deprecation period would be pure process theater. Delete.
- **The 8 `<div>` wrappers (89 uses): codemod, not hand edits, not a shim.** The rewrites are line-anchored and mechanical (`@sidebar` → `@section .dc-sidebar`, `@end-sidebar` → `@end-section`, etc.) — a 20-line script, run once, verified by page-map + raster equality. A compatibility shim would keep 8 macros alive to avoid a one-afternoon sed, which is exactly the complexity CLAUDE.md forbids. **But one check first:** the named end markers (`@end-sidebar`, `@end-lede`) are mispair-proof; generic `@end-section` is not. If any of the 89 sites nests a wrapper macro *inside* an `@section` (or vice versa), converting both to `@section`/`@end-section` pairs creates ambiguity core has to resolve by nesting depth alone. Grep for nesting before running the codemod; any nested site gets converted by hand with eyes on it.
- **The two HIGH correctness fixes (unescaped `class`/`variant` interpolation, invalid `name=` on `<div>`) do not belong in step 4 — they belong beside step −1.** They are five-line bug fixes with zero dependency on anything else in the plan; the escaping one is an injection bug in a plugin that will keep being loaded through every intermediate state of this refactor. Fix them first.
- **`@continue` deletion needs one clarification the audit skips:** the 17 dead uses fall through to core's `continue` marker handling. Deleting the branch is safe, but the *author-facing* question — what do those 17 call sites now mean, and is core's section-continue what the author wanted there? — is unanswered. Since the working idiom is `@skill {.continued}` (4 uses), the codemod should also decide the 17 sites: convert to `{.continued}` where a continuation tab was intended, delete where it wasn't. Don't leave 17 markers whose meaning changed by accident.
- **`parseAttrs` drift (C MED): the audit under-solves it.** "Same syntax, different behavior depending on which parser sees it" will regress again after any future `parseMarkerLine` change, because inline-copies drift by nature (CLAUDE.md §5 mandates the copy; it doesn't prevent drift). Add the missing piece: a small fixture in the book repo asserting the plugin's parser matches core on a shared set of marker lines, so the next drift fails a test instead of an author.

**Keep-list: agree**, including keeping `@specialty` as a wrapper-only macro despite the delete-wrappers rule — at 49 uses it is the book's central vocabulary word and C.1 keeps it; consistency purists will notice it is a `<div class=X>` wrapper too. If it stays (it should — 49 hand edits for zero semantic gain is churn), say *why* in the plugin header: usage weight, not mechanism.

### §5 — stat blocks → markdown tables

**Right, and the audit already rejected the wrong alternative implicitly.** A `@npc` macro would grow the plugin the same week step 4 shrinks it; the auto-classified GFM table (the `Roll`/`Outcome` precedent) is the established pattern. One execution note: the existing `.dc-npc-stat` CSS at `dc-components.css:3655` styles the *div tree*; the table form needs its own styling pass, so this is a small CSS task plus a raster compare of chapter-04, not a pure markdown edit. Budget it as such.

### §7 — standards modernisation

- **F3 (`margin-inline` out-dent): agree.** Byte-identical raster, verified; the book is horizontal-tb LTR so logical inline = physical left/right; and the audit already correctly walls off the one place physical must stay physical (`:left`/`:right` binding margins).
- **F4 (`--content-width`/`--content-height` tokens): agree, with a hard scoping rule the audit misses.** Until B1/B2 are fixed *and* verified for every `@page` declaration, these tokens are safe **only in normal rules** — never inside `@page`, where the same silent-fallback trap awaits. F2 already made `size:` a documented no-tokens zone; extend that comment to say "no `var()` anywhere in `@page` until engine fix X", and lift it when the fix ships. Otherwise the new tokens are a loaded gun placed next to the trigger.
- **F5 (unban `:is()`/`:has()`): agree** — but fold it into the file-restructure commits rather than doing a standalone selector-collapse pass over files about to be merged.
- **F6 (57 physical → logical properties): DROP.** This is the one recommendation where cost clearly exceeds benefit. The book is a single-language LTR *print* artifact whose most safety-critical margins the audit itself says **must stay physical** (mirrored binding). Converting 57 declarations buys nothing observable, guarantees a half-converted codebase (F6 is already marked "partial"), and mixes two coordinate vocabularies in files where physical mirroring is load-bearing — a worse reading experience than consistent physical. Logical properties earn their keep in reusable libraries and i18n surfaces; `fg-overrides.css` is neither. Adopt logical properties in *new* rules if desired; do not run a conversion pass.
- **F7 (drifted `rgba()` → `color-mix`): agree** — this fixes three live bugs, and the do-not-convert list for the WCAG-annotated hexes is exactly the right restraint.
- **F9 (`aspect-ratio`): the drift is the bug, the property is optional.** Fix 0.88→0.90; convert to `aspect-ratio` only if touching the rule anyway.
- **F10 (`deprecated.css`): agree**, trivially.

### §5 (authoring) — ergonomics items

- **Chapter-class derivation: replace with a subtraction.** The audit proposes deriving `.chapter-NN` from the enclosing `@chapter` — which means *adding plugin behavior* in the same plan that halves the plugin. There is a zero-mechanism alternative: the chapter wrapper already carries `data-chapter-label` (the frozen chapter-opener contract, `markdown-it-paged.js`), so book CSS can scope per-chapter styling with `.chapter[data-chapter-label="1"] .page { … }` and the ~50 retyped `.chapter-NN` tokens just get deleted, with nothing generated in their place. Prefer removing the need for the class over automating its production.
- **`.allow-split` default flip (39+4 sites): right change, most dangerous change.** Inverting a break default on a 300-page book is deliberate pagination churn across every specialty chapter. The audit correctly puts it last; sharpen that: it lands **alone**, in its own commit, gated on a page-map diff that a human reviews page by page. Nothing else may share that diff.
- **Idiom picks (blockquote over `@dm-note`, table over `@outcome`), `@procedure` fail-loudly, `@card` blank-line parser fix, rename one `@continue`: all agree.** These are exactly "one way to say each thing". Note the `@outcome` pick contradicts C.1's "Keep, dedupe" verdict for `@outcome` — the body's pick (the table) is the right resolution; make sure step 4's keep-list is updated to match so the two halves of the audit don't ship conflicting instructions.
- **The `{.bottom}` straggler (`chapter-01.md:103`): fix in passing**, it's one token.

### §6 / E — examples and fixtures

**All agree; also the only fully parallelisable workstream.** The dead `engine: paged` fixture, the two unmatchable `.pagedjs_sheet` rules, and the prose sweep touch nothing the book steps touch and can start today. One caution: the two `guide.css` fixes replace a dead rule with `@page { background: var(--color-paper) }` — the same `var()`-in-`@page` verification from §1 applies; `examples/with-design-guide/design-guide` is a **load-bearing parity fixture**, so a silently-unpainted background there is at least visible to the gate's page-map… actually it isn't, because the gate asserts no paint. Use a literal or verify first, same rule as the book.

### §7b — containment lint gap

The audit diagnoses it (`isolation: isolate` on `.section` would trap `.gp-behind`, invisible to `printsafe/page-containment`) and then the sequence drops it entirely. Of the two options offered, **build-time checking on the live DOM is the right one** — "let a book declare its wrapper selectors" adds author-facing configuration for a lint, which is a knob CLAUDE.md's subtract-first rule says must earn its place, and the engine already has the natural home (`engine.abspos.leak` operates on the real ancestor chain, where no declaration is needed). File it as an engine issue in the same batch as B1/B2; it need not block the book work, but it must not evaporate.

---

## What is missing from the audit

1. **A regression gate for the book itself.** The parity gate never builds the book, asserts nothing about paint, and lives in a different repo. Before step 0: a small script in dc-op-manual that builds both books and emits (a) page count, (b) the per-id/per-heading page map the engine already produces, (c) per-page rasters (`pdftoppm`) diffed against the previous run. The audit already used every one of these instruments by hand; the plan just needs them to run on every step. The checked-in `field-guide-2026-08-04.pdf` at the repo root is a ready-made day-zero baseline.
2. **Rollback strategy.** Trivially achievable and unstated: one step per commit (moves separate from edits, per §3 above), baseline artifacts kept per step, and any step whose page-map diff is unexplained gets reverted, not patched forward. Nothing in this plan is a true one-way door — the risk is not irreversibility, it is *silent drift*, which only the gate prevents.
3. **Proof-by-rebuild for step 0.** The audit says "do it first and look at the result" — right, but underspecified. Loading native-furniture into the design guide will change its rendering on every page (that's the point); the look must be a real visual review, with screenshots resized per the repo's own review rule (CLAUDE.md §0b), and any newly-surfaced divergence triaged before step 2 begins, because step 2's raster baseline is otherwise polluted.
4. **Engine-fix verification scope.** B1/B2 fixes need fixtures in the engine repo covering `size`, `margin`, **and `background`** (and ideally every `@page` descriptor the extractor parses), plus a test that unresolvable `var()` hard-errors. The audit names the root cause precisely (`gcpm-extract.ts:448-469, 525`) but never asks for the regression tests that keep it dead.
5. **Upstream filings.** Two measured Chromium behaviors (gradient-only `@page` backgrounds paint nothing; `box-shadow`/`rotate()` dropped in margin boxes) meet the constitution's "file upstream bugs" bar. Neither is scheduled.

## What should NOT be done (beyond the audit's own three rejections)

- **F6, the logical-properties conversion pass** — dropped, per §7 above. This is the audit's one recommendation where the "legacy" thing (consistent physical properties in a physically-mirrored print book) is actually the better engineering.
- **A compatibility shim or deprecation period for the deleted macros** — the question the task raises answers itself: two in-repo consumers, a mechanical codemod, and a page-map gate make a clean break strictly better. A shim is 8 macros of permanent complexity purchased to avoid one scripted afternoon.
- **Do not fold `@specialty` into the wrapper purge** for consistency's sake — 49 sites of the book's core vocabulary, zero behavioral gain.
- **Do not delete the 13 unreferenced `dc-components.css` utilities** — the audit already ruled correctly (Verification notes: documented author-facing span utilities in a reuse-contract library), recorded here so a future "dead code" pass doesn't re-litigate it.
- **Do not tokenize anything inside `@page`** until the engine fix lands and is verified per-descriptor — including the audit's own proposed §1 rule and the E-table `guide.css` replacements.

---

## Revised sequence

Steps marked ∥ can run in parallel with the main line.

| # | Step | Change from audit | Gate |
|---|---|---|---|
| −1a | Engine: unresolvable `var()` in any `@page` declaration → **hard error**; regression fixtures for `size`/`margin`/`background`; file the two Chromium upstream bugs; file the 7b containment-lint issue | Specifies the fix; extends it to all descriptors; adds tests + filings | engine tests |
| −1b | Book repo: build-and-diff harness (page count, page map, per-page raster) + baseline from current tree / `field-guide-2026-08-04.pdf` | **New** | harness runs green on unchanged tree |
| −1c | Plugin: fix the two HIGH bugs (attr escaping, `name=`→`data-name`) | Pulled forward from step 4 | build + raster identical |
| 0 | Design guide loads what the field guide loads (L1); full visual review of the result (resized screenshots); re-baseline | Adds the review + re-baseline | human review |
| 1 | Docs: **falsehood purge only** (strike the false Paged.js claims; one-line redirects) | Split — full rewrite moves to step 3c | doc-only |
| ∥ 6 | Examples/fixtures sweep (dead paged fixture, `.pagedjs_sheet` rules — literals until −1a ships, prose) | Parallelised from day one | parity gate stays green |
| 2 | Brick wall → one `@page` rule (token only if −1a shipped and `background` verified); simplify §3/§4 | Adds the `var()` precondition | raster: margin-band-only diff; page map identical |
| 3a | Dissolve native-furniture + 8→5 restructure as **pure-move commits**; `:is()`/`:has()` collapses (F5) ride along | Merges §3 and §3b into one motion; move/edit separation | raster + page map identical per commit |
| 3b | Collapse the undo-pairs and duplicates (L2, L3, A10, A12, L5, L6) as **edit commits**; descope `dg-overrides` from the field guide **after** a with/without raster diff and deliberate rule adoption | Adds the dg-overrides safety check | raster diff reviewed |
| 3c | Full governing-doc rewrite against the 5-file reality, folding in this audit's new caveats | Moved from step 1 | doc-only |
| 4 | Plugin deletions via codemod (nesting check first; decide the 17 `@continue` sites explicitly); parser-parity fixture for `parseAttrs` | Adds codemod, nesting check, drift test | page map identical |
| 5 | Stat blocks → tables (+ the small `.dc-npc-stat` CSS pass) | Budgets the CSS work | chapter-04 raster review |
| 7a | Ergonomics: ancestor-selector chapter scoping (delete `.chapter-NN`, add nothing), idiom picks, `@procedure` fail-loud, `@card` parser fix, `{.bottom}` straggler | Chapter classes: subtract instead of derive | page map identical |
| 7b | `.allow-split` default flip — **alone, last** | Isolated | human page-map review |
| — | F6 logical-properties pass | **Dropped** | — |

The shape of the argument: the audit ordered steps by *value*; this ordering adds the two things value-ordering skips — every paint-affecting step is preceded by the instrument that can see it, and every `var()`-in-`@page` proposal is preceded by the engine change that makes it safe to write.
