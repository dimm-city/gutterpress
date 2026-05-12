@chapter #ch-fg-specialty-profile .fg-examples .chapter-03 ch="3"

# Field Guide: Specialty Profile

## Pattern: Two-Page Specialty Spread

A specialty profile opens every class chapter in the Field Guide. It establishes the specialty's identity on the left page and immediately moves into the first learning path on the right — the whole chapter is built from this repeating spread unit.

The opener always contains two wrappers side-by-side:

- **`.specialty-intro`** — name heading (H2), 3–5 paragraphs of flavor prose, a quick-start bullet sentence, and a `### Spec Tweak` block with the mechanical hook
- **`.specialty-art`** — a single full-bleed image keyed to the specialty class name

After the intro spread, each `@learning-path` opens a new two-page unit: the path banner (H3 + blockquote + sticker bullet list + signature intro prose) on the left, the first `@skill` card on the right. Subsequent skills flow across the remaining pages of the path.

The `@specialty {.classname}` wrapper closes after all learning paths with `@end-specialty`. Within the specialty block, `@learning-path` and `@end-learning-path` scope each path. Skill sequence numbers (`PRX1.1`, `PRX1.2`, …) are computed automatically — do not write them in the heading.

---

## Specimen: Proxy Specialty

The content below is a complete, print-ready rendering of the Proxy specialty opener and its first two learning paths, demonstrating every structural element in its final form.

@specialty {.proxy}

::: wrapper {.specialty-intro}

## Proxy

Belief burns bright in Dimm City, and Proxies carry the sparks others cannot hold. A word that stops a heart, a prayer that drags a soul back to its feet. They shield their pack with conviction and unleash terrible judgment on those who deserve it.

Pick a Proxy to refuse despair, expose lies, and bring the weight of belief crashing down when the moment demands it. From shrine-raised paladins to corporate inquisitors to sanctioned executioners, these agents of faith turn conviction into authority.

Most Proxy stand on three pillars: hope, power, and judgment.

Some lift the fallen. Others bend the impossible. And some decide who deserves mercy at all.

Every Proxy serves something greater. Everyone else eventually answers to them.

If you want to start quickly, choose the Zeal Stitch, Blind to Fate, Second Guess, Bloodied but Breathing, Divine Intervention, and Force of Faith abilities.

### Spec Tweak: **Unyielding Faith**

Your unshakable belief in your god or cause strengthens you in the face of adversity. You <ins>always</ins> **ROLL A DIE!** to resist fear and mind-control effects at the end of your turn and it's <ins>always</ins> rolled with Lucidity.

When you succeed on such a roll, choose one:

- Deal 2 radiant damage to the source of the effect
- Immediately end one fear or mind-control effect affecting a nearby ally
- This Spec Tweak is reactive and requires no action on your turn.

:::

::: wrapper {.specialty-art}

![Proxy](img/placeholder-plate.png){.proxy}

:::

@learning-path

### Refuse Finality

> Nothing ends while you are still standing.

- Zeal Stitch
- Borrowed Mercy
- Redline Rhythm
- Purging Orison
- Invigorating Litany

Proxies on the Refuse Finality path hold the line between their crew and the dark. They pour conviction into open wounds, speak mantras that keep broken bodies breathing, and call upon their ideal to restore what despair and violence have taken. Where other specialties end encounters, these Proxies make sure their pack survives long enough to see the next one.

@skill variant="4"

#### Zeal Stitch

> Your zeal is not fury, but light refusing the shadows.

1. **0 AP** You grasp a willing creature in reach or clamp a hand over your own wound, pouring the light of your conviction into the injury as bioluminescent threads stitch flesh together. **ROLL A DIE!**

| Roll  | Result |
|-------|--------|
| 20 | The target is completely restored to maximum HP. Wounds seal and scars tighten. The glow of your power flashes for all to see. All nearby enemies are blinded until the end of your next turn. |
| 16–19 | Heal 5 HP as torn flesh knits under your burning resolve. Until the end of your next turn, any enemy that ends their turn in reach of the target takes 1 radiant damage that cannot be reduced in any way. |
| 11–15 | Heal 3 HP. The wound closes and the target's skin glows faintly until the end of their next turn. |
| 6–10 | Heal 2 HP, but the process is harsh. The target feels the stitch as nerves flare, muscles spasm, or breath catches. |
| 2–5 | Your zeal falters and fails to take hold. Nothing happens. |
| 1 | Your heartfire burns bright but finds no purchase. No healing occurs, and the display may read as hollow bravado or desperate theater. |

Your light heals what it touches.

@skill variant="4"

#### Borrowed Mercy

> For a moment, suffering looks elsewhere.

1. **2 AP** You invoke your devotion: whether to a deity, an ideal, or a personal creed. This show of faith projects sustaining force into the fray. You and all nearby allies immediately heal 2 HP.
1. **3–X** You may commit more of yourself to the cause when invoking this ability. Each additional AP is a promise, oath, or belief you refuse to break. For each AP spent, increase the healing by +1 HP.

