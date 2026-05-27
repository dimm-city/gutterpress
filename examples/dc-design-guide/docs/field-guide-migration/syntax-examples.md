# Field Guide Syntax Examples

One representative before/after example for every component and pattern type found in the live field guide source (`dc-op-manual/field-guide/`). File paths are relative to that directory. Use these for author reference and as acceptance tests when migrating.

---

## How to Read This Document

- **BEFORE** — exact source from the live field guide (file + line)
- **AFTER** — canonical new syntax per the migration plan
- Patterns marked ⚠️ have open specs or require author decision before migration

---

## 1. Chapter and Page Markers

### 1.1 Chapter opener

`chapter-02 0.md` line 4 — already correct; shown for reference.

```markdown
@chapter C.02
@page .page-chapter-start .chapter-start .chapter-02
```

No change needed. Canonical.

---

### 1.2 Named page marker

`chapter-01.md` line 2 — already correct.

```markdown
@page .page-info-sidebar .citizen-file .chapter-01
```

No change needed.

---

### 1.3 Column break

`chapter-01.md` line 77 — already correct.

```markdown
---{.column-break}
```

No change needed.

---

## 2. Intro and Lede

### 2.1 Lede container

`chapter-00.md` lines 6–8

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

### 3.1 Wrapper with class — TOC

`chapter-00.md` lines 10–28

**BEFORE:**
```markdown
::: wrapper {.dc-toc}
1. **01** &nbsp; [Who Do You Dream to Be?](#chapter-01) — Citizen file...
2. **02** &nbsp; ...
:::
```

**AFTER:**
```markdown
@block .dc-toc
1. **01** &nbsp; [Who Do You Dream to Be?](#chapter-01) — Citizen file...
2. **02** &nbsp; ...
@end-block
```

⚠️ Requires `@block .classname` syntax fix (Phase 0 prerequisite).

---

### 3.2 Empty wrapper — remove

`chapter-03.md` line 449

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

Delete the wrapper entirely — no class, no purpose.

---

### 3.3 Outcome / rules table (authority register)

`chapter-03.md` line 591

**BEFORE:**
```markdown
::: container {.outcome-table}

### Table of Outcomes
...
:::
```

**AFTER:**
```markdown
@block .slate
### Table of Outcomes
...
@end-block
```

⚠️ Requires `@block` P0b.

---

## 4. Sidebar

`chapter-03.md` line 496

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

All alert types use standard GFM blockquote syntax. Several instances in the field guide still use legacy `{.class}` attribute syntax or `:::wrapper` containers.

### 5.1 VISIT callout

`chapter-01.md` line 79

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

`chapter-01.md` line 387

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

`chapter-01.md` line 420

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

`chapter-01.md` lines 809–819

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

⚠️ Verify `[!GEAR]` handler is registered in `dimm-city-plugin.js` before migrating.

---

### 5.5 DM / NOTE callouts

`chapter-02 0.md` line 63 — already correct; shown for reference.

```markdown
> [!NOTE] The Core Loop of a Dream
> Every moment in Dimm City runs on...
```

No change needed.

---

## 6. Images

### 6.1 Art class rename

`chapter-00.md` line 64 (and ~20 instances throughout the book)

**BEFORE:**
```markdown
![intro-image](images/chapter-00/neonrabbit.png){.art-intro-image}
```

**AFTER:**
```markdown
![intro-image](images/chapter-00/neonrabbit.png){.dc-art-intro-image}
```

All `.art-X` classes gain a `.dc-` prefix. Find-replace across all chapters.

---

### 6.2 `.bottom-center` image position

`chapter-05.md` line 73 (also `chapter-01.md` lines 459, 512, 883)

**BEFORE:**
```markdown
![medkit](images/chapter-02/medkit.png){.bottom-center .art-medkit}
```

**AFTER:**
```markdown
![medkit](images/chapter-02/medkit.png){.dc-art-bottom .art-medkit}
```

---

### 6.3 `{class="X"}` → `{.X}` syntax

`chapter-02 4 Gutterdruid.md` line 5

**BEFORE:**
```markdown
![druid](./images/chapter-03/Gutterdruid.png){class="gutterdruid" }
```

**AFTER:**
```markdown
![druid](./images/chapter-03/Gutterdruid.png){.gutterdruid}
```

Simple find-replace. Markdown-it-attrs supports both; `{.X}` is preferred.

---

## 7. Specialty Sections

### 7.1 Specialty scope wrapper — syntax normalization

`chapter-02 1 Augmerc.md` line 1

**BEFORE:**
```markdown
@specialty {.augmerc}
```

**AFTER:**
```markdown
@specialty .augmerc
```

Remove braces. All 8 specialty files use `{.NAME}` form; all need this fix.

---

### 7.2 Specialty intro block

`chapter-02 1 Augmerc.md` lines 3–25

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

### 7.3 Specialty art block

`chapter-02 1 Augmerc.md` lines 27–31

