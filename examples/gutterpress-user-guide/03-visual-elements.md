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

Core Gutterpress ships five ready-to-use image/block utility classes — they're plain CSS rules in `PAGED_CSS`, always present, no plugin or theme required. `markdown-it-attrs` (also bundled) is what lets you attach `{.center}` and friends to an image:

```markdown
![Centered](assets/photo.jpg){.center}

![Float left](assets/small.jpg){.float-left}

![Float right](assets/portrait.jpg){.float-right}

![Full width](assets/wide.jpg){.full-width}
```

| Class | What it does |
|-------|--------------|
| `.center` | Centers a block-level image (`display: block; margin: 0 auto`) |
| `.float-left` | Floats left with clearance margins, capped at 50% width |
| `.float-right` | Floats right with clearance margins, capped at 50% width |
| `.full-width` | Fills the page's content width (`width: 100%`) |

### Full-bleed artwork {#full-bleed-artwork}

`.full-bleed` forces the image onto its own page and cancels that page's left/right margins so the image spans the page edge-to-edge horizontally:

```markdown
![Full page art](assets/artwork.jpg){.full-bleed}
```

`.full-bleed` genuinely does two things:
- **Forces a page break before the image** (`break-before: page`).
- **Cancels the page's left/right margins** by reading Paged.js's own `--pagedjs-margin-left` / `--pagedjs-margin-right` custom properties (set per page from whatever `@page` rule is active) and applying the matching negative margin, so the image reaches the page's left and right trim edges.

It does **not**: cancel the top/bottom margins, apply a named `art`/`gallery`/etc. `@page` template, remove headers or footers, or add printer bleed overage past the trim edge. If you need true bleed — content that extends past the trim line for a print shop to cut through — design the artwork to the bled dimensions and add that overage via your PDF export/preflight settings; see [Bleed for full-page images](#bleed-for-full-page-images) below.

### Image galleries

Keep a group of images together on one page using `@section`:

```markdown
@section
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
