@chapter #ch-fg-front-matter .fg-examples .chapter-03

# Field Guide: Front Matter {.dc-chevron}

::: wrapper {.dc-intro}
TOC, credits, and introduction pages — the first spreads readers encounter. These patterns establish the book's structure before chapter content begins.
:::

---

## Pattern: Table of Contents

The TOC page uses `.page-toc` with a `:::wrapper {.dc-toc}` container holding a styled ordered list. Chapter numbers appear as inline bold fallback (`**NN**`) because the CSS `decimal-leading-zero` counter was not rendering reliably in print preview. The `:::wrapper {.dc-intro}` above the list provides a short teaser line in the intro style.

@page .page-toc

## Contents {.dc-chevron}

::: wrapper {.dc-intro}
Twelve chapters of dreams, dirt, and what bites back. Read them in any order — the city doesn't care where you start.
:::

::: wrapper {.dc-toc}

1. **01** &nbsp; [Design System Overview](#ch-overview) — How to use this guide and customize it for your book.
2. **02** &nbsp; [Typography](#ch-typography) — lixdu display, Tomorrow mono, Titillium Web body; the full type scale.
3. **03** &nbsp; [Color Palette](#ch-palette) — paper, fire, HUD, surface, and border tokens with usage rules.
4. **04** &nbsp; [Core Components](#ch-components) — prose, callouts, notes, pull quotes, and tables.
5. **05** &nbsp; [DC Component Library](#ch-dc-components) — banners, ability cards, tags, stickers, stat blocks.
6. **06** &nbsp; [Page Templates](#ch-templates) — named page types, chapter openers, and full-bleed spreads.
7. **07** &nbsp; [Layout & Composition](#ch-layout) — columns, floats, page markers, and break utilities.
8. **08** &nbsp; [Markdown Reference](#ch-reference) — all syntax with live examples.
9. **09** &nbsp; [Field Guide Components](#ch-fg-components) — dashed rules, definition blocks, gear entries.
10. **10** &nbsp; [CLI Reference](#ch-cli) — build, preview, and publish commands.

:::

---

## Pattern: Credits

The credits page uses `.page-credits` combined with `.credits` and a chapter class. The `## Credits {.dc-chevron}` heading gets the chevron treatment. Credits blocks are plain bold-label paragraphs — no special containers. The dedication is freestanding prose. A founders-house image anchors the bottom with `.art-founders-house`.

**Page class** — `@page .page-credits .credits .chapter-NN`

**Required elements:**
- `## Credits {.dc-chevron}` — chevron banner heading
- `**Role:** Name(s)` — plain bold-label credit blocks (Designer, Artist, etc.)
- `**Dedicated to…**` — dedication paragraph (freestanding prose)
- `![alt](img/founders-house.png){.art-founders-house}` — art anchored to bottom

```markdown
@page .page-credits .credits .chapter-00

## Credits {.dc-chevron}

**Designers:** Name and Name

**Artist:** Name

**Play Testers:** Name, Name, Name

**Dedicated to the memory of Name.**
One or two sentences of memorial prose.

![founders-house](img/founders-house.png){.art-founders-house}
```

**Live specimen:**

@page .page-credits .credits .chapter-00

## Credits {.dc-chevron}

**Designers:** TWard and ITLackey

**Artist:** Scott Georges

**Creative Director:** Matt Pini

**Play Testers:** Malie Mason, Ceros Whaley, Lady Lunadi, Owen Benjamin Kessel, Tim Kirk, Xander Arth, Thomas Morton, Ian Cooper, Colin Campbell, Chris Mayes, Jesse Rhom, Toby Dillon

**Special Thanks:** Don and Cindy Ward, Ted Bonnah, Joseph Woodworth, Ben McDonough, Michael Giordono, Adam Tripp, Nathan Hays, Nathanael Elkins, Danny Sweeney, John Scheiber, Bill Rekowski, Tim Peludat, Lane Francis, Adam Martin, Clay Meyer, Luther Krupp, Chelanna Leigh, Nathan Perko, Danial DZ, Thomas Amundrud, Virgina Horine, Dennis Lee Rose, Gena Pini, Lily Choo-Wright, Madeleine Pini, Ken Pini, Mary Jo Pini, Davide Cavadini

**Dedicated to the memory of Donovan Henry Callender.**
Don was a player in our 2E AD&D group throughout our youth and was a dear friend for even longer. He was taken too soon from us and we wish he were here to dream in Dimm City with us today.

![founders-house](img/placeholder-plate.png){.art-founders-house}

---

## Pattern: Introduction

The intro spread uses `--- {page .page-intro .intro .chapter-00}` (dash-marker syntax). It opens with a `:::wrapper {.dc-pullquote}` for the chapter's hook quote, followed by opening fiction prose, an art image, and then genre-description sections using `### Sub-heading` (no chevron class at H3). The fiction excerpt and genre sections run on the same spread without additional page breaks.

**Page class** — `--- {page .page-intro .intro .chapter-00}`

**Structure — left column:**
- `:::wrapper {.dc-pullquote}` — hook quote (1–2 sentences)
- Opening fiction paragraphs (150–250 words)
- `![alt](img/intro.png){.art-intro-image}` — full-column art

**Structure — right column (same page, flows after art):**
- Genre overview paragraphs
- `### Sub-heading` — H3 section labels (no `.dc-chevron` class at H3)

```markdown
--- {page .page-intro .intro .chapter-00}

## Introduction {.dc-chevron}

::: wrapper {.dc-pullquote}
"Hook quote — punchy, in-world, under 20 words."
:::

Opening fiction paragraph. Keep it vivid and short.

![alt](img/intro-art.png){.art-intro-image}

Genre context paragraph. Explain the world briefly.

### What You'll Find Here

A short orientation to the book's structure.
```

**Live specimen:**

--- {page .page-intro .intro .chapter-00}

## Introduction {.dc-chevron}

::: wrapper {.dc-pullquote}
"How bright's it ay?!"
:::

The city didn't go quiet — it got loud. That feline snarl tore through the alley speakers, chased hard by the thundercrack of gunfire.

A crew of geared-up cats — sleek fur, feral eyes, lenses pulsing with kill-code — came screaming down the block, pulse cannons humming an evil dirge. They wore glossy slab-armor that flexed like chitin and burned like synthlight. Opposite them? A pack of ragged rabbits with wiry limbs and twitch-fast reflexes, zipping through the sprawl with street-born magic and muscle memory. Then the world erupted.

![intro-image](img/placeholder-plate.png){.art-intro-image}

Blasts lit the dusk like glitchfire. Bolts and teeth and claws tangled mid-air. Neon signs cracked. Alleyways bled smoke. The air stank of scorched fur, ozone, and cordite. Concrete buckled under pulsefire and the ground groaned like it wanted no part of any of it.

The cats moved in tight formations, weapons synced, clearing cover with practiced cruelty. The rabbits? Pure chaos. Leaping from walls, sliding under wreckage, turning trash into traps mid-sprint. Each side fought like it was born in the dirt, but the cats had heavier metal, wiser scars, and colder eyes.

Still, the rabbits didn't blink. Their numbers swelled, bolstered by more burrow-born lapins hungry for payback. They clawed back inches, screaming with defiance, and bled for every breath of space.

One less rival. One more legend.

### Metropolis in the Mist

Dimm City is a place of crushing lows and exuberant highs known to all within. The citizens of the five districts commonly refer to each other as "Dimmers". Light is impermanent, as just as darkness is, but both are in constant flux. Life in DimmC is the same.

You and your party make the dream come alive. Without you, it doesn't exist. When you enter Dimm City, you all can share in the story together, shape events, and even change the demi-plane itself permanently.

### Creaturepunk

It ain't chrome. It ain't clean. It's coagulated blood in the wire, hairballs in the circuitry, a roar tearing through static.

Creaturepunk is what happens when evolution takes a sledgehammer to the face and the survivors crawl out growling. You're spliced-up, hex-stained, glitch-ridden — a freakshow stitched with spite, magic, and tech from dead wars. The city don't love you. The corps don't see you. The gods don't pick up.

Good. That makes you dangerous.

Welcome to Creaturepunk. Get weird or get wrecked.
