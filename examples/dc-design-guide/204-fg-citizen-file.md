@chapter #ch-fg-citizen-file .fg-examples

# Field Guide: Citizen File {.dc-chevron}

::: wrapper {.dc-intro}
The character creation spread using the `.page-info-sidebar .citizen-file` template. These pages guide players through building their character's identity, appearance, and backstory.
:::

---

## Pattern: Citizen File Intro Page

The `.page-info-sidebar .citizen-file` template is a sidebar-dominated layout. The main column carries intro prose and questionnaire-style choice sections; the sidebar holds a persistent character-concept callout. Column breaks are placed with `---{.column-break}` inside the two-column flow.

**Page class** — `--- {page .page-info-sidebar .citizen-file .chapter-01}`

**Main column** — intro prose, section headings (H3/H4), checkbox tables, size reference table  
**Sidebar** — `.visit-callout` blockquote for external links; rules clarifications as plain paragraphs

The checkbox tables are standard markdown pipe tables with an empty first cell — the CSS renders that cell as a selectable option marker on print.

```markdown
--- {page .page-info-sidebar .citizen-file .chapter-01}

## Citizen File {#c2-character-profile}

Thump is a PC created for dreams in Dimm City by an actual dreamer…

### Image Is Everything {#c2-first-impressions}

Before reputation comes recognition…

---{.column-break}

> Before You Fill Anything In:
> Don't start with numbers. Start with a body, a vibe…
{.visit-callout}

#### What's Yr Handle?

Choose a name. It can come from any culture, any language…

| |  |
|-------|-------|
|  |childhood|
|  |adolescence|
```

**Live specimen:**

--- {page .page-info-sidebar .citizen-file .chapter-01}

## Citizen File {#c2-character-profile}

Thump is a PC created for dreams in Dimm City by an actual dreamer. Their personality, looks, vibe, equipment, and skills are all chosen by the dreamer themselves. You can do the same by filling in the blanks on a character profile to create your very own character. For many dreamers, this is one of the most exciting parts of this experience: thinking about a character you want to play and designing them for the dream to come.

This chapter will guide you through all the choices you need to make to help you fill in the blanks and create a unique and interesting character. Don't worry about making mistakes or doing something wrong, just try to have fun with it and let your imagination do the work.

### Image Is Everything {#c2-first-impressions}

Before reputation comes recognition. Before recognition comes a glance. Dimmers speed-read bodies like text: names, scars, size, and stance all scanned in a heartbeat. This section defines how you're read when the Dream first lays eyes on you.

![Image is everything](img/placeholder-plate.png){.art-portrait}

---{.column-break}

> Before You Fill Anything In:
> Don't start with numbers. Start with a body, a vibe, and a reason you're still breathing in Dimm City. This file isn't about optimization, it's about creating a CREATUREPUNK. If a choice would make Dimm City react to you, it belongs here. If it only makes you stronger, it probably comes later.
> Visit **dimm.city** for a form-fillable PDF version of the Citizen File.
{.visit-callout}

#### What's Yr Handle?

Choose a name.

It can come from any culture, any language, or straight out of your imagination.

Pull it from a book, a show, a half-remembered dream, or invent something that sounds right for the city.

#### Designation

Let others know how to refer to you.

She/her, he/him, they/them, or something else entirely.

Do your best to address your fellow Dreamers as they wish to be addressed.

Names and pronouns matter when life itself is constantly trying to strip both away.

---{.column-break}

#### Scars, Size, and Survival

Choose the stage of life your character is in:

| |  |
|-------|-------|
|  |childhood|
|  |adolescence|
|  |young adulthood|
|  |adulthood|
|  |middle age|
|  |old age|
|  |extreme old age|

Expressing age in years means little in Dimm City. Here, age is experiential, not chronological.

Survival, scars, augmentation, and memory say far more than a number ever could.

You should also note your character's height and weight using metric measurements. Most citizens fall somewhere between 1 and 3 meters tall, with weight listed in kilograms.

Size carries no mechanical advantage. It's a narrative choice that shapes how you move through the city, how others perceive you, and how easily you stay with your crew:

| |  |
|-------|-------|
|  |**Tiny:** Under 1 meter tall. You move through Dimm City like a rumor. Vents, ducts, crawlspaces, and forgotten gaps welcome you.|
|  |**Small:** About 1–1.5 meters tall. You fit where the city pinches and duck under things others clip their heads on.|
|  |**Medium:** About 1.6–2.5 meters tall. The city is built for bodies like yours. Doors, vehicles, crowds, and cover mostly cooperate.|
|  |**Big:** Over 2.5 to 4 meters tall. Your presence fills rooms, narrow alleys, transit tunnels, and draws eyes.|

