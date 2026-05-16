@chapter #ch-example-front-matter .example-front-matter .chapter-03 ch="3"

# Front Matter — Real-World Example {.dc-chevron}

@lede

This section shows how the Table of Contents, Credits, and Introduction pages look in the actual Dimm City Field Guide, rendered using real book content. These are the first pages a reader encounters — `page-toc`, `page-credits`, and `page-intro` templates applied to the `chapter-00` content.

@end-lede

---

## About Front Matter Pages

@section .two-column

Front matter sets the emotional contract with the reader. Before they see a single rule, a map, or a stat block, the TOC, Credits, and Introduction tell them what kind of book this is.

| Page | Template class | Design purpose |
|------|---------------|----------------|
| Table of Contents | `page-toc` | Dense chapter listing with `.dc-toc` numbered rows |
| Credits | `page-credits` | Short credits block anchored by a full-bleed illustration |
| Introduction | `page-intro` | Pull-quote opener, narrative fiction, setting primer |

@column-break

All three use the `chapter-00` class selector in `page-rules.css`, which drives the pre-chapter margin and header treatment. The `@toc` and `@end-toc` macros emit the `.dc-toc-row` structure for the Contents page. The pull-quote band on the Introduction page uses `> [!PULLQUOTE]` — the same alert component used elsewhere in the book.

Front matter pages exist outside the main chapter numbering system. They do not have chapter code badges or specialty color blocks. Their job is to establish voice and brand before the system content begins.

@end-section

---

@page .page-toc

# Contents {.dc-chevron}

@lede

Twelve chapters of dreams, dirt, and what bites back. Read them in any order — the city doesn't care where you start.

@end-lede

@toc

1. **01** &nbsp; [Who Do You Dream to Be?](#chapter-01) — Citizen file, vibe, origins, ideals, flaws.
2. **02** &nbsp; What Do You Dream of Doing? — How abilities work. Choose a specialty.
3. **03** &nbsp; The Augmerc — Muscle for hire. Backbiters and worse.
4. **04** &nbsp; The Proxy — Bodies for hire. Divine force as a weapon.
5. **05** &nbsp; The Streetwarden — The closest thing to law in the alleys.
6. **06** &nbsp; The Gutterdruid — Sacred ground in broken pavement.
7. **07** &nbsp; The Cybersurgeon — Cutting, splicing, upgrading flesh.
8. **08** &nbsp; The Wirephreak — Killers, thieves, forgers — clean or loud.
9. **09** &nbsp; The Technosorcerer — Code that bites. Magic with root access.
10. **10** &nbsp; The Etherlock — Secrets as currency. Power has a price.
11. **11** &nbsp; Are You Lucid Yet? — Core rules, scenes, distances, rolling the die.
12. **12** &nbsp; Dream Mastery & Cosmology — NPCs, traits, time, districts.
13. **13** &nbsp; Cybernetics, Weapons, and Gear — Useful items, tech, blasters, blades.

@end-toc

---

@page .page-credits .credits .chapter-00

# Credits {.dc-chevron}

**Designers:** TWard and ITLackey

**Artist:** Scott Georges

**Creative Director:** Matt Pini

**Play Testers:** Malie Mason, Ceros Whaley, Lady Lunadi, Owen Benjamin Kessel, Tim Kirk, Xander Arth, Thomas Morton, Ian Cooper, Colin Campbell, Chris Mayes, Jesse Rhom, Toby Dillon, Tim Peludat, Lane Francis, Adam Martin, Clay Meyer, Luther Krupp

**Special Thanks:** Don and Cindy Ward, Ted Bonnah, Joseph Woodworth, Ben McDonough, Michael Giordono, Adam Tripp, Nathan Hays, Nathanael Elkins, Danny Sweeney, John Scheiber, Bill Rekowski, Tim Peludat, Lane Francis, Adam Martin, Clay Meyer, Luther Krupp, Chelanna Leigh, Nathan Perko, Danial DZ, Thomas Amundrud, Virgina Horine, Dennis Lee Rose, Gena Pini, Lily Choo-Wright, Madeleine Pini, Ken Pini, Mary Jo Pini, Davide Cavadini

**Dedicated to the memory of Donovan Henry Callender.**
Don was a player in our 2E AD&D group throughout our youth and was a dear friend for even longer. He was taken too soon from us and we wish he were here to dream in Dimm City with us today.

![founders-house](https://placehold.co/600x400/png?text=Founders+House){.fg-art-founders-house}

---

@page .page-intro .intro .chapter-00

# Introduction {.dc-chevron}

> [!PULLQUOTE]
> "How bright's it ay?!"

The city didn't go quiet—it got loud. That feline snarl tore through the alley speakers, chased hard by the thundercrack of gunfire.

A crew of geared-up cats—sleek fur, feral eyes, lenses pulsing with kill-code—came screaming down the block, pulse cannons humming an evil dirge. They wore glossy slab-armor that flexed like chitin and burned like synthlight. Opposite them? A pack of ragged rabbits with wiry limbs and twitch-fast reflexes, zipping through the sprawl with street-born magic and muscle memory. Then the world erupted.

![intro-image](https://placehold.co/600x400/png?text=Intro+Image){.fg-art-intro-image}

Blasts lit the dusk like glitchfire. Bolts and teeth and claws tangled mid-air. Neon signs cracked. Alleyways bled smoke. Debris rained in bursts. This wasn't about glory—it was turf. It was pride. It was blood memory, raw and ugly, of family torn away by their rival.

DimmCitz scattered, vanished into bolted dens and reinforced rooftops. Some just slinked into a corner, shut their eyes, and hoped the riot passed them by. The air stank of scorched fur, ozone, and cordite. Concrete buckled under pulsefire and the ground groaned like it wanted no part of any of it.

## Metropolis in the Mist

Dimm City is a place of crushing lows and exuberant highs known to all within. The citizens of the five districts commonly refer to each other as "Dimmers". Light is impermanent, as just as darkness is, but both are in constant flux. Life in DimmC is the same.

You and your party make the dream come alive. Without you, it doesn't exist. The point that differs in this dream is when you enter Dimm City, you all can share in the story together, shape events, and even change the demi-plane itself permanently.

These dreams you share will last in your consciousness for life. The joys you found and the laughs you shared coupled with tragedy, sadness or even guilt can impact you in unexpected ways. Be "ready 'n' wary" as adventure in Dimm City is hard, fast, and not for the faint of heart.

## CREATUREPUNK

It ain't chrome. It ain't clean. It's coagulated blood in the wire, hairballs in the circuitry, a roar tearing through static.

Creaturepunk is what happens when evolution takes a sledgehammer to the face and the survivors crawl out growling. You're spliced-up, hex-stained, glitch-ridden—a freakshow stitched with spite, magic, and tech from dead wars. You're anything but human. Your kind's been running the monoverse since before humanity finger-painted on cave walls.

The city don't love you. The corps don't see you. The gods don't pick up.
Good. That makes you dangerous.

This is a genre where dreams are loud, limbs are optional, and survival's the last sacred act.

Welcome to Creaturepunk. Get weird or get wrecked.
