# Extensions review — plugins, themes, and the extension-authoring surface

Date: 2026-09-01. Read-only review, no code changed.

**Method.** Read in full: the plugin loader (`markdown/plugins.ts`), plugin
manager (`plugin-manager.ts`), the npm vendoring pipeline (`plugin-vendor.ts`,
`npm-plugin-installer.ts`), the plugin author API (`markdown/renderer.ts`), the
theme manager and importer (`theme-manager.ts`, `theme-import.ts`), project
templates/scaffold/presets, the desktop Look&nbsp;&amp;&nbsp;style and Plugins
panels, the CLI command surface, user-guide chapters 4–5, and
`dimm-city-plugin.js` (2,082 lines) as the flagship extension.

Companion document: `2026-09-01-css-architecture-review.md`. §6 of that review
is the file layout that §6 of this one packages; the two are designed to land
together.

---

## TLDR

16 findings: **6 author-facing UX** (U1–U6), **6 plugin-author** (P1–P6),
**4 theme-author** (TH1–TH4), plus a unified package proposal and a 14-item
migration path.

The core problem is not any single mechanism — the parts are strong. It is that
an author extending a book navigates **six concepts** (template, theme, preset,
target, plugin, snippet), and the richest real extension in the ecosystem — the
DC component system — fits none of them. It is hand-wired: a cross-repo relative
plugin path, seven ordered `styles:` entries, and an `engineStyles:` key.
Nothing about it is installable, previewable, versionable or discoverable
through any existing flow. The flagship consumer is the proof that the extension
model has a missing tier.

Two structural moves follow:

- **One extension package** (§6) that both current formats are degenerate cases
  of — a theme is an extension with only styles, a plugin is one with only
  markdown.
- **Declarative container components in core** (§7), which removes an estimated
  ~1,000 lines of generic plumbing from the DC plugin and closes the silent
  marker-collision footgun.

---

## 1. The extension landscape today

| Concept | What it is | Install / apply | Surface |
|---|---|---|---|
| **Template** | Starting content + manifest, scaffold-time only | `gutterpress new --template` | CLI + desktop wizard |
| **Theme** | A folder: one `theme.css` + `theme.json` + fonts. Apply = copy into `themes/<id>/` + wire `styles:` | Apply / import (folder, zip, url) | **Desktop only** |
| **Preset** | How the book is designed: trim geometry, PDF/X, validation defaults | manifest `preset:` | manifest |
| **Target** | Where it publishes (dtrpg / itch) | manifest `targets:` | manifest |
| **Plugin** | markdown-it function (local file or vendored npm) + optional `css` string export | `gutterpress plugin add` / desktop | CLI + desktop |
| **Snippet** | Project-local reusable markdown with variables | Saved from selection | Desktop picker |

---

## 2. What is working

- **The plain-markdown-it plugin contract** (CLAUDE.md §5) is the right call:
  hundreds of npm plugins Just Work, and the no-custom-API discipline has held.
- **The npm vendoring pipeline** — exact-version resolution, tarball
  verification, receipts, load-test-then-commit, atomic rollback — is
  best-in-class for an offline-capable tool.
- **Theme apply = copy** is the correct self-containment call, and
  cascade-position-preserving replacement (a theme keeps its `styles:` index)
  shows real care.
- **Theme import validation** — zip-safety, print-safety linting of imported
  CSS, warning classification — treats theme packages as first-class inputs.
- **The guided Design panel** (parse `:root` → fonts/colors/sizes editors) is
  exactly the non-technical theming surface the goal calls for; it just has too
  little to bite on (TH2).
- **Recommended built-in features** ("Highlight", not "markdown-it-mark") — the
  demote-the-package-name move is the right instinct and should extend to
  everything below.

---

## 3. Author-facing UX findings

### U1 — Six concepts where authors think in two

A non-technical author has two questions: *"how do I make it look like X?"* and
*"how do I get feature Y?"*. Today the answer routes through template vs theme
vs preset vs plugin vs snippet, with different install verbs (scaffold / apply /
add / save) and different places in the UI. Worse, the boxes leak: templates
carry presets, themes carry fonts but not plugins, plugins carry CSS but not
fonts, and the richest real-world extension needs all of them at once.

