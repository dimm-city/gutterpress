@chapter #ch-typography .typography .chapter-01 ch="1"

# Typography

::: wrapper {.dc-intro}
Three font families, each with a specific role. lixdu anchors display and banner headings; Tomorrow handles tab labels and mono chrome; Titillium Web carries all body, flavor, and quote copy.
:::

## H1 — lixdu

**Syntax** — `# Chapter Title`

**Spec:** 20.7pt · bold · lixdu · chapter and specialty openers only

---

## H2 — lixdu

**Syntax** — `## Section Heading`

**Spec:** 17.3pt · lixdu · major topic and section breaks

---

## H3 — lixdu

**Syntax** — `### Sub-section`

**Spec:** 14.4pt · lixdu · reference column labels and sub-sections

---

## Spray Banner — dc-spray

**Syntax** — `## Title {.dc-spray}`

**Spec:** Wider tracking, crimson underbar. Used on learning path headers.

---

## Chevron Banner — dc-chevron

**Syntax** — `# Title {.dc-chevron}` or `## Title {.dc-chevron}`

**Spec:** Angled crimson clip-path. Primary chapter and specialty opener banner.

---

## Body — Titillium Web

**Syntax** — plain paragraph (no class)

**Spec:** 12pt · Titillium Web · base reading type for all prose

---

## Flavor — Titillium Web italic

**Syntax** — `> [!FLAVOR]` blockquote alert

**Spec:** Italic body size · in-world voice, card flavor, and atmospheric prose

---

## Card Tab — Tomorrow

**Syntax** — `<span class="font-tab">Label</span>`

**Spec:** 9pt · Tomorrow monospace · skill card tab labels

---

## Mono Cap Tag — Tomorrow

**Syntax** — `<span class="tag">Label</span>`

**Spec:** 8pt · Tomorrow monospace · stance and timing chips

---

## Font Token Reference

| Variable | Font | Fallback | Used for |
|---|---|---|---|
| `--font-display` | lixdu | serif | H1–H3, banners, card tabs |
| `--font-body` | Titillium Web | sans-serif | Body prose, flavor text, quotes |
| `--font-mono` | Tomorrow | monospace | Tab labels, inline code, mono chrome |

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
- [Dream Master Pages](#ch-example-dm) — NPC stat blocks, encounter hooks
- [Gear & Tech](#ch-example-gear) — aug cards, weapon tables, cybernetics