**BEFORE:**
```markdown
::: wrapper {.specialty-art}

![Augmerc](./images/chapter-02/augmerc.png){.augmerc}

:::
```

**AFTER:**
```markdown
@specialty-art

![Augmerc](./images/chapter-02/augmerc.png){.augmerc}

@end-specialty-art
```

---

### 7.4 Specialty card (chapter-01 overview cards)

`chapter-01.md` lines 228–240 (one of 10 specialty summary cards)

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
@specialty-card
### Augmerc {#specialty-augmerc}

![alt text](images/chapter-01/augmerc.png){.art-specialty}

> Cybernetic Commando

Heavily armed and wired for war...

@end-specialty-card
@end-specialty
```

---

### 7.5 Spec Tweak block

`chapter-02 3 Streetwarden.md` line 19 (same pattern in all 8 specialty files)

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

⚠️ Mandatory — NOT optional. Without the `.slate` wrapper, Spec Tweaks are visually indistinguishable from regular ability entries. Requires `@block` P0b.

---

## 8. Learning Path

`chapter-02 1 Augmerc.md` lines 33–46

**BEFORE:**
```markdown
@learning-path

### Biting Distance

> If you can touch it, you can maul it. When things get close, they bleed.

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

> If you can touch it, you can maul it. When things get close, they bleed.

- Punishing Counter
- Rage Hit
- Dirty Work
- Pain Compliance
- It's Personal

@end-learning-path
```

The macro syntax is already correct; only the closing `@end-learning-path` marker is missing throughout the book.

---

## 9. Skill Abilities

### 9.1 Remove `variant="N"` attribute

`chapter-02 1 Augmerc.md` line 49 (~160 instances across all chapter-02 files)

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

`variant="N"` is silently ignored by the plugin. Remove in a sweep across all chapter-02 files.

---

### 9.2 `<ins>` tags → bold

`chapter-02 2 Proxy.md` line 22

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

`chapter-01.md` lines 463–476

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

⚠️ Blocked on `@card` macro (Phase 1) and `dc-components.css` rules for `.dc-ideals`.

---

### 10.2 Flaw entry

`chapter-01.md` lines 524–538

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

Same pattern as Ideals. Dreams follow the same structure in chapter-02 4 Gutterdruid.md.

---

## 11. At-a-Glance Cards

`chapter-01.md` lines 148–165

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

⚠️ Requires `@block .classname` syntax (Phase 0).

---

## 12. Glossary / Definitions

### 12.1 Two-column glossary wrapper

`chapter-04.md` line 619

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

Drop `.violet` — no CSS backing. The `@definition` macro handles the `dt`/`dd` structure.

---

## 13. Gear Entries

### 13.1 Standard gear entry

`chapter-05.md` lines 344–360

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

`chapter-05.md` lines 435–490

**BEFORE:**
```markdown
::: wrapper {.item .schraphose}

#### Schraphose
...
##### In Reach Damage
| Roll | Result | Damage |
...
##### Nearby Damage
| Roll | Result | Damage |
...
##### In Range Damage
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
[outcome rows]
##### Nearby Damage
[outcome rows]
##### In Range Damage
[outcome rows]

@end-gear
```

⚠️ Blocked on Gap 6 spec — how multiple outcome tables nest inside one `@gear` block is not yet defined.

---

### 13.3 Partially-migrated gear section

`chapter-05.md` line 7

**BEFORE (already partially migrated):**
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

These sections use `@section .aug` instead of `@gear`. Convert to `@gear` / `@end-gear`.

---

## 14. Emoji → Text

`chapter-05.md` lines 512, 540

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

⚠️ Verify emoji font support in the PDF renderer before committing — if emojis render correctly, these may be kept.

---

## 15. Raw HTML Cleanup

### 15.1 Float-clear hack

`chapter-02 4 Gutterdruid.md` line 20

**BEFORE:**
```markdown
<p style="clear:both"></p>
```

**AFTER:**
```markdown
(remove entirely)
```

CSS section context rules should handle float clearance. If a clear is genuinely needed, use `@section` reset behavior — do NOT add raw HTML.

---

---

## Patterns NOT in the Plan

These patterns appear 2+ times in the live source and have no equivalent macro, component, or plan item. Each needs a decision before migration begins.

---

### P1. `::: wrapper {.two-column-list}` for roll tables

**Appears in:**
- `chapter-02 7 Technosorcerer.md` lines 66, 79 (Practical Power ability — spell component lists)
- `chapter-02 8 Etherlock.md` lines 177–190 (Beast Beckoning — land animal table)
- `chapter-02 8 Etherlock.md` lines 198–211 (Beast Beckoning — water animal table)

**Example** (`chapter-02 8 Etherlock.md` line 177):
```markdown
::: wrapper {.two-column-list}
1. 1-2: 1 Taruja Murder
2. 3-4: 1 Swarm of Razor Rats
3. 5-6: 1 Tangle Bear
:::
```

**Options:**
- Remove wrapper and convert to plain markdown table (`| Roll | Result |`)
- Create `@list .two-column` if the two-column layout is essential

**Decision needed:** Is the two-column layout necessary, or is a plain table sufficient?

---

### P2. `:::: wrapper {.item .ability .continued}` — page-spanning ability

**Appears in:**
- `chapter-02 6 Wirephreak.md` lines 188–203 (Bug ability continuation)

**Example:**
```markdown
:::: wrapper {.item .ability .continued}

