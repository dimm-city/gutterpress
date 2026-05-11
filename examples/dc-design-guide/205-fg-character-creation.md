@chapter #ch-fg-character-creation .fg-examples

# Field Guide: Character Creation {.dc-chevron}

::: wrapper {.dc-intro}
Character creation spreads covering vibe, origins, ideals, and flaws. These pages guide players through defining their character's personality and backstory using structured prompts, tables, and choice lists.
:::

---

## Pattern: Vibe Page

The `.page-rules .vibe` template opens a character creation section with atmospheric prose, a checkbox table of personality impressions, and a tinted DM callout. The page uses a full-bleed art anchor (`.art-*` class) to pin an illustration to a corner. Body copy runs single-column prose before the table — no column split needed. The closing DM tip uses the raw `.vibe-callout` paragraph class for its tinted background treatment.

@page .page-rules .vibe .fg-examples

## Vibe {.dc-section-h2}

![alt text](img/placeholder-portrait.png){.art-redpan}

They don't know your name.
They don't know what you are.
They don't know what you've survived.
They know enough.

Something lingers after you leave the room. A pressure change. A smell. A silence that didn't used to be there. Maybe it's the way people stop talking when you walk past, or how eyes slide away like they've been burned once already.

That's your vibe.

This isn't about power. It doesn't grant bonuses, unlock abilities, or bend the rules. It's about impression. Presence. The signal you broadcast just by existing in the city.

Dimm City is packed wall-to-wall with strange bodies and stranger lives. Weird doesn't make you special here. Intent does. Your vibe is how the city decides what you are before it decides what you've earned.

What you write here tells the Dream Master how NPCs react to you at a glance. Who leans in. Who backs off. Who clocks you as trouble, comfort, or opportunity. It shapes tone, tension, and first contact. Nothing more. Nothing less.

Choose something that feels right in your hands.

### When others see me, they first notice my:

| | | | |
|---|---|---|---|
| | Long shadow | Sleepy drag | Street-born instinct |
| | Outsider static | Resting snarl | Corporate chill |
| | Untamed momentum | Quiet gravity | Kindhearted calm |
| | Androgynous poise | Thousand-yard stare | Twitchy tension |
| | Low heat that's always simmering | Easy charm with sharp edges | Drifting gaze that never quite lands |
| | Fluid grace that doesn't ask permission | Smirk that knows more than it says | Loud laughter that dares others to say sumpthin' |
| | Perfect posture like a loaded weapon | A burning temper barely leashed | An aura that simply says: DON'T! |

If it makes people lean back, lean in, or check the exits, you nailed it.

DM tip: Ask each Dreamer for one vibe cue, then echo it back in the first NPC reaction.
{.vibe-callout}

---

## Pattern: Origins Page

The `.page-rules .call-home` template handles community/backstory questions. Two back-to-back checkbox tables (one for origin location, one for current home) are separated by a short prose bridge. An `.origin-callout` paragraph delivers a single in-world writing prompt styled as a tinted block — similar to `.vibe-callout` but thematically keyed to place and loss.

@page .page-rules .call-home .fg-examples

## Origins Matter {.dc-section-h2}

### Where Are You From?

This is where you were shaped.

A place that left marks, taught rules, or burned bridges you still feel. It doesn't have to exist anymore.

| | |
|-------|-------|
| | A high-security borough in The Dark |
| | A half-burnt block of the ArcD |
| | A factory dormitory in the Tech District |
| | A ghetto or glass-farm in the Market |
| | A free theatre in a quiet corner of the EntD |
| | A booming city built on the face of a dead god |
| | A subterranean metropolis somewhere in the Infinitum |

Write the place that made you.

Origin prompt: What did you lose here, and what did you learn to survive it?
{.origin-callout}

### Where Do You Stay?

This is where you live now.

It might be home.
It might be temporary.
It might be somewhere the city hasn't noticed yet.

Your current spot could be:

| | |
|-------|-------|
| | A squat, safehouse, or backroom anywhere in DimmC |
| | A rooftop, burrow, or crawlspace in a high-rise tenement |
| | A vehicle, mobile rig, or ship berth that can dock anywhere |
| | Somewhere legal, illegal, or forgotten |

Home is where trouble finds you.

---

## Pattern: Ideals and Flaws Spread

