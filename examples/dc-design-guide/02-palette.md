@chapter #ch-palette .palette ch="1"

# Color Palette

@lede

Two accent registers on cream substrate. Creaturepunk fire (crimson, rust, orange, amber) for printed content. HUD digital (blue, magenta) for cybernetics and tech. The page is never black.

@end-lede

@page

> [!NOTE]
> **Register rule:** Use fire palette (crimson, orange, rust) for printed lore, ability text, and danger. Use HUD digital (blue, magenta) for cybernetics, tech overlays, and system chrome. Never mix fire and HUD on the same UI element.

## Paper & Ink

<div class="dc-palette-grid">
  <div class="dc-palette-swatch border on-light"><strong>BG</strong><code>#d3cec6</code><code>--bg</code></div>
  <div class="dc-palette-swatch border on-light"><strong>Paper Cream</strong><code>#f5f0e6</code><code>--paper-cream</code></div>
  <div class="dc-palette-swatch border on-light"><strong>Paper Light</strong><code>#ebe5d8</code><code>--paper-light</code></div>
  <div class="dc-palette-swatch border on-light"><strong>Paper Aged</strong><code>#ddd6c6</code><code>--paper-aged</code></div>
  <div class="dc-palette-swatch bg-ink on-dark"><strong>Ink</strong><code>#1a1715</code><code>--ink</code></div>
  <div class="dc-palette-swatch bg-ink-smoke on-dark"><strong>Ink Smoke</strong><code>#4a4540</code><code>--ink-smoke</code></div>
  <div class="dc-palette-swatch bg-ink-dust on-light"><strong>Ink Dust</strong><code>#8a8378</code><code>--ink-dust</code></div>
</div>

## Creaturepunk Fire

<div class="dc-palette-grid">
  <div class="dc-palette-swatch bg-crimson on-dark"><strong>Crimson</strong><code>#d41200</code><code>--crimson</code></div>
  <div class="dc-palette-swatch bg-blood on-dark"><strong>Blood</strong><code>#a30900</code><code>--blood</code></div>
  <div class="dc-palette-swatch bg-orange on-dark"><strong>Orange</strong><code>#f24d00</code><code>--orange</code></div>
  <div class="dc-palette-swatch bg-rust on-dark"><strong>Rust</strong><code>#c23000</code><code>--rust</code></div>
  <div class="dc-palette-swatch bg-amber on-light"><strong>Amber</strong><code>#e89200</code><code>--amber</code></div>
  <div class="dc-palette-swatch bg-deep-rust on-dark"><strong>Deep Rust</strong><code>#761800</code><code>--deep-rust</code></div>
</div>

## HUD Digital

<div class="dc-palette-grid">
  <div class="dc-palette-swatch bg-hud-blue on-dark"><strong>HUD Blue</strong><code>#2a6a8a</code><code>--hud-blue</code></div>
  <div class="dc-palette-swatch bg-hud-blue-bright on-light"><strong>HUD Bright</strong><code>#48a4e0</code><code>--hud-blue-bright</code></div>
  <div class="dc-palette-swatch bg-hud-blue-dim border on-light"><strong>HUD Dim</strong><code>#c9d6e2</code><code>--hud-blue-dim</code></div>
  <div class="dc-palette-swatch bg-hud-magenta on-dark"><strong>HUD Magenta</strong><code>#b85820</code><code>--hud-magenta</code></div>
</div>

@section .two-column

## Surface Tokens

<div class="dc-palette-grid">
  <div class="dc-palette-swatch bg-hud-panel border on-light"><strong>HUD Panel</strong><code>#eeece8</code><code>--hud-panel</code></div>
  <div class="dc-palette-swatch bg-surface-tint-3 border on-light"><strong>Surface 3</strong><code>#f2f0ec</code><code>--surface-tint-3</code></div>
  <div class="dc-palette-swatch bg-surface-orange-tint border on-light"><strong>Orange Tint</strong><code>#dcd4bc</code><code>--surface-orange-tint</code></div>
</div>

## Border Tokens

