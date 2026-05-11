@chapter #ch-fg-specialty-overview .fg-examples

# Field Guide: Specialty Overview {.dc-chevron}

::: wrapper {.dc-intro}
Demonstrates the "Choose a Specialty" chapter section — the page template, chapter opener structure, specialty card grid, and `@class-entry` cards used in the DC Field Guide. Source is adapted from `field-guide/chapter-01.md` and `chapter-02 0.md`.
:::

---

## Pattern: Chapter Opener + Class Entries

The Choose a Specialty section spans two page types: a chapter-start opener (two-column layout, fiction left / rules right) followed by a `page-ability-catalog choose-specialty` body page with the specialty card grid.

The opener in the Field Guide uses `--- {page .page-chapter-start .chapter-start .chapter-02}` with a raw `<span class="dc-chapter-opener-no">` badge. Non-specialty chapters (like chapter-01) use the `@chapter-opener C.N` macro form instead — both are equivalent.

The specialty listing page uses `--- {page .page-ability-catalog .choose-specialty}` which activates a two-column auto-fill layout defined in `page-rules.css`.

---

## Pattern: Two-Column Chapter Opener

**Page class** — `--- {page .page-chapter-start .chapter-start .chapter-02}`

**Chapter opener badge** — `@chapter-opener C.02` (macro) or `<span class="dc-chapter-opener-no">C.02</span>` (raw)

**Left column** — spray banner + fiction narrative  
**Right column** — chevron H2 + rules prose, split by `---{.column-break}`

```markdown
--- {page .page-chapter-start .chapter-start .chapter-02}

@chapter-opener C.02

## What Do You Dream of Doing? {.dc-spray}

The alley narrowed to a throat of shadow as they reached the bunker's
blind side. Rook paused, agile fingers lifting mid-air...

---{.column-break}

## How Abilities Work {.dc-chevron}

How that pack works wasn't luck. It was abilities firing in sequence.

Each move opened space. Each ability set up the next.
```

**Live specimen:**

--- {page .page-chapter-start .chapter-start .chapter-02}

@chapter-opener C.02

## What Do You Dream of Doing? {.dc-spray}

The alley narrowed to a throat of shadow as they reached the bunker's blind side. Rook paused, agile fingers lifting mid-air, knuckles flexing with simian grace. The ambient hum dipped a fraction.

"Three layers," he murmured, dark eyes flicking as invisible data scrolled past his vision. "Motion, thermal, facial-recognition. Someone was paranoid."

Zephyr grinned, sharp and feline, and rolled her shoulders. LEDs along her spine flared as she stretched, ready to pounce, color bleeding into sigils that crawled and rearranged themselves. "Someone interesting," she purred.

Prism stepped forward, long ears barely stirring as the ground softened beneath their feet. Gravity loosened its grip, monoversal pressure bending just enough to lie. Their presence dulled the sensors' edge, probability smearing like grease across a lens.

Rook exhaled and went to work. One system collapsed into another, blind spots stacking neatly as dominoes fell. His tail gave a single, absent twitch. He didn't rush. He didn't need to. The system listened when he spoke its language.

A low thrum answered from behind. Kyra and Kyne took position without a word, heavy hooves setting with practiced certainty on either side of the sealed door.

Five shadows moved as one, already inside, already gone.

---{.column-break}

## How Abilities Work {.dc-chevron}

How that pack works wasn't luck. It was abilities firing in sequence.

Each move opened space. Each ability set up the next.

In Dimm City, abilities aren't just what you can do. They're learned techniques, invasive augments, practiced rituals, and raw instinct working as one.

The rules that follow break down how abilities activate, how they grow, and how they interlock when the pack moves together.

> [!DM]
> Every character needs at least one ability from each category — combat, support, and utility. A crew that only punches things is a crew that doesn't survive.

@break

---

## Pattern: Specialty Card Grid

**Page class** — `--- {page .page-ability-catalog .choose-specialty}`

The specialty overview page lists all eight specialties using the `.specialty-spread` wrapper containing individual `.specialty-card` wrappers. Each card has an image, an H3 name (with anchor), a blockquote strap line, and one prose paragraph.

**Important:** the outer wrapper uses the quoted class form: `::: wrapper {".specialty-spread"}` (quotes around the class string). Inner cards use the key=value form: `::: wrapper {class="specialty-card augmerc"}`.

