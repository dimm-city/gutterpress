# Field Guide Markdown Cleanup

> **⛔ CONTENT PROTECTION RULE — PRIMARY CONSTRAINT**
> Migration changes markdown **syntax only**. No prose, dialogue, flavor text, ability text, heading text, game mechanics, or any other author-written content may be altered, rewritten, trimmed, paraphrased, or "improved" without explicit user direction. A syntax migration that changes a single word of content is a failure. Run `content-hash.ts verify` before committing any batch.

Changes needed in `dc-op-manual/field-guide/` markdown source files to align
with the dc-design-guide canonical patterns. Do not change `field-guide/css/`
— those files are owned by the field-guide build, not the design guide.

Each section includes a **Status** indicator:
- **PENDING** — not yet started
- **PARTIAL** — some files done, others remain
- **DONE** — completed across all relevant files

---

## What was already completed

The following migrations were completed in the design guide examples
(`examples/dc-design-guide/`) and serve as the canonical authoring reference.
The field-guide source files still need the same treatment:

- Design guide uses `@specialty .augmerc` (no braces) — field guide still uses `@specialty {.augmerc}` in all 8 specialty files
- Design guide uses `@specialty-intro` / `@end-specialty-intro` macros — field guide still uses `:::: wrapper {.specialty-intro}` in 3 files
- Design guide specialty art images are bare `![alt](path)` inside `@specialty` scope — field guide still wraps them in `:::: wrapper {.specialty-art}` in 3 files and adds `{.augmerc}` class attributes to images
- Design guide `@skill` cards carry no `variant=` attribute — field guide still has `variant="N"` on all ~160 `@skill` lines
- `dc-art-bottom` CSS is live in `components.css` and `page-templates.css` — `{.bottom-center}` / `:::: wrapper {.bottom-center}` in field guide not yet renamed

---

## 1. `@specialty {.slug}` syntax fix

**Status: PENDING**

All 8 specialty chapter files open with brace syntax. The plugin accepts the
plain-class form; braces are an artefact of early authoring. One find/replace
per file.

| Find | Replace |
|---|---|
| `@specialty {.augmerc}` | `@specialty .augmerc` |
| `@specialty {.proxy}` | `@specialty .proxy` |
| `@specialty {.streetwarden}` | `@specialty .streetwarden` |
| `@specialty {.gutterdruid}` | `@specialty .gutterdruid` |
| `@specialty {.cybersurgeon}` | `@specialty .cybersurgeon` |
| `@specialty {.wirephreak}` | `@specialty .wirephreak` |
| `@specialty {.technosorcerer}` | `@specialty .technosorcerer` |
| `@specialty {.etherlock}` | `@specialty .etherlock` |

**Files (1 occurrence each, line 1-2):**

| File | Line | Count |
|---|---|---|
| `chapter-02 1 Augmerc.md` | 1 | 1 |
| `chapter-02 2 Proxy.md` | 1 | 1 |
| `chapter-02 3 Streetwarden.md` | 2 | 1 |
| `chapter-02 4 Gutterdruid.md` | 2 | 1 |
| `chapter-02 5 Cybersurgeon.md` | 2 | 1 |
| `chapter-02 6 Wirephreak.md` | 2 | 1 |
| `chapter-02 7 Technosorcerer.md` | 2 | 1 |
| `chapter-02 8 Etherlock.md` | 2 | 1 |

**Risk:** Low. Purely syntactic. Visually identical output. Safe to do first.

---

## 2. Specialty opener containers — migrate to `@specialty-intro`; remove art wrapper

**Status: PENDING**

Three specialty files still use the legacy `:::: wrapper` syntax for the intro block and art panel. The other five (Gutterdruid, Cybersurgeon, Wirephreak, Technosorcerer, Etherlock) have no intro/art block at all — they need those sections added when content is ready.

**`@specialty-art` is NOT used.** The specialty art image sits as a bare image tag directly inside the `@specialty .name` wrapper — no wrapper macro, no class attribute on the image. CSS in `fg-overrides.css` targets it via `.dc-specialty img` or `.dc-specialty.augmerc img`.

### Files that need the intro container rename

