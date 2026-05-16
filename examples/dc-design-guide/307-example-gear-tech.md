@chapter #ch-example-gear-tech .example-gear-tech .chapter-03 ch="3"

# Gear & Tech — Real-World Example {.dc-chevron}

@lede

This section shows how gear and cybernetics pages look in the actual Dimm City Field Guide, rendered using real book content from chapter 05. This example focuses on the rules-heavy reference page pattern and standard gear prose.

@end-lede

---

## About Gear & Tech Pages

@section .two-column

Gear pages in the Field Guide follow a consistent structure: an in-world voice opener (blockquote), a mechanical explanation in plain prose, then a reference table. The pattern repeats for every subsystem — cybernetics, weapons, utilities.

| Pattern | Element | Authoring |
|---------|---------|----------|
| Voice opener | `> blockquote` | In-world character speaking about the gear |
| Mechanical rules | Standard prose | Bold key terms, inline code for mechanic names |
| Reference table | GFM table | Standard `|---|---|` — no class needed for alternating rows |
| Inline code | \`SysChk\` | Game-mechanic terms that are also keywords appear in code style |

@column-break

**Prose + table pattern** — This is the most common rules-page structure in the Field Guide: a section opener in bold flavour prose, a `> blockquote` for an in-world voice line, body prose explaining the mechanic, then a reference table. The Ego Points table is pure GFM markdown — no class attributes needed for basic alternating-row styling (`dc-components.css` applies it universally).

**Inline code in prose** — `SysChk` rendered as inline code is intentional for game-mechanic terms that double as class names or keywords. The `dc-components.css` inline code style (orange text, faint orange background) reads clearly against cream body text at 12pt body size.

@end-section

---

@page .tech-cybernetics .second-page .chapter-05

### Tech and Cybernetics

@section .two-column

Wanna level up? In Dimm City, that means slicing yourself open and slotting in something stronger. Flesh breaks. Metal remembers. Cybernetics give you reach, power, speed—whatever the job demands. But every upgrade scrapes away at what makes you you.

@column-break

Install too much, too fast, or too dirty, and the body pushes back. Or worse—the Dream does.

@callout variant=gear label="Remember"

Every install has a cost. Every edge has a crack. Push too far, and something in you will break.

@end-callout

@end-section

---

## The Cost of Upgrades Is You

> You didn't lose yourself. You traded it—piece by piece.

Ego Points (EP) measure how much of you is still you after the implant goes in. Every aug stretches the seams—mind, body, soul. The more tech you bolt on, the more your flesh remembers what got stripped away. Push too far, and it ain't just your mods glitching—it's your grip on reality.

Push past your limits, and you don't run the gear anymore. The gear runs you.

A PC can have the following augmentations in their original form:

@section .two-column
- 1 Neurolink (assuming one brain)
- 1 Skin augmentation
- 1 Skeletal augmentation
- 1 Nervous system augmentation

@column-break

- 1 implant per natural limb
- 1 implant per natural eye socket
- 1 implant per natural ear
- 1 implant per voicebox
@end-section

Cybernetics must be installed by a trained Cybersurgeon in a medlab, clinic, or hospital. Augments and modifications are typically purchased with Dream Credits.

### Ego Points (EP)

> How many implants 'til your brain bluescreens for good?

PCs start clean with 0 EP. But every aug you bolt on scrapes at your mind, tugs at your guts, and dials up the system errors. Ten is the cap—go past it, and your character crashes. Full body-hack burnout.

@outcome
1–2 | Slim chance of control issues | SysChk 6–7
3–4 | Increased difficulty keeping a grip | SysChk 8–10
5–6 | Moderate challenges to functionality | SysChk 9–13
7–8 | High susceptibility to manipulation and malfunction | SysChk 12–15
9–10 | Extreme instability, system failures likely | SysChk 15–20
@end-outcome

@callout variant=note label="Cybersuck"

Specialties relying on arcane forces are adversely affected by implant Ego. If you're a Proxy, Gutterdruid, or Etherlock, every Ego Point above 2 makes it harder to use your abilities: **+1 AP cost for every point of EP beyond 2.**

Example: With 4 EP, your abilities cost +2 AP more to activate. Technosorcerers are exempt—they've already sold their soul to the static. But even they risk system overload and are still subject to `SysChk` rolls.

@end-callout

@callout variant=gear label="SysFAIL"

Consequences of a SysFAIL can range from temporary ability loss to total system shutdown.

- Mild issues like a temporary freeze of an augment's functionality.
- Mobility issues or loss of the character's action for a round.
- Total system shutdown lasting for a quicktick (one combat round) or more.

The affected PC rolls each round to regain control. Specialties like the Cybersurgeon, Technosorcerer, or Wirephreak can assist, granting Lucidity to the next `SysChk`.

@end-callout

---

## Example Gear Entries

### Useful Items

@section .two-column

@gear-card
### Shadowbit Token

*Untraceable blockchain chip. The city's off-book currency.*

**20–500 DC · Nil**

Encrypted Dream Credits chip. Completely anonymous. If you can't pay clean, pay with one of these.

@end-gear-card

@gear-card
### Patchkit

*Combat field dressing. Seal it, move on.*

**80 DC · 0.5 kg**

Restores 2 HP when used as an action. Sterile enough. Nothing fancy.

@end-gear-card

@gear-card
### Signal Jammer

*Dead air on demand. No comms, no coordination.*

**200 DC · 1 kg**

Kills all wireless communications in Near range for 3 rounds. Loud to anyone watching network traffic.

@end-gear-card

@gear-card
### Breaching Charge

*Knock knock.*

**350 DC · 2 kg**

Destroys standard doors, locks, and light barriers. Very loud. Single use. Don't stand in front of it.

@end-gear-card

@end-section

### Common Cybernetics

@section .two-column

@gear-card
### UniArm 100

*Cybernetic arm. Street grade. Reliable.*

**1 EP · Cybersurgeon installation required**

Full arm functionality. +1 to Reach attacks. Comes in matte black or brushed chrome.

@end-gear-card

@gear-card
### RedEye Optical

*See in the dark. See far. See everything.*

**1 EP · Cybersurgeon installation required**

Enhanced optical implant. Night vision + zoom to Far range. Compatible with targeting overlays.

@end-gear-card

@gear-card
### Neurolink Mk2

*Jack in. The city's yours.*

**2 EP · Cybersurgeon installation required**

Neural interface chip. Connect to digital systems at Near range. Required for most high-tier augments.

@end-gear-card

@gear-card
### Reflex Accelerator

*You move before they think.*

**3 EP · Cybersurgeon installation required**

Combat processor wired into your nervous system. +1 AP per round. Cannot be Stunned. High EP cost — you'll feel it.

@end-gear-card

@end-section
