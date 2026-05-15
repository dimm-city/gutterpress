@chapter #ch-templates .templates ch="2"

# Page Templates

@lede

Named page types control margin geometry, footer chrome, and running headers. Each maps to a `@page` rule in `css/page-rules.css`.

@end-lede

---

## Page Geometry

Dimensions for DC Field Guide print output — declared in `manifest.yaml`, US Letter, perfect-bound.

| Dimension | Value | Notes |
|-----------|-------|-------|
| Trim size | 8.5 × 11 in | US Letter |
| Bleed | 0.125 in | All sides — extend backgrounds to edge |
| Top margin | 0.5 in | Body pages; chapter-start uses 0.75 in |
| Bottom margin | 0.70 in | Footer sits in this space |
| Binding gutter | 0.75 in | Inner margin — swaps left↔right per recto/verso |
| Outside margin | 0.5 in | |

Extend any full-bleed background or image by 0.125 in past each edge so trimming variation doesn't leave a white sliver.

## Named Page Types

The DC print system uses named page types to control margin geometry, footer chrome, and running headers. Each class maps to a `@page` rule in `css/page-rules.css`.

| Class | Key behavior |
|-------|--------------|
| `.page` | Default body. Footer: `p.N` + `c.N` opposing corners |
| `.front-matter` | Footers suppressed — credits, TOC, intro |
| `.chapter-start` | Footer-free chapter opener spread |
| `.chapter-end` | Footer restored: `c.N` left, `p.N` right |
| `.full-page` | Zero margins, no footers — full-bleed art |
| `.citizen-file` | Running header "Citizen File" — NPC records |

Named pages are declared in the markdown source using the `@page` directive:

```markdown
@page .chapter-start
```

Legacy `--- {page ...}` fences remain supported for compatibility, but the design guide treats `@page` as the canonical authoring form.

---

## Book Page Templates

Eleven templates cover every DC Field Guide page type. Use the minimal examples as starting skeletons.

---

### Chapter Cover

Full-page specialty chapter cover. Footers suppressed. One per specialty chapter. **Page class:** `@page .page-chapter-start .chapter-start`.

**Components:** `.dc-cover-bg` (full-bleed tint) · `.dc-cover-num` ("— Ch N / Name —") · `.dc-cover-bigword` (H1 display title) · `.dc-cover-strap` (strap line, ≤15 words) · `.dc-cover-body` (1–2 onboarding sentences) · `.dc-cover-meta-row` (3-column PATHS / ABILITIES / PAGES grid)

```html
@page .page-chapter-start .chapter-start

<div class="dc-cover-page dc-cover-layout">
  <div class="dc-cover-bg"></div>
  <div class="dc-cover-num">— Chapter 01 / Specialty Name —</div>
  <h1 class="dc-cover-bigword">Display<br>Title</h1>
  <p class="dc-cover-strap">One punchy strap line — keep it under fifteen words.</p>
  <div class="dc-cover-body">
    A short onboarding sentence. A second sentence on when to read this chapter.
  </div>
  <div class="dc-cover-meta-row">
    <div>PATHS<b>4</b></div>
    <div>ABILITIES<b>18</b></div>
    <div>PAGES<b>p.001 — p.032</b></div>
  </div>
</div>
```

---

### Chapter Opener

Two-column rules opener for non-specialty chapters. Left: badge + spray banner + fiction. Right: chevron + rules prose + Dream Master callout. Footers suppressed. **Page class:** `@page .page-chapter-start .chapter-start`

**Components:** `@chapter-opener C.N` (badge) · `## Title {.dc-spray}` (banner) · `---{.column-break}` (split) · `# Title {.dc-chevron}` (right-col opener) · `> [!DM]` (callout)

```markdown
@page .page-chapter-start .chapter-start

@chapter-opener C.01

## Chapter Title {.dc-spray}

Fiction paragraphs fill the left column. Keep each under 80 words.
Continue fiction until the column is comfortably full.

---{.column-break}

# How It Works {.dc-chevron}

Rules prose fills the right column.

> [!DM]
> Facilitator guidance goes here.
```

---

### Specialty Opener

Two-page spread: left page has chevron H1 + prose + spec-tweak H3 + class tag chips; right page is full-bleed art. Always footer-free on a visual-left page.

**Page classes:** left: `@page .page-chapter-start .chapter-start` · right: `@page .full-page`

