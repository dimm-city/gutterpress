@chapter #ch-example-gear-tech .example-gear-tech .chapter-03 ch="3"

# Gear & Tech — Real-World Example {.dc-chevron}

@lede

This section shows how gear and cybernetics pages look in the actual Dimm City Field Guide, rendered using real book content from chapter 05. This example focuses on the rules-heavy reference page pattern and standard gear prose.

@end-lede

---

## About Gear & Tech Pages

Gear pages in the Field Guide follow a consistent structure: an in-world voice opener (blockquote), a mechanical explanation in plain prose, then a reference table. The pattern repeats for every subsystem — cybernetics, weapons, utilities.

| Pattern | Element | Authoring |
|---------|---------|----------|
| Voice opener | `> blockquote` | In-world character speaking about the gear |
| Mechanical rules | Standard prose | Bold key terms, inline code for mechanic names |
| Reference table | GFM table | Standard `|---|---|` — no class needed for alternating rows |
| Inline code | \`SysChk\` | Game-mechanic terms that are also keywords appear in code style |

**Prose + table pattern** — This is the most common rules-page structure in the Field Guide: a section opener in bold flavour prose, a `> blockquote` for an in-world voice line, body prose explaining the mechanic, then a reference table. The Ego Points table is pure GFM markdown — no class attributes needed for basic alternating-row styling (`dc-components.css` applies it universally).

**Inline code in prose** — `SysChk` rendered as inline code is intentional for game-mechanic terms that double as class names or keywords. The `dc-components.css` inline code style (orange text, faint orange background) reads clearly against cream body text at 12pt body size.

---

@page .tech-cybernetics .second-page .chapter-05

> [!NOTE]
> **Tech and Cybernetics Page** — `@page .tech-cybernetics .second-page .chapter-05` — applies the cybernetics rules layout. This page uses dense prose with bold key terms and a full rules table for the Ego Points system. See [Components](#ch-components) for table rendering.

---

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

---

## Example Gear Entries

> [!NOTE]
> **Gear entry format** — gear items use the `.dc-gear-entry` component. Each entry has a name (H4), a tagline (`.dc-gear-entry-tagline` class applied via `{.dc-gear-entry-tagline}`), a cost and stats line, and a short description. Gear tables use `{.dc-table-crimson}` if the header row needs accent color.

### Useful Items

| Item | Cost (DC) | Weight | Notes |
|------|-----------|--------|-------|
| **Shadowbit Token** | 20-500 | Nil | Encrypted Dream Credits chip, untraceable |
| **Patchkit** | 80 | 0.5kg | Restores 2 HP when used as an action |
| **Signal Jammer** | 200 | 1kg | Kills wireless in Near range for 3 rounds |
| **Glow Stick (×6)** | 15 | Nil | Chemical light, 4 hours, bright Near radius |
| **Breaching Charge** | 350 | 2kg | Destroys standard doors and locks; loud |
| **Nano-Seal Spray** | 120 | 0.3kg | Closes wounds, stops bleeding — 1 HP, no roll |
| **Burner Comm** | 60 | 0.1kg | One-use encrypted comm device |

### Common Cybernetics

| Implant | EP Cost | Effect |
|---------|---------|--------|
| **UniArm 100** | 1 | Cybernetic arm. Full functionality, +1 to Reach attacks. |
| **RedEye Optical** | 1 | Enhanced vision. Night vision + zoom to Far range. |
| **Redi-Mobile Cyberleg** | 1 | Cybernetic leg. +1 movement speed, silent movement. |
| **Neurolink Mk2** | 2 | Neural interface. Connect to systems at Near range. |
| **SubDerm Armor Mesh** | 2 | Subdermal plating. Resist 1 damage from physical attacks. |
| **Reflex Accelerator** | 3 | Combat processor. +1 AP per round, cannot be Stunned. |