@skill variant="3"

#### Bug (cont'd.)
...
::::
```

**Options:**
- Remove wrapper; concatenate content into a single `@skill` block
- If page-break splitting is essential, use `@continue` marker inside `@skill` (see component-mapping.md)

**Decision needed:** Does Bug need forced continuation across pages, or can it be a single long `@skill` block?

---

### P3. `@skill {.allow-split}` class attribute

**Appears in:**
- `chapter-02 7 Technosorcerer.md` line 292 (Voltgeist ability)

**Example:**
```markdown
@skill variant="5" {.allow-split}

#### Voltgeist
```

**Status:** `.allow-split` is not in the `@skill` spec. Possibly controls whether the ability card is allowed to break across pages. Requires plugin author to confirm whether this attribute is live, silently ignored, or an artifact.

---

### P4. Wirephreak choice-based Spec Tweak

**Appears in:**
- `chapter-02 6 Wirephreak.md` lines 13–32 (two alternatives: Zero Trace / Hard Wired)

**Example:**
```markdown
### Spec Tweak
Choose one of the following. Your choice sticks unless you decide to work it out with your DM.

**Zero Trace**
You are a ghost in the mists...

**Hard Wired**
You gain a cyberdeck...
```

Unlike all other specialties (single passive power), Wirephreak's Spec Tweak is a player choice between two alternatives. The standard `@block .slate` wrapper applies to the outer block, but the inner choice structure has no component.

**Options:**
- Wrap the whole thing in `@block .slate`, leave inner prose as-is
- Use `@card` entries inside `@block .slate` once `@card` exists
- Author decision: collapse to one canonical choice

---

### P5. Nested ability inside Spec Tweak choice

**Appears in:**
- `chapter-02 6 Wirephreak.md` line 23 (Scope, nested under Hard Wired)
- `chapter-02 7 Technosorcerer.md` line 25 (Scope, nested under Living Terminal)

**Example** (`chapter-02 7 Technosorcerer.md` line 25):
```markdown
### Spec Tweak: **Living Terminal**
You can hack any connected system nearby...

#### Scope
> Your awareness of the tangled web...
0 AP. Passively detect...
```

A full ability definition (`#### Heading` + flavor + AP text) appears directly inside a Spec Tweak block, with no `@skill` wrapper. This may be a bonus ability granted by the Spec Tweak.

**Decision needed:** Should these use `@skill` inside `@block .slate`, or are they treated as plain prose since they're part of the Spec Tweak grant (not standalone learnable abilities)?

---

### P6. Table-based AP presentation (Cybersurgeon Triage Rig)

**Appears in:**
- `chapter-02 5 Cybersurgeon.md` lines 55–69

**Example:**
```markdown
#### Triage Rig
> I ain't fixin' ya — I'm keepin' ya operatin'.

|          |     |
| -------- | --- |
| **3 AP** | You slap a portable triage rig onto a creature in reach... |
```

All other abilities use a numbered list (`1. **3 AP** ...`). This one uses a markdown table for the AP tier. Either an author error or an intentional single-column table format.

**Decision needed:** Convert to standard `1. **3 AP** ...` list format, or confirm as intentional variant?

---

### P7. Voltgeist duplicate entry

**Appears in:**
- `chapter-02 7 Technosorcerer.md` lines 292–310 (narrative prose + bullets)
- `chapter-02 7 Technosorcerer.md` lines 311–363 (same ability name, numbered AP tiers + Live Virus sub-ability)

The same ability (Voltgeist) appears twice in the file with different presentation formats. Either a draft artifact (one should be deleted) or a narrative-then-rules pattern where flavor prose precedes the mechanical entry.

**Decision needed:** Delete one instance, or is the dual-entry intentional? Author approval required before touching this content.

---

### P8. Vibe selection table (pick grid)

**Appears in:**
- `chapter-01.md` lines 373–381

**Example:**
```markdown
| | |  | |
|---|---|---|---|
| | Long shadow | Sleepy drag | Street-born instinct |
| | Outsider static | Resting snarl | Corporate chill |
```

A character worksheet with checkbox-style cells (empty first column). The migration plan calls this a `.dc-pick-grid` component (Gap 8) but does not define the CSS or macro yet. The plain table preserves content correctly until the component is specced.

**Status:** IN_PLAN as a gap, but no spec exists. Keep as-is until Gap 8 is resolved.
