# DC Design Guide — Constitution

The canonical, self-contained north-star document for the Dimm City Design Guide. Every component, token, override, and review verdict in this codebase answers to the principles here. This file is meant to be read once start-to-finish by anyone joining the project.

If a design decision conflicts with this document, the design decision is wrong unless the conflict is explicitly resolved with a constitution update.

**Version:** 2026-05-24
**Authority:** project-level (this file) > AKM memory > knowledge:print/design/creaturepunk-design-guide
**Related**: [contextual-cascade-principle.md](./contextual-cascade-principle.md), [css-architecture.md](./css-architecture.md), [adding-macros.md](./adding-macros.md)

---

## I. North-Star Goals

1. **Reusable** — `dc-components.css` drops into any sibling DC project with zero override files required to render correctly.
2. **Author-friendly** — non-technical writers compose books with simple macros. No HTML in markdown. No per-element class attributes for styling.
3. **TTRPG-quality** — output matches the production bar of D&D 5e PHB, Pathfinder 2e Core, Mothership, Blades in the Dark.
4. **Teachable** — the design guide's own markdown source IS the documentation for the system.

---

## II. The Wall (Core Visual Principle)

> **Components float above / stick to the brick wall background.**
> The page is the wall of an alley in Dimm City. Components are the **posters and digital displays hung on it.**

This is the single most-load-bearing visual principle. Every other component decision flows from it.

### What this means concretely

- **The page background is the WALL** — concrete-ash, gritty, urban, structural. It does not compete for attention.
- **Components are objects HUNG on the wall** — posters glued up, LED panels bolted on, spray-painted sigils, stamped warnings, hand-pasted notices. Each has its own visual register, weight, and edges, but all share the same plane: applied to the wall.
- **Components have separation from the wall** — drop shadows, hard edges, slight rotation or asymmetry, perceptible weight. They sit *on top of* the page, not *inside* it.
- **Components do NOT bleed into the wall** — soft tinted backgrounds that fade into the page colour, low-contrast washes, "subtle web gradients" → all wrong. A poster has a hard edge against brick.
- **The wall has texture; the posters have ink** — the page can carry concrete grain. Components are printed/displayed objects with their own surface.

### Component health check

A component is doing the principle right when:
- It has visible separation from the page (shadow, hard border, contrast, or distinct surface treatment).
- Its edges are decisive — clipped, torn, stamped, framed. Not a CSS rectangle drifting into the page.
- A reader could imagine peeling it off the wall as a single physical object.
- Removing it leaves a clean rectangle of "wall" where it was — not a faded ghost.

A component is doing the principle wrong when:
- It feels embedded in the page (no shadow, no edge, soft tint).
- It looks like a web `<div>` with `background-color`.
- Its boundaries are ambiguous.
- The page texture continues through the component instead of being interrupted by it.

### Two surface families

Components belong to one of two surface registers on the wall:

1. **Paper posters** — flyers, warnings, hand-stamped notices, torn show bills. Cream/paper-cream substrate. Hard ink. Stamps, sprays, dotted folds. Banners, callouts, lede panels, NPC stat blocks, gear entries, design-guide chrome.
2. **Digital displays** — LED tickers, status panels, HUD readouts, AP indicators. Saturated coloured fills with crisp reverse-out type. Glow at the edges (via top-edge highlight, not literal glow filters). Outcome ladder chips, AP cost chips, skill-card tabs, alert callout fills.

Cards bridge the two: dark-fill specialty cards lean digital-display; cream-fill skill cards lean paper-poster. A single book uses both registers — that's the texture of Dimm City — but a given **component** picks one and stays in it.

---

## III. Creaturepunk Aesthetic

### Tagline

> *"It ain't chrome. It ain't clean."*

Creaturepunk is **hostile, improvised, urban, cold, aggressive, dirty.** Not friendly. Not polished. Not warm. Not luxurious. Not decorative.

The tone is:
- Hostile, not friendly
- Improvised, not polished
- Urban and cold, not warm or fantasy-coded
- Aggressive, not luxurious
- Dirty, not decorative

