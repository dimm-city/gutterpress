@chapter #ch-typography .typography .chapter-01 data-ch="1"

# Typography

::: wrapper {.dc-intro}
Three font families, each with a specific role. lixdu anchors display and banner headings; Tomorrow handles tab labels and mono chrome; Titillium Web carries all body, flavor, and quote copy.
:::

## H1 — lixdu

**Syntax** — `# Chapter Title`

**Spec:** 20.7pt · bold · lixdu · chapter and specialty openers only

::: wrapper {.specimen}
# Augmerc

*20.7pt / lixdu / used once per chapter opener*
:::

---

## H2 — lixdu

**Syntax** — `## Section Heading`

**Spec:** 17.3pt · lixdu · major topic and section breaks

::: wrapper {.specimen}
## Spec Tweak

*17.3pt / lixdu / major section label*
:::

---

## H3 — lixdu

**Syntax** — `### Sub-section`

**Spec:** 14.4pt · lixdu · reference column labels and sub-sections

::: wrapper {.specimen}
### Wired to Kill

*14.4pt / lixdu / sub-section and card labels*
:::

---

## Spray Banner — dc-spray

**Syntax** — `## Title {.dc-spray}`

**Spec:** Wider tracking, crimson underbar. Used on learning path headers.

::: wrapper {.specimen}
## Biting Distance {.dc-spray}
:::

---

## Chevron Banner — dc-chevron

**Syntax** — `# Title {.dc-chevron}` or `## Title {.dc-chevron}`

**Spec:** Angled crimson clip-path. Primary chapter and specialty opener banner.

::: wrapper {.specimen}
## Augmerc {.dc-chevron}
:::

---

## Body — Titillium Web

**Syntax** — plain paragraph (no class)

**Spec:** 12pt · Titillium Web · base reading type for all prose

::: wrapper {.specimen}
When an enemy falters, you may trigger one of the following counters. Each response costs 0 AP — free actions that fire in the space between their move and yours.
:::

---

## Flavor — Titillium Web italic

**Syntax** — `> [!FLAVOR]` blockquote alert

**Spec:** Italic body size · in-world voice, card flavor, and atmospheric prose

::: wrapper {.specimen}
> [!FLAVOR]
> See an opening, ya take it. The crew that hesitates leaves work on the table — and the table tends to push back.
:::

---

## Card Tab — Tomorrow

**Syntax** — `<span class="font-tab">Label</span>`

**Spec:** 9pt · Tomorrow monospace · skill card tab labels

::: wrapper {.specimen}
<span class="font-tab">Punishing Counter</span>
:::

---

## Mono Cap Tag — Tomorrow

**Syntax** — `<span class="tag">Label</span>`

**Spec:** 8pt · Tomorrow monospace · stance and timing chips

::: wrapper {.specimen}
<span class="tag">— Stance · Free Counter —</span>
:::

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
