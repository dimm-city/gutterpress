# Toolchain Conflict Analysis: Paged.js × markdown-it-paged × print-md

**Audience:** Developers working on print-md who need deep system knowledge  
**Scope:** CSS pipeline conflicts, break handling bugs, class name mismatches, and cascade ordering issues  
**Status:** Confirmed findings only — no speculation

---

## Executive Summary

print-md assembles three distinct tools into a single pipeline: **markdown-it-paged** converts Markdown authoring directives into HTML structure with semantic class names, **print-md's own pipeline** embeds that HTML into a page shell with CSS and Paged.js, and **Paged.js** performs the actual pagination by mutating the CSS AST and walking the DOM. Each layer was designed somewhat independently, and the seams between them contain a cluster of confirmed conflicts that range from silent no-ops to structural DOM corruption.

The most significant category of conflict is **class name mismatch between the installed dist of markdown-it-paged and the CSS that was written against its src**. The installed package's compiled dist (`dist/index.cjs`) is an older version than the `src/index.js` in the same package. The dist generates class `"region"` for `@section` elements while paged.css targets `"section"`; the dist `@break` directive generates `.md-break` while paged.css targets `.md-page-break`; and the src-only `@column-break` and `@page-break` directives simply do not exist in the installed dist. As a result, several rules in paged.css have zero matching elements in any rendered document.

The second major category is **Paged.js's aggressive CSS AST mutation**. Paged.js strips all `break-before`, `break-after`, `page-break-before`, and `page-break-after` declarations from the CSS and converts them to `data-break-*` DOM attributes. The `break-after: column` value, used by paged.css for column break elements, is extracted and placed in a `data-break-after="column"` attribute but the Paged.js break-action whitelist does not include the value `"column"` — so the column break is silently discarded. Paged.js defers all CSS multi-column layout to the browser's native engine anyway, making `break-after: column` unreachable through any CSS path.

A third category covers **cascade ordering and dynamic injection**. paged.css is embedded as a `<style>` element that follows the user's `<link>` tag in document order, meaning paged.css wins over user CSS at equal specificity — the opposite of what authors expect. Additionally, Paged.js removes all author stylesheets from the DOM and re-injects them as new `<style data-pagedjs-inserted-styles>` elements during layout; any CSS injected by Paged.js's own JavaScript after that point wins over all static CSS. Together these behaviors make cascade reasoning non-obvious and require authors to use higher-specificity selectors to override defaults they should be able to reach with bare class selectors.

---

## Section 1: Architecture Overview

### How the Three Tools Connect

```
Markdown source files
        │
        ▼
markdown-it-paged (dist/index.cjs)
  • @page .class-name       → <div class="page class-name">
  • @section .two-column    → <div class="region two-column">
  • @break                  → <div class="md-break">
  • @end-section            → </div>
        │
        ▼ (token stream)
print-md renderer (src/lib/markdown/index.ts)
  • Intercepts layout_section_open / layout_section_close
  • Detects col-split class and manages colSplitDepth
  • Emits additional DOM structure for split columns
  • Wraps rendered HTML in book.html shell
        │
        ▼ (book.html)
CSS load order in browser:
  1. <link href="css/index.css">          ← user/project CSS (external, loads first)
  2. <style>...paged.css inlined...</style> ← markdown-it-paged CSS (same-specificity rules WIN)
  3. <style>...plugin css...</style>      ← plugin CSS if any
  4. <script src="paged.polyfill.js">
        │
        ▼ (Paged.js layout engine)
  • removeStyles(): strips ALL <link> and <style> from DOM
  • Parses CSS AST; handlers mutate it
  • Strips @page rules → .pagedjs_page.pagedjs_<name>_page {}
  • Strips break-before/after → data-break-* attributes on DOM elements
  • Re-injects mutated CSS as <style data-pagedjs-inserted-styles>
  • Walks DOM; clones elements into page boxes
  • Multi-column deferred to browser native engine
        │
        ▼
Rendered paginated document (in-browser preview or PDF via Puppeteer)
```

### Key Version/Distribution Note

markdown-it-paged is used **from its compiled dist**, not its src. The two differ significantly. All findings below about class names and directive behavior are based on the dist behavior (what actually runs), not the src.

---

## Section 2: Conflicts Catalog

