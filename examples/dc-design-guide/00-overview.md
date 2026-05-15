@chapter #ch-overview .overview .chapter-01 ch="1"

# Design System Overview

@lede

This guide is both the living documentation of the Dimm City design system *and* a working demonstration. Every specimen on these pages is live — rendered through the same `css/index.css` as the Field Guide. Change a token in `css/tokens.css` (or `css/project-overrides.css` for project-specific overrides) and the specimen updates on the next preview refresh.

@end-lede

## How This Guide Is Organized

The guide is split into two parts.

**Part 1 — Implementation Reference** covers the token tables, CSS specifications, syntax reference, and code examples. This is what you reach for when building: look up a color token, copy a component pattern, or check what markdown syntax a container expects.

**Part 2 — Field Guide in Action** shows real Field Guide pages rendered through the same CSS. Rather than fabricated specimens, these are actual book pages — chapter openers, specialty profiles, gear spreads, stat block pages — so you can see how all the pieces come together in a real book layout.

## Design Philosophy

- **Cream pages, dark ink** — the substrate is print, not screen. All spacing, color, and type decisions are validated against paper, not a monitor.
- **Two accent registers** — Creaturepunk fire (`--crimson`, `--orange`, `--rust`) for physical content, lore, and danger; HUD digital (`--hud-blue`, `--hud-magenta`) for cybernetics, tech overlays, and system chrome.
- **Components are additive** — the base prose layer needs no class; every component class adds chrome on top of clean flowing text.

## CSS Architecture

@no-break

| File | Purpose |
|------|---------|
| `css/tokens.css` | `:root` tokens, `@font-face` declarations, html/body baseline, and global element resets |
| `css/components.css` | All `.dc-*` and `.pmd-*` component styles — base rules plus variant overrides |
| `css/page-templates.css` | All `columns:N` rules, `.page.*` layout shells, paged wrapper scaffolding, and print utilities |
| `css/page-rules.css` | `@page` declarations, named pages, Paged.js counter fixes |
| `css/guide.css` | Design-guide-specific scaffolding, specimen chrome, and guide-only footer |

All five are imported in order by `css/index.css`: `tokens.css` → `components.css` → `page-templates.css` → `page-rules.css` → `guide.css`.

@end-no-break

## How Components Work

Most DC components are authored with markdown containers or plugin markers. Raw HTML is reserved for the rare structures that still do not have a markdown/plugin form. The Dimm City print-md plugin adds `@skill`, `@learning-path`, `@specialty`, `@sidebar`, `@procedure`, and related block markers for structured game content.

```markdown
<!-- 1. GFM alert / markdown component -->
> [!NOTE]
> You can always spend 1 AP to delay.

<!-- 2. markdown-it-container shorthand -->
@lede
This is a lede rendered via the container plugin.
:::

<!-- 3. Dimm City plugin markers -->
@procedure
1. Spend 2 AP.
2. Boost your next action die by one step.
@end-procedure
```

## Customizing the Brand

@no-break

`css/tokens.css` contains the canonical `:root` token list. For project-specific retheming, copy the tokens you need into `css/project-overrides.css` and let that file import last through `css/index.css`.

**Before (default DC palette):**

```css
:root {
  --bg:           #d4d4d4;   /* page background — light cool gray */
  --paper-cream:  #f5f0e6;   /* warm cream — primary card surface */
  --crimson:      #d41200;   /* primary accent — vivid banner red */
  --font-display: 'lixdu', 'Tomorrow', sans-serif;
  --font-body:    'Titillium Web', Georgia, sans-serif;
}
```

**After (hypothetical alternate theme):**

```css
:root {
  --bg:           #e8e4dc;   /* warmer parchment page */
  --paper-cream:  #faf6ee;   /* lighter cream cards */
  --crimson:      #1b4f8a;   /* swap fire for HUD blue as primary */
  --font-display: 'Tomorrow', sans-serif;
  --font-body:    'Titillium Web', Georgia, sans-serif;
}
```

@end-no-break

> [!NOTE]
> This guide re-renders every time `print-md preview` is running. If a component style changes in `css/components.css`, its specimen updates on the next preview refresh — no separate stylesheet to maintain.
