@chapter #ch-example-dm-npcs .example-dm-npcs .chapter-03 ch="3"

# DM & NPC Pages — Real-World Example {.dc-chevron}

@lede

This section shows how Dream Mastery and NPC pages look in the actual Dimm City Field Guide, rendered using real book content from chapter 04. DM pages combine prose, callout blocks, and example sidebars. NPC pages use the stat block format: type line, HP/Damage, Traits, Equipment, and Cybernetics sections.

@end-lede

---

## About DM and NPC Pages

@section .two-column

The Dream Mastery chapter of the Field Guide is written entirely in second-person directed at the DM. It's the most voice-forward section of the book — not a neutral referee guide, but a manifesto for how to run Dimm City. The layout reflects this: long-form prose with frequent subheadings, bullet-list guidance blocks, and callout boxes for specific techniques.

NPC pages use a consistent three-tier format:

| Tier | HP | Damage | Role |
|------|----|--------|------|
| **Fodder** | 2 | 1 | Cannon fodder, civilian threats, mob encounters |
| **Operator** | 4 | 2 | Skilled grunts, tactical support, mini-bosses |
| **Master** | 10 | 4 | Main antagonists, unique threats, boss encounters |
{.dc-table-blue}

@column-break

Each NPC entry follows the same structure: a blockquote flavor line (in-world voice), a type/size designation, then H5 subsections for Traits, Equipment, and Cybernetics. The `---` dashed rule separates individual NPC entries within a tier. The tier headers are H3, individual NPC names are H4.

The stat block format is intentionally minimal — no special macro required. The `dc-components.css` styles H4/H5 headings inside the NPC sections automatically using the `chapter-04` page class.

@end-section

---

@page .chapter-04

## Dream Mastery

@section .two-column

Every Dream needs someone to light the fuse. That's you—the Dream Master.

You're not just the voice behind the curtain. You are the curtain. The smoke. The shadows in the alley. You set the tone, build the streets, throw curveballs, and breathe fire into the frame.

You're the storyteller, the scene-builder, and chaos coordinator. You spin Dimm City's razorwire threads into something raw, real, and just barely holding together.

@column-break

You play every lowlife, every beast, every storm creeping in off the skyline. You decide what hits. What hurts. What haunts.

Most of all? You make every dreamer's choices matter.

Crank up the tension—then let it breathe. When they win, make 'em feel it. When they fall, make 'em remember.

You're not here to run a game. You're here to make the Dream burn bright.

@end-section

### Core Elements

@dm-note

Dream Mastery ain't just running the game. It's breathing life into the Dream—then handing the knife to your players.

Your job? Guide, don't control. Shape the chaos without strangling it. Keep the world alive, twitching, and ready to bite back.

* Talk loud, listen harder: Speak with confidence when you're narrating—but really listen when your players talk. Their ideas, fears, and chaos fuel the Dream.

+ Flex your weird: Dimm City runs on strangeness. Lean into the bizarre. If it feels too odd, you're probably close to gold.

- Keep your dreamers safe—but never too safe: Protect your players, not their characters. Let the city be lethal. Let them bleed. Just make sure the players always feel supported at the table, even when their PCs get wrecked.

@end-dm-note

#### Focus on the Fantascape

@dm-note label="Fantascape Tips"

Create immersion by turning game mechanics into vivid fiction. Avoid blunt mechanics like "You deal 4 damage" and instead paint scenes with sensory details, keeping the rules behind the curtain.

* Instead of saying "You rolled an 11, you dodge the blast," you could say, "You dive behind a cracked ferrocrete pillar as the plasma spray explodes over your head, searing the wall black."

+ When a player scores a critical hit, don't just say "double damage"—say, "Your blade sinks deep into the enforcer's side, the force of the blow dropping him to one knee with a wet grunt."

- If a dreamer fails a Surreal roll while climbing, describe it as, "Your hands slip on the rain-slick metal rungs. Your foot scrapes for a hold, heart hammering, as you dangle above the alley's neon smear a 100 meters below!"

Bury the math inside the moment and build scenes that hit harder than the dice ever could.

@end-dm-note

---

## NPC Stat Block: Fodder

### Fodder

> Everyday creatures, not usually a combat threat but can become dangerous in mobs or with special roles.

Fodder are common, fringe threats—barely worth noticing on their own. But with the right numbers, traits, or upgrades, they can turn lethal fast. Fodder can be desperate civilians, low-tier gang members, kamikaze drones, or even mutated vermin. They're not tough or deadly solo—the danger comes from quantity or context.

HP 2 — Damage 1

---

#### Patchhead

> See a Patchhead comin' at you, you best move. Ain't no reasoning with 'em — minds melted and muscles twitchin' like they're about to burst. You can smell the burnt plastic and sweat long before they get close.

2 HP — 1 Damage
Fodder — Usually Small to Medium

##### Traits

**Bloodlust:** Patchheads add 1 to their Damage value whenever they hit a creature that is currently missing Hit Points.

##### Equipment