<div class="dc-palette-grid">
  <div class="dc-palette-swatch bg-border-hairline on-light"><strong>Hairline</strong><code>#d0c8b5</code><code>--border-hairline</code></div>
</div>

Additional border values come directly from ink-scale tokens (`--ink`, `--ink-smoke`, `--ink-dust`) — no dedicated border aliases for those.

> [!NOTE]
> `--paper-stain` and `--border-hairline` share the same hex value (`#d0c8b5`). `--paper-stain` is for textured-background fills; `--border-hairline` is for rule lines. Use each semantically — if the design evolves, these may diverge.

@end-section

@section .two-column

## Spacing Token Notes

> [!NOTE]
> `--gutter` is the structural two-column gap (`0.15in`). `--space-2xl` remains the `0.25in` spacing-scale step. Keep them separate: gutter changes reflow layouts, spacing-scale changes adjust component rhythm.

## Usage Rules

- Crimson is the dominant accent. One crimson element per composition; stack additional emphasis with orange.
- HUD blue and magenta signal cybernetic or tech-flavored content. Never mix fire and HUD accents on the same UI element.
- Paper surfaces are for raised elements (cards, callouts). The page background (`--bg`) is the canvas; cream is the surface.

@end-section

@page

## Page Background & Brick Texture

The page background uses `--bg: #d3cec6` — a light cool gray that contrasts cream paper surfaces (cards, callouts, panels). The Dimm City aesthetic adds a subtle aged-brick texture over this background via a 200×200px placeholder tile (`https://placehold.co/200x200/png?text=Brick`) applied to `.pagedjs_sheet`. Apply it in your book's CSS layer file:

```css
/* Apply to .pagedjs_sheet, not @page — Paged.js maps @page backgrounds to
   .pagedjs_page, which .pagedjs_sheet then covers. */
.pagedjs_sheet {
  background-image: url("https://placehold.co/200x200/png?text=Brick");
  background-repeat: repeat;
}
```

The PNG uses RGBA with very low opacity so the `#d3cec6` gray reads through cleanly. Do not scale or crop the tile — let it repeat at native size.

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#d3cec6` | Page background — set on `.pagedjs_sheet` to control page surface color in both preview and PDF |

---

## CMYK Notes

CMYK approximations for the four primary colors:

| Color | Hex | CMYK |
|---|---|---|
| Crimson | #d41200 | ~0/92/92/17 |
| Orange | #f24d00 | ~0/67/100/5 |
| HUD Blue | #2a6a8a | ~69/25/0/46 |
| Ink | #1a1715 | ~0/5/10/90 |

Keep total ink coverage under 280% for coated stock and under 240% for uncoated stock. RGB-to-CMYK conversion is not one-to-one for saturated colors — request a physical proof before the full print run.

---

@section .two-column

## Font Size Token Notes

> [!NOTE]
> Pull quotes use `--fs-h2` directly. They are intentionally set at section-heading weight rather than a separate display scale.

> [!NOTE]
> Chevron banners use `--fs-h1` directly. This keeps banner headings and body H1s on the same display scale.

## See It In Action

These examples show the DC palette applied to real book pages using actual Dimm City Field Guide content.

- [Front Matter & TOC](#ch-example-front-matter) — cream paper and ink-dust on credits and TOC pages
- [Chapter Openers](#ch-example-chapter-opener) — crimson chevron banners and brick-texture background in context
- [Specialty Overview](#ch-example-specialty-overview) — specialty palette in action across intro pages
- [Specialty Profile](#ch-example-specialty-profile) — fire palette on skill cards and spray banners
- [Rules & Mechanics](#ch-example-rules) — HUD blue on outcome tables and roll chips
- [Dream Master Pages](#ch-example-dm-npcs) — amber warnings and ink-smoke secondary text
- [Gear & Tech](#ch-example-gear-tech) — fire-palette rules tables and cybernetics reference

> [!NOTE]
> **Ink coverage cap:** Keep total CMYK coverage under 280 % for coated stock and under 240 % for uncoated. Saturated fire palette colors run high — request a physical proof before full print run.

@end-section
