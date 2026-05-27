# DC Design System — Normalization Debate
## Three-Expert Review Panel

**CSS Architecture Expert (A)** — token taxonomy, naming, layer ownership
**Design Systems Expert (DS)** — component API, grouping, author/DX
**Print / Paged.js Specialist (P)** — print safety, CMYK, Paged.js risks

---

## Consensus: What Must NOT Change

All three experts agree on these — treat as frozen:

1. **Specialty parent-scope cascade** — `.dc-specialty.augmerc` sets accents/clip/color for all children via CSS. Zero markup overhead on children. This is the Contextual Cascade Principle working correctly.
2. **Two-layer clip-path + filter pattern** — filter on outer element, clip-path on child `::before`. Correct for any component needing geometric clip AND visible drop-shadows.
3. **Chapter-opener composite architecture** — data-attribute propagation from plugin, selector chains on `.page[data-page="intro"]`, filter:drop-shadow on the wrapper. Do not touch.
4. **Seven-file hierarchy with ownership contracts** — clean portability boundary. The `MUST NOT CONTAIN` lists in each file header are enforceable and correct.
5. **Industrial warm / brand cyber / fungi / crystal pillar palette** — names communicate editorial intent, values are SWOP-corrected and contrast-checked. Do not simplify or rename.
6. **Font family tokens** — five role-names (`--font-display`, `--font-tab`, `--font-body`, `--font-sans`, `--font-mono`) cover all print typographic contexts without over-specifying.

---

## Debate: Where the Experts Diverge

### Issue 1: Semantic Bridge Between Pillar Tokens and Components

**A says:** The most critical structural gap. Components reach directly into the pillar layer (`--dc-alert-bg: var(--hud-blue-dim)`). No semantic intermediary. Reskinning for a variant book requires touching every component rule.

**DS says:** Agree it's a gap, but the author doesn't feel this pain directly — they never write token names. The missing documentation of the *public token API per component* is what hurts more: an author who wants Chapter 4's alerts in a different color has no documented path.

**P says:** The chain also breaks at the Paged.js level. `--section-accent: var(--brand-magenta)` works *only because* both are in the same `:root` block. Any new project that tries to override `--brand-magenta` globally in a second stylesheet will find `--section-accent` does not update — Paged.js resolves the `var()` chain from the first stylesheet.

**Verdict — all three agree on the fix direction:** Declare component public tokens at `:root` in `dc-tokens.css` (not inside the component class). Introduce a thin semantic layer for the handful of surface-role tokens (`--surface-callout`, `--surface-panel`, `--text-on-dark`, etc.) that components consume. Do NOT require components to use the semantic layer everywhere — only where a new project would need to swap the value.

---

### Issue 2: `:nth-of-type` / `:first-of-type` with Break Properties

**P says:** This is a live print bug, not a theoretical one. Paged.js rewrites every `:nth-of-type` / `:first-of-type` / `:last-of-type` into `[data-nth-of-type*=hash]` selectors, ignoring ancestor context. The following rules are currently broken in documents with multiple specialty sections:
- `.dc-card-grid .dc-specialty:first-of-type { break-before: avoid }` — leaks to ANY first `.dc-specialty` in its subtree
- `.dc-ability:nth-last-of-type(2)` with `break-after: avoid` — leaks to all second-to-last `.dc-ability` elements in the document
- `.dc-specialty-card:nth-of-type(even)` — alternating accent border applied document-wide, not scoped to specialty sections
- `.dc-definition-block:first-of-type` and `:nth-of-type(2)` in `.dc-rules-definition` — leaks accent color tokens

**A says:** The root cause is a missing DOM contract. The chapter-opener already solved this correctly: plugin propagates `data-chapter-label` to child elements, CSS targets the attribute. The same pattern should replace every `nth-of-type` selector that uses break or layout-critical properties.

**DS says:** The author doesn't see this directly but debugging it is brutal. When the specialty card alternating accent silently fires on cards outside the specialty section, authors assume they did something wrong. Document the broken patterns prominently in the reference.

