# Field-Guide Migration Plan: Skeptic Review

35 findings across 8 categories. Read before acting on any migration plan item.

**Highest-priority killers** (fix these five first — they collapse ~80% of implementation friction):
- #1: P0-2/P0-3 blockers don't exist — delete them
- #2: `.dc-card` is the correct base class — sub-element selectors require explicit outer-class scoping (`.dc-skill-card > .dc-card-X` vs `.dc-card > .dc-card-X`)
- #17: The `@block` breaking-change migration solves nothing the existing shorthands don't
- #19: `@stat .npc` is over-specced — `@section .dc-npc-stat` already works
- #27: `@skill` type-3 spec gap blocks 253 ability migrations with no answer given
- #28: Credits page is listed P1 with no design, no CSS, no markup spec

---

## FACTUAL ERRORS

**1. P0-2 and P0-3 prerequisites are already fixed.**
The migration plan's §1.1d lists `:nth-last-of-type(2)` on `.dc-ability` and `:nth-of-type(even)` on `.dc-specialty-card` as hard blockers. Both are already patched — `dc-components.css` uses `[data-ability-last]`/`[data-ability-penultimate]` and `[data-position="even"]`; the plugin already emits those attributes. Delete §1.1d's P0-2 and P0-3 entries entirely.

**2. `.dc-card` sub-element selectors require explicit outer-class scoping.**
The skill card system already owns `.dc-card-tab`, `.dc-card-body`, `.dc-card-inner`, `.dc-card-cont-marker`, `.dc-card-fwd-marker` as sub-elements scoped under `.dc-skill-card`. The `.dc-card` base class itself is NOT taken — `.dc-skill-card` is the outer wrapper for skill cards, not `.dc-card`. The correct resolution is: write all skill-card sub-element selectors as `.dc-skill-card > .dc-card-X` (not `.dc-card .dc-card-X`) and write all new card primitive sub-element selectors as `.dc-card > .dc-card-X`. Because the outer classes differ, there is no ambiguity. `.dc-card` IS the correct base class for the new card primitive.

**3. The `@block` CSS migration table implies the codebase has drifted — it hasn't.**
§1.1b "OLD → NEW" language implies `.dc-block.dc-panel` is already stale. The plugin today emits `class="dc-block dc-panel"` and the CSS uses `.dc-block.dc-panel` — they are in sync. The table should say "current form → post-migration form," not "old → new."

**4. Authors will write `@callout .gear` by analogy with `@specialty .augmerc` and get the wrong block.**
The spec says "use `variant=gear`" but never explains why not `.gear`. Authors see every other multi-class macro use `.name` syntax and will try it here. The spec must explicitly say: "use `variant=`, NOT `.gear` — these are different attribute syntaxes."

**5. §1.1c shows a dead `@card .flaw` example.**
The spec shows `@card .flaw` as a syntax example, then in the actual recommended pattern shows `@card` (no class) inside `@section .dc-flaws` — authors never write `@card .flaw`. Either remove the example or pick one model and stick to it.

---

## WRONG OUTPUT / BROKEN MIGRATIONS

**6. P0-2/P0-3 blockers don't exist** (see #1 — also means the §1.1d section misdirects implementers).

**7. `.dc-flaws > .dc-card` selector won't match.**
`@section .dc-flaws` is processed by markdown-it-paged, which emits `<div class="section dc-flaws">`. The working CSS selector must be `.section.dc-flaws > .dc-card`, not `.dc-flaws > .dc-card`. A developer following the literal example writes a rule that never fires.

**8. `@gear` does NOT classify outcome tables as `.dc-outcome-row` rows.**
Table classification (`getTableHeaders` → `classifyTable`) only runs inside `inSkillMode` (plugin line 1850: `if (tok.type === 'table_open' && inSkillCard)`). A Roll/Outcome table inside `@gear` renders as a plain `<table>`, not `.dc-outcome-row` rows. Gap 6's "embedded `.dc-outcome-row` rows" claim is false. See also #20 — `@outcome` already handles this case.

**9. `<ins>` → bold is a content edit, not a syntax migration.**
In chapter-02 ("It's Personal") and the Proxy spec tweak, `<ins>` was deliberately used for one visual register and `**bold**` for another. Merging them collapses distinct emphases into one. Needs an author-approval flag identical to the one on Dream title heading levels.

**10. Cleanup §11 and §6 give opposite instructions for `.specialty-spread`.**
§11 says "Replace with raw HTML wrapper or remove." §6 says "Do NOT replace with raw HTML — violates constitution §I." Same file, same element, opposite answers. §6 is correct; §11 needs updating.

**11. Cleanup §3 regex is unsafe.**
`@skill variant="[^"]+"( |\b)` → `@skill$1`. The `( |\b)` alternation eats the trailing space, producing `@skill{.allow-split}` (no space) and `@skill\n` edge cases. The explicit per-pattern find/replace list already in the doc is safer — remove the regex alternative or test it first.

---

