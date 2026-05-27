# Primitive Macro Refactoring Report

**Purpose:** Multi-agent research report on refactoring the DC plugin macro system to a core set of primitive macros (`@block`, `@card`) with CSS-based component variants built on top.

**Scope reviewed:** `skeptic-review.md`, `component-mapping.md`, `field-guide-cleanup.md`, `dimm-city-plugin.js`, `markdown-it-paged.js`, `dc-components.css`, `constitution.md`, `contextual-cascade-principle.md`

---

## Executive Summary

Three agents independently reviewed the proposed refactoring. Their findings converge on four conclusions:

1. **`@card` as a new primitive is the right call** — the plugin already has five macros that are structurally identical dumb wrappers (`@lede`, `@toc`, `@glossary`, `@specialty-intro`, `@specialty-art`). A named `@card` shorthand consolidates them with shared infrastructure.

2. **`@skill` CANNOT be simplified to a card primitive** — it is a domain-specific state machine with AP parsing, outcome table classification, two-part chrome geometry, and continuation splitting. Any attempt to reduce it to `@card` would require rewriting most of the field guide's content.

3. **`.dc-card` is a FATAL name** — the skill card system already owns `.dc-card-tab`, `.dc-card-body`, `.dc-card-inner`, `.dc-card-cont-marker`, `.dc-card-fwd-marker`. The new card primitive must be named `.dc-choice-card` (or similar).

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
@end-card
```

Emitted DOM:

```html
<div class="dc-choice-card dc-flaws">
  <div class="dc-choice-card-heading">Flaw Title</div>
  <div class="dc-choice-card-pull">Pull-quote or flavor text</div>
  <div class="dc-choice-card-body">Body paragraph(s)</div>
</div>
```

The macro follows existing `@block` infrastructure: `parseAttrs()`, `closeAll()` integration, end-marker detection via `inCardMode` flag. The internal format is not enforced — missing sections are simply absent from the emitted DOM.

### What `@card` Replaces

| Current syntax | New syntax | Rationale |
|---|---|---|
| `@section .dc-flaws` + raw `<div>` per entry | `@card .dc-flaws` per entry inside `@section .dc-flaws` | Eliminates raw HTML |
| `@section .dc-ideals` + raw `<div>` per entry | `@card .dc-ideals` per entry inside `@section .dc-ideals` | Eliminates raw HTML |
| `@section .dc-dreams` + raw `<div>` per entry | `@card .dc-dreams` per entry inside `@section .dc-dreams` | Eliminates raw HTML |
| `@gear-card` | `@card .dc-gear` inside `@section .dc-gear-list` | Consolidates to primitive |
| `@specialty-intro` (when simplified) | `@card .dc-specialty-intro` | Eliminates separate macro |

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

1. **Name collision:** `.dc-card` is already owned by the skill card system. Use `.dc-choice-card`.

2. **Selector chain must include `.section`:** `@section .dc-flaws` emits `<div class="section dc-flaws">`. The CSS must target `.section.dc-flaws > .dc-choice-card`, not `.dc-flaws > .dc-choice-card`.

3. **Book-specific label classes do NOT belong in `dc-components.css`:** `.dc-flaws`, `.dc-ideals`, `.dc-dreams` are field-guide-specific names for the same generic card list component. The correct approach:
   - `dc-components.css` defines `.dc-choice-card` and `.dc-card-list` (generic)
   - `fg-overrides.css` maps `.section.dc-flaws > .dc-choice-card` to the correct visual
   - A future project with Sins/Virtues/Goals gets the primitive free; it adds only its own label classes to its own override file

---

## Section 2: Macro Consolidation Inventory

### Full Macro Audit

The DC plugin currently has 29 distinct opening markers. Categorized by refactoring potential:

#### Group A — Wrappers that could become `@block .X` today

| Macro | Emits | Migrate to |
|---|---|---|
| `@lede` | `<div class="dc-intro">` | `@block .dc-intro` |
| `@toc` | `<div class="dc-toc">` | `@block .dc-toc` |
| `@glossary` | `<div class="dc-glossary">` | `@block .dc-glossary` |
| `@specialty-intro` | `<div class="dc-specialty-intro">` | `@block .dc-specialty-intro` |
| `@specialty-art` | `<div class="dc-specialty-art">` | `@block .dc-specialty-art` |

These macros do nothing except wrap content in a `<div>` with one class. They're candidates for consolidation, but **only if** `@block` gains `.classname` syntax (currently only `variant=` is accepted).

#### Group B — Named shorthands worth keeping as-is

| Macro | Rationale |
|---|---|
| `@panel`, `@slate`, `@shard`, `@codex` | Four-variant shorthand system; authors know these names; CSS built around them |
| `@sidebar`, `@sidebar-box` | Distinct enough in purpose and frequency to warrant their own names |
| `@definition` | Term/definition semantic pair — not a generic wrapper |
| `@gear-card` | Current behaviour is correct; migrate to `@card .dc-gear` when `@card` exists |

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
    .dc-choice-card                    → base card styles (dc-components.css)
    .section.dc-flaws > .dc-choice-card → flaw-specific overrides (dc-components.css)
```

