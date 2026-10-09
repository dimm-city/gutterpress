# Component markers: declared and flexible, with variant-aware authoring

Investigation notes, 2026-10-09. Covers Gutterpress at `v0.11.16-alpha.1` and gp-dimm-city `1.1.5` (commit 80980db).

## Goal

Every main Dimm City component, and every main variant of it, should be a marker the Gutterpress core knows about. The author experience we are aiming for:

1. Type `@sk`, autocomplete offers `@skill` and its variants, and the author picks one.
2. That variant's snippet is inserted, with its `{{fields}}` ready to fill in.
3. Mistakes show in Problems at the right line: unknown variant, missing `@end-…`, wrong structure (`validate`).

Constraints:

- Adding a component must stay easy for plugin authors.
- The core code must stay cohesive and give clear feedback to plugin authors and book authors.
- Components that rebuild their content (skill, specialty, learning path) must still get all of the above.

## Where things stand

There are two ways to make a marker. Both live in `plugin.js`.

| | Declared in `export const markers` | Hand-written markdown-it rule |
|---|---|---|
| Who parses `@x … @end-x` | Core | The plugin |
| What it can emit | A wrapper element with classes, plus an optional label element read from an attribute | Anything |
| Autocomplete, snippet badge, `validate` | Yes | No |
| Typo, unclosed and stray-closer warnings, with line numbers | Yes | Only what the plugin writes |
| Inline editing and scroll sync on the wrapper (`data-source-range`) | Yes | Only if the plugin sets source lines |
| Collisions detected when the book loads | Yes | No |

gp-dimm-city declares nothing. A single core rule, `dimm_city_transform` (`plugin.js:909–2097`), handles every marker:

- It runs as a state machine with about 40 flags and a flat `closeAll()`.
- It relies on markers being their own paragraphs, with workarounds for when they aren't.
- It parses attributes with an inlined copy of core's `parseMarkerLine`.
- It emits one warning, and that warning has no line.

None of the declared-marker benefits reach Dimm City books today.

### Inventory of gp-dimm-city markers

| Kind | Markers |
|---|---|
| Pure wrappers (easy) | `@sidebar` (`.inset`), `@sidebar-box`, `@definition`, `@specialty-intro`, `@specialty-art`, `@gear`, `@toc`, `@lede`, `@glossary` |
| Wrapper with label or variant (easy–medium) | `@block` (panel/slate/shard/codex, plus `label=` title), `@callout` (note/warning/dm/vibe/origin/visit/gear via `variant=`, with a per-variant default label), `@dm-note` (`callout` with variant `dm`), `@specialty-card` (odd/even counter) |
| Restructurers (medium–hard) | `@card` (heading, pull, body and footer), `@outcome` (rows rebuilt), `@specialty` (10 classes, plus a code used by learning paths), `@learning-path` (two divs, a ref and a sticker chain), `@procedure` (no wrapper; rebuilds `ol`), `@skill` (no wrapper; one card per `####`; `@end-skills` alias), `@continue` (core-owned; uses the bridge) |
| Not containers | `@tape` (self-closing leaf), deprecated strippers, `> [!TYPE]` alerts, `ROLL THE DIE!` |
| "Section variants" | Author classes on core markers, such as `@section .dc-tabbed`, `.dc-npc-stat` or `.dc-card-grid`, and `@page .dc-citizen-file-page`. The plugin has no code for these, and core marker names cannot be declared by plugins. |

## The core idea: declare, then transform

Declare every component in the `markers` table, including the complicated ones. Where a component needs more than a wrapper, the plugin adds an ordinary markdown-it rule that rewrites the tokens between that component's open and close tokens. There is no new hook API: the table stays data, and the transform is a plain markdown-it rule, as CLAUDE.md §5 requires.

```js
export const markers = {
  skill: {
    class: "dc-skill-group",
    variants: { highlight: "dc-highlight", split: "dc-allow-split", "two-col": "dc-two-col" },
    autoCloseAt: ["eof"],
    validate(skill) { /* plain-object checks */ },
  },
  skills: { alias: "skill" },          // makes `@end-skills` a valid closer
};

export default function dimmCity(md) {
  md.core.ruler.push("dc_skill", (state) =>
    forEachComponent(state.tokens, "skill", (open, inner, close) => buildSkillCards(open, inner, close)));
}
```