## REUSABILITY FAILURES

**12. `.dc-flaws`, `.dc-ideals`, `.dc-dreams` CSS belongs in `dc-components.css` — NOT fg-overrides.**
These are DC component-layer classes, not book-specific overrides. Constitution §I-1's portability requirement is met by exposing the generic `.dc-card` primitive — a new project with Sins/Virtues/Goals creates its own section classes but the card primitive is free. The section-type CSS (`.dc-flaws > .dc-card`, `.dc-ideals > .dc-card`) lives in `dc-components.css` as context selectors, same as any other component variant. `fg-overrides.css` handles only layout context and page-scoped positioning.

**13. `.dc-vibe-table` is named for one chapter's concept.**
A fill-in selection grid is a generic component. Name it `.dc-pick-grid` or `.dc-worksheet-grid` and every future DC project gets it free. As specced, `.dc-vibe-table` is the same one-book bloat as `.dc-flaws`.

**14. `--dc-block-accent` token in Gap 12 is invented and would be a silent no-op.**
The plan says to override `--dc-block-accent` per specialty in `fg-overrides.css` for Spec Tweak styling. The `.dc-block` rules in `dc-components.css` don't consume a `--dc-block-accent` property — they use `--dc-block-surface`, `--dc-block-fg`, and hard-coded variant selectors. The override would set a custom property nothing reads. Wire the token into the component first, or use a token the component already exposes.

---

## ARCHITECTURE VIOLATIONS

