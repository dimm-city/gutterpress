# Solution proposal — judged by the author's outcome

**Status:** design proposal. **No implementation, no product code changed.**
**Lens:** one of three competing proposals for the `@page { background: url() }`
defect. This one is argued from Gutterpress's primary goals — non-technical
writers publishing print materials, layout that is trivial to get right — and
from CLAUDE.md's ruling that *preview↔PDF divergence is the worst failure this
project can produce.*
**Depends on:** [#183](https://github.com/dimm-city/gutterpress/pull/183)
(root cause + `tools/page-background-repro.mjs`).
**Measured on:** Google Chrome 151.0.7922.75, Linux x64, 2026-08-24.

Everything below is either **measured** — with the number and the
configuration — or labelled **inferred** / **read from source**. Section 7
lists what I did not measure.

---

## Verdict

Emit `<link rel="preload" as="image">` for every non-`data:` image URL that
appears in the document's CSS. Delete `IMAGE_INLINE_MAX_BYTES` so CSS images
are copied like every other image. Delete the
`engine.page-background.unreferenced` diagnostic, whose advice the author
cannot follow.

Net **≈ −156 lines**, one fewer diagnostic, one fewer tuning constant, and
three image policies collapse to one. It is a shim; §4 argues from the
constitution's own text why it is the *cheaper* shim than the one the project
is already running by accident.

---

## 0. What already happened to the one real author this project has

This is not hypothetical. It is in `dc-op-manual`'s history, written by the
product owner, commit `eda42d2` (2026-08-11), *"feat(css): brick wall is one
@page rule (step 2) — via a 300dpi tile"*:

> §1 (html background) + §2 (14 hand-fed margin boxes) collapse to a single
> `@page { background }` rule […] File 543 -> ~480 lines, one origin for the
> wall instead of fifteen.
>
> **THE DISCOVERY THAT MADE THIS FAIL FIRST: Chromium silently drops LARGE
> raster images from `@page { background }`. The full 2550x3300 brick never
> painted — flat `--bg` on all 292 pages, no error** […] the trigger is source
> pixel dimensions, not var()/URL-rewrite/size/blend.

Read what that describes. The author did the **obvious, simpler, more standard
thing** — fifteen references collapsed into one `@page` rule, sixty lines
deleted. The reward was 292 pages of blank paper inside a valid PDF, with no
error anywhere. Then:

1. they diagnosed it **wrong** (pixel dimensions — refuted by #183 and by §1
   below, where a **158-byte** file drops and a **7.4 MB** file paints);
2. they wrote that wrong theory into their own styling guide as standing
   advice (*"verify with production-sized assets"*);
3. they shipped a **duplicate downscaled asset** (`brick-bg-01-tile.png`,
   306,778 B — under the inline threshold, which is the real reason it worked);
4. and the current `dc-op-manual` tree has **reverted the whole
   simplification**. `native-furniture.css` is back to `html { background-image:
   url("../img/brick-bg-01.png") }` *plus* fourteen margin boxes naming the same
   file. No `-tile` asset is referenced anywhere in the live tree.

So the bug's real cost was not one missing background. It was a design
improvement abandoned, a wrong lesson written down, and a book that now
depends — invisibly — on a duplicate `html { background }` rule the author's
own comment explains as a *coverage* mechanism, not a *loading* one. **Delete
that one rule as an obvious cleanup and 292 pages go blank again, with no
error.** Nothing in the CSS says it is load-bearing.

If this is what happens to the author who wrote the design guide, "tell the
author and let them handle it" is not a solution.

**Correction to #183.** Its §B5 says `brick-bg-01.png` is *"copied → dropped on
all 292 pages."* That is true of the tree **as of `eda42d2`**, not of the tree
today: today the `html { background-image }` reference is back, so the file is
copied **and paints**. The correction makes the story worse, not better — the
book is one plausible refactor away from the failure, and the pipeline cannot
tell it so.

---

## 1. What I measured

All rows: Chrome 151.0.7922.75, document loaded over **`file://`** (the print
path's real transport), image a **copied sibling file** (not a `data:` URI),
**one** `--print-to-pdf`. The number is the mean absolute per-pixel difference
against the identical document with only the image reference removed, so
`0.0000` proves the declaration changed nothing.

### 1a. The preload fixes it at every size, in both arms of the bug

| case | asset bytes | diff | result |
|---|---:|---:|---|
| `@page` `url()`, sole reference | 158 | `0.0000` | **DROPPED** |
| + `<link rel=preload as=image>` in `<head>` | 158 | `101.3511` | PAINTS |
| `@page` `url()`, sole reference | 505,481 | `0.0000` | **DROPPED** |
| + `<link rel=preload as=image>` in `<head>` | 505,481 | `96.2474` | PAINTS |
| `@page` `url()`, sole reference | 7,372,759 | `0.0000` | **DROPPED** |
| + `<link rel=preload as=image>` in `<head>` | 7,372,759 | `95.8760` | **PAINTS** |
| margin-box `background-image`, sole reference | 505,481 | `0.0000` | **DROPPED** |
| + `<link rel=preload as=image>` in `<head>` | 505,481 | `5.0802` | PAINTS |

7,372,759 B is **14.1×** the 512 KB inline threshold and ~2× dc-op-manual's
brick. 158 B is 1/3300th of it. **Both drop; both are fixed by one `<link>`.**
This independently re-confirms #183's finding that the defect has nothing to do
with size, and it disposes of the standing advice in `dc-op-manual`'s styling
guide.

### 1b. The preload *blocks* the print — it does not merely win a race

This is the question that decides whether the fix is deterministic or lucky.
Served over HTTP with the image response held back server-side, **one** print:

| case | diff | result |
|---|---:|---|
| preload, response delayed **0 ms** | `95.8760` | PAINTS |
| preload, response delayed **2500 ms** | `95.8760` | **PAINTS** |

Server log for the 2500 ms run:

```
312ms   /doc.html
317ms   /images/huge.png          <- requested during document load
2819ms  -> responded huge.png
2827ms  /favicon.ico              <- Chromium requests this after load
```

Compare #183's §A3, the same 2500 ms delay **without** a preload: prints #1 and
#2 both dropped, only #3 painted. With a preload, a single print paints. The
preload makes the image a **load-blocking** fetch, and both print paths wait for
load — `cdp.ts`'s `navigate()` awaits `Page.loadEventFired`, and the desktop's
`engine-browser.ts` awaits `win.loadURL(url)` (read from source). The fix is
deterministic, not probabilistic.

### 1c. A preload costs zero extra fetches

Request counts for the image, over HTTP:

| document | fetches |
|---|---:|
| preload only (`@page` is the sole CSS reference) | 1 |
| preload **+** `html { background: url(same) }` | 1 |
| `html { background }` only, no preload (today's lucky book) | 1 |

Chromium dedupes by URL. **Therefore the emitter does not need to work out
whether a URL is "referenced elsewhere."** It can preload unconditionally.
That deletes the hardest part of the problem.

### 1d. The shape the product explicitly sells to authors also drops

Gutterpress's stated goal is *"allow non-technical users to style their projects
by setting CSS custom properties."* So:

| case | diff | result |
|---|---:|---|
| literal `url()` in `@page` | `0.0000` | DROPPED |
| `:root { --paper: url(…) }` + `@page { background: var(--paper) }` | `0.0000` | DROPPED |
| the same, + `<link rel=preload as=image>` | `101.3627` | PAINTS |

Two consequences, and they set the emitter's design:

- A collector **scoped to `@page` rules** would see `var(--paper)`, not a
  `url()`, and miss this entirely. **The emitter must not be scoped to
  `@page`.**
- The shipped `engine.page-background.unreferenced` audit **does not warn on
  this shape**. Read from its source: the walk assigns an owner only for a
  `CSSPageRule`; for the `:root` rule `owner` is `null`, so
  `if (!own) referenced.add(absolute(u))` — the URL is filed as "referenced
  elsewhere" and filtered out. So the check under-reports the exact shape the
  product tells authors to use, while #183 measured it over-reporting on
  `over-xref`, a book that painted.

### 1e. What inlining costs the preview

#183 §C4 named this as the missing number. Measured: a book-shaped document
(400 sections), asset 1,542,729 B, five runs each, time to
`DOMContentLoaded` — the viewer's own mount trigger
(`engine/viewer/index.ts:140`, read from source):

| document | `book.html` | DOMContentLoaded (ms, 5 runs) | median |
|---|---:|---|---:|
| copied sibling + preload | 345,132 B | 83.1 · 90.1 · 104.7 · 115.6 · 128.2 | **104.7** |
| inlined as `data:` URI | 2,402,059 B | 108.2 · 132.3 · 144.5 · 145.9 · 148.8 | **144.5** |

`book.html` is **7× larger** inlined; the median parse is **~40 ms slower** for
+2.06 MB of base64. **Honest caveat:** n=5 and the ranges overlap (copied max
128.2 > inlined min 108.2). This is directional, not precise, and it is a
*proxy* for hot reload, not a hot-reload measurement. It supports the
conclusion in §2.2; it does not carry it alone.

---

## 2. The recommendation, precisely

### 2.1 Emit the preloads — the whole change is six lines

`assembleBookHtml` already builds the final `<style>` block from four sources
(marker CSS, `gp-*` CSS, plugin CSS, project CSS). Immediately after that
string exists, and before the `<head>` template:

```ts
// Strip comments first: gutterpress-css.ts mentions `url(...)` in prose.
const preloadHrefs = [
  ...new Set(extractCssUrls(inlineCss.replace(/\/\*[\s\S]*?\*\//g, ""))),
].filter((u) => u && !u.startsWith("data:"));
```

and in the template, before `<style>`:

```html
${preloadHrefs.map((h) => `<link rel="preload" as="image" href="${escapeAttr(h)}">`).join("\n  ")}
```

`extractCssUrls` already exists in `asset-inline.ts` (line 79), reading
`URL_TOKEN_RE` — which the module documents as **the one definition** of what a
CSS reference is, *"shared by the rewrite pass and the dependency scan so the
two can never disagree about what a reference is."* This makes it three
consumers of one definition, which is the file's own stated design. Change
`function` → `export function`; nothing else.

Four properties follow from doing it here rather than anywhere else:

- **It sees the final URLs.** `inlineStyles` has already rewritten every
  reference to its output path (`images/paper.png`, `assets/<hash>.png`), so
  the `href` is correct by construction.
- **It has no blind spot inside the document.** Plugin CSS and the core blocks
  go through the same string. A collector inside `inlineStyles` would miss
  plugin CSS, which is passed to `assembleBookHtml` separately.
- **It needs no plumbing.** No new field on `InlineStylesResult`, no new
  parameter through `renderChapters`, no postcss import in `assemble.ts`.
- **It cannot fork the document.** `assembleBookHtml` produces the one
  `book.html` every format consumes — the property #183 §C4 shows must be
  preserved.

Deduped, so dc-op-manual's fifteen references to `brick-bg-01.png` emit exactly
one `<link>`.

The emitter carries a header comment recording, per CLAUDE.md's shim rule 4,
which spec gap it fills (#152), the measurement, and the removal trigger.

### 2.2 Delete `IMAGE_INLINE_MAX_BYTES`

`asset-inline.ts` lines 27–28 and 327–329. CSS images always take the existing
copy branch. Fonts stay inlined (recorded PDF/X rationale); `--gp-shape` stays
inlined (measured CORS rationale). Prose images already copy. **Three image
policies become one: images are copied.**

Why this is part of the proposal and not a separate cleanup:

1. **It is what makes the removal trigger testable on a real book.** With the
   threshold in place, deleting the preload emitter later would leave every
   book under 512 KB working — so you could never tell from a real build
   whether Chromium had been fixed or whether inlining was quietly covering for
   you. CLAUDE.md's shim rule 4 requires each shim's boundary be *"sharp enough
   that deleting it when Chrome catches up is a small, safe change."* Two
   overlapping defenses is the opposite of a sharp boundary.
2. **It ends the undecided state.** The project is already shimming this bug —
   accidentally, for everything under 512 KB, with no ADR, no measurement, and
   a rationale comment that was deleted three commits after it was written
   (#183 §C1). Choosing the deliberate shim means retiring the accidental one.
3. **It shrinks the document the author edits against** (§1e).

**This is separable.** The correctness fix is §2.1 alone; §2.1 works with or
without §2.2. If the owner wants the smaller change, keep the threshold — but
then the shim is untestable, and the accidental one stays undecided.

### 2.3 Delete `engine.page-background.unreferenced`

Remove: the `pageBackgrounds` IIFE and its comment block in `build.ts`'s audit
`evaluate`, the two `diagnose`/`log` lines, the `BuildDiagnosticCode` union
member and array entry, `build.page-background-unreferenced.test.ts` (115
lines), and the `problems.ts` label. §5 argues why. Rewrite
`known-limitations.md` §3 to record that Gutterpress now preloads every CSS
image, and to keep the upstream tracker and the removal trigger.

### 2.4 Wire the removal trigger so it cannot be forgotten

`tools/page-background-repro.mjs` (arriving with #183) already exits **2** when
the defect stops reproducing. Add one step to CI's `test` job, which already
provisions Chrome (`.github/workflows/ci.yml:23`). Exit 2 turns CI red on the
day Chromium ships the fix, and the red says *delete the shim*. Two lines.

### 2.5 Tests

Existing: three tests in `asset-inline.test.ts` keyed on
`IMAGE_INLINE_MAX_BYTES + 1` become "CSS images are copied"; the small-image
inline assertions invert. Not new tests — rewritten ones.

New: exactly one, in `assemble.test.ts` — a book whose CSS references
`images/x.png` emits exactly one `<link rel="preload" as="image"
href="images/x.png">`, and a `data:` URI emits none. Per
`memory:tests-must-be-seen-red-first`, it must be observed failing against the
unmodified emitter before it is kept.

I deliberately do **not** propose a pixel-level parity gate for backgrounds.
That would be machinery, and the repro script already covers it.

---

## 3. What the author experiences

### Before

She writes the CSS the spec describes:

```css
@page { background: #c9c5be url("images/paper.png") repeat; }
```

The preview shows paper texture on every sheet. She writes 292 pages against
that preview. She exports. The PDF is valid, opens fine, and every page is flat
`#c9c5be`. There is a warning in the build log telling her to add
`<link rel="preload" as="image" href="images/paper.png">` to the page head —
**and there is no way for her to do that.** `assembleBookHtml` builds a fixed
`<head>` (charset, viewport, title, style) and the manifest schema has no head,
links, or preload key (read from source, both). Her only reachable options are
to shrink the file under an undocumented 512 KB line, or discover by accident
that adding a `target-counter()` cross-reference elsewhere in the book makes the
background appear (#183 §B2). Both are magic.

And if her asset happens to be under 512 KB, none of this happens and she never
learns the rule — until the day she swaps in higher-resolution art.

### After

She writes the same CSS. `book.html` gains one line she never sees:

```html
<link rel="preload" as="image" href="images/paper.png">
```

The preview shows paper texture. The PDF shows paper texture. The byte size of
her file decides nothing. Whether she wrote a cross-reference decides nothing.
Whether she used a custom property decides nothing. There is no warning,
because there is nothing wrong.

When Chromium fixes #152, the `<link>` stops mattering and is deleted. Her CSS
never changes, and neither does her PDF.

### The failure case that remains

The emitter reads the CSS that lands in the document. It cannot see a URL that
does not exist in that CSS as a literal — a reference assembled at runtime by
JavaScript, or one arriving through a stylesheet that never passes through
`assembleBookHtml`. I know of no such path today: `engineStyles.native` is
appended to the `styles` list and goes through the inliner (read from
`manifest.ts:369-376`), and plugin CSS is in the same string. **A book that
reaches this hole still fails silently**, and after §2.3 no diagnostic warns.

I accept that, and here is the honest reason: the residual case is a
hypothetical with zero known instances, while the diagnostic I am removing has
two measured defects and gives advice the author cannot act on. Keeping 185
lines of DOM-walking audit and its test to cover a hypothetical is the machinery
the brief forbids. If the hole is ever hit, the fix is to feed that CSS through
the same extractor — smaller than maintaining the audit.

---

## 4. The shim tension

CLAUDE.md is unambiguous: *"Chrome wins once it ships. […] print output IS
Chrome's output […] File upstream Chromium bugs; do not maintain corrective
shims."* I am proposing a shim. Here is the argument from the text, not from
sentiment.

### 4.1 The prohibition is on *corrective* shims. This corrects nothing.

The rule's own sentence defines its target: *"When Chrome implements a Paged
Media feature, we drop our shim and match Chrome's behavior even where it is
imperfect."* The forbidden object is code that **substitutes for a Chrome
behavior** — a `target-counter()` implementation, a `leader()` polyfill, a page
fragmenter. Those re-implement a spec feature and produce output Chrome would
not have produced.

A `<link rel="preload">` implements nothing. It re-implements nothing. It does
not touch the author's CSS, the cascade, layout, or paint. Chrome paints the
author's standard `@page { background: url() }` with Chrome's own painter, from
Chrome's own resource cache. The only thing that changes is **when Chrome
issues a fetch it was always going to issue.** The output *is* Chrome's output —
which is precisely what the ruling demands and what today's 292 blank pages are
not.

### 4.2 It passes all four of the constitution's numbered shim rules

1. **Thin over capable.** It has no behavior. Six lines, one `<link>` per URL,
   no options, no modes, nothing to extend. There is no feature you could add
   to it.
2. **Standards-based in and out.** `<link rel="preload" as="image">` is
   standard HTML. The author writes pure CSS Paged Media and keeps writing it.
   The rule's test — *"removal of our shim should be a no-op for every book"* —
   is satisfied **literally**: delete the emitter on a fixed Chromium and every
   book's CSS, pagination and paint are byte-identical.
3. **Track the spec, not our shims.** No book can couple to it. It emits no
   class, no attribute, no custom property, no DOM node an author or a
   stylesheet can select. This is exactly the property the Paged.js migration
   lacked when books bound themselves to `.pagedjs_*` internals.
4. **Design for deletion.** Its boundary is one expression in one file. Its
   removal trigger is *executable today* — `tools/page-background-repro.mjs`
   exit 2 — and §2.4 wires it into CI so the trigger fires by itself.

### 4.3 The comparison the constitution actually forces

The choice is not shim versus no shim. **The project is already shimming this
bug.** Score the incumbent — `IMAGE_INLINE_MAX_BYTES` — against the same four
rules:

| | preload emitter | the inline threshold (today) |
|---|---|---|
| Thin? | 6 lines, no behavior | rewrites every CSS image under 512 KB into the document |
| Removal a no-op for every book? | **yes** — CSS and paint identical | **no** — flips 292 pages from painted to blank |
| Book-couplable? | no — no selectable surface | **yes, worst kind**: the author's *asset byte size* decides whether the book works |
| Trigger recorded? | yes, executable, in CI | **none.** No ADR, no measurement; its own rationale comment was deleted three commits after it was written |

Run the constitution's rules in both directions and they **condemn the shim we
have** and permit the one proposed. Keeping the threshold *is* the choice to
maintain a corrective shim — an unlabelled, undeletable, size-conditional one.

### 4.4 Why "let it genuinely not work" fails on the text, not on sentiment

The clean-sounding alternative — stop shimming, let `@page { background: url() }`
not work, make the preview match, tell the author — fails three ways:

1. **It is not "matching Chrome's behavior."** The ruling is scoped to features
   *Chrome has implemented*. Chrome **has** implemented this: it paints on the
   second print (#183 §A2), and it paints on the first with a preload (§1a).
   There is no Chrome behavior to match here — there is a race. Adopting the
   losing side of a race is not deference to Chrome; it is a coin flip
   promoted to a policy. And it is not even a stable coin flip: #183 measured
   the same asset dropping in one book and painting in another whose only
   difference was a `target-counter()`.
2. **It forces the worst failure the constitution names.** To "make the preview
   match", the viewer must stop painting a background the author's standard CSS
   declares. CLAUDE.md requires the viewer to *read standard CSS* and to *not
   change what the document means*. Blanking a declared background changes what
   the document means. You would be manufacturing a preview↔print divergence in
   the other direction — and calling it parity.
3. **It removes a capability with no author-reachable replacement.** Measured:
   there is no head hook and no manifest key. The documented workaround is
   unreachable through every author-facing surface Gutterpress has.

### 4.5 What I concede

It *is* a workaround for a browser bug, and I will not dress that up. What makes
it acceptable is not that it isn't a shim — it is that it is the cheapest shim
available, it is provably a no-op to delete, and the status quo is a more
expensive shim that nobody chose.

---

## 5. Is a lint warning sufficient?

**No — and this one cannot be made sufficient.** Four reasons, in order of
weight:

1. **Its remedy is not reachable.** The message says to add a `<link
   rel="preload">` to the page head. There is no head hook (§3). The build tells
   the author to do something the product does not let her do. (A `<link>` in
   the markdown body does work — I measured it, `96.2474`, PAINTS — but writing
   raw HTML `<link>` tags into markdown is not a workflow for a non-technical
   writer, and it is not what the message says.)
2. **It cries wolf.** #183 measured it firing on `over-xref`, a book that
   painted, because that book's cross-reference pushes the build into a
   two-print convergence loop. And it *cannot* be made accurate without knowing
   the print count — which depends on the author's cross-references. The
   accurate message would be *"this may or may not print depending on how many
   times we print your book,"* which is not something you can tell a
   non-technical author.
3. **It misses the shape the product sells.** §1d: the custom-property form
   drops and is never reported.
4. **It arrives too late and in the wrong medium.** Build-time, in a log, after
   a long PDF export — not in the preview where the author is working and where
   the divergence is being concealed.

A check that over-reports on working books, under-reports on the recommended
authoring style, and prescribes an impossible fix does not just fail to help.
It **teaches authors to ignore diagnostics**, which makes the honest ones worse.

The general point: a warning is the right instrument when the author has a
choice to make. Here she has none — the CSS is correct, the desired output is
unambiguous, and only the pipeline can act. So the pipeline should act.

---

## 6. The strongest argument against this proposal

Not "it's a shim" — §4 answers that. The real one is a **rival proposal that
beats mine on the brief's own criteria**:

> **Delete the threshold in the other direction: always inline CSS images.**
> It needs *no emitter at all* — zero new code, only a deleted constant and a
> deleted branch. A `data:` URI is measured immune, so it fixes the literal
> case, the margin-box case, the custom-property case (`--paper` resolves to a
> `data:` URI), and any shape nobody has thought of — including my residual
> hole in §3. It also deletes what my proposal must keep: `ServerState.cssAssets`,
> the preview route, and the deliberately-required parameter across five preview
> modules that `7b6122d` added *solely* to serve copied CSS images. That is
> strictly more subtraction, strictly less new surface, and there is no shim
> anyone has to remember to delete.
>
> (This also corrects #183 §C4, which claims "never inline" removes the
> `cssAssets` plumbing. It is the reverse: *never* inline makes that plumbing
> load-bearing for **every** CSS image; *always* inline is what makes it dead.)

That is a serious proposal and I want it recorded fairly, because it is the one
I would have to beat in review.

**My answer, and where it runs out.** Three things:

- **It is still a shim, just an unlabelled one.** It defends against #152 with
  no comment saying so, no removal trigger, and no way to test whether the
  defense is still needed. That is precisely the "undecided" state this whole
  exercise exists to end. Choosing it means choosing the accidental shim as the
  permanent answer.
- **It makes the removal trigger permanently untestable on real books.** Every
  CSS background becomes a `data:` URI, so no real build can ever exercise the
  bug. That fails shim rule 4 more completely than today's threshold does.
- **It costs the preview, which is the product.** §1e: `book.html` 7× larger,
  ~40 ms slower to parse, on every hot reload. Extrapolating linearly to
  dc-op-manual's 3,784,676 B asset (+5,046,235 B of base64) gives roughly
  **+98 ms per reload** — *inferred*, by extrapolation, not measured.

**Where my answer runs out:** that third point is the one that would actually
decide it for an author, and my number for it is a five-run proxy with
overlapping ranges, extrapolated. If the true hot-reload cost is negligible,
"always inline" is the better proposal and I would concede to it — with the
caveat that whoever adopts it must write the ADR that #183 §C1 found missing,
saying in the code that this is a Chromium workaround and naming the trigger.
Adopting it silently is the one outcome worse than either.

### The objection I cannot fully answer

**Entrenchment.** I claim the shim is deletable; realistically, it will not be
deleted. `known-limitations.md` has carried removal triggers for §1–§3 for
months and nobody re-ran them — the shipped over-report on `over-xref` proves
the last person to touch this did not measure end to end. Worse, §2.2 makes the
shim load-bearing for **every** CSS background image rather than only those over
512 KB, so a regression in six lines now blanks more books than the status quo
does. §2.4's CI wiring answers the *mechanical* half — the trigger will fire by
itself — but it does not answer the structural half: a workaround that works
perfectly and is invisible has no constituency for its own removal, and one line
of CI is easy to delete. I am proposing something that will probably outlive
several Chrome releases, and I cannot honestly promise otherwise.

---

## 7. Evidence discipline

**Measured by me** (Chrome 151.0.7922.75, Linux x64, 2026-08-24; harness adapted
from `tools/page-background-repro.mjs`; scale-invariant generated tiles, never
committed fixtures; every case differenced against its own control):

- §1a — 8 print/control pairs over `file://`, single print, sibling files at
  158 B / 505,481 B / 7,372,759 B, page box and margin box.
- §1b — 2 pairs over HTTP with the response delayed 0 ms and 2500 ms
  server-side, with the request log.
- §1c — 3 request-count runs over HTTP.
- §1d — 3 pairs, literal vs `var()` indirection, with and without preload.
- §1e — 10 `DOMContentLoaded` timings (5 per variant) on a 400-section
  book-shaped document.

**Read from source, not measured:** `assembleBookHtml`'s fixed `<head>` and the
absence of any head/links key in `manifest.types.ts`; `cdp.ts` `navigate()`
awaiting `Page.loadEventFired` and `engine-browser.ts` awaiting `loadURL`;
`viewer/index.ts:140` mounting on `DOMContentLoaded`; `manifest.ts:369-376`
appending `engineStyles.native` to `styles`; the audit's `owner === null` branch
filing `:root` URLs as "referenced"; `dc-op-manual`'s `native-furniture.css` and
commit `eda42d2`.

**Taken from #183 without re-measuring:** the print counts for `over` (1) and
`over-xref` (2), the `over-xref` paint, and the audit firing on it.

**Not measured — and it matters:**

- **Real hot-reload latency** through the actual preview stack. §1e is a
  document-parse proxy, n=5, overlapping ranges. This is the number that
  decides §6, and I did not take it. Taking it needs a preview server driving a
  real book; it is the single measurement I would want before implementing.
- **An end-to-end build of a real book with the emitter in place.** Everything
  in §1 is fixture-level. Before merging, `dc-op-manual`'s field guide should be
  built with the `html { background }` rule **removed** — the shape `eda42d2`
  tried and abandoned — and its 292 pages checked. That build is the proposal's
  acceptance test and it is exactly the experiment the author already ran and
  lost.
- **Whether `<link rel=preload>` in `<head>` interacts badly with a book
  carrying many CSS images.** I measured one image. A 200-image art book is
  200 load-blocking fetches. Local files, and they would be fetched anyway when
  used — but the *unused* ones are new work, and I did not measure it.
