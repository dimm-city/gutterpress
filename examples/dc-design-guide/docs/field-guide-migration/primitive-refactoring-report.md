# Primitive Macro Refactoring Report

> **⛔ CONTENT PROTECTION RULE — PRIMARY CONSTRAINT**
> Migration changes markdown **syntax only**. No prose, dialogue, flavor text, ability text, heading text, game mechanics, or any other author-written content may be altered, rewritten, trimmed, paraphrased, or "improved" without explicit user direction. A syntax migration that changes a single word of content is a failure. Run `content-hash.ts verify` before committing any batch.

**Purpose:** Multi-agent research report on refactoring the DC plugin macro system to a core set of primitive macros (`@block`, `@card`) with CSS-based component variants built on top.

**Scope reviewed:** `skeptic-review.md`, `component-mapping.md`, `field-guide-cleanup.md`, `dimm-city-plugin.js`, `markdown-it-paged.js`, `dc-components.css`, `constitution.md`, `contextual-cascade-principle.md`

---

## Executive Summary

Three agents independently reviewed the proposed refactoring. Their findings converge on four conclusions:

1. **`@card` as a new primitive is the right call** — the plugin already has four macros that are structurally identical dumb wrappers (`@lede`, `@toc`, `@glossary`, `@specialty-intro`). A named `@card` shorthand consolidates them with shared infrastructure. `@specialty-art` is removed from the macro surface entirely — specialty art images are bare image tags within the `@specialty` cascade context.

2. **`@skill` CANNOT be simplified to a card primitive** — it is a domain-specific state machine with AP parsing, outcome table classification, two-part chrome geometry, and continuation splitting. Any attempt to reduce it to `@card` would require rewriting most of the field guide's content.

3. **`.dc-card` is the correct base class name** — the skill card system owns `.dc-card-tab`, `.dc-card-body`, `.dc-card-inner`, `.dc-card-cont-marker`, `.dc-card-fwd-marker`. The new card primitive is also `.dc-card`; sub-elements are scoped by their outer class parent.

4. **The `@block` breaking-change migration (§1.1b) is unnecessary** — `@panel`/`@slate`/`@shard`/`@codex` shorthands already work. The real needed change is: allow `@block` to accept `.classname` syntax in addition to `variant=`.

---

## Section 1: `@card` Primitive Design

### What `@card` Should Be

A `@card` macro should be a structured wrapper that accepts a specific internal format:

```markdown
@card .dc-flaws
#### Flaw Title
> Pull-quote or flavor text
Body paragraph(s)
> Optional footer text
@end-card
```

Emitted DOM:

```html
<div class="dc-card dc-flaws">
  <div class="dc-card-heading">Flaw Title</div>
  <div class="dc-card-pull">Pull-quote or flavor text</div>
  <div class="dc-card-body">
    <p>Body paragraph(s)</p>
    <blockquote><p>Optional footer text</p></blockquote>
  </div>
</div>
```

**Heading level:** `####` (h4) is the enforced heading level inside `@card`. The macro treats the first h4 as the card heading.

**Footer:** The last `>` blockquote in the card body is the footer. No `.dc-card-footer` wrapper is emitted. CSS targets it via `blockquote:last-of-type` under `.dc-card`. This means the first blockquote after the heading is always `.dc-card-pull`; any blockquote at the tail of the body content is the footer.

The macro follows existing `@block` infrastructure: `parseAttrs()`, `closeAll()` integration, end-marker detection via `inCardMode` flag. The internal format is not enforced — missing sections are simply absent from the emitted DOM.

### What `@card` Replaces

| Current syntax | New syntax | Rationale |
|---|---|---|
| `@section .dc-flaws` + raw `<div>` per entry | `@card` per entry inside `@section .dc-flaws` | Eliminates raw HTML; CSS contextual cascade handles variant |
| `@section .dc-ideals` + raw `<div>` per entry | `@card` per entry inside `@section .dc-ideals` | Eliminates raw HTML; CSS contextual cascade handles variant |
| `@section .dc-dreams` + raw `<div>` per entry | `@card` per entry inside `@section .dc-dreams` | Eliminates raw HTML; CSS contextual cascade handles variant |
| `@gear-card` (renamed `@gear`) | `@gear` shorthand for `@card .dc-gear` inside `@section .dc-gear-list` | Renames macro + consolidates to primitive |

### What `@card` Does NOT Replace

