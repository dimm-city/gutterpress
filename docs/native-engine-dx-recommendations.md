# Native-engine DX recommendations — making styling unsurprising

> **Status: IMPLEMENTED, with two rejections — see the per-item notes.**
> #1-#7, #9 and #11 shipped on `claude/folio-pagination-spike-onknc6`.
> **#10 was implemented, measured, and reverted** (its premise was wrong —
> see the item), and **#8 was reverted with it** (shared delivery vehicle).
> Cross-cutting requirement A (surfacing) is now met: every author-facing
> finding flows to the desktop Problems panel as a typed diagnostic.
> Originally produced 2026-08-08 as a proposal by a multi-agent
> review/debate/synthesis over `docs/native-engine-styling-guide.md`,
> `dc-op-manual/dc-design-guide/css/native-furniture.css`, and
> `packages/cli/src/engine/`. Independently re-verified by hand afterward:
> `setEmulatedMedia` is absent from `packages/cli/src/` and
> `packages/desktop/src/`; the `PAGED_CSS` `.section { break-inside: avoid }`
> default is at markdown-it-paged.js:790 (the body below says 786 —
> off-by-four, same rule); the `.full-bleed` `--pagedjs-margin-*` 0px
> fallback, the xref `targets` folding at build.ts:249, the width-check
> left-edge skip at build.ts:594, and the viewer's `.gp-strip > *
> { break-inside: auto }` counter-rule all check out as described.
> Companion doc: `docs/native-engine-styling-guide.md` (the measured gotchas
> these recommendations address).

Ground rules applied: engine-layer beats per-book CSS; core (`PAGED_CSS`, all three render paths) beats native-only; detection beats auto-fix where Chromium behavior is versioned; a *primitive the author writes instead* beats a *warning after they wrote the wrong thing*. Ranked by (surprise removed) / (cost).

Verified against source before ranking: `Emulation.setEmulatedMedia` appears **nowhere** in `packages/cli/src/`; `PAGED_CSS` (markdown-it-paged.js:786) ships `.section { break-inside: avoid }` and a `.full-bleed` built on `--pagedjs-margin-*`, whose own comment admits it "degrades to plain full-width outside a Paged.js render"; `build.ts:249` already folds every `#`-href into `targets`; `build.ts:594` skips any box with `right <= LIMIT && r.width <= LIMIT`.

---

## 1. Emulate print media for the audit phase (prerequisite, not a feature)

**Kills:** nothing directly — it makes every existing and proposed DOM check *true*. Today `findWidthOffenders`, `auditContent`'s overheight/DPI pass, and `predictPageMap` all read **screen** computed styles while `printToPDF` renders under **print**. Any book with layout inside `@media print` (i.e. the normal thing) is audited against a document that is not the one printed.

**Mechanism:** one CDP call — `Emulation.setEmulatedMedia({ media: "print" })` around the audit/measure phase in `shared/cdp.ts` / `compiler/build.ts`, restored like the viewport override already is.

**Lives:** CDP setting, engine.

**Opt-out:** none needed; it makes measurement match output. If it changes existing audit results, that is the bug surfacing.

**Open:** does it perturb `predictPageMap`'s fixpoint (it should *improve* it — measure and print then agree)? Re-run the field guide and diff page counts before/after.

**Do this first.** #4, #5 and the multicol check are untrustworthy without it.

---

## 2. `.page, .spread { position: relative }` in PAGED_CSS

**Kills:** §3, the worst gotcha — an abspos element with no positioned ancestor resolves against the document canvas and paints clipped on the last page of a 300-page book while its own page renders empty. `native-furniture.css:320-357` is 38 lines of per-book re-seating that this deletes.

**Mechanism:** two declarations added to `PAGED_CSS`. Gutterpress *emits* `.page`/`.spread` (from `@page`/`@section` markers), so this targets markup the core plugin owns. Under Paged.js the page div is already the containing block → **no-op there**; this is engine convergence, not a native-only hack (CLAUDE.md §0).

**Lives:** core `PAGED_CSS` (all three paths: Paged.js, native, viewer). **Not** the native compiler — a native-only reset makes the live preview lie about print, which is worse for a non-technical author than the original bug.

**Honest framing:** this does not make abspos *correct*; it makes failure **local instead of catastrophic**. A `.page` may span several sheets, so `bottom: 0` still is not a sheet edge. Sell it as blast-radius containment.

