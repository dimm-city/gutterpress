# Paged.js Vendored Copy — Patch Backlog

**Vendored file:** `paged.polyfill.min.js`  
**Source version:** pagedjs@0.4.3  
**Source repo:** https://github.com/pagedjs/pagedjs

This file is embedded into the print-md binary via `with { type: "file" }` in
`src/lib/embedded-assets.ts`. To update, replace this file with the new dist
from `node_modules/pagedjs/dist/paged.polyfill.min.js` after bumping the
version in your local install, then verify all patches below are still needed
and re-apply to the unminified source if submitting upstream PRs.

---

## Patches to Apply

The following bugs are confirmed in v0.4.3. None are filed upstream as of
2026-05-17. Each entry is a candidate for an upstream PR at
https://github.com/pagedjs/pagedjs/issues — file the issue, reference this
file in the description.

---

### PATCH-1: `break-after: avoid` on headings is silently discarded

**File in source:** `src/modules/paged-media/breaks.js`  
**Function:** `addBreakAttributes()`  
**Upstream PR candidate:** YES — simple, targeted, spec-compliant

**Bug:** The function that writes `data-break-before`/`data-break-after`
attributes to DOM elements explicitly skips the `"avoid"` value:

```js
// Current behavior (roughly):
if (breakValue === "avoid") continue;  // avoid is never forwarded
```

This means `break-after: avoid` and `break-before: avoid` on headings,
captions, and any element that should not be orphaned are completely silently
dropped. Authors who write:

```css
.page h2, .page h3 { break-after: avoid; }
```

get zero protection. The heading can appear as the last line on a page.

**Fix:** Remove the `"avoid"` exclusion guard in `addBreakAttributes()`. The
chunker should receive `avoid` on `page.breakAfter` and honor it by not
breaking after the element.

---

### PATCH-2: `break-before` on first child is silently dropped

**File in source:** `src/modules/paged-media/breaks.js`  
**Function:** `processBreaks()`  
**Upstream PR candidate:** YES — two-line fix, clear regression from spec

**Bug:** `processBreaks()` checks for a preceding sibling (`nodeBefore`)
before writing `data-break-before`. If the element has no preceding sibling
(it is the first child of its container), the attribute is never written and
the break is silently discarded:

```js
// Current behavior (roughly):
const nodeBefore = getPreviousSibling(element);
if (!nodeBefore) continue;  // first child: break-before is dropped
element.setAttribute("data-break-before", breakValue);
```

This means `break-before: page` on the first `.page` element inside `<body>`
produces no forced break. In a document that starts with a named-page element
as the first child, the page transition never fires.

**Fix:** Handle the no-sibling case — write `data-break-before` on the element
itself even when there is no preceding sibling, or alternatively propagate the
break to the parent container boundary.

---

### PATCH-3: `:is()` with sibling combinators crashes rendering

**File in source:** `src/modules/` (CSS selector evaluation)  
**Upstream PR candidate:** YES — defensive fix, clear reproduction case

**Bug:** Any author CSS that uses `:is()` combined with adjacent (`+`) or
general sibling (`~`) combinators causes a `SyntaxError` during Paged.js's
internal `querySelectorAll` call on a `DocumentFragment`. The browser's
`DocumentFragment.querySelectorAll` does not support `:is()` with sibling
combinators. The error silently prevents all pages from rendering — `pageCount`
is 0, the output is blank, and the error appears only in DevTools console.

**Reproduction:**

```css
/* This crashes Paged.js rendering: */
div.chapter :is(h2, h3) + p { margin-top: 0; }
```

**Fix:** Wrap `querySelectorAll` calls that process author CSS selectors in a
`try/catch`. On `SyntaxError`, either skip the selector (with a console
warning) or expand `:is(a, b)` to explicit comma-separated equivalents before
querying.

**Workaround for print-md authors:** Do not use `:is()` combined with `+` or
`~`. Use explicit comma-separated selectors:

```css
/* Safe alternative: */
div.chapter h2 + p,
div.chapter h3 + p { margin-top: 0; }
```

The print-md stylelint config (`src/stylelint/printsafe-plugin.ts`) already
flags dangerous selectors via the `printsafe/no-pagedjs-crash-selectors` rule.

---

### PATCH-4: `break-after: column` is silently discarded by chunker

**File in source:** `src/chunker/chunker.js`  
**Upstream PR candidate:** MEDIUM — requires chunker changes, but well-scoped

**Bug:** `breaks.js` strips `break-after: column` from CSS and writes
`data-break-after="column"` on matched DOM elements. However, the chunker's
`addBreakAttributes()` function never acts on the value `"column"` — it is not
in the actionable whitelist. CSS column breaks are therefore impossible
through the standard CSS path.

**Note:** print-md works around this with the col-split DOM structure
(`@section .two-column .col-split` generates explicit `<div class="col">`
wrapper elements). The workaround is correct and reliable — this patch is
lower priority than PATCH-1 through PATCH-3.

**Fix:** Add `"column"` handling to the chunker's break-action logic. The
chunker would need to recognize a column break boundary within a
`columns: N` formatting context and advance to the next column position rather
than the next page.

---

## NOT Recommended for Upstream

### `break-before: recto/verso` no-ops

These values are written to `data-break-before` attributes but never acted
upon because the Paged.js chunker does not track document-level page parity
(odd/even page count) during layout.

Implementing this correctly would require the chunker to count rendered pages
in real time and conditionally insert blank pages — significant architectural
work. print-md's `RectoChapterHandler` (which runs in `afterRendered()` and
injects blank pages by reading `.pagedjs_page` count) is more reliable than
asking the chunker to do this during layout.

**Do not upstream this as a patch** — contribute the `RectoChapterHandler`
pattern to the Paged.js documentation as a recommended workaround instead.