**15. `.section.dc-flaws > .dc-card` selector distinction not articulated.**
(See #7.) The plan says "all bare `.dc-*` rules belong in `dc-components.css`" — correct. But it doesn't explain that `.section.dc-flaws > .dc-card` is a section-context selector chain (fine in dc-components.css) vs. a page/chapter-context selector (belongs in fg-overrides.css). A developer following "all `.dc-*` in components.css" will also put chapter-01-specific font-size adjustments there.

**16. Gap 1 conflates `@page` declarations with `.page.credits` layout CSS.**
Gap 1 says the credits page "requires a CSS named-page definition in `page-rules.css`." Correct for the `@page .credits { }` counter/margin rule. But it also says the credits layout (two-column flow, header image area) goes here. That layout belongs in `page-templates.css` per the file ownership contract. A developer following the gap description will put layout CSS in the wrong file.

---

## OVERCOMPLICATED / SIMPLER ALTERNATIVE EXISTS

**17. The entire `@block` "coordinated breaking change" (§1.1b) solves nothing the existing shorthands don't already solve.**
The plugin TODAY provides `@panel`, `@slate`, `@shard`, `@codex` shorthands. Authors can write `@slate` exactly as cleanly as `@block .slate`. The plan's motivation for moving `@block` to markdown-it-paged is "available to any print-md project" — but `.dc-block.dc-panel` CSS is inherently DC; a generic block in paged core with DC-only visual classes is no more portable. Drop the migration plan; use the shorthands.

**18. `@card` should not be a new macro — it's `@block variant=card`.**
The `@card` spec calls for a DC-plugin macro that emits a `<div>` with a base class and accepts attrs. That's exactly what `@block` does. The simpler answer: add `@block variant=card` (or a fifth shorthand) and reuse all existing infrastructure — label support, `closeAll()` integration, `parseAttrs()` handling, end-marker detection. Building a parallel macro with parallel state-tracking is waste.

**19. `@stat .npc` is over-specced for 4 NPCs — `@section .dc-npc-stat` already works.**
The CSS comment at dc-components.css line 3407 says: *"Apply via `@section .dc-npc-stat` in markdown."* That mechanism exists today. Use `@section .dc-npc-stat` four times and close the gap. No new macro needed for this book.

**20. `@outcome` already handles outcome tables outside skill cards.**
Plugin lines 1060–1156 implement an `@outcome` / `@end-outcome` macro for tier-explicit outcome rendering that doesn't require `.dc-skill-card` context. Gap 6's multi-table weapon entries (Schraphose, Yari) don't need a spec extension to `@gear` — they need `@outcome` blocks inside `@gear`. The plan never mentions `@outcome`.

**21. Gap 16 ("add an HTML comment") is non-action.**
The reader holds a PDF and sees a mysterious empty column. Adding `<!-- print fill-in field -->` helps the next markdown author, not the end user. Either spec a `.dc-pick-grid` worksheet treatment with dashed-border first column (which becomes #13 above), or drop the gap and accept plain tables for now.

**22. `> [!DM]` multi-paragraph already works — two macros for the same thing is bloat.**
`dcAlertsTransform` forwards all tokens between `blockquote_open` and `blockquote_close`; multi-paragraph `> [!DM]` works in practice (same mechanism as `> [!NOTE]`). The plan inconsistently recommends `@dm-note` for "long" blocks while `> [!DM]` handles them fine. Test it; if it works, drop the `@dm-note`/`@dm-note` split recommendation or at minimum remove the "multi-paragraph" distinction as a reason to choose one over the other.

---

## MISSING PREREQUISITES / WRONG ORDERING

**23. P0-A items 1 and 1a must come AFTER item 2.**
`@specialty-intro` only gets per-specialty styling via the `.dc-specialty.<name>` cascade. Migrating intros (item 1a) before specialty scopes (item 2) renders HUD defaults — the exact problem §6.6 warns about. Similarly, `@learning-path` outside `@specialty` returns `'PATH'` path codes (plugin `specialtyCodeFromClass()`) instead of `AUG`, `PRX`, etc. Correct order: specialty scopes first, then learning paths and intros inside them.

**24. `dualist`/`generalist` plugin fix is listed P1 — it should be P0b.**
If P1-15 (specialty card migration) lands before the `specialtyCodeFromClass()` fix, those two cards get permanently wrong `data-path-ref` values that have to be reworked. Promote to P0b prerequisite, same tier as the `@skill` spec.

**25. `@page .credits` and `@page .cover` CSS work is unscheduled.**
Both are listed as P1 deliverables in the priority list, but the CSS that makes them render — named-page rules in `page-rules.css` and layout in `page-templates.css` — appears in neither priority tier nor any P0b prerequisite. Without those rules the pages render as unstyled content. Schedule the CSS work explicitly.

**26. Cleanup §6 mentions the dual-specialist slug fix only in prose.**
The `dual-specialist` → `dualist` correction appears in a warning paragraph but not in the find/replace table where a developer doing the sweep will actually look. Add it to the table.

---

## SPEC GAPS THAT BLOCK IMPLEMENTATION

**27. Gap 15 (`@skill` type-3 "state-machine body") blocks 253 abilities and provides no answer.**
The plan says "It's Personal" *"may require a macro extension or an explicit 'complex ability' pattern, NOT restructuring the content"* — and stops there. A developer cannot implement anything from that. What does the DOM look like? One `.dc-skill-card` with a large body? Two cards linked by `@continue`? A non-card format? Pick one before any ability migration begins.

**28. Gap 1 (credits page) is listed P1 with no design, no CSS class names, no worked example.**
"Assemble from existing components" is not a spec. What does `@section .two-column` + `@block .slate` look like for a credits roll? There's no `.dc-credits-roll`, `.dc-credits-role`, or `.dc-credits-name` class. The visual result of the recommended assembly is an unstyled two-column bullet list. Write the spec before scheduling this P1.

**29. `@card` attribute API is undefined.**
§1.1c says `@card .class-name` → `<div class="dc-card class-name">` but doesn't specify which attributes are public API. `parseAttrs()` passes every key=value to the DOM. Authors will add `id=`, `data-*=`, `label=` — document what's supported.

**30. `--dc-block-accent` token is fictitious.**
(See #14.) Gap 12's per-specialty Spec Tweak override references a token that doesn't exist in dc-components.css and has no effect until wired. The spec is unusable as written.

**31. Pipe-separated stat line format in Gap 5 may conflict with markdown-it table parsing.**
The canonical `@stat .npc` format shows `HP: 2 | Damage: 1 | Type: Fodder | Size: Small–Medium` as a body paragraph. Markdown-it treats `|` as table syntax in certain positions. No rendered test exists confirming this line parses as a paragraph and not a malformed table. Validate before speccing it as canonical.

---

## CROSS-DOC INCONSISTENCIES

**32. Specialty-intro migration count: mapping says 8, cleanup says 3 + 5 new-content additions.**
Component-mapping chapter-02 table implies all 8 specialty sections have an intro block needing migration. Cleanup §2 correctly documents that only Augmerc, Proxy, and Streetwarden have the block — the other five need new content written, not migrated. The P0-A count and scope are wrong if both docs are read by different implementers.

**33. `.section-header` is not replaced by `@section .dc-ideals` — it's replaced by `@card`.**
Cleanup §5 says the `.section-header` wrapper migration is "redundant because these containers will be replaced entirely by the `@section .dc-ideals` macro migration." Wrong. `@section .dc-ideals` is the OUTER wrapper (replaces `.ideal-list`); `@card` is the per-entry wrapper (replaces each individual ideal block). The `.section-header` wrapper sits above both and has no direct equivalent in the new structure — it's the element that needs the most attention, not the one being discarded.

**34. "Single-paragraph only" constraint on `> [!ORIGIN]` (and `> [!DM]`) is invented.**
`dcAlertsTransform` handles multi-paragraph blockquotes for all alert types. Component-mapping P1-13 says "Do NOT use `> [!ORIGIN]` for multi-paragraph lore" and Gap 17 cites no limitation. The code has no such restriction. Both docs propagate a constraint that doesn't exist and causes unnecessary macro fragmentation.

**35. Cleanup §11 vs §6 on `.specialty-spread`.**
(See #10.) §11 says "Replace with raw HTML wrapper or remove." §6 says "Do NOT replace with raw HTML." One must be wrong; §6 is correct per constitution §I.