**Opt-out:** author CSS wins (PAGED_CSS is injected after author sheets at equal specificity, so use `:where(.page, .spread)` if you want author rules to win at *any* specificity — recommended). Escape hatch is one rule setting it back to `static`.

**Open:** it creates a stacking context — z-index relationships that crossed page boundaries change. Needs a fixture. Cannot help abspos inside author-authored raw HTML Gutterpress didn't emit; #5 covers that.

---

## 3. Broken cross-reference href validation

**Kills:** §7 — `target-counter()`/`target-text()` pointing at a typo'd anchor renders a blank or wrong page number, silently. This is the single most likely mistake a non-technical author makes, and today it fails invisibly.

**Mechanism:** `build.ts:249` already does `for (const s of sites) if (s.href.startsWith("#")) targets.add(s.href.slice(1))`, and line 401 already prints `N/targets.size targets resolved`. Turn that count into names: after instrumentation, any xref href with no matching id in the DOM → warning naming the exact reference. Skip non-bare-fragment hrefs (`other.html#x`, absolute URLs).

**Lives:** engine check, `compiler/build.ts`.

**Opt-out:** none needed — an id exists or it doesn't. ~100% precision.

**Open:** none material. Ship it.

**Cost:** a set-membership test on data already in hand. Best ratio in the slate.

---

## 4. Fix the two live holes in the existing width check

**Kills:** §2's residue. The check is already the reference implementation (hard error + `allowShrink`, warning for the intrinsic class, `img.decode()` awaited) — but it has a measured gap: `build.ts:594-595` skips when `right <= LIMIT && r.width <= LIMIT`, so a box protruding off the **left** edge (negative `left`, ordinary width) is never flagged, though left protrusion triggers the same whole-document shrink.

**Mechanism:** add `r.left < -1` to the flag condition. Second, upgrade the message to name the offending selector **plus the one-line fix**, so the warning is the documentation.

**Lives:** engine check.

**Opt-out:** existing `allowShrink`.

**Explicitly record in the docs:** there is **no CDP flag** that disables Chromium's oversize-content fit-to-page. `Page.printToPDF`'s `scale` is a separate multiplier. "Different Chromium settings" cannot solve §2 — stop anyone burning a cycle on it.

---

## 5. Abspos containing-block leak detector

**Kills:** §3 for the cases #2 cannot reach (raw HTML, nested wrappers, and — after #2 — anything whose offsets resolve outside the current fragment).

**Mechanism:** a third, independent pass (not an extension of pass 2, which is replaced-element intrinsics). Five lines, not an ancestor walk: `getComputedStyle(el).position === "absolute" && (el.offsetParent === null || el.offsetParent === document.body)`. Exclusions are mandatory: engine-injected DOM (`#gp-instrumentation`, viewer `.gp-layer`/decorate chrome are abspos by design) and `display:none` subtrees. Non-blocking warning, same `desc()` selector string the width passes use. **`position: absolute` only** — `fixed` has no containing-block story worth explaining; if it warrants anything it is a flat "don't use fixed in print" line, not this check.

**Message states the mechanism, not a predicted page.** "positions against the whole document, not the page it appears on in your markdown" — the compiler does not know where an unfragmented abspos box paints, so do not print "page 300 of 300".

**Lives:** engine check.

**Interaction with #2 (the debate caught this; the original proposals contradicted each other):** once every `.page` is positioned, `offsetParent` finds it and this check goes silent. Scope it to fire when `offsetParent` is a `.page`/`.spread` **that fragments across sheets** — the engine already knows fragmentation from `fragmentDocument()`/`predictPageMap()`. Adopting #2 without this rescoping silences #5.

**Opt-out:** warning only, never an error.

---

## 6. Subtract `.section { break-inside: avoid }` from core

**Kills:** §5's dead-column collapse — **a default we planted**, not a Chromium quirk. `PAGED_CSS:790` sets it and injects after author sheets, so it wins at equal specificity; `native-furniture.css` §10 and §13 exist only to undo it (`.two-column .section { break-inside: auto }`). The viewer already disagrees with core (`viewer.css:34` sets `auto`) — the three paths are not self-consistent today.

**Mechanism:** drop the blanket `avoid`; replace the intent with `:where(.section, figure) > :where(:first-child) { break-before: avoid }` — the empty-first-fragment glue from `native-furniture.css` §13, which achieves keep-together's real goal without the taller-than-a-column failure. Minimum viable version if full removal is too scary: `:where(.col, [class*="-column"]) .section { break-inside: auto }`.

**Lives:** core `PAGED_CSS`.