If the result looks like a friendly handbook, it failed. If it looks like a damaged field guide that still reads cleanly, it worked.

### The four registers

Creaturepunk is **part future tech, part ancient magic, part landfill, part wonderland.** Every component is a deliberate blend of these in specific proportions. The mix is the **identity signal** of who/what made the object and where it sits in Dimm City's stratigraphy.

| Register | Reads as | Visual cues | Token family |
|---|---|---|---|
| **Future tech** | LED indicators, HUD panels, digital displays, brushed metal, circuit traces, neon signal. Lit-from-within, sharp cut edges, saturated crisp fills. | sharp polygon clips, reverse-out crisp type, top-edge highlight (LED-rim), saturated chip fills, mono caps labels | `--brand-magenta/cyan/yellow/violet`, `--hud-blue/blue-dark`, AP-chip / outcome-chip / skill-tab chrome |
| **Ancient magic** | Mineral facets, refractive crystals, faceted geometric chrome, arcane runes, smoky-quartz depth. Cold colour temperature, faceted geometry, multi-stroke depth. | faceted/lozenge clip-paths, mineral-violet/aqua/citrine accents, geometric ornaments, multi-stop tonal depth | `--crystal-amethyst/aqua/citrine`, mineral-violet undertones |
| **Landfill** | Rust drips, torn paper edges, exposed adhesive, scratched tape, oil stains, smoke-burn. Warm decay, oxidised metal, dried blood. | torn-paper edges, rough/irregular cuts, paper-stain tints, rust drips, smudge/grime overlays, asymmetric rotation | `--rust`, `--blood`, `--orange`, `--amber`, `--crimson`, `--deep-rust`, `--paper-stain`, `--paper-aged` |
| **Wonderland** | Bioluminescent fungi, UV-reactive spore-light, alley moss with a pulse, organic crackle, dream-haze. Yellow-green organic glow, irregular organic boundaries. | fungi-glow accents on dark fills, organic curvature in clip-paths, irregular asymmetric edges, spore-halo treatments | `--fungi-glow`, `--fungi-mid`, `--fungi-rot` |

### Per-specialty register mix (deliberate, not random)

Every specialty leans into a specific register mix that reflects WHO it is in the world. The CSS theme block per specialty (`.dc-specialty.<name>`) should express that mix, not just swap colors.

| Specialty | Future tech | Ancient magic | Landfill | Wonderland | Visual cues |
|---|---|---|---|---|---|
| **Augmerc** | ████ HIGH | low | ██ mid | low | LED-chrome tabs, hard angular cuts, brand-magenta body + brand-cyan accent pop. Tech-heavy, street-salvaged. |
| **Wirephreak** | ████ HIGH | low | ██ mid | low | Drowned-circuit teal, signal-cyan accents, crisp polygonal clips. Decking + interference. |
| **Cybersurgeon** | ████ HIGH | low | █ low | low | Cold clinical chrome, medical mono labels, blue-grey steel. Med-tech, surgical precision. |
| **Technosorcerer** | ████ HIGH | ████ HIGH | low | low | Tech+magic hybrid. Centre-notched gate clips (mineral geometry), violet ritual chrome. |
| **Etherlock** | ██ mid | ████ HIGH | ██ mid | ██ mid | Faceted refraction, citrine/yellow ritual hits. Secrets-as-currency, manifold magic. |
| **Proxy** | low | ████ HIGH | ████ HIGH | low | Divine force on burnt paper. Scorch-orange, near-black ink, conviction stamp register. |
| **Streetwarden** | ██ mid | low | ██ mid | low | Civic-warden hazard register. High-vis toxic green, polygonal civic chrome. |
| **Gutterdruid** | low | ██ mid | ████ HIGH | ████ HIGH | Trash heap + spore magic. Torn-paper edges, fungi-glow accent flare, organic asymmetric clips. |
| **Dualist** | ██ mid | ████ HIGH | low | ██ mid | Two-path walker. Crystal-aqua refraction, lozenge faceted geometry, mineral-mineral. |
| **Generalist** | ██ mid | ███ HIGH | ██ mid | low | Sprawl survivor. Crystal-amethyst undertones, soft chamfered geometry. Common stone, refracted depth. |