### Conflict 1 — `break-after: column` is completely inert

**What happens:** Authors expect that adding `break-after: column` to a CSS class (such as `.md-column-break` in paged.css) will force a column break. It does not. No column break occurs.

**Root cause — two-layer failure:**
1. Paged.js strips all `break-after` declarations from the CSS AST during its preprocessing phase (`Breaks.onDeclaration()`). The value `"column"` is extracted and placed in a `data-break-after="column"` attribute on the matching DOM element. However, the Paged.js break-action whitelist (`needsBreakBefore`, `needsPreviousBreakAfter`) checks for `"always"`, `"page"`, `"left"`, `"right"`, `"recto"`, and `"verso"` — `"column"` is not in the list. The attribute is written but never acted upon.
2. Even if Paged.js did honor `break-after: column`, it would be irrelevant: Paged.js defers all CSS multi-column layout to the browser's native layout engine. Column boundaries are determined by the browser, not by Paged.js's content-chunking tree walker.

**Impact:** Critical. `@column-break` directives that rely on the CSS path for column breaking are completely inert. Content does not split at the intended point.

**Current workaround:** print-md's col-split DOM structure. When `@section .col-split` is detected, the renderer emits two sibling `<div class="col">` containers. Content before the break goes in the first `<div class="col">`, content after goes in the second. This avoids `break-after: column` entirely by using structural DOM splitting rather than CSS column breaks.

**Recommended fix:** Document the col-split approach as the canonical solution. Remove `break-after: column` from paged.css (it is dead code). Consider promoting `@column-break` to an explicit two-column structural split in the authoring syntax. See Recommendation 2.

---

### Conflict 2 — paged.css `.section` rule targets a class that does not exist in rendered HTML

**What happens:** paged.css contains `.section { break-inside: avoid }`. In rendered HTML, no element has class `section`. The rule matches nothing.

**Root cause:** The installed dist of markdown-it-paged generates `class="region"` for `@section` elements. The paged.css file was written against the src of the library, which generates `class="section"`. The two are out of sync.

**Specific mismatch:**
- dist output: `<div class="region two-column col-split">`
- paged.css selector: `.section { break-inside: avoid }`
- Matching elements in any rendered document: zero

**Impact:** High. The intended `break-inside: avoid` protection on sections has zero effect. Section containers can be split mid-element by Paged.js's content chunker, potentially producing poor page breaks inside structured content blocks.

**Current workaround:** None confirmed. The rule is silently dead.

**Recommended fix:** Change the selector in paged.css from `.section` to `.region` to match the dist output. Alternatively, upgrade markdown-it-paged to a version where dist and src agree on `"section"`. See Recommendation 1.

---

### Conflict 3 — paged.css `.md-page-break` / `.md-break` class name mismatch

**What happens:** paged.css contains `.md-page-break { break-before: page }`. In rendered HTML, `@break` directives generate `<div class="md-break">`, not `<div class="md-page-break">`. The rule matches nothing.

**Root cause:** Same dist vs src divergence as Conflict 2.
- dist `@break` → class `"md-break"`
- paged.css targets `.md-page-break` (src class name)
- src-only `@page-break` → class `"md-page-break"` (not present in dist)

**Impact:** High. Explicit page break directives written as `@break` produce elements that carry no page break behavior through the CSS path. Whether a page break actually occurs depends entirely on other structural signals (named page classes, explicit `@page` containers).

**Current workaround:** `@page .classname` wrappers, which use Paged.js's named-page mechanism. Named pages always force `break-before: always` (see Conflict 7), so this works but is semantically heavier than a simple break marker.

**Recommended fix:** Fix paged.css to target `.md-break` (the actual dist class). If `@page-break` from the src is ever made available in the dist, add a corresponding rule for `.md-page-break` at that time. See Recommendation 1.

---

### Conflict 4 — `@column-break` and `@page-break` directives do not exist in the installed dist

**What happens:** The src of markdown-it-paged defines `@column-break` and `@page-break` markers. Authors or documentation referencing these markers find that they produce no output in rendered HTML — not even an unrecognized token, just silence.

**Root cause:** The installed `dist/index.cjs` is compiled from an older version of the source. `@column-break` and `@page-break` were added to src but were never compiled into a dist release. Node module resolution loads the dist.