| File | Find | Replace |
|---|---|---|
| `chapter-02 1 Augmerc.md` (line 3) | `:::: wrapper {.specialty-intro}` | `@specialty-intro` |
| `chapter-02 2 Proxy.md` (line 3) | `:::: wrapper {.specialty-intro}` | `@specialty-intro` |
| `chapter-02 3 Streetwarden.md` (line 4) | `:::: wrapper {.specialty-intro}` | `@specialty-intro` |

Replace the closing `::::` after each specialty-intro block with `@end-specialty-intro`.

### Files that need the art wrapper removed

| File | Action |
|---|---|
| `chapter-02 1 Augmerc.md` (line 27) | Delete `:::: wrapper {.specialty-art}` and closing `::::`. Remove `{.augmerc}` from the image. Leave the bare image in place. |
| `chapter-02 2 Proxy.md` (line 31) | Same — delete wrapper lines, remove image class. |
| `chapter-02 3 Streetwarden.md` (line 25) | Same — delete wrapper lines, remove image class. |

**Risk:** Medium. Verify the intro panel renders correctly after migration. The art image will rely on `fg-overrides.css` context selectors — confirm those selectors are in place before migrating.

---

## 3. `@skill variant="N"` — remove the silently ignored attribute

**Status: PENDING**

> **Dreams section:** Do NOT migrate the Dreams section to `@card` entries at this time. Dream titles use `**Bold**` prose (not `####` headings) — the `@card` macro would emit no `.dc-card-heading` for them. This needs an author decision before migrating. Leave the Dreams section in its current form until the author confirms the heading format.

The `variant=` attribute was removed from the plugin. It is currently parsed
and silently discarded — it has no effect on output. All ~160 occurrences
across the field guide should be stripped. The specialty CSS parent-container
model (`@specialty .augmerc`) replaces per-card variant attributes entirely.

### File scope

| File | Count | Variant values found |
|---|---|---|
| `chapter-02 0.md` | 1 | `"3"` |
| `chapter-02 1 Augmerc.md` | 20 | `"2"` |
| `chapter-02 2 Proxy.md` | 20 | `"4"` |
| `chapter-02 3 Streetwarden.md` | 20 | `"2"` |
| `chapter-02 4 Gutterdruid.md` | 20 | `"2"` |
| `chapter-02 5 Cybersurgeon.md` | 19 | `"2"` |
| `chapter-02 6 Wirephreak.md` | 16 | `"3"` |
| `chapter-02 7 Technosorcerer.md` | 17 | `"2"` |
| `chapter-02 8 Etherlock.md` | 27 | `"4"` |

**Total: ~160 occurrences across 9 files.**

### Find / replace patterns

When `variant=` appears alone (no other attrs):

```
Find:    @skill variant="2"
Replace: @skill
```

```
Find:    @skill variant="3"
Replace: @skill
```

```
Find:    @skill variant="4"
Replace: @skill
```

When `variant=` appears with a class modifier (preserve the class):

```
Find:    @skill variant="2" {.allow-split}
Replace: @skill {.allow-split}
```

```
Find:    @skill variant="4" {.allow-split}
Replace: @skill {.allow-split}
```

```
Find:    @skill variant="4" {.continued}
Replace: @skill {.continued}
```

```
Find:    @skill variant="3" {.example}
Replace: @skill {.example}
```

Regex alternative (covers all variants at once):
`@skill variant="[^"]+"( |\b)` → `@skill$1`

**Risk:** Low. The attribute is already silently discarded. Output is identical
before and after. No visual verification required.

---

## 4. Callout class renames (chapter-01.md)

**Status: PENDING**

The design guide no longer defines `.vibe-callout`, `.visit-callout`,
`.origin-callout`, `.human-callout`, or `.gear-callout` as CSS classes. These
were pre-migration short names. Migrate to GFM alert syntax (single-paragraph
callouts) or plugin macros (multi-paragraph blocks).

### Inline attrs — single-paragraph callouts

Replace the trailing inline attr with a GFM blockquote alert wrapping the
preceding paragraph.

| Find (inline attr) | File / Line | Replace with |
|---|---|---|
| `{.visit-callout}` | `chapter-01.md` line 82 | `> [!VISIT]` alert block ✅ registered in plugin |
| `{.vibe-callout}` | `chapter-01.md` line 388 | `> [!VIBE]` alert block ✅ registered in plugin |
| `{.origin-callout}` | `chapter-01.md` line 421 | `> [!ORIGIN]` alert block ✅ registered in plugin |