**`@skill` is not a card.** The skill card system (plugin lines ~1600–2100) implements:
- AP token parsing (`parseAbilityPoints()` at line 1622)
- State machine tracking (`inSkillMode`, `skillCardDepth`, `inContinue`)
- Outcome table classification (`getTableHeaders()` → `classifyTable()` — ONLY fires inside `inSkillMode`)
- Two-part chrome geometry (`.dc-skill-card` wrapper + `.dc-card-body` inner)
- Continuation splitting (`@continue` = second chrome panel inside same skill)
- Per-specialty `data-path-ref` propagation from `specialtyCodeFromClass()`

Reducing `@skill` to `@card` would require:
- Moving AP parsing out of the macro and into content attributes (breaking author syntax)
- Rebuilding outcome table classification as a standalone pass
- Reimplementing continuation splits without `inSkillMode` state

**Verdict:** `@skill` stays as a domain-specific state machine. It is NOT a target for this refactoring.

**`@specialty-card` stays as a named shorthand.** Its current implementation emits the correct `.dc-specialty-card` DOM with `data-specialty` and `data-path-ref` attributes automatically. Converting it to `@card .dc-specialty-card` would lose the attribute injection unless the `@card` macro is taught specialty-card-specific logic — defeating the purpose.

### Critical Blockers for `@card` Implementation

1. **Selector chain must include `.section`:** `@section .dc-flaws` emits `<div class="section dc-flaws">`. The CSS must target `.section.dc-flaws > .dc-card`, not `.dc-flaws > .dc-card`.

2. **`.dc-flaws`, `.dc-ideals`, `.dc-dreams` CSS belongs in `dc-components.css`:** These are DC component-layer classes. They set styling defaults for the three card-list types and are reusable across DC projects. Only layout context and page-scoped positioning belong in `fg-overrides.css`.

---

## Section 2: Macro Consolidation Inventory

### Full Macro Audit

The DC plugin currently has 29 distinct opening markers. Categorized by refactoring potential:

#### Group A — Block variant shorthands being consolidated to `@block .X` (Phase 2b)

| Macro | Emits | Migrate to |
|---|---|---|
| `@panel` | `<div class="dc-block dc-panel">` | `@block .dc-panel` |
| `@slate` | `<div class="dc-block dc-slate">` | `@block .dc-slate` |
| `@shard` | `<div class="dc-block dc-shard">` | `@block .dc-shard` |
| `@codex` | `<div class="dc-block dc-codex">` | `@block .dc-codex` |

These are visual-register shorthands for `@block`. They carry no semantic identity of their own — `@panel`/`@slate`/`@shard`/`@codex` are names for "data", "authority", "atmosphere", "reference" registers. Consolidating to `@block .dc-X` removes the shorthand macros and makes the register naming explicit. Requires `@block` to accept `.classname` syntax (Phase 0 prerequisite).

**`@specialty-art` is removed from the macro surface.** Specialty art images are bare `![alt](path)` tags inside the `@specialty .name` wrapper — no macro wrapper, no class attribute. CSS in `fg-overrides.css` provides context-scoped image styling.

#### Group B — Semantic wrappers that stay as named macros (NOT consolidation targets)

| Macro | Rationale |
|---|---|
| `@lede` | Semantic identity: the opening lede of a chapter. Not a generic block. |
| `@toc` | Semantic identity: the table of contents. Emits `.dc-toc` structure directly. |
| `@glossary` | Semantic identity: a glossary section. |
| `@specialty-intro` | Semantic identity: the flavor intro block of a specialty chapter. |
| `@sidebar`, `@sidebar-box` | Distinct enough in purpose and frequency to warrant their own names |
| `@definition` | Term/definition semantic pair — not a generic wrapper |
| `@gear` | Current behaviour is correct; migrate to `@card .dc-gear` when `@card` exists |

#### Group C — Transform and state-machine macros (NEVER simplify)

| Macro | Why it cannot be a primitive |
|---|---|
| `@specialty` | Propagates `.dc-specialty.<name>` cascade; emits `data-specialty`, `data-path-ref` |
| `@learning-path` | State tracking for path steps; emits `.dc-spray` header |
| `@skill` | AP parsing, outcome table classification, two-part chrome, continuation splits |
| `@continue` | Continuation split inside skill state machine |
| `@outcome` | Tier-explicit outcome rendering outside skill card context |
| `@roll-table` | Table classification pass on inner content |
| `@options-table` | Multi-column option rendering with specific DOM requirements |

#### Group D — Dead code (remove)

| Symbol | Status |
|---|---|
| `admonitionRule` (`!!!` prefix) | No author content uses it; predates the `> [!TYPE]` alert system; safe to remove |