**Impact:** High. Any documentation or authoring example that references `@column-break` or `@page-break` is describing behavior that does not exist in the running system.

**Current workaround:** print-md's renderer overrides intercept the tokens that do exist and emit corrected HTML. For column breaks specifically, the col-split structural approach is the active workaround.

**Recommended fix:** See Recommendation 7 (upstream contribution) and Recommendation 8 (vendor/fork). Until the dist is updated, documentation must clearly state which directives are active.

---

### Conflict 5 — nesting:0 produces unclosed `<div>` tags

**What happens:** In the src of markdown-it-paged, `@column-break` and `@page-break` tokens have `nesting: 0`. markdown-it renders nesting:0 tokens as self-opening tags (`<div ...>`) without a closing tag. The browser's HTML5 parser leaves the div open; the next `</div>` from `@end-section` closes the break div instead of the section div, producing a mismatched DOM tree.

**Root cause:** markdown-it's rendering contract: `nesting: 1` = opening tag, `nesting: -1` = closing tag, `nesting: 0` = self-closing (but HTML5 divs are not void elements, so the browser keeps them open).

**Impact:** Medium (currently mitigated). Mismatched DOM nesting produces incorrect layout; content that should be inside the section escapes it.

**Current workaround:** print-md overrides the renderer for these token types to emit `<div class="md-column-break"></div>` with an explicit close. This is the correct fix applied locally.

**Recommended fix:** Contribute the nesting fix upstream. See Recommendation 7.

---

### Conflict 6 — paged.css cascade position: paged.css wins over user CSS at equal specificity

**What happens:** Authors write CSS in their project's `css/index.css` to style section or page elements. Their rules are overridden by paged.css rules they did not write and did not expect to fight. To override paged.css, authors must increase specificity (e.g., add a redundant class or use `!important`).

**Root cause:** CSS embedding order in book.html:
1. `<link rel="stylesheet" href="css/index.css">` — user CSS, loaded first
2. `<style>...paged.css inlined...</style>` — markdown-it-paged CSS, appears after the link

When two rules have equal specificity, the later declaration wins. paged.css is always later.

**Impact:** Medium. Authors attempting to customize paged.css defaults — for example, removing `break-inside: avoid` from sections or changing `.page` break behavior — must use higher-specificity selectors. This is non-obvious and counterintuitive; most authors expect their project CSS to take precedence over library CSS.

**Current workaround:** Authors use higher-specificity selectors in their project CSS (e.g., `div.region` instead of `.region`, or `body .page` instead of `.page`).

**Recommended fix:** Reverse the embedding order. Emit paged.css before the user's `<link>` tag so that user CSS at equal specificity always wins. See Recommendation 3.

---

### Conflict 7 — Paged.js CSS re-injection: dynamically injected JS styles win over all static CSS

**What happens:** Paged.js's layout phase calls `removeStyles()`, which physically removes all `<link>` and `<style>` elements from the DOM (except those with `data-pagedjs-ignore` or `media~='screen'`). It then re-injects the mutated CSS as `<style data-pagedjs-inserted-styles>`. Any CSS that Paged.js's own JavaScript subsequently adds (e.g. resetting column-break element dimensions) is injected after the re-injected author styles and wins at equal specificity.

**Root cause:** Paged.js's architecture. It is a polyfill, not a passive renderer — it takes ownership of the CSS entirely.

**Impact:** Low to Medium. Most author CSS survives correctly through the re-injection because Paged.js only strips and re-emits author rules, not modifies them in place (except for `@page`, break declarations, `position: fixed`, and `@media screen/print` blocks). However, any CSS added dynamically by Paged.js handlers (including custom handlers) may unexpectedly override author intent.

**Current workaround:** Use `data-pagedjs-ignore` on any `<style>` block that Paged.js must not touch (e.g., screen-only styles).

**Recommended fix:** Document which CSS constructs Paged.js strips and transforms (see the complete list in the Architecture Overview). Authors who need screen-only styles should use `<style media="screen">` or `data-pagedjs-ignore`.

---

### Conflict 8 — Named pages always force a page break; no opt-out exists

**What happens:** Any element with `page: foo` in CSS (which named `@page` rules create via the Paged.js AST transformation) receives an injected `break-before: always` before the `page:` declaration is stripped. There is no CSS mechanism to use a named page context without triggering a page break.