Patchheads will sometimes carry makeshift weapons like weighted chains, shivs, or knuckle dusters for brutal close-quarters combat, along with junk shields/crash helmets for basic protection. May also have a Shadowbit token with no more than 50-100 Dream Creds worth of crypto on it along with some other sketchy paraphernalia.

##### Cybernetics

UniArm 100 / Redi-Mobile Cyberleg / RedEye Optical Prosthetic (could be just one or all)

@tape label="Operators"

## NPC Stat Block: Operator

### Operators

*Tougher opponents that serve as grunts or support for their Master. Deadly in small groups or with traits that allow for tactical positioning.*

HP 4 — Damage 2

---

#### Grease Monkey

> You need something fixed, hacked, or turned into a weapon? Find a Grease Monkey. You need a battlefield rigged with enough traps to make a squad of cyborg mercs cry? Definitely find a Grease Monkey.

HP 4 — Damage: 2
Operator — Medium

##### Traits

**Climb:** Grease Monkeys have the ability to scale walls and other vertical surfaces with the same speed as they would otherwise move.

##### Equipment

**Monkey Wrench:** A handheld device that can be used once per encounter that scrambles wireless communications and disrupts cybernetic signals within a small radius. When activated, it forces all augmented targets nearby to perform a SysCheck at the next higher difficulty level, as the jammer destabilizes the delicate balance between biological and cybernetic systems.

##### Cybernetics

UniArm 100 Cyberarm w/Optalanges TechMech kit and Smuggler's Stash Level 1, Light Blaster Pistol

@tape label="Masters"

## NPC Stat Block: Master

### Masters

> Major characters with significant influence. These NPCs often require strategy and teamwork to defeat and may have additional special abilities or resistances.

HP 10 — Damage 4

---

#### Undertow

> Ain't no one sees Undertow comin'. One minute, you're walking the flooded alleys, thinkin' you're safe. Next thing you know, the water's draggin' you under, and you hear that low, rumbling laugh from somewhere in the dark. Undertow don't kill quick — they likes to watch you struggle before you sink!

HP 10 — Damage 4
Master — Medium

##### Traits

**Amphibious:** Undertow can breathe water or air and swim as fast as they move on land.

**Brineborne:** Undertow regenerates 1 Hit Point per round spent in salt water up to their max of 10.

**Stranglehold:** Undertow can attack one nearby target per round and grapple them on a successful hit, dealing 4 damage, locking their limbs, and preventing movement. Constricted targets must ROLL A DIE! (11+) to break free or suffer Surreal rolls anytime they ROLL A DIE! while grappled. Undertow maintains control for free, dealing 1 damage each round while the target remains trapped. However, while holding a target, Undertow can only make one basic attack against any other target within reach.

**Swim:** Undertow has the ability to move through water with the same speed as they would otherwise move on land.

---

### Size Modifiers

Size affects both hit points and damage output, scaling up or down based on how physically imposing the NPC is:

| Size | HP Modifier | Damage Modifier | Notes |
|------|-------------|-----------------|-------|
| **Tiny** | −1 HP | None | Small or frail creatures |
| **Small/Medium** | None | None | Default for most humanoids |
| **Big** | +10 HP | +1 Damage | Large beasts or imposing foes |
| **Huge** | +20 HP | +2 Damage | Truly massive creatures |
| **Colossal** | +40 HP | +4 Damage | Titanic creatures that dominate the battlefield |
{.dc-table-blue}

Size is a narrative choice as much as a mechanical one. A Colossal creature changes the encounter architecture — the DM should treat them like a location, not just a big target.

---

### Building Your Own NPCs

Every NPC in Dimm City is built from the same chassis: a tier, a flavor quote, a size, HP/Damage, and a list of Traits. The Traits are where NPC personality lives.

A good Trait does one of three things:

@procedure
1. **Creates positioning pressure** — forces Dreamers to fight at a disadvantage unless they account for it (see: Stranglehold, Bloodlust)
2. **Changes the environment** — Undertow in a flood district isn't just dangerous, they're regenerating while you're slowing down
3. **Rewards specific counters** — a Patchhead mob with Bloodlust rewards hitting hard fast; a Grease Monkey rewards disrupting their tech before they rig the battlefield
@end-procedure

Equipment and Cybernetics add texture and loot. They don't need to be tracked unless the DM decides they matter to the story.

---

### Quick NPC Builder

When you need an NPC fast, answer these four questions:

| Question | Example Answer |
|----------|---------------|
| **Who are they?** | A junked-out Patchhead mob guard with nothing to lose. |
| **What do they want?** | Drive the Dreamers out of the warehouse or die trying. |
| **What Trait makes them dangerous?** | Bloodlust — the more the Dreamers hurt, the more the mob escalates. |
| **What if they're handled cleverly?** | Offer the Patchheads something worth more than the job. They scatter. |
{.dc-table-gray}

That's it. That's an NPC. Stat it if combat is likely. Leave it sketched if it's just atmosphere.