This cascade is **Contextual Cascade Principle compliant**: authors write semantic markdown; CSS selectors handle variants; no utility classes on wrappers.

### Specificity Collision: Equal-Weight Selectors

The most dangerous architecture problem is equal-specificity collisions between context selectors:

```css
/* Both at specificity 0,3,0 — source order determines winner */
.section.dc-flaws > .dc-choice-card { ... }   /* context: flaw-list */
.dc-specialty.augmerc .dc-choice-card { ... } /* context: augmerc specialty */
```

When both apply simultaneously, the LAST rule in source order wins. This is correct behavior, but it requires deliberate ordering: specialty overrides must come AFTER section overrides in `dc-components.css`.

**Resolution:** Use a third class chain for the intersection case:

```css
.dc-specialty.augmerc .section.dc-flaws > .dc-choice-card { ... }  /* 0,4,0 — wins cleanly */
```

### Token Isolation Requirement

`.dc-skill-card` and the new `.dc-choice-card` must NOT share a CSS token namespace. Their DOM structures differ:

| Skill card | Choice card |
|---|---|
| `.dc-skill-card` wrapper | `.dc-choice-card` wrapper |
| `.dc-card-body` inner | `.dc-choice-card-body` inner |
| `.dc-card-tab` heading | `.dc-choice-card-heading` heading |
| `data-path-ref` attr | no path ref needed |

Using `.dc-card-body` on both creates selector ambiguity. All choice-card sub-elements must be prefixed `.dc-choice-card-*`.

### Paged.js Risk: `filter` + `clip-path` on Shared Ancestor

If `.dc-choice-card` inherits a base `filter: drop-shadow()` rule (for consistent card shadows), and specialty cards use `clip-path` on the same element — the filter will be silently stripped (Paged.js / clip-path rendering interaction).

**Resolution:** Never put `filter: drop-shadow` on the base `.dc-choice-card` rule. Specialty variants that need shadows must use the canonical pattern from `dc-components.css`: `filter` on the wrapper, `clip-path` on a `::before` or child element.

### Architecture Verdict

The `@card` primitive + CSS cascade approach aligns with the Contextual Cascade Principle. Four specific issues must be resolved before implementation:

| Issue | Required fix |
|---|---|
| `.dc-card` name collision | Use `.dc-choice-card` throughout |
| `.dc-flaws > .dc-card` wrong selector | Use `.section.dc-flaws > .dc-choice-card` |
| Book-specific classes in `dc-components.css` | Move to `fg-overrides.css`; expose generic primitives only |
| Equal-specificity trap | Use three-class intersection selectors for specialty + section overlap |

---

## Section 4: Synthesis and Recommended Path

### What We Agree On

All three agents converge on:

