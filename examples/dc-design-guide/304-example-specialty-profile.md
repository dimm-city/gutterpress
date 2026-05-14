@chapter #ch-example-specialty-profile .example-specialty-profile .chapter-03 ch="3"

# Specialty Profile — Real-World Example {.dc-chevron}

:::lede
This section shows how a full specialty profile looks in the actual Dimm City Field Guide, rendered using real book content from the Augmerc chapter. A specialty profile combines the `@specialty` macro, intro block, art panel, `@learning-path` macro, and a sequence of `@skill` cards — all live DC components.
:::

---

## Specialty Intro Block

**Macros** — `@specialty {.augmerc}` wraps the entire specialty section and applies specialty-scoped CSS. The `.specialty-intro` wrapper holds the name, definition, and Spec Tweak. The `.specialty-art` wrapper holds the character illustration. `@learning-path` injects the path header and path sequence list. Long abilities should use `@continue` inside `@skill`. See [DC Components](#ch-dc-components) for the full `@specialty` / `@learning-path` / `@skill` macro reference.

@page

@specialty {.augmerc}

:::wrapper {.specialty-intro .variant-2}

## Augmerc

An Augmerc is muscle for hire. Street thugs, corporate bodyguards, deniable enforcers — the difference is gear, grafts, and how much of them is still original. Some run with packs, some lone-wolf it. Either way, most don't get paid until the job is done.

This heavy fights with skill, weapons, and tuned augmentation. The best are trained-up, tooled-up, and rebuilt with chrome, grafts, and salvaged tech. How much meat, metal, or monster your Augmerc carries is up to you.

If you want to start quickly, choose these abilities: Punishing Counter, Rage Hit, Spit Flame, Bodycover, Rub Some Dirt on It!, and Size Up.

### Spec Tweak: **Wired to Kill** {.dc-spec-tweak}

Augmerc techniques are partly natural.

Their learning paths assume the presence of combat-grade augmentations installed in the body: reinforced bones, reflex accelerators, adrenal regulators, neural predictors, and battlefield processors. These implants are rugged, brutal, and often salvaged from military or industrial hardware.

Each Augmerc learning path lists a Signature Augment—a common piece of cyberware that enables the techniques within that path.

You do not need to track these implants as separate equipment unless the Dream Master decides damage, upgrades, or removal become part of the story. Without the implants, the Augmerc spends 1 extra AP to activate the paths abilities.

They are simply part of what makes an Augmerc dangerous.

:::

:::wrapper {.specialty-art}

![Augmerc](https://placehold.co/600x800/png?text=Augmerc){.augmerc}

:::

---

## Learning Path: Biting Distance

**Macro** — `@learning-path` renders the path header banner and the ability sequence list. The Signature Augment block follows the path list as prose. Each `@skill variant="2"` card renders a titled ability card with AP cost options and outcome tables. Use `@continue` when a card needs to flow onto the next page. See [DC Components](#ch-dc-components) for full `@learning-path` and `@skill` syntax.

@learning-path variant="2"

### Biting Distance

> If you can touch it, you can maul it. When things get close, they bleed.

- Punishing Counter
- Rage Hit
- Dirty Work
- Pain Compliance
- It's Personal

**Backbiter Spines:** Anyone who walks the Biting Distance path installs reactive spine rigs in the forearms, shins, or wherever their street doc could wedge the hardware. Beneath the skin sits a row of hungry metal waiting for contact.

When creatures crowd into reach, you can trigger the system to bloom outward in a form you choose upon implant: blades, spikes, studs, or writhing polyalloy pseudopods. Spending an action doing nothing but defending, the rig braces and answers every swing, letting you resist 2 damage from all melee attacks and dealing 1 damage to all creatures in reach at the start of your turn.

@skill variant="2"

#### Punishing Counter

> See an opening, ya take it. Best time to hit 'em is when they think it's over.

When an enemy falters, you may trigger one of the following counters:

1. **0 AP** *Steel Says No:* When an enemy in reach makes a basic attack and rolls a hard choice or worse, your Backbiters knock the strike off line. No damage. On a Failure or worse, try to drive steel into their liver. **ROLL THE DIE!** and make a basic attack. Free counter once per round.
2. **2 AP** *Bullet to Blood:* When an enemy you can see makes a ranged basic attack and rolls a hard choice or worse, you slip the shot as it screams past. No damage. On a failure or worse, you surge forward through the smoke and muzzle flash. Close to get in reach if a clear path exists and **ROLL THE DIE!** to make a basic attack. Free counter once per round.
3. **2 AP** *Bad Timing:* When an enemy in reach rolls a Hard Choice or worse on a basic attack against you, your Backbiters snap out and steal the moment. No damage and you have their weapon. On a Failure or worse, ROLL THE DIE! and make a basic attack using your weapon or theirs. On a Catastrophe, your hit deals double damage, and against a Master you can take their weapon. Free counter once per round.

Openings are invitations to take a chunk out 'em.

@skill variant="2"

#### Rage Hit

> In some situations, it's best to risk it, swing wild, an hit hard!

1. **0 AP** *Full Send:* You throw everything into a reckless attack. Make it your signature. Describe the chaos and **ROLL THE DIE!** Resolve the outcome below.
2. **2 AP** **ROLL THE DIE TWICE!** *All Gas, No Brakes:* Make two basic attacks against one target. If either roll is a 1, both attacks catastrophically fail as your movement snags on gear, armor, or the environment at the worst possible moment. DM's call on how bad it gets.

##### Outcomes

| Roll    | Outcome          |
| ------- | ----------------|
| 20      | You deal quadruple damage (or double a special weapon's damage).|
| 11 - 19 | You deal double damage.|
| 6 - 10  | You deal double damage to the target, but they counter with a basic attack.|
| 2 - 5   | You miss. The target immediately counters with a Lucid basic attack that deals 1 extra damage. |
| 1       | You fall prone and lose your next turn. The target immediately counters with a Lucid basic attack that deals double damage. |

Until the start of your next turn, any enemy that starts their turn in reach of you takes 1 damage as your Backbiters stick anything that moves too close.

Full send or full regret.

@skill variant="2"

#### Dirty Work

> Fair fights are for nice mercs who lose.
> Never fight clean. Fight to finish.

Once per round, outside your turn, you exploit a target in reach. Choose one technique:

| AP | Technique | Effect |
| -- | --------- |------- |
| **0** | **Off-Hand Insurance** | Slip in a hidden strike. Make an attack that deals **1 damage**.|
| **1** | **Street Tricks**      | Snag their balance with a sweep, throw somethin grody at 'em, or disrupt the moment. Gain **Lucidity** on your next roll against the target and deal **+1 damage** on hit.|
| **1** | **Break the Read**     | Fake 'em out or misdirect their focus. **ROLL THE DIE!** If you hit, the target is **Dazed**. At the end of their next turn, they must **ROLL THE DIE!** On a **10 or less**, the condition persists until the end of their next turn.|
| **1** | **Hook and Control**   | Stick to them like glue. The target's next roll against you is **Surreal**, and your next roll against them is **Lucid**.|
| **2** | **Cheap Shot**         | Break something important. Sight, breath, balance, or nerve. **ROLL THE DIE!** If you hit, the target must **ROLL THE DIE!** On a result of **10 or less**, they are **Blinded** or **Stunned** until the end of their next turn. **CHOOSE ONE EFFECT!**|

You don't need an opening. You make one.
