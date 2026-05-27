# DC Design Guide — Components & Color Palette Reference

---

## Macro → Class Cross-Reference

This table maps the author-facing syntax to the CSS classes emitted at render time.
Authors write on the left; the right-hand columns show what appears in the DOM.

| Author writes | Macro / trigger | Emitted class(es) |
|---|---|---|
| `@lede … @end-lede` | DC plugin | `.dc-intro` |
| `@section .dc-X` | markdown-it-paged | `.section.dc-X` |
| `@page .NAME` | markdown-it-paged | `.page.NAME` |
| `@block variant=panel` | DC plugin | `.dc-block.dc-panel` |
| `@block variant=slate` | DC plugin | `.dc-block.dc-slate` |
| `@block variant=shard` | DC plugin | `.dc-block.dc-shard` |
| `@block variant=codex` | DC plugin | `.dc-block.dc-codex` |
| `@specialty .NAME` | DC plugin | `.dc-specialty.NAME` (scope parent for specialty cards) |
| `@skill … @end-skill` | DC plugin | `.dc-skill-card` |
| `@learning-path … @end-learning-path` | DC plugin | `.dc-path-shell` + `.dc-learning-path` |
| `@chapter NAME` | markdown-it-paged | `<div class="chapter" data-chapter-label="NAME">` |
| `> [!VIBE]` | GFM alert + DC plugin | `.dc-vibe-callout` |
| `> [!DM]` | GFM alert + DC plugin | `.dc-dm-note` |
| `> [!ORIGIN]` | GFM alert + DC plugin | `.dc-origin-callout` |
| `> [!GEAR]` | GFM alert + DC plugin | `.dc-gear-callout` |
| `> [!NOTE]` | GFM alert | `.dc-note` |
| `> [!WARNING]` | GFM alert | `.dc-note.warning` |

---

## Supported Components

### Callouts & Notes
- `.dc-alert` — warning/info callout block
- `.dc-alert-label` — label chip on alerts
- `.dc-note` / `.dc-note.warning`
- `.dc-callout`
- `.dc-vibe-callout`, `.dc-human-callout`, `.dc-origin-callout`, `.dc-gear-callout`
- `.dc-dm-note`
- `.dc-prose-panel`

#### Callout Decision Tree

Use this to choose the right callout type before reaching for a class name.

```
1. Who sees it?
   └── GM only → dc-dm-note
   └── Player-facing → continue ↓

2. What register?
   └── Atmosphere / narrative → dc-vibe-callout
   └── World / setting lore  → dc-origin-callout
   └── Gear & equipment      → dc-gear-callout
   └── Rules / mechanics     → continue ↓

3. How urgent?
   └── Caution / warning          → dc-note.warning
   └── Informational              → dc-note
   └── General rules callout      → dc-alert
```

### Block Components (via `@panel`, `@slate`, `@shard`, `@codex`)
- `.dc-block` — base block container
- `.dc-block.dc-panel` — data/rules panel
- `.dc-block.dc-slate` — authority/authority-voice
- `.dc-block.dc-shard` — flavor/atmosphere
- `.dc-block.dc-codex` — reference/glossary

### Sidebars
- `.dc-sidebar` / `.dc-sidebar.inset`
- `.dc-sidebar-box`

### Skill Cards
- `.dc-skill-card` / `.dc-skill-card.two-col` / `.dc-skill-card.highlight`
- `.dc-skill-card-cont` — card container
- `.dc-ability` / `.dc-ability-text`
- `.dc-ap` — action point cost (`.free`, `.reduced`, `.increased`, `.var`, `.standard`, `.special`)
- `.dc-outcome-row` (`.hit`, `.miss`, `.crit`, `.fail`, `.mixed`)
- `.dc-outcomes` / `.dc-outcomes-label` / `.dc-outcome-key` / `.dc-outcome-text`

> These sub-elements are emitted by the plugin — authors do not write them directly:
> `dc-card-tab`, `dc-tab-title`, `dc-tab-tier`, `dc-card-body`, `dc-card-inner`,
> `dc-card-cont-marker`, `dc-card-fwd-marker`