Healed allies emit a faint glow. The first time a healed ally is damaged before the end of the next round, the attacker takes radiant damage based on the total AP committed:

- Single Proxy: 1 radiant damage per 2 AP (round down)
- Multiple Proxies: Total AP ÷ 2 (round up) + number of contributing Proxies

All AP must be committed when the ability is activated.

Through your will, wounds wait their turn.

@skill variant="4"

#### Redline Rhythm

> It's not pretty. It's not poetic. It's the words and rhythms that keep bodies breathing when everything else wants them broken.

1. **3 AP** You use your action to begin a driving mantra, prayer, or coded phrase that locks your crew into survival mode.

While the mantra continues, nearby allies:

- Heal 1 HP at the end of your turn.
- Are immune to fear while they remain nearby you.

The rhythm continues until the encounter ends or the mantra stops.

**Maintaining the Mantra:**

- Each turn you must spend your action to continue the mantra.
- While maintaining it, you cannot use other abilities.
- If you are silenced, stunned, or choose to stop, the rhythm ends.

1. **2 AP** When you spend your action to maintain *Redline Rhythm*, you may turn the mantra harsh and punishing while it continues to heal allies.

Until the end of your next turn, enemies nearby you take 1 radiant damage when your turn ends.

Survival answers to violent rhythm, not mercy.

@end-learning-path

@learning-path

### Final Reckoning

> Speak the truth they buried. Burn the lies they breathe.
> Set the soul straight or break it trying.

- Bloodied but Breathing
- Forced Confession
- We See You
- Burn Away
- Break Your Demons

Proxies on the Final Reckoning path are not healers. They are exposers. They drag hidden guilt into the open, compel confession from those who would lie, and stun enemies still with the weight of their own crimes. Where Refuse Finality keeps allies alive, Final Reckoning dismantles the opposition from the inside out — through truth, shame, and conviction weaponized.

@skill variant="4"

#### Bloodied but Breathing

> Pain is data.
> Death is authorization.
> Override it on command.

1. **0 AP** You inspire a nearby creature by reciting a meaningful statement to them. You may invent a famous quote or proverb, or borrow one from the real world. The creature must be able to hear and understand you and cannot currently be hostile toward you.

The target refuses to stay down. Choose one:

- If knocked prone, they stand and may make a basic attack or move to a nearby area.
- If stunned or paralyzed, they may take either an action or move on their next turn. The effect persists.
- If affected by fear or mind-control, they may ignore the effect on their next turn. The effect persists.
- If dropped to 0 HP but still alive, they immediately gain 1 HP and stand.

Until the end of the encounter or scene:

- They roll Lucid to resist fear or mind-control effects. If no resistance is normally allowed, they may roll at the end of their next turn.
- The next offensive roll they make in direct pursuit of survival is Lucid.

Get up before the razor rats catch your scent.

@skill variant="4"

#### Forced Confession

> LOOK ME IN THE EYES AND SAY THAT AGAIN!

1. **1 AP** Your eyes burn with multihued flame as you lock onto a nearby creature and seize their will.

**ROLL THE DIE!**

| Result | Effect |
|--------|--------|
| 20 | Triumph — For 5 minutes, the target answers all questions truthfully; you may set a real timer at the table. |
| 11–19 | The target must answer up to three questions truthfully. |
| 6–10 | The target must answer one question truthfully. |
| 2–5 | The target resists and knows you attempted to compel them. |
| 1 | Catastrophe — The ability backfires. The target may compel you to answer one question truthfully, and your surface thoughts are revealed to them until the end of the current round. |

After the target answers truthfully, your rolls against them are Lucid for the rest of the encounter. If you ever roll a Catastrophe against them, the effect immediately ends.

Confession is the last soft option.

@skill variant="4"

#### We See You

> You don't threaten them.
> You expose them.

1. **2 AP** You deliver a verbal condemnation to a group of NPCs within earshot. Choose a flaw, injustice, or betrayal relevant to the situation. You must call it out aloud in your own words — something specific and damning.

Affect all nearby fodder, or instead half (round down) the fodder and one operator, one-quarter of the fodder and two operators, or up to three operators if no fodder are present.

All affected creatures who can hear and understand you are stunned in shame, guilt, or awe (DM's call).

They cannot move, act, or speak until:

- You leave the area,
- Someone harms them, or
- You take an action other than continuing to speak your condemnation.

When affected creatures recover from the stun:

- They remember your accusation.
- Your allies gain Lucidity on social rolls against them until the end of the encounter.

Masters are unaffected, but may still react with discomfort, defensiveness, or uncertainty to your judgment.

If someone outside your pack tries to shake the effect, the motivator and Proxy each roll a die. Proxy wins: the effect holds. Motivator wins: the effect ends.

Creatures previously affected who act against you take 1 trauma damage on the first action they take against you or your pack.

Shame is heavier than chains.

@end-learning-path

@end-specialty
