# Field Guide Syntax Examples

> **⛔ CONTENT PROTECTION RULE — PRIMARY CONSTRAINT**
> Migration changes markdown **syntax only**. No prose, dialogue, flavor text, ability text, heading text, game mechanics, or any other author-written content may be altered, rewritten, trimmed, paraphrased, or "improved" without explicit user direction. A syntax migration that changes a single word of content is a failure. Run `content-hash.ts verify` before committing any batch.

One representative before/after example for every component and pattern type found in the live field guide source (`dc-op-manual/field-guide/`). File paths are relative to that directory.

---

## How to Read This Document

Each entry includes:
- **file:line** — where the example lives in the live source
- **Change:** — exactly what needs to be done to that line/block
- **BEFORE / AFTER** — the exact old and new markdown
- ⚠️ — open spec or author decision required before migrating

---

## 1. Chapter and Page Markers

### 1.1 Chapter opener

`chapter-02 0.md` line 4 — **Change:** none; already canonical.

```markdown
@chapter C.02
@page .page-chapter-start .chapter-start .chapter-02
```

---

### 1.2 Named page marker

`chapter-01.md` line 2 — **Change:** none; already canonical.

```markdown
@page .page-info-sidebar .citizen-file .chapter-01
```

---

### 1.3 Column break

`chapter-01.md` line 77 — **Change:** none; already canonical.

```markdown
---{.column-break}
```

---

## 2. Intro and Lede

### 2.1 Lede container

`chapter-00.md` lines 6–8 — **Change:** replace `::: lede` with `@lede`; replace closing `:::` with `@end-lede`.

**BEFORE:**
```markdown
::: lede
Twelve chapters of dreams, dirt, and what bites back...
:::
```

**AFTER:**
```markdown
@lede
Twelve chapters of dreams, dirt, and what bites back...
@end-lede
```

---

## 3. Generic Block Wrappers

### 3.1 TOC

`chapter-00.md` lines 10–28 — **Change:** replace `::: wrapper {.dc-toc}` with `@toc`; replace closing `:::` with `@end-toc`. The `@toc` macro exists specifically for this and emits `.dc-toc` directly — no `@block` wrapper needed.

**BEFORE:**
```markdown
::: wrapper {.dc-toc}
1. **01** &nbsp; [Who Do You Dream to Be?](#chapter-01) — Citizen file...
2. **02** &nbsp; ...
:::
```

**AFTER:**
```markdown
@toc
1. **01** &nbsp; [Who Do You Dream to Be?](#chapter-01) — Citizen file...
2. **02** &nbsp; ...
@end-toc
```

---

### 3.2 Empty wrapper — remove

`chapter-03.md` line 449 — **Change:** delete the `::: wrapper` line and its closing `:::` line entirely; leave the inner content in place.

**BEFORE:**
```markdown
::: wrapper

## ROLLING THE DIE!
...
:::
```

**AFTER:**
```markdown
## ROLLING THE DIE!
...
```

---

### 3.3 Table of Outcomes

`chapter-03.md` line 591 — **Change:** replace `::: container {.outcome-table}` with `@outcome`; replace closing `:::` with `@end-outcome`. Convert the table rows to the pipe-separated row format the macro expects (`Roll | Result | Description`). The `@outcome` macro renders the d20 outcome ladder with per-tier `.dc-outcome-row` classes.

**BEFORE:**
```markdown
::: container {.outcome-table}

### Table of Outcomes
...
:::
```

**AFTER:**
```markdown
@outcome
20 | Triumph | Best-case outcome, extra impact
11–19 | Success | You do it
6–10 | Hard Choice | You succeed, but it costs you
2–5 | Failure | You don't get what you wanted
1 | Catastrophe | It goes bad, and then worse
@end-outcome
```

---

## 4. Sidebar

`chapter-03.md` line 496 — **Change:** replace `::: container {.dc-sidebar}` with `@sidebar`; replace closing `:::` with `@end-sidebar`.

**BEFORE:**
```markdown
::: container {.dc-sidebar}

### Dice Etiquette
...
:::
```

**AFTER:**
```markdown
@sidebar
### Dice Etiquette
...
@end-sidebar
```

---

## 5. Alert Blockquotes

### 5.1 VISIT callout

