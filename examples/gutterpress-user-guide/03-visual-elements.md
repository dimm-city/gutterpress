# Visual Elements {#ch-visual}

@section .lede

Callouts highlight critical information. Images bring pages to life. This chapter covers both — from basic syntax to full-bleed artwork and print-safe image requirements.

@end-section

## Callouts

> **Plugin required:** The `> [!note]` GitHub-style callout syntax requires a callout plugin. See `examples/` for a reference implementation. The five callout types below are what such a plugin provides.

Callouts draw attention to important information. Five standard types cover most needs:

```markdown
> [!note]
> General information, context, or explanations.

> [!tip]
> Helpful advice, shortcuts, or best practices.

> [!warning]
> Cautions, important considerations, potential issues.

> [!danger]
> Critical warnings — data loss, irreversible actions.

> [!info]
> Neutral references, definitions, supplementary details.
```

### Custom titles

Add text after the type marker to override the default title:

```markdown
> [!warning] Browser Compatibility
> Internet Explorer 11 does not support this feature.

> [!tip] Performance Optimization
> Cache frequently accessed data to improve response times.
```

### Multi-paragraph callouts

Each continuation line must be prefixed with `>`:

```markdown
> [!warning] Read This Carefully
> This callout spans multiple paragraphs.
>
> Each paragraph needs the `>` prefix.
>
> - Lists work inside callouts
> - **Bold**, *italic*, and `code` formatting too
```

### Callout guidance

@section

Use at most 2–3 callouts per page — overuse reduces impact. Match the type to the severity:

| Type | Color | Use for |
|------|-------|---------|
| Note | Blue | Context, background, explanations |
| Tip | Green | Optional improvements, shortcuts |
| Warning | Orange | Things that could go wrong |
| Danger | Red | Critical issues, data loss |
| Info | Gray | Definitions, neutral references |

@end-section

## Images

### Basic image syntax

```markdown
![Alt text](assets/image.jpg)

![Image with title](assets/diagram.png "Caption text")
```

Always provide meaningful alt text. For purely decorative images, use empty alt text — leave the brackets empty: `![]`.

**Where images live:** put the image file inside your project folder and
reference it with a path relative to the manifest — Gutterpress copies exactly
the images your markdown (or CSS) references, keeping your own folder
structure in the output. There's no directory to declare. A reference that
points outside the project (`../shared/logo.png`) fails the build with a
message telling you to copy the file in instead.

### Image sizing

Use `markdown-it-attrs` (bundled — no install step needed) for precise sizing:

```markdown
![Portrait](assets/portrait.jpg){width="300px"}

![Landscape](assets/landscape.jpg){width="80%"}
```

### Common image classes {#common-image-classes}

Core Gutterpress ships a small, composable `gp-*` vocabulary for placing
images — plain CSS rules in `GUTTERPRESS_CSS`, always present, no plugin or theme
required. `markdown-it-attrs` (also bundled) is what lets you attach
`{.gp-right}` and friends to an image. Pick one **position** word, and
optionally add a **size**, a **spacing**, and a **shape** word — the
classes compose:

```markdown
![Float right, quarter width](assets/small.jpg){.gp-right .gp-small}

![Centered, half width](assets/photo.jpg){.gp-center .gp-medium}

![Float left, roomy text wrap](assets/portrait.jpg){.gp-left .gp-loose}

![Full width](assets/wide.jpg){.gp-full}
```

**Positions** (text wraps around the floats; the image's vertical spot on
the page is simply where it appears in your markdown):

