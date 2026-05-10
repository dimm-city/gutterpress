@chapter #ch-palette .palette

# Color Palette

<div class="lede">The book uses a small, intentional palette defined entirely in CSS custom properties. Change any token in <code>§ 1 BRAND TOKENS</code> of <code>guide.css</code> and every rule that references it updates automatically.</div>

## Primary Colors

<div class="palette">
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #1b4f8a"></span>
    <div class="swatch-body">
      <span class="swatch-name">Accent</span>
      <span class="swatch-var">--color-accent</span>
      <span class="swatch-hex">#1b4f8a</span>
    </div>
  </div>
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #c0532a"></span>
    <div class="swatch-body">
      <span class="swatch-name">Accent Alt</span>
      <span class="swatch-var">--color-accent-alt</span>
      <span class="swatch-hex">#c0532a</span>
    </div>
  </div>
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #1a1a2e"></span>
    <div class="swatch-body">
      <span class="swatch-name">Ink</span>
      <span class="swatch-var">--color-ink</span>
      <span class="swatch-hex">#1a1a2e</span>
    </div>
  </div>
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #ffffff; border: 1px solid #d0d4e8"></span>
    <div class="swatch-body">
      <span class="swatch-name">Paper</span>
      <span class="swatch-var">--color-paper</span>
      <span class="swatch-hex">#ffffff</span>
    </div>
  </div>
</div>

## Secondary Colors

<div class="palette">
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #4a4a66"></span>
    <div class="swatch-body">
      <span class="swatch-name">Ink Muted</span>
      <span class="swatch-var">--color-ink-muted</span>
      <span class="swatch-hex">#4a4a66</span>
    </div>
  </div>
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #9a9ab8"></span>
    <div class="swatch-body">
      <span class="swatch-name">Ink Faint</span>
      <span class="swatch-var">--color-ink-faint</span>
      <span class="swatch-hex">#9a9ab8</span>
    </div>
  </div>
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #d0d4e8"></span>
    <div class="swatch-body">
      <span class="swatch-name">Rule</span>
      <span class="swatch-var">--color-rule</span>
      <span class="swatch-hex">#d0d4e8</span>
    </div>
  </div>
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #f0f4fa"></span>
    <div class="swatch-body">
      <span class="swatch-name">Tint</span>
      <span class="swatch-var">--color-tint</span>
      <span class="swatch-hex">#f0f4fa</span>
    </div>
  </div>
</div>

## Semantic Fill Colors

These tints back specific callout types. They should remain clearly distinct from the page background.

<div class="palette">
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #fef6ec"></span>
    <div class="swatch-body">
      <span class="swatch-name">Tint Warn</span>
      <span class="swatch-var">--color-tint-warn</span>
      <span class="swatch-hex">#fef6ec</span>
    </div>
  </div>
  <div class="swatch">
    <span class="swatch-color" style="--swatch: #edf7f0"></span>
    <div class="swatch-body">
      <span class="swatch-name">Tint Tip</span>
      <span class="swatch-var">--color-tint-tip</span>
      <span class="swatch-hex">#edf7f0</span>
    </div>
  </div>
</div>

---

## Token Reference

<table class="token-table">
<thead><tr><th>Variable</th><th>Value</th><th>Where used</th></tr></thead>
<tbody>
<tr><td>--color-ink</td><td><span class="color-chip" style="background:#1a1a2e"></span>#1a1a2e</td><td>Body text, list items</td></tr>
<tr><td>--color-ink-muted</td><td><span class="color-chip" style="background:#4a4a66"></span>#4a4a66</td><td>Captions, secondary labels, figcaptions</td></tr>
<tr><td>--color-ink-faint</td><td><span class="color-chip" style="background:#9a9ab8"></span>#9a9ab8</td><td>Running headers, folios, placeholders</td></tr>
<tr><td>--color-accent</td><td><span class="color-chip" style="background:#1b4f8a"></span>#1b4f8a</td><td>H1, H2, links, callout borders, thead</td></tr>
<tr><td>--color-accent-alt</td><td><span class="color-chip" style="background:#c0532a"></span>#c0532a</td><td>Blockquote border, warning callout, cover rule</td></tr>
<tr><td>--color-paper</td><td><span class="color-chip" style="background:#ffffff; border:1pt solid #d0d4e8"></span>#ffffff</td><td>Page background</td></tr>
<tr><td>--color-tint</td><td><span class="color-chip" style="background:#f0f4fa"></span>#f0f4fa</td><td>Callout note fill, sidebar fill, code bg</td></tr>
<tr><td>--color-tint-warn</td><td><span class="color-chip" style="background:#fef6ec"></span>#fef6ec</td><td>Warning / caution callout fill</td></tr>
<tr><td>--color-tint-tip</td><td><span class="color-chip" style="background:#edf7f0"></span>#edf7f0</td><td>Tip / success callout fill</td></tr>
<tr><td>--color-rule</td><td><span class="color-chip" style="background:#d0d4e8"></span>#d0d4e8</td><td>Borders, hr, table rules, chapter-num</td></tr>
</tbody>
</table>

---

## Usage Rules

**Use `--color-accent` for one dominant hierarchy signal per spread.** If headings, callout borders, and links all pull the eye with the same hue, the color works as navigation. Introducing a second accent on the same page dilutes both.

**`--color-accent-alt` is for emphasis that competes with or warns against the main flow** — warning callouts, blockquote borders, the cover rule stripe, and CTA buttons. Use it sparingly; its value is contrast with `--color-accent`.

**Extend the palette only when the manuscript needs it.** Extra colors accumulate faster than they're removed, and a tight palette is most of what makes a book feel *designed*.

## Print considerations

If the book is heading to offset print:

- Define each color in CMYK alongside hex — the conversion is not one-to-one for saturated colors.
- Avoid pure RGB black (`#000`) for body text. A near-black with a slight cool or warm cast reproduces more richly on coated stock.
- Test thin strokes (rules, callout borders) at press resolution. A 0.5pt rule can disappear at 300 dpi on uncoated paper.
- Check `--color-tint` tints have ≥ 5% distinguishable difference from `--color-paper` on the intended paper stock.
- Saturated accent colors (`--color-accent` #1b4f8a, `--color-accent-alt` #c0532a) should be converted to CMYK equivalents before offset print — RGB-to-CMYK conversion is not one-to-one for deep blues and warm oranges.
- Request a physical proof before the full print run. Colors that look correct on screen and in the PDF preview can shift significantly on uncoated or cream-tinted paper stock.
- On cream stock (approximately #f5f0e8), re-test `--color-tint` (#f0f4fa) to confirm it remains distinguishable from the background; the contrast may fall below the 5% threshold.
- Verify `--color-ink` (#1a1a2e) total ink coverage does not exceed your print provider's TAC limit — near-black with full-color channels can exceed 280% on some offset workflows.
