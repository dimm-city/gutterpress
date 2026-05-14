@chapter #ch-fg-components .fg-components .chapter-02 ch="2"

# Field Guide Components

@lede
Components used in the Dimm City Field Guide — gear entries, definition blocks, sidebar boxes, and the dashed rule divider. These elements handle the prose-heavy, reference-dense pages that the core DC component library does not cover.
-lede

> **Component pattern:** `.dc-prose-panel` is the small shared shell for compact prose boxes in this family. `.dc-definition-block` and `.dc-sidebar-box` are thin concrete variants layered on top of it. `.dc-sidebar` and `.dc-human-callout` remain separate components with their own layout/content rules.

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
@gear-card
### Ripper Blades Mk.II

*Melee. Cyberware implant. Pair.*

Damage 1d8+STR. On a crit, the target bleeds for 1d4 at the start of
their next turn. Retractable — no visible profile when sheathed.
Requires Cybersurgeon installation.
@end-gear-card

---

@gear-card
### Ghost-Wire Whip

*Melee. Monofilament. Reach 2.*

Damage 1d6+AGI. Ignores armor on a roll of 5+. Folding grip —
concealable under a jacket. Cuts non-powered barriers on a hit of 10+.
@end-gear-card
```

---

## Callout Class Names — Field Guide vs Design Guide

Use the design-guide forms documented in `03-components.md`: `.dc-alert` is the alert shell, and dc-prefixed variants such as `.dc-vibe-callout`, `.dc-origin-callout`, `.dc-gear-callout`, and `.dc-dm-note` layer on top of it. Avoid unprefixed legacy callout names in new guide examples. If a field-guide page still needs book-specific treatment such as a forced full-height gear box, add that as a book-level rule rather than switching back to a legacy class.

```markdown
> [!GEAR]
> **Ripper Blades (Mk II)**
>
> Melee. Damage 1d8+STR.
```

---

## Component Authoring Quick Reference

| Component | Authoring method | CSS class |
|---|---|---|
| Dashed Rule Divider | `---` (standard markdown) | `dc-dashed-rule` (auto) |
| Definition Block | `@definition ... @end-definition` | `dc-prose-panel dc-definition-block` |
| Sidebar Box | `@sidebar-box ... @end-sidebar-box` | `dc-prose-panel dc-sidebar-box` |
| Sidebar | `@sidebar ... @end-sidebar` | `dc-sidebar` |
| Procedure | `@procedure ... @end-procedure` | `dc-steps` |
| Gear Entry | `@gear-card` … `@end-gear-card` | `dc-gear-entry` |
| Art Bottom Pin | `![img](https://placehold.co/1349x842/png?text=Art){.dc-art-bottom}` or `@no-break` wrapper | `dc-art-bottom` |
| Legacy note: Ability Container | Use `@skill` instead — `:::: ability` has no active CSS | — |

---

## See It In Action

These examples show the above field guide components rendered in real book pages using actual Dimm City Field Guide content.

- [Specialty Overview](#ch-example-specialty-overview) — definition blocks and sidebar boxes in specialty intros
- [Rules & Mechanics](#ch-example-rules) — sidebar boxes for rules etiquette, dashed rule dividers between entries
- [Dream Master Pages](#ch-example-dm-npcs) — definition blocks for NPC type summaries
- [Gear & Tech](#ch-example-gear-tech) — gear entries, dashed rule separators, gear callouts in weapon lists