**Opt-out:** authors who want keep-together write `break-inside: avoid` themselves — and it will now actually be theirs.

**Open:** this changes pagination of every existing book. Gate on a fixture + a field-guide re-render page-count diff.

**Documenting a workaround for a default we shipped is the wrong response** (CLAUDE.md §0 + "subtract before you add").

---

## 7. The safe default reset — and it is small

**Kills:** §4/§6 heading orphans and figure splits; deletes `native-furniture.css` §7/§11/§13.

**Mechanism, in full, in `PAGED_CSS`:**

```css
:where(h1,h2,h3,h4,h5,h6) { break-after: avoid; }
:where(img, svg, video) { max-width: 100%; }
:where(p > img:only-child, figure > img) { width: 100%; height: auto; object-fit: contain; }
:where(.section, figure) > :where(:first-child) { break-before: avoid; }
```

Note `break-after: avoid`, **not** `avoid-page` — `avoid-page` does not suppress *column* breaks, and multicol is a first-class construct here (`@column-break`, `.col`). The field guide used plain `avoid` deliberately.

`:where()` means specificity 0, so any author rule of any specificity wins and the existing after-author injection point is reused — **no second injection point**. This is print tradition (LaTeX, browser UA sheets), not Chromium quirk-tracking; it survives a Chromium bump.

**Lives:** core `PAGED_CSS`, all three paths.

**Opt-out:** one rule at any specificity. Document `break-after: auto` on headings and `width: auto` on block images as the two overrides.

**Rejected from this set, deliberately** (see the do-NOT list): global `img { width: 100% }`, global `figure { break-inside: avoid }`, global `column-fill: auto`.

**Open:** does the `p > img:only-child` rule need a max-height cap to fit the content box? The field guide's real rule (`native-furniture.css` §9) is about `max-height` + `object-fit`, not width. A max-height cap can only come from synthesis (#8) since it depends on page geometry — decide whether that ships here or there.

---

## 8. Margin-band background synthesis from one declaration

**Kills:** §1 — `native-furniture.css:41-56` is fourteen hand-copied identical margin-box rules to paint one texture across the margin band. This is exactly "make handling page layout trivial" / "non-technical users style by setting CSS custom properties" failing.

**Mechanism:** tier-2 already synthesizes geometry CSS and injects via `addCss` (`build.ts:136-141`), and `gcpm-extract` already parses which margin boxes the author declared. One authored `@page` custom property expands to the 16 margin-box background rules — emitted **only** for boxes the author left undeclared.

**Lives:** engine transform (tier-2 CSS synthesis), not the reset.

**Opt-out:** **must be opt-in.** Defaulting margin-box paint breaks every book expecting white margins and collides with authors' own `content: ""` overrides. Declaring the property is the opt-in; declaring a margin box yourself is the per-box opt-out.

**Open:** what is the property name and does it also need to cover the bleed band? Does the Paged.js leg get the same synthesis (it must, or the preview lies)?

---

## 9. Fragmenting-multicol `column-fill` warning

**Kills:** §5's dead right column on every non-final page — silent, and it hits the most ordinary two-column book.

**Mechanism:** the engine already knows fragmentation (`fragmentDocument()` / `predictPageMap()`). Warn only when a container with `column-count`/`columns` computes `column-fill: balance` **and actually fragments across sheets**. One-line fix in the message: add `column-fill: auto`. This is a separate, explicitly-scoped query — do **not** relax `auditContent`'s `el.children.length === 0` leaf guard to reach it, or every wrapper div in a 300-page book becomes a candidate.

**Lives:** engine check. Requires #1.

**Opt-out:** warning only.

**Open:** none serious — `balance` is the initial value, the fragmenting case is deterministically wrong, and the fix is spec-stable.

---

## 10. ~~`--gp-margin-*` so `.full-bleed` works on the native engine~~ — REJECTED ON MEASUREMENT, SUPERSEDED (2026-08-09)