```markdown
--- {page .page-ability-catalog .choose-specialty .chapter-02}

## Choose a Specialty {#c2-choose-specialty}

Every dreamer's got a sharp edge — your specialty is where it starts.

::::: wrapper {".specialty-spread"}

::: wrapper {class="specialty-card augmerc"}
### Augmerc {#specialty-augmerc}

![Augmerc character art](img/augmerc.png){.art-specialty}

> Cybernetic Commando

Heavily armed and wired for war, Augmercs are the blunt force of any
squad. They charge the front, soak the pain, and unload hell using
brute strength and brutal tech.

:::

::: wrapper {class="specialty-card wirephreak"}
### Wirephreak {#specialty-wirephreak}

![Wirephreak character art](img/wf.png){.art-specialty}

> Ping Predator

Killers, thieves, forgers — Wirephreaks specialize in slipping past
locks, firewalls, and people. Whether the job calls for stealth,
sabotage, or sleight-of-hand, they get it done.

:::

:::::
```

**Live specimen:**

--- {page .page-ability-catalog .choose-specialty .chapter-02}

## Choose a Specialty {#c2-choose-specialty}

Every dreamer's got a sharp edge — your specialty is where it starts. It's the skillset that defines what you bring to the crew and shapes the wild ways you survive the Dream.

::::: wrapper {".specialty-spread"}

::: wrapper {class="specialty-card augmerc"}
### Augmerc {#specialty-augmerc-demo}

> Cybernetic Commando

Heavily armed and wired for war, Augmercs are the blunt force of any squad. They charge the front, soak the pain, and unload hell using brute strength and brutal tech. Combat-born, augged to kill, and never outgunned.

:::

::: wrapper {class="specialty-card proxy"}
### Proxy {#specialty-proxy-demo}

> Militant Monolith

Marked by something higher — god, ghost, code, or conviction — Proxies walk the line between zealot and judge. They wield divine force like a weapon, bending battles and conversations alike with power that burns louder than faith.

:::

::: wrapper {class="specialty-card streetwarden"}
### Streetwarden {#specialty-streetwarden-demo}

> Sprawl Sentinel

They don't wear badges — they are the law when no one else shows. Streetwardens guard the city's broken places with fists, grit, and a code all their own. Defile their turf, and justice comes fast.

:::

::: wrapper {class="specialty-card gutterdruid"}
### Gutterdruid {#specialty-gutterdruid-demo}

> Wold Witch

They walk the alleys like sacred ground — feeding the hungry, tending weeds, raising the forgotten. Gutterdruids draw power from the pulse beneath the pavement, shaping the raw, primal force that keeps the city alive even as it rots.

:::

::: wrapper {class="specialty-card cybersurgeon"}
### Cybersurgeon {#specialty-cybersurgeon-demo}

> Mech Medic

Life is flexible. Cybersurgeons prove it daily — cutting, splicing, upgrading flesh into something more. Whether back-alley butchers or elite biomech specialists, these med-techs push the edge of evolution, one implant at a time.

:::

::: wrapper {class="specialty-card wirephreak"}
### Wirephreak {#specialty-wirephreak-demo}

> Ping Predator

Killers, thieves, forgers — Wirephreaks specialize in slipping past locks, firewalls, and people. Whether the job calls for stealth, sabotage, or sleight-of-hand, a Wirephreak on the crew means the job gets done.

:::

:::::

@break

---

## Pattern: Class Entry Cards

**Macro** — `@class-entry SpecialtyName` … `@end-class-entry`

**Used on** — the chapter-02 body pages that introduce each specialty in detail. Each card emits a `dc-class-entry` block with a portrait image, an H3 class name, a `dc-classtag` chip (auto-generated from the specialty name), prose paragraphs, and a flavor blockquote.

**Structure inside the macro block:**

| Element | Markdown form | Rendered as |
|---|---|---|
| Portrait image | `![alt](path)` (image-only paragraph) | `.dc-class-entry-portrait` |
| Class name | `### Specialty Name` | `.dc-class-entry-name` (H3) |
| Class tag chip | auto-generated from specialty slug | `.dc-classtag.augmerc` etc. |
| Prose paragraphs | plain paragraphs | `.dc-prose` |
| Flavor quote | `> "Quote." — Attribution` | `.dc-flavor` |

**Syntax:**

```markdown
@class-entry Augmerc

### Augmerc

> "The gear talks. By the time you figure out what it said, the job's done."
> — Rook, Augmerc, Rattleneck District

An Augmerc is muscle for hire. Street thugs, corporate bodyguards, deniable
enforcers — the difference is gear, grafts, and how much of them is still
original.

Choose this specialty if you want an operator who gets more dangerous as
conditions worsen. Path-specific durability, reach, and counter options reward
aggressive positioning.

@end-class-entry
```

