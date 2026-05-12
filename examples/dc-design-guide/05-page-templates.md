@chapter #ch-templates .templates .chapter-02 ch="2"

# Page Templates

::: wrapper {.dc-intro}
Named page types control margin geometry, footer chrome, and running headers. Each maps to a `@page` rule in `css/page-rules.css`.
:::

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
| `.page-ability-catalog .choose-specialty` | 2-column auto-fill layout for the specialty overview/selection page |
| `.page-info-sidebar` | 2-column balanced layout shell for info sidebar pages |
| `.colophon` | End-of-book, all chrome suppressed |

Named pages are declared in the markdown source using the `@page` directive:

```markdown
@page chapter-start
```

The longer form `--- {page .page .chapter-start}` (raw HTML fence) also works and is equivalent.

---

## Book Page Templates

The eleven templates below cover every page type in the DC Field Guide. Each template is a named pattern combining a page class, key CSS classes, and a content structure. Use the minimal examples as starting skeletons.

---

### Chapter Cover

Full-page specialty chapter cover with display title, strap line, body copy, and a meta-row stat strip. Footers are suppressed. Use at the start of every specialty chapter — one per specialty.

**Components:**
- `.dc-cover-bg` — full-bleed page tint
- `.dc-cover-num` — "— Chapter N / Name —" label
- `.dc-cover-bigword` — large display title (H1)
- `.dc-cover-strap` — punchy strap line (under 15 words)
- `.dc-cover-body` — 1–2 sentences of onboarding prose
- `.dc-cover-meta-row` — 3-column grid of PATHS / ABILITIES / PAGES counts

**Page class:** `--- {page .page-chapter-start .chapter-start}`

```html
--- {page .page-chapter-start .chapter-start}

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

Raw HTML only — no markdown shorthand for the cover layout.

---

### Chapter Opener

Two-column rules chapter opener for non-specialty chapters. Left column: chapter badge + spray banner + fiction paragraphs. Right column: chevron section banner + rules prose + DM callout. Footers suppressed.

**Components:**
- `@chapter-opener C.N` — emits the `.dc-chapter-opener-no` badge
- `## Title {.dc-spray}` — spray banner heading
- `---{.column-break}` — splits left/right columns
- `# Title {.dc-chevron}` — right-column rules section opener
- `!!! Label` — note callout admonition

**Page class:** `--- {page .page-chapter-start .chapter-start}`

```markdown
--- {page .page-chapter-start .chapter-start}

@chapter-opener C.01

## Chapter Title {.dc-spray}

Fiction paragraphs fill the left column. Keep each under 80 words.
Continue fiction until the column is comfortably full.

---{.column-break}

# How It Works {.dc-chevron}

Rules prose fills the right column.

!!! Dream Master
Facilitator guidance goes here. Indented lines are the callout body.
```

---

### Specialty Opener

Two-page spread opening a specialty section. Left page: chevron H1, prose overview, spec-tweak H3, class tag chips. Right page: full-bleed character art plate. Always lands footer-free on a visual-left page.

**Components:**
- `# Specialty Name {.dc-chevron}` — banner heading
- `### Spec Tweak: Name {.dc-spec-tweak}` — inset spec-tweak header
- `<span class="dc-classtag [specialty]">` — class tag chip
- `--- {page .full-page}` — zero-margin art page
- `.specialty-art` wrapper — contains the portrait image

**Page classes:** left: `--- {page .page-chapter-start .chapter-start}` · right: `--- {page .full-page}`

```markdown
--- {page .page-chapter-start .chapter-start}

# Specialty Name {.dc-chevron}

3–4 prose paragraphs: who this specialist is, their approach, quick-start picks.
Keep each block under 60 words.

### Spec Tweak: Built for the Job {.dc-spec-tweak}

Spec-tweak body prose — conditions and assumptions the specialty carries into jobs.

<p><span class="dc-classtag augmerc"><span class="dc-classtag-dot"></span>Specialty Name</span></p>

--- {page .full-page}

<div class="specialty-art">

![Character art](img/specialty-plate.png)

</div>
```

**Markdown equivalents for specialty wrapper elements:**

