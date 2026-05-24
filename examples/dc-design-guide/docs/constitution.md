# DC Design Guide — Constitution

The canonical north-star document for the Dimm City Design Guide. Every component, token, override, and review verdict in this codebase answers to the principles here.

If a design decision conflicts with this document, the design decision is wrong unless the conflict is explicitly resolved with an updated constitution entry.

---

## I. North-Star Goals

1. **Reusable** — `dc-components.css` drops into any sibling DC project with zero override files required to render correctly.
2. **Author-friendly** — non-technical writers compose books with simple macros. No HTML in markdown. No per-element class attributes for styling.
3. **TTRPG-quality** — output matches the production bar of D&D 5e PHB, Pathfinder 2e Core, Mothership, and Blades in the Dark.
4. **Teachable** — the design guide's own markdown source IS the documentation for the system.

---

## II. The Wall

> **Components float above / stick to the brick wall background.**
> The page is the wall of an alley in Dimm City. Components are the **posters and digital displays hung on it.**

This is the single most-load-bearing visual principle in the system. Every other component decision flows from it.

### What this means concretely

- **The page background is the WALL** — concrete-ash, gritty, urban, structural. It does not compete for attention. It is the canvas.
- **Components are objects HUNG on the wall** — posters glued up, LED panels bolted on, spray-painted sigils, stamped warnings, hand-pasted notices. Each has its own visual register, weight, and edges, but all share the same plane: applied to the wall.
- **Components have separation from the wall** — drop shadows, hard edges, slight rotation or asymmetry, perceptible weight. They sit *on top of* the page, not *inside* it.
- **Components do NOT bleed into the wall** — soft tinted backgrounds that fade into the page colour, low-contrast washes, "subtle web gradients" → all wrong. A poster has a hard edge against brick.
- **The wall has texture; the posters have ink** — the page can carry concrete grain or texture. Components are printed/displayed objects with their own surface (paper-cream stock, LED-glow chrome, foil, decal).

### Implementation tells

A component is doing the principle right when:

- It has visible separation from the page (shadow, hard border, contrast, or a distinct surface treatment).
- Its edges are decisive — clipped, torn, stamped, or framed. Not a CSS rectangle drifting into the page.
- A reader could imagine peeling it off the wall as a single physical object.
- Removing it leaves a clean rectangle of "wall" where it was — not a faded ghost.

A component is doing the principle wrong when:

- It feels embedded in the page (no shadow, no edge, soft tint).
- It looks like a web `<div>` with `background-color`.
- Its boundaries are ambiguous (where does the component end and the page begin?).
- The page texture continues through the component instead of being interrupted by it.

### Two register families

Components belong to one of two surface registers on the wall:

1. **Paper posters** — flyers, warnings, hand-stamped notices, torn show bills. Cream/paper-cream substrate. Hard ink. Stamps, sprays, dotted folds. Banners, callouts, lede panels, NPC stat blocks, gear entries, the design-guide chrome.
2. **Digital displays** — LED tickers, status panels, HUD readouts, AP indicators. Saturated coloured fills with crisp reverse-out type. Glow at the edges (suggested by light bg-mix, not literal glow filters). Outcome ladder chips, AP cost chips, skill-card tabs, alert callout fills.

Cards bridge the two: dark-fill specialty cards lean digital-display; cream-fill skill cards lean paper-poster. A single book uses both registers — that's the texture of Dimm City — but a given **component** picks one and stays in it.

---

## III. Creaturepunk Aesthetic

The setting is documented at length in [knowledge:print/design/creaturepunk-design-guide]. The short version, condensed for this constitution:

> **Tagline:** "It ain't chrome. It ain't clean."
> Creaturepunk is **hostile, improvised, urban, cold, aggressive, dirty.** Not friendly. Not polished. Not warm. Not luxurious. Not decorative.

### The four registers

Creaturepunk is **part future tech, part ancient magic, part landfill, part wonderland.** Every component is a blend of these four registers in deliberate proportions. The mix is not aesthetic ornament — it's the **identity signal** of who/what made the object and where it sits in Dimm City's stratigraphy.

| Register | Reads as | Tells | Token family |
|---|---|---|---|
| **Future tech** | LED indicators, HUD panels, digital displays, brushed metal, circuit traces, neon signal. Lit-from-within, edges are sharp and cut, fills are saturated and crisp. | sharp polygon clips, reverse-out crisp type, top-edge highlight (LED-rim), saturated chip fills, mono caps labels | `--brand-magenta/cyan/yellow/violet`, `--hud-blue/blue-dark`, AP-chip / outcome-chip / skill-tab chrome |
| **Ancient magic** | Mineral facets, refractive crystals, faceted geometric chrome, arcane runes, smoky-quartz depth. Cold colour temperature, faceted geometry, multi-stroke depth. | faceted/lozenge clip-paths, mineral-violet/aqua/citrine accents, geometric ornaments, multi-stop tonal depth (light-mid-deep) | `--crystal-amethyst/aqua/citrine`, mineral-violet undertones |
| **Landfill** | Rust drips, torn paper edges, exposed adhesive, scratched tape, oil stains, smoke-burn. Warm decay, oxidised metal, dried blood, sulphur-burn. | torn-paper edges, rough/irregular cuts, paper-stain tints, rust drips, smudge/grime overlays | `--rust`, `--blood`, `--orange`, `--amber`, `--crimson`, `--deep-rust`, `--paper-stain`, `--paper-aged` |
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