The mix is the SOURCE of design decisions. When polishing a component for a specialty, ask: *which register dominates? what visual cues belong to that register? what does NOT belong?*

**Concrete implications:**
- LED top-edge highlight (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.18)`) belongs on Augmerc / Wirephreak / Cybersurgeon / Technosorcerer chrome (future-tech high). It does NOT belong on Gutterdruid — the gutterdruid card is torn paper with fungi-glow seeping through, not a polished tech panel.
- Torn-paper irregular clip-paths belong on Gutterdruid / Proxy (landfill high). They do NOT belong on Augmerc / Cybersurgeon — clinical tech doesn't tear.
- Faceted lozenge / multi-stop tonal depth belongs on Dualist / Technosorcerer / Etherlock / Generalist (ancient-magic high).
- Fungi-glow halo / organic crackle belongs on Gutterdruid (wonderland high). The wirephreak's cyan is electric, not organic — those visually differ even though both are "bright accent on dark fill."

---

## IV. Controlled Chaos — the 80/20 Rule

- **80% of the page** is structurally reliable: text frames, margins, table alignment, reading order, page furniture.
- **20% can misbehave**: rotated stamps, broken banners, offset tabs, hard colour hits, asymmetric ornament.

Apply disruption to **display elements**, never to **reading surfaces**.

| Safe for chaos | Keep stable |
|---|---|
| Chapter openers | Body copy |
| Section banners | Tables |
| AP tags + sticker chains | Rules text |
| Pull quotes + warnings | Lists |
| Image crops + overlays | Page numbers + running heads |

The mistake to avoid: confusing **chaotic** with **hard to use**. Creaturepunk pages should feel **unstable while the information remains easy to scan.**

### Layout rules

- Inner margin: at least 0.5in before any decorative intrusion.
- Outer/bottom margins can feel tighter than inner.
- Bleed art can push outward; rules text never feels trapped in the gutter.
- Body copy is never rotated. Uppercase belongs to display, not long instructions.
- Line length: 45–75 characters.
- Banners may be angled by a few degrees; text baseline inside stays level.

---

## V. Print-First Palette + Tokens

Use a cold-grey page base with narrow, deliberate accent hits. Do not build full-page neon fields. Let grey do most of the work.

### Page substrate

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#c8c5bf` | The wall. Ash-concrete page background — gritty, urban, structural. |
| `--paper-cream` | `#eee0c4` | Paper-poster substrate — flyers, callouts, cards on the cream register. |
| `--paper-light` | (paper-cream tint) | Lighter cream surface — specialty intros, alternate panel fills. |
| `--paper-stain` | (paper-cream warm) | Aged/stained paper — lede panels, flavor blocks. |
| `--paper-aged` | (deeper stain) | More heavily-aged paper — outcomes ladder, gear entries. |
| `--ink` | `#1a1512` | Body text, key rules, heavy borders. |
| `--ink-dark` | `#2b231d` | Heavy callout fills (DM notes), border anchors. |
| `--ink-smoke` | (mid grey-brown) | Flavor text, captions, secondary labels. |
| `--ink-dust` | `#756a5c` | Form-label micro-headings, deprecated registers. |

### Brand signature layer

The dimm.city web-palette analogs, SWOP-corrected for POD:

| Token | Hex | CMYK est | Use |
|---|---|---|---|
| `--brand-magenta` | `#c026d3` | C50/M95/Y0/K0 = 145% | Bright neon signal — section accents, gateway banners |
| `--brand-magenta-deep` | `#8a0a9a` | C10/M94/Y0/K40 = 144% | Press-safe magenta on cream (crit row text-on-fill 6.21:1) |
| `--brand-cyan` | `#00bcd4` | C75/M10/Y15/K0 = 100% | Signal interference, wirephreak accent, augmerc-card pop |
| `--brand-yellow` | `#ffd700` | C0/M14/Y100/K0 = 114% | Brand radiant — etherlock accent, peak triumph |
| `--brand-violet` | `#7030b8` | C57/M82/Y0/K28 = 167% | Technosorcerer accent, ritual signal |

