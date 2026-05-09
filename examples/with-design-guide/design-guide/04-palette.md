# Palette

The book uses a deliberately small palette so the reader's eye knows
where to land. The swatches below are the source of truth — change them
in `shared/styles/main.css` and the book and the guide both update.

<div class="palette">
  <div class="swatch" style="--swatch:#1a1a1a"><span>Body</span><code>#1a1a1a</code></div>
  <div class="swatch" style="--swatch:#444444"><span>Quote</span><code>#444444</code></div>
  <div class="swatch" style="--swatch:#999999"><span>Rule</span><code>#999999</code></div>
  <div class="swatch" style="--swatch:#f3f3f3"><span>Code bg</span><code>#f3f3f3</code></div>
</div>

## When to extend

Add a swatch only when the manuscript needs it. Extra colors creep in
faster than they're removed, and a tight palette is most of what makes a
book feel "designed."

## Print considerations

If the book is heading to print:

- Define each color in CMYK as well as hex — the conversion is not
  one-to-one for saturated brand colors.
- Avoid pure RGB black (`#000`) for body text; a "rich black" CMYK mix
  reproduces better on coated stock.
- Test thin strokes (rules, accents) at the actual press resolution; what
  reads on screen at 1pt may disappear at 300 dpi.