The raw HTML `<div>` wrappers shown above can be written using `::: wrapper` syntax in markdown-it-paged source. The following forms are interchangeable with their HTML equivalents:

| Markdown shorthand | HTML equivalent | Purpose |
|--------------------|----------------|---------|
| `::: wrapper {.specialty-intro}` | `<div class="specialty-intro">` | Intro panel — prose and class tag chips |
| `::: wrapper {.specialty-art}` | `<div class="specialty-art">` | Full-bleed art plate (right page) |
| `::: wrapper {.specialty-spread}` | `<div class="specialty-spread">` | Specialty-card grid container |
| `::: wrapper {class="specialty-card augmerc"}` | `<div class="specialty-card augmerc">` | Individual specialty card |

The specialty name on `.specialty-card` (e.g. `augmerc`) is a layout hook that identifies the card in the grid — it is not a palette modifier and does not apply color variables.

---

### Specialty Listing

"Choose your specialty" overview page. Two to three specialty entries each with a portrait image, class tag chip, prose description, and flavor quote. Entries are separated by tape dividers. Flows as a normal body page — no break marker required.

**Components:**
- `.dc-class-entry` — outer entry wrapper
- `.dc-class-entry-portrait` > `.dc-portrait` — framed portrait
- `.dc-class-entry-name` — H3 specialty name
- `.dc-class-entry-tags` > `<span class="dc-classtag [specialty]">` — tag chip
- `.dc-prose` — description paragraphs
- `.dc-flavor` — flavor quote with `<em>` attribution
- `<div class="dc-tape">— § —</div>` — entry separator (not `<hr>`)

**Page class:** normal body page, no break marker needed.

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
    <p class="dc-prose">Description paragraph one.</p>
    <p class="dc-prose">Description paragraph two — when to choose this specialty.</p>
    <div class="dc-flavor">"Flavor quote."<br><em>— Operator Name, Role, District</em></div>
  </div>
</div>

<div class="dc-tape">— § —</div>
```

---

### Choose Specialty Page

"Choose your specialty" catalog page using a 2-column auto-fill layout. Each `.specialty-card` stays together (no mid-card breaks), and the `.specialty-spread` container spans all columns so the grid can breathe across the full text area. Use this immediately before the individual specialty opener spreads.

**Components:**
- `.page-ability-catalog` — named page class for the catalog layout
- `.choose-specialty` — activates 2-column `column-fill: auto` on the page
- `## Intro Heading` — plain H2 introduces the selection prompt
- `::: wrapper {.specialty-spread}` — grid container that spans all columns
- `::: wrapper {class="specialty-card [name]"}` — one card per specialty; `break-inside: avoid` keeps each intact

**Page class:** `--- {page .page-ability-catalog .choose-specialty}`

```markdown
--- {page .page-ability-catalog .choose-specialty}

## Choose Your Specialty

Opening sentence orienting the player — what a specialty is and how to pick one.

::: wrapper {.specialty-spread}

::: wrapper {class="specialty-card augmerc"}

### Augmerc

Brief specialty description — two sentences maximum.

:::

::: wrapper {class="specialty-card secondspec"}

### Second Specialty

Brief specialty description — two sentences maximum.

:::

:::
```

The specialty name on the `.specialty-card` wrapper is a layout hook only — it does not apply a color palette or CSS variable override. Cards are sized by the column grid, not by individual card CSS.

---

### Info Sidebar Page

Two-column balanced body page with a floating character-file sidebar. `.page-info-sidebar` provides the layout shell (balanced columns, sidebar float region). `.citizen-file` adds the character-file content skin: at-a-glance stat cards, framed portrait, and field-notes sidebar. The two classes are always paired.

**Components:**
- `.page-info-sidebar` — layout shell: 2-column balanced text, sidebar float
- `.citizen-file` — content skin: at-a-glance cards, sidebar float styling, running header "Citizen File"
- `# Name {.dc-chevron}` — subject name banner
- `<div class="dc-intro">` — atmospheric lede
- `.citizen-at-a-glance` — stat card row (HP, DEF, AP, threat tier)
- `.citizen-sidebar` — right-column float with portrait + tape label
- Body prose fills the left column below the stat cards

