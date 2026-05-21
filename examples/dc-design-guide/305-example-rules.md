@chapter #ch-example-rules .example-rules .chapter-03 ch="3"

# Rules Pages — Real-World Example {.dc-chevron}

@lede

This section shows how core rules pages look in the actual Dimm City Field Guide, rendered using real book content from chapter 03. Rules pages use standard prose, outcome tables, status condition tables, and rule-break callouts. No special macros — clean prose layout with DC typography.

@end-lede

---

## About Rules Page Layouts

@section .two-column

Rules pages are the workhorse of any RPG book. In Dimm City they follow a consistent structure across three page templates:

| Template | Chapter class | Contents |
|----------|--------------|----------|
| `page-chapter-start` | `.chapter-03` | Chapter opener fiction + intro prose (two-column) |
| `the-players` | `.chapter-03` | Dreams, Dreamers, Dream Master + ROLL A DIE! section |
| bare `@page` | `.chapter-03` | Status conditions table, AP rules, outcome ladder |

@column-break

Rules prose in DC uses a deliberately aggressive voice. The Dream Master section, for instance, isn't a neutral referee description — it's confrontational, second-person, and assumes the reader is ready to run something rough. The tone is part of the system.

The status conditions table uses standard GFM `|---|---|` syntax — `dc-components.css` applies alternating row backgrounds universally. The outcome ladder uses the `@outcome … @end-outcome` macro for tiered DC styling (crit/hit/mixed/miss/fail row colors). For a custom table header color, add `{.dc-table-crimson}` after the opening `|`.

@end-section

---

@page .chapter-start .chapter-03

@chapter-opener C.11

# C.1: Are You Lucid Yet? {#c1-are-you-lucid}