**Components:** `# Name {.dc-chevron}` · `### Spec Tweak {.dc-spec-tweak}` · `<span class="dc-classtag [specialty]">` · `.specialty-art` wrapper

```markdown
@spread .specialty-opener

@page .page-chapter-start .chapter-start

# Specialty Name {.dc-chevron}

3–4 prose paragraphs: who this specialist is, their approach, quick-start picks.
Keep each block under 60 words.

### Spec Tweak: Built for the Job {.dc-spec-tweak}

Spec-tweak body prose — conditions and assumptions the specialty carries into jobs.

<p><span class="dc-classtag augmerc"><span class="dc-classtag-dot"></span>Specialty Name</span></p>

@page .full-page

:::wrapper {.specialty-art}

![Character art](https://placehold.co/1349x842/png?text=Character+Art)

@break
```

**Markdown `:::wrapper` equivalents** — the specialty grid is now page-template-owned, while the card items remain `:::wrapper` blocks:

| Shorthand | Purpose |
|-----------|---------|
| `:::lede` | Intro panel — prose and class tag chips |
| `:::wrapper {.specialty-art}` | Full-bleed art plate (right page) |
| `:::wrapper {.dc-specialty-card .augmerc}` | Individual card — name is a layout hook only, not a palette modifier |

---

### Specialty Listing

2–3 specialty entries per page: portrait, class tag chip, prose description, flavor quote. Separated by tape dividers. **Page class:** normal body page, no break marker needed.

**Components:** `.dc-class-entry` (outer) · `.dc-class-entry-portrait > .dc-portrait` · `.dc-class-entry-name` (H3) · `.dc-class-entry-tags > span.dc-classtag` · plain body paragraphs · `.dc-flavor` · `<div class="dc-tape">— § —</div>` (separator — not `<hr>`)

```html
<div class="dc-class-entry">
  <div class="dc-class-entry-portrait">
    <div class="dc-portrait">
      <img src="images/specialty.png" alt="Specialty Name">
    </div>
  </div>
  <div class="dc-class-entry-body">
    <h3 class="dc-class-entry-name">Specialty Name</h3>
    <div class="dc-class-entry-tags">
      <span class="dc-classtag augmerc"><span class="dc-classtag-dot"></span>Specialty Name</span>
    </div>
    <p>Description paragraph one.</p>
    <p>Description paragraph two — when to choose this specialty.</p>
    <div class="dc-flavor">"Flavor quote."<br><em>— Operator Name, Role, District</em></div>
  </div>
</div>

<div class="dc-tape">— § —</div>
```

---

### Learning Path

Specialty spread with spray banner, sticker chain, signature augment, and `@skill` cards. Use the standard specialty spread layout and let the learning-path and skill-card shells manage their own chrome.

**Components:** `@specialty .<slug>` (parent container) · `@learning-path` (opens block) · `### Path Name` (spray banner) · `> Subtitle` (lede) · bullet list (sticker chain) · `<div class="dc-tape">` (divider) · `@skill id="…"` / `@end-skill` · `<span class="dc-ap">N AP</span>`. Silhouette and accent come from the `@specialty` parent — no `variant=` needed.

```markdown
@specialty .augmerc

@learning-path

### Path Name

> One punchy subtitle line.

- Skill Title One
- Skill Title Two
- Skill Title Three

**Signature Augment Name:** Description of the passive augment — what it enables and where it lives.

<div class="dc-tape">— Signature Augment / Augment Name —</div>

@skill id="skill-unique-id"
**Skill Title**
Flavor line. Operator voice.
Ability body text. When the trigger fires, you may:
**Option Alpha:** Description. <span class="scream">ROLL THE DIE!</span>
Active | <span class="dc-ap">2 AP</span>
@end-skill

@end-specialty
```

---

### Ability Spread

Facing-page spread. Left: spray banner + path subtitle + `@skill` cards. Right: field notes + pull quote + DM callout + tape divider + class tags.

**Components:** `## Title {.dc-spray}` · `<div class="dc-path-subtitle">` · `@skill` / `@end-skill` · `---{.column-break}` · `### Field Notes {.dc-spec-tweak .dc-no-top}` · `> [!PULLQUOTE]` · `> [!DM]` · `<div class="dc-tape">` · `<span class="dc-classtag">`