What this gives:

- **Core owns** marker recognition, nesting, closing, warnings, source lines, autocomplete, snippets and `validate`.
- **The plugin owns** only the content rewrite. Each handler receives exactly one component's token range, so the `in*` flags and `closeAll()` disappear. Each restructurer becomes a small function with one job.
- **Ordering is already right.** Plugin core rules run after `layout_transform` and inline parsing, after `gp_component_validate` (so `validate` sees the author's structure, before the rewrite), and before `source_range`.
- **The rewrite is unconstrained.** A handler can drop the wrapper, for components like `@skill` and `@procedure` that have none today, or rename it.

What core must provide is a documented, stable token contract:

- `layout_component_open`, with `meta` = `{ kind, component, variant, attrs, line, labelled }`
- the matching `layout_component_close`

`meta` already carries everything except `kind`. Add `kind` (the base marker, so a transform for `callout` also catches the alias `dm-note`), and document the contract next to the `markers` docs.

`forEachComponent` is about 20 lines. It finds an open token with a given `meta.kind` and its matching close by nesting depth. The plugin scaffold should ship it inline, because plugins can't import from Gutterpress.

## Core changes, all small and general

### 1. Variants become first-class

**a. Object form for variants.** Today a variant maps to a class string (`variants: { warning: "dc-note warning" }`). Keep that shorthand and add an object form:

```js
variants: {
  warning: { class: "dc-note warning", label: "Warning", description: "Something can go wrong" },
}
```

- `label` is the default label text when the author gives no `label=` attribute. This replaces gp-dimm-city's callout label table.
- `description` appears beside the variant in autocomplete.

Variant snippets come from a naming convention, so they need no field (see 3 below).

**b. `variant=` as a second spelling.** Accept `variant=x` as an equivalent of the bare word. This matches how core already treats `.x` and `{.x}` as equivalent. It keeps every existing `@callout variant=note` book working while `@callout note` becomes the documented form.

**c. Warn on unknown variants.** When a marker declares `variants` and the author writes a variant that isn't one of them, emit an `unknown_variant` warning such as "did you mean `warning`?". Reuse `editDistance` from `markers.js:161`. Today an unknown variant is silently dropped.

### 2. The token contract

- Add `meta.kind`, the base marker name.
- Document the `layout_component_open`/`close` meta as public, the way the `markers` fields are.
- Show "declare, then transform" in the plugin scaffold, next to `term-box`, with the inline `forEachComponent` helper.

### 3. Editor: variant-aware autocomplete and snippets

- `MarkerComponent` gains `variants: [{ name, description?, snippet? }]`.
- Autocomplete lists `@skill`, then one entry per variant (`@skill highlight`, `@skill split`, …), each with its description. Typing `@sk` narrows to the skill entries.
- Each variant's snippet is chosen like this, with the existing level precedence (book, then extension, then core) applied at every step:
  1. `<snippets>/<name>.<variant>.md`, for example `snippets/callout.warning.md`
  2. otherwise the base snippet, with the variant word inserted into its first `@name` line
  3. otherwise an empty `@name variant` / `@end-name` pair
- The snippet picker groups variant snippets under their component.

### 4. Leaf markers (needed for `@tape`)

Add `selfClosing: true`. It emits the open and close tokens together, with no `@end-…`, and is the one way to declare `@tape label="…"`. Without it, `@tape` stays hand-written, and core's typo check may wrongly flag it once other markers are declared.

### 5. One resolver for everything

`listMarkerComponents` (`snippets.ts`) currently re-reads the raw `markers` objects and re-implements the deprecated and alias rules. It should call the exported, node-free `buildDeclaredMarkerRegistry` and read the resolved shapes. Then the renderer and the editor agree on aliases, variants, labels and descriptions, and a malformed declaration gives the same error in both.

### 6. Variants of core markers ("section variants")

`@section` and `@page` are core-owned and can't be declared by a plugin, and that should stay so. For gp-dimm-city's `@section .dc-tabbed`-style variants there are two options; do both:

- Where the thing is really a Dimm City component, give it a component name, for example `@npc-stat`, `@fiction-excerpt` or `@card-grid`.
- Let `@` autocomplete offer any snippet whose first line is a marker, for example the extension's `section.tabbed.md` starting `@section .dc-tabbed`, labelled "snippet". This needs no new semantics and works for any extension.

## Feedback

**Book authors, in Problems at the right line:**

- `unknown_variant` (new)
- the existing `unknown_marker`, unclosed and stray-closer warnings
- `component_invalid` from `validate`

**Plugin authors:**

- Errors when the book loads (already true for `markers` fields; extend to the variant object form and `selfClosing`).
- `component_validate_failed` when `validate` breaks.
- Scaffold tests that check every declared variant has a snippet, or is knowingly skipped.

## gp-dimm-city refactor plan

Work in this order, keeping the design-guide snapshot test green at each step.

1. **Bump `gutterpress`** (devDependency) to the release with the core changes. Move the tests that use bare `markdown-it` onto `createMarkdownRenderer`, because declared markers need core.
2. **Declare the pure wrappers.** Move `sidebar`, `sidebar-box`, `definition`, `specialty-intro`, `specialty-art`, `gear`, `toc`, `lede`, `glossary` and `block` (`variants` panel/slate/shard/codex, `label` → `dc-block-title`) into the table, and delete their branches from `dimm_city_transform`.
3. **Callouts.** Declare `callout` with variant objects (class plus default label; `label.tag: "span"`), `dm-note` as an alias with `preset: { variant: "dm" }`, and `specialty-card` with a small transform for `data-position`.
4. **Restructurers, one handler each:** `card` (heading/pull/body/footer), `outcome` (`flush` variant), `procedure` (handler drops the wrapper), `specialty` (10 variants plus `dc-cards-two-col`; `autoCloseAt: ["eof"]`), `learning-path` (handler reads the specialty code from the enclosing `specialty` open token instead of a global), `skill` (variants highlight/split/two-col; alias `skills`; handler drops the wrapper and builds cards). Keep `@continue` on its existing bridge.
5. **Snippets:**
   - one per component, plus `<name>.<variant>.md` where variants differ in structure (callout variants mostly don't; skill highlight and split mostly don't; card flaws/ideals/dreams do);
   - add the missing `sidebar-box`, `glossary` and `tape`;
   - add `validate` where it pays off: skill (needs a `####` heading), card, outcome rows, callout.
6. **Leftovers:** `@tape` uses `selfClosing`. Add Dimm City component names, or marker-first snippets, for the section and page variants.

What it costs:

| Cost | Detail |
|---|---|
| Snapshot diffs in migrated wrappers | `data-source-range` appears (wanted: it turns on inline editing), plus `data-<kind>="<variant>"` and `data-label`, and attribute order may change. Review the categories once, then regenerate. CSS is unaffected, because the classes stay the same. |
| Nesting semantics | Core uses a stack, where today it is "close all". The design guide doesn't depend on the difference. The real books need checking for one case before `@skill` migrates: `@end-skill` closing an enclosing `@learning-path`. Core would close only the skill. |
| Layout boundaries | Open DC containers now close at `@page`/`@section`. That's an improvement, but the DOM changes. |
| Removed markers | Core's `deprecated` warns where the plugin silently stripped. Accept the warning, or keep the strippers. |
| DC coverage test | It extracts `'@name'` literals from `plugin.js`; it must read the `markers` keys instead. |

## Effort, roughly

| Piece | Size |
|---|---|
| Core 1–3 and 5: variants, token contract, editor, resolver | Medium (one alpha) |
| Core 4 and 6: leaf markers, marker-first snippets | Small |
| gp-dimm-city steps 1–3 | Small–medium; mostly deleting code |
| gp-dimm-city step 4 | Medium–large; each restructurer becomes a range handler, and the monolith shrinks substantially |
| gp-dimm-city steps 5–6 | Small, mostly content |

## Not recommended

- **A `transform` or `render` callback in the `markers` table.** It adds a Gutterpress-specific hook API (against CLAUDE.md §5), and it would still have to hand authors markdown-it tokens. "Declare, then transform" gets the same flexibility with a plain markdown-it rule.
- **Letting plugins redefine `@section`/`@page`.** Core marker names are reserved on purpose, because the page model depends on them.
- **A two-step variant picker** (pick `@skill`, then a second popup for the variant). A flat list (`@skill`, `@skill highlight`, …) filters as the author types, needs no new interaction, and can be revisited later.