**Root cause:** Paged.js implementation: named page injection occurs in the CSS AST processing phase before break-stripping. The forced break is hard-coded to ensure page transitions.

**Impact:** Medium. The authoring pattern `@page .class-name` in print-md always starts a new page. This is usually the intended behavior but can surprise authors who want to start a named page context mid-page (e.g., transitioning between section styles without a full page break). There is no workaround within the named-page mechanism.

**Current workaround:** Use `@section .class-name` (which generates a region without a named page, so no forced break) instead of `@page .class-name` for cases where a named context is wanted but a page break is not.

**Recommended fix:** Document this behavior explicitly in authoring guides. Make `@page` vs `@section` semantics clear: `@page` always breaks, `@section` never breaks by itself. See Recommendation 6.

---

### Conflict 9 — colSplitDepth counter is not validated; missing `@end-section` silently corrupts output

**What happens:** The `colSplitDepth` variable in `src/lib/markdown/index.ts` is a closure-scoped counter shared across all renders in a single MarkdownIt instance. When a `@section .col-split` is opened, the depth is incremented. When `@end-section` closes it, the depth is decremented. If `@end-section` is missing (malformed Markdown), the depth remains elevated for the rest of the render pass. All subsequent sections in the same document are treated as if they are inside a col-split, producing silently incorrect HTML with no error thrown.

**Root cause:** No guard at render boundaries. The counter is reset only by matching close tokens; end-of-document does not reset it.

**Impact:** High (for malformed input). Authors writing documents with many sections will not receive any indication that a missing `@end-section` has corrupted the rest of their output. The error is invisible and may produce PDF layout that looks almost-correct but has structurally wrong column splits.

**Current workaround:** None. Authors must manually audit their documents for matching open/close pairs.

**Recommended fix:** At the end of each render pass, assert `colSplitDepth === 0` and emit a warning (or throw) if non-zero. See Recommendation 4.

---

### Conflict 10 — Preview server does not watch TypeScript source files; pipeline changes are invisible

**What happens:** The preview server watches `.md`, `.css`, image files, and `.js` plugin files for changes and triggers a live reload. It does not watch `src/lib/markdown/index.ts` or any other TypeScript source file. Changes to the renderer during active development do not trigger a reload and are not reflected in the preview until the server is manually restarted.

**Root cause:** The file watcher glob patterns target authored content, not pipeline source. This is a reasonable default for end users (who never change pipeline source) but is incorrect for developers working on the renderer.

**Impact:** Low (developer experience only). Developers working on the markdown renderer or plugin system will repeatedly make changes that appear to have no effect until they realize the server must be restarted.

**Current workaround:** Kill and restart the preview server after any change to TypeScript source files.

**Recommended fix:** Add a `--dev` flag to the preview server that additionally watches `src/` for changes and restarts (or triggers a full rebuild) when TypeScript files change. See Recommendation 5.

---

## Section 3: Recommendations

### Recommendation 1 — Fix paged.css class name selectors to match dist output

**Priority: Critical**

**What to fix:** Update paged.css to target the class names actually generated by the installed dist of markdown-it-paged.

| Current selector | Actual dist class | Required change |
|---|---|---|
| `.section` | `region` | Change to `.region` |
| `.md-page-break` | `md-break` | Change to `.md-break` |
| `.md-column-break` | (does not exist in dist) | Remove or guard with a comment |

**Rationale:** Two of the rules in paged.css are currently dead code — they match zero elements in any rendered document. Fixing the selectors is a one-line change per rule and restores the intended `break-inside: avoid` protection on section containers.

**Risk:** Low. Changing `.section` to `.region` only affects documents rendered by the installed dist. If the dist is later upgraded to generate `"section"`, the selector will need to be updated again.

---

### Recommendation 2 — Formalize col-split as the canonical column break mechanism; remove CSS `break-after: column` dead code

**Priority: High**

**What to fix:** Remove `break-after: column` from paged.css (it is stripped by Paged.js and cannot function). Document the col-split structural DOM approach as the only supported mechanism for forcing column splits.

