# Paged.js Vendored Copy — Patch Log

**Vendored file:** `paged.polyfill.js`  
**Source version:** pagedjs@0.4.3  
**Source repo:** https://github.com/pagedjs/pagedjs  
**Applied patches:** PATCH-1 (2026-05-17), PATCH-3 (2026-05-17, partial), PATCH-5 (undated)  
**Reverted:** PATCH-2 — applied 2026-05-17, **REVERTED 2026-07-25** (caused a regression, fixed nothing)  
**Deferred:** PATCH-4 (complex, workaround exists)

> **Audit note, 2026-07-25.** The shipped polyfill was diffed against the published
> npm tarball for `pagedjs@0.4.3` (md5 `28be5336e03f`, byte-identical to
> `package/dist/paged.polyfill.js`). The real delta is **17 hunks / 72 lines**.
> Three discrepancies between this document and the code were found and are now
> corrected below:
>   1. PATCH-2 was causing a spurious leading blank page — now reverted.
>   2. PATCH-3 claims three guarded call sites; only two were ever applied.
>   3. An **undocumented** edit was shipping, self-labelled `PATCH-4` in code,
>      colliding with the deferred PATCH-4 below. It is now documented as PATCH-5.
> Verify against the registry tarball, not against this file, when auditing.

**Second copy (MUST stay identical):**
`packages/desktop/static/vendor/paged.polyfill.js`. The desktop ships its own
byte-identical copy of this file. A drift guard
(`packages/cli/src/assets/vendor/paged-polyfill-drift.test.ts`) fails CI if the
two ever diverge.

To update the vendored copy: replace `paged.polyfill.js` with the new dist
from `node_modules/pagedjs/dist/paged.polyfill.js` after bumping the version,
verify each patch below is still needed, and re-apply — then copy the SAME
result to `packages/desktop/static/vendor/paged.polyfill.js` so both stay in
sync (the drift test enforces this). File all applied patches as GitHub issues
at https://github.com/pagedjs/pagedjs/issues before updating.

---

## Applied Patches

### PATCH-1: `break-after: avoid` not forwarded to page model

**Status:** Applied 2026-05-17  
**Upstream PR candidate:** YES — simple, targeted, spec-compliant  
**Lines changed:** `addBreakAttributes()` — three `!== "avoid"` guard removals

**Bug:** `addBreakAttributes()` is called after each page is laid out and
populates the `page` model object from `data-break-*` attributes found in the
page element's content. The function excluded any attribute with value `"avoid"`
from being forwarded to `page.breakBefore`, `page.breakAfter`, and
`page.previousBreakAfter`. This prevented the page model from knowing that an
element requested break-avoid behaviour, which in turn prevented downstream
handlers from acting on it.

Note on mechanism: Paged.js has TWO paths for `avoid`:
1. **Element-level** (lines 1937–1938 in the chunker) — checks
   `node.dataset.previousBreakAfter === "avoid"` during content layout to pull
   a break point back before the orphaned heading. This path works regardless
   of this patch.
2. **Page-model-level** (`addBreakAttributes`) — sets `page.breakAfter` etc.
   for use by handlers registered on `afterPageLayout`. This path was broken.

This patch fixes the page-model path. The element-level path already functioned
but was the sole mechanism before this fix; downstream custom handlers that
inspect `page.breakAfter` now also receive the `avoid` value.

**Fix applied:**

```js
// Before (three occurrences):
} else if (before.dataset.breakBefore && before.dataset.breakBefore !== "avoid") {
} else if (after.dataset.breakAfter && after.dataset.breakAfter !== "avoid") {
if (previousBreakAfter.dataset.previousBreakAfter && previousBreakAfter.dataset.previousBreakAfter !== "avoid") {

// After — removed the !== "avoid" filter:
} else if (before.dataset.breakBefore) {
} else if (after.dataset.breakAfter) {
if (previousBreakAfter.dataset.previousBreakAfter) {
```

**Justification:** The CSS break spec does not say `"avoid"` should be
invisible to the page model — it says it should influence layout decisions.
Forwarding it to the page model lets custom `afterPageLayout` handlers
(including future gutterpress handlers) inspect and act on it.

---

### PATCH-2: `break-before` on first child silently dropped — **REVERTED**

**Status:** Applied 2026-05-17. **REVERTED 2026-07-25.**  
**Upstream PR candidate:** NO — the premise was wrong  
**Lines changed:** `processBreaks()` — now byte-identical to upstream again