### Recommended `@block` Changes

1. **Add `.classname` syntax** alongside `variant=`:
   ```markdown
   @block .dc-intro      ← new (currently broken)
   @block variant=intro  ← currently works
   @block .intro         ← new (implied by §1.1b, but §1.1b itself is unnecessary)
   ```
   This is the ONLY `@block` change needed. The "coordinated breaking change" in §1.1b is overhead for zero gain — the existing shorthands already cover all DC use cases.

2. **Add `@card` as a fifth shorthand** (alongside `@panel`/`@slate`/`@shard`/`@codex`) sharing the same infrastructure: `parseAttrs()`, `closeAll()`, end-marker detection.

3. **Do NOT move `@block` from DC plugin to `markdown-it-paged`** — `.dc-block.dc-panel` CSS is inherently DC; a generic block in paged core with DC-only visual classes gains no portability.

---

## Section 3: CSS and Cascade Architecture Analysis

### Cascade Path for `@card` Components

With `@card .dc-flaws` inside `@section .dc-flaws` inside `@specialty .augmerc`:

```
.dc-specialty.augmerc                  → sets specialty accent tokens
  .section.dc-flaws                    → sets card-list layout tokens
    .dc-card                           → base card styles (dc-components.css)
    .section.dc-flaws > .dc-card       → flaw-specific overrides (dc-components.css)
```

This cascade is **Contextual Cascade Principle compliant**: authors write semantic markdown; CSS selectors handle variants; no utility classes on wrappers.

### Specificity Collision: Equal-Weight Selectors

The most dangerous architecture problem is equal-specificity collisions between context selectors:

```css
/* Both at specificity 0,3,0 — source order determines winner */
.section.dc-flaws > .dc-card { ... }   /* context: flaw-list */
.dc-specialty.augmerc .dc-card { ... } /* context: augmerc specialty */
```

When both apply simultaneously, the LAST rule in source order wins. This is correct behavior, but it requires deliberate ordering: specialty overrides must come AFTER section overrides in `dc-components.css`.

**Resolution:** Use a third class chain for the intersection case:

```css
.dc-specialty.augmerc .section.dc-flaws > .dc-card { ... }  /* 0,4,0 — wins cleanly */
```

### Token Isolation Requirement

`.dc-skill-card` and `.dc-card` exist in the same DOM but never on the same element. The skill card system uses `.dc-skill-card` as the outer wrapper; its sub-elements (`.dc-card-tab`, `.dc-card-body`, `.dc-card-inner`) are always scoped under `.dc-skill-card`. The new `.dc-card` primitive is a sibling type, not a descendant. CSS rules like `.dc-skill-card .dc-card-body` and `.dc-card > .dc-card-body` are unambiguous because the outer class differs. No token namespace conflict exists as long as sub-element selectors are written with their correct outer class prefix.

### Paged.js Risk: `filter` + `clip-path` on Shared Ancestor

If `.dc-card` inherits a base `filter: drop-shadow()` rule (for consistent card shadows), and specialty cards use `clip-path` on the same element — the filter will be silently stripped (Paged.js / clip-path rendering interaction).

**Resolution:** Never put `filter: drop-shadow` on the base `.dc-card` rule. Specialty variants that need shadows must use the canonical pattern from `dc-components.css`: `filter` on the wrapper, `clip-path` on a `::before` or child element.

### Architecture Verdict

The `@card` primitive + CSS cascade approach aligns with the Contextual Cascade Principle. Four specific issues must be resolved before implementation:

| Issue | Required fix |
|---|---|
| `.dc-card-body` sub-element overlap | Scope all skill-card sub-selectors to `.dc-skill-card > .dc-card-X`; new card sub-elements use `.dc-card > .dc-card-X` — no ambiguity when outer class differs |
| `.dc-flaws > .dc-card` wrong selector | Use `.section.dc-flaws > .dc-card` |
| Equal-specificity trap | Use three-class intersection selectors for specialty + section overlap |

---

## Section 4: Synthesis and Recommended Path

### What We Agree On

All three agents converge on:

1. `@card` is a legitimate new primitive. It fills a real gap and eliminates raw HTML workarounds.
2. `@skill` is a domain-specific compiler, not a card. Do not touch it during this refactoring.
3. `.dc-card` is the correct base class name for the new card primitive.
4. The `@block` breaking-change migration (§1.1b in the migration plan) is unnecessary — it solves a problem that does not exist.
5. `.dc-flaws`, `.dc-ideals`, `.dc-dreams` CSS belongs in `dc-components.css`. These are DC component-layer classes, not fg-specific overrides.