Example:

```markdown
Before:
DM tip: Ask each Dreamer for one vibe cue, then echo it back in the first NPC reaction.
{.vibe-callout}

After:
> [!VIBE]
> DM tip: Ask each Dreamer for one vibe cue, then echo it back in the first NPC reaction.
```

**Risk:** Low. Verify callout label and color in preview after migration.

### Multi-paragraph blocks — plugin macros

| Find | File / Lines | Replace with |
|---|---|---|
| `:::: wrapper {.human-callout}` ... `::::` | `chapter-01.md` line 190 | `@dm-note` ... `@end-dm-note` |
| `:::: wrapper {.gear-callout}` ... `::::` | `chapter-01.md` line 809 | `@callout variant=gear` ... `@end-callout` |

The `@dm-note` macro accepts an optional `label="..."` attribute if a custom
heading is needed. For `@callout`, use `variant=gear` to get the gear-callout
visual style. `label=` sets only the title text; without `variant=gear` the
default note style is used instead of the gear register.

**Risk:** Medium. Verify the callout title bar appears correctly. The
gear-callout block is multi-paragraph; ensure all content is enclosed before
the end marker.

---

## 5. Legacy container class renames

**Status: PENDING**

The following class names were renamed as part of the dc-brand.css migration.
The field guide source files still use the old names.

| Old class (field-guide) | New class (canonical) | Notes |
|---|---|---|
| `.section-header` | _(remove entirely)_ | Replace with `@section .dc-ideals` / `@section .dc-flaws`; see below |
| `.at-a-glance-cards` / `.at-a-glance-card` | _(remove)_ | Component removed from scope; see below |
| `.specialty-intro` (wrapper) | macro output `dc-specialty-intro` | Migrate to `@specialty-intro` (see §2) |
| `.specialty-art` (wrapper) | bare image inside `@specialty` scope | Remove `:::: wrapper {.specialty-art}` and closing `::::`. Remove image class attribute. See §2. |

### `.section-header` → **skip intermediate rename**

**File:** `chapter-01.md`, lines 451 and 514 (2 occurrences).

**⚠️ Do NOT rename to `.dc-section-header`** — that class does not exist in
`dc-components.css`. These containers will be replaced entirely by the
`@section .dc-ideals` / `@section .dc-flaws` macro migration. Migrate directly
to the macro form; skip the intermediate rename step.

**Attribution quotes (Ideals and Flaws sections):** In chapter-01, the attribution
quotes after each entry title are inline paragraphs (not `>` blockquotes). The
`@card` macro handles this correctly — blockquote pull-quote extraction is optional.
If no blockquote immediately follows the h4 heading, the body opens directly and
the attribution paragraph renders as normal body content. **No content restructure
required.** Authors can optionally convert to `>` blockquotes later for
`.dc-card-pull` styling.

**"Other Flaws" and "Other Ideals" blank-column tables** (chapter-01 lines 589, approx.):
These are print fill-in worksheets (players circle/write in a choice). **Do NOT
migrate to `@card` entries.** Convert to a plain markdown bullet list for clean
migration-safe output.

### `.at-a-glance-cards` / `.at-a-glance-card` — **REMOVED FROM SCOPE**

**File:** `chapter-01.md`, lines 148-165 (1 outer container + 3 inner cards).

**Decision:** The `.dc-at-a-glance-card` component has been removed from the migration
scope. Replace the `:::: wrapper {.at-a-glance-cards}` outer container with a
plain `@section`, and the individual `:::: wrapper {.at-a-glance-card}` inner
containers with plain markdown prose — no named component required. If a more
styled treatment is needed later, it can be added as a book-specific rule in
`book-sections.css`.

---

## 6. Specialty card catalog — migrate to `@specialty` + `@specialty-card` macros

**Status: PENDING**

> **⛔ CHAPTER-01 ONLY.** `@specialty-card` is used exclusively on the chapter-01 specialty overview page. Chapter-02 specialty files use `@specialty-intro` for the text block and a bare image for the art — no `@specialty-card` or `@specialty-art` macro.

`chapter-01.md` lines 226-338 use a deep `::::: wrapper {.specialty-spread}`
outer container with ten `:::: wrapper {.specialty-card .<name>}` inner cards.
The canonical replacement is `@specialty .<name>` + `@specialty-card #id` per card.

