@chapter #ch-overview .overview .chapter-01

# Design System Overview

::: wrapper {.dc-intro}
This guide is both the living documentation of the Dimm City design system *and* a working demonstration. Every specimen on these pages is live — rendered through the same `css/index.css` as the Field Guide. Change a token in `dc-brand.css` and the specimen updates on the next preview refresh.
:::

## Design Philosophy

- **Cream pages, dark ink** — the substrate is print, not screen. All spacing, color, and type decisions are validated against paper, not a monitor.
- **Two accent registers** — Creaturepunk fire (`--crimson`, `--orange`, `--rust`) for physical content, lore, and danger; HUD digital (`--hud-blue`, `--hud-magenta`) for cybernetics, tech overlays, and system chrome.
- **Components are additive** — the base prose layer needs no class; every component class adds chrome on top of clean flowing text.

## CSS Architecture

| File | Purpose |
|------|---------|
| `css/dc-brand.css` | Brand tokens, font faces, base typography, and all DC component styles |
| `css/page-rules.css` | `@page` rules, named pages, Paged.js chrome, and chapter counter resets |
| `css/content-templates.css` | Shared content templates: covers, TOC, stat blocks, and learning-path chrome |
| `css/guide.css` | Design-guide-specific overrides: fenced code blocks and syntax callout styles |

All four are imported in order by `css/index.css`. The book-layer (`field-guide/css/`) can import `dc-brand.css`, `page-rules.css`, and `content-templates.css` directly and add only its own delta on top.

## How Components Work

Most DC components are raw HTML blocks authored directly in markdown. A few use markdown-it-container `:::` shorthand. The Dimm City print-md plugin adds `@skill`, `@learning-path`, and `@specialty` block markers for structured game content.

```markdown
<!-- 1. Raw HTML block — most DC components -->
<div class="dc-callout">
  <strong>Reminder:</strong> You can always spend 1 AP to delay.
</div>

<!-- 2. markdown-it-container shorthand -->
::: dc-note
This is a note rendered via the container plugin.
:::

<!-- 3. Dimm City plugin markers -->
@skill Overclock {.dc-ability}
Cost: 2 AP — Boost your next action die by one step.
```

## Customizing the Brand

`css/dc-brand.css §1` contains all `:root` tokens. Change any of the variables below to retheme the entire system — every rule in dc-brand.css, page-rules.css, content-templates.css, and guide.css inherits from these.

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

## Keeping the Guide in Sync

This guide re-renders every time `print-md preview` is running. If a component style changes in `dc-brand.css`, its specimen on these pages updates automatically — there is no separate stylesheet to maintain, and no manual sync step required.