`chapter-01.md` line 79 — **Change:** remove the `{.visit-callout}` attribute line; reformat the preceding text as `> [!VISIT]\n> text` blockquote.

**BEFORE:**
```markdown
> Before You Fill Anything In:
Don't start with numbers. Start with a body, a vibe, and a reason you're still breathing in Dimm City.
{.visit-callout}
```

**AFTER:**
```markdown
> [!VISIT]
> Before You Fill Anything In: Don't start with numbers. Start with a body, a vibe, and a reason you're still breathing in Dimm City.
```

---

### 5.2 VIBE callout

`chapter-01.md` line 387 — **Change:** remove the `{.vibe-callout}` attribute line; prefix the text with `> [!VIBE]\n>`.

**BEFORE:**
```markdown
DM tip: Ask each Dreamer for one vibe cue, then echo it back in the first NPC reaction.
{.vibe-callout}
```

**AFTER:**
```markdown
> [!VIBE]
> DM tip: Ask each Dreamer for one vibe cue, then echo it back in the first NPC reaction.
```

---

### 5.3 ORIGIN callout

`chapter-01.md` line 420 — **Change:** remove the `{.origin-callout}` attribute line; prefix the text with `> [!ORIGIN]\n>`.

**BEFORE:**
```markdown
Origin prompt: What did you lose here, and what did you learn to survive it?
{.origin-callout}
```

**AFTER:**
```markdown
> [!ORIGIN]
> Origin prompt: What did you lose here, and what did you learn to survive it?
```

---

### 5.4 GEAR callout

`chapter-01.md` lines 809–819 — **Change:** replace `::: wrapper {.gear-callout}` and closing `:::` with `> [!GEAR]\n>` prefix on the content line.

⚠️ Verify `[!GEAR]` handler is registered in `dimm-city-plugin.js` before migrating.

**BEFORE:**
```markdown
::: wrapper {.gear-callout}

Not everything you carry is a weapon, a tool, or a piece of tech...

:::
```

**AFTER:**
```markdown
> [!GEAR]
> Not everything you carry is a weapon, a tool, or a piece of tech...
```

---

### 5.5 DM / NOTE callouts

`chapter-02 0.md` line 63 — **Change:** none; already canonical.

```markdown
> [!NOTE] The Core Loop of a Dream
> Every moment in Dimm City runs on...
```

---

## 6. Images

### 6.1 Remove image class attributes

`chapter-00.md` line 64 (~20 instances throughout the book) — **Change:** remove all `{.art-*}` class attributes from image tags. Images are positioned and styled via CSS context selectors (`@specialty .augmerc img`, `.page.page-intro img`, etc.) — no class attribute on the image element is needed or wanted. This is the Contextual Cascade Principle applied to images: the page/section/specialty scope in `fg-overrides.css` targets the image by its container, not by a per-element attribute.

**BEFORE:**
```markdown
![intro-image](images/chapter-00/neonrabbit.png){.art-intro-image}
```

**AFTER:**
```markdown
![intro-image](images/chapter-00/neonrabbit.png)
```

---

### 6.2 Remove positional image class attributes

`chapter-05.md` line 73 (also `chapter-01.md` lines 459, 512, 883) — **Change:** remove `{.bottom-center .art-medkit}` entirely. Image position is a CSS concern: the enclosing page or section class targets the image via a context selector in `fg-overrides.css` (e.g. `.page.some-page img { position: ...; bottom: 0; }`). No per-element attribute needed.

**BEFORE:**
```markdown
![medkit](images/chapter-02/medkit.png){.bottom-center .art-medkit}
```

**AFTER:**
```markdown
![medkit](images/chapter-02/medkit.png)
```

---

### 6.3 Remove `{class="X"}` attribute entirely

`chapter-02 4 Gutterdruid.md` line 5 — **Change:** remove `{class="gutterdruid" }` entirely. Grep for `{class=` across all files and remove any other instances. Same principle as §6.1 and §6.2: the enclosing `@specialty .gutterdruid` scope provides the CSS context; the image needs no class attribute.

**BEFORE:**
```markdown
![druid](./images/chapter-03/Gutterdruid.png){class="gutterdruid" }
```

**AFTER:**
```markdown
![druid](./images/chapter-03/Gutterdruid.png)
```

---

## 7. Specialty Sections