**Verdict:** Replace every `:nth-of-type` / `:first-of-type` selector that carries break properties OR layout-critical custom property assignments with data-attribute selectors propagated by the plugin. This is mandatory for cross-project correctness.

---

### Issue 3: Component Token Scope (Class-Level vs. `:root`-Level)

**A says:** This is the CSS custom property inheritance anti-pattern. Tokens declared inside `.dc-alert { --dc-alert-bg: var(--hud-blue-dim); }` block the parent cascade. A parent that sets `--dc-alert-bg` at a higher scope cannot override the component's own declaration without equal or higher specificity.

**DS says:** In practice, the fix unlocks the author self-service story. Right now, "override this component for chapter 4" requires writing a `.chapter#ch-04 .dc-alert { --dc-alert-bg: ... }` rule in fg-overrides.css. If the token were at `:root`, a `#ch-04 { --dc-alert-bg: ... }` at the chapter scope would suffice. The DX gap is real.

**P says:** The `:root` pattern is the only reliable one in Paged.js. Class-scoped custom properties survive paged.js correctly (they inherit down the DOM), but `:root` defaults are simpler to reason about and less likely to be silently shadowed by the paged.js DOM reconstruction.

**Verdict:** All three agree. Move all component default tokens to `:root` in `dc-tokens.css`. Component rules consume them via `var()` only — no re-declaration inside component classes.

---

### Issue 4: Naming Conventions — Pillar Prefixes

**A says:** Four naming strategies coexist at the same tier:
- Bare names: `--blood`, `--rust`, `--amber`
- Pillar-prefixed: `--fungi-glow`, `--crystal-aqua`
- Brand-prefixed: `--brand-magenta`, `--brand-cyan`
- HUD-prefixed: `--hud-blue`, `--hud-panel`

A developer importing this for a second project cannot tell which tokens are global (all projects), which are brand-specific, and which are accent-only.

**DS says:** The naming confusion hurts authors less than it hurts developers. Authors never write `--blood` in their markdown. The bigger DX problem is that `--dc-` prefix breaks down: `--section-bg` and `--section-accent` don't carry the `--dc-` prefix, so a global search for `--dc-` misses the primary section tokens.

**P says:** From a print portability view, the bigger issue is undocumented CMYK/TAC values on specialty-dark tokens. `--proxy-dark: #3d1a00` is approximately 233% TAC — approaching the 240% SWOP/GRACoL limit with no annotation. All specialty-dark tokens need TAC documentation matching the fungi pillar standard.

**Verdict:**
- Rename `--section-bg` → `--dc-section-bg` and `--section-accent` → `--dc-section-accent` (fixes the prefix contract, non-breaking in new projects)
- Introduce prefix for industrial warm bare names: `--warm-crimson`, `--warm-blood`, `--warm-orange` etc. in a future refactor pass (breaking — phase this)
- Add TAC annotations to all specialty-dark tokens (documentation only, no value changes)

---

### Issue 5: Component Grouping for Authors

**DS says:** The reference doc groups by visual appearance ("Typography Decorations") but authors think in communication intent ("I want GM-only info here" or "I need to show the player a rule"). The current nine-callout flat list is the worst offender — authors can't know which to reach for.

**A says:** The grouping problem is secondary to the documentation problem. Even with perfect grouping, if there's no macro → class cross-reference table, an author who knows `@lede` exists can't find `.dc-intro` in the reference.

**P says:** Some groupings also mask print-specific incompatibilities. Putting `.dc-cover-page` alongside `.dc-toc` in "Cover/TOC" is fine visually, but cover page has PDF/X transparency concerns that TOC doesn't. Authors submitting to Ingram need to know the cover has special handling requirements.

**Verdict:** Three changes to the reference doc (not the CSS):
1. Add a macro → class cross-reference table as the first section
2. Mark sub-elements (plugin-emitted, not author-authored) visually distinct from top-level author surfaces
3. Add a callout decision tree (who sees it? what register? how urgent?)