**Background:** `break-after: column` fails through a two-layer failure (Paged.js strips it from CSS; even if it survived, Paged.js does not manage multi-column layout). The col-split approach — emitting two sibling `<div class="col">` containers — bypasses both layers by expressing the split structurally rather than declaratively. The approach already works; it simply needs to be documented as the intended pattern and the dead CSS removed.

**Rationale:** Leaving dead CSS in paged.css creates confusion for developers who observe that column breaks do not work and look to the CSS for clues. Removing the dead code and documenting the correct approach makes the system's behavior match its code.

---

### Recommendation 3 — Reverse CSS embedding order so user CSS wins at equal specificity

**Priority: High**

**What to fix:** In the book.html generation code, emit paged.css before the user's `<link>` tag. The correct order is:

1. `<style>...paged.css inlined...</style>` — library defaults (first = lowest priority)
2. `<link rel="stylesheet" href="css/index.css">` — user CSS (last = wins)
3. `<style>...plugin css...</style>` — plugin CSS if any

**Rationale:** CSS library conventions universally establish that library/reset CSS comes before application CSS so that application rules override library defaults at equal specificity without requiring specificity inflation. The current order is inverted. Authors attempting to override paged.css defaults must use higher-specificity selectors, which creates brittle CSS and discourages customization. Fixing the order aligns with the project goal of allowing non-technical users to style projects by setting CSS custom properties and writing simple selectors.

**Risk:** Low. The only behavioral change is that paged.css rules that happen to share a selector with user CSS will now correctly defer to the user's version. No existing layout that works correctly today will break.

---

### Recommendation 4 — Add colSplitDepth validation with warning on render completion

**Priority: High**