> **⛔ SPECIALTY MACRO TAXONOMY — READ BEFORE MIGRATING ANY SPECIALTY CONTENT**
>
> There are four distinct specialty macros. They are NOT interchangeable:
>
> | Macro | Purpose | Where used |
> |---|---|---|
> | `@specialty .name` / `@end-specialty` | **Parent container.** Sets the cascade context for all specialty-scoped components. EVERY specialty page must be wrapped in this. | Every chapter-02 specialty file; also wraps `@specialty-card` entries on chapter-01 |
> | `@specialty-card #id` / `@end-specialty-card` | **Overview card.** The summary card shown in the chapter-01 specialty grid (name, image, flavor, description). | **Chapter-01 only** |
> | `@specialty-intro` / `@end-specialty-intro` | **Intro block.** The flavor intro text at the top of a specialty's chapter page. Goes INSIDE `@specialty .name`. | **Chapter-02 specialty files only** |
>
> **`@specialty-art` is NOT used.** The specialty art image sits as a bare image tag inside the `@specialty .name` wrapper. CSS in `fg-overrides.css` targets it via `.dc-specialty img` — no wrapper macro and no class attribute needed.
>
> **Wrong:** using `@specialty-intro` on the chapter-01 overview page.
> **Wrong:** using `@specialty-card` on a chapter-02 specialty profile page.
> **Wrong:** putting `@specialty-intro` or `@specialty-card` OUTSIDE a `@specialty .name` wrapper.
> **Wrong:** adding `{.any-class}` to image tags — use CSS context selectors instead.

---

### 7.1 Specialty scope wrapper — syntax normalization

`chapter-02 1 Augmerc.md` line 1 (also line 1 of all 8 specialty files) — **Change:** remove the braces: `@specialty {.NAME}` → `@specialty .NAME`. One fix per file, 8 files total.

**BEFORE:**
```markdown
@specialty {.augmerc}
```

**AFTER:**
```markdown
@specialty .augmerc
```

---

### 7.2 Specialty intro block

`chapter-02 1 Augmerc.md` lines 3–25 — **Change:** replace `::: wrapper {.specialty-intro}` with `@specialty-intro`; replace closing `:::` with `@end-specialty-intro`. Repeat for each specialty file that has this block (Augmerc and Proxy confirmed; others need verification).

**BEFORE:**
```markdown
::: wrapper {.specialty-intro}

## Augmerc

An Augmerc is muscle for hire...

:::
```

**AFTER:**
```markdown
@specialty-intro

## Augmerc

An Augmerc is muscle for hire...

@end-specialty-intro
```

---

### 7.3 Specialty art block — remove wrapper, bare image

`chapter-02 1 Augmerc.md` lines 27–31 — **Change:** remove the `::: wrapper {.specialty-art}` line and its closing `:::` entirely. Remove the `{.augmerc}` class from the image. Leave the bare image tag in place. No `@specialty-art` wrapper macro is needed: the `@specialty .augmerc` parent scope provides the CSS context — `fg-overrides.css` targets the image via `.dc-specialty.augmerc img` or `.dc-specialty img` without any wrapper or attribute.

**BEFORE:**
```markdown
::: wrapper {.specialty-art}

![Augmerc](./images/chapter-02/augmerc.png){.augmerc}

:::
```

**AFTER:**
```markdown
![Augmerc](./images/chapter-02/augmerc.png)
```

---

### 7.4 Specialty card (chapter-01 overview cards only)

`chapter-01.md` lines 228–240 (one of 10 specialty summary cards) — **Change:** replace `::: wrapper {.specialty-card .augmerc}` with `@specialty .augmerc` / `@specialty-card #specialty-augmerc`; replace closing `:::` with `@end-specialty-card` / `@end-specialty`. The `#id` goes on the macro, not the heading. Remove `{.art-specialty}` from the image — CSS inside `.dc-specialty-card` handles image styling via cascade. Remove `{#specialty-augmerc}` from the heading. Repeat for all 10 specialty cards in chapter-01.

**This pattern is chapter-01 ONLY.** Do not use `@specialty-card` in any chapter-02 specialty file.

**BEFORE:**
```markdown
::: wrapper {.specialty-card .augmerc}
### Augmerc {#specialty-augmerc}

![alt text](images/chapter-01/augmerc.png){.art-specialty}

> Cybernetic Commando

Heavily armed and wired for war...

:::
```