Old pattern:
```markdown
::::: wrapper {.specialty-spread}
:::: wrapper {.specialty-card .augmerc}
### Augmerc {#specialty-augmerc}
![art](path){.art-specialty}
> Tag line
Description text.
::::
...
:::::
```

New pattern (one `@specialty` block per card):
```markdown
@specialty .augmerc

@specialty-card #specialty-augmerc

### Augmerc

![art](path)

> Tag line

Description text.

@end-specialty-card

@end-specialty

@specialty .proxy

@specialty-card #specialty-proxy

### Proxy

...

@end-specialty-card

@end-specialty
```

Key rules:
- The `#id` goes on `@specialty-card`, NOT on the heading. Remove `{#specialty-augmerc}` from the `### Augmerc` heading.
- Images have **no class attribute** — the `@specialty .augmerc` cascade handles image styling via CSS context. Remove `{.art-specialty}` and any other image class attributes.
- The outer `::::: wrapper {.specialty-spread}` has no macro equivalent. The page CSS handles the grid without it — verify visually and remove the outer wrapper.

**Files:** `chapter-01.md` lines 226-338 (10 specialty cards + 1 outer container).

**⚠️ Dual-specialist and generalist cards:** The live tree has 10 cards including
`.specialty-card .dual-specialist` and `.specialty-card .generalist`. When
migrating, use the canonical slugs `dualist` and `generalist` (NOT `dual-specialist`
— the hyphenated form has no matching CSS cascade rule in `dc-components.css`):

```markdown
@specialty .dualist

@specialty-card #specialty-dualist

### Dual Specialist

...

@end-specialty-card

@end-specialty

@specialty .generalist

@specialty-card #specialty-generalist

### Generalist

...

@end-specialty-card

@end-specialty
```

**Risk:** High. Visual verification required. The page-template for the
choose-specialty catalog page may depend on the `.specialty-spread` outer div.
Confirm grid layout is intact before merging.

---

## 7. Two-column layout — use `@section` with class modifiers

**Status: PENDING**

| Find | Replace | File(s) |
|---|---|---|
| `::::: wrapper {.two-column .dc-terms}` | `@section .two-column` | `chapter-04.md` (lines 619, 735) |
| Closing `:::::`  after dc-terms block | `@end-section` | `chapter-04.md` |
| `:::: wrapper {.two-column-list}` | `@section .two-column-list` | `chapter-02 7 Technosorcerer.md` (lines 66, 79); `chapter-02 8 Etherlock.md` (lines 177, 198) |
| Closing `::::` after two-column-list block | `@end-section` | same files |

For the glossary sections in `chapter-04.md`, migrate the inner
`:::: wrapper {.item}` entries to `@definition` in the same pass (see §8).

**Risk:** Low. `@section` / `@end-section` are stable macros. Verify column
count and gap in preview.

---

## 8. Glossary entries — use `@definition`

**Status: PENDING**

The `.item` wrapper pattern produces a glossary entry. The design guide
equivalent is `@definition` / `@end-definition`.

Old pattern:
```markdown
:::: wrapper {.item}
**Term:** Definition text here.
::::
```

New pattern:
```markdown
@definition
**Term:** Definition text here.
@end-definition
```

The `.item.violet` modifier has no CSS backing — it is invisible today. Drop
`.violet` when migrating; if highlighted entries are needed later, add a
field-guide-specific rule in `book-sections.css`.

**Files and scope:**

| File | `.item` | `.item .violet` | Total |
|---|---|---|---|
| `chapter-04.md` | 11 | 2 | 13 |
| `chapter-05.md` | 8 | 0 | 8 |

**Risk:** Low. Dropping `.violet` is visually safe (no existing CSS). Standard
`@definition` / `@end-definition` are stable.

---

## 9. Art positioning — rename `{.bottom-center}` to `{.dc-art-bottom}`

**Status: PENDING**

The `dc-art-bottom` CSS class is live in both `components.css` and
`page-templates.css`. Migration is unblocked.

| Find | Replace |
|---|---|
| `:::: wrapper {.bottom-center}` | `:::: wrapper {.dc-art-bottom}` |
| `![img](path){.bottom-center}` | `![img](path){.dc-art-bottom}` |

**Files and scope:**

