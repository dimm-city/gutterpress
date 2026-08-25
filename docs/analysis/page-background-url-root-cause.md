# Root cause: `@page { background: url() }` is dropped in print

**Status:** analysis only. No fix, no shim, no pipeline change.
**Tracking:** [#152](https://github.com/dimm-city/gutterpress/issues/152) ·
[`known-limitations.md` §3](../known-limitations.md)
**Measured on:** Google Chrome 151.0.7922.75, Linux x64, 2026-08-24.
**Repro:** `node tools/page-background-repro.mjs` (exit 0 = defect live,
1 = harness broken, 2 = Chromium fixed it).

Everything below is either **measured** (a number this document can point at,
reproducible with the script or the commands in the appendix) or explicitly
labelled **inferred**. Where the history is silent, this says so rather than
inventing a rationale.

---

## Summary

There are two defects stacked on each other, and they need separating.

**Layer A — Chromium.** A `url()` that appears *only* inside an `@page` rule is
never requested while the document loads. The request is issued **by the print
itself**, because printing is when `@page` style is first resolved — and the
print paints the page box without waiting for the resource it just asked for.
Nothing repaints when it arrives. A *second* print of the same, unmodified
document paints correctly.

**Layer B — Gutterpress.** The pipeline inlines CSS images at or under
512 KB as `data:` URIs and copies larger ones. A `data:` URI has no
asynchronous load, so it is immune. The result is that **an author's page
background prints or does not print according to the file's byte size**, and
— because the build prints once for simple books and twice for books with
cross-references — **according to whether the book happens to contain a
`target-counter()`**. Meanwhile the on-screen viewer paints the background in
every case, so preview and print disagree.

**And a prior question, raised by the product owner and answered here:** the
size threshold is not a tuning problem. Image inlining is applied to a single
shared `book.html` that feeds every output format, its recorded justification
is two clauses in a code comment that was later deleted, and the PDF path
demonstrably does not need it — a 771 KB image referenced from *prose* is never
inlined and prints correctly. The 512 KB number is load-bearing for correctness
**by accident**.

---

## Layer A — the Chromium mechanism

### A1. The defect and its boundaries (measured)

`tools/page-background-repro.mjs`, Part 1. Each row is the mean absolute
per-pixel difference between a document and **the identical document with only
the image reference removed**, so `0.0000` is proof the declaration changed
nothing. Rows marked `control` must paint; if they do not, the run is void.

| mean-abs-diff | margin-sd | result | case |
|---:|---:|---|---|
| `0.0000` | 0.00 | DROPPED | `@page url()`, the only reference in the document |
| `101.3511` | 99.83 | PAINTS | control — `+ <link rel=preload as=image>` for the same url |
| `101.3511` | 99.83 | PAINTS | control — `+ a 1×1 opacity:0 <img>` for the same url |
| `101.3511` | 99.83 | PAINTS | control — `@page` **`data:` URI**, the only reference |
| `0.0000` | 0.00 | DROPPED | margin box `background-image: url()`, only reference |
| `5.2057` | 0.00 | PAINTS | control — the same margin box `+ <link rel=preload>` |

Two things this table settles. The failure is not specific to the page box —
a margin box's own `background-image` fails identically, so it is the whole
`@page` rule that "owns" a URL nothing else references. And the margin-box row
is why the differential is the primary signal: its `margin-sd` reads `0.00`
whether it paints or not, because a margin box is not inside the left-margin
strip. A std-dev-only harness would have called that row a drop.

### A2. When is the image requested? (measured — this is the mechanism)

Part 2 serves the document over HTTP so every request is timestamped, and
leaves the page idle for 2.5 s after `load` so that nothing is merely "still
loading" when the print begins.

```
alone.html                         (@page url() is the only reference)
  requests   : 6ms /alone.html | 2522ms /tile.png
  tile requested before the print began?  NO
  print #1 called at 2520ms, tile requested at 2522ms
  print #1 margin-sd=0.00   DROPPED
  print #2 margin-sd=99.83  PAINTS

preload.html                       (same, plus <link rel=preload as=image>)
  requests   : 3ms /preload.html | 7ms /tile.png
  tile requested before the print began?  yes
  print #1 called at 2513ms, tile requested at 7ms
  print #1 margin-sd=99.83  PAINTS
```

The image is **not fetched during document load at all**. The GET lands 2 ms
after `Page.printToPDF` is called. The print does not wait for it. A second
print of the same document — no reload, no DOM change, no CSS change — paints.

This also disposes of the "wait longer" theory recorded in #152: waiting before
the print cannot help, because before the print there is nothing pending.
`--virtual-time-budget` at 30 s and 60 s was already known not to help; this
explains why.

### A3. Confirming it is "does not wait", not "second print is special" (measured)

A separate run delayed the tile response 2500 ms server-side:

```
tile response delayed 2500ms server-side
  print #1 at 1017ms  → DROPPED   (tile requested at 1018ms)
  print #2 at 1040ms  → DROPPED   (response had not landed yet — 3520ms)
  print #3 at 5062ms  → PAINTS    (after the response landed)
  server log: 1018ms request /tile.png · 3520ms response /tile.png
```

So a second print is not magic. **The page box paints whatever state the
resource is in at that instant**, and there is no invalidation when the load
completes. Print #2 usually paints only because, by then, the request the first
print started has finished.

One further detail from the same runs: the tile is served `cache-control:
no-store`, and the whole sequence produced exactly **one** network request.
The completed resource is being held in the renderer's in-memory resource
cache for the life of the page, not re-fetched from an HTTP cache.

### A4. Why (part measured, part read from Chromium source, part inferred)

The causal chain that fits every measurement above:

1. `@page { background: url(X) }` is parsed into a `CSSImageValue`. **No fetch
   yet.**
2. Nothing resolves `@page` style during ordinary screen style recalc, so X is
   never requested while the document loads. *(Measured — A2.)*
3. Printing paginates, and pagination resolves the page style. Chromium's
   `pagination_utils.cc` calls
   `document.GetStyleResolver().StyleForPage(0, /*page_name=*/g_null_atom)`,
   in a function whose comment says it *"is called before entering layout"*.
   *(Read from [`pagination_utils.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/layout/pagination_utils.cc).)*
4. Resolving the value into a `StyleImage` is what starts the fetch:
   `CSSImageValue::CacheImage` fetches only `if (!cached_image_)`, via
   `document.GetStyleEngine().CacheImageContent(params)` — lazily, at style
   resolution, not at parse.
   *(Read from [`css_image_value.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/css/css_image_value.cc).)*
5. The print then lays out and paints immediately, with the resource still in
   flight, and never repaints. *(Measured — A2, A3.)*
6. A second reference anywhere in the normal document (`<link rel=preload>`,
   `<img>`, `html { background }`) is resolved during ordinary document
   loading, so the resource is already complete when step 3 runs.
   *(Measured — A2.)*
7. A `data:` URI has no network round trip, so it is complete the moment step 4
   runs. *(Outcome measured — A1. That the static-data path completes
   synchronously is **inferred**, not read from source.)*

**Proven:** steps 2, 5, 6, and the outcome of 7. **Cited from source:** the
`StyleForPage`-during-pagination call and the lazy `CacheImage` fetch (3, 4).
**Inferred:** that these two are the same code path our measurement observes —
the timing is exactly what that pairing predicts, but I did not build Chromium
or trace it. Not proven either way: whether any Blink code *intends* to wait
for pending page-box images and fails to, versus never having had such a wait.

### A5. What this means for the upstream report

#152's body should say: the image is **requested by the print**, not merely
"fetched either way". The one-line repro for a Chromium engineer is now
"print twice; the second one paints" — a much sharper signal than a pixel
diff, and it points straight at a missing wait-or-invalidate around page-box
background images.

---

## Layer B — how Gutterpress turns this into a silent, size-dependent failure

### B1. Three different policies for the same kind of asset

| Reference site | Policy | Where |
|---|---|---|
| Markdown prose `![](x.png)` | **always copied**, never inlined | `planImageCopies` |
| CSS `url()` | inlined if **≤ 512 KB**, else copied | `inlineOne` / `IMAGE_INLINE_MAX_BYTES` |
| `--gp-shape:url()` | **always inlined** | `inlineShapeUrls` |

Only the third has a measured, documented reason (`shape-outside` reads pixels
and needs a CORS-clean origin over `file://` — that rationale is in the code
and is sound). The middle row is the one that decides whether an author's page
background prints.

### B2. End-to-end, through the real pipeline (measured)

Six books, identical except where noted. The tile is a scale-invariant
checkerboard, so the two sizes look the same once CSS scales them; only the
byte count differs. Each book is measured against **its own** control — the
same book with the `url()` removed.

| book | asset bytes | `Page.printToPDF` calls | mean-abs-diff | result |
|---|---:|---:|---:|---|
| `under` | 4,812 | 1 | `95.6279` | PAINTS (inlined as `data:`) |
| `over` | 770,441 | 1 | **`0.0000`** | **DROPPED** |
| `over-xref` | 770,441 | 2 | `89.7099` (p1), `90.7136` (p2) | **PAINTS** |

`over` and `over-xref` differ only in that the second contains one
`[link](#later)` plus a `target-counter()` rule. That pushes the build into its
convergence loop, which prints twice — and the second print paints, exactly as
A2/A3 predict. The print counts are **measured**, via temporary instrumentation
on `printPdf` that was reverted before commit; they are not inferred from
reading `build.ts`.

So the failure is not only size-dependent. **It is content-dependent.** Two
books with the same stylesheet and the same 770 KB asset produce different
paper, and the deciding factor is whether the author wrote a cross-reference.

The shipped `engine.page-background.unreferenced` warning fires on **both**
`over` and `over-xref` — correct about the risk, wrong about the outcome in the
second case.

### B3. The staged document really does reference it once (measured)

The shipped `book.html` for `over` contains exactly **one** occurrence of
`paper.png`, and it is the author's CSS passed through verbatim:

```
/* project css */
/* styles/main.css */
@page {
  size: 5in 3in;
  margin: 0.5in;
  background: #c9c5be url("images/paper.png") repeat;
  background-size: 0.5in auto;
}
```

Nothing else in the document mentions it. That is precisely Chromium's failing
condition, and the pipeline is producing it correctly — the CSS is
standards-based and unmodified, which is what CLAUDE.md requires.

### B4. Preview and print disagree (measured)

`decorate.ts` copies the `@page` background declarations onto each `.gp-sheet`
element as an inline style. Probing the built HTML bundle in a live browser:

```
sheetBackgroundImage : url("http://127.0.0.1:40457/images/paper.png")
inlineStyle          : … background: url("images/paper.png") 0% 0% / 0.5in repeat rgb(201,197,190);
server saw           : /book.html, /engine/gutterpress-viewer.js, /images/paper.png
```

A `.gp-sheet` is an ordinary element, so its background image loads and paints
normally. The screenshot shows the full checkerboard across the sheet; the PDF
built from the same book is flat `#c9c5be`. This is a **preview↔print
divergence** — what CLAUDE.md calls the worst failure this project can produce
— and the parity gate cannot see it, because the gate asserts page counts,
page-of-element maps and target-counter values, and makes no paint assertions.

### B5. The real book's numbers finally reconcile (measured)

Asset sizes in `dc-op-manual` (read-only):

| asset | bytes | vs 512 KB | fate |
|---|---:|---|---|
| `dc-design-guide/img/brick-bg-01.png` | 3,784,676 | 7.2× over | copied → dropped on all 292 pages |
| `dc-design-guide/img/brick-bg-01-tile.png` | 306,778 | under | inlined → paints |
| `field-guide/art-unplaced/brick-bg-01.webp` | 28,470 | under | inlined → paints |

This closes the "open question" left in #152. The downscaled tile did not work
because it had fewer pixels; it worked because re-encoding put it at 306,778
bytes, under the inline threshold. The pixel-dimension theory and the
"unreferenced" theory were each describing one true half of a two-layer defect.

---

## Questioning the inlining decision itself

The brief asks whether inlining should exist at all, and instructs me to treat
`asset-inline.ts` as a suspect rather than a specification. Here is what the
record actually contains.

### C1. What problem was it introduced to solve?

Introduced in `6cd2b21` (2026-07-27), *"feat(assets): derive assets from
references; inline CSS and fonts"*. The commit message gives a detailed
rationale for inlining **stylesheets** and **fonts**, and for images says only:

> inlines small images and content-addresses only those too large AND outside
> the project

The one recorded rationale for image inlining is the original doc comment on
the constant, quoted in full:

> Images at or below this size are inlined as `data:` URIs; larger ones are
> copied and content-addressed. 512 KB keeps icons/textures in the document
> (no extra requests, no missing-file class) while full-bleed page art — which
> would bloat `book.html` and blow past base64's 33% overhead — stays a file.

That comment was **deleted** three commits later in `7a360c2`
(*"refactor: cut comment bloat from the two new asset modules"*), replaced by:

> Inline images up to this size; copy larger ones (full-bleed page art).

There is **no ADR** for asset inlining (`docs/adr/` contains 0008, 0009, 0010;
none covers it). There is no recorded measurement. The stated benefits are "no
extra requests" and "no missing-file class"; neither is quantified anywhere in
the repo.

### C2. Is that problem still real?

**For the PDF path: no — refuted by measurement.** Prose images are never
inlined; `planImageCopies` only ever copies. A 771,207-byte prose image builds
and prints correctly: `pdfimages -list` shows it embedded in the PDF at 440 ppi
on pages 2 and 3, and page 2 rasterizes at std-dev 69.98 against a flat page's
~0. The print path prints from a staged directory where the image sits beside
`book.html`, and sibling files resolve normally. Nothing about the PDF path
requires a `data:` URI.

**For `--format html`: also no, and the format does not deliver what inlining
is supposed to buy.** The product owner's suspicion was that inlining exists
for a genuinely single-file HTML output. Measured, it does not:

| build | `book.html` | ships |
|---|---:|---|
| `under-html` (4,812 B asset, inlined) | 16,458 B | `book.html`, `index.html`, `engine/`, fingerprint |
| `over-html` (770,441 B asset, copied) | 10,035 B | the same **plus `images/paper.png`** |

Both are *folder* bundles. Even in the inlined case `book.html` is not viewable
alone: `shipViewerHtml` always injects
`<script src="engine/gutterpress-viewer.js">` as a sibling file. So the HTML
format is never single-file, and the "self-contained" property it advertises is
itself size-dependent — the same unprincipled cliff in a second place.

**What the two-branch design has already cost.** Commit `7b6122d`
(*"fix(preview): serve the inliner's CSS asset plan so shared repo-root art
loads"*) exists solely because of the copy branch. Its message:

> a >512 KB shared image rendered as a broken image in the live preview while
> the built PDF shipped it correctly — preview and build disagreeing about an
> asset, which serve-in-place exists to prevent

Fixing that added `ServerState.cssAssets`, a preview HTTP route, and a
deliberately-required parameter across five preview modules. That is machinery
whose only reason to exist is that CSS images take two different paths.

**Where inlining is genuinely load-bearing, and should not be touched:** fonts
(`FONT_EXTS` — always inlined, with the verified PDF/X subset-embedding
rationale in the module header) and `--gp-shape` (CORS-clean pixels for
`shape-outside`, measured). Both have real recorded evidence. This analysis is
about **images referenced from CSS**, nothing else.

### C3. Why 512 KB?

Nothing in the repo records a measurement, an experiment, or a decision
process. The number appears fully formed in `6cd2b21` with the one-sentence
justification quoted above, and that sentence was deleted a few commits later.
The two stated concerns — `book.html` bloat and base64's overhead — are real
directional concerns; base64 costs exactly 1.333× (770,441 B → 1,027,256 B of
payload, measured). But no threshold follows from them without a target, and no
target is recorded.

Plainly: **a number was picked.** It is now load-bearing for correctness by
accident, because under it an asset happens to route around a Chromium bug and
over it the book silently ships blank paper.

### C4. What each alternative rule would cost

Measured where marked; otherwise reasoned from the measurements above and
labelled.

**"Never inline CSS images."** `book.html` shrinks (the `under` build's 16,458 B
would fall toward `over`'s 10,035 B). The Chromium bug's blast radius *grows*
to every CSS background image referenced only from `@page` — but it becomes
**deterministic**, and `engine.page-background.unreferenced` already catches
exactly that case on the built document. Removes the branch, and with it the
preview `cssAssets` plumbing `7b6122d` had to add. *Inferred:* offline
portability is unaffected, because both formats already ship sibling files.

**"Always inline CSS images."** The Chromium bug's blast radius through CSS
backgrounds drops to zero — but by accident, not by design, and the project's
constitution is explicit that a workaround which entrenches is the worst
outcome. Cost is measured: +1.333× the asset bytes into `book.html`. For
`dc-op-manual`'s 3,784,676 B background that is **+5,046,235 B** of base64 in
a single HTML file, re-parsed on every preview hot-reload. *Not measured:*
the hot-reload latency impact, which is the number that would decide this.

**"Inline for HTML, never for the PDF path."** This one is refuted by the
architecture, and it is worth being explicit because it was the leading
hypothesis. Inlining happens in exactly **one** place — `markdown/index.ts:92`,
inside `renderBook` — which produces **one** `book.html` that every format
consumes; the format strategies own only "the tail of the build". Making
inlining format-conditional would fork that document, and `stageBookAssets` is
documented as *"THE one implementation … so the gate can never measure a
document the build would not have produced."* It would also be **additive** —
a new mode and a new branch — where the brief calls for subtraction. Refuted.

**"Keep the threshold, move the number."** Tunes the cliff without removing it,
leaves correctness size-dependent, and is the shape of fix CLAUDE.md warns
against. Recorded for completeness only.

---

## The reproduction script

```sh
node tools/page-background-repro.mjs
```

Requires `google-chrome` (or `$CHROMIUM_PATH`), `pdftoppm`, and node ≥ 22 or
bun. No npm dependencies: the tile is generated, the PDF is measured by parsing
`pdftoppm`'s binary PGM, and CDP is spoken over the built-in `WebSocket`.

The tile is **generated, never committed**. A fixture file in the repo can pick
up a second reference from anything else that touches it, and a document with a
second reference passes regardless of the bug — which is exactly how this went
unnoticed for months.

**The control gate.** Four cases must paint. If any measures as dropped the run
aborts with `HARNESS BROKEN` and exit 1, because a run where the known-good
cases also fail proves nothing about Chromium. This is not theoretical: it is
the exact signature that produced #152's wrong diagnosis. All three exit paths
were verified by deliberately breaking a copy of the script — exit 1 was
observed by forcing the paint threshold to an unreachable value (all four
controls reported DROPPED, matching the historical failure), and exit 2 by
forcing the defect flag false.

| exit | meaning |
|---|---|
| 0 | defect reproduces, every control passes — status quo |
| 1 | a control failed: the harness or environment is wrong, not Chromium |
| 2 | controls passed and the defect did **not** reproduce — removal trigger met |

Exit 2 is the removal trigger from `known-limitations.md` §3, made executable.

---

## For the design debate — candidate directions, not a recommendation

1. **Subtract the branch: one policy for CSS images.** Either always inline or
   never inline, chosen on its own merits (document size and hot-reload cost
   versus request count), with the Chromium bug explicitly *not* a factor in
   the choice. This deletes the size cliff, deletes the second policy, and
   likely deletes the preview `cssAssets` plumbing. The open question is which
   direction, and that needs the hot-reload measurement C4 did not take.

2. **Treat the second reference as the author-facing fix and make it loud.**
   The `engine.page-background.unreferenced` warning already exists and already
   fires. The debate is whether a warning is enough for a non-technical author,
   or whether an unreferenced `@page` image should fail the build outright —
   given the failure mode is 292 pages of blank paper that looks like a valid
   PDF. Note the warning currently over-reports: it fired on `over-xref`, which
   painted.

3. **Close the preview↔print divergence directly.** Today the viewer paints
   what the PDF drops, so the author's own preview actively conceals the
   defect. Whatever happens to inlining, a book whose background will not print
   should not preview as though it will. This is viewer-side tooling, where
   CLAUDE.md's standards rules relax — but it must not change what the document
   means.

A note on scope for whichever direction wins: nothing here argues for a shim in
the rendering path. Layer A is Chromium's to fix, and `#152` plus the script
above are what make its removal trigger checkable.

---

## Appendix — reproducing the Layer B measurements

The pipeline measurements are not in the script (they need a built workspace).
To reproduce:

1. Build two books differing only in the byte size of a CSS `@page` background
   image — one under 512 KB, one over — plus a no-image control for each.
2. `bun packages/cli/src/cli.ts build <book> --out <book>.pdf --skip-lint
   --skip-pre-validate --skip-post-validate`
3. `pdftoppm -gray -r 100 -f 1 -l 1 <book>.pdf out` and compare each book to
   its own control by mean absolute pixel difference.

Two traps this hit, recorded so the next person does not:

- **A tile whose checker squares are a fixed pixel size averages to flat mush
  when the large version is downscaled by `background-size`.** It then measures
  like a dropped background while actually painting. Make the tile
  scale-invariant (squares proportional to side length).
- **Comparing page 1 of books with different page counts measures nothing.**
  The prose-image book paginates to 3 pages against the control's 1, and its
  page-1 diff of `0.2155` reads as "dropped" while `pdfimages -list` shows the
  image embedded on pages 2 and 3.
