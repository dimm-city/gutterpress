# Rich editor: lessons learned (0.10 → 0.11 handoff)

The rich editing surface was built during the 0.10 cycle and **deferred to
0.11 by product decision on 2026-08-22**. 0.10 ships without it. This document
exists so the team that picks the work back up does not re-pay for the lessons
this cycle already paid for — every section below is something that actually
went wrong, what it cost, and the rule that now prevents it.

The work lives on branch `claude/gutterpress-0-10-0-release-aowezu`, parked as
a draft PR against `release/0.11.0`. It is not abandoned scaffolding: the
round-trip layer is proven lossless on real plugin books and the surface
renders like the printed page. What it is NOT yet is a viable primary
authoring surface, and the product bar for shipping it is exactly that —
see "The product bar" below.

## Read in this order

1. **This document** — the failure modes and the rules.
2. **`docs/remaining-work.md` → "Rich editor as the PRIMARY authoring
   surface"** — the open items, each with the measurement that sizes it.
   This section is the 0.11 backlog.
3. **`docs/editor-core-rule-provenance-plan.md`** — the as-built design for
   the hardest part: losslessly round-tripping books whose plugins rewrite
   the token stream. Do not modify the adoption pipeline without reading it.
4. **`docs/adr/0009-inline-editing-source-ranges.md`** — the "never guess an
   edit" rule. Every serializer and adoption decision obeys it.
5. **`CLAUDE.md` §5** (fail-closed editing contract, plugins stay plain
   markdown-it) and **§8** (the renderer is PWA-clean; the editor lives
   under that split).
6. **`docs/inline-editing-plan.md`** and **`docs/ux-design-contract.md`** —
   the surrounding editing/UX architecture the surface plugs into.
7. **`docs/galley-postmortem.md`** — how the previous editor attempt failed.
   Several rules below exist because of it.

## The product bar (why 0.10 ships without this)

The stated requirement: **rich mode is the PRIMARY editing surface, easier
for non-technical users than the markdown editor — authors must never need
to learn markdown.** The bar is interaction quality, not rendering fidelity.

At handoff the surface renders like the book (zero measured style
divergences on the chapters checked; 479/479 text runs matched on a
specialty chapter) and every save is lossless (14/14 field-guide chapters:
rich-editable, byte-fixpoint, rendered meaning preserved). The product owner
still judged it — correctly — not fit as a primary surface, chiefly because
the plugin-built regions that make up most of a specialty chapter can be
LOOKED at but not TYPED into, and because the interaction affordances
(image handling until late, block manipulation, discoverability) trail the
plain markdown editor. Fidelity was necessary; it was never sufficient.

## Stumbling blocks

### 1. Every gate was green while the product was unusable

At the moment the owner called the editor "pretty much worthless", the
branch had ~2,470 desktop tests passing, 14/14 lossless round-trips on the
real book, and a green typecheck/lint/render-purity wall. All of it was
true, and none of it measured whether an author could DO anything: every
gate parsed and serialized documents; none clicked, typed, or looked.

Three shipping defects were invisible to that wall — plugin regions
rendering as raw markdown source, the page background missing entirely, and
no way to select or adjust an image. All three were found by a human using
the built app.

**Rules now in force:**
- Editor work is not done until `npm run parity` and `npm run interaction`
  (packages/desktop) pass against a real plugin book, in the packaged app.
- A new check must be demonstrated to FAIL with its defect present before
  it counts. This is not ceremony: the interaction gate's region check
  passed vacuously on its first run — "83 regions, none showing source" on
  a chapter that has **no regions** (it was counting editable layout
  wrappers). It now refuses to report green on an empty set. A gate nobody
  has watched fail is decoration.

### 2. Fixpoint stability is not losslessness

`normalize(normalize(x)) === normalize(x)` holds perfectly while content is
being destroyed: an attribute dropped on the FIRST pass is stable on the
second. This shipped real damage once (authored `{.class}` braces silently
deleted) before the corpus gate was extended to also assert **rendered
meaning**: the HTML of the original and of the normalized text must match.
`packages/desktop/src/lib/editor/markdown-doc/attrs.ts`'s header tells the
full story. Keep both assertions; neither substitutes for the other.

### 3. Plugin core rules are where authored bytes die

The single hardest problem of the cycle. Block-rule provenance existed, but
the Dimm City plugin's **core-ruler transforms** consume authored marker
paragraphs (`@skill`, `@lede`, GFM alerts) and synthesize map-less
`html_block`s in their place. The editor's "generated content is
regenerable" heuristic dropped them — and the authored lines they came from
were already gone. Measured before the fix: **0 of 14** field-guide
chapters survived a save with meaning intact, silently.

The fix (`withCoreRuleProvenance`, `packages/cli/src/lib/markdown/
plugin-provenance.ts`) identity-diffs each core rule's before/after token
stream at registration and attributes every consume-and-replace to its
authored lines from the transform's own record. Iron rules:

- **Never infer authored source from gaps.** Attribution comes from
  tokenizer ground truth or the differ's record, or it does not happen.