**AFTER:**
```markdown
@specialty .augmerc

@specialty-card #specialty-augmerc

### Augmerc

![alt text](images/chapter-01/augmerc.png)

> Cybernetic Commando

Heavily armed and wired for war...

@end-specialty-card

@end-specialty
```

---

### 7.5 Spec Tweak block

`chapter-02 3 Streetwarden.md` line 19 (same `### Spec Tweak:` heading in all 8 specialty files) — **Change:** insert `@block .slate` on the line immediately before `### Spec Tweak:`; insert `@end-block` on the line immediately after the last sentence of Spec Tweak content (before the first `@learning-path`).

⚠️ Mandatory — NOT optional. Without `.slate`, Spec Tweaks are indistinguishable from regular ability entries. Requires `@block` P0b.

**BEFORE:**
```markdown
### Spec Tweak: **Mistrunner**
You move through the city like fog through a gap in the wall...
```

**AFTER:**
```markdown
@block .slate
### Spec Tweak: **Mistrunner**
You move through the city like fog through a gap in the wall...
@end-block
```

---

## 8. Learning Path

`chapter-02 1 Augmerc.md` lines 33–46 (~51 instances across all chapter-02 files) — **Change:** add `@end-learning-path` on the line immediately after the last bullet item in each learning path block. The opening `@learning-path` is already correct.

**BEFORE:**
```markdown
@learning-path

### Biting Distance

> If you can touch it, you can maul it.

- Punishing Counter
- Rage Hit
- Dirty Work
- Pain Compliance
- It's Personal
```

**AFTER:**
```markdown
@learning-path

### Biting Distance

> If you can touch it, you can maul it.

- Punishing Counter
- Rage Hit
- Dirty Work
- Pain Compliance
- It's Personal

@end-learning-path
```

---

## 9. Skill Abilities

### 9.1 Remove `variant="N"` attribute

`chapter-02 1 Augmerc.md` line 49 (~160 instances across all chapter-02 files) — **Change:** on every `@skill` line, remove `variant="N"` (where N is any number). The rest of the line is unchanged. Can be done with: `sed -i 's/ variant="[^"]*"//g'` across all chapter-02 files.

Note: `{.allow-split}` is **break control** (`break-inside: auto` override for this specific card), not a styling class. It is not legacy syntax — leave it in place when present.

**BEFORE:**
```markdown
@skill variant="2" {.allow-split}

#### Punishing Counter

> See an opening, ya take it...
```

**AFTER:**
```markdown
@skill {.allow-split}

#### Punishing Counter

> See an opening, ya take it...
```

---

### 9.2 `<ins>` tags → bold

`chapter-02 2 Proxy.md` line 22 — **Change:** replace `<ins>` with `**` and `</ins>` with `**` throughout this file. Verify surrounding bold markers don't double up.

**BEFORE:**
```markdown
Your unshakable belief... You <ins>always</ins> **ROLL A DIE!**... it's <ins>always</ins> rolled with Lucidity.
```

**AFTER:**
```markdown
Your unshakable belief... You **always** **ROLL A DIE!**... it's **always** rolled with Lucidity.
```

---

## 10. Card Entries (Flaws, Ideals, Dreams)

### 10.1 Ideal entry

`chapter-01.md` lines 451–510 — **Change:** (1) delete the `:::: wrapper {.section-header}` / `::::` block (the heading wrapper); (2) add `@section .dc-ideals` before the first ideal; (3) wrap each individual ideal in `@card` / `@end-card`; (4) add `@end-section` after the last ideal entry.

⚠️ Blocked on `@card` macro (Phase 1) and `dc-components.css` rules for `.dc-ideals`.

**BEFORE:**
```markdown
:::: wrapper {.section-header}

## 4. Ideal {#c2-ideal}

> **What do you stand for when the city bares its teeth?**

::::
### Information Freedom

You value the free flow of information...

Their belief cuts clean:
> "If knowledge is locked away, it's already being abused."
```

**AFTER:**
```markdown
@section .dc-ideals
@card
### Information Freedom
You value the free flow of information...

Their belief cuts clean:
> "If knowledge is locked away, it's already being abused."

@end-card
@end-section
```

---

### 10.2 Flaw entry

