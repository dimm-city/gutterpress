@chapter #ch-fg-gear-tech .fg-examples .chapter-03

# Field Guide: Gear & Tech {.dc-chevron}

::: wrapper {.dc-intro}
Equipment, cybernetics, and weapons pages from the Field Guide gear chapter. Three page patterns: the `:::aug` item grid, the cybernetics mechanics spread, and the weapons reference page.
:::

---

## Pattern: Useful Items Grid

The gear chapter opens with a `:::: wrapper {class="grid"}` outer container that auto-flows `:::aug` item cards into a two-column grid. Each card uses `#### H4` for the item name and a plain paragraph for the description — no classes on paragraphs, no inline stat lines.

**Authoring note:** `:::aug` is a registered named container (maps to `class="aug"`). The outer `:::: wrapper {class="grid"}` uses four colons and a quoted class attribute to create the grid shell. Items do not need a separate H3 tagline paragraph — unlike `:::gear-entry` (which expects italic taglines), `:::aug` items are pure prose descriptions.

@page .useful-items .fg-examples

:::: wrapper {class="grid"}

:::aug

#### Bypass Kit

A compact set of lock picks for mechanical and digital locks. Includes adjustable digital bypass tool, programmable fob for key-card and wireless mechanisms, and an EMP pen for last-ditch attempts on stubborn digitally operated portals.

:::

:::aug

#### Snake Cable

A 50-foot length of mechanized links that automatically coils, climbs, and anchors. Creates tightropes, rigid shapes, and secure holds. Controlled via linked remote, onboard cybernetics, or other connected devices.

:::

:::aug

#### TactMed Kit

A brick-size pouch with tourniquets, hemostatic agents, chest seals, airway tools, bandages, trauma shears, sutures, and medications. Restores 1 HP per use, once per cycle. Aids up to 5 individuals before depleted.

:::

:::aug

#### Firefly ANF

A palm-size pack that deploys 500 Autonomous Nanodrone Flares. Illuminates up to a 5-meter diameter at 14,000 lumens for ~4 hours. Drones can hold position, follow at distance, or encircle a target — all configurable via remote or neurointerface.

:::

:::aug

#### Com Tape

A roll of 50 micro-communicator stickers. Affix to the jaw below the ear for encrypted conversation with others from the same roll at any range within the same world. Active until the next cycle.

:::

:::aug

#### Dystopack

A modular field kit: large backpack with webbing (14 inventory slots, no slot cost), bedroll, mess kit, campstove, fire starter, adjustable shelter, multi-tool, rain gear, non-perishable rations, and a multi-stage water filter. Custom configurations vary.

:::

::::

---

## Pattern: Cybernetics Mechanics Spread

Cybernetics pages introduce the aug-and-mod economy: Ego Points (EP), Cybersuck degradation, and SysChk rolls. The spread uses `:::lede` for the opening hook, `> [!NOTE]` for rules clarifications, and a `:::procedure` for the SysChk resolution sequence. A `> [!WARNING]` anchors the SysFAIL consequences.

@page .tech-cybernetics .fg-examples

### Dimm City Tech

:::lede
Flesh breaks. Metal remembers. Every aug slices away at what makes you *you* — but the city runs on chrome, and chrome runs the city.
:::

Augs are cybernetic enhancements installed into the body. Each aug may support up to 6 mod slots. Most body parts (eye, skin, limb) allow 1 mod slot at DM discretion. All cybernetics must be installed by a trained Cybersurgeon in a medlab, clinic, or hospital.

## The Cost of Upgrades Is You {.dc-chevron}

Push past your limits and you don't run the gear anymore.

The gear runs you.

### Ego Points (EP)

Every aug has an EP cost — the measure of how much of your original self you trade for the upgrade. Your EP pool is fixed at character creation. Each aug you install reduces your remaining EP. When EP hits zero, you stop being who you were and start being whatever the chrome needs you to be.

> [!NOTE]
> EP is not HP. Losing EP is permanent unless a Cybersurgeon surgically removes augmentations. The city doesn't do refunds.

### Cybersuck

Cybersuck is the ambient cost of running too much chrome. Every aug past your EP limit adds a cumulative penalty to social rolls, empathy checks, and any action that requires you to feel like a person instead of a machine.

> [!WARNING]
> Technosorcerers are exempt from standard Cybersuck — they've already traded their humanity for root access to the static. They remain subject to SysFAIL on system overload.

### SysChk

When your cybernetics take damage, malfunction, or are subjected to hostile intrusion, roll a SysChk to avoid cascade failure.

:::procedure
1. **Declare the trigger.** DM confirms which aug is affected — damage, hack attempt, or environmental stress.
2. **Roll the die.** Beat your aug's SysCheck threshold or enter SysFAIL.
3. **On success.** The aug holds. Note any degradation if specified.
4. **On failure.** Proceed to SysFAIL consequences — the aug goes offline, misfires, or fights back.
:::

> [!DM]
> SysChk rolls are drama tools, not punishment loops. Call for them when a malfunction adds to the scene — a assassin's arm going haywire mid-strike, a hacker's eyes glitching at the worst moment. Skip them when the outcome wouldn't change anything interesting.

---

## Pattern: Weapons Reference Page

Weapons use a `:::: two-column` layout (four colons) with `:::aug` cards (three colons) in each column. Each weapon card is an `#### H4` name followed by plain prose stat lines. No pipe tables for individual items — the card format keeps each weapon scannable without table overhead.

@page .blasters .fg-examples

:::: two-column

:::aug

#### Pulse Pistol

**Damage:** 1d6. **Range:** Near. **AP:** 1.

Standard sidearm. Compact, reliable, and street-legal in three of five districts. The capacitor hums when charged. Smart shooters learn not to let it get quiet.

:::

:::aug

#### Scatter Rig

**Damage:** 2d4. **Range:** Close. **AP:** 2.

Single-shot scatter blast. Devastating at intimate range; nearly useless past arm's length. Reload takes a full action. Operators who carry these want the conversation short.

:::

:::aug

#### Sync Rifle

**Damage:** 1d8. **Range:** Far. **AP:** 2.

Requires a clear line of sight and a steady hand. Neural-linked variants reduce AP cost to 1 for users with compatible targeting implants. The city's snipers don't miss twice.

:::

:::aug

#### Throwaway Blaster

**Damage:** 1d4. **Range:** Near. **AP:** 1.

Disposable single-use sidearm. Untraceable, inaccurate, and cheap enough to leave at the scene. Commonly found in bulk at unlicensed stalls in the Neon Bazaar. Once fired, discard.

:::

::::

---

## Component Authoring Quick Reference

| Component | Authoring method | Notes |
|---|---|---|
| Item grid (outer) | `:::: wrapper {class="grid"}` | Four colons; quoted class attribute |
| Item card | `:::aug` + `#### Name` | Named container; plain prose body |
| Cybernetics intro | `:::lede` | Opening hook paragraph |
| Rules clarification | `> [!NOTE]` | Standard alert callout |
| SysFAIL warning | `> [!WARNING]` | Amber alert variant |
| DM guidance | `> [!DM]` | Dream Master addressed content |
| Procedure list | `:::procedure` + ordered list | Zero-padded steps via CSS counter |
| Weapon column | `:::: two-column` + `:::aug` cards | Four colons outer, three inner; column break with `---{.column-break}` |