The specialty slug (lower-cased first argument after `@class-entry`) drives both the `.dc-classtag` color chip and the CSS class on the wrapper. Use the exact slugs: `augmerc`, `proxy`, `streetwarden`, `gutterdruid`, `cybersurgeon`, `wirephreak`, `technosorcerer`, `etherlock`.

**Live specimen — three class entries with tape dividers:**

@class-entry Augmerc

### Augmerc

> "The gear talks. By the time you figure out what it said, the job's done."
> — Rook, Augmerc, Rattleneck District

An Augmerc is muscle for hire. Street thugs, corporate bodyguards, deniable enforcers — the difference is gear, grafts, and how much of them is still original. Some run with packs, some lone-wolf it. Either way, most don't get paid until the job is done.

This heavy fights with skill, weapons, and tuned augmentation. The best are trained-up, tooled-up, and rebuilt with chrome, grafts, and salvaged tech.

@end-class-entry

<div class="dc-tape">— § —</div>

@class-entry Gutterdruid

### Gutterdruid

> "I asked the city what it needed. It showed me."
> — Vex-Briar, Gutterdruid, The Underwick

Gutterdruids read the monoverse like a map drawn in living things. They find power in alley cats, roof moss, and the feral pulse beneath the pavement — and they make it work for them. This isn't nature magic imported from somewhere green. It's the city itself, feral and willing.

Choose this specialty if you want a character who shapes the scene rather than blasting through it. Territory control, animal bonds, and environmental read reward lateral thinking.

@end-class-entry

<div class="dc-tape">— § —</div>

@class-entry Wirephreak

### Wirephreak

> "Every lock tells you how it wants to be opened. You just gotta listen."
> — Cipher, Wirephreak, Scaffold Row

Killers, thieves, forgers — Wirephreaks specialize in slipping past locks, firewalls, and people. Some work clean, some loud, all lethal. Whether the job calls for stealth, sabotage, or sleight-of-hand, a Wirephreak on the crew means the job gets done and no one can prove it.

@end-class-entry

---

## Pattern: Full Specialty Section

**Macro** — `@specialty {.classname}`

**Used on** — the per-specialty catalog pages that follow the overview. Opens a `<section class="specialty classname">` wrapper that scopes all following `@learning-path` and `@skill` content.

**Companion wrappers:**

| Wrapper | Purpose |
|---|---|
| `::: wrapper {.specialty-intro}` | Left-page prose panel — H2 name, description, spec-tweak H3 |
| `::: wrapper {.specialty-art}` | Right-page full-bleed art plate |

**Syntax:**

```markdown
@specialty {.augmerc}

::: wrapper {.specialty-intro}

## Augmerc

An Augmerc is muscle for hire. Street enforcers, deniable contractors,
close-combat specialists — the difference is gear, grafts, and how much
of them is still original flesh.

If you want to start quickly, choose these abilities: Punishing Counter,
Rage Hit, Spit Flame, Bodycover, Rub Some Dirt on It!, and Size Up.

### Spec Tweak: **Wired to Kill** {.dc-spec-tweak .no-top}

Augmerc techniques assume combat-grade augmentations installed in the body:
reinforced bones, reflex accelerators, adrenal regulators, neural predictors.
Without the implants, the Augmerc spends 1 extra AP to activate path abilities.

:::

::: wrapper {.specialty-art}

![Augmerc](./images/chapter-02/augmerc.png){.augmerc}

:::

@learning-path

### Biting Distance {.dc-spray}

> If you can touch it, you can maul it.

- Punishing Counter
- Rage Hit
- Dirty Work
- Pain Compliance
- It's Personal
```

See `04-dc-components.md` for the full `@skill` card specimen and learning path documentation.

---

## Authoring Quick Reference

| Pattern | Page class | Key syntax |
|---|---|---|
| Chapter opener | `.page-chapter-start .chapter-start` | `@chapter-opener C.N` or `<span class="dc-chapter-opener-no">C.N</span>` |
| Specialty grid | `.page-ability-catalog .choose-specialty` | `::::: wrapper {".specialty-spread"}` + nested `:::` cards |
| Class entry card | any body page | `@class-entry Slug` … `@end-class-entry` |
| Tape divider | between class entries | `<div class="dc-tape">— § —</div>` |
| Specialty section | `.page-chapter-start .chapter-start` | `@specialty {.classname}` + `.specialty-intro` + `.specialty-art` |
| Spec tweak heading | inside `.specialty-intro` | `### Spec Tweak: Name {.dc-spec-tweak .no-top}` |
