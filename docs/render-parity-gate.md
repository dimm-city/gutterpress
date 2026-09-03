# Render-parity gate

A gate that answers "did this change move the printed page" without a human
looking at pixels. It compares two PDFs of (what should be) the same
document — page count, page size, every text run's exact string and extents,
every image's placement — and fails loudly on anything an author would
actually see move, at a configurable tolerance.

Built directly over `packages/cli/src/lib/pdf-inspect.ts`'s existing PDF.js
primitives. No new dependency, no rasterization (CLAUDE.md §1/§3).

- Pure logic: `packages/cli/src/lib/render-parity.ts` (`extractReport`,
  `compareReports`, `formatDiffs`, `serializeReport`).
- CLI: `packages/cli/scripts/render-parity.ts`, a bun script beside
  `scripts/native-parity-gate.ts` — **not** a published `gutterpress`
  subcommand.
- CI wiring: the `render-parity` job in `.github/workflows/ci.yml`.

## Usage

```bash
# Extract a canonical report from a built PDF.
bun scripts/render-parity.ts extract book.pdf --out report.json

# Compare two sides — either may be a .pdf (extracted on the fly) or a
# previously-extracted .json report.
bun scripts/render-parity.ts compare baseline.json candidate.pdf \
  [--tolerance 0.5] [--waive waivers.json] [--out diff.json]
```

`compare` prints one line per unwaived diff (`page kind before -> after`),
then any waived diffs and unused-waiver warnings, then a one-line summary:

```
CLEAN: 295 pages
DIFF: 295 vs 296 pages, 41 diff(s) (3 waived), tolerance 0.5pt
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean, or every diff is waived |
| 1 | At least one unwaived diff |
| 2 | Usage error, IO error, or an invalid waiver (e.g. missing `reason`) |

## Report format

`extract` writes a canonical, deterministic JSON report: fixed key order,
every number rounded to 3 decimal places, `JSON.stringify(report, null, 1)`
plus a trailing newline. Two extractions of the same PDF are byte-identical
files, which is the gate's own acceptance test (see
`render-parity.acceptance.test.ts`) and what makes a committed baseline
report diff sanely in git.

```json
{
 "version": 1,
 "pageCount": 2,
 "pages": [
  {
   "w": 612,
   "h": 792,
   "text": [
    { "s": "Chapter One", "x": 72, "y": 700, "w": 84.5, "h": 14 }
   ],
   "images": [
    { "x": 100, "y": 200, "w": 144, "h": 96 }
   ]
  }
 ]
}
```

Deliberately excluded, because it is either non-deterministic across
runs/environments or meaningless for parity: file paths, timestamps, pdf.js's
own post-subsetting font names, and PDF XObject resource names.

## Comparison

Per page: page count and page size compare exactly; text runs and images
align by **index** within the page. A text run's string must match exactly;
its extents (x/y/w/h) and an image's extents compare within `--tolerance`
points (default 0.5). A string mismatch stops further index comparison on
that page — once content has reflowed, every later index is misaligned by
construction, so one line names the divergence instead of flooding the
report with reflow noise. A page whose diff count exceeds 12 lines is
truncated in the printed output (`...N more`) — the full set still decides
the exit code; only the printed report is capped for readability.

## Known blind spot: `filter` rasterizes text out of reach

Investigated in issue #259, filed after `.dc-specialty-intro` body text and
`.section.tabbed` body text in a private field guide were found invisible to
this gate — a change confined to that prose compared as identical.

**The mechanism**, confirmed on a public fixture that mirrors the same
construct (`docs/fixtures/rasterized-text/book`, pinned by
`render-parity.rasterized-text.test.ts`): an element with a `filter`
declaration (any value other than `none`) makes Chromium rasterize its
**entire subtree** into one embedded bitmap image before the PDF's content
stream is written — see `docs/engine/ENGINE.md` §10 for the underlying
measurement ("sentinel strings extractable: 2 -> 0", "fonts in the PDF: none
at all"). The text was never emitted as a PDF text object. This is case 3
from the issue's own triage, not case 1 or 2:

- It is **not** `getTextPass`'s `it.transform && it.str.trim().length > 0`
  filter dropping something present — `page.getTextContent()` returns zero
  items for that region. There is nothing to keep.
- It is **not** a pdf.js quirk on a marked-content/Type3 sequence that
  Chromium otherwise still emits as text — the region contains a
  `paintImageXObject` operator where the text glyphs would have been,
  confirmed directly against the operator list (`getOpPass`), not merely
  inferred from the text pass coming back empty.
- No text extractor — pdf.js-based or otherwise — can recover this content,
  because it is pixels, not glyphs. **Do not try to extend the extractor for
  this case**; there is nothing left in the PDF for a bigger extractor to
  find.

**Why `.dc-specialty-intro` and `.section.tabbed` specifically:** both give a
non-rectangular (`clip-path`) card a drop shadow that must follow that
silhouette. A shape-following shadow needs `filter: drop-shadow()` — a plain
`box-shadow` only follows the border box — which is why these two components
kept `filter` after the rest of `.section` chrome moved to vector shadows.
`clip-path` on its own does **not** reproduce this (confirmed on the same
fixture): only `filter` does. `backdrop-filter` and `mix-blend-mode` alone
were also tried and did not reproduce it either, on Chromium 152 — treat that
as today's measured Chromium behavior worth re-checking after a Chromium
bump, not a permanent guarantee about those two properties.

**How to tell you're inside this blind spot** — a way to detect it, not just
remember it: `packages/cli/src/lib/printsafe.ts`'s
`printsafe/no-risky-print-effects` rule already warns on every `filter`
declaration, and its message names this exact consequence ("text becomes
unselectable, unsearchable, and inaccessible") and points back here. Run
it — the CLI's pre-build lint gate and the desktop Problems panel both call
`checkCss` — over any stylesheet you're about to trust render-parity to
cover. **If a text-bearing element or one of its ancestors trips that
`filter` warning, render-parity cannot see a text-only change confined to it
— verify such a change by other means (a rendered preview, a visual diff, or
careful review), not by a clean gate run.**

This does not weaken the gate for everything else on the same page: page
geometry, image placement, and any text **outside** a filtered subtree are
still compared exactly as before — `render-parity.rasterized-text.test.ts`'s
"contrast" case pins that an ordinary text edit elsewhere on the same page
is still caught.

## Waivers

A waiver excuses one class of diff, with a mandatory one-line reason —
waivers are reviewed like code, not a way to silence the gate. A waiver that
matches nothing this run is printed as a warning (stale; safe to delete) but
does not fail the gate. A waiver with an empty or missing `reason` is a usage
error (exit 2), never a silent pass.

```json
[
  {
    "page": 42,
    "kind": "text",
    "match": "erratum",
    "reason": "GH-123: intentional one-line correction, re-baselined 2026-09-02"
  },
  {
    "kind": "page-count",
    "reason": "GH-118: front-matter reflow added a blank verso, expected"
  }
]
```

| Field | Required | Notes |
|---|---|---|
| `page` | for `text`, `image`, `page-size` | 1-based page number. Omit for `page-count` — there is no single page. |
| `kind` | yes | `"text"` \| `"image"` \| `"page-size"` \| `"page-count"` |
| `match` | no | Substring the text run's string must contain. Only meaningful for `kind: "text"`. |
| `reason` | yes | Non-empty, one line: why this diff is expected. |

`packages/cli/scripts/render-parity-waivers.json` (committed as `[]`) is
gutterpress's own waivers file for the CI job below — add an entry there only
for a genuine, reviewed, intentional change to one of the public fixtures'
rendered output. The book repo keeps its own separate waivers file for its
own gate (dc-op-manual's `dc#49`).