---

## Agreed Prioritized Action List

### P0 — Bugs (silent rendering errors in current docs)

> **Prerequisite for P0-2 and P0-3:** The CSS fixes require `dimm-city-plugin.js` to emit a positional data attribute (`data-position="even/odd"` or `data-index="N"`) during token processing. Plugin change must land before the CSS selector change in the same or prior commit.

| # | Issue | File | Fix |
|---|---|---|---|
| P0-2 | `:nth-last-of-type(2)` break-after leak on `.dc-ability` — densely used in skill-card pages, misfire causes column overflow | `dc-components.css:2608` | Plugin emits `data-ability-index`; CSS targets `[data-ability-index]` instead |
| P0-3 | `:nth-of-type(even)` alternating accent + float leak on `.dc-specialty-card` — fires document-wide, visible border/image misalignment in multi-specialty chapters | `dc-components.css:1679` | Plugin emits `data-position="even"` on even cards; CSS targets `[data-position="even"]` |

> **Downgraded from P0 → P1 (see P1-6, P1-7):** P0-1 (`.dc-card-grid .dc-specialty:first-of-type`) and P0-4 (`.dc-rules-definition nth-of-type`) — ancestor qualifiers limit the practical leak scope; these are correctness defects, not page-breaking regressions.

### P1 — Cross-Project Portability Blockers

> **Execution order matters — follow this sequence:** P1-3 → P1-4 → P1-1 (Batch A → B → C) → P1-2

| # | Issue | Fix |
|---|---|---|
| P1-3 | No semantic bridge — components reach directly into pillar layer | Inventory existing semantic tokens first to avoid redundant additions. Add ~20 semantic surface/text role tokens at `:root`; update component consumers. Semantic tokens point to pillar; components point to semantic. |
| P1-4 | Specialty token block is project-specific, zero portability story | **Do NOT create a new CSS file** (the seven-file hierarchy is frozen). Place specialty token block inside existing `dc-tokens.css` `:root` with a clear comment boundary separating Dimm City-specific tokens from base library tokens. |
| P1-1 | Component public tokens declared inside component class (blocks parent cascade) | Move to `:root` in `dc-tokens.css`. **Split into three batches with a smoke render between each:** Batch A = section component tokens (minimal blast radius); Batch B = alert + skill-card + specialty-intro; Batch C = remaining components. Never attempt in one commit. |
| P1-2 | `--section-bg` / `--section-accent` missing `--dc-` prefix | Rename; update all consumers. ⚠️ **Frozen zone:** `dc-components.css:3689–3690` sets these tokens inside the chapter-opener composite — those two lines require explicit per-change user approval before execution. |
| P1-5 | `--section-accent` chain breaks under global `--brand-magenta` override in second stylesheet | Document: overrides must target semantic tokens directly, not underlying pillar tokens |
| P1-6 | `:first-of-type` break-before leak on `.dc-specialty` inside `.dc-card-grid` | `dc-components.css:3557` — plugin emits data attribute; CSS targets attribute (lower urgency than P0-2/3 due to narrow `.dc-card-grid` ancestor scope) |
| P1-7 | `:first-of-type` / `:nth-of-type(2)` accent token leak in `.dc-rules-definition` | `dc-components.css:3832` — plugin emits `data-index`; CSS targets attribute (custom property only, not visible layout) |
| P1-8 | `fg-overrides.css` contains bare `.dc-*` rules violating layer ownership | Lines 142–148 and 365–368 confirmed: `.dc-specialty .dc-learning-path`, `.dc-specialty .dc-skill-card.allow-split`, `.dc-specialty.augmerc:has(...)`. Move to `dc-components.css` or add layout-context scope qualifier. |

### P2 — Print Safety

