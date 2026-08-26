# Solution proposal — the subtraction reading

**Status:** design proposal, **amended once** — see the amendment immediately
below, which withdraws a claim this document made and adds a second deletion to
the recommendation. No product code changed. Every product-code edit made while
measuring was reverted before commit (the working tree is clean; `git diff` is
empty).
**Builds on:** [`page-background-url-root-cause.md`](./page-background-url-root-cause.md)
(PR #183) · [#152](https://github.com/dimm-city/gutterpress/issues/152) ·
[`known-limitations.md` §3](../known-limitations.md) · the referee's findings
(PR #186)
**Measured on:** Google Chrome 151.0.7922.75, Linux x64, 2026-08-24, through
the real `gutterpress build` / `gutterpress preview` pipeline unless stated.

Everything below is labelled **measured** or **inferred**. Where I contradict
the analysis I am building on, I say so and show the measurement.

---

## AMENDMENT 1 — this proposal was wrong, here is where and how it was caught

The referee (PR #186) found a hole neither the analysis nor I had looked for,
and it was not a rough edge: **as originally written, this proposal would have
turned working books into blank paper.**

### What I claimed, and why it was false

§4 said: *"Books whose CSS image is under 512 KB: identical output."* **That
claim is withdrawn.** It holds only for books in which the CSS image is not
also referenced by an element. When the same file is used as an `@page`
background *and* as a prose image — `![](images/tile.png)` — an `<img>` request
**consumes the preload entry**, and the page box, finding none, drops.

Reproduced here on a 189-byte tile referenced from both places:

| fixture: one tile, `@page` background **and** `![]()` prose image | result |
|---|---|
| status quo (`≤512 KB`, so the CSS copy is a `data:` URI) | `101.6601` **PAINTS** |
| this proposal as first written | **`0.0000` DROPPED** |

**And the audit stayed silent: `audit fired: 0`.** That is the part a reader
most needs. `engine.page-background.unreferenced` asks *"is this URL owned by
an `@page` rule **and not referenced elsewhere**?"* — in a collision the URL
**is** referenced elsewhere, by the very `<img>` that broke it, so the detector
reads its own cause as proof of safety. The failure would have shipped
unreported, in a book that works today, which is the exact class of defect this
whole exercise exists to eliminate. Deleting the byte threshold does not merely
fail to fix these books; it **creates** them.

### What fixes it — one more deletion, not an addition

Content-address **every** CSS image. In `inlineOne`, delete the conditional
that keeps an in-project image at its project-relative path:

```ts
const dest = `${HASHED_ASSET_DIR}/${contentHash(bytes)}${ext}`;
```

The CSS asset's URL becomes `assets/15311b5348c233b4.png` — **a name nothing in
the document can utter.** Prose keeps `images/tile.png`. Two URLs, two preload
entries, nothing to consume. The branch being deleted exists, by its own
comment, *"so a file used by both CSS and markdown lands in one place instead
of two"* — and that sharing **is** the bug. Complexity found is a suspect, not
a requirement.

This does not *handle* the collision. It makes it **unrepresentable**, which
closes the whole class — prose `<img>`, plugin-emitted `<img>`, author raw
HTML, a stray second `<link>` — rather than the one instance we happened to
find.

### Measured across every shape, status quo vs amended proposal

| shape | status quo | amended |
|---|---|---|
| `@page` only, 2,431,757 B asset | `0.0000` DROPPED | **`91.2541` PAINTS** |
| `@page` only, 387 B asset | `98.3307` PAINTS | `98.3307` PAINTS |
| `:root { --paper: url(…) }` + `var(--paper)` | `0.0000` DROPPED | **`91.2541` PAINTS** |
| **collision — CSS + prose, same file** | `101.6601` PAINTS | **`101.6601` PAINTS** (identical) |
| **multi-consumer — page box + 3 margin boxes, one URL** | `0.0000` DROPPED | **`89.1921` PAINTS** |

The last row is load-bearing for a real book. **One preload entry serves many
*style* consumers**; only *element* requests consume it. `dc-op-manual`'s
`native-furniture.css` puts sixteen margin boxes on a single
`brick-bg-01.png` — measured here at four consumers on one URL, all painting
from one preload. That shape is covered.

### Cost of the amendment

The file ships twice when used from both CSS and prose (189 B twice, measured;
a 3.7 MB brick used both ways would be +3.7 MB in the bundle), and built CSS
assets carry content-hash filenames instead of authored ones. No helper is
orphaned — `escapesProjectRoot` and `toPosix` both retain other callers.
The author-facing weight of those two costs is not mine to rule on and is with
the author-outcome lens.

Sections 0, 2, 3, 4, 7 and 8 below have been brought into line with this
amendment. §4 keeps the withdrawn sentence visible rather than quietly
deleting it.

---

## 0. The recommendation in one paragraph

**Two deletions and four lines.** Delete `IMAGE_INLINE_MAX_BYTES` and the size
branch it guards, so a CSS image is copied beside the book exactly like a prose
image — one policy for images instead of three. Delete the branch that lets an
in-project CSS image keep its authored path, so every CSS image is
content-addressed and its URL is one **nothing in the document can name**. Then
emit, in `<head>`, one `<link rel="preload" as="image" href="…">` per entry of
the copy plan `inlineStyles` **already returns**. Measured end-to-end across
five shapes — a 2,431,757-byte `@page` background (`0.0000` → `91.2541`), a
387-byte one (unchanged), the `:root { --paper: url(…) }` custom-property form
that no `@page`-scoped fix can see (`0.0000` → `91.2541`), a page box plus
three margin boxes on one URL (`0.0000` → `89.1921`), and the collision that
broke the first draft of this proposal (`101.6601`, identical to today) — every
one paints, and none of them depends on a byte count, on whether the book has a
cross-reference, or on what else happens to mention the file.

---

## 1. What I verified myself, and where the analysis is wrong

I re-derived the baseline rather than trusting it. Four books, identical except
where noted, built with `bun packages/cli/src/cli.ts build … --skip-lint
--skip-pre-validate --skip-post-validate`, each measured against **its own**
control (the same book with the `url()` removed), page 1 at 100 dpi:

| book | asset bytes | mean-abs-diff | PDF bytes | result |
|---|---:|---:|---:|---|
| `over` | 2,431,757 | **`0.0000`** | 12,342 | **DROPPED** |
| `under` | 387 | `98.3307` | 13,525 | PAINTS |

The PDF byte counts are worth as much as the pixel diff: the book that "built
fine" is **12 KB**, and the same book with its background actually in it is
**1,165,710 B**. The missing megabyte *is* the missing paper, inside a PDF that
opens without complaint. That is the failure mode this proposal exists to
remove.

The shipped `engine.page-background.unreferenced` warning fired on `over`,
exactly as documented.

### 1a. Correction — the analysis's §C4 has the preview plumbing backwards

§C4 says that never inlining "removes the branch, and with it the preview
`cssAssets` plumbing" that commit `7b6122d` had to add. **That is inverted**,
and a subtraction argument that rests on it would be resting on nothing. Read
`asset-inline.ts`'s copy branch and `preview/http-server.ts`:

- Under **never**-inline, *every* CSS image goes down the copy path, so
  `ServerState.cssAssets` and its HTTP route carry **more**, not less. They stay.
  (The route is strictly required only for the out-of-project
  `assets/<contentHash>` case; in-project images resolve through the preview's
  ordinary project-root static path either way.)
- Under **always**-inline, `InlineStylesResult.copies` is always empty, so
  `onCssAssets`, `ServerState.cssAssets`, the route branch, `HASHED_ASSET_DIR`
  and `contentHash` all become dead.

So the plumbing is an argument *for* always-inline, not for mine. I say so
plainly; §6 is where I answer it.

### 1b. Correction — the analysis's §B5 `dc-op-manual` row is stale

§B5 lists `dc-design-guide/img/brick-bg-01.png` (3,784,676 B) as "copied →
dropped on all 292 pages". In the live tree it is **not** dropped:
`dc-design-guide/css/native-furniture.css:29–35` declares

```css
html {
  background-color: var(--bg);
  background-image: url("../img/brick-bg-01.png");
  …
}
```

That `html` rule is a second reference, so the brick loads during document load
and the `@page`/margin-box copies of it paint. The book is not broken today; it
is **one plausible cleanup away** from 292 blank pages — because the rule that
saves it looks redundant, and an editor removing it would be right about the
CSS and catastrophically wrong about the output. That is a *better* argument
for fixing this than the one the analysis made, not a weaker one.

### 1c. New finding — the advice we ship cannot be followed

`known-limitations.md` §3 and the shipped diagnostic both tell the author:

> a single `<link rel="preload" as="image" href="…">` in the page head is enough

**An author cannot do that.** `assembleBookHtml`
(`packages/cli/src/lib/markdown/assemble.ts:184–196`) emits a fixed `<head>` —
charset, viewport, title, one `<style>` — and the manifest has no head-injection
field. The author writes Markdown and CSS; neither reaches `<head>`. Their only
available second reference is a decorative `url()` hidden somewhere in their own
stylesheet, i.e. exactly the "book CSS coupled to a workaround" that CLAUDE.md
names as the thing that makes a shim undeletable.

We are currently shipping a warning whose remedy is available only to us.
That, more than the byte threshold, is what makes "just tell the author" not a
real option (§6.2).

### 1d. New finding — `<link rel=preload>` does *not* block the print

The analysis lists preload as a control that paints, and it does. But it does
**not** make the print wait. Served over HTTP with the tile response held
2500 ms server-side, printing as soon as `load` resolves (Chrome 151, puppeteer,
`Page.printToPDF` with the pipeline's own `DEFAULT_PRINT_OPTS`):

| second reference | tile requested | `load` resolved | painted? |
|---|---:|---:|---|
| none | 201 ms — *after* load, by the print | 195 ms | DROPPED |
| `<link rel="preload" as="image">` | 255 ms — during load | **258 ms** | **DROPPED** |
| `<img style="display:none">` | 313 ms | **2815 ms** | PAINTS |
| `<img hidden>` | 2865 ms | **5367 ms** | PAINTS |

A preload moves the fetch to document-load time; it does not delay the load
event, so a slow enough resource still loses. An `<img>` — even
`display:none` — *does* delay the load event.

If another proposal claims a preload "blocks the print", the likely
reconciliation is `--virtual-time-budget`, which `tools/page-background-repro.mjs`
passes (`--virtual-time-budget=15000`) and which stalls virtual time on pending
fetches. **The Gutterpress build path passes no such flag** (it is
puppeteer/CDP with real time), so on the path that matters the preload's
sufficiency comes from slack, not from blocking. §7 is where I own that.

### 1e. New finding — and it is the strangest one — the load-blocking form is the one our pipeline defeats

The table in §1d says a hidden `<img>` is the deterministic choice. It is not,
*through our pipeline*, and I cannot explain why. Measured, with temporary
instrumentation on `printPdf` that was reverted before commit:

- Emitting `<div data-gp-css-images hidden style="display:none"><img src="…"></div>`
  at the end of `<body>`, never-inline, the real build **DROPS** both arms.
- A probe evaluated immediately before `Page.printToPDF` proves the guard is
  present and the image is finished:
  `{"guards":1,"complete":["true:120:file:///…/images/paper.png"],"bodyKids":3}`.
- Printing **twice** in the same build: print #1 = 14,404 B (dropped),
  print #2 = 15,620 B (painted). A complete `<img>` did not help print #1.
- The **same staged document**, dumped from the browser at print time and
  printed by plain puppeteer, **PAINTS** (`98.3020`) — under every
  configuration I tried: raw, `Emulation.setEmulatedMedia({media:"print"})`,
  the pinned device metrics, `generateTaggedPDF`/`generateDocumentOutline`,
  `transferMode: ReturnAsStream`, and with 0/1/3/6/12 s of delay before the
  print (15,620 B every time — no decay).
- The preload form, through the same pipeline, paints on print #1, stably:
  three consecutive builds gave `print1 = print2 = 1,167,796 B`.

So: outside our pipeline both forms work; inside it only the preload does.
The empirical result was reproduced four times, and its consequence stands:
**do not propose an element-based second reference. It is measurably the one
that fails here.**

### 1f. The §1e trigger, bounded — with a correction to the referee

The referee (PR #186) bisected the post-load sequence and identified
`Emulation.setDeviceMetricsOverride` — the build's viewport pin — as what
defeats the `<img>`. **Concurred**, with one refinement: it is not *the call*,
it is the **first transition into a device-metrics override after load**. A
page that already had one is immune to a later one.

Same staged document (carrying the hidden `<img>` guard), same post-load
`setDeviceMetricsOverride(480×288)`, same emulated print media, same print
options. The only difference is the pre-navigation state:

| pre-navigation state | post-load override | result |
|---|---|---|
| puppeteer `defaultViewport: {800,600}` — override set at page creation | 480×288 | **15,620 B PAINTS** |
| puppeteer `defaultViewport: null` — no override until after load | 480×288 | **14,403 B DROPPED** |

That reconciles the referee's result with §1e's without either being wrong:
§1e's harness used puppeteer's default viewport and painted; the build's
raw-CDP session has no pre-navigation override and drops.

**A consequence, and an explicit recommendation against acting on it.** The
referee wrote that the build cannot apply the pin before navigation because the
sheet size is derived from `@page` CSS read after load. That reasoning does not
hold — the geometry is irrelevant (an 800×600 override immunizes a 480×288
page), so *any* dummy pre-navigation override would restore the `<img>` form,
with the real pin applied afterwards. **Do not do this.** It is a second
undocumented Chromium behaviour stacked on the first, load-bearing for
correctness, invisible in the code, and impossible to write a removal trigger
for. It is exactly the compensating machinery this repo's constitution rejects,
and the amended proposal does not need it. I record it only so a future reader
does not rediscover it and mistake it for a fix.

### 1g. The mechanism is bounded, not explained

This must be said plainly, because the rest of the document depends on it.

**What is established (measured):** a `<link rel="preload" as="image">` in
`<head>` makes the page box paint on print #1 through the real build, stably
(three consecutive builds, `print1 = print2 = 1,167,796 B`); it survives
0/5/30/120 s between load and print; **one entry serves many *style* consumers**
(page box + three margin boxes on one URL → `89.1921`); and an *element*
request for the same URL **consumes** it (`0.0000`, the collision in Amendment
1). Together these say the mechanism is **preload-list identity, not timing** —
which is why the fix is more robust than §7 of the first draft credited it, and
why the collision existed at all.

**What is not established:** *why* an `<img>`-owned resource does not serve the
page box when a preload entry does, and *why* a post-load device-metrics
override changes that. I have bounded the trigger; I have not read the Blink
code that causes it, and I am not going to pretend otherwise.

**What would break it, and how we would find out.** Any Chromium change to
preload-list matching, preload-entry lifetime, or when page style is resolved
during pagination. We would find out from the CI regression test in §2.4 — an
end-to-end build asserting a non-zero pixel diff — which is why that test is a
merge blocker and not a nicety. `tools/page-background-repro.mjs` tells us
about *Chromium's* bug; only the end-to-end test tells us about *our fix*. A
proposal whose mechanism is bounded rather than explained earns its keep by
being continuously verified, not by being elegant.

---

## 2. The change, precisely enough to implement

### 2.1 Delete the size branch (`packages/cli/src/lib/asset-inline.ts`)

```ts
export const IMAGE_INLINE_MAX_BYTES = 512 * 1024;   // delete
…
const bytes = await readOrThrow(absAsset, "asset", abs);
if (bytes.byteLength <= IMAGE_INLINE_MAX_BYTES) {   // delete
  return dataUri(bytes, ext);                       // delete
}
```

### 2.1b Delete the destination branch too (same file) — *added by Amendment 1*

The copy path that remains still chooses between two destinations. Delete the
choice:

```ts
// An in-project image keeps its project-relative path, so a file used by      // delete
// both CSS and markdown lands in one place instead of two. […]               // delete
const projectRel = path.relative(projectDir, absAsset);                        // delete
const dest =                                                                   // delete
  projectRel && !escapesProjectRoot(projectDir, absAsset)                      // delete
    ? toPosix(projectRel)                                                      // delete
    : `${HASHED_ASSET_DIR}/${contentHash(bytes)}${ext}`;                       // delete

const dest = `${HASHED_ASSET_DIR}/${contentHash(bytes)}${ext}`;                 // keep
```

Every CSS image is now content-addressed, so **the URL the preload names is one
nothing in the document can name**. That is what makes the collision in
Amendment 1 unrepresentable rather than merely handled: an element cannot
consume a preload for a URL it has no way to write. Verified in the built
bundle — `url("assets/15311b5348c233b4.png")` and
`href="assets/15311b5348c233b4.png"` in the CSS and the preload,
`src="images/tile.png"` in the prose, two files on disk.

Note what this deletes: the branch's own comment says it exists so that a file
used by both CSS and markdown "lands in one place instead of two". That
sharing was never measured as a benefit, and it is now measured as the cause of
a silent blank-page regression. Neither `escapesProjectRoot` nor `toPosix` is
orphaned — both keep other callers in the same file.

**Not touched:** fonts (`FONT_EXTS`, always inlined — the PDF/X
subset-embedding rationale is recorded and verified) and `inlineShapeUrls`
(`--gp-shape`, always inlined — `shape-outside` reads pixels and needs a
CORS-clean origin over `file://`, measured). Those two are the only data-URI
cases left, and each has evidence in its own header. This proposal is about
images referenced from CSS and nothing else.

### 2.2 Emit the preloads (`assemble.ts` + `markdown/index.ts`)

`renderBook` already holds `inlined.copies` at
`packages/cli/src/lib/markdown/index.ts:94` and already forwards it to the
build via `onCssAssets`. Forward the destinations to the assembler too:

```ts
// markdown/index.ts — inside renderBook's assembleBookHtml({ … }) call
preloadImages: inlined.copies.map((c) => c.to),
```

```ts
// assemble.ts — one option, one map, one interpolation in the <head> template
const preloadTags = (opts.preloadImages ?? [])
  .map((h) => `\n  <link rel="preload" as="image" href="${h}">`)
  .join("");
…
  <style data-project-css>\n${inlineCss}\n</style>${preloadTags}
```

**Scope it to the copy plan, not to `@page`.** This is the load-bearing design
choice and it is where a smarter-looking proposal goes wrong. A fix scoped to
`url()` tokens found inside `@page` rules cannot see

```css
:root { --paper: url("images/paper.png"); }
@page  { background: #c9c5be var(--paper) repeat; }
```

— the custom-property styling this product explicitly sells to non-technical
authors. Measured: that book drops at `0.0000` today, the shipped diagnostic
does not report it, and under this proposal it **paints (`91.2541`)** with no
special case, because `inlineOne` rewrites every `url()` in every declaration
including custom properties, so the ref is in `copies` like any other. The
general rule is both shorter and more correct than the targeted one. That is
the subtraction lens paying off, not a coincidence.

**One entry, many style consumers — measured.** A single preload serves every
`@page`-side consumer of that URL: a page box plus `@top-center`,
`@bottom-center` and `@left-middle` all referencing one file paint together
from one `<link>` (`0.0000` → `89.1921`). This matters for a real book —
`dc-op-manual`'s `native-furniture.css` puts **sixteen** margin boxes on one
`brick-bg-01.png`. Only *element* requests consume an entry, which is precisely
why §2.1b's content-addressing is the right shape: it removes the elements'
ability to name the URL at all.

**Concur with the referee on the source: the copy plan, not a regex over the
assembled CSS.** Plugin CSS never passes through the inliner, so an
assembled-CSS collector would emit `<link>`s to files the build never staged.
Amendment 1 strengthens that: under content-addressing the correct href only
*exists* because the inliner minted it, so a regex could not produce it at all.

### 2.3 Keep the audit; fix what it says

`engine.page-background.unreferenced`
(`packages/cli/src/engine/compiler/build.ts:1144–1183, 1325–1331`) is folded
into an existing `page.evaluate` — it costs no round trip. After this change it
stops firing on preloaded images (measured: the diagnostic disappeared from the
`over` build log once the preload was emitted), and its remaining job inverts
from *"author, do this"* to *"pipeline, you missed one"* — a remote
`url(https://…)` the inliner deliberately leaves alone, or a stylesheet a plugin
injects at runtime that the copy plan never saw. Rewrite the message
accordingly; it must stop telling the author to edit a `<head>` they cannot
reach (§1c).

I considered deleting it. I am not proposing that: it is the only check that
runs against the DOM the print actually sees, and its cost is a few lines
inside an evaluate we already do. Subtraction is about removing complexity, not
about removing the instrument that tells you the complexity came back. It also
still has a real job the copy plan cannot cover: **plugin CSS never passes
through the inliner**, so a `url()` a plugin puts in an `@page` rule is neither
rewritten, content-addressed, nor preloaded — and the audit is what catches it.

**Know its blind spot, and do not try to close it.** The audit was silent
through the collision (`audit fired: 0`, Amendment 1), because the consuming
`<img>` satisfies its "referenced elsewhere" test. One could invert the
predicate to *"referenced by an element ⇒ the preload is consumed ⇒ fail"* —
**do not.** That writes a Chromium preload-consumption internal into our
diagnostics, which is the least deletable thing we could ship, and it hard-fails
a legitimate authoring pattern. §2.1b removes the condition instead of
detecting it, which is why the blind spot stops mattering.

### 2.4 One end-to-end regression test, and the removal trigger in CI

- **Regression test.** Build a book whose `@page` background is over the old
  512 KB threshold and assert a non-zero mean-abs-diff against the same book
  with the declaration removed. Per
  `memory:tests-must-be-seen-red-first`, this must be **observed failing**
  against `release/0.10.2` before it is committed — it is a five-line
  measurement whose entire value is that today it reads `0.0000`. Every
  existing fixture passed regardless of the bug because each happened to carry
  a second reference; a test that does not fail red here is not testing this.
  **Amendment 1 adds a second required case:** the collision — one file used as
  both an `@page` background and a prose image. It must be in the same test,
  because it is the case the audit cannot see (§2.3) and the case that would
  have shipped silently.
- **Removal trigger.** Run `tools/page-background-repro.mjs` in CI. Exit 2
  means Chromium fixed it and the preload emission — one `.map()` — gets
  deleted. Exit 1 means the harness broke, which is the signature that produced
  #152's original wrong diagnosis. This is what replaces the audit as the
  Chromium-side trigger, and it is a better one: it is independent of whether
  any book happens to have a page background.
- **Header comment.** The four lines in `assemble.ts` carry the spec-gap note
  CLAUDE.md requires: what it is for (#152), what proves it is still needed
  (the repro script), and what to delete when it is not.

---

## 3. What this removes, concretely

| removed | where |
|---|---|
| `IMAGE_INLINE_MAX_BYTES` (the constant + its export) | `asset-inline.ts:28` |
| the `bytes.byteLength <= …` branch and its `dataUri` return for images | `asset-inline.ts:327–329` |
| three threshold-pinned test cases | `asset-inline.test.ts:116, 128, 292` |
| the threshold's doc-comment on `ServerState.cssAssets` and in `http-server.test.ts` | `server-context.ts:41`, `http-server.test.ts:423` |
| **the destination branch** — `projectRel && !escapesProjectRoot(…) ? toPosix(projectRel) : assets/<hash>` — *added by Amendment 1* | `asset-inline.ts:331–339` |
| **the rule that an image's fate depends on its byte count** | everywhere |
| **the rule that an image's fate depends on where it was referenced** | everywhere |
| **the content-dependence** (a book with a `target-counter()` prints twice and paints; the same book without one does not) | everywhere |
| **the preview↔print divergence** for `@page` background images | everywhere |
| **the size-dependence of `--format html`'s advertised self-containedness** | everywhere |
| **the ability of any element to name — and therefore consume the preload for — a CSS asset** | everywhere |

The line count is small on purpose. The thing being subtracted is not lines, it
is **rules**. Gutterpress has three policies for one asset class today —
prose images always copy, CSS images copy or inline by byte count,
`--gp-shape` always inlines. After this there is **one** rule for images
("images are files"), plus two data-URI exceptions that each carry a recorded,
measured reason in their own header. Nobody has to know a number to predict
what the build will do.

Net new code: four lines and one optional field — unchanged by Amendment 1,
which was a second deletion, not an addition. I could not find a way to reach
zero — see §6.1 for the option that does, and why I think it is worse.

---

## 4. What breaks, and who notices

**Output size.** The staged bundle gains a preload tag per CSS image (58 B
measured for one) and `book.html` *shrinks* wherever an image used to be
inlined. Measured on a 387-byte asset: `book.html` 10,553 → 10,089 B, and the
bundle gains one 387-byte file. On the 2.4 MB asset: `book.html` 10,030 →
10,088 B, same file count. Nobody notices.

**PDF size.** A book whose background used to silently vanish now carries it:
12,342 → 1,165,710 B on the one-page fixture. This is a *correct* increase and
authors of large-background books will see their PDFs get much bigger. That is
the paper they asked for; it should be said out loud in the changelog because
it will look like a regression to someone.

**Build time.** Strictly less work: no base64 pass over image bytes, no
1.333× string in memory. Not separately timed; the direction is not in doubt.

**Hot reload.** Strictly better than today for any book with an inlined CSS
image, because `book.html` gets smaller. Measured against the alternative in
§6.1, where the numbers matter far more.

**Offline / portability.** No change. Both formats were already folder bundles:
`--format html` always ships `engine/gutterpress-viewer.js` and `index.html` as
siblings, so `book.html` was never viewable alone, inlined or not (measured —
the "under" bundle is four files, the "over" bundle five). The PDF path stages
into a directory and prints from `file://`, where siblings resolve; a 771 KB
*prose* image has always been a sibling and has always printed.

**Existing books.**

> **WITHDRAWN — this is what the first draft said, kept visible on purpose:**
>
> > *Books whose CSS image is **under** 512 KB: identical output.*
>
> **That was false**, and it was false in the direction that matters: for a
> book where the same file is used as an `@page` background *and* as a prose
> image, the first draft of this proposal turned `101.6601` PAINTS into
> `0.0000` DROPPED — **and the audit did not fire** (`audit fired: 0`). It
> would have converted working books into blank paper, silently, with no
> diagnostic. See Amendment 1. Amendment 1's §2.1b is what makes the corrected
> claim true.

With §2.1b in place, three groups:

- Books whose CSS image is **under** 512 KB and **not** also referenced by an
  element: identical output. Measured — the `under` PDF is 13,525 B today and
  13,526 B under this proposal, same pixel diff (`98.3307`).
- Books with the **collision** (same file in CSS and prose, any size):
  identical output, measured — `101.6601` both before and after. They now cost
  one duplicated file in the bundle (below).
- Books whose CSS image is **over** 512 KB: they start printing what they
  always declared. `dc-op-manual`'s downscale-to-306,778-bytes workaround
  becomes unnecessary (it can go back to full resolution), and its
  `html { background-image }` rule stops being load-bearing (§1b) — it becomes
  safe to delete, which today it is not.

**Two accepted regressions, both from Amendment 1.**

1. **A file used from both CSS and prose ships twice** — once at its authored
   path for the prose reference, once content-addressed for the CSS one.
   Measured at 189 B × 2 on the collision fixture; a 3.7 MB brick used both
   ways would add 3.7 MB to the bundle. Content-addressing still dedupes
   *within* CSS, so N stylesheet references to one file remain one copy.
2. **Built CSS assets carry content-hash filenames** (`assets/15311b….png`)
   instead of authored ones. Prose images keep theirs. Someone reading the
   built bundle loses the authored names for CSS assets — and gains
   indefinitely-cacheable ones.

Both are author-visible and I am not the right lens to weigh them; that is with
the author-outcome review.

**One further regression risk, unchanged from the first draft.** A preload for
an image used only by a rule that never matches (a `@media screen` block, an
unused component) is now always fetched, and Chrome will log "preloaded but not
used". On the print path that is a local file read. On a published
`--format html` bundle it is a real download. I am accepting that rather than
adding a predicate to avoid it: the predicate is the machinery, and §2.2 shows
targeting is exactly what breaks the `var()` shape.

---

## 5. The shim tension, answered from the constitution's text

> Chrome wins once it ships … print output IS Chrome's output, and preview↔PDF
> divergence is the worst failure this project can produce. File upstream
> Chromium bugs; do not maintain corrective shims.

I claim the preload is not the thing that sentence forbids, on four grounds,
each anchored in the document's own words.

**1. It is outside the shim category as the constitution defines it.** The
boundary ruling is explicit: *"The 'temporary shim' category covers ONLY
spec-defined features Chrome has not implemented yet."* Chromium **has**
implemented `@page { background: url() }`. Measured: it paints on print #2 of
the same unmodified document; it paints with a `data:` URI; it paints with any
second reference. The feature is present and correct. What is broken is *when*
the resource is fetched relative to the print. That is a defect in a shipped
feature, not a gap in an unshipped one — and #152 is filed as such.

**2. Nothing is being implemented.** *"A shim implements the missing slice of
the standard and nothing more."* A `<link rel="preload">` implements no slice of
Paged Media. It is a shipped web-platform primitive used for precisely its
specified purpose: declaring a resource the document will need so the browser
fetches it during document load. If Chrome fixes #152, the preload does not
become *wrong* — it becomes *redundant*, which is the cheapest kind of
obsolete.

**3. It passes all three "design for deletion" tests; the status quo fails
them.** *"When Chrome ships a feature natively, the author's CSS must already
be the CSS that feature expects — removal of our shim should be a no-op for
every book."* The author writes standard GCPM before and after; the preload
references a URL the pipeline itself computed; it has no visual effect and no
DOM an author can select; deleting it is deleting one `.map()`; and its removal
trigger is an executable script's exit code. Now apply the same tests to what
we ship **today**: inlining replaces the author's asset with 1.333× of base64
in the document, does it *conditionally on file size*, and — this is the part
that should decide it — **the audit that detects the bug explicitly skips
`data:` URIs** (`!/^data:/i.test(hit.url)`). The shim we already have has
erased its own removal trigger for exactly the books it protects.

**4. Therefore the choice is not shim / no-shim.** The project is already
shimming this bug, for every asset under 512 KB, having never decided to. The
question the constitution actually poses is *which* workaround we own on
purpose, with a boundary sharp enough to delete. A four-line preload with a
header note and a CI trigger is that. A byte threshold that nobody can justify,
which routes some books around a browser bug and drops the rest onto blank
paper, is not.

**And the divergence clause cuts my way, hard.** Preview↔print divergence is
named as the worst failure this project can produce, and today's pipeline
produces it: `decorate.ts` copies the `@page` background onto `.gp-sheet`, an
ordinary element whose background loads normally, so the author's own preview
shows the paper the PDF drops. There are exactly two ways to converge — make
print correct, or make preview blank. §6.2 is why the second is not the
principled option it looks like.

---

## 6. The rivals, engaged

### 6.1 "Always inline CSS images" — the strongest rival, and the one I reject on a measured number

It is genuinely attractive under my own lens: zero new code, one policy,
immune to every shape including `var()` — **and, I must concede after
Amendment 1, immune to the collision class as well**, since a `data:` URI is
not a URL any element can request and therefore cannot have its preload
consumed. That is a real point in its favour that the first draft did not know
to make. §2.1b makes my proposal immune to the same class by construction, so
the two now tie on immunity; the rest of this section is why they do not tie
overall. It is also the option that actually *deletes* the preview plumbing
(§1a) — `onCssAssets`, `ServerState.cssAssets`,
the HTTP route branch, `HASHED_ASSET_DIR`, `contentHash`, `InlineStylesResult.copies`,
the required `cssAssets` parameter across five preview modules,
`stageBookAssets`'s `cssAssets` option, and the parity gate's collector. That
is a much bigger deletion than mine. Its advocate says they would concede if
the hot-reload cost proved negligible.

**It is not negligible. Measured, same book, back to back, `gutterpress preview`
on a 6×9in book of ~30 pages with one 3,632,378-byte `@page` background —
deliberately sized to match `dc-op-manual`'s brick:**

| policy | `book.html` | SERVER: edit → served (median of 6) | CLIENT: navigate → networkidle2 (median of 6) |
|---|---:|---:|---:|
| copy the image (this proposal) | **72,439 B** | 212 ms | **1,006 ms** |
| inline the image | **4,915,559 B** | 269 ms | **3,625 ms** |

**68× the document, +57 ms server-side, and +2,619 ms — 3.6× — client-side, for
ONE background image.** A DOMContentLoaded proxy misses this by design:
DOMContentLoaded fires before the 3.6 MB base64 payload is decoded and before
the viewer paginates. `networkidle2` includes both, which is what an author
actually waits for.

**Honest caveat on my own number:** the client half is a cold navigation, not
an in-place HMR swap, so it over-counts a `content-update`. Two things keep it
relevant anyway. CLAUDE.md states both HMR paths work "by swapping the complete
regenerated book", so the 4.9 MB `<style>` block is re-parsed either way; and a
cold navigation is exactly what `full-reload` does — the path a CSS or manifest
edit takes, which is *the* edit an author repeats while styling. I would want
the in-place swap timed before merge (§8).

And the cost is superlinear in a way the single number hides: it is
**+1.333× of every CSS image**, in one file, forever. One brick wall is 4.9 MB.
A book with ten textures is a fifty-megabyte HTML file that the desktop editor
holds in memory, that `--format html` publishes as a monolith with no per-asset
HTTP caching, and that every preview reload re-parses.

**But the number is not my main objection.** Even at zero cost I would argue
against it, for a reason the constitution states directly:

- **It entrenches, and it hides that it has entrenched.** Ask the question
  honestly: absent this Chromium bug, would anyone base64 a 3.6 MB image into
  their HTML? No. So always-inline is the Chromium defect silently choosing our
  asset policy — permanently, and under a name that does not mention it. The
  analysis's own verdict on the 512 KB threshold is that it is *"load-bearing
  for correctness by accident"*; always-inline makes it load-bearing for
  correctness **on purpose** and then calls it something else. CLAUDE.md:
  *"Design for deletion."* A policy whose deletion would re-break every book is
  the definition of not designed for deletion.
- **It erases the removal trigger inside the product.** The audit skips `data:`.
  Under always-inline it can never fire on a book's page background again. When
  Chrome fixes #152 there is nothing to delete and no signal that anything
  could be — which is precisely the state that let this bug survive months of
  "verified" fixtures.
- **It removes more lines while keeping the inconsistency.** After
  always-inline, an image referenced from CSS becomes a data URI and the same
  image referenced from prose stays a file. The split does not go away; it
  moves. Under the subtraction lens the metric is rules, not lines, and mine
  removes the rule.
- **Its determinism is inferred, not proven.** The analysis explicitly labels
  "the static-data path completes synchronously" as inferred. I concede this is
  a *stronger* inference than mine (§1e) — but it is not the free lunch it is
  presented as, and the difference between the two is covered by the same CI
  regression test either way.

### 6.2 "Stop shimming: let it not work, fix preview to match, tell the author"

The purest reading of "do not maintain corrective shims", and I took it
seriously. It fails on the constitution's own terms:

- **The author cannot act on the advice.** §1c: there is no head-injection
  point. Their only reachable second reference is a decorative `url()` in their
  own stylesheet — which puts the workaround in **book CSS, in every affected
  book, permanently**, and CLAUDE.md names that coupling as what makes a shim
  undeletable. A workaround we own is deletable in one commit.
  A workaround 292 books own is not deletable at all. This option does not
  avoid a shim; it exports it to people who cannot maintain it.
- **It amputates a feature Chromium implements.** Not a missing feature — a
  raced load in a shipped one. "Chrome wins once it ships" is an instruction to
  match Chrome, and Chrome paints this.
- **It fails the primary goals.** *"Allow non-technical users to style their
  projects by setting CSS custom properties"* — paper texture on `@page` is
  that, exactly, including the `var()` form in §2.2.
- **It converges preview and print at the worst point.** Both blank is
  agreement, not correctness.

### 6.3 "Move the threshold" / "inline for HTML, never for PDF"

Recorded for completeness and rejected on the analysis's grounds, which I
re-verified: tuning leaves correctness keyed to byte count, and format-conditional
inlining forks the single `book.html` that `renderBook` produces and the parity
gate depends on. Both are additive.

### 6.4 A hidden `<img>` instead of a preload

The form that *is* load-blocking (§1d) and therefore looks strictly better.
Measured, it **fails through our pipeline** while the preload succeeds (§1e),
and the trigger is now bounded to the build's post-load device-metrics
override (§1f). It could be revived by applying a dummy override before
navigation — and §1f is explicit that we should not, because that stacks a
second undocumented Chromium behaviour under our correctness with no removal
trigger. It also puts an element in `<body>` that author `:last-child` /
`:nth-child` selectors can see, and — after Amendment 1 — an element that
would **consume the very preload the page box needs**. Rejected on
measurement, not on taste.

### 6.5 "Print twice"

Refuted by the analysis's A3 and by my own §1e: with the response held
2500 ms, prints #1 *and* #2 both drop. The second print is not a fix, it is a
race that usually wins — and it doubles the print cost of every book to buy it.

### 6.6 The three ways to *handle* the collision instead of removing it — *added by Amendment 1*

When the referee surfaced the collision, three fixes were on the table besides
§2.1b. All three are additive; all three are worse.

**"Emit the preload with a distinguishing attribute so the `<img>` cannot
consume it."** Self-defeating by construction. Preload matching keys on
(URL, destination, mode, credentials); an `<img>` and a CSS background image
are both `destination: image`, `mode: no-cors`, same-origin credentials. There
is no axis that separates them, so any attribute that excludes the `<img>`
excludes the page box too. *(Reasoned from the matching keys, not measured —
but the deeper objection does not need the measurement: it would make us depend
on preload-list matching internals, the most shim-specific and least deletable
thing in the entire design.)*

**"Keep `data:` for images that appear in BOTH CSS and prose."** It restores
content-dependence — the exact disease the analysis set out to kill, merely
re-triggered. An author adding `![](images/tile.png)` to a chapter would
silently change how the CSS asset is represented and how big the document is.
It is also strictly more machinery than §2.1b: `inlineStyles` runs at
`index.ts:92`, **before** `assembleBookHtml` at `:99`, so the inliner does not
yet know the prose refs — you need a second pass or backward plumbing. And it
is unbounded: a 3.7 MB brick used both ways becomes ~5 MB of base64, i.e. the
always-inline cost arriving unpredictably because someone added a figure. It
also restores a third image policy, undoing §3's whole point.

**"Accept it and make the audit hard-fail the build."** Measured: the audit
fires **zero** times on the collision, because the consuming `<img>` satisfies
its "referenced elsewhere" test. Hard-failing therefore changes nothing until
you first *invert* the predicate to *"referenced by an element ⇒ the preload is
consumed ⇒ fail"* — which writes a Chromium preload-consumption internal into
our diagnostics, the least deletable thing we could ship. And what it would
then hard-fail is a perfectly reasonable book: a texture used as page
background *and* shown as a figure. Telling that author their book is illegal
because of a browser bug is the worst outcome available.

§2.1b beats all three on the same test: it does not detect the collision, does
not special-case it, and does not warn about it. It removes the precondition —
a URL an element can name — so there is nothing left to handle.

---

## 7. The strongest argument against my proposal

Not the shim objection — I think §5 answers that. The real one is this:

> **You do not know why your fix works.** §1e is a hole in the middle of the
> proposal. A complete, load-blocking `<img>` second reference does *not* make
> print #1 paint through the Gutterpress pipeline, while a non-load-blocking
> `<link rel=preload>` does — on the same document, in the same browser, where
> an external print paints with either. You measured that four times and could
> not explain it. So you are not shipping "the standards-based way to declare a
> resource the document needs"; you are shipping "the one of two equivalent
> second references that empirically survives our pipeline on Chrome 151". That
> is a fix with an unknown mechanism, and §1d proves the mechanism you *do*
> understand — the fetch starting earlier — is not sufficient on its own. A
> Chromium bump can change it back with no warning and the failure mode is 292
> pages of blank paper inside a valid PDF. Always-inline has no mechanism to
> misunderstand: there is no load.

**Amendment 1 sharpens this rather than answering it, and it is worth being
exact about how much ground moved.**

*Partly retired.* The trigger is now **bounded**: the first transition into a
device-metrics override after load (§1f), reproduced outside the pipeline. And
the mechanism is now known to be **identity, not timing** (§1g) — the fix holds
at 0/5/30/120 s between load and print, and one entry serves many style
consumers. The fix is more deterministic than this objection assumed.

*Sharpened, and this is the part that stands.* The objection said "unknown
mechanism"; the honest restatement is **bounded but unexplained** — and
Amendment 1 is the proof that this costs real money. The collision was found by
the referee, not by me, and it existed *precisely because* nobody had
articulated that preload entries are consumable. I did not know the mechanism,
so I did not predict the failure mode, so my proposal would have shipped a
silent blank-page regression. That is not a hypothetical about a future
Chromium bump. It already happened once, on this Chromium, in this document.

So what I can say is narrower than before:

- It is a reason to **require the end-to-end regression test in §2.4 —
  including the collision case**, not a reason to prefer always-inline. That
  test converts "silently stops working" into "the build fails", which is the
  outcome we want and which *no* option gives us for free — always-inline
  included, since its determinism is also inferred (§6.1).
- The `<img>` asymmetry remains an argument against the alternative that looks
  safer: anyone proposing an element-based second reference is proposing the
  form that measurably does not work here.
- **The residual is the honest form of the removal trigger** (§1g): any
  Chromium change to preload-list matching, entry lifetime, or when page style
  resolves during pagination breaks this, and the end-to-end test is the only
  thing that would tell us. That is the price of a bounded-but-unexplained fix,
  and it should be paid deliberately rather than assumed away.

A second objection I can only partly answer: **the preload is always-on and
unconditional**, so it fetches images that a particular build may not paint
(§4). I chose that deliberately over a predicate, because the predicate is the
machinery and because targeting is what breaks the `var()` shape — but someone
who values published-bundle bytes over pipeline simplicity has a real
disagreement with me, not a confused one.

---

## 8. What I measured, and what I would still need to

**Measured** (Chrome 151.0.7922.75, this machine, 2026-08-24):

| # | claim | result |
|---|---|---|
| 1 | status quo, real pipeline: >512 KB `@page` background drops | `0.0000`, PDF 12,342 B |
| 2 | status quo: ≤512 KB paints | `98.3307`, PDF 13,525 B |
| 3 | never-inline + preload, real pipeline, both arms | `91.2541` and `98.3307` — **both paint** |
| 4 | the `var()` custom-property shape, real pipeline | `91.2541` — **paints**; diagnostic silent today |
| 5 | preload build is stable, not a lucky race | 3 consecutive builds, print#1 = print#2 = 1,167,796 B |
| 6 | preload does not delay the `load` event | requested 255 ms, load 258 ms, response held 2500 ms → DROPPED |
| 7 | `<img display:none>` / `<img hidden>` *do* delay `load` | load 2815 ms / 5367 ms → PAINT |
| 8 | hidden-`<img>` guard through the real pipeline | **DROPS**; print#1 14,404 B vs print#2 15,620 B |
| 9 | that same staged document outside the pipeline | PAINTS under 5 print configs and 0–12 s delays |
| 10 | always-inline vs copy, real `gutterpress preview` | 4,915,559 B vs 72,439 B; client 3,625 ms vs 1,006 ms |
| 11 | `--format html` is a folder bundle either way | 4 files inlined, 5 files copied |
| 12 | `cssAssets` plumbing survives never-inline, dies under always-inline | read from `http-server.ts` / `asset-inline.ts` |
| 13 | `dc-op-manual`'s brick has an `html { background-image }` second reference | `native-furniture.css:32` |
| 14 | authors have no `<head>` injection point | `assemble.ts:184–196`, manifest schema |

**Added by Amendment 1:**

| # | claim | result |
|---|---|---|
| 15 | **the collision** (one 189 B tile as `@page` background *and* `![]()` prose image), status quo | `101.6601` **PAINTS** |
| 16 | the same book under the first draft of this proposal | **`0.0000` DROPPED**, and `audit fired: 0` |
| 17 | the same book with §2.1b (content-address every CSS image) | **`101.6601` PAINTS** — identical to status quo |
| 18 | §2.1b does not disturb the other shapes | over `91.2541`, under `98.3307`, `var()` `91.2541` |
| 19 | **multi-consumer**: page box + `@top-center` + `@bottom-center` + `@left-middle`, one URL, one preload | `0.0000` → **`89.1921` PAINTS** |
| 20 | content-addressing produces two distinct URLs in the built bundle | `url("assets/15311b5348c233b4.png")` + `href="assets/…"` vs `src="images/tile.png"`, 2 files |
| 21 | the §1e trigger is the **first** post-load device-metrics override, not the call | pre-nav override present → 15,620 B PAINTS; absent → 14,403 B DROPPED |

All product-code edits used for 1–10 and 15–20 were reverted; `git diff` is
empty.

**Not measured — and #1 and #2 should block merge:**

1. **Why §1e happens.** *Partly closed by Amendment 1:* the referee bisected
   the trigger to `Emulation.setDeviceMetricsOverride`, and §1f narrows it to
   the first post-load transition into an override. **Still open: the Blink
   reason.** Why an `<img>`-owned resource does not serve the page box when a
   preload entry does, and why a device-metrics transition changes that.
   Reading `css_image_value.cc` / the `ResourceFetcher` preload path is what
   would close it. Until then the fix is bounded, not explained (§1g).
2. **The parity gate.** `scripts/native-parity-gate.ts`, green with an empty
   allowlist. A `<link>` in `<head>` establishes no box, and page counts were
   unchanged in every build I ran (1 page before and after), but the gate is
   the contract and I did not run it.
3. **In-place HMR swap latency**, as opposed to the cold navigation in §6.1 —
   the number that would let someone argue always-inline's cost is smaller than
   I measured.
4. **A large real book end-to-end.** Everything here is small fixtures plus one
   30-page synthetic. `dc-op-manual` is read-only and not mine to rebuild, but
   a 292-page build with a full-resolution brick is the honest final check —
   particularly for whether the preload's slack survives a build that spends
   minutes between `load` and the print.
5. **Multiple CSS images at once.** Every fixture had one. Ten preloads and ten
   staged files is the normal case for a real book and I did not exercise it.
6. **Windows/macOS.** Linux only.

---

## 9. What I would tell the product owner in one sentence

The 512 KB number is not a threshold to tune — it is a coin flip we have been
asking every book to make, and the fix is to stop flipping it: copy every CSS
image like every other image, give it a name only the stylesheet can utter,
declare each one in `<head>` the way the platform provides for, and keep the
four lines that do it deletable the day Chromium fixes #152.

And one sentence about the process, because it is the more useful lesson: the
first draft of this document would have turned working books into blank paper,
the audit would not have said a word, and the only reason it did not ship is
that somebody adversarially looked for the shape I had not tested.
