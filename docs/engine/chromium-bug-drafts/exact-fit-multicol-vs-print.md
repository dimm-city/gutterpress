# Draft: paginated print and CSS Multicol round a fragmentainer-bottom line box differently

Status: **not filed**. Follow `../../filing-upstream-chromium-bugs.md` to file
it — component `Blink > Layout`, category **Content**, role **Web Developer**
(the wizard does not let a non-committer pick a component directly). Link back
to [dimm-city/gutterpress#268](https://github.com/dimm-city/gutterpress/issues/268)
in the first line of the body.

## Title to file

Paginated printing and CSS Multicol place the same fragmentainer-bottom line
box on opposite sides of a fit/overflow decision, at a sub-pixel margin

## Summary

`printToPDF` and CSS Multicol are two different Blink fragmentation contexts
that are, for this purpose, meant to agree: both fragment block content into
fixed-height boxes ("pages" in one, "columns" in the other) and both are
supposed to keep a line whose box fits and push one that does not. At a
boundary where a line's box ends within roughly half a CSS pixel of the
fragmentainer's bottom edge, the two contexts disagree about which side of
"fits" the line is on, for the *same* rendered geometry (same fonts, same
line-height, same fragmentainer height in CSS px). Print keeps the line;
Multicol overflows it by a comparable sub-pixel margin and pushes it to the
next fragmentainer.

## Repro

Minimal repro is [`docs/fixtures/exact-fit-boundary`](https://github.com/dimm-city/gutterpress/tree/main/docs/fixtures/exact-fit-boundary)
in the gutterpress repo — a single Markdown source, one stylesheet, built via
`gutterpress build`. The relevant CSS (unabridged copy in the fixture's
`styles/style.css`):

```css
@page {
  size: 8.5in 11in;
  margin: 0.875in 0.875in 1in;   /* → 876px content-box height at 96dpi */
}
body { font: 10.5pt Georgia, "Times New Roman", serif; line-height: 1.5; orphans: 3; widows: 3; }
h3 { break-after: avoid; }
h3 + p, p + pre { break-before: avoid; }
pre { overflow: hidden; padding: 0.7em 0.9em; margin: 0.7em 0 0.75em; }
pre code { font-size: 9pt; line-height: 1.5; }
```

with a `## Adding and switching looks` `<h3>`, an intro `<p>`, and a `<pre>`
whose fifth `<code>` line's box is the one that lands at the boundary.

- **Print (paginated print, `Page.printToPDF`)**: the `pre`'s third line's box
  bottom measures **875.98px** into an 876px content box — 0.02px of slack —
  and Chromium keeps it on the page with the heading, intro paragraph, and
  first two `pre` lines.
- **Multicol (`column-fill: auto`, fixed `height`, no `column-count`)**, laid
  out with the *identical* HTML/CSS wrapped in a column container sized to the
  same 876px content height: the same line's box bottom measures **876.36px**
  — a **0.36px overflow** — and Chromium fragments before it, carrying it (and,
  because `orphans: 3` then makes two remaining lines an illegal fragment, the
  whole `break-before: avoid` chain above it) into the next column.

Both measurements are from the same rendered page: `Range.getClientRects()`
per character for Multicol, `unpdf`'s text-run extraction grouped by baseline
for print; both projected to the same content-box coordinate space. Full
measurement method: `docs/native-parity-gate.md` in the same repo
(`packages/cli/scripts/native-parity-gate.ts`'s `EXACT_FIT_BROWSER_JS` +
`inspectPdf`).

## Control (what rules this out as "not a bug, just different content")

Rebuilding the same fixture with `pre { orphans: 2; widows: 2 }` (nothing else
changed) makes **both** contexts put line 3 on the same page — proving the
0.36px gap is a genuine geometry disagreement between the two fragmentation
contexts, not a difference in what content each one was asked to lay out. The
`orphans: 3` value only turns the existing 0.36px geometry disagreement into a
*visible* page-count disagreement (a lone third line failing the orphan
minimum, so the whole paragraph/heading chain above it is pushed too); it does
not create the disagreement.

A second control: the intro `<p>` immediately above the `pre` (unaffected by
`orphans`) sits at the *identical* top offset in both contexts (measured to
±0.01px) — the two fragmentation contexts agree on every line's position right
up to the one whose box happens to straddle the fragmentainer edge. The
divergence is confined to the boundary itself, not a cumulative drift.

## Expected

Either: (a) both fragmentation contexts round a fragmentainer-bottom line box
the same way (both keep it, or both push it), or (b) if the two are
intentionally allowed to differ (e.g. print snaps to whole CSS px for
device-pixel-accurate output, Multicol does not need to), that this is
documented as expected so downstream tooling can special-case it — as
gutterpress's own gate now does (`native-parity-gate.md`'s "EXACT-FIT
BOUNDARY" outcome) rather than treating it as a plain layout divergence.

## Environment

- Chromium 153.0.8010.0 (headless, `--no-sandbox --disable-dev-shm-usage`),
  Linux. Also reproduces on Chromium 151.0.7922.75 (the version most of this
  project's other measurements cite) — this is not new in 153.
- `printToPDF` via CDP `Page.printToPDF`; Multicol side is a plain navigated
  page with `Emulation.setEmulatedMedia({media: "print"})` set (so `@page`
  rules apply identically) but laid out as an on-screen Multicol container,
  not printed.

## Why we are not treating this as ours to fix

We are the CSS Paged Media polyfill's author, not Chromium's — see
[`CLAUDE.md`](../../../CLAUDE.md), "The rendering engine and every
polyfill/shim are NOT the product... they are expected to be removed as
Chrome's support improves." We tried to compensate for this in our own
Multicol-based preview (giving its fragmentainer's rendered height a small
constant bonus) and rejected the fix: it breaks an existing invariant test the
moment the bonus is non-zero (`zoom.test.ts` asserts the strip's rendered box
carries no extra height beyond its own CSS custom property), and an earlier,
broader version of the same idea is on record in this repo's own history
matching one page geometry (6×9in) and failing to generalize to another
(210×297mm/A4) — i.e. the correct compensating constant is not constant. Full
writeup: `docs/engine/ENGINE.md` §4.
