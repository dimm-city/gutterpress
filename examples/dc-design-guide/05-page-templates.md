@chapter #ch-templates .templates

# Page Templates

<div class="dc-intro">Named page types control margin geometry, footer chrome, and running headers. Each maps to a `@page` rule in `css/page-rules.css`.</div>

---

## Page Geometry

Physical dimensions for the DC Field Guide print output. These values are declared in `manifest.yaml` and reflect the US Letter format with binding gutter for a perfect-bound book.

| Dimension | Value | Notes |
|-----------|-------|-------|
| Trim size | 8.5 × 11 in | US Letter |
| Bleed | 0.125 in | All sides — extend backgrounds to edge |
| Top margin | 0.5 in | Body pages; chapter-start uses 0.75 in |
| Bottom margin | 0.70 in | Footer sits in this space |
| Binding gutter | 0.75 in | Inner margin — swaps left↔right per recto/verso |
| Outside margin | 0.5 in | |

**Bleed** is the extra area beyond the trim edge that backgrounds and full-page images must extend into, so trimming variation doesn't leave a white sliver. Extend any full-bleed background color or image by 0.125 in past each edge using negative margins or a padding offset on the container.

---

## Named Page Types

The DC print system uses named page types to control margin geometry, footer chrome, and running headers. Each class maps to a `@page` rule in `css/page-rules.css`.

| Class | Key behavior |
|-------|--------------|
| `.page` | Default body. Footer: `p.N` + `c.N` opposing corners |
| `.front-matter` | Footers suppressed — credits, TOC, intro |
| `.chapter-start` | Footer-free chapter opener spread |
| `.chapter-end` | Footer restored: `c.N` left, `p.N` right |
| `.full-page` | Zero margins, no footers — full-bleed art |
| `.aug` | Reduced margins 0.1 in — specialty spreads |
| `.citizen-file` | Running header "Citizen File" — NPC records |
| `.colophon` | End-of-book, all chrome suppressed |

Named pages are declared in the markdown source using either the legacy page marker or the `@page` directive from markdown-it-paged.

**Legacy page marker** (raw HTML fence):

```markdown
--- {page .page .chapter-start}
```

**`@page` directive** (markdown-it-paged):

```markdown
@page chapter-start
```

---

## Chapter Opener

The `.chapter-start` page is the canonical DC chapter opener. It carries the full-width chevron banner, a suppressed footer, and 0.75 in top margin. The chevron is set by applying `.dc-chevron` to the H1.

```markdown
--- {page .page .chapter-start}

# Augmerc {.dc-chevron}

<div class="dc-intro flush">Muscle for hire. The difference is gear, grafts, and how much of them is still original.</div>
```

The `.dc-intro.flush` class removes the top margin from the lede paragraph so it sits tight against the chevron banner. Every chapter in the Field Guide opens with this pattern.

---

## Specialty Opener Spread

The `.aug` page type is used for specialty spreads: the left page carries the intro prose (flavor text, overview, and the learning-path header) while the right page holds the first column of skill cards.

`.aug` applies reduced inner and outer margins (0.1 in) to gain column width for the dense card layout. The footer is suppressed on the left page and restored on card pages that follow.

```markdown
--- {page .page .aug}

<div class="dc-intro">Core augmentation tree for the Augmerc specialty.</div>

@learning-path specialty="augmerc" index="1"

@skill variant="1" id="punishing-counter"
...
@end-skill

@end-learning-path
```

---

## Full-Bleed Art Page

The `.full-page` class removes all margins and footer chrome, leaving the entire page surface for splash art, maps, or decorative interstitials. Images inside `.full-page` are sized with `object-fit: cover` to fill the trimmed area.

```markdown
--- {page .full-page}

![Splash art — city aerial](img/city-aerial.png)
```

Use `@page full-page` to switch to this template via the markdown-it-paged directive. Keep all critical linework and text at least 0.125 in inside the trim line to account for bleed trimming variation.

---

## Running Headers and Footers

The DC footer model places two counters in opposing bottom corners of every body page:

- **`p.N`** — page number, rendered by `counter(page)` in the `@page :right @bottom-right` and `@page :left @bottom-left` margin boxes.
- **`c.N`** — chapter counter, rendered by `counter(chapter)` in the opposing corner.

On recto (right) pages the layout is `p.N` bottom-left · `c.N` bottom-right. On verso (left) pages these swap: `c.N` bottom-left · `p.N` bottom-right.

The chapter counter is incremented by the `.page.chapter-NN` class applied to the first `.page-break` div of each chapter. This guarantees the running footer reads the correct chapter number on every page, including the chapter-start page itself.

```css
/* page-rules.css — counter reset per chapter */
.page.chapter-01, .page-break.chapter-01 { counter-reset: chapter 1; }
.page.chapter-02, .page-break.chapter-02 { counter-reset: chapter 2; }
```

`.chapter-start` pages suppress both footer counters entirely. `.front-matter` and `.colophon` pages also suppress all footer chrome.
