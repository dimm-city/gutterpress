# Visual Elements {#ch-visual}

<div class="lede">Callouts highlight critical information. Images bring pages to life. This chapter covers both — from basic syntax to full-bleed artwork and print-safe image requirements.</div>

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

### Image sizing

Use `markdown-it-attrs` for precise sizing:

```markdown
![Portrait](assets/portrait.jpg){width="300px"}

![Landscape](assets/landscape.jpg){width="80%"}
```

Or use the `img-size` plugin shorthand:

```markdown
![Portrait](assets/portrait.jpg =300x400)
![Landscape](assets/landscape.jpg =800x)
![Square](assets/square.jpg =x600)
```

### Common image classes

```markdown
![Centered](assets/photo.jpg){.center}

![Float left](assets/small.jpg){.float-left}

![Float right](assets/portrait.jpg){.float-right}

![Full width](assets/wide.jpg){.full-width}
```

### Full-bleed artwork

Full-bleed images fill an entire page with no margins:

```markdown
![Full page art](assets/artwork.jpg){.full-bleed}
```

Full-bleed images automatically:
- Apply the `art` page template (zero margins)
- Force a page break before the image
- Extend to the bleed edge (removing headers and footers)

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

```markdown
<figure>
  <img src="assets/diagram.png" alt="Architecture diagram">
  <figcaption>Figure 1: System architecture overview</figcaption>
</figure>
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

### Bleed for full-page images

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