`chapter-01.md` lines 514–559 — **Change:** same as ideals: (1) delete `.section-header` wrapper; (2) add `@section .dc-flaws`; (3) wrap each flaw in `@card` / `@end-card`; (4) add `@end-section`. Dreams in `chapter-02 4 Gutterdruid.md` follow the same structure with `.dc-dreams`.

**BEFORE:**
```markdown
### Megalomaniac

You have delusional fantasies of wealth or power.

Their ambition has no ceiling:
> "I won't rest until I rule every inch of this world."
```

**AFTER:**
```markdown
@section .dc-flaws
@card
### Megalomaniac

You have delusional fantasies of wealth or power.

Their ambition has no ceiling:
> "I won't rest until I rule every inch of this world."
@end-card
@end-section
```

---

## 11. At-a-Glance Cards

`chapter-01.md` lines 148–165 — **Change:** replace `::::: wrapper {.at-a-glance-cards}` with `@block .dc-at-a-glance-cards`; replace each `::: wrapper {.at-a-glance-card}` with `@block .dc-at-a-glance-card`; replace each `:::` / `:::::` close with `@end-block`.

⚠️ Requires `@block .classname` syntax (Phase 0).

**BEFORE:**
```markdown
::::: wrapper {.at-a-glance-cards}

::: wrapper {.at-a-glance-card}
#### Eyes
...
:::

:::::
```

**AFTER:**
```markdown
@block .dc-at-a-glance-cards
@block .dc-at-a-glance-card
#### Eyes
...
@end-block
@end-block
```

---

## 12. Glossary / Definitions

### 12.1 Two-column glossary wrapper

`chapter-04.md` lines 619–735 — **Change:** (1) replace `:::: wrapper {.two-column .dc-terms}` with `@section .two-column`; (2) replace each `::: wrapper {.item}` (or `.item .violet`) with `@definition`; (3) replace each closing `:::` with `@end-definition`; (4) replace closing `::::` with `@end-section`; (5) drop `.violet` modifier — no CSS backing.

**BEFORE:**
```markdown
:::: wrapper {.two-column .dc-terms}

::: wrapper {.item .violet}
**Tick/ Tic:** Refers to a very short period of time...
:::

::: wrapper {.item}
**Shortly/Shorty:** ...
:::

::::
```

**AFTER:**
```markdown
@section .two-column

@definition
**Tick/ Tic:** Refers to a very short period of time...
@end-definition

@definition
**Shortly/Shorty:** ...
@end-definition

@end-section
```

---

## 13. Gear Entries

### 13.1 Standard gear entry

`chapter-05.md` lines 344–360 — **Change:** remove the outer `:::: wrapper` / `::::` lines and the inner `::: wrapper {.item}` / `:::` lines; replace the pair with `@gear` at the top and `@end-gear` at the bottom. Inner content is unchanged.

**BEFORE:**
```markdown
:::: wrapper

::: wrapper {.item}

#### Throwaway Blaster
...
:::

::::
```

**AFTER:**
```markdown
@gear

#### Throwaway Blaster
...

@end-gear
```

---

### 13.2 Multi-table weapon entry

`chapter-05.md` lines 435–490 — **Change:** replace `::: wrapper {.item .schraphose}` with `@gear`; replace closing `:::` with `@end-gear`. Keep all inner content (outcome sub-tables) unchanged.

⚠️ Blocked on Gap 6 spec — how multiple outcome tables nest inside `@gear` is not yet defined. Migrate the wrapper now; leave the inner tables untouched until spec is written.

**BEFORE:**
```markdown
::: wrapper {.item .schraphose}

#### Schraphose
...
##### In Reach Damage
| Roll | Result | Damage |
...
:::
```

**AFTER:**
```markdown
@gear

#### Schraphose
...
##### In Reach Damage
| Roll | Result | Damage |
...

@end-gear
```

---

### 13.3 Partially-migrated gear section

`chapter-05.md` line 7 — **Change:** replace each `@section .aug` with `@gear`; add `@end-gear` after the last line of each gear entry's content (before the next `@gear` or end of section).

**BEFORE:**
```markdown
@section .aug

#### Bypass Kit
...

@section .aug
```

**AFTER:**
```markdown
@gear

#### Bypass Kit
...

@end-gear
```

---

## 14. Emoji → Text

