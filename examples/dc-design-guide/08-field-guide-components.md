@chapter #ch-fg-components .fg-components .chapter-02 data-ch="2"

# Field Guide Components

::: wrapper {.dc-intro}
Components used in the Dimm City Field Guide — gear entries, definition blocks, sidebar boxes, colophon data, and the dashed rule divider. These elements handle the prose-heavy, reference-dense pages that the core DC component library does not cover.
:::

---

## Dashed Rule Divider

A red dashed horizontal rule. Lightweight entry separator for gear lists, NPC blocks, and rules section breaks. Distinct from tape dividers, which carry text labels and span the full column.

**Syntax** — standard markdown `---`. The CSS applies the red dashed style globally to all `<hr>` elements.

```markdown
Field Rations × 3

---

Trauma Kit

---

Signal Jammer (single-use)
```

**Specimen**

Field Rations × 3

---

Trauma Kit

---

Signal Jammer (single-use)

---

## Definition Block

A short 1–3 sentence italic definition callout for NPC type summaries, item category descriptions, and ability class definitions. Has a warm-cream background and a red left border. Distinct from `dc-note` (rules clarification, paper-light background) and `dc-pullquote` (decorative excerpt with no structural role).

**Syntax** — container wrapper with `.dc-definition-block`:

```markdown
::: wrapper {.dc-definition-block}
Augmercs are muscle for hire. Street enforcers, deniable contractors,
close-combat specialists — the difference is gear, grafts, and how much
of them is still original flesh.
:::
```

**Specimen**

::: wrapper {.dc-definition-block}
Augmercs are muscle for hire. Street enforcers, deniable contractors, close-combat specialists — the difference is gear, grafts, and how much of them is still original flesh.
:::

---

## Sidebar Box

A self-contained informational callout with its own bold heading, an internal dashed divider, and a cream background. Use for rules etiquette sections, standalone reference blocks, and any callout that needs its own visual boundary and a labeled header. Distinct from `dc-note` (no heading) and `dc-pullquote` (decorative, no heading).

**Syntax** — container wrapper with `.dc-sidebar-box`. Place an H4 heading at the top, follow it with `---`, then the body text:

```markdown
::: wrapper {.dc-sidebar-box}
#### Dice Etiquette

---

Roll your dice in the open. Both players should be able to see every
roll clearly — hidden dice undermine the shared fiction. If a die
lands off the table, reroll it.
:::
```

**Specimen**

::: wrapper {.dc-sidebar-box}
#### Dice Etiquette

---

Roll your dice in the open. Both players should be able to see every roll clearly — hidden dice undermine the shared fiction. If a die lands off the table, reroll it.
:::

---

## Gear Entry

A named equipment or item entry used in appendices, gear chapters, and weapon lists. Each entry consists of an H3 item name in the crimson display font, an italic one-liner flavor tagline immediately below, and body mechanics text. Entries are separated by `---` dashed rules.

**Syntax** — container wrapper with `.dc-gear-entry`. H3 for the name, italic paragraph for the tagline, plain paragraph for mechanics. The tagline paragraph must contain only italic text (`*...*` with no text outside the asterisks); add class `dc-gear-entry-tagline` if you need the styling without that constraint:

```markdown
::: wrapper {.dc-gear-entry}
### Ripper Blades Mk.II

*Melee. Cyberware implant. Pair.*

Damage 1d8+STR. On a crit, the target bleeds for 1d4 at the start of
their next turn. Retractable — no visible profile when sheathed.
Requires Cybersurgeon installation.
:::

---

::: wrapper {.dc-gear-entry}
### Ghost-Wire Whip

*Melee. Monofilament. Reach 2.*

Damage 1d6+AGI. Ignores armor on a roll of 5+. Folding grip —
concealable under a jacket. Cuts non-powered barriers on a hit of 10+.
:::
```

**Specimen**

::: wrapper {.dc-gear-entry}
### Ripper Blades Mk.II

*Melee. Cyberware implant. Pair.*

Damage 1d8+STR. On a crit, the target bleeds for 1d4 at the start of their next turn. Retractable — no visible profile when sheathed. Requires Cybersurgeon installation.
:::

---

::: wrapper {.dc-gear-entry}
### Ghost-Wire Whip

*Melee. Monofilament. Reach 2.*

Damage 1d6+AGI. Ignores armor on a roll of 5+. Folding grip — concealable under a jacket. Cuts non-powered barriers on a hit of 10+.
:::

---

## Colophon Block

A back-matter data block for edition info, legal notices, and production credits. Uses `<dl>`/`<dt>`/`<dd>` semantics — bold orange monospace labels in a fixed left column, inline values in the right column, separated by hairline rules.

**Note:** This component requires raw HTML for proper `dl`/`dt`/`dd` semantics. In the Field Guide, this usage is acceptable only on the colophon or credits page.

**Syntax** — raw HTML `<dl class="dc-colophon">`:

```html
<dl class="dc-colophon">
  <dt>Edition</dt><dd>First Printing, 2026</dd>
  <dt>Imprint</dt><dd>Dimm City Press</dd>
  <dt>Built with</dt><dd>print-md + Paged.js</dd>
  <dt>License</dt><dd>MPL-2.0</dd>
</dl>
```

**Specimen**

<dl class="dc-colophon">
  <dt>Edition</dt><dd>First Printing, 2026</dd>
  <dt>Imprint</dt><dd>Dimm City Press</dd>
  <dt>Built with</dt><dd>print-md + Paged.js</dd>
  <dt>License</dt><dd>MPL-2.0</dd>
</dl>

---

## Callout Class Names — Field Guide vs Design Guide

The design guide documents four callout components using `dc-` prefixed class names: `dc-vibe-callout`, `dc-origin-callout`, `dc-human-callout`, and `dc-gear-callout`. These are the canonical API — use them for all new content. They are documented fully in `03-components.md`.

Short-form names without the prefix — `vibe-callout`, `origin-callout`, `human-callout`, and `gear-callout` — are defined in `shared.css` as parallel definitions and render similarly but with slightly different padding values. Use the `dc-` prefix forms for all new content; migrate existing uses when editing those files.

**Important difference:** `.gear-callout` (short form) applies `min-height: 3.5in` unconditionally. `.dc-gear-callout` does not — use `.dc-gear-callout` with an explicit inline style when a minimum height is needed:

```markdown
::: wrapper {.dc-gear-callout style="min-height:3.5in"}
...
:::
```

Field-guide source files should be migrated to the `dc-` prefix forms. See `docs/field-guide-cleanup.md` for the full list of files requiring updates.

---

## Component Authoring Quick Reference

| Component | Authoring method | CSS class |
|---|---|---|
| Dashed Rule Divider | `---` (standard markdown) | `dc-dashed-rule` (auto) |
| Definition Block | `::: wrapper {.dc-definition-block}` | `dc-definition-block` |
| Sidebar Box | `::: wrapper {.dc-sidebar-box}` | `dc-sidebar-box` |
| Gear Entry | `::: wrapper {.dc-gear-entry}` | `dc-gear-entry` |
| Colophon Block | Raw HTML `<dl class="dc-colophon">` | `dc-colophon` |
| Art Bottom Pin | `![img](path){.dc-art-bottom}` or `::: wrapper {.dc-art-bottom}` | `dc-art-bottom` |
| Legacy note: Ability Container | Use `@skill` instead — `:::: ability` has no active CSS | — |
