# Measured split: cards that continue on the next page

An element marked `data-gp-split` whose content spans a page boundary is cut at
the measured break into a **head** part and a **continuation**, each a whole
object: a card that is a framed sheet (a skill card, a stat block, a boxed
table) can end on one page and resume, tab and all, at the top of the next.
Chromium cannot do this by itself: the continuation's chrome has to exist as
markup, and where it goes depends on where the page breaks, which is only known
after layout.

Gutterpress has no extension hook API (`docs/architecture-rules.md`: plugins are plain
markdown-it plugins, no custom hooks), so the feature is
**declarative markup the extension or the author emits**; nothing in the engine
knows what a "skill card" is.

## Markup

```html
<div class="card" data-gp-split=".inner"
     data-gp-split-scope="PATH1" data-gp-split-cut="card-cut">
  <div class="tab">NAME</div>
  <div class="inner"> ...blocks... </div>
  <template data-gp-split-head>
    <div class="card card-cont">
      <div class="tab">NAME ▸</div>
      <div class="inner" data-gp-flow></div>
    </div>
  </template>
</div>
```

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-gp-split="<selector>"` | the card | selector (inside the card) of the **flow** element whose children are cut |
| `data-gp-split-scope="<id>"` | the card | cards that share one flow of pages (a learning path, a chapter section). Scopes are cut in parallel; default is one scope for the whole book |
| `data-gp-split-cut="<class>"` | the card | class added to a part that continues (the closed foot) |
| `<template data-gp-split-head>` | inside the card | the continuation's root element, with an empty `[data-gp-flow]`. Put it last, so `:first-child` rules still see the tab |
| `data-gp-nosplit` | a flow child | keep this block whole |
| `data-gp-split-units="<selector>"` | a flow child | its matching direct children are units, cut between |
| `data-gp-split-repeat="<selector>"` | the same block | direct children copied onto every part (a ladder's label bar) |

Units, in the order the cut looks at them:

- a block child of the flow (`p`, `div`, an image) is one unit;
- `ul` / `ol`: each `li` is a unit; the new `ol` carries on its `start` count
  (`ol[reversed]` stays whole);
- `table` with one `tbody` and no `tfoot`: each `tr` is a unit and the `colgroup`
  and `thead` are copied onto the continuation (other tables stay whole);
- a block with `data-gp-split-units`;
- a `p` that straddles the break is cut at a line (below).

The continuation gets the card's `data-gp-split*` attributes (so it can be cut
again), a copy of the template, the attribute `data-gp-split-cont`, and the
rule `[data-gp-split-cont] { break-before: page }`: a continuation always heads
its page. Copied heads and table headers carry `data-gp-split-copy`, a cut
paragraph's second half is a `p.gp-split-cont` (use it to drop a first-line
indent or a drop cap), and the continuations are given ids `gp-split-1`, `-2`,
... on their flow element, in document order, so the build can read the page
each landed on.

## How it runs

One function, three callers (design rules §1):

- `engine/shared/split.ts`: the policy as pure functions (which unit starts the
  continuation, which word a paragraph is cut before, pull-back, per scope picking).
- `engine/viewer/split-dom.ts`: the DOM surgery, bundled into both the viewer and
  the compiler agent, so the two cannot build different documents from the same ops.
- `engine/viewer/split.ts`: the loop, in the viewer page.

The build (`compiler/build.ts`) runs the loop in the predict page, replays the
recorded ops on the page it prints (`__gp.applySplitOps`) **before** recto
blanks and page numbers are placed, and compares where each continuation printed
with where the viewer put it. The preview (`mount()`) runs the same loop.

The loop: a split only adds height after its break, so everything before it is
final. Each pass takes the first card of each scope that still spans pages,
cuts it before the first unit not wholly on the page the card starts on, and
re-lays the document out (`relayout()`, no print). A head that still spans
pages (its closed foot cost it a line) gives its last unit to the continuation
rather than growing a third part. Passes are capped at 24
(`SPLIT_PASS_CAP`), separate from the print `maxPasses`.

A paragraph that starts on the card's page and runs onto the next is cut at the
first word not wholly on the page (a word wrapped at a hyphen across the
boundary moves whole), keeping two lines on each side; a head that still spans
gives up a line at a time, then the whole paragraph. Text is never trimmed, so a
cut is exactly reversible. Before and after every cut the words of the flow are
compared; a change undoes the cut.

## What you see

- The build reports `engine.split.summary` (info): `split: 56 break(s) (36 block, 4
  unit, 8 list-item, 7 table-row, 1 paragraph), 244pp -> 248pp (+4), 5 pass(es) in
  6.5s; grew: GDR3 6->7`.
- `engine.split.unsplittable`: a unit taller than a page (or one that leaves no room
  for the card's foot); the card keeps the browser's break.
- `engine.split.unconverged`: the pass cap was reached; the remaining breaks are native.
- `engine.split.template`: a `data-gp-split` card without a usable template.
- `engine.split.text-changed`: a cut would have changed the words and was undone.
- `engine.split.page-drift`: a continuation printed on another page than the preview put it.

## Limits

- A cut costs the continuation's tab and the gap the moved unit leaves at the foot of
  the page. A path whose last page is full can grow by a page; the build log says
  which scopes grew. Failing a build on growth belongs in the book's CI.
- One cut per scope per pass: a card longer than 24 pages is not cut to the end.
- The preview cuts at load only; `refresh()` keeps the cuts and `resplit()` makes
  them again (a layout pass per break, about 12 s on a 244-page book).
- Viewer and print agree on line breaks in a fixture of 477 pages (385 of 385
  straddling paragraphs), but a line box that ends within half a pixel of the page
  foot is the knife-edge case in `docs/known-limitations.md` §4: the PDF decides, and
  `engine.split.page-drift` says so.
- `data-gp-split-reserve` (room for the closed foot while measuring) is not
  implemented: pull-back does the same one pass later.
- Table `tfoot`, several `tbody`, `ol[reversed]` and `white-space: pre` paragraphs are
  not cut.