`chapter-05.md` lines 512, 540 — **Change:** replace each emoji marker with a bold text label: `⚠️` → `**ALERT**`, `☀️` → `**FLASH EFFECT**`, `🔊` → `**BANG EFFECT**`, `💥` → `**BONUS BOOM**`, `🔥` → `**BURN**`.

⚠️ Verify emoji font support in the PDF renderer first — if emojis render correctly, they may be kept.

**BEFORE:**
```markdown
⚠️ When hit, targets must roll...
☀️ FLASH EFFECT...
🔊 BANG EFFECT...
💥 BONUS BOOM...
🔥 Burn: Targets catch fire...
```

**AFTER:**
```markdown
**ALERT** When hit, targets must roll...
**FLASH EFFECT**...
**BANG EFFECT**...
**BONUS BOOM**...
**BURN**: Targets catch fire...
```

---

## 15. Raw HTML Cleanup

### 15.1 Float-clear hack

`chapter-02 4 Gutterdruid.md` line 20 — **Change:** delete this line entirely. CSS section context rules handle float clearance; no layout replacement needed.

**BEFORE:**
```markdown
<p style="clear:both"></p>
```

**AFTER:**
```markdown
(line deleted)
```

---

---

## Patterns NOT in the Plan

Reviewed against existing components and the Contextual Cascade Principle. Each pattern is either mapped to an existing component or confirmed as truly unique.

---

### P1. `::: wrapper {.two-column-list}` for roll tables

**Appears in:**
- `chapter-02 7 Technosorcerer.md` lines 66, 79 (Practical Power — spell component lists)
- `chapter-02 8 Etherlock.md` lines 177–190 (Beast Beckoning — land animal table)
- `chapter-02 8 Etherlock.md` lines 198–211 (Beast Beckoning — water animal table)

**Verdict: MAPS TO EXISTING**

The `.two-column-list` wrapper is unnecessary structure. The two-column layout is a CSS concern, not a structural one. These are roll-result lists that render correctly as plain markdown.

**Change:** Delete the `::: wrapper {.two-column-list}` and closing `:::` lines. Convert the numbered list to a markdown table for clarity:

```markdown
| Roll | Result |
|---|---|
| 1-2 | 1 Taruja Murder |
| 3-4 | 1 Swarm of Razor Rats |
| 5-6 | 1 Tangle Bear |
```

If two-column layout is genuinely needed, a `.section.two-column` context selector in `fg-overrides.css` can handle it — no new macro required.

---

### P2. `:::: wrapper {.item .ability .continued}` — page-spanning ability

**Appears in:**
- `chapter-02 6 Wirephreak.md` lines 188–203 (Bug ability continuation)

**Verdict: MAPS TO EXISTING**

The plugin already implements `@continue` for exactly this case: it emits a card with a `{name} ▸` tab so an oversized skill card can be split across pages while preserving a visual link to the origin card.

**Change:** Remove the `:::: wrapper {.item .ability .continued}` / `::::` wrapper. The `@skill` inside it is already present — simply add `@continue` as a marker within that block if page-split is needed, or merge both entries into a single `@skill` block if it fits without forcing a break:

```markdown
@skill
#### Bug
> [flavor text]
...first part of ability...
@continue
...continuation content...
@end-skill
```

---

### P3. `@skill {.allow-split}` class attribute

**Appears in:**
- `chapter-02 7 Technosorcerer.md` line 292 (Voltgeist ability)

**Verdict: MAPS TO EXISTING**

`{.allow-split}` is valid `@skill` syntax — class attributes are passed through to the skill-card wrapper DOM element. The class appends to `.dc-skill-card` so CSS can target `.dc-skill-card.allow-split { break-inside: auto; }` to allow the card to split across pages (overriding the default `break-inside: avoid`).

**Change:** No markdown change needed — syntax is already correct after `variant="N"` is removed (see §9.1). If the break behavior is not working, add the CSS rule to `dc-components.css`, not to the markdown.

---

### P4. Wirephreak choice-based Spec Tweak

**Appears in:**
- `chapter-02 6 Wirephreak.md` lines 13–32 (Zero Trace / Hard Wired choice)

**Verdict: MAPS TO EXISTING**