### HUD / digital-display layer

| Token | Hex | Use |
|---|---|---|
| `--hud-blue` | `#1f6f94` | Mid HUD teal — primary stat lines, secondary chrome |
| `--hud-blue-dark` | `#14516e` | Deep teal — borders, rules, H2 text |
| `--hud-blue-dim` | `#7ab8d0` | Light cyan panel tint — alerts default bg, table headers default |
| `--hud-magenta` | (alias --brand-magenta) | Brand-signature cyber-magenta |
| `--hud-panel` | `#eeece8` | Neutral light cream — note/callout default fill |

### Gutter / fire-and-blood layer

| Token | Hex | CMYK est | Use |
|---|---|---|---|
| `--crimson` | `#e1261c` | C0/M95/Y90/K0 = 185% | PMS Red 032 — danger, harm, active states, ROLL THE DIE tags |
| `--blood` | `#901a12` | C0/M82/Y87/K44 = 213% | Oxidised arterial — DM-chapter table headers (6.3:1 on cream) |
| `--orange` | `#d4500a` | C0/M62/Y95/K17 = 174% | Burnt circuit-board — warnings, AP tags, arrows |
| `--orange-deep` | `#a03808` | C0/M65/Y95/K37 = 197% | Press-safe orange on cream (mixed row 5.25:1) |
| `--rust` | `#b23a12` | C0/M67/Y90/K30 = 187% | Burnt rebar — section accents, miss row |
| `--amber` | `#7a5a20` | (TAC mid) | Sulphur-scorched brass — gear-chapter section accent |
| `--deep-rust` | `#6a1a08` | (TAC mid-high) | Shadow rust — deepest warm dark |
| `--amber-dark` | `#5c3c10` | (TAC mid-high) | Charred amber |

### Fluorescent fungi layer (wonderland)

| Token | Hex | CMYK est | Use |
|---|---|---|---|
| `--fungi-glow` | `#c8e040` | C30/M0/Y90/K0 = 120% | Bioluminescent yellow-green — gutterdruid accent, outcome-row.hit (with ink text) |
| `--fungi-mid` | `#6aa030` | C58/M18/Y100/K8 = 184% | Luminous lichen mid — reserved for future fungi-faction signal |
| `--fungi-rot` | `#2a4015` | C50/M30/Y100/K60 = 240% | Deep moldering green — outcome-row.fail (large-fill only) |

### Ancient crystals layer (magic)

| Token | Hex | CMYK est | Use |
|---|---|---|---|
| `--crystal-amethyst` | `#6a3a8a` | C50/M65/Y0/K35 = 150% | Mineral violet — generalist accent, refractive arcane |
| `--crystal-aqua` | `#4a98a8` | C70/M28/Y28/K20 = 146% | Crystalline aquamarine — dualist accent |
| `--crystal-citrine` | `#b89a3a` | C20/M30/Y90/K20 = 160% | Burnt mineral gold — reserved for future crystal-faction signal |

### Specialty palette (combined per-specialty triad)

Every specialty has three tokens: **accent** (bright signal), **mid** (chrome/structural), **dark** (card-body fill).

| Specialty | accent | mid | dark | Register lean |
|---|---|---|---|---|
| augmerc | brand-magenta | `#9a1896` | `#8a1a90` | future-tech HIGH + landfill mid |
| proxy | orange | `#7a3008` | `#3d1a00` | magic HIGH + landfill HIGH |
| streetwarden | `#4db840` toxic-civic | `#347828` | `#1a3d10` | tech mid + landfill mid |
| gutterdruid | fungi-glow | `#4d6020` | `#2a3408` | landfill HIGH + wonderland HIGH |
| cybersurgeon | `#a8b4b8` chrome | `#606870` | `#303840` | future-tech HIGH |
| wirephreak | brand-cyan | `#006878` | `#003a40` | future-tech HIGH + landfill mid |
| technosorcerer | brand-violet | `#4a1878` | `#200a38` | tech HIGH + magic HIGH |
| etherlock | brand-yellow | `#8a6a00` | `#3d3000` | magic HIGH + landfill mid + wonderland mid |
| dualist | crystal-aqua | `#2a6878` | `#143a4a` | magic HIGH + tech mid + wonderland mid |
| generalist | crystal-amethyst | `#503070` | `#1e0e2e` | magic HIGH |

