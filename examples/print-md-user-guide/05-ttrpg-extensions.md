# TTRPG Extensions {#ch-ttrpg}

<div class="lede">Print-md ships no dedicated TTRPG plugin, no dice-notation parser, and no <code>@[...]</code> cross-reference syntax. What it does ship is a TTRPG starter template, a parchment-styled theme, and the same core toolkit every other chapter in this guide uses — tables, layout markers, and <code>markdown-it-attrs</code> classes are enough to build stat blocks, read-aloud boxes, and dice notation today.</div>

## There Is No `ttrpg` Plugin

An earlier version of this chapter told you to add this to your manifest:

```yaml
plugins:
  - ttrpg
```

**Do not do this.** No `ttrpg` package exists anywhere print-md looks — not in the bundled plugin registry, not on npm as something this project publishes. The build fails immediately, and the failure message tells you to install an arbitrary, unrelated package:

```
error: Failed to load plugin "ttrpg": Plugin "ttrpg" not found. Install it in your project:
  cd my-book && bun add ttrpg
```

Do not run `bun add ttrpg`. There is nothing at that package name that this project ships or endorses. The rest of this chapter shows what print-md actually provides for TTRPG content — all of it buildable right now, with no plugin and no install step.

## Start From the TTRPG Template

`print-md new` includes a `ttrpg` starter template that scaffolds a project with the bundled `ttrpg-supplement` theme already wired into the manifest:

```bash
print-md new "My Supplement" --template ttrpg
```

The theme sets a parchment page background, a serif display font for headings, and boxed blockquotes — no markdown syntax to learn, just a stylesheet. See Chapter 4, *Styling & Theming*, for the full list of built-in themes and how to override their CSS custom properties.

## Stat Blocks

A stat block is a table. Print-md's tables already page-break intelligently and repeat headers, which is what a stat block needs:

```markdown
| Attribute | Value |
| --------- | ----- |
| HP        | 12    |
| AC        | 14    |
| Damage    | 1d6+2 |
```

To keep a stat block from splitting across a page break and give it a boxed look, wrap it in `@section` / `@end-section` (Chapter 2 covers the full marker family) and add a CSS class. This guide's own `styles/guide.css` defines `.spec-block` — a bordered box with an accent top rule — and the table below uses it live, on this page, right now:

@section .spec-block

| Attribute | Value |
| --------- | ----- |
| HP        | 68    |
| AC        | 16    |
| Damage    | 2d6+4 |
| Speed     | 30 ft |

@end-section

```markdown
@section .spec-block

| Attribute | Value |
| --------- | ----- |
| HP        | 68    |
| AC        | 16    |
| Damage    | 2d6+4 |
| Speed     | 30 ft |

@end-section
```

`.spec-block` is one CSS rule in this guide's stylesheet, not a plugin. Copy it into your own project's CSS to get this exact look, or write your own.

## Read-Aloud Text

Boxed, italicized text a game master reads to players is a blockquote. Print-md's default blockquote styling — left border, tinted background, italic — already reads as a read-aloud box with zero configuration:

> The passage narrows. Cold air rushes up from below, carrying the smell of
> wet stone — and something else, something sweet, and wrong.

```markdown
> The passage narrows. Cold air rushes up from below, carrying the smell of
> wet stone — and something else, something sweet, and wrong.
```

For a stronger box, attach one of this guide's callout classes with `markdown-it-attrs` (Chapter 3 covers the full callout family):

> **Read Aloud**
>
> Ahead, torchlight flickers against the walls, though no torches are visible.
{.callout-note}

```markdown
> **Read Aloud**
>
> Ahead, torchlight flickers against the walls, though no torches are visible.
{.callout-note}
```

## Dice Notation

There is no automatic dice-notation detection — no icon, no special parser, no colored badge. Write dice expressions as plain text and lean on standard markdown for emphasis. Inline code (backticks) reads well for die rolls because it switches to a monospace font:

Roll `2d6+3` for damage. The dragon breathes fire for **10d10** damage!

```markdown
Roll `2d6+3` for damage.

The dragon breathes fire for **10d10** damage!

Make a DC 15 check or take `3d8-2` damage.
```