> **Why it was reverted.** This patch caused a spurious **leading blank page**: it made
> `processBreaks()` write `data-break-before` on the first element of the flow, which
> upstream deliberately drops. `page-templates.css` puts `break-before: page` on every
> `.page` div, so the first one produced a hidden extra page — inflating every page
> *number* by one while leaving every page *boundary* correct.
>
> **Its stated bug does not exist.** The patch describes the removed guard as a
> *sibling* test. It is not: `displayedElementBefore()` walks **ancestors as well as
> siblings**, so it already returns non-null for any element with preceding content
> anywhere in the flow. The guard fires only at true start of flow — where there is
> nothing to break *from*. Across a 292-page book, the only element whose break
> attributes differed between patched and pristine was the very first one, and build
> page counts were identical (292) under both. The patch fixed nothing measurable.
>
> A "narrower guard" is not possible: `displayedElementBefore(el, parsed)` already *is*
> the flow-scoped test, so any narrowing collapses into this revert. If a consumer ever
> genuinely needs to know a start-of-flow break was requested, write a **differently
> named** attribute in the `else` branch — `needsBreakBefore()` and `shouldBreak()` read
> only `dataset.breakBefore`, so it would be inert by construction. No consumer needs
> this today.
>
> Do **not** instead "fix" `hasContent()` so empty wrappers stop flipping
> `hasRenderedContent` — it is consulted on every node of every page and would change
> layout semantics book-wide for a one-line local cause.

**Original rationale, retained for the record:**

**Bug:** When `break-before` CSS is applied to an element that has no
preceding displayed sibling (it is the first child of its container),
`processBreaks()` silently discarded the break entirely:

```js
// Original:
let nodeBefore = displayedElementBefore(elements[i], parsed);
if (nodeBefore) {
    elements[i].setAttribute("data-break-before", prop.value);
    nodeBefore.setAttribute("data-next-break-before", prop.value);
}
// If nodeBefore is null: nothing happens, break is dropped.
```

The in-code comment cited CSS Break Level 3 §5.4 (break propagation), which
says breaks between a box and its container are disallowed. However, the spec
also says that a forced break that cannot be satisfied should propagate to the
parent. Dropping it entirely is not spec-compliant.

The practical impact: any element with `break-before: page` that is the first
child of its `.page` div produces no break. In named-page documents this is
usually handled by the named-page transition mechanism, but in non-named layouts
(e.g. a `@page-break` injected before the first content element) it silently
fails.

**Fix applied:**

```js
// After:
elements[i].setAttribute("data-break-before", prop.value);  // always set
if (nodeBefore) {
    if (prop.value === "page" && needsPageBreak(elements[i], nodeBefore)) {
        elements[i].removeAttribute("data-break-before");    // undo if redundant
        continue;
    }
    nodeBefore.setAttribute("data-next-break-before", prop.value);
}
```

`data-break-before` is always written on the element itself. The
`needsPageBreak` guard (which avoids duplicate breaks) and the
`data-next-break-before` on the preceding sibling are only applied when a
preceding sibling exists. If the break is deemed redundant by `needsPageBreak`,
`data-break-before` is removed to keep the DOM clean.

**Justification:** The data attribute is what the chunker reads at layout time.
Writing it unconditionally gives the chunker the full picture; the chunker's
own break-placement logic will determine whether to act on it.

---

### PATCH-3: `:is()` with sibling combinators crashes rendering

**Status:** Applied 2026-05-17  
**Upstream PR candidate:** YES — defensive fix, clear crash with reproduction  
**Lines changed:** `processBreaks()` and `processSelectors()` (two call sites) —
  `querySelectorAll` wrapped in `try/catch`

**Bug:** Any author CSS that combines `:is()` with adjacent (`+`) or general
sibling (`~`) combinators causes a `SyntaxError` during Paged.js's internal
`querySelectorAll()` call on a `DocumentFragment`. Browsers do not support
`:is()` with sibling combinators in `DocumentFragment.querySelectorAll`. The
uncaught exception propagates up and terminates the entire rendering pipeline —
all pages come out blank, `pageCount === 0`, and the only visible symptom is a
console error message.

**Reproduction:**

```css
/* This crashes Paged.js v0.4.3 completely: */
div.chapter :is(h2, h3) + p { margin-top: 0; }
```

**Three affected call sites — ONLY TWO WERE ACTUALLY GUARDED:**
1. `processBreaks()` line ~30037 — iterates CSS break selectors — **GUARDED**
2. `NthOfType.processSelectors()` line ~30815 — `:nth-of-type` selectors — **GUARDED**
3. `Following.processSelectors()` line ~30870 — following-element selectors —
   **NOT GUARDED.** Verified 2026-07-25: no `try`/`catch` exists at this site in the
   shipped file. `Following.onRule` received the PATCH-5 `splitSelectors` change but
   never the crash guard. **If the `:is()` + sibling-combinator crash can occur in
   `Following`, it is still unguarded and will still blank the entire output.**

**Fix applied** (identical pattern at all three sites):

```js
// Before:
let elements = parsed.querySelectorAll(b);

// After:
let elements;
try { elements = parsed.querySelectorAll(b); } catch(e) {
    console.warn("[paged] Skipping unsupported selector:", b, e.message);
    continue;
}
```