The `.page-item-grid .ideal` and `.page-item-grid .flaw` templates form a two-page spread. Each page opens with a bold rhetorical question in a blockquote, then runs a `:::wrapper {.ideal-list}` or `:::wrapper {.flaw-list}` container holding named entries. Every entry follows the same micro-structure: `###` name, one-sentence description, and a signature quote in a `>` blockquote. A final "Other X" section delivers a compact inline list of extras. Art is anchored full-bleed at `.bottom-center` with a named art class. These pages never use `:::two-column` — the item-grid CSS handles the card layout.

@page .page-item-grid .ideal .fg-examples

::: wrapper {.header}

## Ideal {.dc-section-h2}

> **What do you stand for when the city bares its teeth?**

Your **Ideal** is the belief you fall back on when things get loud, ugly, or expensive. This is your moral core — the line you won't cross, or the hill you're willing to die on. Choose one below, or carve your own into the concrete.

![slothhh](img/placeholder-slothhh.png){.bottom-center .art-slothhh}

::: wrapper {.ideal-list}

### Information Freedom

You value the free flow of information and are an advocate of digital privacy, encryption, and the right to access unrestricted knowledge.

Their belief cuts clean:
> "If knowledge is locked away, it's already being abused."

### Honor

You believe in a code, and it's your duty to uphold it.

The line they live by:
> "I made a promise to help those in need, and I must fulfill it at all costs."

### Empathy

You sympathize with the downtrodden, oppressed, and socially marginalized.

Their loyalty is obvious:
> "My dog in this fight is the underdog!"

### Power

You believe strength, competence, and the ability to act should determine who leads and who decides. In a city where systems fail and mercy is often exploited, you trust force, will, and capability over promises or paperwork.

Their thinking is brutally practical:
> "If I can hold it together when others can't, I should be the one in charge."

### Transmortalism

You embrace the concept of transmortalism, seeking to enhance your body and mind through cybernetic implants, genetic modifications, and virtual reality experiences.

Their philosophy rejects limits outright:
> "Everyone should enhance their being. Why settle for what you were born with?"

### Other Ideals

**Street Justice** • **Compassion** • **Heroism** • **Order** • **Adaptability** • **Salvation** • **Technological Adaptation** • **Sensation** • **Pragmatism** • **Anti-Technology** • **Anti-Establishment** • **Generosity** — or invent something fiercer.

Your ideal is what points you forward when everything else is chaos. It shapes your choices, justifies your risks, and tells the monoverse what you believe is worth fighting for.

You don't have to be right. You just have to believe in it strongly enough to act!

:::

@page .page-item-grid .flaw .fg-examples

![badger](img/placeholder-badger.png){.bottom-center .art-badger}

::: wrapper {.header}

## Flaw {.dc-section-h2}

> **How does the city have its hooks in you?**

Your **Flaw** is the weakness the city knows how to exploit. Fear, pride, addiction, obsession — something always leaks through. Flaws don't make you worse. They make you *real*. Choose one that forces hard choices.

::: wrapper {.flaw-list}

### Megalomaniac

You have delusional fantasies of wealth or power.

Their ambition has no ceiling:
> "I won't rest until I rule every inch of this world."

### Addictive Personality

You have a tendency to become addicted to substances or activities, often seeking instant gratification without considering the consequences.

The lie they cling to:
> "Just one more hit and then I'll quit."

### Socially Awkward

You struggle with social interactions and find it difficult to connect with others, often feeling uncomfortable or out of place in social settings.

Their inner panic surfaces fast:
> "I never know what to say. I wish I could just disappear."

### Cold-Hearted

You lack empathy and tend to prioritize your own goals and desires over the well-being of others.

Their worldview is stripped of sentiment:
> "I don't care about their suffering. It's survival of the fittest."

### Tech-Blind

You don't just reject technology — you refuse to engage with it. Interfaces, implants, even basic systems like door panels or comms leave you fumbling or frozen.

While others navigate the mesh with ease, you rely on others or brute force — and sometimes, that costs time, trust, or lives.

Their rule is simple and absolute:
> "If it needs a charge, I don't touch it."

### Other Flaws

**Nihilist** • **Vain** • **Fatalistic** • **Wrathful** • **Reckless** • **Cynic** • **Hedonist** • **Oblivious** • **Impish** • **Impulsive** • **Foolish** • **Paranoia** • **Fearful** • **Thief** • **Pedantic** — or dream up something darker.

Your flaw is a nerve you and the DM can pinch to make things interesting. It doesn't make you weak — it makes you dangerous, unpredictable, and real.

Play it honestly. Dreams get real when your flaws cost you something.

:::