| # | Issue | Fix |
|---|---|---|
| P2-1 | `--proxy-dark` (#3d1a00) — ~233% TAC, undocumented | Add TAC annotation; evaluate lift to `#4a2000` |
| P2-2 | `--streetwarden-accent` — no CMYK/TAC documentation | Add annotation matching fungi pillar standard |
| P2-3 | `--text-secondary` (#a8b0bc) — 2.1:1 contrast, listed as unsafe for print text | **Grep `var(--text-secondary)` across all CSS files first.** If no consumer: remove the token. If consumers found: raise value to ≥4.5:1 (approximately `#5a6070`). |
| P2-4 | Cover page `rgba()` vignettes — fail PDF/X-1a preflight | Add `dc-tokens-print.css` override with pre-composited opaque equivalents |
| P2-5 | `--shadow-ink-border` token — no clip+filter usage warning | Add comment: do not consume on elements with `clip-path` |
| P2-6 | `--shadow-poster: 2pt 3pt 0 rgba(0,0,0,0.28)` uses `rgba()` — same PDF/X-1a risk as cover vignettes but consumed by every specialty card, skill card, path shell, and stat block | Pre-composite to opaque equivalent or include in `dc-tokens-print.css` alongside P2-4 |
| P2-7 | `color-mix()` in `.section.tabbed` gradient (`dc-components.css:3024–3026`) — may not resolve correctly in PDF/X-1a preflight processors | Evaluate Ingram impact before submission |

### P3 — Naming / Convention Cleanup

| # | Issue | Fix |
|---|---|---|
| P3-1 | `--ink-bruise` in wrong semantic group | Move to palette alongside `--brand-violet` |
| P3-2 | `--surface-tint-3: #f2f0ec` — no comment, no consumers | Remove or document |
| P3-3 | `--shadow-light` is a hex color in the shadows group | Rename to `--color-shadow` or move to paper group |
| P3-4 | Industrial warm bare names (`--blood`, `--rust`) — no pillar prefix | Phase to `--warm-*` prefix in next breaking refactor pass |
| P3-5 | `--hud-blue-bright` and `--hud-magenta` aliases may add no semantic value | **Consumer audit required before any action.** `--hud-magenta` is confirmed in at least three component base rules. Removal requires find-replace of all consumers in the same commit. |

### P4 — Documentation (no CSS changes)

| # | Fix |
|---|---|
| P4-1 | Add macro → class cross-reference table to `components-and-palette-reference.md` |
| P4-2 | Mark plugin-emitted sub-elements as "not author-authored" in reference |
| P4-3 | Add callout decision tree (audience → register → urgency) |
| P4-4 | Add per-component "override surface" note (which `--dc-*` tokens are the public API). Note: `dc-components.css:676, 740, 3722` use `h1:first-of-type` inside the frozen chapter-opener composite — these are a documented Paged.js hash-leak risk with a workaround in place. Mark as "known risk — do not touch without user approval." |
| P4-5 | Add two-stat-block disambiguation (`.dc-stat-grid` vs `.dc-npc-stat`) |
| P4-6 | Note cover page PDF/X caveat for Ingram submission in reference |
| P4-7 | Add TAC documentation to all specialty-dark tokens per fungi pillar standard |
| P4-8 | Add `--<specialty>-mid` tier tokens (10 tokens) to specialty table in reference — currently missing entirely |
| P4-9 | Document `.dc-accent-X` utility class system in reference, OR remove the stale comment at `dc-components.css:2890` if the system no longer exists |

---

## What the Three Experts Agree Is The Single Highest-Leverage Change

All three identified the same root cause stated three different ways:

> **"Components reach directly into the pillar layer with no semantic bridge, and their public tokens are declared at the wrong scope."**

- A: semantic intermediary → reskin requires touching every component
- DS: `:root` public tokens → author override story is documented and accessible
- P: `:root` co-location → Paged.js var() chain is reliable across stylesheets

**The one change that unlocks all three concerns:** move all `--dc-[component]-*` token defaults to `:root` in `dc-tokens.css`, with each pointing to a semantic surface/role token rather than a pillar token directly. The semantic tokens in turn point to the pillar. Result: a new project overrides 10-20 semantic tokens, not 200+ pillar references scattered across 1500 lines of component rules.
