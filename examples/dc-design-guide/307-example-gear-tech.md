@chapter #ch-example-gear-tech .example-gear-tech .chapter-03 ch="3"

# Gear & Tech — Real-World Example {.dc-chevron}

@lede
This section shows how gear and cybernetics pages look in the actual Dimm City Field Guide, rendered using real book content from chapter 05. This example now focuses on the rules-heavy reference page pattern and standard gear prose. Images replaced with design guide placeholder.
-lede

---

## Tech and Cybernetics Page

**Page template** — `@page .tech-cybernetics .second-page .chapter-05` — applies the cybernetics rules layout. This page uses dense prose with bold key terms and a full rules table for the Ego Points system. The blockquote introduces the section concept. The `SysChk` table uses standard markdown table syntax. See [Components](#ch-components) for table rendering.

**Prose + table pattern** — This is the most common rules-page structure in the field guide: a section opener in bold flavour prose, a `> blockquote` for an in-world voice line, body prose explaining the mechanic, then a reference table. The Ego Points table is pure GFM markdown — no class attributes needed for basic alternating-row styling (dc-brand.css applies it universally). If a table needs a custom header colour, add `{.dc-table-crimson}` or similar variant class.

**Inline code in prose** — Note `SysChk` rendered as inline code — this is intentional for game-mechanic terms that double as class names or keywords. It keeps the text visually distinct without a callout box. The dc-brand.css inline code style (orange text, faint orange background) reads clearly against cream body text at 12pt body size.

@page .tech-cybernetics .second-page .chapter-05

### Tech and Cybernetics

---

Wanna level up? In Dimm City, that means slicing yourself open and slotting in something stronger. Flesh breaks. Metal remembers. Cybernetics give you reach, power, speed—whatever the job demands. But every upgrade scrapes away at what makes you you.

Install too much, too fast, or too dirty, and the body pushes back. Or worse—the Dream does.

**But remember:** Every install has a cost. Every edge has a crack. Push too far, and something in you will break.

---

## The Cost of Upgrades Is You

> You didn't lose yourself. You traded it—piece by piece.

Ego Points (EP) measure how much of you is still you after the implant goes in. Every aug stretches the seams—mind, body, soul. The more tech you bolt on, the more your flesh remembers what got stripped away. Push too far, and it ain't just your mods glitching—it's your grip on reality.

Push past your limits, and you don't run the gear anymore. The gear runs you.

A PC can have the following augmentations in their original form:
- 1 Neurolink (assuming one brain)
- 1 Skin augmentation
- 1 Skeletal augmentation
- 1 Nervous system augmentation
- 1 implant per natural limb
- 1 implant per natural eye socket
- 1 implant per natural ear
- 1 implant per voicebox

Cybernetics must be installed by a trained Cybersurgeon in a medlab, clinic, or hospital. Augments and modifications are typically purchased with Dream Credits.

### Ego Points (EP)

> How many implants 'til your brain bluescreens for good?

PCs start clean with 0 EP. But every aug you bolt on scrapes at your mind, tugs at your guts, and dials up the system errors. Ten is the cap—go past it, and your character crashes. Full body-hack burnout.

|  EP  |                       Outcome                       | SysChk |
| :--: | :-------------------------------------------------: | :----: |
| 1-2  |            Slim chance of control issues            |  6-7   |
| 3-4  |          Increased difficulty keeping a grip          |  8-10  |
| 5-6  |        Moderate challenges to functionality         |  9-13  |
| 7-8  | High susceptibility to manipulation and malfunction | 12-15  |
| 9-10 |      Extreme instability, system failures likely      | 15-20  |

### Cybersuck

Specialties relying on arcane forces are adversely affected by implant Ego.

If you're a Proxy, Gutterdruid, or Etherlock, every Ego Point above 2 makes it harder to use your abilities: +1 AP cost for every point of EP beyond 2.

Example: With 4 EP, your abilities cost +2 AP more to activate.

Technosorcerers are exempt—they've already sold their soul to the static. But even they risk system overload when their gears grind and are still subject to `SysChk` rolls.

### SysFAIL

Consequences of a SysFAIL can range from temporary ability loss to total system shutdown.

- Mild issues like a temporary freeze of an augment's functionality.
- Mobility issues or loss of the character's action for a round.
- Total system shutdown lasting for a quicktick (one combat round) or more.

The affected PC rolls each round to regain functionality or control. Specialties like the Cybersurgeon, Technosorcerer, or Wirephreak can assist in recovery by spending their action or using an ability that deals specifically with this problem. Assistance grants Lucidity to the next SysChk, allowing the affected PC to roll two dice and use the better result.
