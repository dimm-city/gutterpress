# Preview/print parity gate

`packages/cli/scripts/native-parity-gate.ts` proves that the on-screen viewer
paginates a book the way Chromium prints it. The two use different
fragmenters — the viewer lays the book out in a multicol strip
(`src/engine/viewer/fragment.ts`), the PDF comes from Chromium's own print
engine — and CLAUDE.md's rule for the viewer is that it may re-present the
author's pages but never re-decide them. This gate is the proof.

It is a different tool from the [render-parity gate](./render-parity-gate.md),
which compares two PDFs of the same book across a code change.

## What it compares

For each fixture book the script stages the book exactly as `gutterpress
build` would, builds it once, and compares, per fixture: (a) the total page
count, (b) the page of every `target-counter()` target the compiler
instrumented, (c) the folio each of those resolves to, and (d) the page of
every heading — the script gives every heading a stable id and an empty
self-referential anchor so the PDF carries a named destination for it. The
script's header comment describes each check and the measurement channel
behind it.

## Running it

```bash
cd packages/cli
bun run parity:gate                        # every registered fixture
bun scripts/native-parity-gate.ts <dir>…   # explicit project dirs
```

Staged books land under `/tmp/gutterpress-parity/<fixture>/` (override with
`GUTTERPRESS_PARITY_DIR`; a `docs/fixtures/<name>/book` fixture is named
`<name>`). The registered fixtures are the two example books, the three
`with-design-guide` manifests, and the minimal repro books under
`docs/fixtures/`, each of which pins a divergence the gate once caught — or,
for `exact-fit-boundary`, the outcome below. CI runs the whole list
(`.github/workflows/ci.yml`).

## The three outcomes

Every fixture ends in exactly one of these, and the summary counts them:

| Outcome | Meaning | Exit |
|---|---|---|
| **CLEAN** | No check disagreed. | passes |
| **EXACT-FIT BOUNDARY** | Check (d) disagreed, and check (e) measured the first disputed boundary as a sub-pixel exact fit (rule below). The measurements are printed; the downstream divergences — two-sided ones both fragmenters place on the boundary page or later — are listed for information but not counted. A one-sided miss or a divergence upstream of the boundary still counts, and fails the run as a divergence. | passes |
| **DIVERGENCE** | Anything else. Every divergence must be an explicit `KNOWN_DIVERGENCES` entry with a reason; an unlisted one fails the run. The allowlist is empty and CLAUDE.md requires it to stay that way. | fails (1) |

### The exact-fit rule

Print positions each line on whole CSS pixels; multicol keeps 1/64px. The
same line therefore sits up to about 0.4px lower or higher in the preview
than in the PDF. When that line's box ends within that drift of the column
bottom, one fragmenter keeps it and the other overflows it — and because
`orphans`/`widows` and `break-*: avoid` then make each choose a different,
correct break, every heading after that point reports a divergence. Issue
#261 saw 91 of them on the user guide from one 0.6px input difference; #268
saw the same again. None of that is a fragmenter bug, so the gate measures
the boundary instead of listing its consequences:

1. Take the **first disagreeing heading in document order** (both sides
   measured; a one-sided miss stays a plain divergence).
2. Walk forward from the last heading both sides agreed on to the **first
   page whose last line the two fragmenters disagree on**. The side that has
   that line on the page *kept* it; the other *pushed* it.
3. Measure the disputed line's box bottom against the column height on both
   sides — its **slack** (positive = room to spare, negative = overflow).
4. Classify as an exact-fit boundary only when the fit outcomes are opposite
   and the geometry agrees: the keeping side's slack is at or above the edge
   (within the 1px tolerance, allowing for rounding), the pushing side's
   slack is negative, and the two differ by at most **1px**
   (`EXACT_FIT_TOLERANCE_PX`).

Anything else stays a divergence and fails exactly as before: the boundary
could not be located or measured, the pushing side fits the line once its
break rules are neutralised (a break-rule disagreement, not geometry), or the
slacks differ by more than the tolerance. The reason is printed as a `NOTE`
above the divergence list. This is a measured classification of one
boundary, not an excuse list — nothing is added to `KNOWN_DIVERGENCES`.

A worked example, the #268 boundary (`docs/fixtures/exact-fit-boundary`,
which is a slice of the user guide's styling chapter on its own stylesheet):

```
EXACT-FIT BOUNDARY at p2 — print kept the line, the preview pushed it (first differing heading gp-parity-h1: print=p2 viewer=p3)
  line   "gutterpress ext add ./parchment.zip ./my-book …" (pre, line 3 of 5)
  print  baseline 869.98px, line box ends 875.98px of 876px — slack +0.02px
  viewer baseline 870.36px, line box ends 876.36px of 876px — slack -0.36px
  delta  0.38px (tolerance 1px) — 1 downstream divergence(s) listed for information, not counted:
  [headingPageMap] id=gp-parity-h1 print=p2 viewer=p3
```

Print kept the `pre`'s third line with its box ending exactly at the 876px
column bottom; the viewer laid the same line 0.38px lower, pushed it, and its
`orphans: 3` plus the stylesheet's `p + pre` / `h3 + p { break-before: avoid }`
walked the heading onto the next page in the preview only.

### How the boundary is measured

- **Print side** — the PDF's text runs (`getTextPass` in
  `src/lib/pdf-inspect.ts`, via unpdf) grouped into lines by baseline, reduced
  to the page's content box so running heads and folios drop out. A line's
  baseline plus the line box's baseline-to-bottom tail gives its box bottom.
- **Viewer side** — a fresh viewer mount of the same document. Lines are read
  from per-character `Range` rects; line-box extents and baselines come from
  font metrics measured on a probe outside the document flow, so nothing in
  the book moves. When print kept the line, the chain the viewer pushed has
  its `avoid` values and `orphans`/`widows` neutralised and is relaid out, so
  the projection reads where the viewer's geometry puts the line rather than
  where its break rules moved it. When the viewer kept the line, print's
  position for it is projected from print's last kept line.

The committed fixture pins this outcome on the CI font stack and Chromium. On
a different font stack the same slice may agree on both sides and read CLEAN
— also a pass. It can never fail the gate on its own.