Example: a top-edge LED highlight (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.18)`) belongs on **Augmerc / Wirephreak / Cybersurgeon / Technosorcerer** chrome (future-tech high). It does NOT belong on **Gutterdruid** — the gutterdruid card is torn paper with fungi-glow seeping through, not a polished tech panel.

Example: a torn-paper edge (irregular clip-path, slightly rotated) belongs on **Gutterdruid / Proxy** (landfill high). It does NOT belong on **Augmerc / Cybersurgeon** — clinical tech doesn't tear.

### Controlled chaos — the 80/20 rule

- **80% of the page** is structurally reliable: text frames, margins, table alignment, reading order, page furniture.
- **20% can misbehave**: rotated stamps, broken banners, offset tabs, hard colour hits, asymmetric ornament.

Apply disruption to *display elements*, never to *reading surfaces*. Safe places for chaos: chapter openers, section banners, AP tags, pull quotes, image crops. Stable: body copy, tables, rules text, lists, page numbers.

The mistake to avoid: confusing **chaotic** with **hard to use**. Creaturepunk pages should feel **unstable while the information remains easy to scan.**

### Controlled chaos — the 80/20 rule

- **80% of the page** is structurally reliable: text frames, margins, table alignment, reading order, page furniture.
- **20% can misbehave**: rotated stamps, broken banners, offset tabs, hard colour hits, asymmetric ornament.

Apply disruption to *display elements*, never to *reading surfaces*. Safe places for chaos: chapter openers, section banners, AP tags, pull quotes, image crops. Stable: body copy, tables, rules text, lists, page numbers.

The mistake to avoid: confusing **chaotic** with **hard to use**. Creaturepunk pages should feel **unstable while the information remains easy to scan.**

### Anti-patterns

Do not drift into:

- Clean corporate manual layouts
- Warm parchment fantasy styling
- Smooth chrome cyberpunk glamour
- Full-page black neon web aesthetics
- Randomized chaos that hurts scan speed
- Web-2.0 sheen — large gradients, gloss, drop-shadow bevels, polished glass
- Every page using the same tilt-and-banner trick
- Too many textures making the page muddy
- Accent colours competing instead of supporting hierarchy
- Decorative aggression with no focal point

---

## IV. Hard Architectural Constraints

These are non-negotiable. Violations rate the work AWKWARD or BROKEN regardless of visual appearance.

### Selector ownership

- `.page` / `.chapter` selectors are reserved for **counters, page-templates, TOC IDs, and per-instance positioning**. They are NOT a place to hang component styles.
- Component visuals live exclusively in `dc-components.css` under the `.dc-*` namespace (kebab-case).
- `columns: N` rules live exclusively in `page-templates.css` (the columns-ownership rule).
- `@page` directive class args are limited to **page-template names** (`.chapter-start`, `.card-grid`, etc.).

### Naming

- `.dc-component-name` lowercase-kebab.
- Tokens: `--<scope>-<role>` (e.g., `--dc-card-tab-bg`, `--brand-magenta`, `--augmerc-accent`).
- Macros: `@section .dc-X` for reusable visual components. `@page .TEMPLATE-NAME` for page-fitting concerns.

### Counter strategy

`@chapter` emits the wrapper element and increments the counter. Pages inherit chapter numbering via Paged.js cascade. **Never hand-apply `.chapter-NN`** — that bypasses the counter and is a known footgun.

### Cascade discipline (per [docs/contextual-cascade-principle.md](./contextual-cascade-principle.md))

- Component styles in `dc-components.css` expose `--dc-X-*` token surfaces with sensible defaults.
- Per-book overrides in `fg-overrides.css` set those tokens via **natural selector chains** (chapter id → page template → section component).
- Override files NEVER carry bare `.dc-*` rules — only context-scoped selectors (`#ch-X .dc-Y`, `.page.Z .dc-Y`, `.section.dc-X`).
- Section variants ride on `@section .dc-X` only. No utility variant classes (`.dc-accent-X`, `.variant-Y` are forbidden).
- Authors NEVER write per-element class attributes for styling (`{.dc-warning}` on a paragraph is forbidden).

---

## V. Review Requirement

Before any commit to `dc-components.css`, `dc-tokens.css`, `page-templates.css`, or any markdown file under `examples/dc-design-guide/`:

**Three diverse experts must all agree** the work is at-bar:

1. **CSS architect** — cascade discipline, token contracts, naming, no violations.
2. **Print engineer** — POD-safe (SWOP coated v2 gamut, TAC ≤ 280%, contrast ≥ 4.5:1 for body text, hairlines ≥ 0.5pt).
3. **TTRPG author / book designer** — does this meet the D&D 5e / PF2e / Mothership / Blades quality bar?

The canonical print-layout review prompt is at [agent:print/print-layout-reviewer]. Use it as a quality gate post-edit, not just a verifier.

A **GO** from all three is required to commit. A **FIX** or **NO-GO** from any blocks the commit.

---

## VI. Documentation Layer

- This file (`constitution.md`) is the project-level north star.
- [knowledge:print/design/creaturepunk-design-guide] is the canonical aesthetic reference.
- [memory:dimm-city-design-guide-constitution-2026-05-23-the-dc-design-gui] is the AKM hot-recall of these principles.
- [docs/contextual-cascade-principle.md](./contextual-cascade-principle.md) is the canonical cascade-discipline doc.
- The design guide's own markdown source files (`examples/dc-design-guide/0*.md`, `30*.md`) ARE the user-facing documentation.

If those documents disagree, the project-level docs (this file + contextual-cascade-principle.md) take precedence. Update the AKM memory to match.
