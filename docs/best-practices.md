# Best Practices

Professional guidelines for creating high-quality print documents with Print-md.

> **For CSS architecture** — variant patterns, component organization, how to express styling intent without scattering classes through markdown — see [The Contextual Cascade Principle](./contextual-cascade-principle.md). It's the recommended pattern for any non-trivial print-md project and the architecture demonstrated in the [design-guide example](../examples/with-design-guide/).

## File Organization

### Recommended Structure

```
my-book/
├── manifest.yaml
├── 00-frontmatter/
│   ├── title.md
│   ├── credits.md
│   └── toc.md
├── 01-introduction.md
├── 02-chapter-one.md
├── 03-chapter-two.md
├── 99-backmatter/
│   ├── appendix.md
│   └── index.md
├── assets/
│   ├── images/
│   │   ├── chapter-01/
│   │   └── chapter-02/
│   ├── fonts/
│   └── diagrams/
└── styles/
    ├── variables.css
    └── custom.css
```

### Naming Conventions

**Files:**
- Number files for explicit ordering: `01-intro.md`, `02-chapter.md`
- Use descriptive names: `character-creation.md` not `cc.md`
- Separate frontmatter/backmatter: Use folders or clear numbering
- Keep consistent: All lowercase with hyphens

**Images:**
- Descriptive names: `character-portrait.jpg` not `img1.jpg`
- Lowercase with hyphens: `forest-scene.jpg`
- Include chapter/section: `ch03-combat-example.png`
- Version if needed: `map-v2.png`

**Directories:**
- Organize by type: `images/`, `fonts/`, `diagrams/`
- Or by chapter: `chapter-01/`, `chapter-02/`
- Use clear names: `assets/` not `a/`

## Writing Guidelines

### Headings

- **H1:** Chapter titles only (one per file)
- **H2-H3:** Main sections
- **H4-H6:** Use sparingly
- Keep concise (under 60 characters)
- Use sentence case, not title case
- Never skip heading levels

### Paragraphs

- One idea per paragraph
- Break up long paragraphs (6-8 sentences max)
- Use blank lines between paragraphs
- Start new paragraph for topic shifts
- Avoid single-sentence paragraphs

### Lists

- Use ordered lists for sequential steps
- Use unordered lists for non-ordered items
- Keep list items concise (1-2 sentences)
- Use nested lists sparingly (2 levels max)
- Maintain parallel structure in items

### Tables

- Keep tables simple (5-7 columns max)
- Use descriptive headers
- Align numbers right, text left
- Include units in headers when applicable
- Consider rotating wide tables to landscape
- Add table captions for complex data

## Print Optimization

### Page Breaks

**Good practices:**
- Let auto-rules handle chapter starts
- Use directives for special cases only
- Test with preview mode before final PDF
- Avoid manual breaks in flowing text

**Bad practices:**
- Don't force breaks unnecessarily
- Don't use `<br>` tags for spacing
- Don't rely on specific pagination
- Don't break tables awkwardly

### Images

**Resolution:**
- 300 DPI minimum for all images
- 600 DPI for line art and diagrams
- Pre-size images to print dimensions
- Don't rely on scaling in markdown

**Format:**
- JPEG for photographs (quality 80-90)
- PNG for graphics with transparency
- SVG for logos and diagrams
- Add 0.125in bleed for full-page images

**Optimization:**
- Compress before adding to project
- Remove EXIF data from photos
- Use appropriate color space (RGB)
- Test grayscale conversion for B&W printing

### Typography

**Font choices:**
- Serif fonts for body text (better readability)
- Sans-serif for headings (optional)
- Limit to 2-3 font families max
- Ensure fonts embed in PDF

**Spacing:**
- Don't override widow/orphan control
- Maintain consistent line height (1.4-1.6)
- Use proper spacing (avoid manual line breaks)
- Let CSS handle vertical rhythm

**Sizes:**
- 10-12pt for body text (depends on page size)
- 18-24pt for chapter titles
- 12-14pt for section headings
- Test readability at final print size

### Color