**Recommendation.** Collapse the author-facing model to **Look** (theme) and
**Features** (everything a plugin/extension adds), and make one package format
serve both (§6). Presets/targets stay as manifest plumbing that templates and
themes *carry*, never something an author picks separately — the template wizard
already proves this works by reading `preset:` from the template's own manifest.

### U2 — Themes are desktop-only; plugins are CLI-first

There is `gutterpress plugin add` but no `gutterpress theme` anything — the user
guide has to say "Today that apply/import flow lives in the desktop app's Theme
panel." A CI setup, an agent or a terminal user cannot apply or import a theme
without hand-editing the manifest and copying folders. `theme-manager.ts` is
already shared-lib and platform-clean; the asymmetry is an accident of
implementation order.

**Recommendation.** `gutterpress theme list | apply <id> | import <path|url> | revert`
— thin CLI wrappers over the existing shared-lib functions.

### U3 — The GFM alert regression: the most-wanted feature became a branded plugin

`> [!NOTE]` — arguably the single most common "component" request in markdown
authoring — was moved out of core into the DC plugin. A fresh Gutterpress
project prints it as literal text, and the user guide spends two callouts
apologizing for it. Meanwhile the four bundled optional plugins are all
inline-syntax trivia (sub/sup/mark/abbr) — nice, but nobody's first ask.

**Recommendation.** Ship a bundled optional `gfm-alerts` feature emitting
*neutral, unstyled* structure (`<div class="gp-alert gp-alert-note">` +
`.gp-alert-label`) with minimal `:where()` default styling, exactly like the
rest of the gp-vocabulary. Themes and component libraries then restyle it (DC's
`.dc-alert` becomes a skin over it, or maps the classes). This follows the
established core doctrine — author-facing vocabulary that compiles to standard
HTML+CSS — and removes the #1 "why doesn't this work" moment.

### U4 — Components have no authoring surface; snippets do not travel

The DC library gives authors ~30 macros and section recipes, documented across a
39-page design guide. But in the editor, inserting a skill card means
remembering `@skill`'s shape or keeping the guide open. The snippet picker — the
exact right UI for this — only reads *project-local* `snippets/`; an installed
plugin or applied theme cannot contribute any. So the people best placed to make
components easy (extension authors) have no channel to the people who need them
easy (writers).

**Recommendation.** Let extensions ship snippets: a `snippets/` folder in the
package, merged into the picker under the extension's name, with the same
variable substitution. The component catalog proposed in the CSS review
(`components.yaml`, T13) then powers a richer version: each cataloged
component's *recipe* field IS its snippet, so documentation, insertion UI and CI
verification share one source of truth. This is the single biggest step toward
"authors apply components without any technical knowledge".

### U5 — Plugin CSS is invisible to every styling surface

A plugin's `css` export is a string injected into the built page — and nothing
else in the product can see it:

