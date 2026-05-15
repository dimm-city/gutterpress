@chapter #ch-typography .typography .chapter-01 ch="1"

# Typography

@lede

Three font families, each with a specific role. lixdu anchors display and banner headings; Tomorrow handles tab labels and mono chrome; Titillium Web carries all body, flavor, and quote copy.

@end-lede

## Type Scale Reference

| Element | Syntax | Size · Weight · Font | Role |
|---|---|---|---|
| H1 | `# Chapter Title` | 20.7pt · bold · lixdu | Chapter and specialty openers only |
| H2 | `## Section Heading` | 17.3pt · bold · lixdu | Major topic and section breaks |
| H3 | `### Sub-section` | 14.4pt · lixdu | Reference column labels and sub-sections |
| Spray Banner | `## Title {.dc-spray}` | Wider tracking, crimson underbar | Learning path headers |
| Chevron Banner | `# Title {.dc-chevron}` | Angled crimson clip-path | Primary chapter and specialty opener banner |
| Body | plain paragraph | 12pt · Titillium Web | Base reading type for all prose |
| Flavor | `> [!FLAVOR]` | Italic body size · Titillium Web | In-world voice, card flavor, atmospheric prose |
| Card Tab | `<span class="font-tab">` | 9pt · Tomorrow monospace | Skill card tab labels |
| Mono Cap Tag | `<span class="dc-tag">` | 8pt · Tomorrow monospace | Stance and timing chips |

---

## Font Token Reference

| Variable | Font | Fallback | Used for |
|---|---|---|---|
| `--font-display` | lixdu | serif | H1–H3, banners, card tabs |
| `--font-body` | Titillium Web | sans-serif | Body prose, flavor text, quotes |
| `--font-mono` | Tomorrow | monospace | Code, counters, and monospaced tabular data |
| `--font-tab` | Tomorrow | lixdu / sans-serif | Card tab labels, banner labels, stat names — Tomorrow preferred for readability at small sizes |
| `--font-sans` | Titillium Web | Inter / system-ui | Alternate sans-serif body; use when Titillium Web weight needs a fallback |
| `--font-quote` | Titillium Web | Tomorrow / serif | Italic flavor quotes and pullquote attribution lines |

> [!NOTE]
> `--font-tab` and `--font-mono` both resolve to Tomorrow as first choice. The distinction: `--font-tab` is for short label text (tab chips, stat labels); `--font-mono` is for code, counters, and monospaced tabular data.

---

## Smart Typography

The markdown renderer has `typographer: true` enabled, which automatically converts common ASCII shortcuts to proper typographic characters.

- `--` renders as an en dash --
- `---` renders as an em dash ---
- `...` renders as an ellipsis ...
- `"quoted"` renders as curly double quotes "quoted"

No special syntax required for these conversions.

---

## See It In Action {.pmd-break-before}

@no-break

### Body Prose

Twelve-point Titillium Web carries all running narrative. The quick dark fox leaped over the lazy augmerc's rig. Corporate enforcers earn their grafts in blood and overtime; street muscle runs cheaper and lasts longer than anyone admits. Read a full paragraph here --- notice the leading, the x-height, and how weight shifts when a word is **bolded** or *italicized* mid-sentence.

@end-no-break

---

@no-break

### Flavor Text

> [!FLAVOR]
> See an opening, ya take it. Best time to hit 'em is when they think it's over.

@end-no-break

---

### Smart Typography

The typographer converts ASCII shortcuts automatically --- no special syntax needed. Dashes: en -- and em --- . Ellipsis: ... . Double quotes: "quoted phrase" . Single quotes: 'abbreviated'.

---

### Real-World Examples

- [Front Matter & TOC](#ch-example-front-matter) — credits, TOC, intro pages
- [Chapter Openers](#ch-example-chapter-opener) — chapter start spreads with chevron and spray banners in context
- [Specialty Overview](#ch-example-specialty-overview) — chapter-02 specialty intro pages
- [Specialty Profile](#ch-example-specialty-profile) — full specialty spread with skill card tabs and ability text
- [Rules & Mechanics](#ch-example-rules) — rolling, outcomes, body prose at density
- [Dream Master Pages](#ch-example-dm-npcs) — NPC stat blocks, encounter hooks
- [Gear & Tech](#ch-example-gear-tech) — weapon tables and cybernetics

---

> [!NOTE]
> **Column-safe headings:** H3 and H4 only. H1 and H2 at full print size exceed 3.5-inch column width — reserve them for full-width chapter openers, section breaks, and specimen pages. In two-column reference layouts, H3 is the workhorse heading.

> [!NOTE]
> **Body vs. flavor:** Body prose is Titillium Web at 12pt with `--lh-normal` (1.5) leading. Flavor text inherits the same size but switches to italic and `--ink-smoke` for a visual register shift. Never use bold italic for flavor — it reads as urgency, not voice.

<div class="column-break"></div>

### Heading Hierarchy

Each heading level below is rendered live at its actual print size using the lixdu display font.

# Chapter Title

## Section Heading

### Sub-section Label

#### Card Tab / Tier Label

---

### Chevron and Spray Banners

# Augmerc {.dc-chevron}

## Biting Distance {.dc-spray}
