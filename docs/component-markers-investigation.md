# Component markers: declared, opt-in, with variant-aware authoring

Investigation notes, revised 2026-10-10 after review. Covers Gutterpress at `v0.11.16-alpha.1`, gp-dimm-city `1.1.5`, and the books in `dc-op-manual` (Field Guide and SysOps).

## Goal

Every main Dimm City component should be a marker the Gutterpress core knows about, with variants that add styling. The author experience we are aiming for:

1. Type `@sk`, autocomplete offers `@skill`, `@skill highlight`, … and the author picks one.
2. The component's snippet is inserted with the chosen variant on its marker line.
3. Mistakes show in Problems at the right line.

## Ground rules from review

1. **Plain markdown-it plugins stay first-class.** The `markers` table is an optional export. A plugin without one loads and renders exactly as today; core already has a test for this ("a loaded plugin with no `markers` export renders exactly as before #240"). Everything below is opt-in per plugin and per marker. Nothing changes what a plain npm markdown-it plugin can do.
2. **A variant only adds a class.** `@card featured` is `@card` plus one extra class, which the theme uses to adjust styling. Core already works exactly this way: `variants: { featured: "dc-card-featured" }`, with the variant selected by the bare word. **There is no core change to variants.** The only new work is in the editor: autocomplete lists the variants.
3. **Section-styled components are real core sections** (decided). `@npc-stat wirephreak` must behave exactly like `@section .dc-npc-stat .dc-wirephreak`, so it gets section breaks, `.gp-columns-2`, `@continue`, and closes at the next `@section`/`@page`.
4. **Remove buggy legacy behaviour rather than preserve it.** `@end-skills` and "`@end-skill` closes the enclosing `@learning-path`" are dropped (see the evidence section).
5. **No regressions in the books** (see the regression plan).

## Core changes (small)

### A. Section markers: `section: true`

A declared marker can say it *is* a section:

```js
"npc-stat": { section: true, class: "dc-npc-stat", variants: specialtyVariants },
```

Core turns `@npc-stat wirephreak` into a core `@section` whose classes are the marker's `class` plus the variant's class, plus any author classes. It then runs the existing section code: `openSection`, closing at the next section or page, and `@continue`, which already copies the open section's classes, so a continued `@npc-stat` keeps its look. `@end-npc-stat` acts as `@end-section`.

- **Implementation:** about 20 lines in the declared-marker branch of `layout_transform` (`markers.js`). It rewrites the marker into section metadata and calls the section branch. Validation in `resolveContainerShape`: `section` must be a boolean, and `tag` and `label` don't apply.
- **Result:** the section marker gets autocomplete, snippets and typo warnings like any other component.

### B. "Declare, then transform" for components that rebuild their content (opt-in)

Some components need more than a wrapper and classes: `@skill`, `@card`, `@outcome`, `@learning-path`, `@procedure`. The plugin declares them in the table, so core parses them and they get autocomplete, closing rules, warnings and source lines. The plugin then rewrites the content between the component's open and close tokens with an **ordinary markdown-it rule**. There is no hook API: the table stays data, and the transform is plain markdown-it.

Core additions:

- **`meta.kind`** on `layout_component_open`. This is the base marker name, so a rule for `callout` also catches the alias `dm-note`. The existing meta (`component`, `variant`, `attrs`, `line`) already carries the rest.
- **Document** the open/close token meta as a public contract.
- **Scaffold** a short example with a ~20-line `forEachComponent` helper inlined, because plugins can't import from Gutterpress.

Ordering already works:

- Plugin core rules run after `layout_transform` and inline parsing.
- They run after `validate`, which therefore sees what the author wrote.
- They run before `source_range`.

### C. Editor: variant-aware autocomplete

- `MarkerComponent` gains `variants: string[]`, the variant names.
- Autocomplete lists `@name` and one `@name <variant>` entry per variant, filtering as the author types.
- Picking a variant inserts the component's snippet (the existing book > extension > core precedence) with the variant word added after `@name` on its first line. There are no per-variant snippet files: a variant only changes styling, so the structure is the same.
- `listMarkerComponents` should read the resolved registry from `buildDeclaredMarkerRegistry` instead of the raw objects. Then the editor and the renderer agree on aliases, variants and section markers.

### D. Self-closing markers (`selfClosing: true`)

Needed for `@tape label="…"`, which has no `@end-tape`. Optional; without it `@tape` stays hand-written in the plugin.

### Dropped from the earlier draft

- the variant object form (`{ class, label, description }`)
- per-variant snippet files
- `variant=` as a second spelling
- the `unknown_variant` warning
- marker-first snippets in autocomplete (section components replace them)

## gp-dimm-city refactor

All of this is in gp-dimm-city's own `plugin.js` and stays opt-in. The plugin keeps working as a markdown-it plugin for everything it doesn't declare.