- not in `resolveActiveStyles`, so the CSS editor cannot show it;
- the Design panel cannot surface its tokens;
- printsafe/stylelint never check it;
- asset inlining explicitly skips it (assemble.ts: "the copy plan is the source,
  NOT a scan of the assembled CSS"), so a relative `url()` — a font, a texture —
  has **no supported story at all**.

Any extension with real styling ambitions is pushed out of the plugin format and
back into hand-wired manifest `styles:` entries, which is exactly what the DC
stack did.

**Recommendation.** Let plugins declare CSS as *files*, not strings:
`export const styles = ["./styles/components.css"]` (paths relative to the
plugin). The loader resolves them; they enter the same pipeline as manifest
styles — linted, asset-inlined, visible (read-only) in the styles list,
token-scannable by the Design panel. The string form stays for one-liners. This
is the load-bearing prerequisite for §6.

### U6 — No discovery beyond four hardcoded rows

`RECOMMENDED_PLUGINS` is a static array of the four bundled features. There is
no index of community themes or plugins, no "more…" path, and the theme grid
shows only built-ins plus what is already in the project. For an ecosystem play,
there is no shelf to put anything on.

**Recommendation.** Lightest viable version: a curated JSON index in the
gutterpress repo (id, name, description, install ref, preview URL), fetched on
demand by the desktop panels and `gutterpress theme/plugin search`. The same
pattern already runs for package managers (the scoop bucket, the homebrew
formula). Defer anything fancier until packages exist to list.

---

## 4. Plugin-author findings

### P1 — Every component plugin must reimplement the container machinery

The DC plugin is 2,082 lines. The genuinely bespoke logic (skill-title parsing,
ability-list transforms, outcome-ladder table building, the `@continue` bridge)
is maybe a third. The rest is generic container plumbing that core has already
written once in markers.js:

- a quote-aware attr tokenizer **explicitly inline-copied** from
  `parseMarkerLine` ("Grammar matches parseMarkerLine() in Gutterpress's
  markers.js — inlined here");
- `@name`/`@end-name` open/close dispatch for ~25 wrapper-only macros;
- EOF auto-close, attr escaping, class merging.

CLAUDE.md §5 forbids importing core helpers (correctly — the compiled binary
cannot resolve them), so every future component plugin pays the same ~1,000-line
tax and re-fixes the same edge cases.

The tax is not just size. Custom-rendered wrappers silently lose what core
threads onto *its* tokens: `data-source-range` (editor click-to-source),
`data-chapter-src`, diagnostics. markers.js's own col-split renderer needed
explicit hand-threading of those attrs and says so in a 15-line comment —
plugin authors do not even get the comment.

**Recommendation.** Declarative container components in core (§7). A plugin
exports a table; core does the parsing, nesting, auto-close, escaping and
editor-attr threading. Bespoke transforms stay hand-written markdown-it code —
the escape hatch never closes.

### P2 — Reserved marker names collide silently

Core claims eight `@`-names at block-parse time, before any plugin runs, so a
plugin marker sharing one "never runs and never warns — your handler is simply
skipped". The user guide documents this as a real shipped bug (a plugin's
`@continue` vs core's). Documentation is the current mitigation; a registry is
the fix.

**Recommendation.** With P1's registration table, core *knows* every declared
marker: collisions with core names or another plugin's become a load-time error,
and an unknown `@marker` line can warn instead of passing through as text — the
marker twin of the CSS review's C2 unknown-gp-class diagnostic.

### P3 — No scaffold, no test harness, and the reference example is an anti-template

The user guide's "Reference Example" section points plugin authors at the
2,082-line DC plugin in *another repo*, then warns: "Treat it as a demonstration
of the plugin API surface, not a template to copy wholesale." There is no
`gutterpress new` for plugins or themes, no fixture-based test pattern to copy,
and no lint for the emitted-class conventions the ecosystem depends on.

**Recommendation.** `gutterpress new --kind plugin` (and `--kind theme`):
scaffold a package with one declarative container, one bespoke-transform
example, a fixture markdown + expected-HTML test runnable with `bun test`, and
the metadata files. Mirrors the CSS review's C5 starter-architecture
recommendation — the two scaffolds should ship together and cross-reference.

### P4 — The plugin API's one extension beyond markdown-it is its weakest part

`GutterpressPluginExport` = `default` (great, standard) + `metadata` (fine,
underused — only logged) + `css` (a string; see U5). Notably absent: any way to
ship fonts/assets, snippets, engine styles or component metadata — which is the
entire supply list of a real component extension. The API froze at "markdown-it
plugin plus a stylesheet-shaped afterthought".

**Recommendation.** Grow the export/package surface deliberately as part of §6,
not ad hoc: `styles` (file paths), `markers` (declarative containers), plus
package-level `snippets/` and `components.yaml`. Keep the function signature
untouched — everything new is declarative and optional, so §5's "plain
markdown-it" doctrine survives intact.

### P5 — Priority semantics invert the common expectation

`priority: higher loads first` — so a plugin that must see another's tokens
needs a *lower* number, which the docs spell out with an if-sentence. Every
author will guess wrong once.

**Recommendation.** Keep `priority` working forever; document it as legacy and
prefer nothing — with declarative markers (P1), genuine ordering needs become
rare.

### P6 — Dead stripped-macro handling inside plugins

Inside the DC plugin, `@roll-table`/`@options-table` (removed in plugin 17.3.0)
still have full `isMarker` dispatch to strip them as no-ops, and macros.md
carries a growing "Retired — not implemented, do not use" museum. This mirrors
the CSS review's T6, and exists because there is no deprecation mechanism:
stripping in code is the only way to retire a macro gracefully.

**Recommendation.** With a marker registry (P1/P2), deprecation becomes
metadata: `{ deprecated: "removed in 17.3, use @outcome" }` makes core
warn-and-strip generically. The DC plugin then deletes its hand-rolled
strippers.

---

## 5. Theme-author findings

### TH1 — The theme format caps out at exactly one CSS file

A theme is *defined* as "a folder containing `theme.css`" — one stylesheet,
wired as one `styles:` entry. The CSS review's entire target architecture
(tokens / base / components / templates / rules as separate layered sheets, plus
`engineStyles`) is unrepresentable: the moment a theme grows past one file it
stops being a theme and becomes hand-wired manifest entries. This is why the DC
design system — the best theme in the ecosystem — cannot appear in the theme
grid, and cannot be applied, previewed, reverted or imported.

**Recommendation.** Extend `theme.json` backward-compatibly (absent key defaults
to `["theme.css"]`):

```json
{
  "name": "Dimm City",
  "styles": ["css/dc-tokens.css", "css/dc-core.css", "css/components/*.css",
             "css/page-templates.css", "css/page-rules.css"],
  "engineStyles": { "native": ["css/dc-native.css"] },
  "tokensFile": "css/dc-identity.css"
}
```

Apply copies the folder unchanged and wires *all* entries in order, replacing
the previous theme's contiguous block. With `@layer` (CSS review C3) the order
is belt-and-suspenders rather than load-bearing. `tokensFile` tells the Design
panel which sheet's `:root` is the author-facing override surface, so the guided
editor stops guessing.

### TH2 — The Design panel's token editor has no contract with theme authors

The guided editor parses the active stylesheet's `:root` and heuristically
buckets tokens into fonts/colors/sizes. Theme authors get no way to say which
tokens are the public surface, label them ("Accent color", not
`--color-accent`), group them, or hide internals — so a rich theme like DC's
(~200 `:root` declarations after the CSS review's T2 migration) would drown the
panel in implementation detail. The one place a non-technical author can retheme
is the one place theme authors cannot curate.

**Recommendation.** A tiny optional annotation grammar in the tokens file — the
panel already parses this CSS: `/* @label Accent color @group Colors */` above a
declaration, or a `tokens` map in theme.json. Unannotated files keep today's
heuristics. The CSS review's T2 defines what is public; this makes public tokens
legible.

### TH3 — A theme cannot bring the markdown its components need

Themes ship CSS; plugins ship markdown behavior — but a component library is
definitionally both. DC's `.dc-alert` styling is meaningless without the plugin
that turns `@callout`/`[!NOTE]` into that DOM, and nothing ties them: apply the
CSS without the plugin (or vice versa) and you get silent nothing. The user must
know to wire both halves, in two different manifest keys, from two different UI
panels.

**Recommendation.** This is the heart of the unification (§6): one package that
may carry both, installed by one action. A styles-only package is "a theme"; a
markdown-only one is "a feature"; the interesting ones are both, and the author
never has to know the difference.

### TH4 — Template vs theme overlap at the scaffold seam

`gutterpress new` copies a theme's CSS to `styles/book.css` — a *fork*, orphaned
from its theme id — while the desktop's Apply copies the same CSS to
`themes/<id>/theme.css` — a tracked, switchable, revertible theme. Two projects
"using clean-book" thus have different structures depending on which door they
came through, and the scaffolded one shows no active theme in the theme grid.

**Recommendation.** Scaffold through the same applyTheme path: `new` creates the
project, then applies the template's starter theme properly. One code path, one
on-disk shape, and a fresh project's theme card lights up correctly.

---

## 6. The unification: one extension package

Everything above converges on a single move: **stop having two package formats
and make one that both current formats are degenerate cases of.** Working name:
an *extension* (the manifest key can stay `plugins:` or grow an `extensions:`
alias).

```
my-extension/
├── gutterpress.json          # one metadata file (superset of theme.json)
│   {
│     "name": "Dimm City Components",
│     "description": "…", "author": "…", "preview": "preview.png",
│     "markdown": "plugin.js",             # optional — markdown-it entry
│     "styles": ["css/…", …],              # optional — ordered, layered
│     "engineStyles": { "native": [ … ] }, # optional
│     "tokensFile": "css/dc-identity.css", # optional — Design-panel surface
│     "components": "components.yaml",     # optional — the catalog (CSS review T13)
│     "snippets": "snippets/"              # optional — merged into the picker
│   }
├── plugin.js                 # plain markdown-it fn + declarative markers export
├── css/ fonts/ snippets/ components.yaml preview.png
```

- **Theme ≡ extension with only `styles`.** Existing `theme.css` + `theme.json`
  folders load unchanged (absent keys default to today's behavior) — zero
  migration for published themes.
- **Plugin ≡ extension with only `markdown`.** A bare `.js` file or npm
  markdown-it package keeps working exactly as now — the §5 doctrine is
  untouched; `gutterpress.json` is only needed when a package wants more than a
  function.
- **One install flow.** Local folder / zip / URL / npm, reusing the existing
  machinery: theme-import's zip-safety + printsafe linting for the styles half,
  the vendoring pipeline for the npm case, copy-into-project for
  self-containment. One manifest entry per extension instead of seven `styles:`
  lines plus a plugin line plus an `engineStyles` block.
- **One UI.** The theme grid and Plugins panel merge into an Extensions surface
  with two author-facing tabs — *Look* (extensions with styles, presented as
  today's theme cards with previews) and *Features* (the rest) — over one
  controller and one list. Recommended-feature rows, theme cards and the future
  index (U6) all render from the same `ExtensionInfo` shape.
- **One cascade contract.** Extension styles load between core and the project's
  own sheets (exactly where plugin CSS and themes already sit), each in its
  declared order; under CSS review C3 they get a named layer so "project
  overrides extension overrides core" is guaranteed by construction.
- **The DC system becomes the flagship extension.** The CSS review's §6 file cut
  *is* this package's contents: the library repo ships one `gutterpress.json`,
  and the field guide's manifest shrinks to `extensions: [dimm-city-components]`
  plus its own book overrides.

---

## 7. Declarative components in core

Core's marker parser already owns the grammar (`parseMarkerLine`), block
open/close, auto-close-at-EOF, attr escaping, class merging and editor-attr
threading. Expose that engine to extensions declaratively:

```js
// plugin.js — alongside (or instead of) the markdown-it function
export const markers = {
  "callout": {
    tag: "div",
    class: "dc-alert",
    variants: { note: "dc-note", warning: "dc-note warning",
                dm: "dc-dm-note", vibe: "dc-vibe-callout" },
    label: { class: "dc-alert-label", from: "attr:label" },
    autoCloseAt: ["eof"],
  },
  "sidebar":   { tag: "aside", class: "dc-sidebar" },
  "lede":      { class: "dc-intro" },
  "dm-note":   { alias: "callout", preset: { variant: "dm" } },
  "roll-table": { deprecated: "Removed in 17.3.0 — use @outcome." },
};
```

Core registers `@callout … @end-callout` with the same machinery as `@section`:
same attr syntax (both spellings), same escaping, same
`data-source-range`/`data-chapter-src` threading, same warning channel. What
this buys:

- An estimated **~1,000 lines deleted from the DC plugin** — every wrapper-only
  macro, the inlined tokenizer, the EOF auto-close bookkeeping, the deprecation
  strippers (P6). What remains is the genuinely bespoke third: skill parsing,
  outcome ladders, the continue bridge — still plain markdown-it code.
- **Collision safety** (P2): core rejects a declared marker that shadows a
  reserved name or another extension's, at load time, with a message.
- **Unknown-marker warnings**: with a complete registry, an `@calout` typo can
  warn instead of printing as literal text.
- **A new component costs a CSS block + 3 lines of table + a snippet** — which
  is the "drop a component in, style it with custom properties" loop the
  long-term goal describes.

Doctrine check: this does not violate §5. The plugin function signature is
untouched, no host `ctx` is injected, and any npm markdown-it plugin still Just
Works. `markers` is data interpreted by core — the same relationship `css`
already has — and an extension that wants full control keeps writing block rules
by hand.

---

## 8. Alignment with the CSS architecture review

| This review | CSS review | How they interlock |
|---|---|---|
| TH1 multi-sheet themes + layer slots | C3 `@layer` | Extension styles get a named layer; theme apply order stops being load-bearing. |
| U4 shipped snippets / component recipes | T13 `components.yaml` | One catalog file: docs, snippet picker and CI drift-check all read it. |
| §6 the DC flagship extension | §6 target file cut, T1/T3/T14 | The re-cut library files are literally the package contents; do the cut first, then wrap it. |
| P3 plugin/theme scaffolds | C5 layered starter theme | One `new --kind` family; the theme scaffold ships the layered CSS skeleton with contracts in headers. |
| P2 / §7 marker registry + warnings | C2 unknown-gp-class warning | Same diagnostic philosophy, both vocabularies: silent no-ops become named warnings. |
| TH2 curated token surface | T2 one token convention | T2 defines what is public; TH2 makes it legible in the Design panel. |
| U3 neutral gp-alert vocabulary | C1 core vocabulary gaps | Both extend the same principle: broadly-useful author surface belongs in core, unbranded. |
| U5 plugin styles as real files | C6 css-contract lint | Once plugin CSS is files, the same lint and printsafe checks cover extensions. |

---

## 9. Prioritized inventory and migration path

Phased so every step ships value alone and nothing breaks existing projects.
Effort: S < ½ day · M ≈ 1–2 days · L ≈ a week+.

| # | Item | Refs | Effort | Notes |
|---|---|---|---|---|
| 1 | CLI theme commands (`list`/`apply`/`import`/`revert`) over existing shared lib | U2 | S | Pure wiring; closes the desktop-only gap |
| 2 | Scaffold applies starter theme via applyTheme (one on-disk shape) | TH4 | S | Fresh projects show their theme card active |
| 3 | Bundled `gfm-alerts` feature emitting neutral `gp-alert` DOM | U3 | M | DC plugin later maps/skins it; user-guide apologies deleted |
| 4 | Plugin `styles` as file paths → full lint/inline/visibility pipeline | U5 P4 | M | Prerequisite for the package format; string form stays |
| 5 | `theme.json` `styles[]` + `engineStyles` + `tokensFile` (multi-sheet themes) | TH1 | M | Backward-compatible; apply wires the block, replace keeps position |
| 6 | Declarative marker registry in core (containers, variants, aliases, deprecation) + collision/unknown-marker diagnostics | P1 P2 P6 | L | The big one; DC plugin sheds ~1,000 lines |
| 7 | `gutterpress.json` extension package: one metadata file, one install flow (folder/zip/url/npm) | §6 U1 TH3 | L | Reuses theme-import safety + npm vendoring wholesale |
| 8 | Extensions ship snippets; picker merges package snippets under extension name | U4 | M | Recipe field of components.yaml doubles as the snippet source |
| 9 | Merged desktop Extensions surface (Look / Features tabs, one list + previews) | U1 | L | After 7; theme grid + plugins panel become views of one model |
| 10 | Token annotations (`@label`/`@group`) consumed by the Design panel | TH2 | M | Heuristics remain the fallback for unannotated CSS |
| 11 | `new --kind plugin|theme` scaffolds with fixture tests | P3 | M | Docs stop pointing at a 2,082-line anti-template |
| 12 | Package the DC system as the flagship extension; field-guide manifest shrinks to one entry | §6 TH3 | M | After 5–7 and the CSS review's file re-cut; the end-to-end proof |
| 13 | Curated extension index + `search` surfaces | U6 | M | Defer until 12 exists — need something on the shelf first |
| 14 | Deprecate `priority` phrasing in docs; registry makes ordering mostly moot | P5 | S | Keep the field working forever |

Sequence logic: 1–3 are standalone wins. 4 and 5 quietly turn the two existing
formats into subsets of the future one, so 7 becomes a rename plus a metadata
file rather than a rewrite. 6 can proceed in parallel — it only touches
markers.js and the loader. 12 is the milestone that proves the thesis: the day
the Dimm City system installs with one command is the day "theme vs plugin"
stops being a question authors can even ask.
