@chapter #ch-fg-npc-dm-spreads .fg-examples .chapter-03

# Field Guide: NPC & Dream Master Spreads {.dc-chevron}

::: wrapper {.dc-intro}
Dream Master chapter pages covering NPC design, stat blocks, and encounter building. These pages are addressed to the DM and use distinct visual treatment to separate them from player-facing content.
:::

---

## Pattern: NPC Tiers Introduction Spread

Opening spread of the DM's NPC chapter. Uses a `> [!DM]` callout to signal the DM-only register, a `.dc-definition-block` for each tier's one-line summary, and a reference table comparing Fodder / Operator / Master base stats. This is the canonical pattern for introducing a typed reference system to the DM before showing full examples.

@page .npc-types .fg-examples

## DIMM CITY IS ALIVE {.dc-chevron}

::: wrapper {.dc-intro}
From commons struggling in the sprawl to ganglords ruling the underworld, every NPC adds texture and danger to the story. Managing them efficiently while keeping them engaging maintains immersion without bogging down play.
:::

> [!DM]
> This guide is your back-alley blueprint for whipping up gritty, unforgettable NPCs without getting tangled in red tape. Keep it lean, keep it mean — these rules slot seamlessly into your campaign without dragging down the action.

### NPC Core Stats

NPCs are designed to feel distinct yet manageable, with streamlined stats to keep the game moving.

**Hit Points (HP):** How much damage an NPC can take before dying. Operators and tougher NPCs have more HP; Fodder have minimal HP. NPCs die immediately when reduced to 0 HP unless saved by the PCs.

**Damage Rating:** How much damage an NPC deals with a basic attack. The higher the rating, the more formidable the NPC. Damage types include acid, cold, fire, force, shock, necrotic, radiant, sonic, or trauma — hand-to-hand combat inflicts bludgeoning, piercing, or slashing.

**Traits:** Unique abilities that set an NPC apart — movement abilities, resistances, special attacks — giving NPCs a memorable edge.

**Equipment:** Gear that matches the NPC's role and enhances their traits. Fodder carry improvised weapons; Operators and Masters wield specialized gear.

**Cybernetics:** Augmentations that give NPCs a distinct edge in combat or utility.

---

### NPC Types

NPCs fall into three tiers from weakest to strongest. Never underestimate any of them — even the punkiest NPC can surprise dreamers.

::: wrapper {.dc-definition-block}
**Fodder** — Everyday creatures. Not usually a combat threat alone, but dangerous in mobs or with special roles. Base stats: 2 HP · 1 Damage.
:::

::: wrapper {.dc-definition-block}
**Operators** — Tougher opponents serving as grunts or support for their Master. Deadly in small groups with traits for tactical positioning. Base stats: 4 HP · 2 Damage.
:::

::: wrapper {.dc-definition-block}
**Masters** — Major characters with significant influence. Taking one down requires strategy, teamwork, and a little divine luck. Base stats: 10 HP · 4 Damage.
:::

| Tier | Base HP | Base Damage | Role |
|---|---|---|---|
| **Fodder** | 2 | 1 | Mob cannon fodder, disposable threats |
| **Operator** | 4 | 2 | Skilled grunts, tacticians, specialists |
| **Master** | 10 | 4 | Boss-tier, forces of nature |

> [!DM]
> Size modifiers stack on top of these base stats. Big: +10 HP, +1 Damage. Huge: +20 HP, +2 Damage. Colossal: +40 HP, +4 Damage. Tiny: −1 HP. Build your encounter math here, then layer in traits for the real danger.

---

## Pattern: NPC Stat Block Page

A full NPC entry spread showing three complete stat blocks — one per tier — followed by their traits, equipment, and cybernetics. The `dc-stat` HTML block is the only raw HTML permitted here; no macro exists for stat blocks yet. Each block is separated by a dashed `---` rule divider.

@page .npc-stat-blocks .fg-examples

### Fodder Example: Patchhead

> See a Patchhead comin' at you, you best move. Ain't no reasoning with 'em — minds melted and muscles twitchin' like they're about to burst. You can smell the burnt plastic and sweat long before they get close.

<div class="dc-stat flush">
  <div class="dc-stat-head">
    <div class="dc-stat-name">Patchhead</div>
    <div class="dc-stat-class">— Fodder · Small–Medium —</div>
  </div>
  <div class="dc-stat-grid">
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">HP</div><div class="dc-stat-cell-val">2</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">DMG</div><div class="dc-stat-cell-val">1</div></div>
  </div>
  <div class="dc-stat-line"><strong>Bloodlust:</strong> Patchheads add 1 to their Damage value whenever they hit a creature currently missing Hit Points.</div>
</div>

**Equipment:** Makeshift weapons — weighted chains, shivs, knuckle dusters. Junk shields or crash helmets for basic protection. May carry a Shadowbit token worth 50–100 Dream Creds and some sketchy paraphernalia.

**Cybernetics:** UniArm 100 / Redi-Mobile Cyberleg / RedEye Optical Prosthetic (one or all).

---

### Operator Example: Grease Monkey

> You need something fixed, hacked, or turned into a weapon? Find a Grease Monkey. You need a battlefield rigged with enough traps to make a squad of cyborg mercs cry? Definitely find a Grease Monkey.