| Group | Markers | How |
|---|---|---|
| Section components (new) | DC section styles: today's `@section .dc-column-panel`, `.dc-tabbed`, `.dc-card-grid`, `.dc-npc-stat`, `.dc-fiction-excerpt`, … | `section: true`, with variants such as the specialties (`wirephreak`, `augmerc`, …) where styling differs per specialty |
| Wrappers | `@sidebar` (`inset`), `@sidebar-box`, `@definition`, `@specialty-intro`, `@specialty-art`, `@gear`, `@toc`, `@lede`, `@glossary`, `@block` (panel/slate/shard/codex), `@specialty-card`, `@specialty` (specialty variants), `@callout` and its alias `@dm-note` | Declared; their branches are deleted from `dimm_city_transform` |
| Content rewrites | `@skill`, `@card`, `@outcome`, `@learning-path`, `@procedure` | Declared, plus one transform each, run per component |
| Kept as is | `@continue` bridge, `> [!TYPE]` alerts, `ROLL THE DIE!`, `@tape` (until `selfClosing` exists) | Unchanged |

Small things the plugin's transforms keep doing:

- the callout's default label per variant
- `data-position` on specialty cards
- the learning-path ref, read from the enclosing `@specialty` component instead of a global

Book compatibility shims, kept in the plugin:

- `@callout variant=note` is used 9 times in the books. Map `attrs.variant` to the variant inside the callout transform. That's one line, and it can be dropped once the books use `@callout note`.

The 40-flag state machine and `closeAll()` go away because core supplies the nesting. Each transform handles one component's token range.

## Evidence for dropping `@end-skills` and `@end-skill` → learning-path close

I scanned every `.md` file in `dc-op-manual`, ignoring fenced code, and the gp-dimm-city design guide.

**`@end-skills`:** 0 uses in either. Drop it.

**Learning paths:** the books open 143 and explicitly close 85. Here is what closes each one:

| Closed by | Count | Same result under core? |
|---|---|---|
| `@end-learning-path` | 81 | yes |
| the next `@learning-path` | 41 | yes (re-opening the same marker closes the previous one) |
| `@section` / `@page` | 9 | yes (skill mode already closes everything at these) |
| `@specialty` / `@end-specialty` | 7 | yes (closing the specialty closes what's inside it) |
| `@end-skill`, then a later closer, **with content in between** | 2 | **no** |
| end of file | 1 | yes |

The 2 cases where the output would change:

1. **`field-guide/chapter-02 2 Proxy.md:343–347`** (built book):

   ```markdown
   @end-skill

   ![scavenger](…){.gp-center .fg-art-plate}

   @end-learning-path
   ```

   Today `@end-skill` closes the learning path, so the art plate renders outside it, and the author's `@end-learning-path` is silently ignored. Under core the plate sits inside the learning path, which is where the author's own `@end-learning-path` puts it. **This is a bug fix,** and it's visible on one page.

2. **`adventures/New Specialties/Ability Limbo.md:3330`.** No manifest builds this file (it's a working draft), so it doesn't ship.

Conclusion: dropping both is safe. The single shipped difference fixes a rendering bug.

## Regression plan

**Built-in safety net:** both books pin the vendored `gp-dimm-city@1.0.1` (`field-guide/manifest.yaml`, `SysOps/manifest.yaml`). Nothing changes in a book until someone re-pins it on purpose.

**Proof before re-pinning:**

1. **Diff harness** (a local script; book content is private, so it doesn't go in the public plugin repo). Render every chapter of both books through the same Gutterpress version, once with the current plugin and once with the refactored one, and diff the HTML.
2. **Normalise expected noise** before diffing: `data-source-range`, the new `data-<kind>` and `data-label` attributes, and attribute order. The classes must match exactly.
3. **Review every remaining diff** against the expected list:
   - the Field Guide ch. 02 art plate moving into its learning path;
   - containers now closing at `@page`/`@section`, where the plugin used to leave them open across the boundary.

   Anything else is a regression to fix before release.
4. **Keep the plugin's design-guide snapshot test green.** Review its categories once, then regenerate. Change its coverage test to read the `markers` keys, and move the tests that use bare markdown-it onto Gutterpress's renderer for the declared markers.
5. **Visual check:** build the PDF of both books before and after, and compare page counts plus a page-image diff of the changed pages.
6. **Order:** release gp-dimm-city, then re-pin one book, then the other.

## Order of work

1. **Gutterpress next alpha:**
   - A, section markers;
   - B, `meta.kind` plus the documented token contract;
   - C, variant autocomplete and the resolver;
   - optionally D, self-closing markers.
2. **gp-dimm-city:** section components and wrappers first, then the content-rewrite components one at a time, with the diff harness run at every step.
3. **Books:** re-pin after the diff review.
