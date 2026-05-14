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

## See It In Action

These examples show the above type styles rendered in real book pages using actual Dimm City Field Guide content.

- [Front Matter & TOC](#ch-example-front-matter) — credits, TOC, intro pages
- [Chapter Openers](#ch-example-chapter-opener) — chapter start spreads with chevron and spray banners in context
- [Specialty Overview](#ch-example-specialty-overview) — chapter-02 specialty intro pages
- [Specialty Profile](#ch-example-specialty-profile) — full specialty spread with skill card tabs and ability text
- [Rules & Mechanics](#ch-example-rules) — rolling, outcomes, body prose at density
- [Dream Master Pages](#ch-example-dm-npcs) — NPC stat blocks, encounter hooks
- [Gear & Tech](#ch-example-gear-tech) — weapon tables and cybernetics