**Color choices:**
- Test in grayscale mode
- Ensure 4.5:1 contrast minimum (WCAG AA)
- Avoid pure black (#000) - use dark gray
- Avoid pure white (#fff) - use off-white

**Print considerations:**
- Test CMYK conversion if offset printing
- Consider ink costs for full-color
- Use spot colors sparingly
- Provide both color and B&W versions

## Performance Tips

### Build Speed

- Keep images reasonably sized (< 2MB each)
- Use CSS imports for modularity
- Enable watch mode for development
- Use preview mode for rapid iteration
- Cache unchanged assets

### PDF Size

- Compress images before adding
- Embed only used font subsets
- Remove unused CSS rules
- Optimize for web if distributing digitally
- Target < 10MB for typical books

### Development Workflow

```bash
# Fast iteration during writing (watches by default)
print-md preview ./my-book

# Build for review
print-md build ./my-book --format html --out ./_review

# Final production build
print-md build ./my-book --out final.pdf
```

## Testing Checklist

### Before Final Print

**Document structure:**
- [ ] Preview entire document in browser
- [ ] Check all page breaks and spreads
- [ ] Verify frontmatter/backmatter order
- [ ] Review table of contents (if auto-generated)
- [ ] Check page numbers are correct

**Content:**
- [ ] Proofread all text
- [ ] Verify all internal links work
- [ ] Check all images appear correctly
- [ ] Review callouts don't break awkwardly
- [ ] Test code examples format properly

**Typography:**
- [ ] Check running headers on all pages
- [ ] Review first/last lines of pages (widows/orphans)
- [ ] Verify heading hierarchy is correct
- [ ] Check font embedding in PDF
- [ ] Test font sizes are readable

**Images:**
- [ ] All images are 300 DPI minimum
- [ ] Full-bleed images include bleed
- [ ] No pixelation or artifacts
- [ ] Color accuracy verified
- [ ] Grayscale conversion tested

**Print production:**
- [ ] Verify bleed on full-page images
- [ ] Check trim marks (if enabled)
- [ ] Test CMYK conversion (if offset)
- [ ] Print test pages on target paper
- [ ] Review binding margins

**Technical:**
- [ ] File size is reasonable (< 50MB)
- [ ] PDF/X compliance (if required)
- [ ] All fonts embedded
- [ ] Color profile correct
- [ ] Metadata complete

## Common Issues & Solutions

### Pixelated Images

**Problem:** Image looks blurry or pixelated in print

**Solutions:**
- Increase image resolution to 300 DPI minimum
- Pre-size images to print dimensions
- Use higher quality source images
- Check image compression settings

### Page Break Issues

**Problem:** Content breaks awkwardly across pages

**Solutions:**
- Add `break-inside: avoid` to keep elements together
- Use `@page-break` before sections that should start on a new page
- Adjust margins to fit content
- Rewrite/reorganize content slightly

### Font Issues

**Problem:** Build fails with a "Missing font file" error

A `@font-face` `url()` that doesn't resolve is now a build error naming the
missing file — put the font anywhere in your project and point to it with a
path relative to the CSS file that loads it.

**Solutions:**
- Double-check the path in `url(...)` — it's relative to the **stylesheet**,
  not the manifest or project root
- Confirm the font file is actually inside your project folder
- Verify fonts are licensed for embedding
- Check font file formats (WOFF2, WOFF, TTF, OTF)

### Color Shift

**Problem:** Colors look different in print vs screen

**Solutions:**
- Test CMYK conversion
- Calibrate monitor
- Request color proof from printer
- Use printer's recommended color profiles

### Large File Size

**Problem:** PDF is too large (> 50MB)

**Solutions:**
- Compress images before adding
- Reduce image dimensions
- Lower JPEG quality (80-85)
- Remove unused fonts
- Subset fonts to only used characters

### Blank Pages

**Problem:** Unwanted blank pages appear

**Solutions:**
- Check for extra `@page-break` directives
- Review H1 auto-rules (force right page)
- Verify `@spread` directives
- Check for empty markdown files

## Production Workflow

### 1. Planning

- Define book structure and sections
- Choose page format and margins
- Select theme or design system
- Plan image requirements

### 2. Writing

- Create manifest.yaml
- Write content in markdown
- Use preview mode for feedback
- Iterate on structure

### 3. Design

- Customize theme/styles
- Add images and artwork
- Fine-tune typography
- Test page breaks

### 4. Review

- Run through testing checklist
- Get feedback from others
- Print test pages
- Make revisions

### 5. Production

- Build final PDF
- Verify all requirements met
- Prepare print-ready files
- Archive source files

## Version Control

Use Git for version control. `print-md new` already scaffolds a `.gitignore`
containing `dist/` (every build's output — HTML, PDF, and PDF/X artifacts all
land under `dist/<title-slug>/`), so a project it created needs no manual
`.gitignore` setup. For a project started another way:

```bash
# Initialize repository
git init

# .gitignore
echo "dist/" >> .gitignore
echo "node_modules/" >> .gitignore

# Commit source files
git add .
git commit -m "Initial commit"
```

Track:
- Markdown source files
- manifest.yaml
- Custom CSS
- Images (if reasonable size)
- Font files (if licensed)

Don't track:
- Generated PDFs
- Build artifacts
- Temporary files
- Large binary assets (use Git LFS)

## Backup Strategy

**Source files:**
- Keep in version control (Git)
- Back up to cloud storage
- Maintain local backups

**Build outputs:**
- Archive final PDFs
- Keep print-ready files
- Store printer proofs

**Assets:**
- Original high-res images
- Source files (PSD, AI, etc.)
- Font files

## Collaboration

### Multiple Authors

```
project/
├── manifest.yaml        # Shared config
├── 01-intro.md         # Author A
├── 02-chapter-1.md     # Author B
├── 03-chapter-2.md     # Author A
└── styles/
    └── shared.css      # Shared styles
```

**Best practices:**
- One chapter per file
- Use consistent formatting
- Regular Git commits
- Pull before starting work
- Review each other's content

### Review Process

1. Author writes chapter
2. Commit to feature branch
3. Build preview PDF
4. Share with reviewers
5. Incorporate feedback
6. Merge to main branch

## Accessibility

Make your documents accessible:

- Include alt text for all images
- Use proper heading hierarchy
- Ensure color contrast meets WCAG AA
- Provide text alternatives for graphics
- Use semantic HTML when needed
- Test with screen readers (PDF)

## Legal Considerations

- Verify font licenses allow embedding
- Check image licenses and attribution
- Include copyright notice
- Add ISBN if publishing
- Review content licenses (CC, etc.)
- Consult lawyer for legal text

## Resources

- **Prince XML Docs:** https://www.princexml.com/doc/
- **Vivliostyle Docs:** https://docs.vivliostyle.org/
- **Markdown Guide:** https://www.markdownguide.org/
- **Print Design:** Research book design principles
- **CSS Paged Media:** https://www.w3.org/TR/css-page-3/
- **Color Contrast:** https://webaim.org/resources/contrastchecker/