```markdown
## Skill Title {.dc-spray}

<div class="dc-path-subtitle">— SP1 · Path Name —</div>

@skill id="skill-id"
**Skill Title**
Flavor line.
Ability body and options.
Stance | <span class="dc-ap">0 AP</span>–<span class="dc-ap">2 AP</span>
@end-skill

---{.column-break}

### Field Notes {.dc-spec-tweak .dc-no-top}

Tactical context and table guidance. Two to three short paragraphs.

> [!PULLQUOTE]
> Pull quote — one resonant line.
>
> Attribution

> [!DM]
> Facilitator note.

<div class="dc-tape">— § —</div>

<p><span class="dc-classtag augmerc"><span class="dc-classtag-dot"></span>Specialty Name</span></p>
```

---

### Bestiary Entry

Two-column creature/NPC entry. Left: chevron banner + lede + stat block + encounter notes. Right: aged-paper portrait + tape label + caption + optional stamp. **Page class:** `@page .page .chapter-end`

**Components:** `:::two-column` (two-col split) · `# Title {.dc-chevron}` · `:::lede` (≤20 words) · `.dc-stat` · `.dc-portrait` · `.dc-tape` · `.dc-stamp` (optional)

```markdown
@page .page .chapter-end

@section .two-column

# Creature Name {.dc-chevron}

@lede
One punchy atmospheric line. Under twenty words.
:::

Flavor prose — appearance, behavior, threat type.

<div class="dc-stat">
  <div class="dc-stat-head">
    <div class="dc-stat-name">Creature Name, Variant</div>
    <div class="dc-stat-class">— Threat 2 · Category —</div>
  </div>
  <div class="dc-stat-grid">
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">HP</div><div class="dc-stat-cell-val">18</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">DEF</div><div class="dc-stat-cell-val">12</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">AP</div><div class="dc-stat-cell-val">3</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">DMG</div><div class="dc-stat-cell-val">d20</div></div>
  </div>
  <div class="dc-stat-line"><strong>Signature Attack:</strong> Description.</div>
</div>

**Encounter Notes**

Encounter guidance for the Dream Master.

---{.column-break}

![Creature Name](https://placehold.co/600x800/png?text=Creature){.dc-img-float-right}

<div class="dc-tape dc-margin-sm">— Field Plate —</div>

Caption text.

<span class="dc-stamp mt">GROUP · 2D4+1</span>
```

---

### Table of Contents

Front-matter TOC: chevron banner + lede + structured rows with `target-counter()`-resolved page numbers. Footers suppressed. Each `<a href="#id">` resolves to its page number at layout time. **Page class:** `@page .page .front-matter`