The affected selector's break/nth/following rule is skipped with a console
warning. Rendering continues for all other selectors. This is the correct
degradation: the author loses one specific CSS rule's Paged.js processing, but
the document renders fully rather than producing blank output.

**Workaround for authors until this is fixed upstream:** Avoid `:is()` combined
with `+` or `~` in any CSS file processed by Paged.js. Use explicit
comma-separated selectors instead:

```css
/* Safe — works in all Paged.js versions: */
div.chapter h2 + p,
div.chapter h3 + p { margin-top: 0; }
```

gutterpress's own postcss-based print-safety checks (`src/lib/printsafe.ts`) flag
this pattern via the `printsafe/no-pagedjs-crash-selectors` rule.

**Justification:** An unhandled `SyntaxError` that blanks the entire output is
the worst possible failure mode for a print tool. Skipping an unsupported
selector with a warning is strictly better. Once Paged.js uses a more robust
selector evaluation path (e.g. post-cssOM migration) this guard becomes a
no-op.

---

### PATCH-5: paren-aware selector splitting (was shipping UNDOCUMENTED)

**Status:** Applied (date unknown — predates 2026-07-25, found by audit)  
**Upstream PR candidate:** YES — clear correctness fix  
**Lines changed:** new `splitSelectors()` helper + 8 call sites

> **This edit was shipping with no entry in this file.** In code it is self-labelled
> `// gutterpress PATCH-4:`, which collides with the genuinely-deferred PATCH-4 below
> (`break-after: column`). The doc said PATCH-4 was not applied; the code said it was.
> Both statements were true about *different* things. Renumbered to PATCH-5 here; the
> in-code comment should be renumbered to match.

**Bug:** Paged.js splits multi-selector rules with a naive `selector.split(",")`, which
also splits *inside* functional pseudo-classes. `:is(h2, h3) + p` becomes the two
nonsense fragments `:is(h2` and `h3) + p`.

**Fix applied:** a paren/bracket-depth-aware comma splitter inserted immediately above
`class Breaks extends Handler`, used at 8 call sites: `Breaks.onDeclaration` (×2),
`NthOfType.onRule`, `Following.onRule`, `RunningHeaders.onDeclaration`,
`TargetCounters.onContent`, `TargetText.onContent`, `UndisplayedFilter.onDeclaration`.

**Audited scope, 2026-07-25:** none of the 8 call sites is inside `StringSets`, and
`StringSets` never splits its selector (it stores it raw via `csstree.generate`). This
edit therefore cannot affect `string-set` behaviour. It also cannot affect
`break-before`, since `.page { break-before: page }` contains no parentheses.

---

## Deferred Patches

### PATCH-4: `break-after: column` silently discarded by chunker

**Status:** Deferred — complex, reliable workaround exists  
**Upstream PR candidate:** MEDIUM — requires chunker architectural work

**Bug:** `break-after: column` is stripped from CSS by `Breaks.onDeclaration()`
and stored as `data-break-after="column"` on DOM elements. However, the
chunker's break logic only acts on page-level break values ("always", "page",
"left", "right", "recto", "verso"). The value `"column"` is written to the data
attribute but never triggers a column advance in the Paged.js chunker — column
breaks via CSS are therefore impossible.

**Workaround:** gutterpress's `@section .two-column .col-split` generates explicit
`<div class="col">` wrapper divs at render time, producing side-by-side flex
columns that do not depend on CSS column break processing. This is the
recommended approach and is more reliable than depending on Paged.js to
implement CSS column break at the chunker level.

**Why deferred:** A correct fix requires the chunker to (a) detect that the
element with `data-break-after="column"` is inside a CSS `columns: N` context,
(b) advance to the next column position within the current page rather than
forcing a new page, and (c) handle the wrap-to-new-page case when all columns
on the current page are exhausted. This is architectural work that touches the
chunker's core layout loop. It is out of scope for a local patch and should be
a full upstream contribution with test coverage.

---

## NOT Recommended for Upstream

### `break-before: recto/verso` no-ops

The Paged.js chunker reads `breakBefore === "recto"` or `"verso"` (lines
3056–3059) and checks whether the value matches `currentSide` (computed from
`currentPage % 2`). However, "recto" and "verso" are never equal to
`currentPosition` (which is "left"/"right"), and the comparison
`breakBefore !== currentSide` is always true for a different reason — the
variables being compared ("recto"/"verso" vs "left"/"right") can never be
equal, so the page break ALWAYS fires for recto/verso, not conditionally.

This is a partial implementation: it forces a new page but does not insert a
blank page to guarantee the correct side. Guaranteeing chapter-on-recto in
gutterpress is left to the author — insert `@page-break` before a chapter after
reviewing output if the chapter lands on verso. This is the right trade-off for
a simple-markdown-first tool; auto-recto adds complexity and surprise blank
pages without clear benefit.