<div class="dc-stat flush">
  <div class="dc-stat-head">
    <div class="dc-stat-name">Grease Monkey</div>
    <div class="dc-stat-class">— Operator · Medium —</div>
  </div>
  <div class="dc-stat-grid">
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">HP</div><div class="dc-stat-cell-val">4</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">DMG</div><div class="dc-stat-cell-val">2</div></div>
  </div>
  <div class="dc-stat-line"><strong>Climb:</strong> Scales walls and vertical surfaces at normal movement speed.</div>
</div>

**Equipment — Monkey Wrench:** A handheld device, usable once per encounter. Scrambles wireless communications and disrupts cybernetic signals within a small radius. All augmented targets nearby must perform a SysCheck at the next higher difficulty level.

**Cybernetics:** UniArm 100 Cyberarm with Optalanges TechMech kit and Smuggler's Stash Level 1. Carries a Light Blaster Pistol.

---

### Master Example: Chromejaw

> You hear the grinding of metal on metal before you see him — a towering mastiff sporos wrapped in salvaged armor, his cybernetic jaw clenching like a steel trap. When Chromejaw shows up, you've either crossed a line or stepped into the wrong part of town.

<div class="dc-stat flush">
  <div class="dc-stat-head">
    <div class="dc-stat-name">Chromejaw</div>
    <div class="dc-stat-class">— Master · Big —</div>
  </div>
  <div class="dc-stat-grid">
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">HP</div><div class="dc-stat-cell-val">20</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">DMG</div><div class="dc-stat-cell-val">5</div></div>
  </div>
  <div class="dc-stat-line"><strong>Ferocious:</strong> Gains an extra attack when hit points drop to half maximum.</div>
  <div class="dc-stat-line"><strong>Pulse Gauntlets:</strong> Heavy piston-powered punches knock targets into a nearby area. Struck targets must ROLL A DIE! (11+) or be thrown bodily. If thrown into solid objects or off ledges, worse things happen (DM's call).</div>
  <div class="dc-stat-line"><strong>Scrapcoat:</strong> Resistant to bludgeoning and slashing damage (takes half, round up).</div>
  <div class="dc-stat-line"><strong>Steeltrap Bite:</strong> On a successful hit, clamps onto a target dealing 5 piercing damage and preventing escape until the target ROLLS A DIE! (11+) to break free. Maintains control for free, dealing 1 piercing damage each round. While biting, Chromejaw can only make one basic attack against the held target — but that attack is <strong>LUCID!</strong></div>
</div>

> [!DM]
> Chromejaw's stats illustrate the size modifier formula: 10 HP (Master) + 10 HP (Big) = 20 HP; 4 Damage (Master) + 1 Damage (Big) = 5 Damage. His abilities do far more damage than raw numbers suggest — Ferocious, Steeltrap Bite, and Pulse Gauntlets together can lock down a party of four if they're not positioned carefully. Add Operator support and the fight turns deadly in a hurry.

---

## Pattern: Adventure Hooks & Encounter Seeds

A DM-facing spread presenting multiple adventure hooks for an NPC or district. Uses a `> [!DM]` framing note followed by a `:::two-column` layout to pack 3–4 hooks side-by-side. Each hook is a short, punchy narrative seed — intriguing, actionable, and personal. This is the canonical pattern for any "what to do with this NPC" or "session starter" page.

@page .adventure-hooks .fg-examples

## Building Your Dream {.dc-chevron}

> [!DM]
> Adventure hooks are the sparks that ignite a session. Offering multiple gives players a variety of paths — wanted posters, desperate NPCs, brewing gang wars, eerie rumors. Not every hook lands, so always have backups. A good hook is intriguing, actionable, and personal.

:::: two-column

### Region: Etherwave Transit Hub

A sprawling, flickering maze of cracked terminals and locked turnstiles. To reach their target, the dreamers have to traverse it — but something has triggered the automated lockdown.

**Points of Interest**

- **Last Bite** — a shanty soup shop with black-market supplies and a cook who's seen too much.
- **Drift Gate 7** — a busted platform rumored to lead into forbidden zones.

**NPCs**

- **Ticker** — a twitchy vendor who trades underground maps for batteries. Knows three ways out of the lockdown. Two of them are lies.
- **Wraith 17** — a merc working both sides of the line. Will sell the dreamers out for 200 Creds. Will sell their enemies out for 150.

---{.column-break}

### Adventure Hooks

::: wrapper {.dc-sidebar-box}
#### Dead Drop Gone Sideways

---

The fixer who hired the pack barely makes it out the noodle stall before a kamikaze drone detonates on him. The data chip with the mission details is still in the pack's hands — and now whoever sent the drone knows their faces.

**Hook:** Find out who killed the fixer before they finish the job.
:::

::: wrapper {.dc-sidebar-box}
#### The Wrong Cargo

---

Ticker's map leads the pack into a maintenance tunnel already occupied — by something the corp left behind when the lockdown triggered. It's not hostile yet. It's just watching.

**Hook:** Get past it, bargain with it, or wake it up and run.
:::

::: wrapper {.dc-sidebar-box}
#### Wraith 17's Offer

---

Wraith 17 pulls a dreamer aside and offers a clean way out of the Hub — if they deliver one pack member's name to his employer. He won't say who the employer is.

**Hook:** Trust the merc, find a third option, or let the others know.
:::

::::

> [!DM]
> Balance hope and fear across these hooks. Hope: tapping that server could buy the pack real breathing room — maybe even their own bolt hole in Tetherpoint. Fear: someone is hunting passengers trapped in the Hub, and one of the dreamers might be next on the list. Use both levers. Make victories feel earned and setbacks hit harder.