| File | Pattern | Lines | Count |
|---|---|---|---|
| `chapter-03.md` | `:::: wrapper {.bottom-center}` | 182, 712 | 2 |
| `chapter-05.md` | `![...]{.bottom-center}` | 99 | 1 |

Note: `chapter-01.md` in `dc-op-manual/field-guide/` has **three** live
`.bottom-center` image class attributes (lines 459, 512, 883 — `{.bottom-center .art-slothhh}`,
`{.bottom-center .art-badger}`, `{.bottom-center .art-scavenger}`). These are
image-attr form, not `:::: wrapper` containers. Add them to the migration scope
above and rename to `{.dc-art-bottom}` in the same pass.

**Risk:** Low. Class rename only. Verify the art plate pins to the bottom of
the page in a build preview before committing.

---

## 10. Legacy ability containers — `:::: ability` / continuation wrappers

**Status: PARTIAL**

Most files have been migrated from `:::: ability` to `@skill`. One surviving
hybrid block remains:

**`chapter-02 6 Wirephreak.md` line 188:** `::::: wrapper {.item .ability .continued}`
followed immediately by `@skill variant="3"`. After `variant=` is stripped
(§3), the outer wrapper must also be removed so only the `@skill {.continued}`
macro line remains.

```markdown
Before:
::::: wrapper {.item .ability .continued}

@skill variant="3"

After:
@skill {.continued}
```

All other specialty files confirmed clean of `:::: ability` /
`:::: ability-continued` containers.

**Risk:** Low. The `.continued` class modifier on `@skill` is supported. Verify
the continuation tab renders correctly in preview.

---

## 11. Dead containers — delete or replace

**Status: PENDING**

| Container | File | Line | Action |
|---|---|---|---|
| `::::: wrapper {.specialty-spread}` | `chapter-01.md` | 226 | Replace with raw HTML wrapper or remove (see §6) |
| `:::: wrapper {.call-home-img}` | `chapter-01.md` | 393 | Delete — the image inside is already commented out |
| `::::: wrapper {.item .ability .continued}` | `chapter-02 6 Wirephreak.md` | 188 | Remove outer wrapper (see §10) |
| `:::: aug` (9 containers) | `chapter-05.md` | — | **DONE — replaced with `@section .aug`** |
| `data-augmented-ui` wrapper (ch-03 line 185) | `chapter-03.md` | 185 | Drop attribute; rename `{.bottom-center}` → `{.dc-art-bottom}` (do in §9 pass) |
| `data-augmented-ui` wrapper (ch-03 line 718) | `chapter-03.md` | 718 | Same |
| `data-augmented-ui` wrapper (ch-03 line 1105) | `chapter-03.md` | 1105 | Remove wrapper; use plain image |
| `data-augmented-ui` wrapper (ch-00 line 139) | `chapter-00.md` | 139 | Remove wrapper; use plain image or `.dc-art-bottom` |

**Risk:** The `.call-home-img` delete is safe (no live content). The
`.specialty-spread` change requires visual review (§6).

---

## What does NOT change

- `book-sections.css`, `field-guide.css`, `book-pages.css` — field-guide
  internal CSS, not owned by design guide
- `@page` annotations with chapter-specific classes (`.chapter-01`, `.ideal`,
  `.flaw`, `.citizen-file`, etc.) — chapter layout, not design system
- `.dc-specialty-card.[specialty-name]` on the choose-specialty page — keep
  per-specialty names as layout hooks for `book-sections.css`; the grid belongs
  to the page template
- `.ideal-list` / `.flaw-list` — chapter-01 specific page template; stays in
  `book-sections.css` scope, not a design guide element
- `.weapon-01`, `.item.right-side` — chapter-05 layout hacks; stay in
  `book-sections.css`
- `:::: wrapper {.weapon-01}` and `:::: wrapper {.item .schraphose}` in `chapter-05.md` — book-specific layout containers; keep in field-guide CSS scope
- `:::: wrapper {.dc-toc}` in `chapter-00.md` — already uses `dc-` prefix;
  migrate to `@toc` / `@end-toc` only if reworking `chapter-00.md` anyway
- `:::: wrapper {.dc-sidebar}` in `chapter-02 0.md` and `chapter-01.md` —
  already uses `dc-` prefix; migrate to `@sidebar` / `@end-sidebar` only if
  reworking those pages
