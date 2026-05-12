@chapter #ch-fg-rules-spreads .fg-examples

# Field Guide: Rules Spreads {.dc-chevron}

::: wrapper {.dc-intro}
Representative rules chapter pages demonstrating multi-column layout, callout components, outcome tables, and reference spreads. Each pattern shows a distinct authoring technique drawn from the Field Guide's core rules chapter.
:::

---

## Pattern: Rules Introduction Spread

Two-column prose introduction to a core rules concept. Uses `:::two-column` with a `---{.column-break}` to balance copy across the spread. A `:::sidebar` floats a Dice Etiquette callout alongside the body text, and a `> [!NOTE]` anchors the key rule at the end. This is the canonical opening pattern for any "how this works" page that leads into a mechanic.

@page .rolling-die .fg-examples

::: wrapper

## ROLLING THE DIE!

When you **ROLL THE DIE!**, you're handing the dream your fate.

The Dream Master calls for a roll whenever you're trying something risky — or when the story tilts toward chaos. Good DMs roll with reason. Whenever you throw a punch, fire a shot, or make a desperate move, you roll.

But it ain't all just violence. You ROLL THE DIE! when you:

- Try to hotwire a locked-down mag-door before corpsec finds you.
- Sprint across a collapsing skybridge with the drop yawning under you.
- Sweet-talk a fixer with your last few credits on the line.
- Hack into a syndicate's comms while sirens scream in the distance.
- Bluff your way past a checkpoint with a half-burnt ID.

Anytime the stakes are real, anytime failure would hurt — that's when the Dream Master points at you and says: **"ROLL THE DIE!"**

:::

:::sidebar

::: wrapper {.dc-sidebar-box}
#### Dice Etiquette

---

Roll on a flat, clean surface in the open where everyone can see.

If your die bounces off the table or lands on the floor? **REROLL THE DIE!** No debate. No "but it was a 20!" whining.

Rolling in the open keeps the dream honest. Own your rolls — sometimes a brutal failure makes a better story than a perfect win.

**Playing Online?** Use your VTT's built-in roller, or a public dice roller everyone trusts. Pick your method as a pack before you dream — then stick to it.
:::

:::

:::two-column

Look at the top number on your 20-sided die and check the Table of Outcomes. That number seals your next few heartbeats. The DM reads the fall of the die — and the dream warps around it.

Nail it, and you might skate through clean. Blow it, and the dream might take a bite out of your hide:

- Lose a key item.
- Bleed a friend or yourself by mistake.
- Face a cruel choice that rips options off the table.

THINK before you roll. Most times, talking is smarter than swinging. But if you start a fight in Dimm City, you better be ready to finish it — or get finished.

---{.column-break}

### Lucid and Surreal Rolls

Certain moments twist the Dream — pushing you closer to extreme success or tipping you into disaster.

| Modifier | Effect |
| -------- | ------ |
| **Lucid** | Roll two dice and pick the higher result. Dreamers are always Lucid after a natural 20. |
| **Surreal** | Roll two dice and pick the lower result. Dreamers are always Surreal after a natural 1. |

**No stacking.** Even if multiple effects would make you Lucid or Surreal, you only roll one extra die. If you're both Lucid and Surreal at once, they cancel — roll once, plain and simple.

> [!NOTE]
> Smart moves earn momentum. Dumb risks tilt the Dream against you. THINK before you roll — the die doesn't care about your plan.

:::

---

## Pattern: Outcome Ladder Page

A full-page Table of Outcomes using the `@outcome` / `@end-outcome` macro. The five rungs are color-coded by result severity and auto-labeled by the plugin. This is the canonical way to present d20 result ranges in the Field Guide — never use a plain markdown table for outcomes.

**Page class** — `@page .outcome-table .fg-examples`

**Tier mapping** — rows are assigned tier classes in order: crit → hit → mixed → miss → fail

```markdown
@page .outcome-table .fg-examples

### Table of Outcomes {.dc-section-h3}

@outcome

20 | Crit | Automatic success. No further roll needed.
11–19 | Hit | You succeed cleanly.
6–10 | Hard Choice | You succeed, but the DM offers two costly options.
2–5 | Miss | You fail. The consequence is what you had riding on it.
1 | Catastrophe | Automatic fail with a severe setback.

@end-outcome
```

Add `> [!DM]` callouts after the table for facilitator guidance on each tier.

**Live specimen:**

@page .outcome-table .fg-examples

### Table of Outcomes {.dc-section-h3}

@outcome

20 | Crit | You flow. Automatic success — no further roll needed. If dealing damage, check your weapon's bonus stats. Your next die roll: ROLL LUCID.
11–19 | Hit | You succeed at what you were trying to do without a hitch. If attacking, deal standard damage based on your weapon's stats.
6–10 | Hard Choice | You succeed, but at a cost. Weapon overheats, ammo burns, or the situation complicates. The DM offers two impactful options — pick one. Both should hurt.
2–5 | Miss | You fail. The only consequence is what you had riding on the roll. Miss an opponent in a duel? They get to attack you on their turn.
1 | Catastrophe | Dark. Automatic fail with a severe setback — broken gear, cyberware malfunction, or friendly fire. Your next die roll: ROLL SURREAL.

@end-outcome

> [!FLAVOR]
> Nail it, and you might skate through clean. Blow it, and the dream takes a bite.

> [!DM]
> The Hard Choice result (6–10) is the most powerful tool in your kit. Offer two options that both matter — tactically, narratively, or personally. Never offer a soft out. If neither choice stings a little, you're doing it wrong.

---

## Pattern: Distances Reference Page

A reference spread combining a definition-list layout with short keyword entries. Uses `:::two-column` to pack four distance tiers side-by-side, followed by a plain `> [!NOTE]` rule clarification. This pattern works for any reference page with 3–6 named concepts of roughly equal length.

@page .distances .fg-examples

## Distances {.dc-spray}

> [!FLAVOR]
> You tell the Dream Master you want to slash it with your claws. The DM gauges where you are in the scene and tells you where you stand.

:::two-column

:::item
### In Reach

The target is right there — close enough you can smell their blood pumping. One swing and you're in it. No steps needed. You can still move after if you need to bail.
:::

---

:::item
### Nearby

The mark is just out of arm's length, a few meters across broken pavement. Burn your move to close the gap. Once you're in their grill, you can still act this turn.
:::

---{.column-break}

:::item
### In Range

They're hanging back behind a rusted wreck or flickering vending machine. You can throw a ranged shot. If you want to reach them in melee, spend this round closing — you'll be in reach next round.
:::

---

:::item
### Too Far

Might as well be on the other side of the ether. Too far to touch this turn even with a sprint. Burn your move and your action just to scrape into range — and expect they'll move again if they're not dumb as a box of rocks.
:::

:::

> [!NOTE]
> Targets move. Battlefields shift. If you want to close on something at Too Far, expect two full turns of bad ground. Nothing stays still.

:::procedure
1. **Declare your move.** Name the target and your intent.
2. **DM gauges distance.** They call In Reach, Nearby, In Range, or Too Far.
3. **Spend movement if needed.** Nearby costs your Move. In Range means you close this turn and act next.
4. **Act or wait.** Too Far? Spend Move + Action just to close the gap.
:::