## CI: same-job A/B, and why

The `render-parity` job in `.github/workflows/ci.yml` builds the base
branch's CLI and the PR's CLI **in one job, against the same checked-out
fixture sources**, then compares the two PDFs per fixture
(`examples/gutterpress-user-guide`, `examples/with-design-guide/book-01`,
`examples/with-design-guide/design-guide`). It runs on `pull_request` only —
it needs a base commit to diff against.

A report captured weeks earlier on a different Chromium build drifts by
fractions of a point on font hinting/shaping alone and produces false diffs
that have nothing to do with the change under review. Building both sides in
the same job, on the same runner, with the same Chromium, removes that
variable entirely: any diff the job reports is attributable to the code
change, not the environment. This is also why only the CLI differs between
the two builds — both render the **head** checkout's own fixture sources, so
a diff can only come from the compiler, never from the fixture content moving
out from under the comparison.

This job gates the two public example books shipped in this repo — the floor
every core PR must clear. The real subject of the 0.10.6 milestone, the Dimm
City field guide, lives in the private `dc-op-manual` repo and is gated by
that repo's own CI, which runs this same tool against its own committed
baseline reports (`dc-op-manual#49`).

## Running it from the book repo

`dc-op-manual` installs `gutterpress` from npm and cannot import a script out
of that package — this tool ships as a script in the gutterpress repo, not a
published subcommand (a deliberate 0.10.6 scope decision: no beta channel).
To run it, check out gutterpress alongside the book repo and invoke the
script directly:

```bash
git clone --depth 1 --branch v0.10.6 https://github.com/dimm-city/gutterpress.git ../gutterpress
cd ../gutterpress && bun install

bun packages/cli/scripts/render-parity.ts compare \
  /path/to/baseline-report.json /path/to/candidate.pdf \
  --waive /path/to/dc-op-manual/waivers.json
```

The book's own build keeps using its pinned `gutterpress` npm dependency —
only the parity tool itself runs from a separate checkout.