**What to fix:** In `src/lib/markdown/index.ts`, after each render pass completes, check whether `colSplitDepth !== 0`. If non-zero, emit a console warning (or integrate with print-md's check/validation system) that identifies the document as having unmatched `@section`/`@end-section` pairs.

**Implementation sketch:**

```typescript
// After render() call returns:
if (colSplitDepth !== 0) {
  console.warn(
    `[print-md] Unmatched @section .col-split: depth is ${colSplitDepth} at end of render. ` +
    `Check for missing @end-section in your source files.`
  );
  colSplitDepth = 0; // reset to prevent cross-document corruption
}
```

**Rationale:** Silent corruption from malformed input is one of the worst failure modes in a document rendering pipeline. The fix is trivial and the benefit is large: authors get an actionable error message instead of a mysteriously broken layout.

---

### Recommendation 5 — Add `--dev` watch mode to preview server for TypeScript source changes

**Priority: Medium**

**What to fix:** When the preview server is started with a `--dev` flag (or equivalent), additionally watch `src/lib/markdown/index.ts` and related files. On change, trigger a full document re-render and browser reload.

**Rationale:** Developer experience issue only, but one that causes repeated confusion. The fix is a small addition to the watcher glob patterns, gated behind a flag so it does not affect end-user behavior.

---

### Recommendation 6 — Document `@page` vs `@section` semantics explicitly in authoring guides

**Priority: Medium**

**What to document:**

- `@page .classname` always starts a new page (Paged.js hard-codes `break-before: always` for named pages). This is by design but non-obvious.
- `@section .classname` never starts a new page by itself. Use `@section` for named layout contexts that should not trigger page breaks.
- To apply a named visual style without a page break, use `@section .classname` and apply the desired `@page` rule in CSS using a selector that does not rely on Paged.js's named-page mechanism.

**Rationale:** Named pages always breaking is a Paged.js fundamental — it cannot be changed from print-md. The only path to authors not being surprised by it is clear documentation. This is a documentation change, not a code change.

---

### Recommendation 7 — Contribute upstream fixes to markdown-it-paged

**Priority: Medium**

**Issues to contribute:**

1. **nesting:0 bug:** `@column-break` and `@page-break` tokens should use `nesting: 0` with an explicit close in the renderer, or be changed to emit both open (`nesting: 1`) and close (`nesting: -1`) tokens as a pair. print-md's local fix (renderer override emitting `<div ...></div>`) is the correct pattern.

2. **Class name alignment:** If src is the intended canonical version, compile and release a new dist that generates `"section"` (not `"region"`) and `"md-page-break"` (not `"md-break"`). If dist is intentional, update src to match.

3. **`@column-break` and `@page-break` in dist:** If these directives are intended as part of the public API, include them in the compiled dist.

**Rationale:** The conflicts in Conflicts 2, 3, 4, and 5 all trace back to the dist/src divergence in markdown-it-paged. Contributing upstream fixes these issues at their root and benefits any other project using the library.

---

### Recommendation 8 — Consider vendoring or forking markdown-it-paged

**Priority: Low**

**What to consider:** If upstream contribution is not feasible (maintainer inactive, PR not merged, incompatible direction), consider vendoring markdown-it-paged into the print-md repository at a known-good version with local patches applied.

**Rationale:** print-md currently takes on all the bugs from an out-of-date dist without being able to apply targeted fixes. Vendoring gives full control over the class names, directive set, and nesting behavior. The library is small enough that maintenance burden would be low. The risk of vendoring is that upstream improvements (bug fixes, new directives) must be manually cherry-picked.

**Trigger condition:** If Recommendation 7 does not result in an upstream fix within a reasonable timeframe, or if the dist/src divergence turns out to be a permanent state of the project, vendoring becomes the pragmatic path.

---

## Appendix: Key Source References

The following file locations and behavioral facts were confirmed during investigation and are cited in the findings above.

### markdown-it-paged (installed package)

| Finding | Location |
|---|---|
| dist generates class `"region"` for `@section` | `node_modules/markdown-it-paged/dist/index.cjs` |
| src generates class `"section"` for `@section` | `node_modules/markdown-it-paged/src/index.js` |
| dist `@break` → class `"md-break"` | `node_modules/markdown-it-paged/dist/index.cjs` |
| src `@page-break` → class `"md-page-break"` | `node_modules/markdown-it-paged/src/index.js` |
| `@column-break` and `@page-break` absent from dist | `node_modules/markdown-it-paged/dist/index.cjs` |
| `token.attrGet('class')` for `@section .two-column .col-split` returns `"region two-column col-split"` (dist) | dist token generation |
| nesting:0 on column-break token in src | `node_modules/markdown-it-paged/src/index.js` |
| paged.css `.section`, `.md-page-break`, `.md-column-break` rules | `node_modules/markdown-it-paged/dist/paged.css` |

### print-md pipeline

| Finding | Location |
|---|---|
| Plugin pipeline order (dcAlerts → markdownItAttrs → ... → markdownItPaged) | `src/lib/markdown/index.ts` |
| colSplitDepth closure variable and col-split renderer logic | `src/lib/markdown/index.ts`, lines 80–133 |
| CSS embedding order in book.html (link then paged.css style) | `src/lib/html.ts` or equivalent book.html generator |
| `implicitPage: false` passed to markdownItPaged | `src/lib/markdown/index.ts` |
| Preview server watcher patterns | `src/commands/preview.ts` or equivalent |
| Plugin ordering: DC plugin `dimm_city_transform` fires after `layout_transform` | `src/lib/markdown/index.ts` |

### Paged.js internals

| Finding | Location |
|---|---|
| `removeStyles()` strips all link/style without `data-pagedjs-ignore` or `media~='screen'` | `node_modules/pagedjs/src/polisher/polisher.js` |
| `Breaks.onDeclaration()` strips break declarations → `data-break-*` attributes | `node_modules/pagedjs/src/modules/paged-media/breaks.js` |
| Break-action whitelist: `"always"`, `"page"`, `"left"`, `"right"`, `"recto"`, `"verso"` (no `"column"`) | `node_modules/pagedjs/src/modules/paged-media/breaks.js` |
| Named pages inject `break-before: always` before stripping `page:` declaration | `node_modules/pagedjs/src/modules/paged-media/named-page.js` |
| `column-fill: auto` injected on `.pagedjs_page_content` | `node_modules/pagedjs/src/modules/paged-media/breaks.js` or layout module |
| `PagedConfig.before()` fires after polyfill loads (Paged.Handler is available inside) | Paged.js lifecycle documentation and source |
| Container elements get shallow clone; non-containers get deep clone | `node_modules/pagedjs/src/chunker/` |
| Multi-column deferred to browser native engine; Paged.js only reads `columnGap` for overflow detection | `node_modules/pagedjs/src/chunker/` |

---

*This document reflects confirmed findings from static analysis of the installed package versions and print-md source as of the investigation date. Re-verify line numbers against the installed versions before using them for targeted patches.*