**Page class:** `--- {page .page-info-sidebar .citizen-file}`

Note: `.page-info-sidebar` is the layout shell; `.citizen-file` is the field-guide content skin. Use both together — neither works fully without the other.

```markdown
--- {page .page-info-sidebar .citizen-file}

# Subject Name {.dc-chevron}

<div class="dc-intro">One atmospheric lede — role, threat posture, district affiliation. Under twenty words.</div>

<div class="citizen-at-a-glance">
  <div class="citizen-stat"><div class="citizen-stat-key">HP</div><div class="citizen-stat-val">22</div></div>
  <div class="citizen-stat"><div class="citizen-stat-key">DEF</div><div class="citizen-stat-val">14</div></div>
  <div class="citizen-stat"><div class="citizen-stat-key">AP</div><div class="citizen-stat-val">3</div></div>
  <div class="citizen-stat"><div class="citizen-stat-key">TIER</div><div class="citizen-stat-val">2</div></div>
</div>

<div class="citizen-sidebar">
  <div class="dc-portrait">
    <img src="img/subject.png" alt="Subject Name">
  </div>
  <div class="dc-tape margin-sm">— Field Record —</div>
</div>

Body prose fills the left column. Two to four paragraphs covering background, methods, and encounter role.
```

---

### Learning Path

A complete learning path block for specialty spreads: spray banner with sticker code badge, intro lede, sticker chain of skill names, signature augment description, and a sequence of `@skill` cards. Reduced margins via `.aug` gain column width for dense card layout.

**Components:**
- `@learning-path specialty="…" index="N"` — opens path block (no closing marker)
- `### Path Name` — becomes the `.dc-spray` banner
- `> Subtitle lede` — blockquote becomes `.dc-intro`
- Bullet list — becomes `.dc-stickers` skill chain
- `<div class="dc-tape">` — tape divider before signature augment detail
- `@skill variant="N" id="…"` / `@end-skill` — individual skill cards
- `<span class="dc-ap">N AP</span>` — AP cost chip (use `.free` or `.var` variants)

**Page class:** `--- {page .page-aug .aug}`

```markdown
--- {page .page-aug .aug}

@learning-path specialty="augmerc" index="1"

### Path Name

> One punchy subtitle line.

- Skill Title One
- Skill Title Two
- Skill Title Three

**Signature Augment Name:** Description of the passive augment — what it enables and where it lives.

<div class="dc-tape">— Signature Augment / Augment Name —</div>

@skill variant="1" id="skill-unique-id"
**Skill Title**
Flavor line. Operator voice.
Ability body text. When the trigger fires, you may:
**Option Alpha:** Description. <span class="scream">ROLL THE DIE!</span>
Active | <span class="dc-ap">2 AP</span>
@end-skill
```

---

### Ability Spread

A facing-page ability spread. Left column: spray banner + path subtitle + skill card(s). Right column: field notes, pull quote, DM callout, tape divider, class tags. Uses `.aug` named page for reduced margins.

**Components:**
- `## Skill Title {.dc-spray}` — left-column spray banner
- `<div class="dc-path-subtitle">` — path code and name line
- `@skill` / `@end-skill` — one or more skill cards
- `---{.column-break}` — splits left/right columns
- `### Field Notes {.dc-spec-tweak .no-top}` — right-column header (`.no-top` removes top spacing)
- `> pull quote` — blockquote pull quote
- `!!! Dream Master` — facilitator callout
- `<div class="dc-tape">` — section divider
- `<span class="dc-classtag">` chips — specialty tags

**Page class:** `--- {page .page-aug .aug}`

```markdown
--- {page .page-aug .aug}

## Skill Title {.dc-spray}

<div class="dc-path-subtitle">— SP1 · Path Name —</div>

@skill variant="1" id="skill-id"
**Skill Title**
Flavor line.
Ability body and options.
Stance | <span class="dc-ap">0 AP</span>–<span class="dc-ap">2 AP</span>
@end-skill

---{.column-break}

### Field Notes {.dc-spec-tweak .no-top}

Tactical context and table guidance. Two to three short paragraphs.

> Pull quote — one resonant line.
> — Attribution

!!! Dream Master
Facilitator note.

<div class="dc-tape">— § —</div>

<p><span class="dc-classtag augmerc"><span class="dc-classtag-dot"></span>Specialty Name</span></p>
```

