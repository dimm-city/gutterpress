# Images & Artwork

Guide to using images effectively in print documents.

## Basic Images

```markdown
![Alt text](assets/image.jpg)

![Image with caption](assets/diagram.png "This caption appears in the print")
```

## Image Sizing

Use the `img-size` plugin syntax for precise control:

```markdown
![Portrait](assets/portrait.jpg =300x400)

![Landscape](assets/landscape.jpg =800x)

![Square](assets/square.jpg =x600)
```

### Size Syntax

- `=WIDTHxHEIGHT` - Set both dimensions
- `=WIDTHx` - Set width, auto-calculate height
- `=xHEIGHT` - Set height, auto-calculate width
- Dimensions in pixels

## Image Attributes

Use `markdown-it-attrs` syntax for advanced styling:

```markdown
![Centered image](assets/photo.jpg){.center}

![Floated left](assets/small.jpg){.float-left}

![Full width](assets/wide.jpg){.full-width}
```

### Common Attributes

```markdown
{.center}           - Center align image
{.float-left}       - Float left with text wrap
{.float-right}      - Float right with text wrap
{.full-width}       - Expand to page width
{.rounded}          - Rounded corners
{width="50%"}       - Set width as percentage
```

## Full-Bleed Artwork

For images that fill an entire page:

```markdown
![Full bleed art](assets/artwork.jpg){.full-bleed}
```

### Auto-rules for Full-Bleed

Images with `.full-bleed` class automatically:
- Get the `art` page template (zero margins)
- Force a page break before the image
- Extend to the bleed edge
- Remove headers and footers
- Cover the entire page

## Image Positioning

### Floated Images

```markdown
<!-- Float image beside text -->
![](assets/portrait.jpg){.float-right width="200px"}

Lorem ipsum text flows around the floated image on the left side.
This is perfect for character portraits or small illustrations
that accompany text.

<!-- Clear floats -->
<div style="clear: both;"></div>
```

### Centered Images

```markdown
![](assets/diagram.jpg){.center width="80%"}
```

### Positioned Images

```markdown
![](assets/badge.png){.top-right width="100px"}

![](assets/footer.png){.bottom-center width="50%"}
```

## Print-Safe Images

### Resolution Requirements

- **Minimum:** 300 DPI for print quality
- **Recommended:** 300-600 DPI
- **Calculate size:** (print width in inches) × 300 = pixel width
  - Example: 4 inch wide image = 1200 pixels

### File Formats

- **JPEG** - Best for photographs
- **PNG** - Best for graphics with transparency
- **SVG** - Vector graphics (scale perfectly)

### Color Space

- **Use:** RGB color space
- **Why:** Ghostscript handles CMYK conversion via the PDF/X pipeline
- **Test:** Preview in grayscale if printing B&W

### File Size Optimization

Pre-size images to final dimensions:

```bash
# Resize to 2400px wide at 300 DPI (8 inch width)
convert input.jpg -resize 2400x output.jpg

# Optimize JPEG quality
convert input.jpg -quality 85 output.jpg
```

## Bleed for Full-Page Images

For full-bleed images, add 0.125in (3.175mm) to all edges:

```
Page size: 6in × 9in
Image size: 6.25in × 9.25in (adds 0.125in bleed on all sides)

At 300 DPI:
- Width: 6.25 × 300 = 1875 pixels
- Height: 9.25 × 300 = 2775 pixels
```

## Advanced Image Techniques

### Image Galleries

```markdown
::: container {.image-gallery}

![Image 1](assets/1.jpg){width="30%"}
![Image 2](assets/2.jpg){width="30%"}
![Image 3](assets/3.jpg){width="30%"}

:::
```

Or using the `@section` marker to keep the gallery together on one page:

```markdown
@section
![Image 1](assets/1.jpg){width="30%"}
![Image 2](assets/2.jpg){width="30%"}
![Image 3](assets/3.jpg){width="30%"}
```

### Figure with Caption

```markdown
<figure>
  <img src="assets/diagram.png" alt="Architecture diagram">
  <figcaption>Figure 1: System architecture overview</figcaption>
</figure>
```

### Background Images

```markdown
<div style="background-image: url(assets/texture.jpg); padding: 2em;">

Content with background image.

</div>
```

## Image Best Practices

### Accessibility

- Always include meaningful alt text
- Describe what the image shows, not just "image"
- For decorative images, use empty alt: `![](image.jpg)`
- Include figure captions for complex diagrams

### Organization

```
assets/
├── images/
│   ├── chapter-01/
│   │   ├── hero.jpg
│   │   └── diagram-1.png
│   ├── chapter-02/
│   │   └── portrait.jpg
│   └── cover.jpg
├── icons/
│   └── badge.svg
└── diagrams/
    └── flowchart.svg
```

### File Naming

- Use descriptive names: `character-portrait.jpg` not `img1.jpg`
- Use lowercase with hyphens: `forest-scene.jpg`
- Include chapter or section: `ch03-combat-example.png`
- Version if needed: `map-v2.png`

### Performance

- Optimize images before adding (use tools like ImageOptim)
- Remove EXIF data from photos
- Use appropriate quality settings (JPEG: 80-90)
- Don't use unnecessarily large images
- Consider progressive JPEG for web preview

## Print Testing

Before final print:

- [ ] All images are at least 300 DPI
- [ ] Full-bleed images include proper bleed
- [ ] Images are properly sized for print dimensions
- [ ] No pixelation or artifacts visible
- [ ] Color accuracy tested (if color printing)
- [ ] Grayscale conversion tested (if B&W printing)
- [ ] Alt text provided for all images
- [ ] File sizes optimized
- [ ] Images embedded in PDF correctly

## Common Issues

### Pixelated Images

**Problem:** Image looks blurry or pixelated in print
**Solution:** Increase image resolution to 300 DPI minimum

### Wrong Aspect Ratio

**Problem:** Image appears stretched or squished
**Solution:** Use `object-fit: cover` or `contain` in CSS

### Color Shift

**Problem:** Colors look different in print vs screen
**Solution:** Test CMYK conversion, adjust RGB values if needed

### Page Break Through Image

**Problem:** Image splits across two pages
**Solution:** Apply `break-inside: avoid` class or use full-bleed

### White Borders on Bleed

**Problem:** White edges appear on full-bleed images
**Solution:** Ensure image extends 0.125in beyond page edge
