@chapter #ch-example-chapter-opener .example-chapter-opener .chapter-03 ch="3"

# Chapter Opener — Real-World Example {.dc-chevron}

@lede

This section shows how chapter-start spreads look in the actual Dimm City Field Guide, rendered using real book content. The chapter opener uses the `page-chapter-start` page template to create a two-column layout: fiction narrative on the left, rules or character content on the right, separated by a column break.

@end-lede

---

## About Chapter Opener Spreads

@section .two-column

A chapter opener spread is the reader's first encounter with each chapter's world. DC openers are always two-column: the left column carries a short fiction vignette establishing the vibe and stakes of the chapter, and the right column launches directly into the rules or character creation content.

| Element | Authoring pattern | Rendered as |
|---------|------------------|-------------|
| Chapter badge | `@chapter-opener C.01` | Stacked chapter code + large number overlay |
| Left column | Fiction vignette + art | Narrative prose with inline image |
| Column break | `---{.column-break}` | Layout split between columns |
| Right column | Rules intro + content | Standard heading hierarchy |

@column-break

The two-column split is authored with a `---{.column-break}` marker. Everything before the column break flows into the left column; everything after flows into the right. The `@chapter-opener C.NN` macro injects the chapter number badge over the left column's top edge.

The `page-chapter-start` template in `page-rules.css` creates the column structure and applies chapter-specific accent colors via the `chapter-01`, `chapter-02` class selectors.

@end-section

---

@page .page-chapter-start .chapter-start .chapter-01

@chapter-opener C.01

# Who Do You Dream to Be? {#c2-who-do-you-dream .dc-chevron}

"It's hard being me, but I guess it's the same for anyting sentient in the monoverse, ay?! Tag's Thump, an I'm a rabbit outta dee EntD here in Dimm City. Lemme post ya a tale about life here in da middle 'o dee ether.

I wuz tearin down an alley, lungs burnin, heart jackhammering like it wanted out. Da cauldron wuz right on mai heels now, wings chopping da air, close enough I could smell da oil an blood on 'em.

I turned hard an hit a dead end. Balcony. High rise. Peak chaos screaming thirty meters in da cut below.

No exits.

![Lil Thump](https://placehold.co/600x400/png?text=Lil+Thump){.fg-art-lil-thump}

I spun to face dem, back to da rail, fists up an shakin.
Bats fanned out, claws flexing, chromed teeth catchin the light.
Red eyes. Hungry eyes. I knew dat look.
Da look right before somethin eats you and vlurps your name outta existence.

They blitzed.

I ducked an weaved, sticking jabs, kicking blind, bunny instinct screaming in my skull.
I caught one square in da chest an sent it spinnin, but another raked my shoulder deep an I felt warm wetness under mai platejacket.
Too many. Too auged. I wuz losing ground, heels tapping on da rail.

Then I looked down.

I laughed... an den jumped.

Cold air punched the breath outta me as I fell, da EntD spinning round, da bats screeching surprise behind me.
Fur half a tick, I taught I wuz dead.

A BANANACOM™ ADdrone caught me in a hard dip, jolting mai spine, but I stayed alive. I slapped dee access panel, jacked in wit a hard line, an blasted a warning yelp at max pitch. Sound ripped through da air like a prison shank.

Da bats froze mid-flight, shrieking an tumbling outta da sky.

I locked in da hack, jacked out, an leapt clean onto a passing airbus like I meant to do it all along.

---{.column-break}

## Citizen File {#c2-character-profile}

Thump is a PC created for dreams in Dimm City by an actual dreamer. Their personality, looks, vibe, equipment, and skills are all chosen by the dreamer themselves. You can do the same by filling in the blanks on a character profile to create your very own character. For many dreamers, this is one of the most exciting parts of this experience: thinking about a character you want to play and designing them for the dream to come.

![Image is everything](https://placehold.co/600x400/png?text=Portrait){.fg-art-portrait}
This chapter will guide you through all the choices you need to make to help you fill in the blanks and create a unique and interesting character. Don't worry about making mistakes or doing something wrong, just try to have fun with it and let your imagination do the work.

### Image Is Everything {#c2-first-impressions}


Before reputation comes recognition. Before recognition comes a glance. Dimmers speed-read bodies like text: names, scars, size, and stance all scanned in a heartbeat. This section defines how you're read when the Dream first lays eyes on you.


> [!VISIT]
> **Before You Fill Anything In:**
> Don't start with numbers. Start with a body, a vibe, and a reason you're still breathing in Dimm City. This file isn't about optimization, it's about creating a CREATUREPUNK. If a choice would make Dimm City react to you, it belongs here. If it only makes you stronger, it probably comes later.
> Visit **dimm.city** for a form-fillable PDF version of the Citizen File.


@page .citizen-file .chapter-01

@section .two-column .col-split

#### What's Yr Handle?

Choose a name.

It can come from any culture, any language, or straight out of your imagination.

Pull it from a book, a show, a half-remembered dream, or invent something that sounds right for the city.

#### Designation

Let others know how to refer to you.

She/her, he/him, they/them, or something else entirely.

Do your best to address your fellow Dreamers as they wish to be addressed.

Names and pronouns matter when life itself is constantly trying to strip both away.

#### Species

In Dimm City, you're not human—you never were. Every Dreamer is an anthropomorphic creature: a splice of animal instinct, street survival, and whatever the corps, gods, or bad luck bolted on afterward.

Choose a species that fits your vibe. Species carries no mechanical weight — it shapes your look, your voice, and how Dimm City reads you. The city has seen it all: cats and rabbits, rats and ravens, wolves and worse things with no clean name left.

@column-break

#### Origins

Where did you start, and how far is that from where you are now?

Origins tell the Dream Master how your character fits the city's grid. A corporate-born Dreamer walks alleys differently than someone who grew up in the Flats. They know different people, owe different debts, and have different reasons to still be breathing.

Choose one: **EntD rat**, **Corp exile**, **District-born**, **Offworld arrival**, **Street-raised**, or **Something the city made and hasn't claimed yet**.

#### Scars, Size, and Survival

Choose the stage of life your character is in:

| |  |
|-------|-------|
|  |childhood|
|  |adolescence|
|  |young adulthood|
|   |adulthood|
|  |middle age|
|  |old age|
|  |extreme old age|

Expressing age in years means little in Dimm City. Here, age is experiential, not chronological.

Survival, scars, augmentation, and memory say far more than a number ever could.

Size carries no mechanical advantage. It's a narrative choice that shapes how you move through the city, how others perceive you, and how easily you stay with your crew:

| |  |
|-------|-------|
|  |**Tiny:** Under 1 meter tall. You move through Dimm City like a rumor.|
|  |**Small:** About 1–1.5 meters tall. You fit where the city pinches.|
|  |**Medium:** About 1.6–2.5 meters tall. The city is built for bodies like yours.|
|  |**Big:** Over 2.5 to 4 meters tall. Your presence fills rooms and draws eyes.|

@end-section