---

### Bestiary Entry

Two-column creature or NPC entry. Left column: chevron banner, intro lede, stat block, encounter notes. Right column: portrait in aged-paper frame, tape label, caption, optional stamp. Footers restored via `.chapter-end`.

**Components:**
- Inline flex `<div style="display:flex;gap:24px;align-items:start;">` — outer two-column split (no named class)
- `<h1 class="dc-chevron">` — creature name banner
- `<div class="dc-intro">` — atmospheric lede (under 20 words)
- `<div class="dc-stat">` — stat block (`.dc-stat-head`, `.dc-stat-grid`, `.dc-stat-line`)
- `<div class="dc-portrait">` — aged-paper portrait frame
- `<div class="dc-tape">` — tape label under portrait
- `<span class="dc-stamp">` — optional stamp overlay

**Page class:** `--- {page .page .chapter-end}`

```html
--- {page .page .chapter-end}

<div style="display:flex;gap:24px;align-items:start;">

<div>
<h1 class="dc-chevron">Creature Name</h1>
<div class="dc-intro">One punchy atmospheric line. Under twenty words.</div>
<p>Flavor prose — appearance, behavior, threat type.</p>

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

<p><strong>Encounter Notes</strong></p>
<p>Encounter guidance for the Dream Master.</p>
</div>

<div>
<div class="dc-portrait">
  <img src="img/creature.png" alt="Creature Name">
</div>
<div class="dc-tape margin-sm">— Field Plate —</div>
<div class="dc-prose caption">Caption text.</div>
<span class="dc-stamp mt">GROUP · 2D4+1</span>
</div>

</div>
```

---

### Table of Contents

Front-matter TOC page. Chevron banner, intro lede, and a structured row list with auto-resolved page numbers via `target-counter()`. Footers suppressed. Each `<a href="#heading-id">` link is resolved to its page number by Paged.js at layout time.

**Components:**
- `# Contents {.dc-chevron}` — banner heading
- `<div class="dc-intro">` — orienting lede
- `<div class="dc-toc">` — TOC container
- `<div class="dc-toc-row">` — one row per entry
- `<div class="dc-toc-no">` — zero-padded chapter number
- `<div class="dc-toc-title">` — title with `<small>` subtitle
- `<div class="dc-toc-page">` — static placeholder or `target-counter()`-resolved number

**Page class:** `--- {page .page .front-matter}`

```html
--- {page .page .front-matter}

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

Each `href` must point to an `id` on a heading or `<span id="…">` anchor in the rendered document. Paged.js replaces the link text with the resolved page number automatically.

---

### Procedure Page

Numbered step-by-step procedure with a two-column layout: steps list on the left, optional sidebar callout and pull quote on the right. A tape divider introduces closing prose below the grid. Flows as a normal body page — no break marker required.

**Components:**
- `# Title {.dc-chevron}` — section banner
- `<div class="dc-intro">` — orienting lede
- `::: wrapper {.dc-procedure-grid}` — two-column flex container
- `<ol class="dc-steps">` — ordered steps list; each `<li>` uses `<span class="dc-step-no">` for zero-padded number
- `!!! Sidebar` — facilitator guidance callout in right column
- `<div class="dc-pullquote">` — pull quote in right column
- `<div class="dc-tape">` — section divider below grid

**Page class:** normal body page, no break marker needed.

```markdown
# Procedure Title {.dc-chevron}

<div class="dc-intro">One orienting sentence — what this procedure produces and roughly how long it takes.</div>

:::: wrapper {.dc-procedure-grid}

::: wrapper {}

<ol class="dc-steps">
  <li><span class="dc-step-no">01</span><span><strong>Step One.</strong> Description. One outcome only.</span></li>
  <li><span class="dc-step-no">02</span><span><strong>Step Two.</strong> Description. Reference step one where relevant.</span></li>
  <li><span class="dc-step-no">03</span><span><strong>Step Three.</strong> Description. Name any tables or rolls explicitly.</span></li>
</ol>

:::

::: wrapper {}

!!! Sidebar
Guidance for common mistakes or variant rules.

<div class="dc-pullquote mt">
  A resonant line capturing the procedure's purpose.
  <span class="dc-pullquote-attr">Source attribution</span>
</div>

:::

::::

<div class="dc-tape">— Variant rules begin overleaf —</div>

Optional closing prose for variant rules or table preferences.
```