- **Ambiguity poisons; poison refuses.** Moves, copies, in-place inline
  edits, overlapping rewrites — the file opens in source mode with the
  offending rule NAMED. No best-effort path exists, on purpose.
- **Plugins stay plain markdown-it** (CLAUDE.md §5). The host observes rule
  registration; it never extends the plugin API. Every temptation to add a
  Gutterpress-specific hook was resistible, and must stay resisted.

### 4. An opaque region must still look like the book

A region the parser cannot open becomes a `gp_plugin_atom`, and a
ProseMirror `toDOM` spec can only emit escaped text for it — so 305 regions
(109k characters, most of nine specialty chapters) painted `| AP |
Technique |` and `@skill` as literal source where print shows branded
cards. This was the single largest visual failure.

Two halves to the fix, both in `markdown-doc/parser.ts` +
`rich-editor.ts`'s `pluginAtomView`:

- The node carries the **plugin's own rendered HTML** (`attrs.html`),
  view-only, never serialized. Do not re-derive plugin presentation from
  CSS or re-parse markdown — the transform's output is ground truth.
- The parser **replays the open-tag stack across regions**. Plugins open
  elements in one region and close them several regions later
  (`.dc-skill-card > .dc-card-body > .dc-card-inner` opens at skill N,
  closes at skill N+1, with ability rows rendered by regions in between).
  Without the stack, each region's HTML is auto-closed at its own node
  edge and a card's contents render outside the card.

### 5. Do not ship the interior unlock without the two-state node view

The obvious next step — making those 305 regions typable — is measured and
99% safe on paper: re-parsing region interiors as ordinary markdown
preserves rendered meaning for **311 of 314** regions (106,483 of 106,931
locked characters), with the only three losses being GFM-alert blockquotes
(`> [!PULLQUOTE]`, `> [!NOTE]` shapes) that must stay atoms.

It was deliberately NOT shipped, because the display problem is unsolved:
the plugin's HTML is what makes the card, and an unlocked region renders as
plain markdown. Shipping the unlock alone trades "looks right, cannot type"
for "can type, looks wrong" — which is not progress, it is a different
complaint. The prerequisite is a **two-state node view**: the plugin's
markup when the caret is elsewhere, editable content when the caret is
inside, with the swap driven by a decoration rather than component state.
This is the first and largest 0.11 item.

### 6. A new surface must consume the RESOLVED config

The editor showed blank white paper for a book whose every page is a brick
wall. Root cause: `resolveProjectCss` read `manifest.styles` directly while
build and preview read `resolveConfig(...)` — and `engineStyles.native`
(the layer carrying the page background and all sixteen margin boxes) is
appended only by the latter. The same function already resolved PLUGINS
through `resolveConfig` two lines below; styles just never got the same
treatment.

**Rule:** any surface that asks "what does this book look like" goes
through `resolveProjectCss` / `resolveConfig`, never the raw manifest. In
review, a direct `manifest.styles` read is a defect.

### 7. One implementation per authoring concept

Image properties existed as ~50 lines inside the preview's context-menu
controller. When the rich surface needed the same dialog, the choice was
duplicate-or-extract. Extraction won: `readImageProperties` /
`applyImageProperties` in `src/lib/editor/image-classes.ts` now serve both
surfaces, so they cannot drift into two ideas of what `.gp-pin` plus edges
means or which combinations are refused. The conversion between the
document model's attribute MAP and the vocabulary's ordered TOKEN list goes
through `attrsToBraces`/`authoredBlockAttrs` — the same pair the serializer
and parser use — so no third spelling of "what a `{…}` suffix means" can
appear.

### 8. Trust only the packaged app — and calibrate your instruments