![01-street-sign](https://placehold.co/600x800/png?text=Street+Sign){.fg-art-street-sign}

Hologram haze cuts the gloom you're stumbling through. Flickering ads claw the air above blades of neon that contrast the scents of burnt oil and hot garbage. On the littered pavement around you, other pedestrians in the murk shuffle past, lit by glitchy devices and glowing bodymods.

A shadow peels off the wall—an ape a meter taller than you, leather flashing with LED stitches. The beast blocks your path with its corroded grin glinting under the signage.

"Where yeahs going, strutter?"

Behind him, a chorus of giggles breaks from the shadows moving closer.

"Hand over that cap," he growls. "Or we'll make you a bite late for yr appointy."

What's your next move?

---{.column-break}

In Dimm City, stakes is high and the death rate is higher. The scenario, like the one above, is presented to you by the Dream Master. Your role as the dreamer is to act how your character would act. The more fun you make for yourself and your friends through playing your characters well, the better the experience will be for everyone.

## How to Play

Each player takes on the role of a Dreamer — a character living and scraping through Dimm City. One player takes on the role of Dream Master and runs the world, its inhabitants, and its consequences.

The rules in this chapter govern how the Dream plays out: when you roll dice, how outcomes are interpreted, what it costs to push harder, and what conditions your character can suffer. These aren't restrictions — they're the physics of the Dream.

Learn the core loop first. Everything else builds on it.

---

@page .the-players .chapter-03

## Dreams {#c1-dreams}

In Dimm City RPG, you're not "pretending to be someone else." You're fighting for a pulse in a city that chews nobodies into mulch. You and your crew aren't telling a story—you're tagging the city with it. One of you hijacks the world as Dream Master (DM). The rest strap in as the degenerates desperate enough to survive it.

## The City

@section .two-column

Dimm City twitches like a clamped nerve at the edge of existence.
It leaks ferocity, spits day-glo venom, and remembers every screw-up you tried to bury under cheap lies and even cheaper concrete.
The streets look solid, but they shift like a glitch in a hallucination—half alive, half listening, all hungry.

This place isn't just a city. It's a stubborn stain on the fabric of the Monoverse, the endless mess of realities piled on top of each other like corrupted files. Dimm City refuses to be overwritten. It clings. It mutates. It survives every rewrite some cosmic architect tries to force on it.

@column-break

Nothing here is safe. Nothing here is free. If you want something in this rotting wonderland, you pay in blood, credits, secrets, or shame. Usually all four.

Other worlds dream of heroes and chosen ones. Dimm City dreams of people desperate enough to matter.

@end-section

## Dreamers

You're a Dreamer, not because you're special, but because you're reckless enough to try. You open your mouth, your character speaks. You make a move, your character bleeds for it. You want something? Take it.

The city doesn't care if you're heroic. It only remembers the ones who leave scars. A rare few burn bright enough to get noticed. Dimm City calls them Luminaries, not because they shine, but because they leave burn marks.

## The Dream Master

Across the table sits the Dream Master: not your boss, not your babysitter, not your damn referee. They're the city's gut reaction. They show the danger, keep the consequences sharp, and laugh when your plans dissolve like cheap plastic.

- You throw hands? They drop reinforcements.
- You hustle a mark? They remember who saw you do it.
- You pick a fight with the system? It hits back harder.

They don't stop you. They don't protect you. They just make sure the pain fits the crime.

@page .chapter-03

### ROLL A DIE! {#c1-rolling-the-die}

When something matters—really matters—the DM might call for a roll. One toss of a d20 decides if you rocket through a window like a legend… or face-plant into the curb with a mouthful of glass and regrets.

No dead rolls. No vanilla outcomes. If the dice show you teeth, you better bite back.

### Lucid & Surreal

Some abilities shift your odds.

@section .two-column

@definition

#### Lucid

Roll 2d20, take the higher. You're sharp, aligned, in control. When you roll a 20 in the dream, your next roll is Lucid!

@end-definition

@column-break

@definition

#### Surreal

Roll 2d20, take the lower. Reality pushes back. When you roll a 1 in the dream, your next roll is Surreal.

@end-definition

@end-section

### Augment Points (AP)

AP is your push. Your burn. Your "I'm doing this anyway."

If an ability lists an AP cost, you spend it and the effect happens. No charge-up. No waiting.

- **0 AP** — Free to use. Not always safe.
- **1–X AP** — You choose how hard you push. More AP usually means more distance, power, or targets.

### Status Conditions

Abilities don't just deal damage. They disrupt momentum, break positioning, and shut enemies down long enough for the pack to finish the job.

| Condition | Effect |
|-----------|--------|
| **Blinded** | The creature can only attack targets within reach. |
| **Dazed** | The creature cannot use special abilities. |
| **Deafened** | The creature cannot hear spoken words or sound-based effects. |
| **Frightened** | The creature rolls Surreal on all rolls and can only use their action and move to get away from the source of its fear. |
| **Mind Control** | The creature cannot willingly harm their controller and may follow or be controlled by its commands. |
| **Prone** | The creature is knocked down, must spend part of their move to stand, and then may only move to an adjacent space in reach. |
| **Silenced** | The creature cannot speak or use abilities requiring speech. |
| **Stunned** | The creature cannot move, act, or speak. |

@callout variant=note label="Ending Conditions"

A creature suffering a condition may attempt to end it at the time specified by the effect, usually at the start or end of its turn, by rolling 11 or higher on a d20.

On a success, the condition ends. Conditions usually end when the encounter ends, unless the effect specifies otherwise. In unclear situations, it's DM's call.

@end-callout

### Rolling the Die — Full Outcome Ladder

@outcome
20 | Triumph | Best-case outcome, extra impact
11–19 | Success | You do it
6–10 | Hard Choice | You succeed, but it costs you
2–5 | Failure | You don't get what you wanted
1 | Catastrophe | It goes bad, and then worse
@end-outcome

### Distance Tags

| Zone | Range |
|------|-------|
| **Reach** | Adjacent — close enough to touch |
| **Near** | Same room, line of sight |
| **Far** | Across a street, different room |

Most abilities specify which distances they work at. When in doubt, ask if you could throw something at it and hit — that's Near.