### Production rules (CMYK + press-safe)

- POD target: SWOP coated v2 / GRACoL gamut.
- **TAC ceiling: 280%.** Any token over 280% is print-unsafe.
- Hairlines: ≥ 0.5pt. Any rule thinner vanishes in CMYK.
- Body-text contrast: ≥ 4.5:1 (WCAG AA).
- Large-text contrast: ≥ 3:1.
- Reversed type: never below 8.5pt, semibold minimum, only on solid fills.
- Body text never on noisy or tinted backgrounds.
- Magenta + crimson drift muddy in early proofs — proof these first.
- Avoid rich black for small text.

---

## VI. Typography

| Role | Preferred | Fallback | Size range |
|---|---|---|---|
| Display | `lixdu` | Titillium Web Bold | H1 26–32pt, H2 18–24pt |
| Body | Titillium Web | Tomorrow | 10.5–11.5pt with 13–15pt leading |
| Labels / Mono | Tomorrow | monospace | 9pt minimum |

### Type hierarchy

| Element | Spec | Notes |
|---|---|---|
| H1 | lixdu, 26–32pt, uppercase | Chapter punch, minimal copy |
| H2 | lixdu, 18–24pt | Can sit on angled magenta banner |
| H3 | bold display or body-bold, 13–16pt | Use accent color sparingly |
| H4 | body-bold or mono-bold, ~13pt | Component sub-headings (skill names, stat-block name) |
| H5 | mono-caps, ~9pt with 0.14em tracking | Chrome labels (TRAITS, EQUIPMENT, OUTCOMES) |
| Body | 10.5–11.5pt with 13–15pt leading | Default reading size |
| Captions | 9pt minimum | Avoid going smaller in print |
| Reversed | 8.5pt minimum, semibold | Only on solid fills |

### Type rules

- Do not rotate body copy.
- Uppercase belongs to display, not long instructions.
- Keep line length 45–75 characters.
- Street voice in short bursts; rules text stays clear.
- Display sizes need negative tracking (lixdu defaults are body-tuned). Apply via component-level `letter-spacing` only when justified by surface — banners on dark fills, not body copy.
- H5 mono caps need wider tracking (0.12–0.14em) to read as chrome labels at small size.

---

## VII. Component Visual Patterns

Each component lives in ONE surface register (paper poster or digital display) and inherits visual cues from its specialty's register mix.

### Section banners (chapter chevron + spray)

- **Surface**: paper poster register (cream-stamped + clip-cut)
- **One aggressive banner per section** is enough — don't double up.
- Keep banner copy short.
- If angled, text baseline inside stays level.
- Clipped edges define the banner — never use a default rectangle.
- Background fill is solid (not gradient) — the brick-wall-poster ideal means flat-ink on substrate, not a sheen.
- Per-chapter `--section-accent` token drives the chevron + spray colour.

### Skill cards (the most-repeated component)