`vite dev` and the packaged app genuinely differ (tree-shaking hides
renderer leaks that crash dev, and vice versa — CLAUDE.md §8's history).
Beyond that: the parity tool's FIRST report was itself about one-third
wrong. Repeated text ("Equipment:") paired to the wrong occurrence, and
gaps were compared across column boundaries — roughly a third of ch04's 89
reported style diffs had never been real. We nearly "fixed" divergences
that did not exist.

**Rule:** before acting on a measurement tool's findings, adversarially
spot-check several by eye. The tools that survived that discipline are
listed under "Tooling inventory".

### 9. ProseMirror sharp edges already paid for

Do not rediscover these; the code comments at each site carry the full
story.

- `prosemirror-markdown` closes marks **by type** — correct for emphasis,
  wrong for nested authored HTML. `parser.ts` overrides
  `tokenHandlers.raw_html_close` to pop only the innermost mark, via
  `state.top()` (not `state.marks`, which is undefined).
- Same-type mark nesting also needs `excludes: ""` on the mark spec.
- ProseMirror's `list_item` always wraps a paragraph that print does not
  have for tight lists. That element steps out of the cascade entirely
  (`all: unset !important` under `:where(...)`) and every book rule that
  reaches THROUGH it gets a specificity-neutral copy
  (`withTightListVariants`, `packages/cli/src/engine/viewer/
  live-document.ts`).
- A `NodeSelection` is a structural act, not a formatting selection — the
  drag handle's selection must not summon the formatting bubble.
- Schema refusals are the feature, not a gap: an unmodelled construct opens
  the file in SOURCE mode with the reason named. Never add a guessing
  fallback (CLAUDE.md §5).

### 10. Process failures cost as much as code

- **Branch sprawl.** At the worst point there were four overlapping
  editor branches and three open PRs across two repos, plus stale content
  branches in the book repo. Reviews stalled and cleanup consumed a whole
  working session. Rule: one live branch per effort; supersede loudly and
  close the superseded PR the same day.
- **The sync revert.** A pull that died between merge and checkout was
  later published as a wholesale revert, deleting a merged migration from
  the book repo's main. Fixed by journalling the merge→checkout window
  (`checkout-journal.ts`, commit `3929732`). Lesson: any multi-step write
  into a user's repository needs a journal and a heal path.
- **CI signals.** `check_suite.completed: success` events are per-suite;
  always verify the PR's full check-run set. This repo's legacy commit-
  status endpoint returns an empty pending set (`state: "pending"`,
  `total_count: 0`) — it is not a signal at all; use the check-runs API.
- **AppImage builds from automation.** `workflow_dispatch` needs
  `actions: write` and tag pushes can be refused by the environment; the
  `[appimage]` commit-message marker is the trigger that works with plain
  push rights. All three triggers exist on the workflow for exactly this
  reason.

## What remains for 0.11

The full list with measurements is in `docs/remaining-work.md` → "Rich
editor as the PRIMARY authoring surface". In one line each:

1. **Two-state node view + interior unlock** — the 99%-safe unlock gated on
   solving display (stumbling block 5). The largest single win: it turns
   most of nine chapters from read-only to editable.
2. **Survivor-paragraph ancestry** — ordinary paragraphs BETWEEN two
   regions cannot carry the re-opened tag stack, so a paragraph print puts
   inside `.dc-path-shell` renders on the page background. A candidate fix
   (marker-less `gp_plugin_block` nesting) is sketched there; measure
   before attempting — it reshapes the token stream the wrapper pairer
   indexes into.
3. **Margin-box CONTENT on editor sheets** — the sheet layer paints the
   `@page` background and canvas background but not margin-box content, so
   folio and chapter chips are absent in the editor.
4. **Widen the interaction gate** — nothing yet exercises the drag handle,
   slash menu, selection bubble, undo across a region, or paste.

Separately (viewer, not editor): the design guide's on-screen pagination
under-counts print by two pages (was four before `4e96c56`) — recorded in
remaining-work; `scripts/viewer-revision-diff.mjs` is the tool that found
it.

## Tooling inventory

All measurement tools run from `packages/desktop` unless noted.

| Tool | Run | Proves |
| --- | --- | --- |
| `tools/editor-parity.mjs` | `xvfb-run -a npm run parity -- --book <dir> --file <ch.md> --keep-parent` | Editor↔preview visual parity in the packaged app: per-run style/page/gap diffs + screenshots |
| `tools/editor-interaction.mjs` | `xvfb-run -a npm run interaction -- --book <dir> --file <ch.md> --keep-parent` | An author can type, select/adjust an image, regions show markup, pages are painted |
| `tests/editor/plugin-book-roundtrip.manual.ts` | `bun tests/editor/plugin-book-roundtrip.manual.ts <book-dir>` | Per-chapter: rich-editable, byte fixpoint, rendered meaning preserved |
| `tests/editor/plugin-book-edit-cycle.manual.ts` | `bun tests/editor/plugin-book-edit-cycle.manual.ts <book-dir>` | Real ProseMirror transactions: edit locality, wrapper safety, stability |
| `packages/cli/scripts/viewer-revision-diff.mjs` (from cli) | see file header | Whether the VIEWER paginates a fixed book.html differently between two engine-bundle revisions |
| `tests/editor/*.test.ts` (corpus, provenance, region-preview, image-properties) | `bun test tests/editor` | The unit wall: ~830 tests incl. fixpoint + meaning gates over the corpus |

Point the manual tools at a real checkout of the Dimm City field guide
(dc-op-manual repo) — the fixture book exercises the shapes, but the field
guide is where every real defect was found.

## Numbers worth keeping

Measured 2026-08-21 on the field guide (dc-op-manual `main`) unless noted:

- Editor corpus: 39/41 first-party files rich-editable (one `footnote_ref`,
  one link-reference refusal — both by design).
- Field guide: 14/14 rich-editable · 14/14 byte-fixpoint · 14/14 rendered
  meaning preserved.
- Opaque regions: 305 atoms, 109,224 authored chars; dominated by 49 tables
  (29.7k), 112 `@skill` (23.9k), 34 `@learning-path` family.
- Interior-unlock feasibility: 311/314 regions meaning-preserving;
  106,483/106,931 chars would unlock; 3 losses, all GFM-alert blockquotes.
- Real-app parity (Augmerc): 479/479 runs both sides, 1 style diff
  remaining (a `.dc-specialty` wrapper the editor does not build).
- Design guide viewer vs print: 170 viewer pages vs 172 PDF pages (was
  168 vs 172 before `4e96c56`).