If you want highlighted rolls, the bundled (opt-in, no-install) `markdown-it-mark` plugin does `==text==` → `<mark>text</mark>`. Enable it in your manifest:

```yaml
plugins:
  - markdown-it-mark
```

```markdown
Roll ==2d6+3== for a critical hit.
```

Chapter 6, *Plugins*, lists the other bundled optional plugins (`markdown-it-sub`, `markdown-it-sup`, `markdown-it-abbr`) and how to declare load options.

## Cross-References

There is no `@[...]` reference syntax. Use a standard markdown link to a heading's explicit `{#id}` — headings do **not** get an automatic id from their text in print-md, so give any heading you plan to link to an explicit one:

```markdown
The @[shadowkin] emerges from darkness.   <!-- OLD — does not work -->

See the [Shadowkin](#creature-shadowkin) entry for full stats.  <!-- current syntax -->

## Shadowkin {#creature-shadowkin}
```

This is the same link-to-heading-anchor mechanism Chapter 2 documents for cross-referencing any chapter — it is not TTRPG-specific.

## Challenge Ratings

There is no automatic CR coloring. Write the rating as plain text, and — if you want a color cue — apply a callout class to the whole stat block rather than trying to color a single number:

@section

| CR Range | Difficulty | Suggested class |
|----------|-----------|------------------|
| 1–3 | Easy | `.callout-tip` |
| 4–7 | Medium | `.callout-note` |
| 8–12 | Hard | `.callout-warning` |
| 13+ | Deadly | `.callout-danger` |

@end-section

## Complete Example

A full creature entry combining everything above — a linkable heading, read-aloud text, a color-coded stat block, and dice notation — built entirely from core print-md features. Text earlier in a chapter can link forward to it:

See the [Shadow Assassin](#creature-shadow-assassin) below for a worked example.

> **Read Aloud**
>
> A shape peels away from the darkness between two pillars — too fast, too
> quiet, gone before the torchlight catches it.
{.callout-note}

@section .spec-block .callout-warning

**CR 8 — Hard**

| Attribute | Value          |
| --------- | -------------- |
| HP        | 68             |
| AC        | 16             |
| Attack    | 2d6+4 slashing |
| Speed     | 40 ft          |

@end-section

### Shadow Assassin {#creature-shadow-assassin}

Combat: DC 15 Dexterity save or take `4d6` damage. Roll `1d20+6` for stealth checks.

The markdown behind that entry is nothing but a heading with an id, a blockquote, an `@section`, a table, and plain text:

```markdown
See the [Shadow Assassin](#creature-shadow-assassin) below for a worked example.

> **Read Aloud**
>
> A shape peels away from the darkness between two pillars — too fast, too
> quiet, gone before the torchlight catches it.
{.callout-note}

@section .spec-block .callout-warning

**CR 8 — Hard**

| Attribute | Value          |
| --------- | -------------- |
| HP        | 68             |
| AC        | 16             |
| Attack    | 2d6+4 slashing |
| Speed     | 40 ft          |

@end-section

### Shadow Assassin {#creature-shadow-assassin}

Combat: DC 15 Dexterity save or take `4d6` damage. Roll `1d20+6` for stealth checks.
```

## Best Practices

### Consistency

- Reuse one CSS class per box type (`.spec-block` for stats, `.callout-note` for read-aloud) instead of inventing a new one per chapter.
- Pick one dice-notation format — inline code or bold — and use it throughout a document.
- Give every heading you plan to link to a stable, explicit `{#id}`.

### Print considerations

- No emoji dependency — every box above is pure CSS.
- No color-only indicators — pair a colored callout with a text label (`**CR 12 — Deadly**`), not color alone, so black-and-white copies stay readable.
- `@section` / `@end-section` keeps a stat block from splitting across a page break.

### When not to use these patterns

These are TTRPG conventions built from generic print-md primitives, not a game-specific mode you turn on. For non-game books, skip the stat-block and read-aloud styling and write standard prose — see Chapter 2, *Writing Your Content*.