---

### Fiction / Narrative Prose

Full-column narrative fiction for chapter openers, vignettes, and dream-scenario intros. No structural UI elements — prose, floated art, and a closing pull quote only. First-line indent is applied by print CSS. Flows as a normal body page — no break marker required.

**Components:**
- `### Scene Label {.dc-spec-tweak .no-top}` — optional vignette label (omit for pure prose)
- `*italic opener*` — scene-setting italic sentence
- `![alt](img/file.png){.dc-art-float-right}` — floated art (use `.dc-art-float-left` for opposite)
- `<div class="dc-pullquote">` — closing pull quote
- `<span class="dc-pullquote-attr">` — attribution inside the quote div

**Page class:** normal body page, no break marker needed.

```markdown
### Scene Label {.dc-spec-tweak .no-top}

*Italic opener — one sentence that sets tone before the prose begins.*

Narrative prose body. Keep paragraphs short and sensory — what the
operator sees, hears, or smells. Each paragraph earns the next.

![Alt text](img/scene-art.png){.dc-art-float-right}

Continued prose with the floated image wrapping left.

<div class="dc-pullquote">
  A resonant line that closes the scene.
  <span class="dc-pullquote-attr">Field debrief, post-run</span>
</div>
```

---

### Rules Reference

Standard interior rules page. Major section banners via `{.dc-chevron}`, H3 sub-headings, body prose, note callouts, tape dividers, roll tables, and pick-one option tables. The workhorse template for mechanics chapters. Flows as a normal body page — no break marker required.

**Components:**
- `## ◈ Section Title {.dc-chevron}` — major section banner (◈ prefix optional)
- `### Sub-Heading` — H3 for mechanic terms (no class needed)
- `**MECHANIC NAME**` — bold caps for mechanic names in prose
- `<span class="scream">ROLL THE DIE!</span>` — die-roll prompt chip
- `<span class="roll-lucid">ROLL LUCID.</span>` — lucid roll chip
- `<span class="ability-name">Name</span>` — ability name inline
- `!!! Note` / `!!! Dream Master` — note callout admonitions
- `<div class="dc-tape">— § —</div>` — section divider
- `<table class="dc-roll-table">` — outcome resolution table
- `::: wrapper {.dc-options-layout}` — two-column pick-one table layout

**Page class:** normal body page, no break marker needed.

```markdown
## ◈ Rule Category {.dc-chevron}

### Mechanic Term

A **MECHANIC TERM** is a defined element of play with a resolution path.
When an ability says <span class="scream">ROLL THE DIE!</span>, roll d20.

!!! Note
Inverse condition note — common edge case or clarification.

<div class="dc-tape">— § —</div>

## ◈ Resolution Table {.dc-chevron}
```

```html
<table class="dc-roll-table">
  <thead>
    <tr>
      <th class="dc-roll-table-th dc-roll-table-th--roll">Roll</th>
      <th class="dc-roll-table-th dc-roll-table-th--result">Result</th>
    </tr>
  </thead>
  <tbody>
    <tr class="dc-roll-table-row">
      <td class="dc-roll-table-roll dc-roll-table-roll--crit">20</td>
      <td class="dc-roll-table-result"><strong class="dc-roll-table-name dc-roll-table-name--crit">Crit</strong> — Automatic success plus additional benefit.</td>
    </tr>
    <tr class="dc-roll-table-row dc-roll-table-row--last">
      <td class="dc-roll-table-roll dc-roll-table-roll--fail">1</td>
      <td class="dc-roll-table-result"><strong class="dc-roll-table-name dc-roll-table-name--fail">Catastrophe</strong> — Fail, and something else goes wrong.</td>
    </tr>
  </tbody>
</table>
```

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
