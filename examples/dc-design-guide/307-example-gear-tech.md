@chapter #ch-example-gear-tech .example-gear-tech .chapter-03 ch="3"

# Gear & Tech — Real-World Example {.dc-chevron}

::: wrapper {.dc-intro}
This section shows how gear, aug cards, and cybernetics pages look in the actual Dimm City Field Guide, rendered using real book content from chapter 05. Gear pages use the `.aug` card inside a `.grid` wrapper for multi-column card layout. Cybernetics pages use dense prose with tables. Images replaced with design guide placeholder.
:::

---

## Useful Items Page — Aug Card Grid

**Page template** — `@page .chapter-start .useful-items .chapter-05` — chapter-start layout for the gear chapter opener. The card grid uses `:::: wrapper {class="grid"}` containing multiple `::: aug` containers. Each `.aug` block renders as a bordered card with the item name as an H4 heading and prose description below. No macros — this is pure markdown-it-attrs container syntax. See [Field Guide Components](#ch-fg-components) for the `.aug` card spec and [Layout](#ch-layout) for the grid system.

@page .chapter-start .useful-items .chapter-05

### Useful Items

:::: wrapper {class="grid"}

::: aug

#### Bypass Kit

A compact set of lock picks that can be used to attack simple to complex mechanical locks. The kit also includes an adjustable digital lock bypass tool, an on-the-fly programmable fob to circumvent key-card locks and wireless mechanisms, and an EMP pen for last-ditch attempts to attack stubborn digitally operated portals.

:::

::: aug

#### Snake Cable

A 50-foot length of mechanized links that can automatically coil itself, climb and attach itself to higher or lower ground, project out over a horizontal gap and attach itself to create a tightrope, or secure up to a big inanimate (or animate) object. The cable can be locked rigid in a variety of shapes and can be used for much more than climbing. It can be controlled using a linked remote, through the user's onboard cybernetics, or other connected external devices.

:::

::: aug

#### Cleaner Cup

Water scarcity is a universal problem. Different sectors of Dimm City have a variety of ways to acquire and supply water for the populace. This fact alone is reason to carry a personal water filter capable of removing both chemical and biological pollutants. Most, but not all, cleaner cups are incapable of filtering radioactive water but do a good job removing carcinogens and bacteria from contaminated water present throughout the five districts.

:::

::: aug

#### Firefly ANF

This black plasteel wallet pack, when activated, discharges around 500 Autonomous Nanodrone Flares that can illuminate up to a 5 meter diameter with up to 14,000 lumens (all variables are completely customizable through the remote control or paired with a neurointerface) for around 4 hours. The nanodrones can remain stationary, follow at a predetermined distance, or surround you or an ally/foe/associate.

:::

::: aug

#### Com Tape

What looks like a simple roll of tape actually contains 50 individual stickers. When applied to the jaw just below the ear, these mini-communicators allow for encrypted conversation with other users (affixed with tape from the same roll) at any distance within the same world. The device stays active until the next cycle begins.

:::

::: aug

#### Dystopack

Life on the streets is hard, but it can be 100% easier with the right gear. The dystopack comes in a variety of different forms, but usually includes: a large convertible backpack with webbing with a pack cover (expands your inventory to 14 slots without taking a spot itself), a bedroll (sleeping bag, air mattress, and waterproof tarp), a mess kit/mini-campstove/fire starter combo, an adjustable shelter with guy lines, a multi-tool, Everstick Reusable Tape, Rain gear, a variety of non-perishable food, and a water container with a multistage filter. Custom Dystopacks may include more or less of the above.

:::

::::

---

## Useful Items — Second Page

**Page template** — `@page .useful-items .second-page .chapter-05` — continues the gear chapter on a new page using the same `.aug` card format. Individual items without a surrounding grid render as single full-width cards.

@page .useful-items .second-page .chapter-05

### Useful Items

::: aug

#### BioGrip

A cutting-edge adhesive developed through state of the art biotechnology techniques harnessing a particularly rare species known as MycoAdhereus. This groundbreaking glue exhibits exceptional bonding capabilities and combined with a bio-compatible polymer matrix, the result is an adhesive that offers unrivaled strength, flexibility, and durability making it an ideal solution for a wide range of industrial and consumer applications. One resealable syringe of this glue is enough to handle a few small jobs up to one large one at your DM's discretion.

:::

::: aug

#### TechMech Kit

Any gearhead, hacker, or cyberphile worth their creds carries a techmech kit suited to their own specs. The contents of the kit varies with its intended application, but most have tools in common such as: drivers, pliers, a multimeter, cutters, multi-tool, EDS-safe tweezers, digital soldering mini-station, adjustable/socket wrenches, Neural Interface Toolkit (NIT), data spike, Augmentation Calibration Device (ACD), Interface cable and adapters, EMP shielding device, and cybernetic repair nanobots.

:::

::: aug

#### TactMed Kit

Most augmercs have at least two or three members of their squad carrying a full tactical med kit or two. These brick-size pouches carry tourniquets, hemostatic agents, chest seals, airway management tools, a variety of bandages and dressings, trauma shears and scalpels, decompression needles, sutures, burn dressings, and various medications to deal with pain and discomfort. This kit will restore 1HP to an individual and cannot be used more than once per cycle with this rule reset by a full night's rest. This kit may also provide aid in a variety of situations that the DM will adjudicate when appropriate. This kit can aid 5 individuals before its contents are depleted.

:::

![medkit](img/placeholder-plate.png){.bottom-center .art-medkit}

---

## Tech and Cybernetics Page

**Page template** — `@page .tech-cybernetics .second-page .chapter-05` — applies the cybernetics rules layout. This page uses dense prose with bold key terms and a full rules table for the Ego Points system. The blockquote introduces the section concept. The `SysChk` table uses standard markdown table syntax. See [Components](#ch-components) for table rendering.

@page .tech-cybernetics .second-page .chapter-05

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