The standard `@block .slate` wrapper applies to the outer Spec Tweak block regardless of whether it contains one power or two alternatives. The choice structure (two bold headers + prose) renders fine as plain prose inside a `.slate` register. When `@card` exists (Phase 1), the two alternatives can optionally be elevated to `@card` entries if visual distinction is needed.

**Change:** Wrap the entire Spec Tweak block in `@block .slate` / `@end-block`. Leave the inner choice prose as-is:

```markdown
@block .slate
### Spec Tweak
Choose one of the following. Your choice sticks unless you decide to work it out with your DM.

**Zero Trace**
You are a ghost in the mists...

**Hard Wired**
You gain a cyberdeck...
@end-block
```

---

### P5. Nested ability inside Spec Tweak choice

**Appears in:**
- `chapter-02 6 Wirephreak.md` line 23 (Scope, nested under Hard Wired)
- `chapter-02 7 Technosorcerer.md` line 25 (Scope, nested under Living Terminal)

**Verdict: MAPS TO EXISTING**

This is a bonus ability granted by the Spec Tweak. It should use `@skill` nested inside the `@block .slate` wrapper — the cascade context (`.dc-block.slate .dc-skill-card`) naturally provides the authority register treatment, distinguishing it from a standalone learnable ability.

**Change:** Wrap the nested ability in `@skill` / `@end-skill` inside the `@block .slate` block:

```markdown
@block .slate
### Spec Tweak: **Living Terminal**
You can hack any connected system nearby...

@skill
#### Scope
> Your awareness of the tangled web...
0 AP. Passively detect...
@end-skill
@end-block
```

---

### P6. Table-based AP presentation (Cybersurgeon Triage Rig)

**Appears in:**
- `chapter-02 5 Cybersurgeon.md` lines 55–69

**Verdict: MAPS TO EXISTING**

The `@skill` macro is agnostic to whether AP tiers are presented as a numbered list or a markdown table — both are valid inner content. The table format here is likely an author style choice or draft artifact. Normalizing to the standard numbered-list format keeps the book consistent and reduces rendering edge cases.

**Change:** Convert the table-based AP presentation to the standard numbered-list format:

```markdown
@skill
#### Triage Rig
> I ain't fixin' ya — I'm keepin' ya operatin'.

1. **3 AP** You slap a portable triage rig onto a creature in reach...
@end-skill
```

---

### P7. Voltgeist duplicate entry

**Appears in:**
- `chapter-02 7 Technosorcerer.md` lines 292–310 (narrative prose + bullet format)
- `chapter-02 7 Technosorcerer.md` lines 311–363 (same ability name, standard AP tiers + Live Virus sub-ability)

**Verdict: TRULY UNIQUE — author approval required**

This is a content-level issue, not a component gap. The same ability (Voltgeist) appears twice in the same file with different presentation formats. No CSS or macro can resolve this — the decision to keep, merge, or delete one instance is authorial.

**Do not migrate without author confirmation.** Two possible interpretations:

1. **Draft artifact** — the prose version (lines 292–310) is a flavor description that should be merged into the canonical entry (lines 311–363) as a blockquote flavor intro, then the duplicate deleted.
2. **Intentional** — the two entries represent different ability tiers or modes (e.g., a simplified version and a full-rules version), in which case the structure needs explicit author spec before encoding in `@skill`.

Flag for author review before touching either entry.

---

### P8. Vibe selection table (pick grid)

**Appears in:**
- `chapter-01.md` lines 373–381

**Verdict: TRULY UNIQUE — keep as-is until Gap 8 spec**

The vibe selection table is a player-facing worksheet component (multi-column selection grid, empty first column as write-in field) with no equivalent in the existing component library. `.dc-at-a-glance-card`, `.dc-card`, and the existing section layouts all operate at the wrong scale or register.

The migration plan calls this a `.dc-pick-grid` component (Gap 8) but provides no spec. Keep the plain markdown table until Gap 8 is resolved. Add an HTML comment so future authors understand the intent:

**Change (interim):** Add a comment above the table:

```markdown
<!-- dc-pick-grid: first column is blank player write-in field — do not remove empty cells -->
| | |  | |
|---|---|---|---|
| | Long shadow | Sleepy drag | Street-born instinct |
| | Outsider static | Resting snarl | Corporate chill |
```

When Gap 8 spec is written, the component will need: creaturepunk / paper-poster register, dashed-border or checkbox-style first column, multi-column grid layout.