---

## Pattern: At-a-Glance Cards + Sidebar

The second citizen-file page introduces the `.at-a-glance-cards` grid — three equal-width cards for Eyes, Skin, and Species — and opens the persistent sidebar column. The sidebar carries flavor rationale for the non-human imperative.

**Page class** — `--- {page .page-info-sidebar .citizen-file .chapter-01}`

**Main column** — `.at-a-glance-heading` H3, then the `::::: wrapper {.at-a-glance-cards}` grid with nested `{.at-a-glance-card}` wrappers  
**Sidebar** — opens with `:::wrapper {.sidebar}`, contains plain H3 headings and prose; closes at page end  
**Nested callout in sidebar** — `:::wrapper {".human-callout"}` wraps the bottom-of-sidebar pull quote

```markdown
--- {page .page-info-sidebar .citizen-file .chapter-01}

### At a Glance {.at-a-glance-heading}

::::: wrapper {.at-a-glance-cards}

::: wrapper {.at-a-glance-card}
#### Eyes
Your eyes are often the first thing people notice…
:::

::: wrapper {.at-a-glance-card}
#### Skin
Skin is surface, history, and billboard all at once…
:::

::: wrapper {.at-a-glance-card}
#### Species
Species is the label the city applies to you…
:::

:::::

::: wrapper {.sidebar}

### Humans are boring.

It takes zero imagination to strap chrome on a human…

::: wrapper {".human-callout"}
Keep it strange. If it surprises the table, it belongs in Dimm City.
:::
```

> [!NOTE]
> The outer wrapper uses **five** colons (`:::::`). Inner cards use **three** (`:::`). Nesting depth maps to colon count — mismatching causes the grid to collapse into a single block.

**Live specimen:**

--- {page .page-info-sidebar .citizen-file .chapter-01}

### At a Glance {.at-a-glance-heading}

::::: wrapper {.at-a-glance-cards}

::: wrapper {.at-a-glance-card}
#### Eyes
Your eyes are often the first thing people notice — and the first thing they judge. Organic, augmented, glowing, multifaceted, reflective, cracked, replaced. In Dimm City, eyes carry tells: what you've survived, what you've paid for, and what you're capable of seeing that others can't. Note their appearance, not for bonuses, but for how they mark you in conversation, surveillance footage, and memory.
:::

::: wrapper {.at-a-glance-card}
#### Skin
Skin is surface, history, and billboard all at once. Fur, scales, chitin, synth-sheen, scar-latticed flesh, fungal bloom, ceramic plating. Some bodies advertise their origins proudly. Others hide beneath layers of modification, damage, or deliberate disguise. Your skin influences how the city treats you long before you speak — who trusts you, who fears you, and who thinks you belong somewhere else.
:::

::: wrapper {.at-a-glance-card}
#### Species
Species is the label the city applies to you, whether you like it or not. It's how systems categorize you, how strangers make assumptions, and how *prejudice or privilege* follows you through a crowd. In Dimm City, species is less about biology and more about perception. Bodies are mutable, identities are fluid, and the line between natural, altered, and artificial is permanently blurred.
:::

:::::

::: wrapper {.sidebar}

### Humans are boring.

It takes zero imagination to strap chrome on a human and call it a day. Dimm City doesn't do easy. Dreamers are pushed to create, not default. You don't "pick a body," you birth one. Your form is part of your story, your power, and your problems.

### The Pack Should Be Weird.

Five humans pulling a job? Fine. Functional. Forgettable.

A monkey Sporos, a fallen angel, a sentient fungus, a Gorpuloni, and a stitch-job breaking into an underground lab to steal sensitive data?

That's not just a crew, that's Creaturepunk!

Different bodies mean different instincts, solutions, and friction. Pack dynamics are wilder and way more fun!

### Because the City Is Full of Freaks.

Dimm City isn't a human world with monsters in the margins. It's a city of the strange, the broken, and the impossible. Your pack should look like a close-up of the streets themselves — a walking cross-section of everything the city chews up and vomits on the sidewalk.

Humans blend in.
Creaturepunks don't.

If it's weird, messy, and waaaay unhinged, you got the vibe!

::: wrapper {".human-callout"}
Keep it strange. If it surprises the table, it belongs in Dimm City.
:::