### Phased Implementation Plan

#### Phase 0 — Prerequisites (no new features)

- Fix `@block` to accept `.classname` syntax (currently only `variant=` works)
- Delete `admonitionRule` from the plugin (dead code)

#### Phase 1 — `@card` primitive

- Implement `@card` / `@end-card` macro in `dimm-city-plugin.js`
- DOM: `<div class="dc-card [author-classes]">` with optional sub-element wrappers
- Reuse: `parseAttrs()`, `closeAll()`, `inCardMode` state flag (mirrors `inSkillMode` pattern)
- Add base `.dc-card` styles to `dc-components.css`
- Test with one content type (`.dc-flaws`) before migrating others

#### Phase 2c — Field guide migration (using `@card` + consolidated macros)

Migrate in this order (depends on Phase 1 and Phase 2b both complete):

1. `.dc-flaws` entries — three entries in chapter-02; lowest risk
2. `.dc-ideals` entries — six entries; same structure
3. `.dc-dreams` entries — five entries; same structure
4. `@gear` consolidation — replace with `@card .dc-gear` + `@outcome` for embedded tables

#### Phase 2b — Block variant consolidation (REQUIRED, before field guide migration)

**Rationale:** `@panel`, `@slate`, `@shard`, `@codex` are named shorthands for `@block variant=X`. Authors writing the field guide should use `@block .dc-panel` etc. directly so the macro surface is smaller and more regular. Consolidating before migration means field guide authors write final canonical syntax the first time through.

Requires Phase 0's `.classname` syntax fix to already be in place.

| Old shorthand | Final form | Notes |
|---|---|---|
| `@panel` | `@block .dc-panel` | No behavior change |
| `@slate` | `@block .dc-slate` | No behavior change |
| `@shard` | `@block .dc-shard` | No behavior change |
| `@codex` | `@block .dc-codex` | No behavior change |

After consolidation: remove the four shorthand macro handlers from `dimm-city-plugin.js` (or keep as deprecated aliases pointing to `@block` logic). Any existing design guide source that uses `@panel`/`@slate`/`@shard`/`@codex` gets a find-replace pass as part of this phase.

`@lede`, `@toc`, `@glossary`, `@specialty-intro` are SEMANTIC wrappers with their own identity and must NOT be collapsed into `@block .X`. They stay as named macros. (`@specialty-art` is removed from the macro surface — see Group A note above.)

### What NOT to Do

- **Do not rename `.dc-block.dc-panel` classes across the codebase** (§1.1b migration plan) — the CSS and plugin are in sync; this is wasted churn.
- **Do not add `@stat .npc`** — `@section .dc-npc-stat` already works per the CSS comment at dc-components.css:3407.
- **Do not add `@dm-note`** as a separate macro — `> [!DM]` handles multi-paragraph blocks already; the single-paragraph constraint cited in the migration plan is false (see skeptic-review.md #22, #34).
- **Do not add `.dc-vibe-table`** — name it `.dc-pick-grid` or `.dc-worksheet-grid` so every future DC project gets it free.

---

## Resolved Decisions

These were open questions at the time of the initial report. All four are now decided.

1. **`@card` footer section — RESOLVED: last blockquote, no sub-element wrapper.**
   The last `>` blockquote in a card's content is the footer. The macro does not emit a `.dc-card-footer` wrapper div. CSS targets it via `:last-of-type` on blockquote descendants of `.dc-card`. This keeps the macro simple and avoids a parallel DOM sub-element for a rarely-used slot.

2. **`@card` heading level — RESOLVED: `####` (h4) enforced.**
   Authors write `####` as the heading inside `@card`. The macro treats the first h4 as the card heading and emits it in `.dc-card-heading`. This simplifies CSS targeting. Namespace collision with `@skill` h4 tier headings is not a problem — skill card h4s are always scoped under `.dc-skill-card`.

3. **Specialty card migration — RESOLVED: `@specialty-card` stays as a named shorthand.**
   `@specialty-card` is kept as a named macro that delegates to `@card` logic internally. It continues to inject `data-specialty` and `data-path-ref` automatically. Authors never write `@card .dc-specialty-card` directly. This avoids coupling the generic `@card` primitive to specialty-specific attribute logic.

4. **`@gear` + `@outcome`** — not yet verified against `dc-op-manual/field-guide/` Schraphose/Yari content. Deferred until field guide migration phase begins. The correct fix when reached: use `@outcome` blocks inside `@gear`, not a spec extension to `@gear` itself.