1. `@card` is a legitimate new primitive. It fills a real gap and eliminates raw HTML workarounds.
2. `@skill` is a domain-specific compiler, not a card. Do not touch it during this refactoring.
3. `.dc-card` is taken. Use `.dc-choice-card`.
4. The `@block` breaking-change migration (§1.1b in the migration plan) is unnecessary — it solves a problem that does not exist.
5. Book-specific CSS classes (`.dc-flaws`, `.dc-ideals`, `.dc-dreams`) must NOT live in `dc-components.css`. They belong in `fg-overrides.css`.

### Phased Implementation Plan

#### Phase 0 — Prerequisites (no new features)

- Fix `@block` to accept `.classname` syntax (currently only `variant=` works)
- Fix the `.dc-card` name in any existing migration planning docs (rename to `.dc-choice-card`)
- Delete `admonitionRule` from the plugin (dead code)

#### Phase 1 — `@card` primitive

- Implement `@card` / `@end-card` macro in `dimm-city-plugin.js`
- DOM: `<div class="dc-choice-card [author-classes]">` with optional sub-element wrappers
- Reuse: `parseAttrs()`, `closeAll()`, `inCardMode` state flag (mirrors `inSkillMode` pattern)
- Add base `.dc-choice-card` styles to `dc-components.css`
- Test with one content type (`.dc-flaws`) before migrating others

#### Phase 2 — Field guide migration (using `@card`)

Migrate in this order (each depends on Phase 1 completion):

1. `.dc-flaws` entries — three entries in chapter-02; lowest risk
2. `.dc-ideals` entries — six entries; same structure
3. `.dc-dreams` entries — five entries; same structure
4. `@gear-card` consolidation — replace with `@card .dc-gear` + `@outcome` for embedded tables

#### Phase 3 — Wrapper macro consolidation (optional, low value)

Migrate `@lede`, `@toc`, `@glossary`, `@specialty-intro`, `@specialty-art` to `@block .X` only if `@block` `.classname` syntax is working and tested. These macros have zero bug risk and are not blocking anything. Deprioritize.

### What NOT to Do

- **Do not rename `.dc-block.dc-panel` classes across the codebase** (§1.1b migration plan) — the CSS and plugin are in sync; this is wasted churn.
- **Do not add `@stat .npc`** — `@section .dc-npc-stat` already works per the CSS comment at dc-components.css:3407.
- **Do not add `@dm-note`** as a separate macro — `> [!DM]` handles multi-paragraph blocks already; the single-paragraph constraint cited in the migration plan is false (see skeptic-review.md #22, #34).
- **Do not add `.dc-vibe-table`** — name it `.dc-pick-grid` or `.dc-worksheet-grid` so every future DC project gets it free.
- **Do not put `.dc-flaws`, `.dc-ideals`, `.dc-dreams` in `dc-components.css`** — these are field-guide-specific names for a generic component. Add the generic `.dc-card-list` to `dc-components.css`; map the FG-specific names in `fg-overrides.css`.

---

## Open Questions

1. **`@card` footer section** — the user described "a heading, a pull-quote, body text, and then potentially a footer." Should the footer be a distinct sub-element (`.dc-choice-card-footer`) or just the last child of `.dc-choice-card-body`? The former is more explicit; the latter requires less CSS specificity.

2. **`@card` heading level** — should `@card` enforce `####` (h4) as the heading, or accept any heading level? The flaws/ideals/dreams content currently uses `####`; enforcing it simplifies CSS. But `@skill` also uses h4 for tier headings — level collision is not a problem if namespaces are distinct.

3. **Specialty card migration** — `@specialty-card` currently injects `data-specialty` and `data-path-ref` automatically. If migrated to `@card .dc-specialty-card`, these attributes must either be injected by the `@card` macro (coupling a generic primitive to specialty logic) or supplied manually by authors (regression in ergonomics). Recommendation: keep `@specialty-card` as a named shorthand that delegates to `@card` internally.

4. **`@gear-card` + `@outcome`** — Gap 6 in the migration plan claims `@gear-card` supports embedded `.dc-outcome-row` rows. It does not (outcome table classification only fires inside `inSkillMode`). The correct fix is `@outcome` blocks inside `@gear-card`. This needs to be verified against current Schraphose/Yari content before migration.