**Components:** `# Contents {.dc-chevron}` · `<div class="dc-intro">` · `<div class="dc-toc">` (container) · `<div class="dc-toc-row">` (one per entry) · `<div class="dc-toc-no">` (zero-padded ch#) · `<div class="dc-toc-title">` (with `<small>` subtitle) · `<div class="dc-toc-page">` (resolved number)

```html
@page .page .front-matter

# Contents {.dc-chevron}

<div class="dc-intro">Orienting sentence about what this book contains.</div>

<div class="dc-toc mt">
  <div class="dc-toc-row">
    <div class="dc-toc-no">01</div>
    <div class="dc-toc-title">Chapter One Title <small>Brief description.</small></div>
    <div class="dc-toc-page"><a href="#ch-one-id">p.007</a></div>
  </div>
  <div class="dc-toc-row">
    <div class="dc-toc-no">02</div>
    <div class="dc-toc-title">Chapter Two Title <small>Brief description.</small></div>
    <div class="dc-toc-page"><a href="#ch-two-id">p.015</a></div>
  </div>
</div>
```

Each `href` must point to an `id` on a heading or `<span id="…">` anchor. Paged.js resolves page numbers automatically.

---

### Procedure Page

Numbered procedure with two-column layout: steps list left, callout + pull quote right. Tape divider introduces closing prose. **Page class:** normal body page, no break marker needed.

**Components:** `# Title {.dc-chevron}` · `:::lede` · `@procedure` (ordered list rendered as `<ol class="dc-steps">`) · `@sidebar` · `> [!PULLQUOTE]` · `<div class="dc-tape">`

```markdown
# Procedure Title {.dc-chevron}

@lede
One orienting sentence — what this procedure produces and roughly how long it takes.
:::

@procedure

1. **Step One.** Description. One outcome only.
2. **Step Two.** Description. Reference step one where relevant.
3. **Step Three.** Description. Name any tables or rolls explicitly.

@end-procedure

@sidebar
### Sidebar

Guidance for common mistakes or variant rules.

@end-sidebar

> [!PULLQUOTE]
> A resonant line capturing the procedure's purpose.
>
> Source attribution

<div class="dc-tape">— Variant rules begin overleaf —</div>

Optional closing prose for variant rules or table preferences.
```

---

### Fiction / Narrative Prose

Full-column narrative for chapter openers, vignettes, dream intros. Prose + floated art + pull quote only — no structural UI. First-line indent applied by print CSS. **Page class:** normal body page, no break marker needed.

**Components:** `### Scene Label {.dc-spec-tweak .dc-no-top}` (optional) · `*italic opener*` · `![alt](https://placehold.co/1349x842/png?text=Scene){.dc-img-float-right}` (or `.dc-img-float-left`) · `> [!PULLQUOTE]`

```markdown
### Scene Label {.dc-spec-tweak .dc-no-top}

*Italic opener — one sentence that sets tone before the prose begins.*

Narrative prose body. Keep paragraphs short and sensory — what the
operator sees, hears, or smells. Each paragraph earns the next.

![Alt text](https://placehold.co/1349x842/png?text=Scene){.dc-img-float-right}

Continued prose with the floated image wrapping left.

> [!PULLQUOTE]
> A resonant line that closes the scene.
>
> Field debrief, post-run
```

---

### Rules Reference

Workhorse template for mechanics chapters. H2 banners, H3 sub-headings, body prose, note callouts, tape dividers, roll tables, option tables. **Page class:** normal body page, no break marker needed.

**Components:** `## ◈ Title {.dc-chevron}` (◈ optional) · `### Sub-Heading` · `**MECHANIC NAME**` · `<span class="scream">ROLL THE DIE!</span>` · `<span class="dc-roll-lucid">ROLL LUCID.</span>` · `<span class="ability-name">Name</span>` · `> [!NOTE]` / `> [!DM]` · `<div class="dc-tape">— § —</div>` · `@outcome` macro

```markdown
## ◈ Rule Category {.dc-chevron}

### Mechanic Term

A **MECHANIC TERM** is a defined element of play with a resolution path.
When an ability says <span class="scream">ROLL THE DIE!</span>, roll d20.

> [!NOTE]
> Inverse condition note — common edge case or clarification.

<div class="dc-tape">— § —</div>

## ◈ Resolution Table {.dc-chevron}
```

```markdown
@outcome

#### 20 | Crit
Automatic success plus additional benefit of the DM's choice.

#### 11–19 | Hit
Success — the action works as intended.

#### 6–10 | Mixed
Partial success — the action works but with a cost or complication.

#### 2–5 | Miss
Failure — the action does not succeed.

#### 1 | Catastrophe
Fail, and something else goes wrong.

@end-outcome
```

---

## Running Headers and Footers

Two counters in opposing bottom corners of every body page: **`p.N`** (page number) and **`c.N`** (chapter counter). Recto: `p.N` bottom-left · `c.N` bottom-right. Verso: swapped. `.chapter-start` and `.front-matter` suppress all footer chrome.

The chapter counter resets via `.page.chapter-NN` on the first `.page-break` div of each chapter:

```css
/* page-rules.css — counter reset per chapter */
.page.chapter-01, .page-break.chapter-01 { counter-reset: chapter 1; }
.page.chapter-02, .page-break.chapter-02 { counter-reset: chapter 2; }
```

---

## See It In Action

These examples show the above page templates rendered with actual Dimm City Field Guide content.

- [Front Matter & TOC](#ch-example-front-matter) — front-matter page class, TOC template, credits page structure
- [Chapter Openers](#ch-example-chapter-opener) — chapter-start page class, chapter opener template in context
- [Specialty Overview](#ch-example-specialty-overview) — specialty listing, choose-specialty catalog page
- [Specialty Profile](#ch-example-specialty-profile) — specialty opener spread (left + full-page art), learning path template, ability spread
- [Rules & Mechanics](#ch-example-rules) — standard body pages, procedure page, rules reference template
- [Dream Master Pages](#ch-example-dm-npcs) — bestiary entry, citizen-file page class, info sidebar template
- [Gear & Tech](#ch-example-gear-tech) — gear and tech pages, rules tables, cybernetics reference