| Class | What it does |
|-------|--------------|
| `.gp-left` | Floats left with clearance margins, capped at 50% width |
| `.gp-right` | Floats right with clearance margins, capped at 50% width |
| `.gp-center` | Centers a block-level image (`display: block; margin: 0 auto`) |
| `.gp-full` | Fills the page's content width (`width: 100%`) |
| `.gp-bleed` | Own page, edge-to-edge — see [Full-bleed artwork](#full-bleed-artwork) |
| `.gp-pin` | Pins to a spot on the page instead of flowing — see [Pinned images](#pinned-images) |

**Sizes** (work with any position, including `.gp-pin`; an explicit size
overrides the floats' 50% cap):

| Class | Width |
|-------|-------|
| `.gp-small` | 25% of the column |
| `.gp-medium` | 50% |
| `.gp-large` | 75% |

**Spacing** (how much room a float leaves for the text wrapping around it —
no class means the normal 1em):

| Class | Clearance |
|-------|-----------|
| `.gp-tight` | 0.5em |
| `.gp-loose` | 2em |

Under the hood the presets set the `--gp-gap` custom property, so a
stylesheet can also tune the clearance directly (`img { --gp-gap: 0.75em }`).

> **Migrating from the old class names?** The pre-vocabulary utilities —
> `.center`, `.float-left`, `.float-right`, `.full-width`, `.full-bleed` —
> were **removed** when the `gp-*` vocabulary shipped. Rename them in your
> markdown (`.center` → `.gp-center`, `.float-left` → `.gp-left`,
> `.float-right` → `.gp-right`, `.full-width` → `.gp-full`, `.full-bleed` →
> `.gp-bleed`); the desktop editor's image menu rewrites the old name for
> you when you edit an image's position. See
> `docs/migrations/2026-08-gp-image-classes.md`.

### Shaped text wrap {#shaped-text-wrap}

`.gp-shape` makes wrapping text follow a floated image's actual visible
silhouette instead of its rectangular box — for cut-out art with a
transparent background (PNG or SVG with an alpha channel):

```markdown
![A creature bursting from the margin](assets/beast.png){.gp-right .gp-shape .gp-loose}
```

The spacing words (`.gp-tight`/`.gp-loose`) set how far the text stays from
the visible silhouette, the same way they set float clearance. Details worth
knowing:

- **Floats only.** `.gp-shape` needs `.gp-left` or `.gp-right`; on anything
  else it does nothing (this is how CSS `shape-outside` works, and it makes
  the class safe to leave on while trying layouts).
- **The image needs real transparency.** A JPEG has no alpha channel, so
  its "shape" is just its rectangle.
- **You only type the class.** Gutterpress mirrors the image's own file into
  the CSS shape automatically, and the build inlines it so the printed PDF
  wraps exactly like the preview.

### Pinned images {#pinned-images}

`.gp-pin` takes an image out of the text flow entirely and pins it to a spot
on the page — centered by default, or against an edge with `.gp-top`,
`.gp-bottom`, `.gp-left`, and `.gp-right` (the same position words the
floats use):

```markdown
@page

# A Title Page

![Watermark, page center](assets/sigil.png){.gp-pin .gp-medium}

![Colophon mark, bottom right](assets/mark.png){.gp-pin .gp-bottom .gp-right .gp-small}
```

One horizontal word + one vertical word gives nine positions; sizes compose
the same way they do in flow.

Two rules keep pinning predictable:

- **A pinned image must live inside an `@page` (or `@spread`) block.** The
  pin is anchored to that container. Outside one there is nothing on the
  page to anchor to — the image would resolve against the whole document
  and can print on a completely different sheet, so the build and preview
  warn (`pin_outside_page`) when you do it.
- **The pin anchors to the `@page` container, not the paper.** For the
  single-page layouts pinning is meant for — title pages, chapter openers,
  watermark pages — those are the same thing. If one `@page` block runs
  long and fragments across several sheets, `.gp-bottom` means the bottom
  of that whole block, not of each sheet.

### Full-bleed artwork {#full-bleed-artwork}

`.gp-bleed` forces the image onto its own page and cancels that page's left/right margins so the image spans the page edge-to-edge horizontally:

```markdown
![Full page art](assets/artwork.jpg){.gp-bleed}
```

`.gp-bleed` produces the edge-to-edge result this way:
- **Forces a page break before the image** (`break-before: page`).
- **It assigns the image's page to a core-owned named page** (`@page gp-full-bleed`) with zero left/right margins, so the page's own content box already is the sheet — no negative margin needed.

It does **not**: cancel the top/bottom margins, remove headers or footers, or add printer bleed overage past the trim edge. The running head and folio move onto the trim line on the bleed page itself (margin boxes are positioned by the page's own margins, which are zero here) — if you need to keep them, suppress the ones that would land on the trim edge with a small override targeting `@page gp-full-bleed` (e.g. `@top-center { content: none }`); see the native engine styling guide. If you need true bleed — content that extends past the trim line for a print shop to cut through — design the artwork to the bled dimensions and add that overage via your PDF export/preflight settings; see [Bleed for full-page images](#bleed-for-full-page-images) below.

### Image galleries

Wrap a gallery in a named section so your own stylesheet can choose its layout
and fragmentation policy. A plain `@section` is structural and may split; this
guide's `.figure` class is the opt-in keep-together treatment:

```markdown
@section .figure
![Image 1](assets/1.jpg){width="30%"}
![Image 2](assets/2.jpg){width="30%"}
![Image 3](assets/3.jpg){width="30%"}
@end-section
```

### Figure with caption

Wrap the image and its caption in `@section .figure` so they stay together on
one page, and tag the caption paragraph with the `.figcaption` class (via
`markdown-it-attrs`, always available — see Chapter 5):

```markdown
@section .figure

![Architecture diagram](assets/diagram.png)

Figure 1: System architecture overview {.figcaption}

@end-section
```

## Print-Safe Images

### Resolution requirements

@section

| Use | Minimum DPI | Recommended |
|-----|------------:|------------:|
| Body illustrations | 300 | 300–600 |
| Line art / diagrams | 600 | 600+ |
| Full-bleed artwork | 300 | 300 |

To calculate pixel dimensions: **print width (inches) × DPI = pixel width**. An 4-inch image at 300 DPI needs 1,200 pixels.

@end-section

### File formats

- **JPEG** — photographs (quality 80–90%)
- **PNG** — graphics with transparency
- **SVG** — logos and diagrams (scales perfectly)

### Color space

Use **RGB** color space. Ghostscript handles CMYK conversion automatically during the PDF/X pipeline — you do not need to pre-convert images to CMYK.

### Pre-sizing images

Pre-size images to their final print dimensions before adding them to the project:

```bash
# Resize to 2400px wide (8-inch image at 300 DPI)
convert input.jpg -resize 2400x output.jpg

# Optimize JPEG quality
convert input.jpg -quality 85 output.jpg
```

### Bleed for full-page images {#bleed-for-full-page-images}

Add 0.125 inches (3.175 mm) to all edges for full-bleed images:

```
Page size: 6in × 9in
Image with bleed: 6.25in × 9.25in

At 300 DPI:
  Width:  6.25 × 300 = 1,875 pixels
  Height: 9.25 × 300 = 2,775 pixels
```

## Common Image Issues

@section

| Problem | Cause | Fix |
|---------|-------|-----|
| Pixelated in print | Resolution below 300 DPI | Re-export at 300 DPI minimum |
| Wrong aspect ratio | No `object-fit` set | Use `object-fit: cover` or `contain` in CSS |
| Splits across pages | No break-inside rule | Apply `break-inside: avoid` or use full-bleed |
| White border on bleed | Image doesn't extend to edge | Add 0.125in bleed on all sides |
| Color shift in print | RGB vs CMYK mismatch | Test the CMYK conversion; adjust RGB values |

@end-section

## Image Best Practices

### Organization

```
assets/
├── images/
│   ├── chapter-01/
│   │   ├── hero.jpg
│   │   └── diagram-1.png
│   └── chapter-02/
│       └── portrait.jpg
├── icons/
│   └── badge.svg
└── diagrams/
    └── flowchart.svg
```

### Print testing checklist

Before final submission:

- [ ] All images are at least 300 DPI
- [ ] Full-bleed images include 0.125in bleed on all sides
- [ ] Images are pre-sized to print dimensions (not scaled in markdown)
- [ ] Grayscale conversion tested if printing black and white
- [ ] No pixelation visible when zoomed to 300% in the preview
- [ ] Alt text provided for all meaningful images