> **Update 2026-08-09: shipped, by the named-page route this item already
> called out below, not by the rejected variable-rename route.**
> `.full-bleed` now carries `page: gp-full-bleed` plus a core-owned
> `@page gp-full-bleed { margin-left: 0; margin-right: 0; }`, alongside the
> existing `--pagedjs-margin-*` out-dent (kept, not deleted). Native honours
> the named page and bleeds via the content-box-is-the-sheet mechanism
> described below with zero shrink; Paged.js ignores the unsupported named
> page and keeps using the out-dent, so its output is unchanged. The two
> mechanisms don't conflict because each engine only recognizes one of them.
> The out-dent was NOT deleted, unlike the "Paged.js-removal deliverable"
> framing below assumed — Paged.js is still a supported `--engine paged` leg,
> so removing its only working mechanism was out of scope; that deletion
> remains a real Paged.js-removal cleanup. Known gap, documented not fixed:
> the bleed page's running head/folio move onto the trim line under native
> (margin boxes follow the page's own now-zero margins) — see
> `docs/native-engine-styling-guide.md` §9 for the one-line author remedy.

**Implemented, measured, reverted (2026-08-08).** The finding that
`.full-bleed` silently no-ops natively is real, but the proposed fix rests on
a false premise: that the class fails only for want of the margin values.
Supplying them makes the element out-dent to the sheet edge, and that is
itself the shrink-to-fit trigger — the threshold is the page CONTENT box, not
the sheet. Measured (Chromium 148, 6×4in sheet, 0.75in margins, by the width
of a fixed text run): inside the content box 204.4pt (no shrink); out to the
sheet edge 182.9pt (whole book scaled ~10%); past the sheet 171.7pt (~16%).

So the "fix" converts a silent no-op into a silently scaled book, and trips
the pre-print width check (#4) as a hard build error on any book using the
class. The only native mechanism for edge-to-edge art is a named `@page` with
zero side margins, so the content box itself reaches the paper edge and
nothing out-dents. A real native `.full-bleed` must be built that way — which
is a different piece of work, not a variable rename.

Recommendation #8 (margin-band background synthesis) was reverted alongside
it: its only delivery vehicle was the same tier-2 emission, and shipping an
unused synthesis path is the speculative complexity the mandate forbids. The
gotcha it addressed (16 hand-copied margin-box rules) stands unfixed and is
worth revisiting on its own.

**What replaces it (measured, not yet shipped).** Native full-bleed IS
achievable — just not by out-denting. A named zero-side-margin page works:

```css
@page full-bleed-art { margin-left: 0; margin-right: 0; }
.full-bleed-art { page: full-bleed-art; width: 100%; max-width: none; }
```

Verified on Chromium 148: the art reaches both paper edges and the shrink
probe stays at the clean 204.4pt (no scale-down). The blocker to shipping it
as core's `.full-bleed` is cross-engine: measured, **Paged.js does not honour
the named page** in this shape (the image stayed at content width, 4.5in of a
6in sheet) while native does — so a single shared rule cannot serve both
legs, and core CSS is shared by all three render paths. **This is a concrete
Paged.js-removal deliverable**: when the polyfill leg goes, reimplement
`.full-bleed` this way and delete the `--pagedjs-margin-*` out-dent
entirely — one mechanism, no custom properties, and the class stops being
the silently-dead primitive it is today.

## 11. Margin-box unsupported-property lint

**Kills:** §1's silently-dropped `transform`/`box-shadow` inside `@top-*`/`@bottom-*`/`@left-*`/`@right-*`.

**Mechanism:** ~10 lines inside `printsafe.ts`'s existing `walkAtRules`, folded under the existing `ruleRiskyProps` id — no new rule id, no new pass. Scoped to declarations nested in an `@page` margin-box at-rule. Warning.

**Lives:** build check (postcss).

**Opt-out:** warning only.

**Open:** margin boxes are ordinary boxes per CSS Paged Media; Chromium's non-support is an implementation gap, not a spec decision. The day it lands, this lint tells authors a working declaration is ignored. Worth it only because the cost is near zero — and it should be the first thing deleted on a Chromium bump.

---

## Cross-cutting requirements (not optional; ship with any of the above)

**A. Surfacing.** Items 3, 4, 5, 9, 11 all land in `notes`/`log()` — a CLI stream. The target user is in the desktop app. Five new warning classes on a stream they never read is not an author-facing lever. Decide the surface **before** adding checks: one aggregated "print quality report" the desktop renders, and drop any check that cannot earn a line in it.

**B. Fixtures, or it didn't happen.** Every default here changes pagination of every existing book. Promote §10's ~5s `--print-to-pdf` + `pdftoppm`/`pdfimages -list` technique from a debugging tip to a **regression corpus**: one synthetic fixture per adopted item demonstrating the gotcha before and its absence after, plus a field-guide re-render confirming no page-count churn. Ship nothing on reasoning alone — the doc's own first rule.

**C. Three render paths.** Paged.js, native, **and the live viewer**. Anything in #2, #6, #7 goes in `PAGED_CSS` or is rejected. A native-only reset destroys the leg-diffing the doc's §9 depends on for migration, and makes the preview lie.

**D. The real product metric is `engineStyles: { native: [...] }` line count.** Every rule in `native-furniture.css` that is a Chromium *behavior* rather than a design *choice* is an unfixed engine bug. When native becomes the default engine, that key should be **deleted**, not generalized.

**E. Desktop Chromium is ungated.** `REQUIRED_MILESTONE` pins the CLI to Chromium 151, but the desktop app prints via Electron's own Chromium (`webContents.printToPDF`, ADR 0002), which that gate cannot reach. Any engine auto-fix keyed to a 151 behavior is silently unverified on the desktop path. This is the structural argument for detect-and-report over DOM/CSS rewrite: **a detector fails safe on any Chromium; a rewrite becomes wrong.**

**F. Build cost.** #5 and #9 add document-wide walks with `getComputedStyle` to a pipeline that may print a 300-page book four times in the tier-3 fixpoint. Cheap relative to printing — but measure, and decide whether audits belong behind a flag for iteration builds.

---

## Do NOT do

- **Global `img, svg, video { width: 100% }`.** Blows up every inline badge, icon, and glyph `<svg>` a markdown author writes — a new surprise in the common case to fix an uncommon one. The field guide never did this; its real rule is scoped `max-height`/`object-fit` on standalone block art. (And `max-width: 100%` is *measured* not to stop the shrink-to-fit trigger, so the "harmless" version doesn't even work.)
- **Global `figure, img { break-inside: avoid }`.** Reproduces the exact §5 disaster: inside a multicol whose child exceeds a column, Chromium drops it whole and kills the neighbour. That is the dead-column collapse the book had to *undo*. Every multicol book would inherit the bug by default.
- **Global `column-fill: auto`.** `balance` is correct and is the initial value for the common single-page multicol; a global `auto` visibly ragged-ifies every ordinary two-column layout. Warn when it fragments (#9); never default.
- **`break-after: avoid-page` instead of `avoid`.** Does not suppress column breaks. Multicol is first-class here.
- **A blanket static `margin-top/bottom: auto` lint.** In block flow `auto` computes to 0 and does nothing — the fragment-swallowing only happens to flex/grid *items*, which a postcss declaration walk cannot see. Matching `margin-top` misses `margin: auto` (false negatives); expanding the shorthand warns on the most ordinary image-centering idiom in existence (false positives). The repo already learned this: `findWidthOffenders`' comment records a broader min-content heuristic producing measured false positives and being scoped back. If this must be caught, catch it in the DOM audit where the facts exist.
- **A flex/grid taller-than-a-page warning.** Same measured false-positive class ("a 2524px offender on a book whose real print is uncompressed"), *plus* it requires relaxing `auditContent`'s leaf guard — a change in the pass's character, not a parameter. Worst Chromium-coupling risk in the slate: Blink is actively implementing block fragmentation of flex and grid, so "flex/grid do not reflow across page breaks" is a claim about one version that will become both wrong and load-bearing. The proposed carve-out ("skip on margin:0 full-page templates") is heuristic mush suppressing noise the check itself created.
- **A blanket `position: fixed` warning.** Duplicates #5 with strictly worse precision (a static walk can't see `@media screen`, component libraries, or desktop preview chrome). Two checks, one bug, is what the reduce-complexity mandate exists to prevent.
- **Auto-rewriting author `break-inside` after a `column-span` spanner.** Crosses `build.ts:102`'s "never rewrite author markup/CSS" contract and produces output the author didn't ask for. Docs, or nothing.
- **A second, before-author CSS injection point.** `PAGED_CSS` deliberately injects *after* user sheets so the layout contract wins at equal specificity (markdown-it-paged.js:760-762). `:where()` makes source order nearly irrelevant — reuse the existing sheet. One mechanism, not two.
- **Chasing a CDP flag for shrink-to-fit.** None exists. `scale` is an unrelated multiplier.
- **Per-property prose for every member of `riskyProperties`.** `filter` earned its bespoke message with a measured 57.0s→6.2s number. Giving `clip-path` the same starts a treadmill; the generic message already names rasterization.
- **Shipping `docs/native-engine-styling-guide.md` as the answer to anything.** It is an engine-developer field report; non-technical authors will never read it. "Documentation" is a legitimate lever here only when the documentation **is the error message** or the authoring guide.
