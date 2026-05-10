@chapter #ch-typography .typography

# Typography

<div class="dc-intro">Three font families, each with a specific role. lixdu anchors display and banner headings; Tomorrow handles tab labels and mono chrome; Titillium Web carries all body, flavor, and quote copy.</div>

## H1 — lixdu

**Syntax:** `# Chapter Title`

**Spec:** 36pt · bold · lixdu · one per chapter or specialty opener

<h1>Augmerc</h1>

---

## H2 — lixdu

**Syntax:** `## Section Heading`

**Spec:** 24pt · lixdu · major topic breaks

<h2>Spec Tweak</h2>

---

## H3 — lixdu

**Syntax:** `### Sub-section`

**Spec:** 18pt · lixdu · reference column labels

<h3>Wired to Kill</h3>

---

## Spray Banner — dc-spray

**Syntax:** `## Title {.dc-spray}`

**Spec:** Wider tracking, crimson accent bar. Used on learning paths.

<h2 class="dc-spray">Biting Distance</h2>

---

## Chevron Banner — dc-chevron

**Syntax:** `# Title {.dc-chevron}`

**Spec:** Primary chapter/specialty opener banner with angled crimson clip-path.

<h1 class="dc-chevron">Augmerc</h1>

---

## Body — Titillium Web

**Spec:** Standard paragraph. Titillium Web, body copy.

<p class="dc-prose">When an enemy falters, you may trigger one of the following counters.</p>

---

## Flavor — Titillium Web italic

**Spec:** Italic, used in card bodies.

<p class="dc-prose flavor">See an opening, ya take it.</p>

---

## Card Tab — Tomorrow

**Spec:** Monospaced, used in skill card tabs.

<span class="font-tab">Punishing Counter</span>

---

## Mono Cap Tag — Tomorrow

**Spec:** Monospaced tag line, stance and timing labels.

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