- **Surface**: paper poster register (cream body + clipped tab + ink border)
- Skill card body uses `--paper-cream` substrate with a colored tab on the top edge.
- Tab background uses `--dc-card-tab-bg` (specialty's mid colour) with a clipped polygon shape.
- Per-specialty clip-path geometry distinguishes specialties at-a-glance (augmerc = angular cuts, dualist = lozenge, generalist = soft chamfer).
- AP chips and inline ROLL THE DIE markers ride INSIDE the card body — they're digital-display elements pinned to the paper poster.

### Specialty cards (the 10-card grid + profile shells)

- **Surface**: paper poster register — paper-cream substrate with printed colored ink header. The full-dark-fill pattern was over-styled; specialty color now lives in the **header band + title + thick left border**, NOT the card body.
- Card body: `--paper-cream` (default). Body text: `--ink`. Reads as a printed flyer pasted on the brick wall.
- **Colored header band**: thick top border (~16pt) in the specialty's accent color. This is the specialty's primary visual signature at grid scale.
- **Colored title**: h3 title color matches the band — reinforces the specialty signature.
- **Thick colored left border** (3pt) in the same accent — secondary signature, vertical anchor.
- **Outer 1.5pt border** in the specialty's mid color — frame.
- Per-specialty clip-path geometry — secondary identity cue (rectangular tops keep the band readable; aggressive top cuts would clip the band).
- **NO** corner accent triangles, NO portrait double-edge framing, NO noise overlays, NO LED-rim inset highlights, NO tonal-lift gradient on the body, NO hazard-tape borders, NO torn-paper irregular clip-paths — all Pass 6/7/8 experiments were rejected by user-eye review as over-styling. Restraint wins.
- The rule: **specialty color belongs in border, title, and at most a tint of the substrate** — not as a saturated fill across the entire card.

### Outcome ladder chips (digital display)

- **Surface**: digital display register (saturated chip + LED-rim highlight)
- 5-row creaturepunk gradient: crit (brand-magenta-deep) → hit (fungi-glow + ink text) → mixed (orange-deep) → miss (rust) → fail (fungi-rot).
- Each chip has tonal gradient + inset top-highlight + inset bottom-shadow ("pressed/stamped" LED-display register).
- Each row's text-cell has `border-left: 2px solid var(--row-color)` tethering the result text to the band colour.
- Outcome-name labels at 0.85 opacity for press-safe legibility.

### AP cost chips (digital display, the LED-indicator pattern)

- **Surface**: digital display register (LED chrome stuck on tech)
- Tonal gradient on the chip fill + inset top-highlight + layered shadow (close + soft far) + text-shadow.
- 1pt `--ink-dark` border for press registration grip.
- Slight rotation (`transform: rotate(-1deg)`) keeps the chip from feeling pixel-aligned.
- Variants by AP cost: free=crimson, var=brand-magenta, increased=blood.

### Callouts (.dc-alert variants)

- **Surface**: paper poster register (tinted paper substrate + left ink-rule)
- Default: HUD-cyan-dim panel with HUD-blue-dark left bar.
- DM-note variant: ink-dark panel with brand-cyan left bar (the dark-paper "intelligence drop" register).
- Vibe-callout, Gear-callout, etc.: per-context paper tint.
- Flat solid fill — no tonal gradient, no inset cream stroke (Pass 6 attempt reverted).

### NPC stat blocks

- **Surface**: paper poster register (cream-stamped + 2pt top-rule on name + chrome labels)
- Name (H4) gets a 2pt top-rule in `--rust` (chapter accent) — `border-top: 2pt solid var(--rust)`.
- TRAITS / EQUIPMENT / CYBERNETICS (H5) at 9pt mono caps with 0.14em tracking — read as chrome labels, not competing headings.
- Primary stat line (HP/damage) in mono, `--hud-blue`.
- Secondary stat line (Fodder/size) in mono, `--ink-smoke`.

### Tables

- Header row in `--hud-blue-dim` default; per-chapter override sets to `--rust` or `--blood` per chapter accent.
- Header text: mono caps, 8pt, on solid fill.
- Body rows: 9pt body font on alternating cream tints.
- Inner cell padding generous (0.04in vertical, 0.08in horizontal).

### Lede (.dc-intro / @lede)

- **Surface**: paper poster register (paper-stain substrate + 4px accent-color left bar)
- Italic body text in `--ink-smoke`.
- Flat solid panel fill — no tonal lift, no noise overlay.
- Per-chapter `--section-accent` colours the left bar.

### Outcome row text-cell tether (Pass 5b finding)

The right-cell of each outcome row gets `border-left: 2px solid var(--row-color)` so result text is visually tethered to its row band. Without it the right cell floats untethered.

---

## VIII. Hard Architectural Constraints

These are non-negotiable. Violations rate the work AWKWARD or BROKEN regardless of visual appearance.

### Selector ownership

- `.page` / `.chapter` selectors are reserved for **counters, page-templates, TOC IDs, and per-instance positioning**.
- Component visuals live exclusively in `dc-components.css` under the `.dc-*` namespace (kebab-case).
- `columns: N` rules live exclusively in `page-templates.css` (columns-ownership rule).
- `@page` directive class args are limited to **page-template names** (`.chapter-start`, `.card-grid`, etc.).

### Naming

- `.dc-component-name` lowercase-kebab.
- Tokens: `--<scope>-<role>` (e.g., `--dc-card-tab-bg`, `--brand-magenta`, `--augmerc-accent`).
- Macros: `@section .dc-X` for reusable visual components. `@page .TEMPLATE-NAME` for page-fitting concerns.

### Counter strategy

`@chapter` emits the wrapper element and increments the counter. Pages inherit chapter numbering via Paged.js cascade. **Never hand-apply `.chapter-NN`** — that bypasses the counter.

### Cascade discipline

Per [contextual-cascade-principle.md](./contextual-cascade-principle.md):

- Component styles in `dc-components.css` expose `--dc-X-*` token surfaces with sensible defaults.
- Per-book overrides in `fg-overrides.css` set those tokens via **natural selector chains** (chapter id → page template → section component).
- Override files NEVER carry bare `.dc-*` rules — only context-scoped selectors (`#ch-X .dc-Y`, `.page.Z .dc-Y`, `.section.dc-X`).
- Section variants ride on `@section .dc-X` only. No utility variant classes (`.dc-accent-X`, `.variant-Y` are forbidden).
- Authors NEVER write per-element class attributes for styling (`{.dc-warning}` on a paragraph is forbidden).

### File ownership

| File | Owns |
|---|---|
| `dc-tokens.css` | `:root` tokens, `@font-face`, `* { print-color-adjust }` |
| `dc-core.css` | `html`/`body` baseline, element resets, heading defaults |
| `dc-components.css` | Every `.dc-*` + `.pmd-*` component (base + thin variants + token contracts) |
| `page-templates.css` | **All `columns:N` rules** (exclusive), `.page.*` layouts, paged wrapper scaffolding |
| `page-rules.css` | `@page` declarations, named pages, Paged.js counter fixes |
| `dg-overrides.css` | `div.chapter` scaffolding, design-guide specimen chrome |
| `fg-overrides.css` | Context-scoped layout rules only: chapter / page-template / section context selectors setting `--dc-*` tokens |

---

## IX. Anti-Patterns (explicit)

Do not drift into:

- **Clean corporate manual** layouts
- **Warm parchment fantasy** styling
- **Smooth chrome cyberpunk glamour** (Blade Runner luxury, not creaturepunk)
- **Full-page black neon web aesthetics** that don't reproduce in print
- **Randomized chaos** that hurts scan speed
- **Web-2.0 sheen** — large gradients, gloss, drop-shadow bevels, polished glass surfaces
- **Polished frosted-glass** translucency
- Every page using the same tilt-and-banner trick
- Undefined token names across templates
- Accent colors competing instead of supporting hierarchy
- Too many textures making the page muddy
- Decorative aggression with no focal point
- Component drift into the wall — soft tinted backgrounds, ambiguous edges, no separation from page

### Component-level failures (Pass 6/7 specifically)

These polish moves were tried and REJECTED:

- `text-shadow` on display type (reads as web-2.0 sheen)
- Tonal gradient on banner fills (banners want flat ink, not gradient)
- Paper-grain noise overlay on solid fills (didn't visibly land; processing cost without benefit)
- Corner accent triangle via `::after` on specialty cards (broke clipping on lozenge / chamfered shapes)
- Portrait double-edge frame chrome (made empty placeholders MORE prominent)
- Inset cream double-stroke on callouts (looks deluxe-web, not creaturepunk)
- Drop cap via `::first-letter` (paged.js strips it)

When in doubt: keep components FLAT, give them HARD SHADOWS, hard edges, decisive separation from the wall. **Subtle ≠ better. Decisive ≠ overdone.**

---

## X. Image and Texture Use

### Texture rules

- Use grain at very low opacity (2–3% visual strength) on the WALL (page background), never on components.
- Prefer one subtle global texture over many competing overlays.
- Never place noise behind small body text.
- Torn edges + spray effects belong on banners, tabs, dividers — not everywhere.

### Image rules

- Favor high-contrast art with urban decay, hard lighting, threat.
- Let art interrupt layout instead of sitting politely in frames.
- Magenta or orange light accents as supporting note, not whole image strategy.
- Avoid cute expressions, fantasy scrollwork, sleek luxury tech imagery.

---

## XI. Review Requirement

Before any commit to `dc-components.css`, `dc-tokens.css`, `page-templates.css`, or any markdown file under `examples/dc-design-guide/`:

**Four diverse experts must all agree** the work is at-bar:

1. **CSS architecture** — cascade discipline, token contracts, naming, no violations.
2. **Print production** — POD-safe (SWOP coated v2, TAC ≤ 280%, contrast ≥ 4.5:1 for body, hairlines ≥ 0.5pt).
3. **Creaturepunk brand** — aesthetic stays true (4 registers + per-specialty mix); no drift into anti-patterns.
4. **Editorial / book-layout** — TTRPG-quality (D&D 5e PHB / PF2e Core / Mothership / Blades reference bar).

The canonical print-layout review prompt: [agent:print/print-layout-reviewer]. Use it as a quality gate post-edit.

**A GO from all four is required to commit. A FIX or NO-GO from any blocks the commit.**

### Per-spread verdict scheme (designer-eye review)

| Verdict | Definition |
|---|---|
| **OK** | Could appear in a professionally published book without editorial comment. Visible type hierarchy. Brand identity coherent. Reviewer can name a positive reason it's ship-ready. |
| **MINOR** | Single flaw a professional art director would mark on first pass. Ragged-bottom > 20%, drifting heading, one card clipping. Shippable with polish. |
| **AWKWARD** | Reader would notice quality problems unprompted. Ragged-bottom > 40%, lopsided spread, under-filled pages with no design justification. When in doubt between MINOR/AWKWARD, choose AWKWARD. |
| **BROKEN** | Reader-facing failure. Content < 40% of spread, blank page that should have content, component clipped mid-word, body text 2-3 words per line. Always blocks GO. |

### Review pre-flight checklist

- Does the page feel hostile without hiding information?
- Is the reading order obvious in under 5 seconds?
- Is disruption focused on display elements rather than body copy?
- Are accent colors limited to a few deliberate hits?
- Are margins and gutter safety respected?
- Is body text comfortably printable at size?
- Does the spread avoid both corporate cleanliness and unusable chaos?
- Does each component register correctly (paper poster vs digital display)?
- Does each specialty component reflect its per-specialty register mix?
- Would this still work if printed slightly darker than the screen proof?

---

## XII. Documentation Layer

- **This file** (`constitution.md`) is the project-level north star.
- [contextual-cascade-principle.md](./contextual-cascade-principle.md) — canonical cascade-discipline doc.
- [css-architecture.md](./css-architecture.md) — file ownership + load order.
- [adding-macros.md](./adding-macros.md) — plugin authoring guide.
- [knowledge:print/design/creaturepunk-design-guide] — extended aesthetic reference (AKM stash).
- [memory:dimm-city-design-guide-constitution-2026-05-23] — AKM hot-recall of these principles.
- [agent:print/print-layout-reviewer] — canonical review prompt for the quality gate.
- The design guide's own markdown source (`0*.md`, `30*.md`) IS the user-facing documentation.

If those documents disagree, this file takes precedence. Update the AKM memory to match.

---

## XIII. Quick Reference

| Area | Default decision |
|---|---|
| Page background ("the wall") | `--bg` cold ash-concrete |
| Primary text | `--ink` near-black |
| Main accents | brand-magenta / brand-cyan / rust / fungi-glow / crystal-amethyst |
| Body copy | Stable, upright, readable |
| Chaos placement | Labels, banners, image edges, stickers — never body |
| Card feel | Industrial, clipped, slightly darker than page |
| Texture | Barely visible grime on wall only |
| Overall test | Forbidden street intel, not polished UI |
| Component register check | Paper poster OR digital display — not both |
| Specialty register check | Does the design read its per-specialty mix correctly? |

If it looks like a friendly handbook, it failed. If it looks like a damaged field guide that still reads cleanly, it worked.