### Specialty System
- `.dc-specialty` + variant (`.augmerc`, `.proxy`, `.streetwarden`, `.gutterdruid`, `.cybersurgeon`, `.wirephreak`, `.technosorcerer`, `.etherlock`, `.dualist`, `.generalist`)
- `.dc-specialty-intro`
- `.dc-specialty-card` — individual specialty entry
- `.dc-specialty-art` — full-bleed art panel
- `.dc-path-shell` — learning path shell
- `.dc-path-block` / `.dc-learning-path.dc-path-block`
- `.dc-path-sticker` / `.dc-path-subtitle`
- `.dc-classtag` + specialty variant — class identity dots

### NPC / Stat Blocks

`.dc-npc-stat`: for narrative enemy/ally entries with flavor quotes and trait sections.
`.dc-stat-grid`: for compact at-a-glance numerical stat grids.
These are separate components — not variants of each other.

- `.dc-stat` / `.dc-stat-grid` / `.dc-stat-class`
- `.dc-stat-name`
- `.dc-npc-stat`

> These sub-elements are emitted by the plugin — authors do not write them directly:
> `dc-stat-cell`, `dc-stat-cell-key`, `dc-stat-cell-val`, `dc-stat-head`, `dc-stat-line`

### Typography Decorations
- `.dc-chevron` — chevron banner heading
- `.dc-spray` — spray-paint heading style
- `.dc-sub-header`
- `.dc-pullquote`
- `.dc-intro` — lede/intro text panel
- `.dc-flavor` — italic flavor text
- `.dc-tape` — adhesive tape label
- `.dc-sticker` / `.dc-sticker-ref` / `.dc-stickers`
- `.dc-definition-block`
- `.dc-terms`
- `.dc-steps`

### Gear & Distances
- `.dc-gear-entry` / `.dc-gear-callout`
- `.dc-distance-tags` / `.dc-dist-tag` / `.dc-dist-name` / `.dc-dist-ap`

### Layout Helpers
- `.dc-columns`
- `.dc-rows`
- `.dc-card-grid`
- `.dc-at-a-glance-card` / `.dc-at-a-glance-cards`
- `.dc-citizen-walkthrough.two-column`

Note: `.dc-accent-X` utility classes are referenced in comments but not implemented. Use the contextual cascade pattern instead (see `docs/contextual-cascade-principle.md`).

### Inline Markers
- `.dc-arrow`
- `.dc-tag`
- `.dc-roll-the-die`
- `.dc-roll-lucid` / `.dc-roll-surreal`
- `.dc-dashed-rule`

### Images
- `.dc-img-float-left` / `.dc-img-float-right`
- `.dc-portrait`
- `.dc-art-bottom`

### Cover Page
- `.dc-cover-page` / `.dc-cover-layout` / `.dc-cover-body`
- `.dc-cover-bigword` / `.dc-cover-num` / `.dc-cover-strap` / `.dc-cover-meta-row`

Note: the `rgba()` vignette overlays will fail PDF/X-1a preflight (required by Ingram). For Ingram submission, use `dc-tokens-print.css` pre-composited overrides. DTRPG accepts the default PDF output.

### TOC
- `.dc-toc` / `.dc-toc-page` / `.dc-toc-row` / `.dc-toc-title`

---

## Color Palette Pillars

### Surface / Paper
| Token | Value | Role |
|---|---|---|
| `--bg` | `#c8c5bf` | Ash-concrete page background |
| `--concrete-pale` | `#dcdad5` | Pale concrete — cold-grey panels |
| `--paper-cream` | `#f0eee9` | Light flyer-stock — primary text surface |
| `--paper-light` | `#e2ded7` | Secondary layered panel surface |
| `--paper-aged` | `#c8c2b8` | Weathered grey — decay register |
| `--paper-stain` | `#b0a89c` | Deep stain — dark inset wells |

### Ink / Text
| Token | Value | Role |
|---|---|---|
| `--ink` | `#1a1512` | Near-black with red bias |
| `--ink-dark` | `#2b231d` | Secondary heading weight |
| `--ink-smoke` | `#4d4339` | Body emphasis mid-tone |
| `--ink-dust` | `#665b4e` | Muted body/captions |

