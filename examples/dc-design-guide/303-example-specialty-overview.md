@chapter #ch-example-specialty-overview .example-specialty-overview .chapter-03 ch="3"

# Specialty Overview — Real-World Example {.dc-chevron}

::: wrapper {.dc-intro}
This section shows how the "Choose a Specialty" spread looks in the actual Dimm City Field Guide, rendered using real book content. It covers two page types: a chapter-start opener with fiction and ability primer, followed by an ability-catalog page with the specialty card grid.
:::

---

## Chapter-Start: What Do You Dream of Doing?

**Page template** — `--- {page .page-chapter-start .chapter-start .chapter-02}` — two-column layout. Chapter 02 uses a raw `<span class="dc-chapter-opener-no">` badge instead of the `@chapter-opener` macro (both are equivalent; see [DC Components](#ch-dc-components)). The heading uses `.dc-spray` for the spray-banner treatment. The `dc-note` and `dc-sidebar` raw HTML blocks render rules callouts with labeled headers. Images replaced with design guide placeholder.

--- {page .page-chapter-start .chapter-start .chapter-02}

<span class="dc-chapter-opener-no">C.02</span>

## What Do You Dream of Doing? {.dc-spray}

The alley narrowed to a throat of shadow as they reached the bunker's blind side. Rook paused, agile fingers lifting mid-air, knuckles flexing with simian grace. The ambient hum dipped a fraction.

"Three layers," he murmured, dark eyes flicking as invisible data scrolled past his vision. "Motion, thermal, facial-recognition. Someone was paranoid."

Zephyr grinned, sharp and feline, and rolled her shoulders. LEDs along her spine flared as she stretched, ready to pounce, color bleeding into sigils that crawled and rearranged themselves.
"Someone interesting," she purred, the words hanging, vibrating low in the air.

Prism stepped forward, long ears barely stirring as the ground softened beneath their feet. Gravity loosened its grip, monoversal pressure bending just enough to lie. Their presence dulled the sensors' edge, probability smearing like grease across a lens. Red became amber. Amber forgot what it was watching.

Rook exhaled and went to work. One system collapsed into another, blind spots stacking neatly as dominoes fell. His tail gave a single, absent twitch as he leaned in. He didn't rush. He didn't need to. The system listened when he spoke its language.

The Sledge Sisters struck as one.

The door didn't explode. It failed. Metal screamed, folded, and vanished inward under a synchronized impact that shook dust from the ceiling and sent shockwaves crawling down the corridor beyond.

Five shadows moved as one, already inside, already gone.

## How Abilities Work

How that pack works wasn't luck. It was abilities firing in sequence. Each move opened space. Each ability set up the next.

In Dimm City, abilities aren't just what you can do. They're learned techniques, invasive augments, practiced rituals, and raw instinct working as one.

<div class="dc-note">
<span class="dc-note-label">The Core Loop of a Dream</span>

Every moment in Dimm City runs on the same simple rhythm:

- The Dream Master describes the situation.
- A Dreamer declares an action.
- If the outcome is uncertain, you ROLL THE DIE or activate an ability.
- The result determines what happens next.
- The scene evolves and the Dream continues.

Everything in this chapter exists to support that loop. Abilities bend it. Dice decide it. Dreamers drive it. The Monoverse responds.

</div>

---

## Ability-Catalog Page: Choose a Specialty

**Page template** — `--- {page .page-ability-catalog .choose-specialty .chapter-01}` — activates the two-column auto-fill specialty card grid. Each specialty uses a `.wrapper` with a `.specialty-card` class plus the specialty name (e.g. `.augmerc`, `.proxy`). Art images replaced with design guide placeholder. See [Page Templates](#ch-templates) for the `page-ability-catalog` spec and [Layout](#ch-layout) for the card grid system.

--- {page .page-ability-catalog .choose-specialty .chapter-01}

## 1. Choose a specialty {#c2-choose-a-role}

Every dreamer's got a sharp edge — your specialty is where it starts.

It's the skillset that sets you apart, defines what you bring to the crew, and shapes the wild ways you survive the Dream.

::::: wrapper {.specialty-spread}

::: wrapper {class="specialty-card augmerc"}
### Augmerc {#specialty-augmerc}

![Augmerc](img/placeholder-plate.png){.art-specialty}

> Cybernetic Commando

Heavily armed and wired for war, Augmercs are the blunt force of any squad. They charge the front, soak the pain, and unload hell using brute strength and brutal tech. Combat-born, augged to kill, and never outgunned.

:::

::: wrapper {class="specialty-card proxy"}
### Proxy {#specialty-proxy}

![Proxy](img/placeholder-plate.png){.art-specialty}

> Militant Monolith

Marked by something higher—god, ghost, code, or conviction—Proxies walk the line between zealot and judge. They wield divine force like a weapon, bending battles and conversations alike with power that burns louder than faith.

:::

::: wrapper {class="specialty-card streetwarden"}
### Streetwarden {#specialty-streetwarden}

![Streetwarden](img/placeholder-plate.png){.art-specialty}

> Sprawl Sentinel

They don't wear badges—they are the law when no one else shows. Streetwardens guard the city's broken places with fists, grit, and a code all their own. They know the alleys like arteries and protect the forgotten.

:::

::: wrapper {class="specialty-card gutterdruid"}
### Gutterdruid {#specialty-gutterdruid}

![Gutterdruid](img/placeholder-plate.png){.art-specialty}

> Wold Witch

They walk the alleys like sacred ground—feeding the hungry, tending weeds, raising the forgotten. Gutterdruids draw power from the pulse beneath the pavement, shaping the raw, primal force that keeps the city alive even as it rots.

:::

::: wrapper {class="specialty-card cybersurgeon"}
### Cybersurgeon {#specialty-cybersurgeon}

![Cybersurgeon](img/placeholder-plate.png){.art-specialty}

> Mech Medic

Life is flexible. Cybersurgeons prove it daily—cutting, splicing, upgrading flesh into something more. Whether they're back-alley butchers or elite biomech specialists, these med-techs push the edge of evolution, one implant at a time.

:::

::: wrapper {class="specialty-card wirephreak"}
### Wirephreak {#specialty-wirephreak}

![Wirephreak](img/placeholder-plate.png){.art-specialty}

> Ping Predator

Killers, thieves, forgers—Wirephreaks specialize in slipping past locks, firewalls, and people. Some work clean, some loud, all lethal. Whether the job calls for stealth, sabotage, or sleight-of-hand, a Wirephreak on the crew means the job gets done.

:::

::: wrapper {class="specialty-card technosorcerer"}
### Technosorcerer {#specialty-technosorcerer}

![Technosorcerer](img/placeholder-plate.png){.art-specialty}

> Modular Magician

Technosorcerers walk on the razor's edge between magic and technology. They believe one to be no different than the other and use the strengths of each to help nullify the other's weaknesses.

:::

::: wrapper {class="specialty-card etherlock"}
### Etherlock {#specialty-etherlock}

![Etherlock](img/placeholder-plate.png){.art-specialty}

> Manifold Magus

Secrets are currency—and Etherlocks are rich in them. Tapping into elemental forces, spirit echoes, and the buried laws of the monoverse, they wield magic that slips through cracks in reality.

:::

:::::
