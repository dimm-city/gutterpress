@chapter #ch-typography .typography

# Typography

::: wrapper {.dc-intro}
Three font families, each with a specific role. lixdu anchors display and banner headings; Tomorrow handles tab labels and mono chrome; Titillium Web carries all body, flavor, and quote copy.
:::

## H1 — lixdu

**Syntax** — `# Chapter Title`

**Spec:** 20.7pt (1.728rem at 12pt base) · bold · lixdu · one per chapter or specialty opener

**Specimen**

# Augmerc

---

## H2 — lixdu

**Syntax** — `## Section Heading`

**Spec:** 17.3pt (1.44rem at 12pt base) · lixdu · major topic breaks

**Specimen**

## Spec Tweak

---

## H3 — lixdu

**Syntax** — `### Sub-section`

**Spec:** 14.4pt (1.2rem at 12pt base) · lixdu · reference column labels

**Specimen**

### Wired to Kill

---

## Spray Banner — dc-spray

**Syntax** — `## Title {.dc-spray}`

**Spec:** Wider tracking, crimson accent bar. Used on learning paths.

**Specimen**

## Biting Distance {.dc-spray}

---

## Chevron Banner — dc-chevron

**Syntax** — `# Title {.dc-chevron}`

**Spec:** Primary chapter/specialty opener banner with angled crimson clip-path.

**Specimen**

# Augmerc {.dc-chevron}

---

## Body — Titillium Web

**Spec:** Standard paragraph. Titillium Web, body copy. No special syntax required.

**Specimen**

When an enemy falters, you may trigger one of the following counters.

---

## Flavor — Titillium Web italic

**Syntax** — `> [!FLAVOR]` blockquote alert

**Spec:** Italic, used in card bodies. Inside `@skill` cards, generated from the `>` blockquote line. Standalone: `> [!FLAVOR]` blockquote alert.

**Specimen**

> [!FLAVOR]
> See an opening, ya take it.

---

## Card Tab — Tomorrow

**Syntax** — `<span class="font-tab">Label</span>`

**Spec:** Monospaced, used in skill card tabs.

**Specimen**

<span class="font-tab">Punishing Counter</span>

---

## Mono Cap Tag — Tomorrow

**Syntax** — `<span class="tag">Label</span>`

**Spec:** Monospaced tag line, stance and timing labels.

**Specimen**

<span class="tag">— Stance · Free counter —</span>

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
