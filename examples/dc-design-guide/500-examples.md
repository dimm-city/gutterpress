@chapter C.500 #ch-examples-refactor

@page .page-chapter-start .chapter-start

# Component Refactor Examples

@page

@lede

Live specimens for every component touched by the macro refactor. Use this page to verify renders during Phase 0 → 1 → 2b → 2c work. Each section is independent — comment out what you're not testing.

@end-lede

---

## TOC

@toc

1. Intro to Dimm City — Citizen file, vibe, origins
2. What Do You Dream of Doing — How abilities work
3. The Augmerc — Muscle for hire

@end-toc

---

## Outcome Ladder

@outcome
20 | Triumph | Best-case outcome, extra impact
11–19 | Success | You do it
6–10 | Hard Choice | You succeed, but it costs you
2–5 | Failure | You don't get what you wanted
1 | Catastrophe | It goes bad, and then worse
@end-outcome

---

## Block Variants

@block .dc-panel
**Panel (data/tactical register)** — `.dc-block.dc-panel`. HUD-blue border, data-dense layout. Used for stats, action economy reference, tactical tables.
@end-block

@block .dc-slate
**Slate (authority register)** — `.dc-block.dc-slate`. Dark substrate, high contrast. Used for rules text, social contracts, Spec Tweak blocks.
@end-block

@block .dc-shard
**Shard (atmosphere register)** — `.dc-block.dc-shard`. Asymmetric zine/punk treatment. Used for flavor, lore asides, world fragments.
@end-block

@block .dc-codex
**Codex (reference register)** — `.dc-block.dc-codex`. Clean reference card. Used for distance tags, glossary terms, quick-reference rules.
@end-block

---

## Sidebar

@sidebar
### Dice Etiquette
Roll in the open. Results stand. If a roll leaves the table, it doesn't count — reroll. The Dream Master may ask for a reroll only when dice land in a physically inaccessible spot.
@end-sidebar

---

## Spec Tweak Block

@block .dc-slate
### Spec Tweak: **Mistrunner**
You move through the city like fog through a gap in the wall. Once per scene, you may cross through one barrier — a locked door, a guarded threshold, a checkpoint — without triggering an obstacle roll. The city lets you through. It doesn't know why.
@end-block

---

## Alert Blockquotes

> [!NOTE] The Core Loop
> Every moment in Dimm City runs on a three-beat rhythm: the DM presents a situation, Dreamers declare intent, the fiction resolves.

> [!DM]
> First session tip: have players describe their character's *look* before stats. Grounds the table in the world before mechanics enter.

> [!VISIT]
> Before You Fill Anything In: Don't start with numbers. Start with a body, a vibe, and a reason you're still breathing in Dimm City.

> [!VIBE]
> DM tip: Ask each Dreamer for one vibe cue, then echo it back in the first NPC reaction.

> [!ORIGIN]
> Origin prompt: What did you lose here, and what did you learn to survive it?

> [!GEAR]
> Not everything you carry is a weapon, a tool, or a piece of tech. Some of it is proof of who you were.

> [!PULLQUOTE]
> "How bright's it ay?!"

---

## Specialty Overview Card (Chapter-01 Pattern)

@section .dc-card-grid

@specialty .augmerc

@specialty-card #specialty-augmerc

### Augmerc

![Augmerc](https://placehold.co/300x340/png?text=Augmerc)

> Cybernetic Commando

Heavily armed and wired for war, Augmercs are the blunt force of any squad. They charge the front, soak the pain, and unload hell using brute strength and brutal tech.

@end-specialty-card

@end-specialty

@end-section

---

## Specialty Profile (Chapter-02 Pattern)

@specialty .proxy

@specialty-intro

## The Proxy

A Proxy is a living conduit — flesh wired to divine signal, body bent to a purpose beyond survival. They don't fight because they want to. They fight because something *needs* them to.

@end-specialty-intro

![Proxy art](https://placehold.co/400x300/png?text=Proxy+Art)

@learning-path

### Devoted Distance

> Channel power without losing the self.

- Devoted Strike
- Signal Burn
- The Body Holds

@end-learning-path

@skill

#### Devoted Strike

> You don't swing — you transmit.

1 AP. Make a melee attack. On a Hit or better, add your Devotion score to damage.

@end-skill

@end-specialty

---

## Definition / Glossary

@section .two-column

@definition
**Tick / Tic:** A very short period of time — a heartbeat, a breath, a moment of reaction. Not a formal unit; used in ability descriptions to indicate immediacy.
@end-definition

@definition
**Shortly / Shorty:** Roughly a scene-length duration. Long enough to cross a district, tend a wound, or lose a tail.
@end-definition

@definition
**Reach:** Close enough to touch. Adjacent. If you could extend a limb and make contact, that's Reach.
@end-definition

@end-section

---

## Gear Entry

@gear-card

#### Throwaway Blaster

A single-use pulse pistol factory-sealed in printed plastic. Cheap, disposable, and loud enough to start a conversation.

**Range:** Near. **Damage:** 1. **Tags:** Disposable, Loud.

@end-gear-card

---

## Card Entries (Flaws / Ideals / Dreams) — Phase 1

@section .dc-flaws
@card
#### Megalomaniac
You have delusional fantasies of wealth or power. Their ambition has no ceiling.
> "I won't rest until I rule every inch of this world."

@end-card
@end-section

@section .dc-ideals
@card
#### Information Freedom
You value the free flow of information above all other rights.
> "If knowledge is locked away, it's already being abused."

@end-card
@end-section

@section .dc-dreams
@card
#### Build Something Real
Not fame. Not revenge. Just one thing that lasts after you're gone.
> "I want to leave something better than I found."

@end-card
@end-section

---
