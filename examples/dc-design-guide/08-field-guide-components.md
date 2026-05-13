@chapter #ch-fg-components .fg-components .chapter-02 ch="2"

# Field Guide Components

:::lede
Components used in the Dimm City Field Guide — gear entries, definition blocks, sidebar boxes, colophon data, and the dashed rule divider. These elements handle the prose-heavy, reference-dense pages that the core DC component library does not cover.
:::

---

## Dashed Rule Divider

Red dashed `<hr>` for gear lists, NPC blocks, and rules section breaks. CSS applies the style globally to all `<hr>` elements. **Use:** gear entries, NPC separators, rules section breaks.

```markdown
Field Rations × 3
---
Trauma Kit
---
Signal Jammer (single-use)
```

---

## Definition Block

1–3 sentence italic callout: warm-cream background + red left border. **Use:** NPC type summaries, item category descriptions, ability class definitions. (Distinct from `dc-note` — no heading; `dc-pullquote` — decorative only.)

```markdown
@definition
Augmercs are muscle for hire. Street enforcers, deniable contractors,
close-combat specialists — the difference is gear, grafts, and how much
of them is still original flesh.
@end-definition
```

---

## Sidebar Box

Callout with H4 heading + internal dashed divider + cream background. **Use:** rules etiquette, standalone reference blocks, any callout needing its own visual boundary. (Distinct from `dc-note` — no heading; `dc-pullquote` — decorative only.) H4 at top, then `---`, then body:

```markdown
@sidebar-box
#### Dice Etiquette

---

Roll your dice in the open. Both players should be able to see every
roll clearly — hidden dice undermine the shared fiction. If a die
lands off the table, reroll it.
@end-sidebar-box
```

---

## Gear Entry

H3 item name (crimson display font) + italic tagline + mechanics prose. Entries separated by `---`. Tagline paragraph must be purely italic (`*...*`); use `.dc-gear-entry-tagline` if you need the style without that constraint. **Use:** appendices, gear chapters, weapon lists.

```markdown
:::wrapper {.dc-gear-entry}
### Ripper Blades Mk.II

*Melee. Cyberware implant. Pair.*

Damage 1d8+STR. On a crit, the target bleeds for 1d4 at the start of
their next turn. Retractable — no visible profile when sheathed.
Requires Cybersurgeon installation.
:::

---

:::wrapper {.dc-gear-entry}
### Ghost-Wire Whip

*Melee. Monofilament. Reach 2.*

Damage 1d6+AGI. Ignores armor on a roll of 5+. Folding grip —
concealable under a jacket. Cuts non-powered barriers on a hit of 10+.
:::
```

---

## Colophon Block

`<dl>`/`<dt>`/`<dd>` data block: bold orange monospace labels left column, values right, hairline rule separators. **Raw HTML only** — use solely on colophon or credits page. **Use:** edition info, legal notices, production credits.

```html
<dl class="dc-colophon">
  <dt>Edition</dt><dd>First Printing, 2026</dd>
  <dt>Imprint</dt><dd>Dimm City Press</dd>
  <dt>Built with</dt><dd>print-md + Paged.js</dd>
  <dt>License</dt><dd>MPL-2.0</dd>
</dl>
```

---

## Callout Class Names — Field Guide vs Design Guide

Always use `dc-` prefixed forms (`dc-vibe-callout`, `dc-origin-callout`, `dc-human-callout`, `dc-gear-callout`) — documented fully in `03-components.md`. Short forms (`vibe-callout` etc.) exist in `shared.css` but have slightly different padding. **Key difference:** `.gear-callout` applies `min-height: 3.5in` unconditionally; `.dc-gear-callout` does not — if the full-height treatment is needed, add a book-specific CSS rule rather than inline style.

```markdown
:::wrapper {.dc-gear-callout}
:::
```

---

## Component Authoring Quick Reference

| Component | Authoring method | CSS class |
|---|---|---|
| Dashed Rule Divider | `---` (standard markdown) | `dc-dashed-rule` (auto) |
| Definition Block | `@definition ... @end-definition` | `dc-definition-block` |
| Sidebar Box | `@sidebar-box ... @end-sidebar-box` | `dc-sidebar-box` |
| Sidebar | `@sidebar ... @end-sidebar` | `dc-sidebar` |
| Procedure | `@procedure ... @end-procedure` | `dc-steps` |
| Gear Entry | `:::wrapper {.dc-gear-entry}` | `dc-gear-entry` |
| Colophon Block | Raw HTML `<dl class="dc-colophon">` | `dc-colophon` |
| Art Bottom Pin | `![img](https://placehold.co/1349x842/png?text=Art){.dc-art-bottom}` or `:::wrapper {.dc-art-bottom}` | `dc-art-bottom` |
| Legacy note: Ability Container | Use `@skill` instead — `:::: ability` has no active CSS | — |

---

## See It In Action

These examples show the above field guide components rendered in real book pages using actual Dimm City Field Guide content.

- [Front Matter & TOC](#ch-example-front-matter) — colophon block on credits page
- [Specialty Overview](#ch-example-specialty-overview) — definition blocks and sidebar boxes in specialty intros
- [Rules & Mechanics](#ch-example-rules) — sidebar boxes for rules etiquette, dashed rule dividers between entries
- [Dream Master Pages](#ch-example-dm-npcs) — definition blocks for NPC type summaries
- [Gear & Tech](#ch-example-gear-tech) — gear entries, dashed rule separators, gear callouts in weapon lists