### Industrial Warm (reds, oranges)
| Token | Value | Role |
|---|---|---|
| `--crimson` | `#e1261c` | PMS Red 032 — POD-safe signal red |
| `--blood` | `#901a12` | Oxidised arterial — primary accent |
| `--orange` | `#d4500a` | Burnt circuit-board |
| `--orange-deep` | `#a03808` | Deeper orange for small text on fill |
| `--rust` | `#b23a12` | Burnt rebar edge |
| `--amber` | `#7a5a20` | Sulfur-scorched brass |
| `--amber-dark` | `#5c3c10` | Charred amber |
| `--deep-rust` | `#6a1a08` | Shadow rust |

### Brand Cyber
| Token | Value | Role |
|---|---|---|
| `--brand-magenta` | `#c026d3` | Dimm.city signature cyber-magenta |
| `--brand-magenta-deep` | `#8a0a9a` | Small-text-on-fill safe version |
| `--brand-cyan` | `#00bcd4` | Neon-cyan — signal/wire |
| `--brand-yellow` | `#ffd700` | Brand radiant gold |
| `--brand-violet` | `#7030b8` | Cyber-violet — ritual+tech |
| `--ink-bruise` | `#28143c` | Deep purple atmosphere (semantically a dark brand-violet; grouped in Shadow/Atmosphere for legacy reasons) |

### HUD / Interface
| Token | Value | Role |
|---|---|---|
| `--hud-blue` | `#1f6f94` | Teal-cyan mid HUD |
| `--hud-blue-dark` | `#14516e` | Deep teal — borders, H2 text |
| `--hud-blue-bright` | `→ brand-cyan` | Neon accent alias |
| `--hud-blue-dim` | `#7ab8d0` | Visible cream panel tint |
| `--hud-magenta` | `→ brand-magenta` | Alias |
| `--hud-panel` | `#eeece8` | Neutral cream — callouts |

### Ecological / Organic
| Token | Value | Role |
|---|---|---|
| `--fungi-glow` | `#c8e040` | Bioluminescent yellow-green |
| `--fungi-mid` | `#6aa030` | Luminous lichen mid (reserved) |
| `--fungi-rot` | `#2a4015` | Deep moldering green — large fill only |

### Crystal / Mineral
| Token | Value | Role |
|---|---|---|
| `--crystal-amethyst` | `#6a3a8a` | Deep mineral violet |
| `--crystal-aqua` | `#4a98a8` | Pale crystalline aquamarine |
| `--crystal-citrine` | `#b89a3a` | Burnt mineral gold (reserved) |

### Specialty Accents
| Specialty | Accent | Mid | Dark |
|---|---|---|---|
| Augmerc | `--brand-magenta` (`#c026d3`) | `--augmerc-mid` `#9a1896` | `#8a1a90` |
| Proxy | `--orange` (`#d4500a`) | `--proxy-mid` `#7a3008` | `#3d1a00` |
| Streetwarden | `#4db840` | `--streetwarden-mid` `#347828` | `#1a3d10` |
| Gutterdruid | `--fungi-glow` (`#c8e040`) | `--gutterdruid-mid` `#4d6020` | `#2a3408` |
| Cybersurgeon | `#a8b4b8` | `--cybersurgeon-mid` `#606870` | `#303840` |
| Wirephreak | `--brand-cyan` (`#00bcd4`) | `--wirephreak-mid` `#006878` | `#003a40` |
| Technosorcerer | `--brand-violet` (`#7030b8`) | `--technosorcerer-mid` `#4a1878` | `#200a38` |
| Etherlock | `--brand-yellow` (`#ffd700`) | `--etherlock-mid` `#8a6a00` | `#3d3000` |
| Dualist | `--crystal-aqua` (`#4a98a8`) | `--dualist-mid` `#2a6878` | `#143a4a` |
| Generalist | `--crystal-amethyst` (`#6a3a8a`) | `--generalist-mid` `#503070` | `#1e0e2e` |

### Tier Badges
| Token | Value | Role |
|---|---|---|
| `--tier-bronze` | `#8a5c28` | Tier 1 — salvage |
| `--tier-gold` | `#b8921a` | Tier 2 — tarnished brass |
| `--tier-silver` | `#a8b4b8` | Tier 3 — cyan-tinged chrome |
